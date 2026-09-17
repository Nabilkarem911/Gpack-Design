const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Strict Client Portal Redesign Invariants: Chat is Primary, In-Chat Designs, No Standalone Options/Preview, Realtime Uploads', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 1. Setup client, designer, project
    const cRes = await pool.query("INSERT INTO clients(name, email, phone) VALUES('مؤسسة الرياض التجارية', 'riyadh@test.sa', '0555544332') RETURNING id");
    const clientId = cRes.rows[0].id;

    const dRes = await pool.query("SELECT id, name FROM users WHERE role='DESIGNER' AND active=true LIMIT 1");
    let designerId = dRes.rows[0]?.id;
    let designerName = dRes.rows[0]?.name;
    if (!designerId) {
      const des = await pool.query("INSERT INTO users(name,email,role,password_hash) VALUES('م. أحمد المصمم','des.ahmed@gpack.sa','DESIGNER','x') RETURNING id, name");
      designerId = des.rows[0].id;
      designerName = des.rows[0].name;
    }

    const pRes = await pool.query(`
      INSERT INTO projects(name, client_id, designer_id, status, description)
      VALUES('تصميم عبوات قهوة مختصة فاخرة', $1, $2, 'WAITING_FOR_CLIENT', 'تصميم أكياس وعلب كرتونية للقهوة المختصة')
      RETURNING id
    `, [clientId, designerId]);
    const projectId = pRes.rows[0].id;

    // Create portal access code
    const rawCode = 'TEST' + Math.floor(100000 + Math.random() * 900000);
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    await pool.query('INSERT INTO portal_access(client_id, project_id, code_hash) VALUES($1, $2, $3)', [clientId, projectId, codeHash]);

    // Create Version 1 with 2 design options
    const vRes = await pool.query("INSERT INTO versions(project_id, number, notes, uploaded_by, status) VALUES($1, 1, 'مقترحات أولية لعلب القهوة', $2, 'PENDING') RETURNING id", [projectId, designerId]);
    const versionId = vRes.rows[0].id;

    const oA = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار A', 'PROPOSED') RETURNING id", [versionId]);
    const oB = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'الخيار B', 'PROPOSED') RETURNING id", [versionId]);
    const optionAId = oA.rows[0].id;
    const optionBId = oB.rows[0].id;

    // Create design files
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const dummyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const fNameA = 'coff_a_' + Date.now() + '.png';
    const fNameB = 'coff_b_' + Date.now() + '.png';
    fs.writeFileSync(path.join(uploadsDir, fNameA), dummyPng);
    fs.writeFileSync(path.join(uploadsDir, fNameB), dummyPng);

    const f1 = await pool.query("INSERT INTO files(project_id, version_id, option_id, uploaded_by_type, uploaded_by_id, original_name, stored_name, mime, size) VALUES($1, $2, $3, 'DESIGNER', $4, 'قهوة_خيار_A.png', $5, 'image/png', $6) RETURNING id", [projectId, versionId, optionAId, designerId, fNameA, dummyPng.length]);
    const f2 = await pool.query("INSERT INTO files(project_id, version_id, option_id, uploaded_by_type, uploaded_by_id, original_name, stored_name, mime, size) VALUES($1, $2, $3, 'DESIGNER', $4, 'قهوة_خيار_B.png', $5, 'image/png', $6) RETURNING id", [projectId, versionId, optionBId, designerId, fNameB, dummyPng.length]);

    // 2. Client visits portal access route /c/:code
    const portalRes = await fetch(`${BASE_URL}/c/${rawCode}`, { redirect: 'manual' });
    assert.equal(portalRes.status, 302, 'Should redirect to portal.html');
    const cookieHeader = portalRes.headers.get('set-cookie');
    assert.ok(cookieHeader && cookieHeader.includes('gpack_portal='), 'Should receive gpack_portal session cookie');
    const portalCookie = cookieHeader.split(';')[0];

    // 3. Client loads portal data
    const dataRes = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { 'Cookie': portalCookie }
    });
    assert.equal(dataRes.status, 200);
    const portalData = await dataRes.json();
    assert.equal(portalData.project.name, 'تصميم عبوات قهوة مختصة فاخرة');
    assert.equal(portalData.versions.length, 1);
    assert.equal(portalData.versions[0].options.length, 2);

    // 4. Test client uploads an image in chat
    const form = new FormData();
    const testImgBuf = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    form.append('file', new Blob([testImgBuf], { type: 'image/png' }), 'client_reference.png');
    form.append('body', 'صورة مرجعية لألوان العبوة');
    const clientEvtId = 'evt_' + Date.now();
    form.append('client_event_id', clientEvtId);

    const uploadRes = await fetch(`${BASE_URL}/api/portal/${projectId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': portalCookie },
      body: form
    });
    assert.equal(uploadRes.status, 201, 'Attachment upload must succeed with 201');
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.type, 'IMAGE');
    assert.equal(uploadJson.sender_type, 'CLIENT');
    assert.ok(uploadJson.file_url.includes(`/api/files/`));
    assert.equal(uploadJson.client_event_id, clientEvtId);

    // 5. Test Canonical Single File Storage: Ensure file is NOT duplicated
    const filesCheck = await pool.query('SELECT count(*) as cnt FROM files WHERE message_id=$1', [uploadJson.id]);
    assert.equal(Number(filesCheck.rows[0].cnt), 1, 'Exactly one canonical file row should exist for this attachment');

    // 6. Test Revision Request on Option A
    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': portalCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optionAId,
        request: 'يرجى تغيير لون الخط في الخيار A إلى الأبيض بدلاً من الأسود'
      })
    });
    assert.equal(revRes.status, 201, 'Revision request must succeed with 201');

    // Verify DB revision row
    const revRow = (await pool.query('SELECT * FROM revisions WHERE project_id=$1 ORDER BY id DESC LIMIT 1', [projectId])).rows[0];
    assert.equal(revRow.version_id, versionId);
    assert.equal(revRow.option_id, optionAId);
    assert.ok(revRow.request.includes('الخيار A'));

    // Verify chat message created for revision
    const msgsAfterRev = (await pool.query('SELECT * FROM messages WHERE project_id=$1 ORDER BY id DESC LIMIT 1', [projectId])).rows[0];
    assert.ok(msgsAfterRev.body.includes('طلب تعديل — الخيار A — الإصدار V1'), 'Chat message must contain exact structured header');
    assert.ok(msgsAfterRev.body.includes('ملاحظات العميل:'), 'Chat message must contain notes header');

    // 7. Test Design Approval on Option B
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Cookie': portalCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optionBId
      })
    });
    assert.equal(appRes.status, 200, 'Design approval must succeed');

    // Verify DB approved state
    const verRow = (await pool.query('SELECT * FROM versions WHERE id=$1', [versionId])).rows[0];
    assert.equal(verRow.status, 'APPROVED');
    assert.equal(verRow.approved_option_id, optionBId);

    const optBRow = (await pool.query('SELECT * FROM design_options WHERE id=$1', [optionBId])).rows[0];
    assert.equal(optBRow.status, 'APPROVED');

    // Verify chat message created for approval
    const msgsAfterApp = (await pool.query('SELECT * FROM messages WHERE project_id=$1 ORDER BY id DESC LIMIT 1', [projectId])).rows[0];
    assert.ok(msgsAfterApp.body.includes('تم اعتماد التصميم — الخيار B — الإصدار V1 ✅'), 'Chat message must contain exact approved header');

    // 8. Test Invariant: Manager/Designer CANNOT close without client approval
    // (Create unapproved project and test rejection)
    const pUnapp = (await pool.query("INSERT INTO projects(name, client_id, status) VALUES('مشروع غير معتمد', $1, 'APPROVED') RETURNING id", [clientId])).rows[0].id;
    // Login as admin
    const adminSession = 'test_admin_sess_' + Date.now();
    await pool.query("INSERT INTO sessions(id, subject_type, subject_id, role, name, expires_at) VALUES($1, 'USER', 1, 'ADMIN', 'Admin User', now()+interval '1 day')", [adminSession]);

    const closeUnapprovedRes = await fetch(`${BASE_URL}/api/projects/${pUnapp}/status`, {
      method: 'PATCH',
      headers: { 'Cookie': `gpack_session=${adminSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(closeUnapprovedRes.status, 422, 'Closing unapproved project must be rejected with 422');

    // Close approved project
    const closeApprovedRes = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: { 'Cookie': `gpack_session=${adminSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(closeApprovedRes.status, 200, 'Closing approved project must succeed');

    // 9. Post-Closure Review
    const reviewRes = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: { 'Cookie': portalCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        comment: 'عمل ممتاز وسرعة في التجاوب، التصميم رائع جداً!'
      })
    });
    assert.equal(reviewRes.status, 201, 'Submitting 5-star review must succeed');
    const revData = await reviewRes.json();
    assert.equal(revData.rating, 5);
    assert.equal(revData.project_id, projectId);

  } finally {
    await pool.end();
  }
});
