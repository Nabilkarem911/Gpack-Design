const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const BASE_URL = 'http://localhost:3000';
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const pool = new Pool({ connectionString: dbUrl });

async function createTestProject() {
  const ts = Date.now();
  // 1. Create client
  const clientRes = await pool.query(
    "INSERT INTO clients(name, email, phone) VALUES($1, $2, $3) RETURNING id, name",
    [`Client_${ts}`, `c_${ts}@test.local`, `055${String(ts).slice(-7)}`]
  );
  const client = clientRes.rows[0];

  // 2. Create designer
  const desRes = await pool.query(
    "INSERT INTO users(name, email, phone, password_hash, role) VALUES($1, $2, $3, 'hash', 'DESIGNER') RETURNING id, name",
    [`Designer_${ts}`, `d_${ts}@test.local`, `056${String(ts).slice(-7)}`]
  );
  const designer = desRes.rows[0];

  // 3. Create project
  const projRes = await pool.query(
    "INSERT INTO projects(name, client_id, designer_id, status, description, brief) VALUES($1, $2, $3, 'WAITING_FOR_CLIENT', 'desc', 'brief') RETURNING id, name",
    [`Project_${ts}`, client.id, designer.id]
  );
  const project = projRes.rows[0];

  // 4. Create V1 with 2 options
  const vRes = await pool.query(
    "INSERT INTO versions(project_id, number, status, notes, uploaded_by) VALUES($1, 1, 'PENDING', 'V1 notes', $2) RETURNING id, number, status",
    [project.id, designer.id]
  );
  const v1 = vRes.rows[0];

  const opt1Res = await pool.query(
    "INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار A', 'SELECTED') RETURNING id, name",
    [v1.id]
  );
  const opt1 = opt1Res.rows[0];

  const opt2Res = await pool.query(
    "INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار B', 'PROPOSED') RETURNING id, name",
    [v1.id]
  );
  const opt2 = opt2Res.rows[0];

  // 5. Create portal access session for client
  const sid = `test_portal_${ts}`;
  await pool.query(
    "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '1 day')",
    [sid, client.id, project.id, client.name]
  );

  // 6. Create designer session
  const desSid = `test_des_${ts}`;
  await pool.query(
    "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
    [desSid, designer.id, designer.name, `d_${ts}@test.local`]
  );

  return {
    project,
    client,
    designer,
    v1,
    opt1,
    opt2,
    clientCookie: `gpack_portal=${sid}`,
    designerCookie: `gpack_session=${desSid}`
  };
}

test('1. Review State Machine: Version starts in PENDING, transitions to REVISION_REQUESTED on client request', async () => {
  const ctx = await createTestProject();

  // Send Revision Request
  const revRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: {
      'Cookie': ctx.clientCookie,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version_id: ctx.v1.id,
      option_id: ctx.opt1.id,
      request: 'يرجى تكبير الشعار بنسبة 20% وتعديل تدرج اللون الذهبي'
    })
  });

  assert.equal(revRes.status, 201, 'Revision request must return 201');
  const revData = await revRes.json();
  assert.ok(revData.id, 'Must return revision id');
  assert.equal(revData.version_id, ctx.v1.id);
  assert.equal(revData.status, 'REVISION_REQUESTED');

  // Verify Version status in DB is REVISION_REQUESTED
  const verDb = (await pool.query("SELECT status FROM versions WHERE id = $1", [ctx.v1.id])).rows[0];
  assert.equal(verDb.status, 'REVISION_REQUESTED', 'Version status must be REVISION_REQUESTED');

  // Verify Project status in DB is REVISION_REQUESTED
  const projDb = (await pool.query("SELECT status FROM projects WHERE id = $1", [ctx.project.id])).rows[0];
  assert.equal(projDb.status, 'REVISION_REQUESTED', 'Project status must be REVISION_REQUESTED');
});

test('2. Backend Enforcement: Duplicate revision request on same version returns 409 Conflict', async () => {
  const ctx = await createTestProject();

  // First Revision Request
  const rev1 = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'طلب تعديل أول' })
  });
  assert.equal(rev1.status, 201);

  // Second Revision Request on same version
  const rev2 = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'طلب تعديل ثان مكرر' })
  });
  assert.equal(rev2.status, 409, 'Second revision request must return 409 Conflict');
  const errData = await rev2.json();
  assert.ok(errData.error.includes('مسبقاً') || errData.error.includes('بانتظار'), 'Should return clear conflict message');

  // Verify only 1 revision record exists in DB for this version
  const revCount = (await pool.query("SELECT count(*)::int n FROM revisions WHERE version_id = $1", [ctx.v1.id])).rows[0].n;
  assert.equal(revCount, 1, 'Exactly one revision record must exist in DB');
});

test('3. Backend Enforcement: Approve after Revision Request returns 409 Conflict', async () => {
  const ctx = await createTestProject();

  // Request revision
  const revRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'ملاحظات التعديل' })
  });
  assert.equal(revRes.status, 201);

  // Attempt to approve the revised version
  const appRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id })
  });
  assert.equal(appRes.status, 409, 'Approve after revision request must return 409 Conflict');

  // Version must still be REVISION_REQUESTED
  const verDb = (await pool.query("SELECT status FROM versions WHERE id = $1", [ctx.v1.id])).rows[0];
  assert.equal(verDb.status, 'REVISION_REQUESTED');
});

test('4. Backend Enforcement: Double Approve returns 409 Conflict and prevents duplicate approval', async () => {
  const ctx = await createTestProject();

  // First Approval
  const app1 = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id })
  });
  assert.equal(app1.status, 200);

  // Second Approval on same version
  const app2 = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id })
  });
  assert.equal(app2.status, 409, 'Second approval must return 409 Conflict');
});

test('5. Backend Enforcement: Revision Request after Approval returns 409 Conflict', async () => {
  const ctx = await createTestProject();

  // Approve first
  const appRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id })
  });
  assert.equal(appRes.status, 200);

  // Attempt Revision Request on approved version
  const revRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'محاولة تعديل بعد الاعتماد' })
  });
  assert.equal(revRes.status, 409, 'Revision request on approved version must return 409 Conflict');
});

test('6. Race Condition: Concurrent duplicate revision requests serialize via FOR UPDATE (1 succeeds, 1 gets 409)', async () => {
  const ctx = await createTestProject();

  // Send two requests simultaneously in parallel
  const [resA, resB] = await Promise.all([
    fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'طلب متزامن 1' })
    }),
    fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'طلب متزامن 2' })
    })
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [201, 409], 'Exactly one request must succeed (201) and the other must conflict (409)');

  // Verify exactly 1 revision in database
  const count = (await pool.query("SELECT count(*)::int n FROM revisions WHERE version_id = $1", [ctx.v1.id])).rows[0].n;
  assert.equal(count, 1, 'Only one revision record in DB');
});

test('7. Voice Note in Revision Request: upload audio, single source of truth in files table, and linked to revision & messages', async () => {
  const ctx = await createTestProject();

  // Prepare dummy audio payload
  const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....');
  const formData = new FormData();
  formData.append('version_id', String(ctx.v1.id));
  formData.append('option_id', String(ctx.opt1.id));
  formData.append('request', 'ملاحظات تعديل مع صوت');
  formData.append('duration', '22');
  formData.append('audio', new Blob([dummyAudio], { type: 'audio/wav' }), 'customer-revision-audio.wav');

  const revRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie },
    body: formData
  });

  assert.equal(revRes.status, 201);
  const revData = await revRes.json();
  assert.ok(revData.id);
  assert.ok(revData.file_id, 'Revision must have file_id');
  assert.equal(revData.duration, 22);
  assert.equal(revData.file_url, `/api/files/${revData.file_id}`);

  // 1. Verify single source of truth in files table
  const fileDb = (await pool.query("SELECT * FROM files WHERE id = $1", [revData.file_id])).rows[0];
  assert.ok(fileDb, 'File must exist in files table');
  assert.equal(fileDb.uploaded_by_type, 'CLIENT');
  assert.equal(fileDb.version_id, ctx.v1.id);
  assert.equal(fileDb.option_id, ctx.opt1.id);

  // 2. Verify messages table has REVISION message with file_id and identifiers
  const msgDb = (await pool.query("SELECT * FROM messages WHERE revision_id = $1", [revData.id])).rows[0];
  assert.ok(msgDb, 'Message must be created for revision');
  assert.equal(msgDb.type, 'REVISION');
  assert.equal(msgDb.file_id, revData.file_id);
  assert.equal(msgDb.version_id, ctx.v1.id);
  assert.equal(msgDb.option_id, ctx.opt1.id);

  // 3. Verify unified file access endpoint works for client and designer
  const clientFileRes = await fetch(`${BASE_URL}/api/files/${revData.file_id}`, {
    headers: { 'Cookie': ctx.clientCookie }
  });
  assert.equal(clientFileRes.status, 200, 'Client should access file at /api/files/:id');

  const desFileRes = await fetch(`${BASE_URL}/api/files/${revData.file_id}`, {
    headers: { 'Cookie': ctx.designerCookie }
  });
  assert.equal(desFileRes.status, 200, 'Designer should access file at /api/files/:id');

  // 4. Verify GET /api/portal/:id returns canonical revision with file info
  const portalRes = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}`, {
    headers: { 'Cookie': ctx.clientCookie }
  });
  const portalData = await portalRes.json();
  const rItem = portalData.revisions.find(r => r.id === revData.id);
  assert.ok(rItem);
  assert.equal(rItem.file_url, `/api/files/${revData.file_id}`);
  assert.equal(rItem.duration, 22);
});

test('8. New Version V2 starts new review cycle while V1 remains historical record', async () => {
  const ctx = await createTestProject();

  // V1 revision requested
  await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/revisions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: ctx.v1.id, option_id: ctx.opt1.id, request: 'يرجى التعديل لإنتاج V2' })
  });

  // Designer uploads V2
  const dummyImg = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');
  const v2Form = new FormData();
  v2Form.append('notes', 'الإصدار V2 بعد التعديلات');
  v2Form.append('options', 'الخيار A,الخيار B');
  v2Form.append('option_0', new Blob([dummyImg], { type: 'image/gif' }), 'option_a_v2.gif');
  v2Form.append('option_1', new Blob([dummyImg], { type: 'image/gif' }), 'option_b_v2.gif');

  const v2Res = await fetch(`${BASE_URL}/api/projects/${ctx.project.id}/versions`, {
    method: 'POST',
    headers: { 'Cookie': ctx.designerCookie },
    body: v2Form
  });
  assert.equal(v2Res.status, 201);
  const v2Data = await v2Res.json();
  assert.equal(v2Data.number, 2);

  // Check V2 status is PENDING (new review cycle)
  const v2Db = (await pool.query("SELECT * FROM versions WHERE id = $1", [v2Data.id])).rows[0];
  assert.equal(v2Db.status, 'PENDING', 'New version V2 must start in PENDING state');

  // Check V1 status remains REVISION_REQUESTED (historical record preserved)
  const v1Db = (await pool.query("SELECT * FROM versions WHERE id = $1", [ctx.v1.id])).rows[0];
  assert.equal(v1Db.status, 'REVISION_REQUESTED', 'V1 must remain REVISION_REQUESTED');

  // Customer can now act on V2 (e.g. approve V2)
  const v2OptRes = await pool.query("SELECT id FROM design_options WHERE version_id = $1 LIMIT 1", [v2Data.id]);
  const v2OptId = v2OptRes.rows[0].id;

  const appV2Res = await fetch(`${BASE_URL}/api/portal/${ctx.project.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': ctx.clientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: v2Data.id, option_id: v2OptId })
  });
  assert.equal(appV2Res.status, 200, 'Customer should successfully approve V2');

  const v2AppDb = (await pool.query("SELECT status FROM versions WHERE id = $1", [v2Data.id])).rows[0];
  assert.equal(v2AppDb.status, 'APPROVED', 'V2 is now APPROVED');
});

test.after(async () => {
  await pool.end();
});
