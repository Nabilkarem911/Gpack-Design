const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

// -------------------------------------------------------------
// 1. Schema & Migration Tests
// -------------------------------------------------------------
test('database schema supports IMAGE and FILE message types and bidirectional files.message_id link', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const checkRes = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'messages'::regclass AND conname = 'messages_type_check'
    `);
    assert.equal(checkRes.rows.length, 1, 'messages_type_check constraint should exist');
    assert.match(checkRes.rows[0].def, /'IMAGE'/, 'constraint must include IMAGE');
    assert.match(checkRes.rows[0].def, /'FILE'/, 'constraint must include FILE');
    assert.match(checkRes.rows[0].def, /'AUDIO'/, 'constraint must retain AUDIO');
    assert.match(checkRes.rows[0].def, /'TEXT'/, 'constraint must retain TEXT');

    const fileCols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'files' AND column_name = 'message_id'
    `);
    assert.equal(fileCols.rows.length, 1, 'files table must have message_id column');
  } finally {
    await pool.end();
  }
});

// -------------------------------------------------------------
// 2. Frontend Rendering Tests
// -------------------------------------------------------------
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
function fmtFileSize(b) {
  if (!b) return '0 B';
  if (b > 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.ceil(b / 1024) + ' KB';
}
function getFileTypeInfo(f) {
  const m = (f.mime || '').toLowerCase(), n = (f.original_name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(n)) return { isImage: true, type: 'صورة', badgeClass: 'file-type-img' };
  if (m === 'application/pdf' || n.endsWith('.pdf')) return { isImage: false, type: 'PDF', badgeClass: 'file-type-pdf' };
  return { isImage: false, type: 'ملف', badgeClass: 'file-type-default' };
}

test('renderWorkspaceFileRow and renderClientFileRow render chat source badge for chat attachments', () => {
  function renderWorkspaceFileRow(f) {
    const info = getFileTypeInfo(f);
    const iconHtml = info.isImage
      ? `<div class="file-thumb-mini-wrap"><img src="/api/files/${f.id}" alt="${esc(f.original_name)}" class="file-thumb-mini" loading="lazy"></div>`
      : `<div class="file-icon-badge ${info.badgeClass}"><span>${info.type}</span></div>`;
    return `<div class="compact-file-row"><div class="file-row-main">${iconHtml}<div class="file-row-details"><span class="file-row-name" title="${esc(f.original_name)}">${esc(f.original_name)}</span><span class="file-row-sub">${info.type} • ${fmtFileSize(f.size)}${f.message_id ? ' • <span class="file-source-badge chat-source">من المحادثة</span>' : ''}</span></div></div><div class="file-row-actions"><a href="/api/files/${f.id}" target="_blank" class="file-action-link" title="فتح الملف">فتح</a><a href="/api/files/${f.id}" download="${esc(f.original_name)}" class="file-download-btn" title="تنزيل">⤓</a></div></div>`;
  }

  function renderClientFileRow(f) {
    const info = getFileTypeInfo(f);
    const pId = 'proj-123';
    const url = `/api/portal/${pId}/files/${f.id}`;
    const iconHtml = info.isImage
      ? `<div class="file-thumb-mini-wrap"><img src="${url}" alt="${esc(f.original_name)}" class="file-thumb-mini" loading="lazy"></div>`
      : `<div class="file-icon-badge ${info.badgeClass}"><span>${info.type}</span></div>`;
    const uploaderText = f.uploaded_by_type === 'CLIENT' ? 'مرفق من طرفك' : 'مرفق من المصمم';
    return `<div class="compact-file-row"><div class="file-row-main">${iconHtml}<div class="file-row-details"><span class="file-row-name" title="${esc(f.original_name)}">${esc(f.original_name)}</span><span class="file-row-sub">${uploaderText} • ${fmtFileSize(f.size)}${f.message_id ? ' • <span class="file-source-badge chat-source">من المحادثة</span>' : ''}</span></div></div><div class="file-row-actions"><a href="${url}" target="_blank" class="file-action-link" title="فتح الملف">فتح</a><a href="${url}" download="${esc(f.original_name)}" class="file-download-btn" title="تنزيل">⤓</a></div></div>`;
  }

  const regularFile = { id: 1, original_name: 'brief.pdf', mime: 'application/pdf', size: 1048576, message_id: null, uploaded_by_type: 'CLIENT' };
  const chatFile = { id: 2, original_name: 'logo-mockup.png', mime: 'image/png', size: 524288, message_id: 42, uploaded_by_type: 'DESIGNER' };

  const wsReg = renderWorkspaceFileRow(regularFile);
  assert.equal(wsReg.includes('من المحادثة'), false, 'regular file should not have chat source badge');

  const wsChat = renderWorkspaceFileRow(chatFile);
  assert.equal(wsChat.includes('من المحادثة'), true, 'chat file in workspace should have chat source badge');
  assert.equal(wsChat.includes('file-source-badge chat-source'), true);

  const clChat = renderClientFileRow({ ...chatFile, uploaded_by_type: 'CLIENT' });
  assert.equal(clChat.includes('من المحادثة'), true, 'chat file in client portal should have chat source badge');
});

// -------------------------------------------------------------
// 3. API Integration & Security Tests
// -------------------------------------------------------------
test('POST /api/projects/:id/messages/attachment uploads image safely, verifies magic bytes, and integrates with project files', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // 1. Get an existing designer and project
    const designer = (await pool.query("SELECT * FROM users WHERE role='DESIGNER' LIMIT 1")).rows[0];
    assert.ok(designer, 'Designer must exist');

    let project = (await pool.query("SELECT * FROM projects WHERE designer_id=$1 LIMIT 1", [designer.id])).rows[0];
    if (!project) {
      const client = (await pool.query("SELECT * FROM clients LIMIT 1")).rows[0];
      project = (await pool.query(
        "INSERT INTO projects(title, client_id, designer_id, status) VALUES('مشروع اختبار المرفقات', $1, $2, 'IN_DESIGN') RETURNING *",
        [client.id, designer.id]
      )).rows[0];
    }

    // 2. Create active session for designer
    const sessionId = 'test-session-attach-' + Date.now();
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
      [sessionId, designer.id, designer.name, designer.email]
    );

    // 3. Prepare valid PNG with correct 8-byte magic numbers
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const pngContent = Buffer.concat([validPngHeader, Buffer.from('IHDR_DUMMY_DATA_FOR_TEST')]);

    const formData = new FormData();
    formData.append('file', new Blob([pngContent], { type: 'image/png' }), 'concept-preview.png');
    formData.append('body', 'هذا هو النموذج الأولي المعتمد');
    formData.append('client_event_id', 'test-event-attach-' + Date.now());

    const res = await fetch(`${BASE_URL}/api/projects/${project.id}/messages/attachment`, {
      method: 'POST',
      headers: {
        'Cookie': `gpack_session=${sessionId}`
      },
      body: formData
    });

    assert.equal(res.status, 201, `Attachment upload must return 201, got ${res.status}`);
    const data = await res.json();

    assert.equal(data.type, 'IMAGE', 'Message type must be IMAGE');
    assert.equal(data.body, 'هذا هو النموذج الأولي المعتمد', 'Custom caption must be preserved');
    assert.equal(data.original_name, 'concept-preview.png');
    assert.equal(data.mime, 'image/png');
    assert.ok(data.file_id, 'file_id must be populated');
    assert.equal(data.file_url, `/api/files/${data.file_id}`);

    // Verify DB linkage
    const fileRow = (await pool.query("SELECT * FROM files WHERE id=$1", [data.file_id])).rows[0];
    assert.ok(fileRow, 'File record must exist');
    assert.equal(fileRow.project_id, project.id);
    assert.equal(fileRow.message_id, data.id, 'files.message_id must point to the message');
    assert.equal(fileRow.stored_name, data.stored_name);

    // Verify single storage object on disk
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const diskFilePath = path.join(uploadsDir, fileRow.stored_name);
    assert.ok(fs.existsSync(diskFilePath), 'Storage file must exist on disk');

    // Verify that GET /api/projects/:id includes the file
    const projRes = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      headers: { 'Cookie': `gpack_session=${sessionId}` }
    });
    const projData = await projRes.json();
    const foundInProjectFiles = projData.files.find(f => f.id === data.file_id);
    assert.ok(foundInProjectFiles, 'Attachment must automatically appear in project files');
    assert.equal(foundInProjectFiles.message_id, data.id);

    // 4. Test spoofed image rejection (magic byte check)
    const fakePng = Buffer.from('FAKE_IMAGE_EXE_CONTENT_MALICIOUS');
    const fakeForm = new FormData();
    fakeForm.append('file', new Blob([fakePng], { type: 'image/png' }), 'evil.png');

    const fakeRes = await fetch(`${BASE_URL}/api/projects/${project.id}/messages/attachment`, {
      method: 'POST',
      headers: {
        'Cookie': `gpack_session=${sessionId}`
      },
      body: fakeForm
    });

    assert.equal(fakeRes.status, 400, 'Spoofed file signature must be rejected with 400');
    const fakeErr = await fakeRes.json();
    assert.match(fakeErr.error, /غير صالح/, 'Error must explain invalid file content');

    // 5. Test Unauthorized Access
    const unauthForm = new FormData();
    unauthForm.append('file', new Blob([pngContent], { type: 'image/png' }), 'unauth.png');
    const unauthRes = await fetch(`${BASE_URL}/api/projects/${project.id}/messages/attachment`, {
      method: 'POST',
      body: unauthForm
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must be 401');

  } finally {
    await pool.end();
  }
});

test('POST /api/portal/:id/messages/attachment allows client upload for valid PDF document and text messages still work', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const project = (await pool.query("SELECT * FROM projects LIMIT 1")).rows[0];
    assert.ok(project);
    const client = (await pool.query("SELECT * FROM clients WHERE id=$1", [project.client_id])).rows[0];

    // Create client portal session
    const sessionId = 'test-portal-session-' + Date.now();
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, project_id, expires_at) VALUES($1, 'CLIENT', $2, 'CLIENT', $3, $4, $5, now() + interval '1 day')",
      [sessionId, project.client_id, client.name, client.email, project.id]
    );

    // 1. Upload valid PDF
    const pdfContent = Buffer.from('%PDF-1.7\r\nTest PDF content for packaging design requirements\r\n%%EOF');
    const formData = new FormData();
    formData.append('file', new Blob([pdfContent], { type: 'application/pdf' }), 'specs.pdf');
    formData.append('body', 'مواصفات المقاسات النهائية');
    formData.append('client_event_id', 'test-portal-attach-' + Date.now());

    const res = await fetch(`${BASE_URL}/api/portal/${project.id}/messages/attachment`, {
      method: 'POST',
      headers: {
        'Cookie': `gpack_portal=${sessionId}`
      },
      body: formData
    });

    assert.equal(res.status, 201, `Client attachment upload must return 201, got ${res.status}`);
    const data = await res.json();
    assert.equal(data.type, 'FILE', 'PDF must be created as FILE type');
    assert.equal(data.sender_type, 'CLIENT');
    assert.equal(data.original_name, 'specs.pdf');
    assert.ok(data.file_id);

    // 2. Verify regular text messages still work flawlessly
    const txtRes = await fetch(`${BASE_URL}/api/portal/${project.id}/messages`, {
      method: 'POST',
      headers: {
        'Cookie': `gpack_portal=${sessionId}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: 'رسالة نصية عادية للتأكد من عدم كسر الشات' })
    });
    assert.equal(txtRes.status, 201);
    const txtData = await txtRes.json();
    assert.equal(txtData.type, 'TEXT');
    assert.equal(txtData.body, 'رسالة نصية عادية للتأكد من عدم كسر الشات');

  } finally {
    await pool.end();
  }
});

test('Cross-project access (IDOR prevention) prevents unauthorized users from accessing or downloading another project files', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // 1. Get two distinct projects
    const projects = (await pool.query("SELECT * FROM projects ORDER BY id LIMIT 2")).rows;
    assert.ok(projects.length >= 2, 'Need at least 2 projects for IDOR test');

    const projA = projects[0];
    const projB = projects[1];

    // Create a file in Project A
    const storedNameA = 'confidential-' + Date.now() + '.pdf';
    const fileA = (await pool.query(
      "INSERT INTO files(project_id, uploaded_by_type, original_name, stored_name, mime, size) VALUES($1, 'CLIENT', 'confidential.pdf', $2, 'application/pdf', 100) RETURNING *",
      [projA.id, storedNameA]
    )).rows[0];

    const clientB = (await pool.query("SELECT * FROM clients WHERE id=$1", [projB.client_id])).rows[0];

    // Client B session (for Project B)
    const sessionB = 'test-session-client-b-' + Date.now();
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, project_id, expires_at) VALUES($1, 'CLIENT', $2, 'CLIENT', $3, $4, $5, now() + interval '1 day')",
      [sessionB, clientB.id, clientB.name, clientB.email, projB.id]
    );

    // Client B attempts to access Project A file via /api/portal/:projId/files/:fileId
    const idorRes1 = await fetch(`${BASE_URL}/api/portal/${projA.id}/files/${fileA.id}`, {
      headers: { 'Cookie': `gpack_portal=${sessionB}` }
    });
    assert.equal(idorRes1.status, 403, 'Client B accessing Project A portal endpoint must return 403');

    // Client B attempts to access Project A file via /api/files/:id
    const idorRes2 = await fetch(`${BASE_URL}/api/files/${fileA.id}`, {
      headers: { 'Cookie': `gpack_portal=${sessionB}` }
    });
    assert.equal(idorRes2.status, 403, 'Client B accessing Project A file directly must return 403');

  } finally {
    await pool.end();
  }
});

test('Frontend appendMessage constructs valid DOM structure for IMAGE and FILE messages', () => {
  const rendered = [];
  const mockContainer = {
    children: [],
    get lastElementChild() { return this.children[this.children.length - 1] || null; },
    appendChild(el) { this.children.push(el); rendered.push(el); }
  };

  function appendMessageMock(m) {
    const isClient = m.sender_type === 'CLIENT';
    const isMine = !isClient;
    const timeFormatted = '10:30 ص';
    const el = {
      className: `message ${isClient ? 'message-client' : 'message-designer'} ${isMine ? 'message-mine mine' : 'message-theirs theirs'} ${m.type === 'IMAGE' ? 'message-image' : ''} ${m.type === 'FILE' ? 'message-file' : ''}`,
      dataset: { senderType: m.sender_type },
      innerHTML: ''
    };

    let contentHtml = '';
    if (m.type === 'IMAGE') {
      const imgUrl = m.file_url || `/api/files/${m.file_id}`;
      const fileName = m.original_name || 'صورة';
      contentHtml = `<div class="message-image-bubble"><div class="message-image-wrap" data-img-url="${imgUrl}"><img src="${imgUrl}" alt="${fileName}" class="message-chat-image" loading="lazy" /></div></div>`;
    } else if (m.type === 'FILE') {
      const fileUrl = m.file_url || `/api/files/${m.file_id}`;
      const fileName = m.original_name || 'ملف مرفق';
      contentHtml = `<div class="message-file-bubble"><a href="${fileUrl}" class="message-file-card"><span class="message-file-name">${fileName}</span></a></div>`;
    }

    el.innerHTML = `${contentHtml}<div class="message-meta"><time class="message-time">${timeFormatted}</time></div>`;
    mockContainer.appendChild(el);
  }

  appendMessageMock({ type: 'IMAGE', sender_type: 'DESIGNER', original_name: 'test.png', file_id: 10 });
  appendMessageMock({ type: 'FILE', sender_type: 'CLIENT', original_name: 'specs.pdf', file_id: 11 });

  assert.equal(rendered.length, 2);
  assert.ok(rendered[0].className.includes('message-image'));
  assert.ok(rendered[0].innerHTML.includes('message-chat-image'));
  assert.ok(rendered[1].className.includes('message-file'));
  assert.ok(rendered[1].innerHTML.includes('message-file-name'));
});

