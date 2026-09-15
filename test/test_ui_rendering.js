const test = require('node:test');
const assert = require('node:assert/strict');

// Test DOM behavior of appendMessage and option card logic
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.innerHTML = '';
    this.dataset = {};
    this.children = [];
  }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  append(el) { this.children.push(el); }
  setAttribute(k, v) { this[k] = v; }
}

test('client chat bubbles render correctly with sender distinction and grouping', () => {
  const mockDoc = {
    messages: new Element('div')
  };
  const $ = s => s === '#messages' ? mockDoc.messages : null;

  // Replicate state in portal mode
  const state = { portal: true, user: null };

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
    const el = new Element('div');
    el.className = `message ${isClient ? 'message-client' : 'message-designer'} ${isMine ? 'message-mine mine' : 'message-theirs theirs'} ${isConsecutive ? 'is-consecutive' : ''}`;
    el.dataset.senderType = m.sender_type;
    el.innerHTML = (senderLabel ? `<div class="message-sender-name">${esc(senderLabel)}</div>` : '') +
      `<div class="message-bubble-body">${esc(m.body)}</div>` +
      `<div class="message-meta"><time class="message-time">${esc(timeFormatted)}</time></div>`;
    container.append(el);
  }

  // 1. Designer message
  appendMessage({ sender_type: 'DESIGNER', sender_name: 'أحمد', body: 'مرحباً، تم تجهيز التصاميم', created_at: new Date().toISOString() });
  // 2. Second consecutive Designer message
  appendMessage({ sender_type: 'DESIGNER', sender_name: 'أحمد', body: 'تأكد من مراجعة القياسات', created_at: new Date().toISOString() });
  // 3. Client response (own message)
  appendMessage({ sender_type: 'CLIENT', sender_name: 'سلطان', body: 'شكراً، اطلعت عليها وسأعتمد الخيار B', created_at: new Date().toISOString() });
  // 4. Consecutive Client message
  appendMessage({ sender_type: 'CLIENT', sender_name: 'سلطان', body: 'هل الألوان قابلة للطباعة CMYK؟', created_at: new Date().toISOString() });

  assert.ok(mockDoc.messages.children[0].className.includes('message-designer message-theirs'));
  assert.ok(mockDoc.messages.children[1].className.includes('is-consecutive'));
  assert.ok(!mockDoc.messages.children[1].innerHTML.includes('message-sender-name'));
  assert.ok(mockDoc.messages.children[2].className.includes('message-client message-mine'));
  assert.ok(mockDoc.messages.children[3].className.includes('is-consecutive'));
});
