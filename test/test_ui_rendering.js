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

test('client previous versions bar renders all versions V1..V7 with interactive buttons and active states', () => {
  const versions = [
    { id: 7, number: 7, status: 'PENDING', notes: 'تعديل على الشعار' },
    { id: 6, number: 6, status: 'PENDING', notes: 'خيارات إضافية' },
    { id: 5, number: 5, status: 'PENDING', notes: 'نسخة تجريبية' },
    { id: 4, number: 4, status: 'PENDING', notes: 'إصدار 4' },
    { id: 3, number: 3, status: 'PENDING', notes: 'تعديلات العميل' },
    { id: 2, number: 2, status: 'APPROVED', notes: 'نسخة معتمدة سابقاً' },
    { id: 1, number: 1, status: 'PENDING', notes: 'الإصدار الأول V1' }
  ];

  // Helper simulating the markup generation in clientPortalView
  function renderVersionHistory(vers, activeVerId) {
    const v = vers.find(x => x.id === activeVerId) || vers[0];
    return `<div class="version-history"><span class="version-history-label">النسخ السابقة</span><div class="version-chips-wrap" role="tablist" aria-label="النسخ السابقة">${[...vers].sort((a,b)=>a.number-b.number).map(x=>{
      const isSelected = x.id === v.id;
      const isCur = x.id === vers[0].id;
      const label = isCur ? 'الحالية' : (x.status === 'APPROVED' ? 'معتمدة' : 'سابقة');
      return `<button type="button" class="version-chip ${isSelected?'active is-selected':''} ${x.status==='APPROVED'?'is-approved':''}" onclick="selectClientVersion(${x.id})" aria-pressed="${isSelected}" title="عرض النسخة V${x.number}"><span class="version-chip-num">V${x.number}</span><span class="version-chip-sep">·</span><span class="version-chip-status">${label}</span></button>`;
    }).join('')}</div></div>`;
  }

  // 1. By default, latest version V7 is active
  const htmlLatest = renderVersionHistory(versions, 7);
  assert.ok(htmlLatest.includes('version-chips-wrap'), 'Container must have version-chips-wrap');
  assert.ok(htmlLatest.includes('role="tablist"'));
  // Check all 7 versions exist
  for (let i = 1; i <= 7; i++) {
    assert.ok(htmlLatest.includes(`V${i}`), `Must contain V${i}`);
    assert.ok(htmlLatest.includes(`selectClientVersion(${i})`), `Must have click handler for V${i}`);
  }
  // V7 must be active
  assert.ok(htmlLatest.includes('V7</span><span class="version-chip-sep">·</span><span class="version-chip-status">الحالية</span></button>'));
  assert.ok(htmlLatest.includes('class="version-chip active is-selected " onclick="selectClientVersion(7)"'));

  // V2 must be approved
  assert.ok(htmlLatest.includes('class="version-chip  is-approved" onclick="selectClientVersion(2)"'));
  assert.ok(htmlLatest.includes('V2</span><span class="version-chip-sep">·</span><span class="version-chip-status">معتمدة</span>'));

  // 2. Select previous version V3
  const htmlV3 = renderVersionHistory(versions, 3);
  assert.ok(htmlV3.includes('class="version-chip active is-selected " onclick="selectClientVersion(3)"'), 'V3 must have active state when selected');
  assert.ok(htmlV3.includes('V3</span><span class="version-chip-sep">·</span><span class="version-chip-status">سابقة</span>'));
  assert.ok(!htmlV3.includes('class="version-chip active is-selected " onclick="selectClientVersion(7)"'), 'V7 must not be active when V3 is selected');
});

test('client portal HTML has NO standalone design cards/options/preview and renders in-chat design bubbles', () => {
  const fs = require('fs');
  const appCode = fs.readFileSync('public/app.js', 'utf8');

  // Verify clientPortalView template string does NOT contain removed sections
  assert.ok(!appCode.includes('class="client-design-card"'), 'Must NOT have client-design-card');
  assert.ok(!appCode.includes('class="design-options-selector"'), 'Must NOT have design-options-selector');
  assert.ok(!appCode.includes('class="design-card-main-preview'), 'Must NOT have standalone design-card-main-preview');
  assert.ok(!appCode.includes('خيارات التصميم المتاحة'), 'Must NOT have standalone options header');

  // Verify chat is primary
  assert.ok(appCode.includes('class="client-conversation whatsapp-chat-experience"'), 'Chat must be primary WhatsApp experience');
  assert.ok(appCode.includes('message-design-bubble'), 'Must support message-design-bubble');
  assert.ok(appCode.includes('openDesignLightbox'), 'Must support openDesignLightbox');
  assert.ok(appCode.includes('openRevisionDialog'), 'Must support openRevisionDialog');
  assert.ok(appCode.includes('openApproveDialog'), 'Must support openApproveDialog');
  assert.ok(appCode.includes('طلب تعديل — '), 'Must support structured revision format');
  assert.ok(appCode.includes('تم اعتماد التصميم — '), 'Must support structured approval format');
});

