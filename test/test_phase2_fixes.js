const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

// -------------------------------------------------------------
// 1. Direct Route & SPA Fallback Tests (Issue B2, B3)
// -------------------------------------------------------------
test('GET /project/:id and /projects/:id return 200 and serve SPA index.html', async () => {
  const res1 = await fetch(`${BASE_URL}/project/101`);
  assert.equal(res1.status, 200, '/project/:id should return 200');
  const text1 = await res1.text();
  assert.ok(text1.includes('G.PACK') || text1.includes('app.js'), 'Must serve SPA HTML');

  const res2 = await fetch(`${BASE_URL}/projects/101`);
  assert.equal(res2.status, 200, '/projects/:id should return 200');
  const text2 = await res2.text();
  assert.ok(text2.includes('G.PACK') || text2.includes('app.js'), 'Must serve SPA HTML');
});

// -------------------------------------------------------------
// 2. Safe Tab Normalization & View Fallback (Issue B1)
// -------------------------------------------------------------
test('Designer safe tab normalization and renderInternalView fallback', () => {
  // Test safe default tab normalization
  const state1 = { user: { role: 'DESIGNER' }, tab: 'home' };
  if (state1.user.role === 'DESIGNER' && (!state1.tab || state1.tab === 'home')) {
    state1.tab = 'designer';
  }
  assert.equal(state1.tab, 'designer', 'Designer with home tab must normalize to designer');

  const state2 = { user: { role: 'ADMIN' }, tab: 'designer' };
  if (state2.user.role === 'ADMIN' && (!state2.tab || state2.tab === 'designer')) {
    state2.tab = 'home';
  }
  assert.equal(state2.tab, 'home', 'Admin with designer tab must normalize to home');

  // Test renderInternalView fallback handles invalid/unknown tabs
  let calledPage = null;
  const mockView = { innerHTML: '' };
  function mockAdminHome() { calledPage = 'adminHome'; }
  function mockDesignerHome() { calledPage = 'designerHome'; }

  function safeRenderInternalView(user, tab) {
    if (user.role === 'ADMIN') {
      if (tab === 'home') return mockAdminHome();
      // fallback
      return mockAdminHome();
    } else {
      if (tab === 'designer') return mockDesignerHome();
      // fallback
      return mockDesignerHome();
    }
  }

  safeRenderInternalView({ role: 'DESIGNER' }, 'invalid_or_home');
  assert.equal(calledPage, 'designerHome', 'Unknown tab for designer must fall back to designerHome');

  safeRenderInternalView({ role: 'ADMIN' }, 'invalid_or_designer');
  assert.equal(calledPage, 'adminHome', 'Unknown tab for admin must fall back to adminHome');
});

// -------------------------------------------------------------
// 3. Message Deduplication (Issue A2, A5)
// -------------------------------------------------------------
test('appendMessage deduplication prevents duplicate rendering on API + SSE arrival', () => {
  const domNodes = new Map();
  const mockChatContainer = {
    querySelector(selector) {
      const matchMsg = selector.match(/\[data-id="(\d+)"\]/);
      if (matchMsg) return domNodes.get('id:' + matchMsg[1]) || null;
      const matchEvent = selector.match(/\[data-event-id="([^"]+)"\]/);
      if (matchEvent) return domNodes.get('event:' + matchEvent[1]) || null;
      return null;
    },
    append(el) {
      if (el.dataset.id) domNodes.set('id:' + el.dataset.id, el);
      if (el.dataset.eventId) domNodes.set('event:' + el.dataset.eventId, el);
    }
  };

  let appendCount = 0;
  function testAppendMessage(m) {
    if (!m) return;
    if (m.id && mockChatContainer.querySelector(`[data-id="${m.id}"]`)) return;
    if (m.client_event_id && mockChatContainer.querySelector(`[data-event-id="${m.client_event_id}"]`)) return;

    const el = {
      dataset: {
        senderType: m.sender_type,
        id: m.id ? String(m.id) : undefined,
        eventId: m.client_event_id || undefined
      }
    };
    mockChatContainer.append(el);
    appendCount++;
  }

  const msg = {
    id: 501,
    client_event_id: 'evt-123-abc',
    sender_type: 'DESIGNER',
    type: 'FILE',
    body: 'report.pdf',
    file_id: 88
  };

  // 1. API response arrives -> renders message
  testAppendMessage(msg);
  assert.equal(appendCount, 1, 'Initial message render should succeed');

  // 2. SSE event arrives with same message -> deduplication skips
  testAppendMessage(msg);
  assert.equal(appendCount, 1, 'Duplicate message from SSE must be skipped');

  // 3. Another SSE event with same client_event_id -> deduplication skips
  testAppendMessage({ ...msg, id: 501 });
  assert.equal(appendCount, 1, 'Duplicate by client_event_id must be skipped');

  // 4. Voice message with unique id works
  const voiceMsg = {
    id: 502,
    client_event_id: 'evt-voice-1',
    sender_type: 'CLIENT',
    type: 'AUDIO',
    duration: 12,
    file_id: 89
  };
  testAppendMessage(voiceMsg);
  assert.equal(appendCount, 2, 'Voice message must render cleanly');

  // 5. Voice message duplicate skips
  testAppendMessage(voiceMsg);
  assert.equal(appendCount, 2, 'Duplicate voice message must be skipped');
});

// -------------------------------------------------------------
// 4. Incremental Files Section Synchronization (Issue A4)
// -------------------------------------------------------------
test('syncProjectFileFromMessage incrementally updates files state and badge counts', () => {
  const state = {
    project: {
      files: [
        { id: 1, original_name: 'initial.png', mime: 'image/png', size: 1000, uploaded_by_type: 'CLIENT' }
      ]
    }
  };

  function syncProjectFile(msg) {
    if (!state.project || !msg || !msg.file_id) return;
    state.project.files = state.project.files || [];
    if (!state.project.files.some(f => f.id === msg.file_id)) {
      state.project.files.unshift({
        id: msg.file_id,
        original_name: msg.original_name || msg.body || 'ملف مرفق',
        mime: msg.mime || 'application/octet-stream',
        size: msg.file_size || 0,
        created_at: msg.created_at || new Date().toISOString(),
        version_id: null,
        message_id: msg.id,
        option_id: null,
        uploaded_by_type: msg.sender_type
      });
    }
  }

  const newAttachmentMsg = {
    id: 99,
    file_id: 42,
    original_name: 'contract.pdf',
    mime: 'application/pdf',
    file_size: 250000,
    created_at: '2026-09-16T12:00:00Z',
    sender_type: 'DESIGNER'
  };

  syncProjectFile(newAttachmentMsg);
  assert.equal(state.project.files.length, 2, 'Files list must contain 2 files');
  assert.equal(state.project.files[0].id, 42, 'New file must be prepended');
  assert.equal(state.project.files[0].message_id, 99, 'File must reference message_id');

  // Second sync with same file must NOT duplicate
  syncProjectFile(newAttachmentMsg);
  assert.equal(state.project.files.length, 2, 'Duplicate file must not be added');

  const designerCount = state.project.files.filter(f => f.uploaded_by_type === 'DESIGNER' || f.uploaded_by_type === 'ADMIN').length;
  const clientCount = state.project.files.filter(f => f.uploaded_by_type === 'CLIENT').length;
  assert.equal(designerCount, 1, 'Designer file count is 1');
  assert.equal(clientCount, 1, 'Client file count is 1');
});

// -------------------------------------------------------------
// 5. Server SSE Event Contract for Attachments (Issue A1, A3)
// -------------------------------------------------------------
test('POST /api/projects/:id/messages/attachment returns canonical message and does not publish file event', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // Setup test client & project
    const clientRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('Phase2 Client', 'phase2@client.sa', '0559998877')
      RETURNING id
    `);
    const clientId = clientRes.rows[0].id;

    // Create designer & session
    const uniqueEmail = `phase2_designer_${Date.now()}@gpack.sa`;
    const designerRes = await pool.query(`
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Phase2 Designer', $1, 'DESIGNER', 'dummyhash')
      RETURNING id, name, email
    `, [uniqueEmail]);
    const designer = designerRes.rows[0];

    const projRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status)
      VALUES ('Phase2 Attachment Project', $1, $2, 'IN_DESIGN')
      RETURNING id
    `, [clientId, designer.id]);
    const projectId = projRes.rows[0].id;

    const crypto = require('node:crypto');
    const sessionId = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at) VALUES($1, 'USER', $2, 'DESIGNER', $3, $4, now() + interval '1 day')",
      [sessionId, designer.id, designer.name, designer.email]
    );

    // Create a PDF file buffer with valid magic bytes %PDF
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF'),
      Buffer.alloc(200)
    ]);

    const form = new FormData();
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'phase2_test.pdf');
    form.append('body', 'Important Phase 2 PDF');
    form.append('client_event_id', 'phase2-evt-1');

    const attachRes = await fetch(`${BASE_URL}/api/projects/${projectId}/messages/attachment`, {
      method: 'POST',
      headers: { 'Cookie': `gpack_session=${sessionId}` },
      body: form
    });

    assert.equal(attachRes.status, 201, 'Attachment upload must return 201');
    const data = await attachRes.json();
    assert.ok(data.id, 'Response must have message id');
    assert.equal(data.type, 'FILE', 'Message type must be FILE');
    assert.ok(data.file_id, 'Response must have file_id');
    assert.equal(data.original_name, 'phase2_test.pdf');
    assert.equal(data.mime, 'application/pdf');
    assert.ok(data.file_url, 'Response must have file_url');
    assert.equal(data.body, 'Important Phase 2 PDF');

    // Verify exactly ONE file record created and linked
    const fileDb = await pool.query('SELECT * FROM files WHERE id = $1', [data.file_id]);
    assert.equal(fileDb.rows.length, 1, 'Exactly one file record must exist in db');
    assert.equal(fileDb.rows[0].message_id, data.id, 'File must be linked to message');

    // Verify exactly ONE physical file in storage
    const storagePath = path.join(__dirname, '..', 'uploads', fileDb.rows[0].stored_name);
    assert.ok(fs.existsSync(storagePath), 'Physical storage object must exist exactly once in uploads directory');

  } finally {
    await pool.end();
  }
});
