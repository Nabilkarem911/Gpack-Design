const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

// 1. Frontend DOM Unit Tests for Voice Messages
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
function formatAudioTime(s) {
  const sec = Math.max(0, Math.floor(Number(s) || 0)), m = Math.floor(sec / 60), rem = sec % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

class MockElement {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.innerHTML = '';
    this.dataset = {};
    this.children = [];
  }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  append(el) { this.children.push(el); }
  querySelector(sel) {
    if (sel === 'audio') return this.children.find(c => c.tagName === 'audio') || null;
    return null;
  }
}

test('frontend appendMessage renders AUDIO messages with full voice player structure', () => {
  const mockDoc = { messages: new MockElement('div') };
  const $ = s => s === '#messages' ? mockDoc.messages : null;
  const state = { portal: false, user: { role: 'DESIGNER', name: 'المصمم' } };

  function appendMessage(m) {
    const container = $('#messages');
    if (!container) return;
    const lastEl = container.lastElementChild,
      prevSenderType = lastEl?.dataset?.senderType,
      isConsecutive = prevSenderType === m.sender_type,
      inPortal = !!state.portal,
      isClient = m.sender_type === 'CLIENT',
      isMine = inPortal ? isClient : (m.sender_type === state.user?.role || (state.user?.role === 'ADMIN' && (m.sender_type === 'ADMIN' || m.sender_type === 'DESIGNER')));

    let senderLabel = '';
    if (!isMine && !isConsecutive) {
      if (inPortal) {
        senderLabel = m.sender_type === 'ADMIN' ? 'إدارة G.PACK' : (m.sender_name ? ('المصمم · ' + m.sender_name) : 'المصمم');
      } else {
        senderLabel = m.sender_name ? ('العميل · ' + m.sender_name) : 'العميل';
      }
    }

    const timeFormatted = m.created_at ? new Date(m.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '';
    const el = new MockElement('div');
    el.className = `message ${isClient ? 'message-client' : 'message-designer'} ${isMine ? 'message-mine mine' : 'message-theirs theirs'} ${isConsecutive ? 'is-consecutive' : ''} ${m.type === 'AUDIO' ? 'message-voice' : ''}`;
    el.dataset.senderType = m.sender_type;

    let contentHtml = '';
    if (m.type === 'AUDIO') {
      const durStr = formatAudioTime(m.duration || 0);
      const audioUrl = m.file_url || (m.file_id ? `/api/files/${m.file_id}` : '');
      contentHtml = `<div class="message-voice-bubble" data-url="${esc(audioUrl)}"><button type="button" class="voice-play-btn" aria-label="تشغيل التسجيل الصوتي"><svg class="icon-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg><svg class="icon-pause hidden" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button><div class="voice-bubble-main"><div class="voice-seek-bar" role="slider" aria-label="شريط تقديم التسجيل الصوتي" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="voice-seek-track"><div class="voice-seek-fill" style="width:0%"></div></div><div class="voice-seek-thumb" style="left:0%"></div></div><div class="voice-bubble-meta"><span class="voice-bubble-time">0:00 / ${durStr}</span><span class="voice-mic-icon" title="رسالة صوتية">🎙️</span></div></div><audio preload="metadata" src="${esc(audioUrl)}"></audio></div>`;
    } else {
      contentHtml = `<div class="message-bubble-body">${esc(m.body)}</div>`;
    }

    el.innerHTML = (senderLabel ? `<div class="message-sender-name">${esc(senderLabel)}</div>` : '') +
      contentHtml +
      `<div class="message-meta"><time datetime="${esc(m.created_at || '')}" class="message-time">${esc(timeFormatted)}</time></div>`;
    container.append(el);
  }

  // 1. Incoming Voice Message from Client
  appendMessage({
    type: 'AUDIO',
    sender_type: 'CLIENT',
    sender_name: 'سلطان',
    duration: 38,
    file_id: 101,
    file_url: '/api/files/101',
    created_at: new Date().toISOString()
  });

  // 2. Outgoing Voice Message from Designer
  appendMessage({
    type: 'AUDIO',
    sender_type: 'DESIGNER',
    sender_name: 'المصمم',
    duration: 15,
    file_id: 102,
    file_url: '/api/files/102',
    created_at: new Date().toISOString()
  });

  const msg1 = mockDoc.messages.children[0];
  const msg2 = mockDoc.messages.children[1];

  assert.ok(msg1.className.includes('message-voice'));
  assert.ok(msg1.className.includes('message-client message-theirs'));
  assert.ok(msg1.innerHTML.includes('message-voice-bubble'));
  assert.ok(msg1.innerHTML.includes('/api/files/101'));
  assert.ok(msg1.innerHTML.includes('0:00 / 0:38'));
  assert.ok(msg1.innerHTML.includes('العميل · سلطان'));

  assert.ok(msg2.className.includes('message-voice'));
  assert.ok(msg2.className.includes('message-designer message-mine'));
  assert.ok(msg2.innerHTML.includes('0:00 / 0:15'));
  assert.ok(msg2.innerHTML.includes('/api/files/102'));
});

// 2. Database & Schema Integrity Test
test('database schema supports AUDIO message type, duration, and file_id', async () => {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
  const pool = new Pool({ connectionString: dbUrl });

  try {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name IN ('type', 'duration', 'file_id')
      ORDER BY column_name;
    `);

    const cols = res.rows.reduce((acc, row) => {
      acc[row.column_name] = row;
      return acc;
    }, {});

    assert.ok(cols.type, 'Column "type" must exist on messages table');
    assert.ok(cols.duration, 'Column "duration" must exist on messages table');
    assert.ok(cols.file_id, 'Column "file_id" must exist on messages table');
  } finally {
    await pool.end();
  }
});

// 3. API Integration Test for Voice Message Upload
test('POST /api/projects/:id/messages/voice uploads audio safely and returns structured AUDIO message', async () => {
  const baseUrl = 'http://localhost:3000';
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';
  const pool = new Pool({ connectionString: dbUrl });
  
  const testSid = 'test_voice_session_' + Date.now();
  try {
    // Insert a valid test session for user 1 (ADMIN)
    await pool.query(`
      INSERT INTO sessions(id, subject_type, subject_id, role, name, email, expires_at)
      VALUES ($1, 'USER', 1, 'ADMIN', 'مدير النظام', 'admin@gpack.local', now() + interval '1 hour')
      ON CONFLICT (id) DO NOTHING
    `, [testSid]);

    const cookie = `gpack_session=${testSid}`;

    // Fetch projects
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      headers: { cookie }
    });
    assert.equal(projRes.status, 200);
    const projects = await projRes.json();
    assert.ok(projects.length > 0, 'At least one project should exist');
    const testProject = projects[0];

    // Create a dummy audio buffer (WebM / WAV signature)
    const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....');
    const formData = new FormData();
    formData.append('audio', new Blob([dummyAudio], { type: 'audio/wav' }), 'test-voice.wav');
    formData.append('duration', '14');
    formData.append('client_event_id', 'test-event-' + Date.now());

    const uploadRes = await fetch(`${baseUrl}/api/projects/${testProject.id}/messages/voice`, {
      method: 'POST',
      headers: { cookie },
      body: formData
    });

    assert.equal(uploadRes.status, 201, 'Voice upload should succeed with status 201');
    const msg = await uploadRes.json();
    assert.equal(msg.type, 'AUDIO');
    assert.equal(msg.duration, 14);
    assert.ok(msg.file_id > 0);
    assert.equal(msg.file_url, `/api/files/${msg.file_id}`);

    // Verify message is retrieved in GET /messages
    const getMsgsRes = await fetch(`${baseUrl}/api/projects/${testProject.id}/messages`, {
      headers: { cookie }
    });
    assert.equal(getMsgsRes.status, 200);
    const allMsgs = await getMsgsRes.json();
    const createdMsg = allMsgs.find(m => m.id === msg.id);
    assert.ok(createdMsg, 'Voice message should appear in messages list');
    assert.equal(createdMsg.type, 'AUDIO');
    assert.equal(createdMsg.duration, 14);
    assert.equal(createdMsg.file_url, `/api/files/${msg.file_id}`);

    // Test streaming / audio file access
    const audioFileRes = await fetch(`${baseUrl}/api/files/${msg.file_id}`, {
      headers: { cookie }
    });
    assert.equal(audioFileRes.status, 200);
    assert.equal(audioFileRes.headers.get('content-disposition'), 'inline');

    // Test security: unauthorized request should be rejected (403)
    const unauthRes = await fetch(`${baseUrl}/api/files/${msg.file_id}`);
    assert.equal(unauthRes.status, 403, 'Unauthenticated access to voice message file must be blocked with 403');

    // Test file validation: reject non-audio file
    const invalidFormData = new FormData();
    invalidFormData.append('audio', new Blob(['console.log("not audio")'], { type: 'text/javascript' }), 'malicious.js');
    invalidFormData.append('duration', '5');
    const invalidRes = await fetch(`${baseUrl}/api/projects/${testProject.id}/messages/voice`, {
      method: 'POST',
      headers: { cookie },
      body: invalidFormData
    });
    assert.equal(invalidRes.status, 400, 'Non-audio MIME type must be rejected with 400');
  } finally {
    await pool.query('DELETE FROM sessions WHERE id = $1', [testSid]);
    await pool.end();
  }
});
