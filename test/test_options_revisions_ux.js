const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

function formatOptionName(name) {
  if (!name) return '';
  const s = String(name).trim();
  return /^الخيار\s+/i.test(s) ? s : `الخيار ${s}`;
}

// -------------------------------------------------------------
// 1. Helper formatting unit test
// -------------------------------------------------------------
test('formatOptionName normalizes letters and names consistently', () => {
  assert.equal(formatOptionName('A'), 'الخيار A');
  assert.equal(formatOptionName('B'), 'الخيار B');
  assert.equal(formatOptionName('C'), 'الخيار C');
  assert.equal(formatOptionName('الخيار A'), 'الخيار A');
  assert.equal(formatOptionName('الخيار B'), 'الخيار B');
  assert.equal(formatOptionName('الخيار الذهبي'), 'الخيار الذهبي');
  assert.equal(formatOptionName(''), '');
  assert.equal(formatOptionName(null), '');
});

// -------------------------------------------------------------
// 2. Integration: Option selection, badge state, and revision requests
// -------------------------------------------------------------
test('Client selects options, creates revisions, and designer views formatted option labels', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 1. Create client & designer
    const clientRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('Opt Client', 'opt_client_${Date.now()}@test.sa', '0551122334')
      RETURNING id
    `);
    const clientId = clientRes.rows[0].id;

    const designerRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Opt Designer', 'opt_designer_${Date.now()}@gpack.sa', 'DESIGNER', 'dummyhash')
      RETURNING id, name, email
    `);
    const designer = designerRes.rows[0];

    // 2. Create project
    const projRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status)
      VALUES ('Packaging Design V8 Project', $1, $2, 'WAITING_FOR_CLIENT')
      RETURNING id
    `, [clientId, designer.id]);
    const projectId = projRes.rows[0].id;

    // 3. Create Version 8 with Options A, B, C
    const verRes = await pool.query(`
      INSERT INTO versions (project_id, number, status, uploaded_by)
      VALUES ($1, 8, 'PENDING', $2)
      RETURNING id, number
    `, [projectId, designer.id]);
    const versionId = verRes.rows[0].id;

    const optARes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'الخيار A', 'PROPOSED')
      RETURNING id, name
    `, [versionId]);
    const optAId = optARes.rows[0].id;

    const optBRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'B', 'PROPOSED')
      RETURNING id, name
    `, [versionId]);
    const optBId = optBRes.rows[0].id;

    const optCRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'الخيار C', 'PROPOSED')
      RETURNING id, name
    `, [versionId]);
    const optCId = optCRes.rows[0].id;

    // 4. Create Client Session & Designer Session
    const clientSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', 'Opt Client', now() + interval '1 day')",
      [clientSessionId, clientId, projectId]
    );

    const designerSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
      [designerSessionId, designer.id, designer.name, designer.email]
    );

    const clientCookie = `gpack_portal=${clientSessionId}`;
    const designerCookie = `gpack_session=${designerSessionId}`;

    // TEST 1: Client selects Option A -> A is SELECTED
    const selARes = await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optAId })
    });
    assert.equal(selARes.status, 200, 'Select option A must return 200');

    const dbOptA = (await pool.query('SELECT status FROM design_options WHERE id = $1', [optAId])).rows[0];
    assert.equal(dbOptA.status, 'SELECTED', 'Option A must have status SELECTED');

    // TEST 2: Client changes selection from A to B -> A is PROPOSED, B is SELECTED
    const selBRes = await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optBId })
    });
    assert.equal(selBRes.status, 200, 'Select option B must return 200');

    const dbOptAAfter = (await pool.query('SELECT status FROM design_options WHERE id = $1', [optAId])).rows[0];
    const dbOptBAfter = (await pool.query('SELECT status FROM design_options WHERE id = $1', [optBId])).rows[0];
    assert.equal(dbOptAAfter.status, 'PROPOSED', 'Option A must revert to PROPOSED');
    assert.equal(dbOptBAfter.status, 'SELECTED', 'Option B must be SELECTED');

    // TEST 3: Client creates revision request while B is selected
    const revBRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optBId, request: 'تعديل الخلفيات واللون' })
    });
    assert.equal(revBRes.status, 201, 'Revision request on option B must return 201');
    const revBData = await revBRes.json();
    assert.ok(revBData.id, 'Revision must have id');

    // Verify Designer views project and sees "تعديل على V8 — الخيار B"
    const projDataRes = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
      headers: { 'Cookie': designerCookie }
    });
    assert.equal(projDataRes.status, 200);
    const projData = await projDataRes.json();

    const rev1 = projData.revisions.find(r => r.id === revBData.id);
    assert.ok(rev1, 'Revision must appear in project revisions');
    assert.equal(rev1.version_number, 8);
    assert.equal(rev1.option_name, 'B');
    const title1 = `تعديل على V${rev1.version_number}${rev1.option_name ? ' — ' + formatOptionName(rev1.option_name) : ''}`;
    assert.equal(title1, 'تعديل على V8 — الخيار B', 'Title must render: تعديل على V8 — الخيار B');

    // Invariant: Duplicate revision on V8 is rejected with 409 Conflict
    const revDupRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optBId, request: 'تكرار التعديل على نفس الإصدار' })
    });
    assert.equal(revDupRes.status, 409, 'Duplicate revision on same version must return 409');

    // Designer uploads V9 with Option C for new revision cycle
    const v9Res = await pool.query(`
      INSERT INTO versions (project_id, number, status)
      VALUES ($1, 9, 'PENDING')
      RETURNING id
    `, [projectId]);
    const v9Id = v9Res.rows[0].id;
    const optC2Res = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'الخيار C', 'PROPOSED')
      RETURNING id
    `, [v9Id]);
    const optC2Id = optC2Res.rows[0].id;

    // TEST 4: Client selects C on V9 and creates revision request
    await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: v9Id, option_id: optC2Id })
    });

    const revCRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: v9Id, option_id: optC2Id, request: 'تغيير حجم الشعار في الخيار C' })
    });
    assert.equal(revCRes.status, 201);
    const revCData = await revCRes.json();

    const projDataRes2 = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
      headers: { 'Cookie': designerCookie }
    });
    const projData2 = await projDataRes2.json();
    const rev2 = projData2.revisions.find(r => r.id === revCData.id);
    assert.ok(rev2);
    assert.equal(rev2.version_number, 9);
    const title2 = `تعديل على V${rev2.version_number}${rev2.option_name ? ' — ' + formatOptionName(rev2.option_name) : ''}`;
    assert.equal(title2, 'تعديل على V9 — الخيار C', 'Title must render: تعديل على V9 — الخيار C');

    // TEST 5: Verify both revisions maintain their distinct design options
    assert.equal(projData2.revisions.length, 2);
    const titles = projData2.revisions.map(r => `تعديل على V${r.version_number}${r.option_name ? ' — ' + formatOptionName(r.option_name) : ''}`);
    assert.ok(titles.includes('تعديل على V8 — الخيار B'));
    assert.ok(titles.includes('تعديل على V9 — الخيار C'));

    // Designer uploads V10 with Option C selected
    const v10Res = await pool.query(`
      INSERT INTO versions (project_id, number, status)
      VALUES ($1, 10, 'PENDING')
      RETURNING id
    `, [projectId]);
    const v10Id = v10Res.rows[0].id;
    const optC3Res = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'الخيار C', 'SELECTED')
      RETURNING id
    `, [v10Id]);
    const optC3Id = optC3Res.rows[0].id;

    // TEST 6: Revision without explicit option_id falls back to currently SELECTED option
    const revFallbackRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: v10Id, request: 'طلب تعديل بدون تحديد خيار صريح' })
    });
    assert.equal(revFallbackRes.status, 201);
    const revFbData = await revFallbackRes.json();
    const dbRevFb = (await pool.query('SELECT option_id FROM revisions WHERE id = $1', [revFbData.id])).rows[0];
    assert.equal(dbRevFb.option_id, optC3Id, 'Must fall back to currently SELECTED option C');

    // TEST 9: IDOR security check — Client attempting to pass an option_id from another project
    // Create another project with another version & option
    const otherProjRes = await pool.query(`
      INSERT INTO projects (name, client_id, status)
      VALUES ('Other Project', $1, 'WAITING_FOR_CLIENT')
      RETURNING id
    `, [clientId]);
    const otherProjId = otherProjRes.rows[0].id;

    const otherVerRes = await pool.query(`
      INSERT INTO versions (project_id, number, status)
      VALUES ($1, 1, 'PENDING')
      RETURNING id
    `, [otherProjId]);
    const otherVerId = otherVerRes.rows[0].id;

    const otherOptRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'Option X', 'PROPOSED')
      RETURNING id
    `, [otherVerId]);
    const foreignOptionId = otherOptRes.rows[0].id;

    const v11Res = await pool.query(`
      INSERT INTO versions (project_id, number, status)
      VALUES ($1, 11, 'PENDING')
      RETURNING id
    `, [projectId]);
    const v11Id = v11Res.rows[0].id;

    // Client for project 1 tries to submit revision claiming foreignOptionId
    const idorRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: v11Id, option_id: foreignOptionId, request: 'محاولة اختراق خيار مشروع آخر' })
    });
    assert.equal(idorRes.status, 400, 'Server must reject option_id from another project with 400');

    // Client tries to select foreignOptionId on project 1
    const idorSelectRes = await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({ version_id: v11Id, option_id: foreignOptionId })
    });
    assert.equal(idorSelectRes.status, 400, 'Server must reject selecting option_id from another project with 400');

  } finally {
    await pool.end();
  }
});
