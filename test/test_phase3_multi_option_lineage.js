const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

test('Phase 3: Multi-Option Lineage Precision & Mobile Polish (Tests A-E)', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    // Invariants Check
    assert.ok(stylesCss.includes('white-space: nowrap !important;'), 'styles.css must have white-space: nowrap on file badges');
    assert.ok(appJs.includes('scrollToDesignMessage(${dItem.revisedFrom.versionId}, ${dItem.revisedFrom.optionId'), 'appendDesignBubble must pass both versionId and optionId');
    assert.ok(appJs.includes('Phase 3: Option-Strict'), 'app.js must contain Phase 3 Option-Strict logic');

    // 1. Setup Test Client & Project
    const ts = Date.now();
    const cRes = await pool.query(
      "INSERT INTO clients(name, email, phone) VALUES($1, $2, $3) RETURNING id, name",
      [`Client_P3_${ts}`, `c_p3_${ts}@gpack.sa`, `055${String(ts).slice(-7)}`]
    );
    const client = cRes.rows[0];

    const dRes = await pool.query("SELECT id FROM users WHERE role='DESIGNER' AND active=true LIMIT 1");
    const designerId = dRes.rows[0].id;

    const pRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status, description) VALUES($1, $2, $3, 'WAITING_FOR_CLIENT', 'Phase 3 Lineage Project') RETURNING id, name",
      [`Project_P3_${ts}`, client.id, designerId]
    );
    const projectId = pRes.rows[0].id;

    const clientSid = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', $4, now()+interval '1 hour')",
      [clientSid, client.id, projectId, client.name]
    );
    const clientCookie = `gpack_portal=${clientSid}`;

    // Test A & C: Setup V8 with Option A and Option B
    const v8Res = await pool.query(
      "INSERT INTO versions(project_id, number, status, notes, uploaded_by) VALUES($1, 8, 'PENDING', 'V8 Multi-Option', $2) RETURNING id",
      [projectId, designerId]
    );
    const v8Id = v8Res.rows[0].id;

    const optA8Res = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'A', 'PROPOSED') RETURNING id", [v8Id]);
    const optB8Res = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'B', 'PROPOSED') RETURNING id", [v8Id]);
    const optA8Id = optA8Res.rows[0].id;
    const optB8Id = optB8Res.rows[0].id;

    // Client requests revision on Option B ONLY
    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: v8Id,
        option_id: optB8Id,
        request: 'طلب تعديل مخصص للخيار B فقط'
      })
    });
    assert.equal(revRes.status, 201, 'Revision on Option B must succeed');
    const revData = await revRes.json();

    // Test D: Add an older historical revision to project from an unrelated version to ensure "latest revision" is NOT used
    const v7Res = await pool.query(
      "INSERT INTO versions(project_id, number, status, notes, uploaded_by) VALUES($1, 7, 'REVISION_REQUESTED', 'V7 Historical', $2) RETURNING id",
      [projectId, designerId]
    );
    const v7Id = v7Res.rows[0].id;
    await pool.query(
      "INSERT INTO revisions(project_id, client_id, version_id, request, duration) VALUES($1, $2, $3, 'طلب قديم على V7', 10)",
      [projectId, client.id, v7Id]
    );

    // Designer uploads V9 with Option A and Option B
    const v9Res = await pool.query(
      "INSERT INTO versions(project_id, number, status, notes, uploaded_by) VALUES($1, 9, 'PENDING', 'V9 Multi-Option', $2) RETURNING id",
      [projectId, designerId]
    );
    const v9Id = v9Res.rows[0].id;

    const optA9Res = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'A', 'PROPOSED') RETURNING id", [v9Id]);
    const optB9Res = await pool.query("INSERT INTO design_options(version_id, name, status) VALUES($1, 'B', 'PROPOSED') RETURNING id", [v9Id]);
    const optA9Id = optA9Res.rows[0].id;
    const optB9Id = optB9Res.rows[0].id;

    // Fetch portal data to verify Lineage mapping logic
    const portalRes = await fetch(`${BASE_URL}/api/portal/${projectId}`, {
      headers: { Cookie: clientCookie }
    });
    assert.equal(portalRes.status, 200);
    const portalData = await portalRes.json();

    // Replicate the exact client loadPortalMessages logic to verify Test A, C, D
    const versions = portalData.versions || [];
    const revisions = portalData.revisions || [];
    const latestVer = versions[0];

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

    const v9Obj = versions.find(v => v.number === 9);
    const parsedOptions = typeof v9Obj.options === 'string' ? JSON.parse(v9Obj.options) : (v9Obj.options || []);
    v9Obj.options = parsedOptions;
    const optA9 = parsedOptions.find(o => String(o.id) === String(optA9Id)) || parsedOptions.find(o => o.name === 'A');
    const optB9 = parsedOptions.find(o => String(o.id) === String(optB9Id)) || parsedOptions.find(o => o.name === 'B');

    const lineageA9 = computeItemLineage(v9Obj, optA9);
    const lineageB9 = computeItemLineage(v9Obj, optB9);

    // Test A & C: A · V9 has NO lineage, B · V9 HAS lineage
    assert.equal(lineageA9, null, 'Test A & C: A · V9 MUST NOT have lineage because only Option B was revised');
    assert.ok(lineageB9, 'Test A: B · V9 MUST have lineage');
    assert.equal(lineageB9.optionName, 'الخيار B', 'Test A: Lineage target option must be B');
    assert.equal(lineageB9.versionNumber, 8, 'Test A: Lineage target version must be V8');

    // Test B: Lineage must provide exact sourceOptionId pointing to Option B in V8
    assert.equal(lineageB9.versionId, v8Id, 'Test B: sourceVersionId must point to V8');
    assert.equal(lineageB9.optionId, optB8Id, 'Test B: sourceOptionId must point directly to Option B in V8 (not null or Option A)');

    // Test E: Complete Scenario V8 (A, B) -> Revise B -> V9 (A, B) -> Approve B/V9
    const appRes = await fetch(`${BASE_URL}/api/portal/${projectId}/approve`, {
      method: 'POST',
      headers: { Cookie: clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: v9Id, option_id: optB9Id })
    });
    assert.equal(appRes.status, 200, 'Test E: Client approval on Option B V9 must succeed');

    const pAfterApp = await (await fetch(`${BASE_URL}/api/portal/${projectId}`, { headers: { Cookie: clientCookie } })).json();
    assert.equal(pAfterApp.project.status, 'APPROVED', 'Project status must be APPROVED');
    const v9After = pAfterApp.versions.find(v => v.number === 9);
    assert.equal(v9After.status, 'APPROVED', 'V9 must be APPROVED');
    assert.equal(String(v9After.approved_option_id), String(optB9Id), 'V9 approved_option_id must match Option B');

    // Verify V8 is superseded
    const v8After = pAfterApp.versions.find(v => v.number === 8);
    const isV8Latest = pAfterApp.versions[0].id === v8After.id;
    assert.equal(isV8Latest, false, 'V8 must not be latest');

  } finally {
    await pool.end();
  }
});
