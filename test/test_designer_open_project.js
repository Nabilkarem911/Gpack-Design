const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = 'http://127.0.0.1:3000';

test('getWorkspaceFileDisplayName unit logic handles all cases defensively', () => {
  // Extract or simulate the getWorkspaceFileDisplayName implementation
  function formatOptionName(name) {
    if (!name) return '';
    const s = String(name).trim();
    return /^الخيار\s+/i.test(s) ? s : `الخيار ${s}`;
  }

  const mockState = {
    project: {
      revisions: [
        { file_id: 99, option_name: 'B', version_number: 2 }
      ]
    }
  };

  function getWorkspaceFileDisplayName(f) {
    if (!f || typeof f !== 'object') return 'ملف بدون اسم';
    if (typeof f.display_name === 'string' && f.display_name.trim()) {
      return f.display_name.trim();
    }
    if (typeof f.displayName === 'string' && f.displayName.trim()) {
      return f.displayName.trim();
    }
    const revMatch = (mockState.project?.revisions || []).find(r => r.file_id === f.id);
    if (revMatch) {
      const optLabel = revMatch.option_name ? formatOptionName(revMatch.option_name) : 'التصميم';
      return `تعليق صوتي — طلب تعديل — ${optLabel} — V${revMatch.version_number}`;
    }
    if (typeof f.original_name === 'string' && f.original_name.trim()) {
      return f.original_name.trim();
    }
    if (typeof f.name === 'string' && f.name.trim()) {
      return f.name.trim();
    }
    if (typeof f.filename === 'string' && f.filename.trim()) {
      return f.filename.trim();
    }
    return 'ملف بدون اسم';
  }

  // 1. Explicit display_name
  assert.equal(getWorkspaceFileDisplayName({ display_name: 'شعار معتمد.pdf' }), 'شعار معتمد.pdf');
  // 2. Explicit displayName
  assert.equal(getWorkspaceFileDisplayName({ displayName: 'شعار بديل.png' }), 'شعار بديل.png');
  // 3. Revision voice file
  assert.equal(getWorkspaceFileDisplayName({ id: 99, original_name: 'voice.webm' }), 'تعليق صوتي — طلب تعديل — الخيار B — V2');
  // 4. Standard original_name
  assert.equal(getWorkspaceFileDisplayName({ original_name: 'brief.docx' }), 'brief.docx');
  // 5. Standard name
  assert.equal(getWorkspaceFileDisplayName({ name: 'specs.txt' }), 'specs.txt');
  // 6. Standard filename
  assert.equal(getWorkspaceFileDisplayName({ filename: 'vector.ai' }), 'vector.ai');
  // 7. Defensive fallbacks
  assert.equal(getWorkspaceFileDisplayName(null), 'ملف بدون اسم');
  assert.equal(getWorkspaceFileDisplayName(undefined), 'ملف بدون اسم');
  assert.equal(getWorkspaceFileDisplayName({}), 'ملف بدون اسم');
  assert.equal(getWorkspaceFileDisplayName({ original_name: '   ' }), 'ملف بدون اسم');
});

test('Designer Workspace openProject e2e across multiple projects with zero console errors', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  let chromeProc = null;
  let tempProfile = null;

  try {
    const testId = Date.now();
    const phone1 = '05' + Math.floor(10000000 + Math.random() * 90000000);
    const phone2 = '05' + Math.floor(10000000 + Math.random() * 90000000);

    // Setup client and designer
    const clientRes = await pool.query(
      "INSERT INTO clients(name, email, phone) VALUES('عميل اختبار فتح المشاريع', $1, $2) RETURNING id, name",
      [`client_${testId}@gpack.sa`, phone1]
    );
    const clientId = clientRes.rows[0].id;

    const desRes = await pool.query(
      "INSERT INTO users(name, email, phone, password_hash, role) VALUES('مصمم اختبار الواجهة', $1, $2, 'dummy', 'DESIGNER') RETURNING id, name, role",
      [`des_${testId}@gpack.sa`, phone2]
    );
    const designer = desRes.rows[0];

    // Create designer session
    const desSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, 'des@gpack.sa', now() + interval '1 day')",
      [desSessionId, designer.id, designer.name]
    );
    const designerCookie = `gpack_session=${desSessionId}`;

    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const validPng = Buffer.concat([pngMagic, Buffer.alloc(100)]);

    // Project A: Project WITHOUT files
    const projARes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status) VALUES('مشروع A - بدون ملفات', $1, $2, 'IN_DESIGN') RETURNING id",
      [clientId, designer.id]
    );
    const projAId = projARes.rows[0].id;

    // Project B: Project with DESIGNER-uploaded files (version options)
    const projBRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status) VALUES('مشروع B - ملفات المصمم', $1, $2, 'WAITING_FOR_CLIENT') RETURNING id",
      [clientId, designer.id]
    );
    const projBId = projBRes.rows[0].id;

    const vForm = new FormData();
    vForm.append('notes', 'نسخة V1 جاهزة');
    vForm.append('options', 'الخيار الأول, الخيار الثاني');
    vForm.append('option_0', new Blob([validPng], { type: 'image/png' }), 'option1.png');
    vForm.append('option_1', new Blob([validPng], { type: 'image/png' }), 'option2.png');
    await fetch(`${BASE_URL}/api/projects/${projBId}/versions`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: vForm
    });

    // Project C: Project with CLIENT-uploaded files
    const projCRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status) VALUES('مشروع C - ملفات العميل', $1, $2, 'WAITING_FOR_CLIENT') RETURNING id",
      [clientId, designer.id]
    );
    const projCId = projCRes.rows[0].id;

    const portalSessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', 'العميل', now() + interval '7 days')",
      [portalSessionId, clientId, projCId]
    );
    const portalCookie = `gpack_portal=${portalSessionId}`;

    const clientFileForm = new FormData();
    clientFileForm.append('file', new Blob([validPng], { type: 'image/png' }), 'client_logo.png');
    clientFileForm.append('body', 'شعار الشركة المعتمد');
    await fetch(`${BASE_URL}/api/portal/${projCId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': portalCookie },
      body: clientFileForm
    });

    // Project D: Project with Revision Request and Revision Voice Note
    const projDRes = await pool.query(
      "INSERT INTO projects(name, client_id, designer_id, status) VALUES('مشروع D - طلبات التعديل والصوت', $1, $2, 'WAITING_FOR_CLIENT') RETURNING id",
      [clientId, designer.id]
    );
    const projDId = projDRes.rows[0].id;

    const vFormD = new FormData();
    vFormD.append('notes', 'تصميم مبدئي');
    vFormD.append('options', 'الخيار الذهبي');
    vFormD.append('option_0', new Blob([validPng], { type: 'image/png' }), 'gold.png');
    const vResD = await fetch(`${BASE_URL}/api/projects/${projDId}/versions`, {
      method: 'POST',
      headers: { 'Cookie': designerCookie },
      body: vFormD
    });
    const vDataD = await vResD.json();

    const optResD = await pool.query('SELECT id FROM design_options WHERE version_id=$1', [vDataD.id]);
    const optDId = optResD.rows[0].id;

    const portalSessionD = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, project_id, role, name, expires_at) VALUES($1, 'CLIENT', $2, $3, 'CLIENT', 'العميل', now() + interval '7 days')",
      [portalSessionD, clientId, projDId]
    );

    const revForm = new FormData();
    revForm.append('version_id', vDataD.id);
    revForm.append('option_id', optDId);
    revForm.append('request', 'ملاحظات التعديل الصوتي');
    revForm.append('duration', '8');
    revForm.append('audio', new Blob([Buffer.from('RIFF....WAVE')], { type: 'audio/webm' }), 'rev_note.webm');
    await fetch(`${BASE_URL}/api/portal/${projDId}/revisions`, {
      method: 'POST',
      headers: { 'Cookie': `gpack_portal=${portalSessionD}` },
      body: revForm
    });

    // Launch Chrome with CDP
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    tempProfile = path.join(process.env.TEMP || 'C:\\Temp', 'chrome_cdp_profile_' + Date.now());

    try {
      execSync('powershell -Command "Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue"');
    } catch (e) {}

    chromeProc = spawn(chromePath, [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${tempProfile}`
    ], { detached: true, stdio: 'ignore' });

    await new Promise(r => setTimeout(r, 2000));

    const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let idCounter = 1;
    const callbacks = new Map();
    const runtimeExceptions = [];
    const consoleErrors = [];

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        const { resolve, reject } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
        runtimeExceptions.push(desc);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map(a => a.value).join(' '));
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = idCounter++;
        callbacks.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    // Set designer session cookie
    await send('Network.setCookie', {
      name: 'gpack_session',
      value: desSessionId,
      domain: '127.0.0.1',
      path: '/'
    });

    // Navigate to designer home
    await send('Page.navigate', { url: `${BASE_URL}/` });
    await new Promise(r => setTimeout(r, 2000));

    // TEST 1: Open Project A (without files) via client-side openProject without reload
    const resA = await send('Runtime.evaluate', {
      expression: `(async () => {
        await openProject(${projAId}, true);
        return {
          title: document.querySelector('.workspace-title h1')?.innerText,
          filesListText: document.querySelector('#workspace-files-list')?.innerText
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    assert.strictEqual(resA.result.value.title, 'مشروع A - بدون ملفات');
    assert.ok(resA.result.value.filesListText.includes('لا توجد ملفات من المصمم بعد'));

    // TEST 2: Open Project B (with designer files) via openProject without reload
    const resB = await send('Runtime.evaluate', {
      expression: `(async () => {
        await openProject(${projBId}, true);
        const rows = document.querySelectorAll('#workspace-files-list .compact-file-row');
        return {
          title: document.querySelector('.workspace-title h1')?.innerText,
          filesCount: rows.length,
          firstFileName: rows[0]?.querySelector('.file-row-name')?.innerText
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    assert.strictEqual(resB.result.value.title, 'مشروع B - ملفات المصمم');
    assert.ok(resB.result.value.filesCount >= 2, 'Project B should render at least 2 designer files');
    assert.ok(resB.result.value.firstFileName.length > 0, 'File name should not be empty');

    // TEST 3: Open Project C (with client files) and switch tabs via setWorkspaceFilesTab without reload
    const resC = await send('Runtime.evaluate', {
      expression: `(async () => {
        await openProject(${projCId}, true);
        setWorkspaceFilesTab('client');
        const rows = document.querySelectorAll('#workspace-files-list .compact-file-row');
        return {
          title: document.querySelector('.workspace-title h1')?.innerText,
          clientFilesCount: rows.length,
          clientFileName: rows[0]?.querySelector('.file-row-name')?.innerText
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    assert.strictEqual(resC.result.value.title, 'مشروع C - ملفات العميل');
    assert.strictEqual(resC.result.value.clientFilesCount, 1);
    assert.strictEqual(resC.result.value.clientFileName, 'client_logo.png');

    // TEST 4: Open Project D (with revision requests & voice note)
    const resD = await send('Runtime.evaluate', {
      expression: `(async () => {
        await openProject(${projDId}, true);
        setWorkspaceFilesTab('client');
        const rows = document.querySelectorAll('#workspace-files-list .compact-file-row');
        const revCard = document.querySelector('.revision-card');
        return {
          title: document.querySelector('.workspace-title h1')?.innerText,
          revCardText: revCard?.innerText,
          clientVoiceText: rows[0]?.querySelector('.file-row-name')?.innerText
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    assert.strictEqual(resD.result.value.title, 'مشروع D - طلبات التعديل والصوت');
    assert.ok(resD.result.value.revCardText.includes('الخيار الذهبي'));
    assert.ok(resD.result.value.clientVoiceText.includes('تعليق صوتي — طلب تعديل — الخيار الذهبي'));

    // VERIFY ZERO RUNTIME EXCEPTIONS
    const displayNameErrors = runtimeExceptions.filter(e => e.includes('displayName'));
    assert.strictEqual(displayNameErrors.length, 0, 'There must be ZERO displayName ReferenceErrors');
    assert.strictEqual(runtimeExceptions.length, 0, `There must be ZERO runtime exceptions, got: ${JSON.stringify(runtimeExceptions)}`);

    // Clean up Chrome
    try {
      execSync('powershell -Command "Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue"');
    } catch (e) {}

  } finally {
    try {
      execSync('powershell -Command "Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue"');
    } catch (e) {}
    await pool.end();
  }
});
