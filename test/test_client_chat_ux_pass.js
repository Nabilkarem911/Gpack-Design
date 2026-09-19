const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Customer Portal Limited UX Pass: In-Chat Designs, Strict State Machine, Unified Files Scroll', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 1. Setup client, designer, project
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('شركة التميز المحدودة', 'tamayoz_${Date.now()}@test.sa', '0551122334')
      RETURNING id, name
    `);
    const client = cRes.rows[0];

    const dRes = await pool.query(`
      SELECT id, name FROM users WHERE role = 'DESIGNER' AND active = true LIMIT 1
    `);
    let designerId = dRes.rows[0]?.id;
    let designerName = dRes.rows[0]?.name;
    if (!designerId) {
      const des = await pool.query(`
        INSERT INTO users (name, email, role, password_hash)
        VALUES ('مصمم التجربة', 'ux_des_${Date.now()}@gpack.sa', 'DESIGNER', 'hash')
        RETURNING id, name
      `);
      designerId = des.rows[0].id;
      designerName = des.rows[0].name;
    }

    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status, description)
      VALUES ('تصميم هوية وعلب كرتونية فاخرة', $1, $2, 'WAITING_FOR_CLIENT', 'تصميم علب كرتونية فاخرة لمنتجات فاخرة')
      RETURNING id, name
    `, [client.id, designerId]);
    const projectId = pRes.rows[0].id;

    // Portal access session
    const clientSid = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions (id, subject_type, subject_id, project_id, role, name, expires_at)
      VALUES ($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '1 day')
    `, [clientSid, client.id, projectId, client.name]);
    const clientCookie = `gpack_portal=${clientSid}`;

    // 2. Version 1 with Option A and Option B
    const v1Res = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 1, 'PENDING', 'المقترحات الأولى لتصميم العلبة')
      RETURNING id
    `, [projectId]);
    const v1Id = v1Res.rows[0].id;

    const oRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'A', 'PROPOSED'), ($1, 'B', 'PROPOSED')
      RETURNING id, name
    `, [v1Id]);
    const optA = oRes.rows.find(o => o.name === 'A');
    const optB = oRes.rows.find(o => o.name === 'B');

    // Attach dummy image to Option A and Option B
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const dummyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const fNameA = `ux_test_a_${Date.now()}.png`;
    const fNameB = `ux_test_b_${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadsDir, fNameA), dummyPng);
    fs.writeFileSync(path.join(uploadsDir, fNameB), dummyPng);

    const f1 = await pool.query(`
      INSERT INTO files (project_id, version_id, option_id, uploaded_by_type, uploaded_by_id, original_name, stored_name, mime, size)
      VALUES ($1, $2, $3, 'DESIGNER', $4, 'علبة_خيار_A.png', $5, 'image/png', $6)
      RETURNING id
    `, [projectId, v1Id, optA.id, designerId, fNameA, dummyPng.length]);

    const f2 = await pool.query(`
      INSERT INTO files (project_id, version_id, option_id, uploaded_by_type, uploaded_by_id, original_name, stored_name, mime, size)
      VALUES ($1, $2, $3, 'DESIGNER', $4, 'علبة_خيار_B.png', $5, 'image/png', $6)
      RETURNING id
    `, [projectId, v1Id, optB.id, designerId, fNameB, dummyPng.length]);

    // 3. Verify Portal API data payload:
    // Ensure all options, versions, and files are served with the canonical data contract
    const portalRes = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { 'Cookie': clientCookie }
    });
    assert.equal(portalRes.status, 200, 'Portal data fetch should return 200');
    const portalData = await portalRes.json();

    assert.equal(portalData.project.id, projectId);
    assert.equal(portalData.versions.length, 1);
    assert.equal(portalData.versions[0].status, 'PENDING');
    assert.equal(portalData.versions[0].options.length, 2);

    // 4. Verify Revision Request on Option A with Voice & Notes
    const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....');
    const form = new FormData();
    form.append('version_id', String(v1Id));
    form.append('option_id', String(optA.id));
    form.append('request', 'يرجى تكبير الشعار بنسبة 15% وتعديل خط العناوين');
    form.append('audio', new Blob([dummyAudio], { type: 'audio/wav' }), 'customer-revision-audio.wav');
    form.append('duration', '12');

    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie },
      body: form
    });
    assert.equal(revRes.status, 201, 'Revision request submission must succeed with 201');
    const revData = await revRes.json();
    assert.ok(revData.id, 'Revision response must return revision id');

    // 5. Verify Backend State Machine enforcement:
    // Duplicate revision on same version must be rejected with 409 Conflict
    const dupRevRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: v1Id,
        option_id: optA.id,
        request: 'طلب مكرر يجب أن يرفض'
      })
    });
    assert.equal(dupRevRes.status, 409, 'Duplicate revision request must return 409 Conflict');

    // Approve after revision must be rejected with 409 Conflict
    const conflictAppRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: v1Id,
        option_id: optB.id
      })
    });
    assert.equal(conflictAppRes.status, 409, 'Approve after revision request must return 409 Conflict');

    // 6. Verify Structured Chat Message created for revision request
    const revMsgs = await pool.query(`
      SELECT * FROM messages
      WHERE project_id = $1 AND type = 'REVISION'
      ORDER BY id DESC LIMIT 1
    `, [projectId]);
    assert.ok(revMsgs.rowCount > 0, 'A message with type=REVISION must be created');
    const revMsg = revMsgs.rows[0];
    assert.ok(revMsg.body.includes('طلب تعديل — الخيار A — الإصدار V1'));
    assert.ok(revMsg.body.includes('يرجى تكبير الشعار'));
    assert.equal(revMsg.duration, 12);
    assert.ok(revMsg.file_id, 'Revision voice file must be saved in files table');

    // 7. Verify Single File ID Invariant: Voice file in revision exists in files table once
    const voiceFileCheck = await pool.query(`
      SELECT count(*) as cnt FROM files WHERE id = $1
    `, [revMsg.file_id]);
    assert.equal(Number(voiceFileCheck.rows[0].cnt), 1, 'Voice file must exist in files table exactly once');

    // 8. Verify Designer uploads V2 with new review cycle
    const v2Res = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 2, 'PENDING', 'تم تكبير الشعار وتحديث الخط')
      RETURNING id
    `, [projectId]);
    const v2Id = v2Res.rows[0].id;

    const optA2Res = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'A', 'PROPOSED')
      RETURNING id
    `, [v2Id]);
    const optA2Id = optA2Res.rows[0].id;

    // 9. Client approves V2 Option A
    const appV2Res = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: v2Id,
        option_id: optA2Id
      })
    });
    assert.equal(appV2Res.status, 200, 'Approving V2 Option A must succeed with 200');

    // Verify V2 is approved while V1 remains REVISION_REQUESTED
    const v1State = await pool.query('SELECT status FROM versions WHERE id = $1', [v1Id]);
    const v2State = await pool.query('SELECT status FROM versions WHERE id = $1', [v2Id]);
    assert.equal(v1State.rows[0].status, 'REVISION_REQUESTED', 'V1 must retain historical status');
    assert.equal(v2State.rows[0].status, 'APPROVED', 'V2 must be approved');

    // 10. Frontend CSS & JS Invariants Check:
    // Read public/app.js and public/styles.css to verify UX constraints
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

    // A) Chat is the primary experience, no separate design panels/timelines
    assert.ok(appJs.includes('whatsapp-chat-experience'), 'Must contain whatsapp-chat-experience');
    assert.ok(appJs.includes('message-design-bubble'), 'Must render designs as chat bubbles');
    assert.ok(!appJs.includes('class="client-design-card"'), 'Must not have separate client design card');
    assert.ok(!appJs.includes('class="design-options-selector"'), 'Must not have separate design options selector');

    // B) In-Chat Design card contains Option label, Version pill, Thumbnail preview, Status, and Actions
    assert.ok(appJs.includes('formatOptionName(dItem.option.name)'), 'Must format option name (A/B/C)');
    assert.ok(appJs.includes('الإصدار V${dItem.version.number}'), 'Must display version V1/V2');
    assert.ok(appJs.includes('design-bubble-image-wrap'), 'Must have design image preview');
    assert.ok(appJs.includes('btn-design-rev'), 'Must have revision button in design bubble');
    assert.ok(appJs.includes('btn-design-app'), 'Must have approve button in design bubble');

    // C) Files section has internal scrolling & two tabs
    assert.ok(appJs.includes('client-files-scroll'), 'Must have client-files-scroll container');
    assert.ok(appJs.includes('ملفات العميل'), 'Must have client files tab');
    assert.ok(appJs.includes('ملفات المصمم'), 'Must have designer files tab');

    // D) CSS enforces internal scroll on .client-files-scroll
    assert.ok(stylesCss.includes('.client-files-scroll'), 'styles.css must style .client-files-scroll');
    assert.ok(stylesCss.includes('overflow-y: auto'), 'styles.css must have overflow-y: auto for files list');
    assert.ok(stylesCss.includes('max-height:'), 'styles.css must constrain max-height for files list');

  } finally {
    await pool.end();
  }
});
