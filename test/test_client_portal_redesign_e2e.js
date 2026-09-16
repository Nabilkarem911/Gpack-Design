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

test('End-to-End Client Portal Redesign Lifecycle & Identity Verification', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // 1. Create client & designer
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('عميل التجربة المتكاملة', 'e2e_client_${Date.now()}@test.sa', '0559988112')
      RETURNING id, name
    `);
    const client = cRes.rows[0];

    const dRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('مصمم التجربة', 'e2e_designer_${Date.now()}@gpack.sa', 'DESIGNER', 'dummyhash')
      RETURNING id, name, email
    `);
    const designer = dRes.rows[0];

    // 2. Create project
    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status, brief)
      VALUES ('مشروع هوية فاخرة V8', $1, $2, 'WAITING_FOR_CLIENT', 'موجز تفصيلي للمشروع')
      RETURNING id, name
    `, [client.id, designer.id]);
    const projectId = pRes.rows[0].id;

    // 3. Client Portal Session
    const clientSid = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at)
      VALUES ($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '1 day')
    `, [clientSid, client.id, projectId, client.name]);
    const clientCookie = `gpack_portal=${clientSid}`;

    // Admin session for closure
    const adminSid = crypto.randomBytes(32).toString('hex');
    const aRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('مدير النظام', 'e2e_admin_${Date.now()}@gpack.sa', 'ADMIN', 'dummy')
      RETURNING id, name, email
    `);
    await pool.query(`
      INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at)
      VALUES ($1, 'USER', $2, 'ADMIN', $3, $4, now() + interval '1 day')
    `, [adminSid, aRes.rows[0].id, aRes.rows[0].name, aRes.rows[0].email]);
    const adminCookie = `gpack_session=${adminSid}`;

    // 4. Create Version 8 with Options A, B, C
    const vRes = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 8, 'PENDING', 'ملاحظات الإصدار 8')
      RETURNING id
    `, [projectId]);
    const versionId = vRes.rows[0].id;

    const optARes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'A', 'PROPOSED') RETURNING id`, [versionId]);
    const optBRes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'B', 'SELECTED') RETURNING id`, [versionId]);
    const optCRes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'C', 'PROPOSED') RETURNING id`, [versionId]);

    const optA = optARes.rows[0].id;
    const optB = optBRes.rows[0].id;
    const optC = optCRes.rows[0].id;

    // 5. Verify Client GET /api/portal/:id
    const portalFetch = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    assert.equal(portalFetch.status, 200);
    const portalData = await portalFetch.json();
    assert.equal(portalData.versions.length, 1);
    assert.equal(portalData.versions[0].number, 8);
    assert.equal(portalData.versions[0].options.length, 3);
    const activeOpt = portalData.versions[0].options.find(o => o.status === 'SELECTED');
    assert.equal(activeOpt.name, 'B');

    // 6. Client selects Option A
    const selectOptRes = await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optA })
    });
    assert.equal(selectOptRes.status, 200);

    // Verify option A is now SELECTED
    const optCheck1 = await pool.query(`SELECT status FROM design_options WHERE id = $1`, [optA]);
    assert.equal(optCheck1.rows[0].status, 'SELECTED');

    // Switch back to Option B
    await fetch(`${BASE_URL}/api/portal/${projectId}/options/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({ version_id: versionId, option_id: optB })
    });
    const optCheckB = await pool.query(`SELECT status FROM design_options WHERE id = $1`, [optB]);
    assert.equal(optCheckB.rows[0].status, 'SELECTED');

    // 7. Client requests revision on Option B
    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optB,
        request: 'يرجى تكبير الشعار وجعل اللون الذهبي أفتح قليلاً'
      })
    });
    assert.equal(revRes.status, 201);

    // Verify structured message in chat
    const msgRev = await pool.query(`
      SELECT body, sender_type FROM messages WHERE project_id = $1 AND body LIKE '%طلب تعديل%' ORDER BY id DESC LIMIT 1
    `, [projectId]);
    assert.ok(msgRev.rowCount > 0);
    assert.ok(msgRev.rows[0].body.includes('الخيار B'));
    assert.ok(msgRev.rows[0].body.includes('V8'));
    assert.ok(msgRev.rows[0].body.includes('تكبير الشعار'));

    // Reset status to PENDING for approval
    await pool.query(`UPDATE versions SET status = 'PENDING' WHERE id = $1`, [versionId]);
    await pool.query(`UPDATE projects SET status = 'WAITING_FOR_CLIENT' WHERE id = $1`, [projectId]);

    // 8. Client Approves Option B
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optB
      })
    });
    assert.equal(appRes.status, 200);

    // Verify approval message in chat
    const msgApp = await pool.query(`
      SELECT body, sender_type FROM messages WHERE project_id = $1 AND body LIKE '%اعتماد التصميم%' ORDER BY id DESC LIMIT 1
    `, [projectId]);
    assert.ok(msgApp.rowCount > 0);
    assert.ok(msgApp.rows[0].body.includes('الخيار B'));
    assert.ok(msgApp.rows[0].body.includes('V8'));

    // 9. Admin completes project
    const completeRes = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(completeRes.status, 200);

    // 10. Client submits review
    const reviewRes = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({ rating: 5, comment: 'تجربة ممتازة وتصميم في غاية الدقة' })
    });
    assert.equal(reviewRes.status, 201);
    const review = await reviewRes.json();
    assert.equal(review.rating, 5);
    assert.equal(review.comment, 'تجربة ممتازة وتصميم في غاية الدقة');

    // 11. Duplicate review rejected
    const dupRes = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
      body: JSON.stringify({ rating: 4, comment: 'محاولة أخرى' })
    });
    assert.equal(dupRes.status, 409);

    // 12. GET /api/portal/:id includes the review
    const finalPortal = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    assert.equal(finalPortal.status, 200);
    const finalData = await finalPortal.json();
    assert.ok(finalData.review);
    assert.equal(finalData.review.rating, 5);
    assert.equal(finalData.project.status, 'COMPLETED');
  } finally {
    await pool.end();
  }
});
