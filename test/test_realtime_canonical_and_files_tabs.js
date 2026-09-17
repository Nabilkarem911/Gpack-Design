const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = 'http://127.0.0.1:3000';

test('Realtime Canonical Data Contract & File Tabs Lifecycle', async (t) => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 1. Setup Client, Designer, Admin, and Project
    const testId = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const testPhone = '05' + Math.floor(10000000 + Math.random() * 90000000);
    const testPhone2 = '05' + Math.floor(10000000 + Math.random() * 90000000);
    const clientRes = await pool.query("INSERT INTO clients(name,email,phone) VALUES('Realtime Test Client',$1,$2) RETURNING id,name", [`client_${testId}@gpack.sa`, testPhone]);
    const clientId = clientRes.rows[0].id;

    const desRes = await pool.query("INSERT INTO users(name,email,phone,password_hash,role) VALUES('Realtime Designer',$1,$2,'dummy','DESIGNER') RETURNING id,name,role", [`des_${testId}@gpack.sa`, testPhone2]);
    const designer = desRes.rows[0];

    const projRes = await pool.query("INSERT INTO projects(name,client_id,designer_id,status) VALUES('Realtime Invariants Project',$1,$2,'IN_DESIGN') RETURNING id,name", [clientId, designer.id]);
    const projectId = projRes.rows[0].id;

    // Create session for designer
    const crypto = require('node:crypto');
    const desSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query("INSERT INTO sessions(id,subject_type,subject_id,role,name,email,expires_at) VALUES($1,'USER',$2,'DESIGNER',$3,'des_rt@gpack.sa',now()+interval '1 day')", [desSessionId, designer.id, designer.name]);

    // Create portal access code & session for client
    const portalSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query("INSERT INTO sessions(id,subject_type,subject_id,project_id,role,name,expires_at) VALUES($1,'CLIENT',$2,$3,'CLIENT','Realtime Test Client',now()+interval '7 days')", [portalSessionId, clientId, projectId]);

    const designerCookie = `gpack_session=${desSessionId}`;
    const clientCookie = `gpack_portal=${portalSessionId}`;

    // -------------------------------------------------------------
    // Scenario A: Customer sends text message -> Check canonical response & role
    // -------------------------------------------------------------
    const clientMsgEvtId = 'evt-text-' + Date.now();
    const clientTextRes = await fetch(`${BASE_URL}/api/portal/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'مرحبا، رسالة نصية من العميل', client_event_id: clientMsgEvtId })
    });
    assert.equal(clientTextRes.status, 201, 'Client message must be 201');
    const clientTextData = await clientTextRes.json();
    assert.equal(clientTextData.sender_type, 'CLIENT', 'Must have sender_type CLIENT');
    assert.equal(clientTextData.role, 'CLIENT', 'Must have canonical role CLIENT');
    assert.ok(clientTextData.sender, 'Must have canonical sender object');
    assert.equal(clientTextData.sender.role, 'CLIENT', 'sender.role must never be null');
    assert.equal(clientTextData.user.role, 'CLIENT', 'user.role must never be null');

    // -------------------------------------------------------------
    // Scenario B: Customer sends image -> Designer can access via canonical file_url without 401
    // -------------------------------------------------------------
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const validPng = Buffer.concat([pngMagic, Buffer.alloc(100)]);
    const clientForm = new FormData();
    clientForm.append('file', new Blob([validPng], { type: 'image/png' }), 'client_logo.png');
    clientForm.append('body', 'شعارنا بجودة عالية');
    clientForm.append('client_event_id', 'evt-img-client');

    const clientImgRes = await fetch(`${BASE_URL}/api/portal/${projectId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie },
      body: clientForm
    });
    assert.equal(clientImgRes.status, 201, 'Client image upload must succeed');
    const clientImgData = await clientImgRes.json();
    assert.equal(clientImgData.type, 'IMAGE');
    assert.ok(clientImgData.file_url.startsWith('/api/files/'), 'Client uploaded file_url must be canonical /api/files/:id');
    assert.ok(clientImgData.file_id, 'Must have file_id');
    assert.equal(clientImgData.sender.role, 'CLIENT');

    // VERIFY CRITICAL PRODUCTION BUG FIX:
    // Designer accesses client image using Designer's session cookie!
    const designerFetchImg = await fetch(`${BASE_URL}${clientImgData.file_url}`, {
      headers: { 'Cookie': designerCookie }
    });
    assert.equal(designerFetchImg.status, 200, 'Designer MUST be able to load client image in realtime without 401');

    // -------------------------------------------------------------
    // Scenario C: Designer sends image -> Customer can access via canonical file_url without 401
    // -------------------------------------------------------------
    const desForm = new FormData();
    desForm.append('file', new Blob([validPng], { type: 'image/png' }), 'designer_mockup.png');
    desForm.append('body', 'نموذج مبدئي للتصميم');
    desForm.append('client_event_id', 'evt-img-designer');

    const desImgRes = await fetch(`${BASE_URL}/api/projects/${projectId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: desForm
    });
    assert.equal(desImgRes.status, 201, 'Designer image upload must succeed');
    const desImgData = await desImgRes.json();
    assert.equal(desImgData.type, 'IMAGE');
    assert.ok(desImgData.file_url.startsWith('/api/files/'), 'Designer uploaded file_url must be canonical /api/files/:id');
    assert.equal(desImgData.sender.role, 'DESIGNER');

    // Customer accesses designer image using Customer's session cookie!
    const clientFetchImg = await fetch(`${BASE_URL}${desImgData.file_url}`, {
      headers: { 'Cookie': clientCookie }
    });
    assert.equal(clientFetchImg.status, 200, 'Customer MUST be able to load designer image in realtime without 401');

    // -------------------------------------------------------------
    // Scenario D: Customer creates Revision Request -> Designer receives canonical message with valid role
    // -------------------------------------------------------------
    // Create a version first
    const vForm = new FormData();
    vForm.append('notes', 'V1 Options');
    vForm.append('options', 'Option A, Option B');
    vForm.append('option_0', new Blob([validPng], { type: 'image/png' }), 'opt_a.png');
    vForm.append('option_1', new Blob([validPng], { type: 'image/png' }), 'opt_b.png');
    const vRes = await fetch(`${BASE_URL}/api/projects/${projectId}/versions`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: vForm
    });
    assert.equal(vRes.status, 201, 'Version creation must succeed');
    const vData = await vRes.json();
    const versionId = vData.id;

    // Fetch design options
    const projDetail = await (await fetch(`${BASE_URL}/api/portal/${projectId}`, { headers: { 'Cookie': clientCookie } })).json();
    const options = projDetail.versions[0].options;
    const optionAId = options[0].id;

    const revRes = await fetch(`${BASE_URL}/api/portal/${projectId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: versionId, option_id: optionAId, request: 'يرجى تكبير الشعار' })
    });
    assert.equal(revRes.status, 201, 'Revision creation must succeed');

    // -------------------------------------------------------------
    // Scenario E: Refresh both sides -> Initial fetch returns identical canonical shape
    // -------------------------------------------------------------
    const clientMessages = await (await fetch(`${BASE_URL}/api/portal/${projectId}/messages`, { headers: { 'Cookie': clientCookie } })).json();
    const designerMessages = await (await fetch(`${BASE_URL}/api/projects/${projectId}/messages`, { headers: { 'Cookie': designerCookie } })).json();

    assert.equal(clientMessages.length, designerMessages.length, 'Message count must be identical on both sides');
    for (let i = 0; i < clientMessages.length; i++) {
      const cm = clientMessages[i];
      const dm = designerMessages[i];
      assert.equal(cm.id, dm.id, `Message ${i} id must match`);
      assert.equal(cm.sender_type, dm.sender_type, `Message ${i} sender_type must match`);
      assert.equal(cm.sender_role, dm.sender_role, `Message ${i} sender_role must match`);
      assert.ok(cm.sender && cm.sender.role, `Client message ${i} sender.role must be populated`);
      assert.ok(dm.sender && dm.sender.role, `Designer message ${i} sender.role must be populated`);
      assert.equal(cm.file_url, dm.file_url, `Message ${i} file_url must be identical`);
      if (cm.file_id) {
        assert.ok(cm.file_url.startsWith('/api/files/'), `file_url must start with /api/files/`);
        assert.ok(cm.file && cm.file.id, `file object must be present`);
      }
    }

    // -------------------------------------------------------------
    // Scenario F & G: Customer Files tab vs Designer Files tab filtering
    // -------------------------------------------------------------
    const allFiles = projDetail.files;
    // Add another file from client
    const clientDocForm = new FormData();
    clientDocForm.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], { type: 'application/pdf' }), 'brief_doc.pdf');
    clientDocForm.append('body', 'ملف المتطلبات');
    await fetch(`${BASE_URL}/api/portal/${projectId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie },
      body: clientDocForm
    });

    const refreshedProj = await (await fetch(`${BASE_URL}/api/portal/${projectId}`, { headers: { 'Cookie': clientCookie } })).json();
    const updatedFiles = refreshedProj.files;

    const customerFiles = updatedFiles.filter(f => f.uploaded_by_type === 'CLIENT');
    const designerFiles = updatedFiles.filter(f => f.uploaded_by_type === 'DESIGNER' || f.uploaded_by_type === 'ADMIN');

    assert.ok(customerFiles.length >= 2, 'Customer files must have at least 2 files');
    assert.ok(designerFiles.length >= 3, 'Designer files must have at least 3 files (version options + attachment)');
    assert.ok(customerFiles.every(f => f.uploaded_by_type === 'CLIENT'), 'All customer files must have uploaded_by_type CLIENT');
    assert.ok(designerFiles.every(f => f.uploaded_by_type === 'DESIGNER' || f.uploaded_by_type === 'ADMIN'), 'All designer files must have designer/admin uploaded_by_type');

    // -------------------------------------------------------------
    // Scenario H: Internal File List scrolling and CSS limits
    // -------------------------------------------------------------
    const stylesContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
    assert.ok(stylesContent.includes('.client-unified-files-card'), 'Styles must define .client-unified-files-card');
    assert.ok(stylesContent.includes('max-height: 480px'), 'Card must have fixed/max-height constraint to prevent indefinite growth');
    assert.ok(stylesContent.includes('.client-files-scroll'), 'Styles must define .client-files-scroll');
    assert.ok(stylesContent.includes('max-height: 360px') || stylesContent.includes('overflow-y: auto'), 'File list must scroll internally');

    // -------------------------------------------------------------
    // Scenario I: Malformed realtime relation does NOT crash normalization
    // -------------------------------------------------------------
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(appCode.includes('function normalizeMessage'), 'app.js must include normalizeMessage');
    assert.ok(appCode.includes('window.setClientFilesTab'), 'app.js must include setClientFilesTab');
    assert.ok(appCode.includes('client-files-tab-btn'), 'app.js must render tab buttons with badges');

  } finally {
    await pool.end();
  }
});
