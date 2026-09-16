const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Database migration 010 creates reviews table with proper constraints', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const tableRes = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'reviews'
      ORDER BY ordinal_position
    `);
    assert.ok(tableRes.rows.length >= 6, 'reviews table should have at least 6 columns');
    const cols = tableRes.rows.map(r => r.column_name);
    assert.ok(cols.includes('id'));
    assert.ok(cols.includes('project_id'));
    assert.ok(cols.includes('client_id'));
    assert.ok(cols.includes('designer_id'));
    assert.ok(cols.includes('rating'));
    assert.ok(cols.includes('comment'));
    assert.ok(cols.includes('created_at'));

    // Check unique constraint on project_id
    const constraintRes = await pool.query(`
      SELECT tc.constraint_type
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'reviews' AND ccu.column_name = 'project_id'
    `);
    const types = constraintRes.rows.map(r => r.constraint_type);
    assert.ok(types.includes('UNIQUE') || types.includes('PRIMARY KEY'), 'project_id must have UNIQUE constraint');
  } finally {
    await pool.end();
  }
});

test('Backend closure invariant: Project CANNOT be closed without verified client approval', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // 1. Create client, admin, project
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('Closure Client', 'closure_${Date.now()}@test.sa', '0559988776')
      RETURNING id
    `);
    const clientId = cRes.rows[0].id;

    const aRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Closure Admin', 'closure_admin_${Date.now()}@gpack.sa', 'ADMIN', 'dummyhash')
      RETURNING id, name, email
    `);
    const admin = aRes.rows[0];

    // Project in WAITING_FOR_CLIENT status (not approved)
    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, status)
      VALUES ('Closure Invariant Test', $1, 'WAITING_FOR_CLIENT')
      RETURNING id
    `, [clientId]);
    const projectId = pRes.rows[0].id;

    // Create session for admin
    const adminSid = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at)
      VALUES ($1, 'USER', $2, 'ADMIN', $3, $4, now() + interval '1 day')
    `, [adminSid, admin.id, admin.name, admin.email]);

    const adminCookie = `gpack_session=${adminSid}`;

    // Attempt 1: Try to complete project while in WAITING_FOR_CLIENT -> should be rejected
    const closeAttempt1 = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': adminCookie
      },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    // Transitions map: WAITING_FOR_CLIENT cannot go directly to COMPLETED (status 400 or 422)
    assert.ok([400, 422].includes(closeAttempt1.status), 'Attempt to close unapproved project must fail');

    // Attempt 2: Artificially set project status to APPROVED, but without any approved version in DB
    await pool.query(`UPDATE projects SET status = 'APPROVED' WHERE id = $1`, [projectId]);
    const closeAttempt2 = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': adminCookie
      },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(closeAttempt2.status, 422, 'Project without approved version record in DB must be rejected with 422');
    const errBody = await closeAttempt2.json();
    assert.ok(errBody.error.includes('معتمدة') || errBody.error.includes('اعتماد'));

    // Attempt 3: Insert an approved version into DB
    await pool.query(`
      INSERT INTO versions (project_id, number, status, approved_at)
      VALUES ($1, 1, 'APPROVED', now())
    `, [projectId]);

    const closeAttempt3 = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': adminCookie
      },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(closeAttempt3.status, 200, 'Closure must succeed once valid approval exists');
    const updated = await closeAttempt3.json();
    assert.equal(updated.ok, true);
  } finally {
    await pool.end();
  }
});

test('Revision requests & design approval create structured chat messages and post-closure review works', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // 1. Setup client, designer, project
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('Review Flow Client', 'rev_flow_${Date.now()}@test.sa', '0554433221')
      RETURNING id, name
    `);
    const client = cRes.rows[0];

    const dRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Review Flow Designer', 'rev_des_${Date.now()}@gpack.sa', 'DESIGNER', 'dummyhash')
      RETURNING id, name
    `);
    const designer = dRes.rows[0];

    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status)
      VALUES ('Complete Review Lifecycle', $1, $2, 'WAITING_FOR_CLIENT')
      RETURNING id
    `, [client.id, designer.id]);
    const projectId = pRes.rows[0].id;

    // 2. Setup client portal session
    const clientSid = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at)
      VALUES ($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '1 day')
    `, [clientSid, client.id, projectId, client.name]);
    const clientCookie = `gpack_portal=${clientSid}`;

    // 3. Create Version 1 with Option A and Option B
    const vRes = await pool.query(`
      INSERT INTO versions (project_id, number, status)
      VALUES ($1, 1, 'PENDING')
      RETURNING id
    `, [projectId]);
    const versionId = vRes.rows[0].id;

    const oRes = await pool.query(`
      INSERT INTO design_options (version_id, name, status)
      VALUES ($1, 'A', 'PROPOSED'), ($1, 'B', 'SELECTED')
      RETURNING id, name
    `, [versionId]);
    const optB = oRes.rows.find(o => o.name === 'B');

    // 4. Client submits revision request on Option B
    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optB.id,
        request: 'يرجى تغيير درجة اللون الذهبي إلى درجة أفتح'
      })
    });
    assert.equal(revRes.status, 201);

    // Verify structured chat message was inserted into messages table
    const msgRev = await pool.query(`
      SELECT body, sender_type, type
      FROM messages
      WHERE project_id = $1 AND body LIKE '%طلب تعديل%'
      ORDER BY id DESC LIMIT 1
    `, [projectId]);
    assert.ok(msgRev.rowCount > 0, 'A structured chat message must be created for the revision request');
    assert.ok(msgRev.rows[0].body.includes('الخيار B'), 'Message must contain option name');
    assert.ok(msgRev.rows[0].body.includes('V1'), 'Message must contain version number');
    assert.ok(msgRev.rows[0].body.includes('تغيير درجة اللون الذهبي'), 'Message must contain client comment');

    // Reset version status to PENDING for approval test
    await pool.query(`UPDATE versions SET status = 'PENDING' WHERE id = $1`, [versionId]);
    await pool.query(`UPDATE projects SET status = 'WAITING_FOR_CLIENT' WHERE id = $1`, [projectId]);

    // 5. Client approves Option B
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({
        version_id: versionId,
        option_id: optB.id
      })
    });
    assert.equal(appRes.status, 200);

    // Verify approval chat message was inserted
    const msgApp = await pool.query(`
      SELECT body, sender_type, type
      FROM messages
      WHERE project_id = $1 AND body LIKE '%اعتماد التصميم%'
      ORDER BY id DESC LIMIT 1
    `, [projectId]);
    assert.ok(msgApp.rowCount > 0, 'A structured chat message must be created for approval');
    assert.ok(msgApp.rows[0].body.includes('الخيار B'), 'Message must indicate approved option');
    assert.ok(msgApp.rows[0].body.includes('V1'), 'Message must indicate version number');

    // 6. Test Review endpoint before completion -> should fail with 400
    const prematureReview = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({ rating: 5, comment: 'رائع جداً' })
    });
    assert.equal(prematureReview.status, 400, 'Review before completion must be rejected');

    // Complete project (Admin)
    const adminSid = crypto.randomBytes(32).toString('hex');
    const aUser = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Rev Admin', 'rev_admin_${Date.now()}@gpack.sa', 'ADMIN', 'dummyhash')
      RETURNING id, name, email
    `);
    const admin = aUser.rows[0];
    await pool.query(`
      INSERT INTO sessions (id, subject_type, subject_id, role, name, email, expires_at)
      VALUES ($1, 'USER', $2, 'ADMIN', $3, $4, now() + interval '1 day')
    `, [adminSid, admin.id, admin.name, admin.email]);

    const closeRes = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `gpack_session=${adminSid}`
      },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    assert.equal(closeRes.status, 200, 'Should complete successfully since version is approved');

    // 7. Invalid rating (e.g. 0 or 6) -> 400
    const invalidReview = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({ rating: 6, comment: 'خارج المدى' })
    });
    assert.equal(invalidReview.status, 400);

    // 8. Valid review -> 201
    const validReview = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({ rating: 5, comment: 'تجربة ممتازة وتصميم متقن وسرعة في الإنجاز!' })
    });
    assert.equal(validReview.status, 201);
    const reviewData = await validReview.json();
    assert.equal(reviewData.rating, 5);
    assert.equal(reviewData.project_id, projectId);

    // 9. Duplicate review -> 409
    const dupReview = await fetch(`${BASE_URL}/api/portal/${projectId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': clientCookie
      },
      body: JSON.stringify({ rating: 4, comment: 'محاولة تكرار' })
    });
    assert.equal(dupReview.status, 409);

    // 10. Verify GET /api/portal/:id returns review
    const portalDataRes = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { 'Cookie': clientCookie }
    });
    assert.equal(portalDataRes.status, 200);
    const portalData = await portalDataRes.json();
    assert.ok(portalData.review, 'portalData must include review object');
    assert.equal(portalData.review.rating, 5);
    assert.equal(portalData.review.comment, 'تجربة ممتازة وتصميم متقن وسرعة في الإنجاز!');
  } finally {
    await pool.end();
  }
});
