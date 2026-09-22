const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Phase 2: Chat Action Clarity E2E Verification (Scenarios A-H)', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    // 1. Code Invariants: Design Bubble & Action Context Area
    assert.ok(appJs.includes('design-bubble-card-header'), 'Must have card header');
    assert.ok(appJs.includes('design-bubble-kicker'), 'Must have kicker 🎨 التصميم');
    assert.ok(appJs.includes('design-bubble-identity'), 'Must have identity area');
    assert.ok(appJs.includes('design-action-context-msg'), 'Must have pending action context');
    assert.ok(appJs.includes('هذا الإصدار بانتظار مراجعتك'), 'Must show pending action context text');
    assert.ok(appJs.includes('تم إرسال طلب التعديل على'), 'Must show revision action context text');
    assert.ok(appJs.includes('اعتمد العميل'), 'Must show approval action context text');
    assert.ok(appJs.includes('الإصدار الحالي: V'), 'Must show superseded action context text');

    // 2. Code Invariants: Revision Request as Chat Message
    assert.ok(appJs.includes('chat-structured-revision'), 'Must have structured revision card');
    assert.ok(appJs.includes('🔴 طلب تعديل'), 'Must have revision badge');
    assert.ok(appJs.includes('chat-structured-target-line'), 'Must have target line');
    assert.ok(appJs.includes('chat-structured-target-prefix'), 'Must have target prefix على:');
    assert.ok(appJs.includes('🎙️ التعليق الصوتي'), 'Must have voice note label');

    // 3. Code Invariants: Lineage
    assert.ok(appJs.includes('🔄 مبني على تعديل سابق'), 'Must have secondary lineage label');
    assert.ok(appJs.includes('scrollToDesignMessage'), 'Must have scroll function for lineage');
    assert.ok(stylesCss.includes('chat-item-highlight'), 'styles.css must have chat-item-highlight');

    // 4. Setup Live Test Project
    const ts = Date.now();
    const cRes = await pool.query(
      "INSERT INTO clients(name, email, phone) VALUES($1, $2, $3) RETURNING id, name",
      [`Client_P2_${ts}`, `c_p2_${ts}@test.local`, `055${String(ts).slice(-7)}`]
    );
    const client = cRes.rows[0];

    const dRes = await pool.query("SELECT id FROM users WHERE role='DESIGNER' AND active=true LIMIT 1");
    const designerId = dRes.rows[0].id;

    const pRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status, description) VALUES($1, $2, $3, 'WAITING_FOR_CLIENT', 'Phase 2 Test Project') RETURNING id, name",
      [`Project_P2_${ts}`, client.id, designerId]
    );
    const projectId = pRes.rows[0].id;

    const clientSid = crypto.randomBytes(32).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', $4, now()+interval '1 hour')",
      [clientSid, client.id, projectId, client.name]
    );
    const clientCookie = `gpack_portal=${clientSid}`;

    // A: Upload Version 1 with two design options (Option A and Option B)
    const v1Res = await pool.query(
      "INSERT INTO versions(project_id, number, status, uploaded_by) VALUES($1, 1, 'PENDING', $2) RETURNING id",
      [projectId, designerId]
    );
    const v1Id = v1Res.rows[0].id;

    const optARes = await pool.query(
      "INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار A', 'PROPOSED') RETURNING id",
      [v1Id]
    );
    const optBRes = await pool.query(
      "INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار B', 'PROPOSED') RETURNING id",
      [v1Id]
    );
    const optAId = optARes.rows[0].id;
    const optBId = optBRes.rows[0].id;

    // Verify Scenario A & E: Pending review with multiple options
    const portalRes1 = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { 'Cookie': clientCookie }
    });
    assert.equal(portalRes1.status, 200);
    const pData1 = await portalRes1.json();
    assert.equal(pData1.versions.length, 1);
    assert.equal(pData1.versions[0].options.length, 2);

    // Scenario F: Client requests revision on Option B with Voice Note + Text
    const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....');
    const formData = new FormData();
    formData.append('version_id', String(v1Id));
    formData.append('option_id', String(optBId));
    formData.append('request', 'يرجى تعديل ألوان الشعار لتكون أكثر وضوحاً');
    formData.append('duration', '18');
    formData.append('audio', new Blob([dummyAudio], { type: 'audio/wav' }), 'revision-voice.wav');

    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie },
      body: formData
    });
    assert.equal(revRes.status, 201);
    const revData = await revRes.json();
    assert.ok(revData.id);
    assert.ok(revData.file_id, 'Must attach file_id for voice note');
    assert.equal(revData.duration, 18);

    // Scenario B: Check revision message in chat
    const msgsRes = await fetch(`${BASE_URL}/api/portal/${projectId}/messages`, {
      headers: { 'Cookie': clientCookie }
    });
    const msgs = await msgsRes.json();
    const revMsg = msgs.find(m => m.revision_id === revData.id || m.type === 'REVISION');
    assert.ok(revMsg, 'Revision message must be in chat');
    assert.equal(revMsg.version_number, 1);
    assert.equal(revMsg.option_name, 'الخيار B');
    assert.equal(revMsg.file_id, revData.file_id);
    assert.equal(revMsg.duration, 18);

    // Scenario H: Duplicate action on same version returns 409 Conflict
    const dupRevRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v1Id, option_id: optBId, request: 'محاولة مكررة' })
    });
    assert.equal(dupRevRes.status, 409, 'Duplicate revision must return 409 Conflict');

    const dupAppRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v1Id, option_id: optBId })
    });
    assert.equal(dupAppRes.status, 409, 'Approve on revision requested must return 409 Conflict');

    // Scenario D: Designer uploads Version 2 (based on revision on Option B V1)
    const v2Res = await pool.query(
      "INSERT INTO versions(project_id, number, status, uploaded_by) VALUES($1, 2, 'PENDING', $2) RETURNING id",
      [projectId, designerId]
    );
    const v2Id = v2Res.rows[0].id;

    const optB2Res = await pool.query(
      "INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار B', 'PROPOSED') RETURNING id",
      [v2Id]
    );
    const optB2Id = optB2Res.rows[0].id;

    // Scenario C: Client approves Version 2 Option B
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v2Id, option_id: optB2Id })
    });
    assert.equal(appRes.status, 200);

    // Verify chat has approval message
    const msgsRes2 = await fetch(`${BASE_URL}/api/portal/${projectId}/messages`, {
      headers: { 'Cookie': clientCookie }
    });
    const msgs2 = await msgsRes2.json();
    const appMsg = msgs2.find(m => m.body && m.body.includes('تم اعتماد التصميم'));
    assert.ok(appMsg, 'Approval message must be in chat');
    assert.ok(appMsg.body.includes('الخيار B'));
    assert.ok(appMsg.body.includes('V2'));

  } finally {
    await pool.end();
  }
});
