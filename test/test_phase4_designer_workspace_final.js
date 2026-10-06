const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = 'http://127.0.0.1:3000';

test('Phase 4: Designer Workspace Final Audit & End-to-End Release Closure', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const testId = Date.now();
    const phone1 = '05' + Math.floor(10000000 + Math.random() * 90000000);
    const phone2 = '05' + Math.floor(10000000 + Math.random() * 90000000);
    const phone3 = '05' + Math.floor(10000000 + Math.random() * 90000000);

    // 1. Setup Client, Assigned Designer, and Unassigned (Attacker) Designer
    const clientRes = await pool.query(
      "INSERT INTO clients(name, email, phone) VALUES('عميل مراجعة المرحلة 4', $1, $2) RETURNING id, name",
      [`client_p4_${testId}@gpack.sa`, phone1]
    );
    const client = clientRes.rows[0];

    const desRes = await pool.query(
      "INSERT INTO users(name, email, phone, password_hash, role) VALUES('مصمم المشروع المسؤول', $1, $2, 'dummy', 'DESIGNER') RETURNING id, name, role",
      [`des_p4_${testId}@gpack.sa`, phone2]
    );
    const designer = desRes.rows[0];

    const otherDesRes = await pool.query(
      "INSERT INTO users(name, email, phone, password_hash, role) VALUES('مصمم غير مصرح له', $1, $2, 'dummy', 'DESIGNER') RETURNING id, name, role",
      [`other_des_p4_${testId}@gpack.sa`, phone3]
    );
    const otherDesigner = otherDesRes.rows[0];

    // Create sessions
    const desSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
      [desSessionId, designer.id, designer.name, designer.email]
    );
    const designerCookie = `gpack_session=${desSessionId}`;

    const otherDesSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
      [otherDesSessionId, otherDesigner.id, otherDesigner.name, otherDesigner.email]
    );
    const otherDesignerCookie = `gpack_session=${otherDesSessionId}`;

    // Create Project
    const projRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status, description, brief) VALUES('مشروع علب عطور لافندر فاخرة', $1, $2, 'IN_DESIGN', 'وصف المشروع', 'موجز فني مفصل') RETURNING id, name, status",
      [client.id, designer.id]
    );
    const projectId = projRes.rows[0].id;

    // Client session
    const portalSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', $4, now() + interval '7 days')",
      [portalSessionId, client.id, projectId, client.name]
    );
    const clientCookie = `gpack_portal=${portalSessionId}`;

    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const validPng = Buffer.concat([pngMagic, Buffer.alloc(100)]);

    // --- STEP 1: Designer creates/submits Version 1 with Option A and Option B ---
    const v1Form = new FormData();
    v1Form.append('notes', 'الإصدار الأول بخيارين مقترحين للعلبة');
    v1Form.append('options', 'الخيار A, الخيار B');
    v1Form.append('option_0', new Blob([validPng], { type: 'image/png' }), 'perfume_box_a_v1.png');
    v1Form.append('option_1', new Blob([validPng], { type: 'image/png' }), 'perfume_box_b_v1.png');

    const v1Res = await fetch(`${BASE_URL}/api/projects/${projectId}/versions`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: v1Form
    });
    assert.equal(v1Res.status, 201, 'Designer version upload must succeed');
    const v1Data = await v1Res.json();
    assert.equal(v1Data.number, 1, 'Version number must be 1');

    const v1Options = (await pool.query('SELECT * FROM design_options WHERE version_id=$1 ORDER BY id', [v1Data.id])).rows;
    assert.equal(v1Options.length, 2, 'V1 must have 2 options');
    const optA1 = v1Options[0];
    const optB1 = v1Options[1];

    // Project status transitions to WAITING_FOR_CLIENT
    const pAfterV1 = (await pool.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0];
    assert.equal(pAfterV1.status, 'WAITING_FOR_CLIENT');

    // --- STEP 2: Client receives V1 in portal and requests revision on Option B only ---
    const portalData1 = await (await fetch(`${BASE_URL}/api/portal/${projectId}`, { headers: { Cookie: clientCookie } })).json();
    assert.equal(portalData1.versions.length, 1);
    assert.equal(portalData1.versions[0].options.length, 2);

    // Client submits revision request on Option B with Voice Note + Text Note
    const revForm = new FormData();
    revForm.append('version_id', String(v1Data.id));
    revForm.append('option_id', String(optB1.id));
    revForm.append('request', 'يرجى تعديل شعار الخيار B إلى اللون الذهبي المطفأ وجعل الخط أرفع');
    revForm.append('duration', '14');
    revForm.append('audio', new Blob([Buffer.from('RIFF....WAVE')], { type: 'audio/webm' }), 'client_voice_rev.webm');

    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.equal(revRes.status, 201, 'Client revision request with voice note must succeed');
    const revData = await revRes.json();

    // Verify Backend State Machine & 409 Conflict Protection on Duplicate Revision
    const dupRevRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.equal(dupRevRes.status, 409, 'Duplicate revision request must be rejected with 409 Conflict');

    // Verify version transition to REVISION_REQUESTED
    const v1AfterRev = (await pool.query('SELECT status FROM versions WHERE id=$1', [v1Data.id])).rows[0];
    assert.equal(v1AfterRev.status, 'REVISION_REQUESTED');

    // --- STEP 3: Designer Workspace Inspection ---
    // Designer fetches project data
    const desProjRes = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
      headers: { Cookie: designerCookie }
    });
    assert.equal(desProjRes.status, 200);
    const desProjData = await desProjRes.json();

    // Verify Designer clearly receives all required details:
    // - project identity
    assert.equal(desProjData.project.id, projectId);
    assert.equal(desProjData.project.name, 'مشروع علب عطور لافندر فاخرة');
    // - revisions list
    assert.equal(desProjData.revisions.length, 1);
    const revItem = desProjData.revisions[0];
    // - source version & option
    assert.equal(revItem.version_number, 1);
    assert.equal(revItem.version_id, v1Data.id);
    assert.equal(revItem.option_id, optB1.id);
    assert.ok(revItem.option_name === 'الخيار B' || revItem.option_name === 'B', 'Option name must identify Option B');
    // - client note & voice attachment
    assert.equal(revItem.request, 'يرجى تعديل شعار الخيار B إلى اللون الذهبي المطفأ وجعل الخط أرفع');
    assert.ok(revItem.file_url, 'Revision voice note must have accessible file_url');
    assert.ok(revItem.file_url.startsWith('/api/files/'));

    // Verify Files list in Designer Workspace contains client voice note
    const clientFiles = desProjData.files.filter(f => f.uploaded_by_type === 'CLIENT');
    assert.ok(clientFiles.length >= 1, 'Client files must be available to designer');
    const voiceFile = clientFiles.find(f => f.id === revItem.file_id);
    assert.ok(voiceFile, 'Voice file must exist in files collection');

    // --- STEP 4: Designer creates V2 with multiple options (A and B) ---
    const v2Form = new FormData();
    v2Form.append('notes', 'الإصدار الثاني - تم تعديل الخيار B وفق الملاحظات');
    v2Form.append('options', 'الخيار A, الخيار B');
    v2Form.append('option_0', new Blob([validPng], { type: 'image/png' }), 'perfume_box_a_v2.png');
    v2Form.append('option_1', new Blob([validPng], { type: 'image/png' }), 'perfume_box_b_v2.png');

    const v2Res = await fetch(`${BASE_URL}/api/projects/${projectId}/versions`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: v2Form
    });
    assert.equal(v2Res.status, 201);
    const v2Data = await v2Res.json();
    assert.equal(v2Data.number, 2);

    const v2Options = (await pool.query('SELECT * FROM design_options WHERE version_id=$1 ORDER BY id', [v2Data.id])).rows;
    const optA2 = v2Options[0];
    const optB2 = v2Options[1];

    // --- STEP 5: Strict Multi-Option Lineage in Portal ---
    const portalData2 = await (await fetch(`${BASE_URL}/api/portal/${projectId}`, { headers: { Cookie: clientCookie } })).json();
    const versions = portalData2.versions || [];
    const revisions = portalData2.revisions || [];

    function computeItemLineage(v, opt) {
      if (v.number <= 1) return null;
      const prevVer = versions.find(prev => prev.number === v.number - 1);
      if (!prevVer) return null;
      function fmtOpt(name) {
        if (!name) return '';
        const s = String(name).trim();
        return /^الخيار\s+/i.test(s) ? s : `الخيار ${s}`;
      }
      const prevOptNameFormatted = fmtOpt(opt.name);
      const prevRev = revisions.find(r => {
        if (r.version_id !== prevVer.id) return false;
        if (r.option_id) {
          if (r.option_name && fmtOpt(r.option_name) === prevOptNameFormatted) return true;
          const matchedPrevOpt = (prevVer.options || []).find(po => String(po.id) === String(r.option_id));
          if (matchedPrevOpt && fmtOpt(matchedPrevOpt.name) === prevOptNameFormatted) return true;
          return false;
        }
        return (prevVer.options || []).length === 1;
      });
      if (!prevRev) return null;
      const matchedPrevOpt = (prevVer.options || []).find(po => String(po.id) === String(prevRev.option_id));
      const sourceOptionId = prevRev.option_id || (matchedPrevOpt ? matchedPrevOpt.id : null);
      const prevOptName = prevRev.option_name ? fmtOpt(prevRev.option_name) : (matchedPrevOpt ? fmtOpt(matchedPrevOpt.name) : fmtOpt(opt.name));
      return {
        optionName: prevOptName,
        versionNumber: prevVer.number,
        versionId: prevVer.id,
        optionId: sourceOptionId || null,
        revisionId: prevRev.id
      };
    }

    const v2Obj = versions.find(v => v.number === 2);
    const parsedV2Opts = typeof v2Obj.options === 'string' ? JSON.parse(v2Obj.options) : v2Obj.options;
    const v2OptA = parsedV2Opts.find(o => String(o.id) === String(optA2.id)) || parsedV2Opts.find(o => o.name === 'A');
    const v2OptB = parsedV2Opts.find(o => String(o.id) === String(optB2.id)) || parsedV2Opts.find(o => o.name === 'B');

    const lineageA = computeItemLineage(v2Obj, v2OptA);
    const lineageB = computeItemLineage(v2Obj, v2OptB);

    // Strict Invariant: Option A MUST NOT inherit lineage, Option B MUST have lineage to Option B V1
    assert.equal(lineageA, null, 'Unmodified Option A V2 must NOT receive lineage');
    assert.ok(lineageB, 'Option B V2 MUST receive lineage');
    assert.equal(lineageB.versionNumber, 1, 'Lineage target version must be V1');
    assert.equal(lineageB.versionId, v1Data.id, 'Lineage target versionId must be V1 ID');
    assert.equal(lineageB.optionId, optB1.id, 'Lineage target optionId must be exact Option B V1 ID');
    assert.equal(lineageB.optionName, 'الخيار B', 'Lineage target optionName must be Option B');

    // --- STEP 6: Client Approval on Option B V2 ---
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v2Data.id, option_id: optB2.id })
    });
    assert.equal(appRes.status, 200, 'Client approval of Option B V2 must succeed');

    // Verify State Machine 409 Conflict Protection on Duplicate Approve & Revision after Approve
    const dupAppRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v2Data.id, option_id: optB2.id })
    });
    assert.equal(dupAppRes.status, 409, 'Duplicate approve must return 409 Conflict');

    const revAfterAppRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie },
      body: revForm
    });
    assert.equal(revAfterAppRes.status, 409, 'Revision after approval must return 409 Conflict');

    // Verify Project status updated to APPROVED and V2 is approved
    const pApproved = (await pool.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0];
    assert.equal(pApproved.status, 'APPROVED');
    const v2Approved = (await pool.query('SELECT status, approved_option_id FROM versions WHERE id=$1', [v2Data.id])).rows[0];
    assert.equal(v2Approved.status, 'APPROVED');
    assert.equal(String(v2Approved.approved_option_id), String(optB2.id));

    // --- STEP 7: Security & IDOR Verification ---
    // Unassigned designer cannot access project
    const idorDesRes = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
      headers: { Cookie: otherDesignerCookie }
    });
    assert.equal(idorDesRes.status, 403, 'Unassigned designer must get 403 Forbidden');

    // Unassigned designer cannot upload versions
    const idorUploadRes = await fetch(`${BASE_URL}/api/projects/${projectId}/versions`, {
      method: 'POST',
      headers: { Cookie: otherDesignerCookie },
      body: v2Form
    });
    assert.equal(idorUploadRes.status, 403, 'Unassigned designer cannot upload versions (403 Forbidden)');

    // --- STEP 8: Project Closure Enforcement ---
    // Change project status to COMPLETED (should succeed because approved)
    const closeRes = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: { Cookie: designerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    // Designer cannot set status to COMPLETED directly (only ADMIN or allowed roles), check response
    if (closeRes.status === 403) {
      // Create admin session to verify closure
      const adminSessionId = crypto.randomBytes(24).toString('hex');
      const adminUser = (await pool.query("SELECT id, name, email FROM users WHERE role='ADMIN' AND active=true LIMIT 1")).rows[0];
      await pool.query(
        "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'ADMIN', $3, $4, now() + interval '1 day')",
        [adminSessionId, adminUser.id, adminUser.name, adminUser.email]
      );
      const adminCloseRes = await fetch(`${BASE_URL}/api/projects/${projectId}/status`, {
        method: 'PATCH',
        headers: { Cookie: `gpack_session=${adminSessionId}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' })
      });
      assert.equal(adminCloseRes.status, 200, 'Admin can close approved project');
    } else {
      assert.equal(closeRes.status, 200);
    }

    const pFinal = (await pool.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0];
    assert.equal(pFinal.status, 'COMPLETED', 'Project must be cleanly COMPLETED');

  } finally {
    await pool.end();
  }
});
