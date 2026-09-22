const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Phase 1 E2E Verification: Design Message Identity & Status (Scenarios A-G)', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 1. Verify Code Invariants in app.js and styles.css
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    // Requirement 1 & 2: Header identity & Option format
    assert.ok(appJs.includes('design-bubble-card-header'), 'Must have prominent design card header');
    assert.ok(appJs.includes('design-bubble-kicker'), 'Must display kicker 🎨 التصميم');
    assert.ok(appJs.includes('design-bubble-identity'), 'Must display Option Identity');
    assert.ok(appJs.includes('formatOptionName(dItem.option.name)'), 'Must format option name');
    assert.ok(appJs.includes('الإصدار V${dItem.version.number}'), 'Must format version number');

    // Requirement 3: Prominent status pills
    assert.ok(appJs.includes('design-status-pill status-waiting'), 'Must have 🟡 waiting status pill');
    assert.ok(appJs.includes('بانتظار مراجعة العميل'), 'Must have waiting text');
    assert.ok(appJs.includes('design-status-pill status-revision'), 'Must have 🔴 revision status pill');
    assert.ok(appJs.includes('طلب تعديل — بانتظار المصمم'), 'Must have revision requested text');
    assert.ok(appJs.includes('design-status-pill status-approved'), 'Must have 🟢 approved status pill');
    assert.ok(appJs.includes('تم اعتماد التصميم'), 'Must have approved text');
    assert.ok(appJs.includes('design-status-pill status-superseded'), 'Must have ⚪ superseded status pill');
    assert.ok(appJs.includes('مستبدل بإصدار أحدث'), 'Must have superseded text');

    // Requirement 5: Lineage notice
    assert.ok(appJs.includes('design-bubble-revised-notice'), 'Must have lineage notice container');
    assert.ok(appJs.includes('نسخة معدلة بناءً على:'), 'Must indicate revised-from text');

    // Requirement 6: Loading spinner & 409 conflict handling
    assert.ok(appJs.includes('btn-spinner'), 'Must support loading spinner');
    assert.ok(stylesCss.includes('.btn-spinner'), 'styles.css must style .btn-spinner');
    assert.ok(stylesCss.includes('@keyframes btn-spin'), 'styles.css must have btn-spin keyframes');
    assert.ok(appJs.includes('res.status===409'), 'Must handle 409 conflict with state reload');

    // Requirement 8: Image load retry
    assert.ok(appJs.includes('handleImageLoadRetry'), 'Must include handleImageLoadRetry function');
    assert.ok(appJs.includes('onerror="handleImageLoadRetry(this)"'), 'Image must attach retry error handler');

    // 2. Setup Test Data for Scenarios A-G
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('شركة أفنان التجارية', 'afnan_${Date.now()}@test.sa', '0559988776')
      RETURNING id, name
    `);
    const client = cRes.rows[0];

    const dRes = await pool.query(`
      SELECT id, name FROM users WHERE role = 'DESIGNER' AND active = true LIMIT 1
    `);
    let designerId = dRes.rows[0]?.id;
    if (!designerId) {
      const des = await pool.query(`
        INSERT INTO users (name, email, role, password_hash)
        VALUES ('مصمم المرحلة الأولى', 'des_p1_${Date.now()}@gpack.sa', 'DESIGNER', 'hash')
        RETURNING id
      `);
      designerId = des.rows[0].id;
    }

    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status, description)
      VALUES ('مشروع تغليف فاخر للمرحلة الأولى', $1, $2, 'WAITING_FOR_CLIENT', 'تغليف فاخر مع فحص الهوية والحالات')
      RETURNING id, name
    `, [client.id, designerId]);
    const projectId = pRes.rows[0].id;

    // Portal session cookie
    const clientSid = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions (id, subject_type, subject_id, project_id, role, name, expires_at)
      VALUES ($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '1 day')
    `, [clientSid, client.id, projectId, client.name]);
    const clientCookie = `gpack_portal=${clientSid}`;

    // --- SCENARIO A: Designer sends Option B / V1 -> Waiting for review ---
    const v1Res = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 1, 'PENDING', 'النسخة الأولى')
      RETURNING id
    `, [projectId]);
    const v1Id = v1Res.rows[0].id;

    const optBRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'B', 'PROPOSED')
      RETURNING id, name
    `, [v1Id]);
    const optBId = optBRes.rows[0].id;

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const dummyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const fNameV1 = `phase1_test_b1_${Date.now()}.png`;
    const fNameV2 = `phase1_test_b2_${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadsDir, fNameV1), dummyPng);
    fs.writeFileSync(path.join(uploadsDir, fNameV2), dummyPng);

    const fRes = await pool.query(`
      INSERT INTO files (project_id, version_id, option_id, original_name, stored_name, mime, size, uploaded_by_type, uploaded_by_id)
      VALUES ($1, $2, $3, 'mockup_b_v1.png', $4, 'image/png', $5, 'DESIGNER', $6)
      RETURNING id
    `, [projectId, v1Id, optBId, fNameV1, dummyPng.length, designerId]);
    const fileId = fRes.rows[0].id;

    // Fetch portal data
    const p1Fetch = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    assert.strictEqual(p1Fetch.status, 200);
    const p1Data = await p1Fetch.json();
    assert.strictEqual(p1Data.versions.length, 1);
    assert.strictEqual(p1Data.versions[0].status, 'PENDING');
    assert.ok(p1Data.versions[0].options.length > 0);

    // --- SCENARIO B: Client requests revision -> Button disables, Revision created, Status becomes "طلب تعديل — بانتظار المصمم" ---
    const revForm = new FormData();
    revForm.append('version_id', v1Id);
    revForm.append('option_id', optBId);
    revForm.append('request', 'يرجى تكبير الشعار وجعل اللون الذهبي أفتح قليلاً');

    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.strictEqual(revRes.status, 201);
    const revJson = await revRes.json();
    assert.ok(revJson.id, 'Revision must be created');

    // Verify backend project and version transitioned to REVISION_REQUESTED
    const pAfterRev = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    const pAfterRevData = await pAfterRev.json();
    assert.strictEqual(pAfterRevData.project.status, 'REVISION_REQUESTED');
    assert.strictEqual(pAfterRevData.versions[0].status, 'REVISION_REQUESTED');
    assert.strictEqual(pAfterRevData.revisions.length, 1);
    assert.strictEqual(pAfterRevData.revisions[0].option_id, optBId);

    // --- SCENARIO G: 409 Conflict test: Duplicate Revision request returns 409 Conflict ---
    const dupRevRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.strictEqual(dupRevRes.status, 409, 'Duplicate revision on same version must return 409 Conflict');
    const dupRevJson = await dupRevRes.json();
    assert.ok(dupRevJson.error, 'Must provide clear error message, not raw crash');

    // Also: Approve after Revision request returns 409 Conflict
    const appAfterRev = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v1Id, option_id: optBId })
    });
    assert.strictEqual(appAfterRev.status, 409, 'Approve after revision request must return 409');

    // --- SCENARIO D: Designer sends new Version V2 -> V2 is latest, V1 becomes superseded ---
    const v2Res = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 2, 'PENDING', 'النسخة المعدلة بناءً على الملاحظات')
      RETURNING id
    `, [projectId]);
    const v2Id = v2Res.rows[0].id;

    const optB2Res = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'B', 'PROPOSED')
      RETURNING id, name
    `, [v2Id]);
    const optB2Id = optB2Res.rows[0].id;

    await pool.query(`
      INSERT INTO files (project_id, version_id, option_id, original_name, stored_name, mime, size, uploaded_by_type, uploaded_by_id)
      VALUES ($1, $2, $3, 'mockup_b_v2.png', $4, 'image/png', $5, 'DESIGNER', $6)
    `, [projectId, v2Id, optB2Id, fNameV2, dummyPng.length, designerId]);

    const pAfterV2 = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    const pAfterV2Data = await pAfterV2.json();
    assert.strictEqual(pAfterV2Data.versions.length, 2);
    // V2 is latest (number 2)
    assert.strictEqual(pAfterV2Data.versions[0].number, 2);
    assert.strictEqual(pAfterV2Data.versions[0].status, 'PENDING');
    // V1 is older (number 1), with revision request
    assert.strictEqual(pAfterV2Data.versions[1].number, 1);

    // --- SCENARIO C: Client approves Version V2 ---
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v2Id, option_id: optB2Id })
    });
    assert.strictEqual(appRes.status, 200);
    const appJson = await appRes.json();
    assert.strictEqual(appJson.status, 'APPROVED');

    // Duplicate approve returns 409 Conflict
    const dupAppRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v2Id, option_id: optB2Id })
    });
    assert.strictEqual(dupAppRes.status, 409, 'Double approve must return 409 Conflict');

    // Revision on approved version returns 409 Conflict
    const revOnApp = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.strictEqual(revOnApp.status, 409, 'Revision on approved version must return 409 Conflict');

    // --- SCENARIO E: Realtime SSE Stream Endpoint Connectivity ---
    const streamRes = await fetch(`${BASE_URL}/api/portal/${projectId}/stream`, {
      headers: { Cookie: clientCookie, Accept: 'text/event-stream' }
    });
    assert.strictEqual(streamRes.status, 200);
    assert.ok(streamRes.headers.get('content-type')?.includes('text/event-stream'), 'SSE content-type valid');
    // Read first chunk and close
    const reader = streamRes.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    assert.ok(value, 'Stream emitted initial ping/event');

    // --- SCENARIO F: Single source of truth file verification ---
    const fileFetch = await fetch(`${BASE_URL}/api/portal/${projectId}/files/${fileId}`, {
      headers: { Cookie: clientCookie }
    });
    assert.strictEqual(fileFetch.status, 200, 'File must be accessible directly from single source of truth');

  } finally {
    await pool.end();
  }
});
