const $=s=>document.querySelector(s),state={user:null,project:null,portalData:null,stream:null,tab:'home',portal:location.pathname.startsWith('/portal')||location.pathname.startsWith('/c/'),activeProjectId:null};
function openImageLightbox(url, name){
  if(!url)return;
  let box=document.querySelector("#chat-image-lightbox-modal");
  if(!box){
    box=document.createElement("div");
    box.id="chat-image-lightbox-modal";
    box.className="chat-image-lightbox";
    box.innerHTML=`<div class="chat-image-lightbox-backdrop"></div><div class="chat-image-lightbox-content"><div class="chat-image-lightbox-header"><span class="chat-image-lightbox-title"></span><div class="chat-image-lightbox-actions"><a class="chat-image-lightbox-download" href="" target="_blank" download title="تحميل"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a><button type="button" class="chat-image-lightbox-close" title="إغلاق"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div><div class="chat-image-lightbox-body"><img class="chat-image-lightbox-img" src="" alt=""/></div></div>`;
    document.body.appendChild(box);
    box.querySelector(".chat-image-lightbox-backdrop").onclick=()=>box.classList.add("hidden");
    box.querySelector(".chat-image-lightbox-close").onclick=()=>box.classList.add("hidden");
  }
  box.querySelector(".chat-image-lightbox-title").textContent=name||"عرض الصورة";
  const dl=box.querySelector(".chat-image-lightbox-download");
  dl.href=url;dl.setAttribute("download",name||"image");
  const img=box.querySelector(".chat-image-lightbox-img");
  img.src=url;img.alt=name||"";
  box.classList.remove("hidden");
}
function formatOptionName(name){if(!name)return '';const s=String(name).trim();return /^الخيار\s+/i.test(s)?s:`الخيار ${s}`}function getActiveProjectRouteId(){
  const m=location.pathname.match(/\/projects?\/(\d+)/)||location.search.match(/[?&]project=(\d+)/)||location.hash.match(/#project-(\d+)/);
  if(m)return Number(m[1]);
  const s=sessionStorage.getItem("gpack_active_project");
  return s?Number(s):null;
}
function exitProject(){
  closeStream();
  sessionStorage.removeItem("gpack_active_project");
  state.project=null;
  state.activeProjectId=null;
  if(location.pathname!=="/")history.pushState({},"","/");
  renderInternal();
}
function syncProjectFileFromMessage(msg){
  if(!state.project||!msg||!msg.file_id)return;
  state.project.files=state.project.files||[];
  if(!state.project.files.some(f=>f.id===msg.file_id)){
    state.project.files.unshift({
      id:msg.file_id,
      original_name:msg.original_name||msg.body||"ملف مرفق",
      mime:msg.mime||"application/octet-stream",
      size:msg.file_size||0,
      created_at:msg.created_at||new Date().toISOString(),
      version_id:null,
      message_id:msg.id,
      option_id:null,
      uploaded_by_type:msg.sender_type
    });
    const dCount=state.project.files.filter(f=>f.uploaded_by_type==="DESIGNER"||f.uploaded_by_type==="ADMIN").length;
    const cCount=state.project.files.filter(f=>f.uploaded_by_type==="CLIENT").length;
    document.querySelectorAll(".files-tab-btn[data-tab=\"designer\"] .files-count-badge").forEach(b=>b.textContent=dCount);
    document.querySelectorAll(".files-tab-btn[data-tab=\"client\"] .files-count-badge").forEach(b=>b.textContent=cCount);
    const listEl=document.querySelector("#workspace-files-list");
    if(listEl)listEl.innerHTML=renderWorkspaceFilesList(state.project.files,state.workspaceFilesTab||"designer");
  }
}
function syncPortalFileFromMessage(msg){
  if(!state.portalData||!msg||!msg.file_id)return;
  state.portalData.files=state.portalData.files||[];
  if(!state.portalData.files.some(f=>f.id===msg.file_id)){
    state.portalData.files.unshift({
      id:msg.file_id,
      original_name:msg.original_name||msg.body||"ملف مرفق",
      mime:msg.mime||"application/octet-stream",
      size:msg.file_size||0,
      created_at:msg.created_at||new Date().toISOString(),
      version_id:null,
      message_id:msg.id,
      option_id:null,
      uploaded_by_type:msg.sender_type
    });
    const dCount=state.portalData.files.filter(f=>f.uploaded_by_type==="DESIGNER"||f.uploaded_by_type==="ADMIN").length;
    const cCount=state.portalData.files.filter(f=>f.uploaded_by_type==="CLIENT").length;
    document.querySelectorAll(".client-files-tab-btn[data-tab=\"designer\"] .files-count-badge").forEach(b=>b.textContent=dCount);
    document.querySelectorAll(".client-files-tab-btn[data-tab=\"client\"] .files-count-badge").forEach(b=>b.textContent=cCount);
    const listEl=document.querySelector("#client-files-scroll-list");
    if(listEl)listEl.innerHTML=renderClientFilesList(state.portalData.files,state.clientFilesTab||"designer");
  }
}
window.addEventListener("popstate",()=>{
  if(state.portal)return;
  const pid=getActiveProjectRouteId();
  if(pid&&pid!==state.activeProjectId){
    renderInternalShell();
    openProject(pid,false);
  }else if(!pid&&state.activeProjectId){
    closeStream();
    sessionStorage.removeItem("gpack_active_project");
    state.project=null;
    state.activeProjectId=null;
    renderInternal();
  }
});
const statuses={NEW:'بانتظار تعيين مصمم',NEW_TASK:'مهمة جديدة',WAITING_FOR_DESIGNER:'بانتظار تعيين مصمم',IN_DESIGN:'قيد التنفيذ',WAITING_FOR_CLIENT:'بانتظار العميل',REVISION_REQUESTED:'طلب تعديل',APPROVED:'معتمد',COMPLETED:'مكتمل',CANCELLED:'ملغى'};const statusText={NEW:'بانتظار تعيين مصمم',NEW_TASK:'مهمة جديدة — ابدأ التنفيذ',WAITING_FOR_DESIGNER:'بانتظار بدء المصمم',IN_DESIGN:'جاري تجهيز التصميم',WAITING_FOR_CLIENT:'التصميم جاهز للمراجعة',REVISION_REQUESTED:'تم استلام ملاحظاتك',APPROVED:'تم اعتماد التصميم',COMPLETED:'تم إنجاز المشروع',CANCELLED:'المشروع متوقف'};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));const fmt=d=>d?new Date(d).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'}):'—';const ago=d=>{const n=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.floor(n/60000);return m<60?`منذ ${m||1} دقيقة`:m<1440?`منذ ${Math.floor(m/60)} ساعة`:`منذ ${Math.floor(m/1440)} يوم`};const badge=s=>`<span class="status status-${String(s).toLowerCase()}"><i></i>${statuses[s]||esc(s)}</span>`;
async function api(url,opt={}){const headers={...(opt.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(opt.headers||{})};const r=await fetch(url,{...opt,headers,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'حدث خطأ غير متوقع');return d}function toast(text,type=''){$('#toast')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="toast" class="toast ${type}">${esc(text)}</div>`);setTimeout(()=>$('#toast')?.remove(),3200)}function closeStream(){if(state.stream){state.stream.close();state.stream=null}if(state.syncTimer){clearInterval(state.syncTimer);state.syncTimer=null}}function openStream(url,handler){closeStream();let es,closed=false,timer;const connection={close(){closed=true;clearTimeout(timer);es?.close();if(state.stream===connection)state.stream=null}};const connect=()=>{if(closed)return;es=new EventSource(url);state.stream=connection;es.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type!=='connected')handler(x)}catch{}};es.onerror=()=>{es.close();if(!closed)timer=setTimeout(connect,2000)}};connect();return connection}
function login(){closeStream();document.body.innerHTML=`<main class="login"><form class="login-card" id="login-form"><div class="brand brand-large"><img class="brand-image" src="/brand-logo.png" alt="G.PACK"></div><span class="eyebrow">مساحة العمل الإبداعية</span><h1>مرحباً بك</h1><p class="muted">سجّل الدخول لإدارة مشاريعك ومتابعة التصميمات</p><div class="field"><label>البريد الإلكتروني أو رقم الجوال</label><input name="login" type="text" autocomplete="username" required placeholder="name@gpack.sa أو 0551234567"></div><div class="field"><label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-primary btn-block">تسجيل الدخول</button></form></main>`;$('#login-form').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));b.email=b.login;const btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='جار تسجيل الدخول...';try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify(b)});state.token=d.token||null;state.user=d.user;state.tab=state.user.role==='ADMIN'?'home':'designer';render()}catch(x){toast(x.message,'error');btn.disabled=false;btn.textContent='تسجيل الدخول'}}}
function getArabicDateString(){try{const d=new Date(),days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];return`${days[d.getDay()]}، ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`}catch{return'—'}}
function projectThumbnail(p){if(p.thumbnail_id)return`<img src="/api/files/${p.thumbnail_id}" alt="${esc(p.name)}" class="project-thumb-img">`;return`<div class="project-thumb-placeholder"><svg viewBox="0 0 48 48" fill="none"><path d="M24 6L40 15L24 24L8 15L24 6Z" fill="#E8DFEE" stroke="#5A3D63" stroke-width="2" stroke-linejoin="round"/><path d="M8 15V33L24 42V24L8 15Z" fill="#DFCDE8" stroke="#5A3D63" stroke-width="2" stroke-linejoin="round"/><path d="M40 15V33L24 42V24L40 15Z" fill="#F4EEF8" stroke="#5A3D63" stroke-width="2" stroke-linejoin="round"/><path d="M24 24V42" stroke="#5A3D63" stroke-width="2"/><circle cx="24" cy="15" r="2.5" fill="#FFC42B"/></svg></div>`}
function projectStatusBadge(status){const map={NEW_TASK:{label:'مهمة جديدة',class:'status-new-task'},WAITING_FOR_DESIGNER:{label:'بانتظار المصمم',class:'status-waiting-designer'},IN_DESIGN:{label:'قيد التنفيذ',class:'status-in-design'},WAITING_FOR_CLIENT:{label:'بانتظار العميل',class:'status-waiting-client'},REVISION_REQUESTED:{label:'طلب تعديل',class:'status-revision'},APPROVED:{label:'معتمد',class:'status-approved'},COMPLETED:{label:'مكتمل',class:'status-completed'},CANCELLED:{label:'ملغى',class:'status-cancelled'}};const item=map[status]||{label:statuses[status]||status,class:'status-default'};return`<span class="status-pill ${item.class}">${item.label}</span>`}
async function render(){  if(state.portal)return renderPortal();  if(!state.user){try{state.user=(await api('/api/auth/me')).user}catch{login();return}}  if(state.user.role==='DESIGNER'&&(!state.tab||state.tab==='home')){state.tab='designer'}  else if(state.user.role==='ADMIN'&&(!state.tab||state.tab==='designer')){state.tab='home'}  if(state.user.role==='DESIGNER'){try{const notifs=await api('/api/notifications');state.unreadCount=notifs.filter(n=>!n.read_at).length}catch{}}  const pid=getActiveProjectRouteId();  if(pid){    renderInternalShell();    try{await openProject(pid,false)}catch(err){sessionStorage.removeItem('gpack_active_project');if(location.pathname!=='/')history.replaceState({},'','/');state.activeProjectId=null;toast(err.message||'تعذر فتح المشروع','error');renderInternalView()}  }else{renderInternal()}}
function renderInternalShell(){document.body.innerHTML=`<div class="internal-shell"><aside class="internal-sidebar"><div class="brand"><div class="brand-badge"><img class="brand-image" src="/brand-logo.png" alt="G.PACK"></div><span class="brand-name">G.PACK</span></div><div class="workspace-label">مساحة العمل</div><nav>${state.user.role==='ADMIN'?`<button data-tab="home"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><span>نظرة عامة</span></button><button data-tab="projects"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg><span>المشاريع</span></button><button data-tab="clients"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>العملاء</span></button><button data-tab="designers"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg><span>المصممون</span></button><button data-tab="activity"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span>النشاط</span></button>`:`<button data-tab="designer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><span>الرئيسية</span></button><button data-tab="projects"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg><span>تصاميمي</span></button><button data-tab="approved"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15l-2 5 2-1 2 1-2-5"/><circle cx="12" cy="8" r="6"/><path d="m9 8 2 2 4-4"/></svg><span>المعتمدة</span></button><button data-tab="notifications"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span>الإشعارات</span>${state.unreadCount?`<span class="nav-badge" id="nav-notif-count">${state.unreadCount}</span>`:''}</button><button data-tab="account"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg><span>حسابي</span></button>`}</nav><div class="sidebar-bottom"><div class="user-avatar">${esc((state.user.name||'G').slice(0,1))}</div><div class="user-meta"><b>${esc(state.user.name)}</b><small>${state.user.role==='ADMIN'?'مدير النظام':'مصمم'}</small></div><button class="logout-button" onclick="logout()" aria-label="تسجيل الخروج" title="تسجيل الخروج"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg></button></div></aside><main class="internal-main"><div class="top-nav-bar"><div class="top-nav-date"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg><span>${getArabicDateString()}</span></div><button class="top-notif-btn" onclick="state.tab='notifications';renderInternal()" aria-label="الإشعارات" title="الإشعارات"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>${state.unreadCount?'<span class="top-notif-dot"></span>':''}</button></div><div id="internal-view"></div></main></div>`;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===state.tab);b.onclick=()=>{if(state.activeProjectId){closeStream();sessionStorage.removeItem('gpack_active_project');state.project=null;state.activeProjectId=null;if(location.pathname!=='/')history.pushState({},'','/')}state.tab=b.dataset.tab;renderInternal()}});}
function renderInternal(){renderInternalShell();renderInternalView()}
async function renderInternalView(){const v=$('#internal-view');if(!v)return;v.innerHTML='<div class="page-loading"><span></span><span></span><span></span></div>';try{if(state.user.role==='ADMIN'){if(state.tab==='home')return adminHome(v);if(state.tab==='projects')return internalProjects(v);if(state.tab==='clients')return clients(v);if(state.tab==='designers')return designers2(v);if(state.tab==='activity')return activityCenter(v);state.tab='home';return adminHome(v)}else{if(state.tab==='designer')return designerHome(v);if(state.tab==='projects'||state.tab==='waiting')return designerQueue(v);if(state.tab==='approved')return approvedGallery(v);if(state.tab==='notifications')return notificationsPage(v);if(state.tab==='account')return accountPage(v);state.tab='designer';return designerHome(v)}}catch(e){v.innerHTML=`<div class="error-state"><h2>تعذر تحميل الصفحة</h2><p>${esc(e.message)}</p><button class="btn btn-soft" onclick="renderInternalView()">إعادة المحاولة</button></div>`}}
function pageHeader(kicker,title,sub,action=''){return`<header class="page-header"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${sub}</p></div>${action}</header>`}function kpi(label,value,icon,theme=''){return`<div class="kpi ${theme}"><span class="kpi-icon">${icon}</span><div class="kpi-content"><strong class="kpi-val">${value??0}</strong><small class="kpi-label">${label}</small></div></div>`}
async function adminHome(v){const [m,d]=await Promise.all([api('/api/dashboard/metrics'),api('/api/dashboard')]),k=m.kpis;v.innerHTML=`<div class="manager-page-container"><header class="page-header"><div><span class="eyebrow">مركز العمليات</span><h1>نظرة عامة</h1><p>صورة سريعة عن حالة المشاريع والعملاء وفريق التصميم.</p></div><button class="btn btn-primary" onclick="newProject()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>مشروع جديد</span></button></header><section class="kpi-grid manager-kpis">${kpi('المشاريع النشطة',k.active_projects,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>','purple')}${kpi('بانتظار العميل',k.waiting_client,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','gold')}${kpi('طلبات التعديل',k.revision_projects,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>','red')}${kpi('المشاريع المعتمدة',k.approved_projects,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15l-2 5 2-1 2 1-2-5"/><circle cx="12" cy="8" r="6"/><path d="m9 8 2 2 4-4"/></svg>','green')}${kpi('التصميمات المعتمدة',k.approved_versions,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>','blue')}</section><section class="panel attention-panel-v2"><div class="section-heading"><div><h2>يحتاج انتباهك</h2><p class="muted">مشاريع تتطلب المتابعة أو اتخاذ إجراء مباشر</p></div>${m.attention.length?`<span class="attention-count-badge">${m.attention.length} مشروع</span>`:''}</div>${m.attention.length?`<div class="attention-grid-v2">${m.attention.map(managerAttentionItem).join('')}</div>`:`<div class="empty-state-compact"><div class="empty-icon-pill">✨</div><h4>لا توجد عناصر تحتاج إلى انتباهك الآن</h4><p>جميع الأعمال تسير بشكل طبيعي.</p></div>`}</section><div class="dashboard-columns manager-columns"><section class="panel manager-recent-panel"><div class="section-heading"><div><h2>أحدث المشاريع</h2><p class="muted">آخر المشاريع المحدثة والنشطة</p></div><button class="link-button" onclick="state.tab='projects';renderInternal()">عرض الكل ←</button></div>${managerProjectRows(d.projects)}</section><section class="panel manager-activity-panel"><div class="section-heading"><div><h2>آخر النشاطات</h2><p class="muted">تسلسل زمني لأحدث حركات النظام</p></div><button class="link-button" onclick="state.tab='activity';renderInternal()">عرض الكل ←</button></div>${managerActivityRows(d.activity)}</section></div></div>`}function managerAttentionItem(p){const overdue=p.due_date&&new Date(p.due_date)<new Date();const isRev=p.status==='REVISION_REQUESTED';const isWaiting=p.status==='WAITING_FOR_CLIENT';const themeClass=isRev?'attention-red':isWaiting?'attention-gold':'attention-purple';let actionText='';if(isRev) actionText=`طلب تعديل${p.latest_version?' على V'+p.latest_version:''}${p.open_revisions?' ('+p.open_revisions+' طلبات)':''}`;else if(isWaiting) actionText='التصميم بانتظار اعتماد أو مراجعة العميل';else if(p.status==='IN_DESIGN') actionText=`قيد العمل لدى المصمم ${esc(p.designer_name||'')}`;else if(p.status==='NEW_TASK') actionText='مهمة جديدة بانتظار بدء المصمم';else if(p.status==='WAITING_FOR_DESIGNER') actionText='بانتظار إسناد مصمم للمشروع';else actionText='المشروع يحتاج متابعة سير العمل';return `<article class="attention-card-v2 ${themeClass}" onclick="openProject(${p.id})"><div class="attention-card-header"><div class="attention-card-identity"><span class="project-code">DES-${String(p.id).padStart(5,'0')}</span><h3 class="attention-card-title">${esc(p.name)}</h3></div>${projectStatusBadge(p.status)}</div><div class="attention-card-body"><div class="attention-action-line"><span class="attention-indicator"></span><span class="attention-action-text">${actionText}</span>${overdue?'<span class="overdue-tag">متأخر</span>':''}</div><div class="attention-meta-line"><span>العميل: <b>${esc(p.client_name)}</b></span><span class="sep">•</span><span>المصمم: <b>${esc(p.designer_name||'غير مسند')}</b></span></div></div><div class="attention-card-footer"><span class="attention-time">${ago(p.updated_at)}</span><button class="btn btn-soft btn-sm" onclick="event.stopPropagation();openProject(${p.id})">فتح مساحة العمل</button></div></article>`}function managerProjectRows(rows){if(!rows.length) return '<div class="empty-state-compact"><div class="empty-icon-pill">📁</div><h4>لا توجد مشاريع حتى الآن</h4><p>اضغط على "مشروع جديد" لبدء العمل.</p></div>';return `<div class="manager-project-list">${rows.map(p=>`<div class="manager-project-row" onclick="openProject(${p.id})"><div class="manager-project-cell-main"><span class="project-code">DES-${String(p.id).padStart(5,'0')}</span><h4 class="manager-project-name" title="${esc(p.name)}">${esc(p.name)}</h4><div class="manager-project-parties"><span>العميل: <b>${esc(p.client_name)}</b></span><span class="sep">•</span><span>المصمم: <b>${esc(p.designer_name||'غير مسند')}</b></span></div></div><div class="manager-project-cell-status"><span class="version-tag">${p.latest_version?'V'+p.latest_version:'V1'}</span>${projectStatusBadge(p.status)}</div><div class="manager-project-cell-action"><span class="project-time">${ago(p.updated_at)}</span><button class="btn btn-soft btn-sm" onclick="event.stopPropagation();openProject(${p.id})">فتح</button></div></div>`).join('')}</div>`}function managerActivityRows(rows){if(!rows.length) return '<div class="empty-state-compact"><div class="empty-icon-pill">⚡</div><h4>لا توجد أنشطة حديثة</h4><p>ستظهر هنا حركة المشاريع فور حدوثها.</p></div>';return `<div class="manager-activity-list">${rows.map(a=>{const kind=activityKind(a.action);const icon=activityIcon(a.action);return `<div class="manager-activity-item" onclick="openProject(${a.project_id})"><span class="manager-activity-icon ${kind}">${icon}</span><div class="manager-activity-content"><div class="manager-activity-header"><b class="manager-activity-action">${esc(a.action)}</b><time class="manager-activity-time">${ago(a.created_at)}</time></div><p class="manager-activity-details"><span class="project-link">${esc(a.project_name)}</span>${a.details?` — <span class="details-snippet">${esc(a.details)}</span>`:''}</p></div></div>`}).join('')}</div>`}
async function designerHome(v){const d=await api('/api/dashboard/designer'),s=d.stats,firstName=(state.user.name||'').split(' ')[0]||'المصمم';const needs=d.projects.filter(p=>['NEW_TASK','REVISION_REQUESTED','IN_DESIGN','WAITING_FOR_DESIGNER'].includes(p.status));const waiting=d.projects.filter(p=>p.status==='WAITING_FOR_CLIENT');const approved=d.projects.filter(p=>['APPROVED','COMPLETED'].includes(p.status));v.innerHTML=`<div class="dashboard-page-container"><div class="dashboard-greeting"><span class="eyebrow">نظرة عامة</span><h1>صباح الخير، ${esc(firstName)} 👋</h1><p class="muted">إليك ملخص أعمالك وما يحتاج إلى إجراء الآن.</p></div><section class="kpi-grid designer-kpis">${kpi('المشاريع النشطة',s.active||0,'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>','purple')}${kpi('تحتاج إجراء الآن',needs.length,'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','gold')}${kpi('طلبات التعديل',s.revisions||0,'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>','red')}${kpi('المعتمدة',s.approved||s.approved_versions||0,'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15l-2 5 2-1 2 1-2-5"/><circle cx="12" cy="8" r="6"/><path d="m9 8 2 2 4-4"/></svg>','green')}</section><section class="panel action-section"><div class="section-heading"><div><h2>يحتاج إجراء الآن ⚡</h2><p>المشاريع التي تحتاج تدخلك المباشر</p></div><button class="link-button" onclick="state.designsFilter='needs_action';state.tab='projects';renderInternal()">عرض الكل</button></div>${designerActionCards(needs)}</section><section class="panel approved-preview-section"><div class="section-heading"><div><h2>أحدث التصاميم المعتمدة 🏆</h2><p>التصاميم التي تم الانتهاء منها واعتمادها</p></div><button class="link-button" onclick="state.tab='approved';renderInternal()">عرض الكل</button></div>${designerApprovedCards(approved.slice(0,4))}</section></div>`}
function designerActionCards(rows){if(!rows.length)return'<div class="empty-state-compact"><div class="empty-icon-pill">✨</div><h4>لا توجد مهام عاجلة حالياً</h4><p>أنت متابع جميع مشاريعك بشكل ممتاز.</p></div>';const singleClass=rows.length===1?'single-action-card':'';return`<div class="dashboard-cards-grid ${singleClass}">${rows.slice(0,4).map(p=>{const actionBtn=p.status==='REVISION_REQUESTED'?`<button class="btn btn-gold btn-block" onclick="openProject(${p.id})">فتح المهمة</button>`:p.status==='NEW_TASK'?`<button class="btn btn-primary btn-block" onclick="openProject(${p.id})">بدء التنفيذ</button>`:`<button class="btn btn-soft btn-block" onclick="openProject(${p.id})">فتح المشروع</button>`;const note=p.latest_revision_note||p.last_message;return`<article class="action-card"><div class="action-card-top"><div class="action-thumb">${projectThumbnail(p)}</div><div class="action-info"><span class="project-code">DES-${String(p.id).padStart(5,'0')}</span><h3 class="action-title" title="${esc(p.name)}">${esc(p.name)}</h3><div class="action-client-meta"><span class="client-name">${esc(p.client_name)}</span><span class="version-tag">${p.latest_version?'V'+p.latest_version:'V1'}</span></div>${projectStatusBadge(p.status)}</div></div>${note?`<div class="revision-snippet">"${esc(note.slice(0,60))}${note.length>60?'...':''}"</div>`:''}<div class="action-card-footer"><span class="card-time">${ago(p.updated_at)}</span><div class="action-btn-wrap">${actionBtn}</div></div></article>`}).join('')}</div>`}
function designerApprovedCards(rows){if(!rows.length)return'<div class="empty-state-compact"><div class="empty-icon-pill">🏆</div><h4>لا توجد تصاميم معتمدة حتى الآن</h4><p>ستظهر هنا التصاميم المعتمدة فور اعتماد العميل لها.</p></div>';return`<div class="approved-preview-row">${rows.map(p=>`<article class="approved-mini-card" onclick="openProject(${p.id})"><div class="approved-mini-thumb">${projectThumbnail(p)}<span class="verified-pill">✓</span></div><div class="approved-mini-body"><h4>${esc(p.name)}</h4><span class="muted">${esc(p.client_name)} · V${p.latest_version||1}</span></div></article>`).join('')}</div>`}
async function designerQueue(v){state.designsFilter=state.designsFilter||'all';state.designsSearch=state.designsSearch||'';state.designsPage=state.designsPage||1;const rows=await api('/api/projects');state.allDesignerProjects=rows;v.innerHTML=`<div class="designs-page-container"><header class="page-header"><div><span class="eyebrow">مساحة المصمم</span><h1>تصاميمي</h1><p>جميع المشاريع المسندة إليك للتصميم.</p></div></header><div class="designs-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" id="designs-search" placeholder="ابحث باسم المشروع أو العميل..." value="${esc(state.designsSearch)}" oninput="state.designsSearch=this.value;state.designsPage=1;renderDesignsCardsOnly()"></div></div><div class="designs-tabs" id="designs-tabs-bar"></div><section class="designs-list-wrap" id="designs-cards-container"></section><div class="pagination-wrap" id="designs-pagination"></div></div>`;renderDesignsCardsOnly()}
function renderDesignsCardsOnly(){const rows=state.allDesignerProjects||[];const counts={all:rows.length,needs_action:rows.filter(p=>['NEW_TASK','REVISION_REQUESTED','WAITING_FOR_DESIGNER'].includes(p.status)).length,in_design:rows.filter(p=>p.status==='IN_DESIGN').length,waiting_client:rows.filter(p=>p.status==='WAITING_FOR_CLIENT').length,revisions:rows.filter(p=>p.status==='REVISION_REQUESTED').length,approved:rows.filter(p=>['APPROVED','COMPLETED'].includes(p.status)).length};const tabsBar=$('#designs-tabs-bar');if(tabsBar){tabsBar.innerHTML=`<button class="filter-tab ${state.designsFilter==='all'?'active':''}" onclick="setDesignsFilter('all')"><span>الكل</span><span class="tab-count">${counts.all}</span></button><button class="filter-tab ${state.designsFilter==='needs_action'?'active':''}" onclick="setDesignsFilter('needs_action')"><span>تحتاج إجراء</span><span class="tab-count count-gold">${counts.needs_action}</span></button><button class="filter-tab ${state.designsFilter==='in_design'?'active':''}" onclick="setDesignsFilter('in_design')"><span>قيد التنفيذ</span><span class="tab-count">${counts.in_design}</span></button><button class="filter-tab ${state.designsFilter==='waiting_client'?'active':''}" onclick="setDesignsFilter('waiting_client')"><span>بانتظار العميل</span><span class="tab-count">${counts.waiting_client}</span></button><button class="filter-tab ${state.designsFilter==='revisions'?'active':''}" onclick="setDesignsFilter('revisions')"><span>طلبات تعديل</span><span class="tab-count count-red">${counts.revisions}</span></button><button class="filter-tab ${state.designsFilter==='approved'?'active':''}" onclick="setDesignsFilter('approved')"><span>المعتمدة</span><span class="tab-count count-green">${counts.approved}</span></button>`}let filtered=rows.filter(p=>{if(state.designsFilter==='needs_action')return['NEW_TASK','REVISION_REQUESTED','WAITING_FOR_DESIGNER'].includes(p.status);if(state.designsFilter==='in_design')return p.status==='IN_DESIGN';if(state.designsFilter==='waiting_client')return p.status==='WAITING_FOR_CLIENT';if(state.designsFilter==='revisions')return p.status==='REVISION_REQUESTED';if(state.designsFilter==='approved')return['APPROVED','COMPLETED'].includes(p.status);return true});if(state.designsSearch){const q=state.designsSearch.trim().toLowerCase();filtered=filtered.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.client_name||'').toLowerCase().includes(q)||String(p.id).includes(q))}const perPage=6,pages=Math.max(1,Math.ceil(filtered.length/perPage));state.designsPage=Math.min(state.designsPage||1,pages);const paged=filtered.slice((state.designsPage-1)*perPage,state.designsPage*perPage);const container=$('#designs-cards-container');if(container){if(!paged.length){container.innerHTML='<div class="empty-state-compact"><div class="empty-icon-pill">🔍</div><h4>لا توجد مشاريع مطابقة</h4><p>جرّب تغيير التبويب أو تعديل نص البحث.</p></div>'}else{container.innerHTML=paged.map(p=>`<article class="project-list-card"><div class="project-list-thumb">${projectThumbnail(p)}</div><div class="project-list-main"><div class="project-list-meta"><span class="project-code">DES-${String(p.id).padStart(5,'0')}</span><h3 class="project-list-title" title="${esc(p.name)}">${esc(p.name)}</h3><div class="project-list-parties"><span class="client-label">العميل:</span><b>${esc(p.client_name)}</b><span class="sep">•</span><span class="designer-label">المصمم:</span><span>${esc(p.designer_name||state.user.name)}</span></div></div><div class="project-list-status-col"><span class="version-tag">${p.latest_version?'V'+p.latest_version:'V1'}</span>${projectStatusBadge(p.status)}<span class="project-list-time">آخر نشاط: ${ago(p.updated_at)}</span></div><div class="project-list-action-col"><button class="btn btn-primary" onclick="openProject(${p.id})">فتح المشروع</button><details class="action-menu"><summary aria-label="خيارات إضافية">⋮</summary><div><button onclick="openProject(${p.id})">فتح مساحة العمل</button><button onclick="navigator.clipboard.writeText('DES-${String(p.id).padStart(5,'0')}');toast('تم نسخ رمز المشروع')">نسخ رمز المشروع</button></div></details></div></div></article>`).join('')}}const pagWrap=$('#designs-pagination');if(pagWrap){if(pages<=1){pagWrap.innerHTML=''}else{let btns=`<button class="pag-btn" ${state.designsPage<=1?'disabled':''} onclick="setDesignsPage(${state.designsPage-1})">›</button>`;for(let i=1;i<=pages;i++){btns+=`<button class="pag-btn ${i===state.designsPage?'active':''}" onclick="setDesignsPage(${i})">${i}</button>`}btns+=`<button class="pag-btn" ${state.designsPage>=pages?'disabled':''} onclick="setDesignsPage(${state.designsPage+1})">‹</button>`;pagWrap.innerHTML=btns}}}
function setDesignsFilter(filter){state.designsFilter=filter;state.designsPage=1;renderDesignsCardsOnly()}
function setDesignsPage(page){state.designsPage=page;renderDesignsCardsOnly()}
async function approvedGallery(v){const rows=await api('/api/projects?status=APPROVED');const details=await Promise.all(rows.map(async p=>{try{return await api('/api/projects/'+p.id)}catch{return{project:p,versions:[],files:[]}}}));v.innerHTML=`<div class="approved-page-container"><header class="page-header"><div><span class="eyebrow">أرشيف الأعمال</span><h1>المعتمدة</h1><p>التصاميم التي تم اعتمادها وإنهاء العمل عليها.</p></div></header><div class="approved-content-area"><div class="approved-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" id="approved-search" placeholder="ابحث في التصاميم المعتمدة..." oninput="filterApprovedGallery(this.value)"></div><div class="approved-filters-wrap"><select class="select-filter" id="approved-client-filter" onchange="filterApprovedByClient(this.value)"><option value="">كل العملاء</option>${[...new Set(details.map(d=>d.client?.name).filter(Boolean))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div></div><div class="approved-divider"></div><section class="approved-gallery-grid" id="approved-grid">${renderApprovedCards(details)}</section></div></div>`}
function renderApprovedCards(items){if(!items.length)return'<div class="approved-empty-container"><div class="empty-icon-pill empty-icon-large">🏆</div><h4>لا توجد تصاميم معتمدة حتى الآن</h4><p>ستظهر هنا التصاميم بعد اعتماد العميل لها.</p></div>';return items.map(d=>{const ver=d.versions[0],file=ver&&d.files.find(f=>f.version_id===ver.id&&f.mime?.startsWith('image/'));const imgUrl=file?`/api/files/${file.id}`:'';return`<article class="approved-gallery-card" data-name="${esc(d.project.name.toLowerCase())}" data-client="${esc((d.client?.name||'').toLowerCase())}" onclick="openProject(${d.project.id})"><div class="approved-gallery-media">${imgUrl?`<img src="${imgUrl}" alt="${esc(d.project.name)}" loading="lazy">`:projectThumbnail(d.project)}<span class="approved-badge-tag"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>معتمد</span></div><div class="approved-gallery-info"><h3>${esc(d.project.name)}</h3><div class="approved-gallery-meta"><b>${esc(d.client?.name||'')}</b><span class="version-tag">${ver?'V'+ver.number:'—'}</span></div><small class="approved-date">${ver?.approved_at?fmt(ver.approved_at):ago(d.project.updated_at)}</small></div></article>`}).join('')}
function filterApprovedGallery(val){const q=val.toLowerCase().trim();document.querySelectorAll('.approved-gallery-card').forEach(c=>{const match=(c.dataset.name||'').includes(q)||(c.dataset.client||'').includes(q);c.hidden=!match})}
function filterApprovedByClient(client){const c=client.toLowerCase().trim();document.querySelectorAll('.approved-gallery-card').forEach(el=>{const match=!c||(el.dataset.client||'').includes(c);el.hidden=!match})}
async function notificationsPage(v){state.notifFilter=state.notifFilter||'all';const rows=await api('/api/notifications');state.cachedNotifications=rows;v.innerHTML=`<div class="notifications-page-container"><header class="page-header"><div><span class="eyebrow">التنبيهات</span><h1>الإشعارات</h1><p>آخر ما حدث في مشاريعك وتحديثات العملاء.</p></div><button class="btn btn-soft" onclick="markAllNotifsRead()">تحديد الكل كمقروء</button></header><div class="notif-tabs"><button class="filter-tab ${state.notifFilter==='all'?'active':''}" onclick="setNotifFilter('all')">الكل</button><button class="filter-tab ${state.notifFilter==='unread'?'active':''}" onclick="setNotifFilter('unread')">غير المقروء</button><button class="filter-tab ${state.notifFilter==='revisions'?'active':''}" onclick="setNotifFilter('revisions')">طلبات التعديل</button><button class="filter-tab ${state.notifFilter==='projects'?'active':''}" onclick="setNotifFilter('projects')">المشاريع</button><button class="filter-tab ${state.notifFilter==='messages'?'active':''}" onclick="setNotifFilter('messages')">المحادثات</button></div><section class="notif-feed-surface" id="notif-feed"></section></div>`;renderNotifFeed()}
function setNotifFilter(f){state.notifFilter=f;document.querySelectorAll(".notif-tabs .filter-tab").forEach(b=>b.classList.remove("active"));event?.target?.closest("button")?.classList.add("active");renderNotifFeed()}
function renderNotifFeed(){const rows=state.cachedNotifications||[];let list=rows;if(state.notifFilter==='unread')list=rows.filter(n=>!n.read_at);if(state.notifFilter==='revisions')list=rows.filter(n=>n.title.includes('تعديل')||n.body.includes('تعديل'));if(state.notifFilter==='projects')list=rows.filter(n=>n.title.includes('مشروع')||n.title.includes('مهمة')||n.title.includes('تصميم')||n.body.includes('مشروع'));if(state.notifFilter==='messages')list=rows.filter(n=>n.title.includes('رسالة')||n.body.includes('رسالة'));const feed=$('#notif-feed');if(!feed)return;if(!list.length){feed.innerHTML='<div class="empty-state-compact"><div class="empty-icon-pill">🔔</div><h4>لا توجد إشعارات هنا</h4><p>ستظهر التحديثات فور حدوث أي نشاط جديد.</p></div>';return}const now=Date.now(),groups={today:[],yesterday:[],older:[]};list.forEach(n=>{const age=now-new Date(n.created_at).getTime();if(age<86400000)groups.today.push(n);else if(age<172800000)groups.yesterday.push(n);else groups.older.push(n)});let html='';if(groups.today.length)html+=`<div class="notif-group"><h3 class="notif-group-title">اليوم</h3>${groups.today.map(notifItemHtml).join('')}</div>`;if(groups.yesterday.length)html+=`<div class="notif-group"><h3 class="notif-group-title">أمس</h3>${groups.yesterday.map(notifItemHtml).join('')}</div>`;if(groups.older.length)html+=`<div class="notif-group"><h3 class="notif-group-title">أقدم</h3>${groups.older.map(notifItemHtml).join('')}</div>`;feed.innerHTML=html}
function notifItemHtml(n){const isRev=n.title.includes('تعديل')||n.body.includes('تعديل');const isApp=n.title.includes('اعتماد')||n.body.includes('اعتماد');const isMsg=n.title.includes('رسالة');const iconClass=isRev?'notif-icon-red':isApp?'notif-icon-green':isMsg?'notif-icon-gold':'notif-icon-purple';const iconSvg=isRev?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>':isApp?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>':isMsg?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';return`<div class="notif-item ${n.read_at?'':'unread'}" onclick="${n.project_id?`openProject(${n.project_id})`:''}"><div class="notif-icon ${iconClass}">${iconSvg}</div><div class="notif-content"><div class="notif-content-top"><b>${esc(n.title)}</b><time>${ago(n.created_at)}</time></div><p>${esc(n.body)}</p>${n.project_id?`<span class="notif-project-tag">مشروع #${n.project_id}</span>`:''}</div>${!n.read_at?'<span class="unread-dot" title="غير مقروء"></span>':''}</div>`}
async function markAllNotifsRead(){try{await api('/api/notifications/read',{method:'POST',body:'{}'});state.unreadCount=0;if(state.cachedNotifications)state.cachedNotifications.forEach(n=>n.read_at=new Date().toISOString());renderNotifFeed();$('#nav-notif-count')?.remove();$('.top-notif-dot')?.remove();toast('تم تحديد جميع الإشعارات كمقروءة')}catch(e){toast(e.message,'error')}}
function accountPage(v){const u=state.user;const initial=esc((u.name||'G').slice(0,1));v.innerHTML=`<div class="account-page-wrapper"><header class="page-header account-page-header"><div><span class="eyebrow">حساب المصمم</span><h1>إعدادات الحساب</h1><p>بياناتك الشخصية وتفضيلات الدخول والأمان.</p></div></header><div class="account-settings-container"><div class="account-profile-card"><div class="account-avatar-large">${initial}</div><div class="account-profile-meta"><div class="account-profile-title-row"><h2>${esc(u.name)}</h2><span class="role-badge">مصمم</span></div><span class="account-email-sub">${esc(u.email||u.phone||'—')}</span></div></div><form id="account-form" class="account-form-wrapper"><div class="account-section-card"><div class="settings-section-header"><h3>معلومات الحساب</h3><p class="muted">البيانات الأساسية المسجلة في ملفك الشخصي</p></div><div class="settings-grid"><div class="field"><label>الاسم الكامل</label><input name="name" value="${esc(u.name||'')}" required></div><div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" value="${esc(u.email||'')}"></div><div class="field"><label>رقم الجوال</label><input name="phone" value="${esc(u.phone||'')}"></div></div></div><div class="account-section-card"><div class="settings-section-header"><h3>الأمان</h3><p class="muted">يمكنك تحديث كلمة المرور الخاصة بك في أي وقت.</p></div><div class="field"><label>كلمة المرور الجديدة</label><input name="password" type="password" placeholder="اتركها فارغة إذا لم ترد تغييرها" autocomplete="new-password"></div><div class="settings-actions"><button class="btn btn-gold btn-block account-submit-btn">حفظ التغييرات</button></div></div></form></div></div>`;$('#account-form').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{const d=await api('/api/account',{method:'PATCH',body:JSON.stringify(b)});state.user=d.user;toast('تم حفظ التغييرات بنجاح');renderInternal()}catch(x){toast(x.message,'error')}}}
async function internalProjects(v,status=''){state.managerProjectSearch=state.managerProjectSearch||'';state.managerProjectFilter=status!==undefined&&status!==''?status:(state.managerProjectFilter||'all');const rows=await api('/api/projects');state.allManagerProjects=rows;v.innerHTML=`<div class="manager-page-container"><header class="page-header"><div><span class="eyebrow">إدارة العمليات</span><h1>المشاريع</h1><p>متابعة شاملة لحالة كل مشروع والتسليمات والتعديلات ومسؤولي التصميم.</p></div><button class="btn btn-primary" onclick="newProject()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>مشروع جديد</span></button></header><div class="manager-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" id="manager-project-search" placeholder="ابحث باسم المشروع أو العميل أو الرمز..." value="${esc(state.managerProjectSearch)}" oninput="state.managerProjectSearch=this.value;renderManagerProjectsList()"></div><div class="filter-tabs" id="manager-projects-tabs"></div></div><section class="panel manager-projects-panel" id="manager-projects-container"></section></div>`;renderManagerProjectsList()}
function renderManagerProjectsList(){const rows=state.allManagerProjects||[];const counts={all:rows.length,in_design:rows.filter(p=>p.status==='IN_DESIGN').length,waiting_client:rows.filter(p=>p.status==='WAITING_FOR_CLIENT').length,revision_requested:rows.filter(p=>p.status==='REVISION_REQUESTED').length,approved:rows.filter(p=>['APPROVED','COMPLETED'].includes(p.status)).length};const tabsBar=$('#manager-projects-tabs');if(tabsBar){tabsBar.innerHTML=`<button class="filter-tab ${state.managerProjectFilter==='all'?'active':''}" onclick="setManagerProjectFilter('all')"><span>الكل</span><span class="tab-count">${counts.all}</span></button><button class="filter-tab ${state.managerProjectFilter==='IN_DESIGN'?'active':''}" onclick="setManagerProjectFilter('IN_DESIGN')"><span>قيد التنفيذ</span><span class="tab-count">${counts.in_design}</span></button><button class="filter-tab ${state.managerProjectFilter==='WAITING_FOR_CLIENT'?'active':''}" onclick="setManagerProjectFilter('WAITING_FOR_CLIENT')"><span>بانتظار العميل</span><span class="tab-count count-gold">${counts.waiting_client}</span></button><button class="filter-tab ${state.managerProjectFilter==='REVISION_REQUESTED'?'active':''}" onclick="setManagerProjectFilter('REVISION_REQUESTED')"><span>طلبات التعديل</span><span class="tab-count count-red">${counts.revision_requested}</span></button><button class="filter-tab ${state.managerProjectFilter==='APPROVED'?'active':''}" onclick="setManagerProjectFilter('APPROVED')"><span>المعتمدة</span><span class="tab-count count-green">${counts.approved}</span></button>`}let filtered=rows.filter(p=>{if(state.managerProjectFilter==='IN_DESIGN')return p.status==='IN_DESIGN';if(state.managerProjectFilter==='WAITING_FOR_CLIENT')return p.status==='WAITING_FOR_CLIENT';if(state.managerProjectFilter==='REVISION_REQUESTED')return p.status==='REVISION_REQUESTED';if(state.managerProjectFilter==='APPROVED')return['APPROVED','COMPLETED'].includes(p.status);return true});if(state.managerProjectSearch){const q=state.managerProjectSearch.trim().toLowerCase();filtered=filtered.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.client_name||'').toLowerCase().includes(q)||(p.designer_name||'').toLowerCase().includes(q)||String(p.id).includes(q))}const container=$('#manager-projects-container');if(container){if(!filtered.length){container.innerHTML='<div class="empty-state-compact"><div class="empty-icon-pill">🔍</div><h4>لا توجد مشاريع مطابقة</h4><p>جرّب تعديل نص البحث أو اختيار تبويب تصفية آخر.</p></div>'}else{container.innerHTML=`<div class="manager-project-full-list">${filtered.map(p=>`<article class="manager-project-card-row" onclick="openProject(${p.id})"><div class="project-row-lead"><div class="project-mini-thumb">${projectThumbnail(p)}</div><div class="project-lead-info"><div class="project-code-row"><span class="project-code">DES-${String(p.id).padStart(5,'0')}</span><span class="version-tag">${p.latest_version?'V'+p.latest_version:'V1'}</span></div><h3 class="project-card-name" title="${esc(p.name)}">${esc(p.name)}</h3></div></div><div class="project-row-parties"><div class="party-item"><span class="party-label">العميل</span><b class="party-val">${esc(p.client_name)}</b></div><div class="party-item"><span class="party-label">المصمم المسؤول</span><b class="party-val">${esc(p.designer_name||'غير مسند')}</b></div></div><div class="project-row-status">${projectStatusBadge(p.status)}<small class="project-status-time">آخر نشاط: ${ago(p.updated_at)}</small></div><div class="project-row-action" onclick="event.stopPropagation()"><button class="btn btn-primary btn-sm" onclick="openProject(${p.id})">فتح مساحة العمل</button><details class="action-menu"><summary aria-label="خيارات">⋮</summary><div><button onclick="openProject(${p.id})">فتح المشروع</button><button onclick="generateAccess(${p.id},'${esc(p.client_phone||'')}','${esc(p.client_name||'')}')">رابط العميل</button><button onclick="navigator.clipboard.writeText('DES-${String(p.id).padStart(5,'0')}');toast('تم نسخ رمز المشروع')">نسخ رمز المشروع</button></div></details></div></article>`).join('')}</div>`}}}
function setManagerProjectFilter(f){state.managerProjectFilter=f;renderManagerProjectsList()}
function filterStatus(status){state.tab=status?status==='WAITING_FOR_CLIENT'?'waiting':status==='APPROVED'?'approved':'projects':'projects';renderInternal()}
async function clients(v){state.clientSearch=state.clientSearch||'';state.clientFilter=state.clientFilter||'all';const rows=await api('/api/clients');state.allClients=rows;v.innerHTML=`<div class="manager-page-container"><header class="page-header"><div><span class="eyebrow">إدارة الحسابات</span><h1>العملاء</h1><p>سجل العملاء وإدارة صلاحيات الوصول وبيانات التواصل.</p></div><button class="btn btn-primary" onclick="newClient()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>عميل جديد</span></button></header><div class="manager-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" id="client-search-input" placeholder="ابحث باسم العميل أو البريد أو الجوال..." value="${esc(state.clientSearch)}" oninput="state.clientSearch=this.value;renderClientsList()"></div><div class="filter-chips"><button class="filter-chip ${state.clientFilter==='all'?'active':''}" onclick="setClientFilter('all')">الكل (${rows.length})</button><button class="filter-chip ${state.clientFilter==='active'?'active':''}" onclick="setClientFilter('active')">نشط (${rows.filter(c=>c.active).length})</button><button class="filter-chip ${state.clientFilter==='inactive'?'active':''}" onclick="setClientFilter('inactive')">معطل (${rows.filter(c=>!c.active).length})</button></div></div><section class="panel clients-panel-v2" id="clients-list-container"></section></div>`;renderClientsList()}
function renderClientsList(){const rows=state.allClients||[];let filtered=rows;if(state.clientFilter==='active')filtered=filtered.filter(c=>c.active);if(state.clientFilter==='inactive')filtered=filtered.filter(c=>!c.active);if(state.clientSearch){const q=state.clientSearch.trim().toLowerCase();filtered=filtered.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q)||(c.phone||'').includes(q))}const container=$('#clients-list-container');if(container){if(!filtered.length){container.innerHTML='<div class="empty-state-compact"><div class="empty-icon-pill">👥</div><h4>لا يوجد عملاء مطابقون</h4><p>جرّب تعديل نص البحث أو إضافة عميل جديد.</p></div>'}else{container.innerHTML=`<div class="clients-grid-v2">${filtered.map(c=>`<div class="client-card-v2"><div class="client-card-header"><div class="client-avatar-v2">${esc((c.name||'ع').slice(0,1))}</div><div class="client-title-block"><h3 class="client-name">${esc(c.name)}</h3><small class="client-since">عميل منذ ${fmt(c.created_at)}</small></div>${c.active?'<span class="status-pill status-approved">نشط</span>':'<span class="status-pill status-cancelled">معطل</span>'}</div><div class="client-card-contact"><div class="contact-line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>${esc(c.email||'—')}</span></div><div class="contact-line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${esc(c.phone||'—')}</span></div></div><div class="client-card-actions"><button class="btn btn-soft btn-sm" onclick="editClient(${c.id},'${esc(c.name)}','${esc(c.email||'')}','${esc(c.phone||'')}')">تعديل البيانات</button><button class="btn btn-soft btn-sm ${c.active?'btn-danger-soft':''}" onclick="toggleClient(${c.id},${c.active})">${c.active?'تعطيل':'تفعيل'}</button></div></div>`).join('')}</div>`}}}
function setClientFilter(f){state.clientFilter=f;renderClientsList()}
function modal(title,body,submit,button='حفظ'){document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="modal"><form class="modal modal-v2"><div class="modal-header"><div><span class="eyebrow">G.PACK PORTAL</span><h2>${title}</h2></div><button type="button" class="modal-close" aria-label="إغلاق">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button type="button" class="btn btn-soft modal-cancel">إلغاء</button><button type="submit" class="btn btn-primary">${button}</button></div></form></div>`);const m=$('#modal');m.querySelectorAll('.modal-close,.modal-cancel').forEach(x=>x.onclick=()=>m.remove());m.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=m.querySelector('button[type=submit]');if(b)b.disabled=true;try{await submit(new FormData(e.target));m.remove();toast('تم الحفظ بنجاح');renderInternal()}catch(x){toast(x.message,'error')}finally{if(b)b.disabled=false}}}
function newClient(){modal('إضافة عميل جديد','<div class="field"><label>اسم العميل / المؤسسة <span class="req">*</span></label><input name="name" placeholder="مثال: شركة اسماك البحارة" required></div><div class="form-row-2"><div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" placeholder="client@example.com"></div><div class="field"><label>رقم الجوال</label><input name="phone" placeholder="05XXXXXXXX"></div></div>',f=>api('/api/clients',{method:'POST',body:JSON.stringify(Object.fromEntries(f))}),'إضافة العميل')}
function editClient(id,name,email,phone){modal('تعديل بيانات العميل',`<div class="field"><label>اسم العميل / المؤسسة <span class="req">*</span></label><input name="name" value="${esc(name)}" required></div><div class="form-row-2"><div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" value="${esc(email||'')}"></div><div class="field"><label>رقم الجوال</label><input name="phone" value="${esc(phone||'')}"></div></div>`,f=>api('/api/clients/'+id,{method:'PATCH',body:JSON.stringify(Object.fromEntries(f))}),'تحديث البيانات')}
async function toggleClient(id,active){if(!confirm(active?'هل تريد تعطيل العميل؟':'هل تريد تفعيل العميل؟'))return;try{await api('/api/clients/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});toast(active?'تم تعطيل العميل':'تم تفعيل العميل');renderInternal()}catch(e){toast(e.message,'error')}}
function newDesigner(){modal('إضافة مصمم جديد','<div class="field"><label>اسم المصمم <span class="req">*</span></label><input name="name" placeholder="الاسم الكامل" required></div><div class="form-row-2"><div class="field"><label>البريد الإلكتروني (اختياري)</label><input name="email" type="email" placeholder="designer@gpack.sa"></div><div class="field"><label>رقم الجوال (اختياري)</label><input name="phone" placeholder="0551234567"></div></div><div class="field"><label>كلمة المرور للدخول <span class="req">*</span></label><input name="password" type="password" minlength="8" placeholder="8 خانات على الأقل" required autocomplete="new-password"></div>',f=>api('/api/designers',{method:'POST',body:JSON.stringify(Object.fromEntries(f))}),'إضافة المصمم')}
async function newProject(){const [cs,ds]=await Promise.all([api('/api/clients'),api('/api/designers')]);modal('إنشاء مشروع جديد','<div class="field"><label>اسم المشروع <span class="req">*</span></label><input name="name" placeholder="مثال: هوية بصرية - اسماك البحارة" required></div><div class="form-row-2"><div class="field"><label>العميل <span class="req">*</span></label><select name="client_id" required><option value="">— اختر العميل —</option>'+cs.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')+'</select></div><div class="field"><label>المصمم المسؤول</label><select name="designer_id"><option value="">— إسناد لاحقاً —</option>'+ds.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')+'</select></div></div><div class="field"><label>وصف المشروع</label><textarea name="description" rows="2" placeholder="وصف موجز للمشروع والأهداف"></textarea></div><div class="field"><label>الموجز الفني (Brief)</label><textarea name="brief" rows="4" placeholder="تفاصيل الطلب، الأبعاد، الألوان، الملاحظات الخاصة..."></textarea></div>',f=>api('/api/projects',{method:'POST',body:JSON.stringify(Object.fromEntries(f))}),'إنشاء المشروع')}
function normalizeOptions(options=[],files=[]){const unassigned=files.filter(f=>!f.option_id&&f.mime?.startsWith('image/'));return options.map((o,i)=>({...o,files:files.filter(f=>String(f.option_id)===String(o.id)&&f.mime?.startsWith('image/')).length?files.filter(f=>String(f.option_id)===String(o.id)&&f.mime?.startsWith('image/')):(unassigned[i]?[unassigned[i]]:[])}))}function optionImage(o,portal=false){const f=o.files?.[0];return f?`<img src="${portal?'/api/portal/'+state.portalData.project.id+'/files/'+f.id:'/api/files/'+f.id}" alt="${esc(o.name)}">`:'<span>لا توجد معاينة</span>'}
function fmtFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeInfo(f) {
  const name = f.original_name || '';
  const ext = (name.split('.').pop() || '').toUpperCase();
  const mime = (f.mime || '').toLowerCase();
  if (mime.startsWith('image/')) return { type: ext || 'PNG', isImage: true };
  if (ext === 'PDF' || mime.includes('pdf')) return { type: 'PDF', badgeClass: 'file-type-pdf' };
  if (['AI', 'EPS'].includes(ext)) return { type: 'AI', badgeClass: 'file-type-ai' };
  if (ext === 'PSD') return { type: 'PSD', badgeClass: 'file-type-psd' };
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) return { type: 'ZIP', badgeClass: 'file-type-zip' };
  if (['DOC', 'DOCX'].includes(ext)) return { type: 'DOC', badgeClass: 'file-type-doc' };
  if (['XLS', 'XLSX', 'CSV'].includes(ext)) return { type: 'XLS', badgeClass: 'file-type-xls' };
  return { type: ext || 'FILE', badgeClass: 'file-type-default' };
}

function renderWorkspaceFileRow(f) {
  const info = getFileTypeInfo(f);
  const iconHtml = info.isImage
    ? `<div class="file-thumb-mini-wrap"><img src="/api/files/${f.id}" alt="${esc(f.original_name)}" class="file-thumb-mini" loading="lazy"></div>`
    : `<div class="file-icon-badge ${info.badgeClass}"><span>${info.type}</span></div>`;
  return `<div class="compact-file-row"><div class="file-row-main">${iconHtml}<div class="file-row-details"><span class="file-row-name" title="${esc(f.original_name)}">${esc(f.original_name)}</span><span class="file-row-sub">${info.type} • ${fmtFileSize(f.size)}${f.message_id ? ' • <span class="file-source-badge chat-source">من المحادثة</span>' : ''}</span></div></div><div class="file-row-actions"><a href="/api/files/${f.id}" target="_blank" class="file-action-link" title="فتح الملف">فتح</a><a href="/api/files/${f.id}" download="${esc(f.original_name)}" class="file-download-btn" title="تنزيل">⤓</a></div></div>`;
}

function renderWorkspaceFilesList(files, activeTab) {
  const filtered = (files || []).filter(f => {
    if (activeTab === 'client') return f.uploaded_by_type === 'CLIENT';
    return f.uploaded_by_type === 'DESIGNER' || f.uploaded_by_type === 'ADMIN';
  });
  if (!filtered.length) {
    const emptyMsg = activeTab === 'client' ? 'لا توجد ملفات من العميل بعد' : 'لا توجد ملفات من المصمم بعد';
    return `<div class="tiny-files-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>${emptyMsg}</span></div>`;
  }
  return filtered.map(renderWorkspaceFileRow).join('');
}

function setWorkspaceFilesTab(tab) {
  state.workspaceFilesTab = tab;
  document.querySelectorAll('.files-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const listEl = document.querySelector('#workspace-files-list');
  if (listEl && state.project?.files) {
    listEl.innerHTML = renderWorkspaceFilesList(state.project.files, tab);
  }
}

function renderWorkspaceFilesPanel(files = []) {
  state.workspaceFilesTab = state.workspaceFilesTab || 'designer';
  const designerCount = files.filter(f => f.uploaded_by_type === 'DESIGNER' || f.uploaded_by_type === 'ADMIN').length;
  const clientCount = files.filter(f => f.uploaded_by_type === 'CLIENT').length;
  return `<div class="compact-files-panel"><div class="files-panel-top"><h3 class="files-panel-title">الملفات</h3><div class="files-tabs-wrap"><button type="button" class="files-tab-btn ${state.workspaceFilesTab === 'designer' ? 'active' : ''}" data-tab="designer" onclick="setWorkspaceFilesTab('designer')"><span>ملفات المصمم</span><span class="files-count-badge">${designerCount}</span></button><button type="button" class="files-tab-btn ${state.workspaceFilesTab === 'client' ? 'active' : ''}" data-tab="client" onclick="setWorkspaceFilesTab('client')"><span>ملفات العميل</span><span class="files-count-badge">${clientCount}</span></button></div></div><div class="compact-files-list" id="workspace-files-list">${renderWorkspaceFilesList(files, state.workspaceFilesTab)}</div></div>`;
}

async function openProject(id,pushRoute=true){closeStream();state.activeProjectId=Number(id);sessionStorage.setItem('gpack_active_project',id);if(pushRoute&&location.pathname!=='/project/'+id){history.pushState({projectId:id},'','/project/'+id);}let d;try{d=await api('/api/projects/'+id)}catch(err){  const v=$('#internal-view');if(v){v.innerHTML=`<div class="error-state"><h2>تعذر تحميل المشروع</h2><p>${esc(err.message)}</p><button class="btn btn-soft" onclick="exitProject()">العودة للمشاريع</button></div>`}  toast(err.message||'تعذر تحميل المشروع','error');return;}const p=d.project;state.project=d;const revisions=d.revisions||[],latestOptions=d.versions[0]?normalizeOptions(d.versions[0].options||[],d.files.filter(f=>f.version_id===d.versions[0].id)):[];document.querySelector('#internal-view').innerHTML=`<div class="workspace-top"><button class="back-button" onclick="state.tab='projects';renderInternal()">→ رجوع للمشاريع</button><div class="workspace-title"><span class="eyebrow">مساحة المشروع</span><h1>${esc(p.name)}</h1><div>${badge(p.status)} <span class="muted">${esc(d.client.name)}</span></div></div><button class="btn btn-gold" onclick="generateAccess(${p.id},'${esc(d.client.phone||'')}','${esc(d.client.name||'')}')">رابط العميل</button></div><div class="workspace-grid"><aside class="workspace-side panel"><h3>الموجز</h3><p class="brief-text">${esc(p.brief||p.description||'لم تتم إضافة موجز بعد')}</p>${renderWorkspaceFilesPanel(d.files)}</aside><section class="panel workspace-chat"><div class="section-heading"><h2>المحادثة</h2><span class="live-pill"><i></i> مباشرة</span></div><div class="messages" id="messages"></div><form class="composer" id="internal-composer"><input type="file" id="internal-file" hidden accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/illustrator,application/postscript,application/x-photoshop,image/vnd.adobe.photoshop"><button type="button" class="attach-button" id="internal-attach" aria-label="إرفاق ملف" title="إرفاق ملف"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.49-8.49a4 4 0 0 1 5.66 5.66l-8.5 8.5a2 2 0 0 1-2.83-2.83l7.78-7.78"/></svg></button><input name="body" placeholder="اكتب رسالة أو أرفق ملفاً..." autocomplete="off"><button type="button" class="voice-record-btn" id="internal-voice-btn" aria-label="تسجيل رسالة صوتية" title="تسجيل رسالة صوتية"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg></button><button class="send-button" aria-label="إرسال">➤</button><div id="internal-attachment" class="attachment-preview hidden"></div><div id="internal-voice-bar" class="voice-composer-bar hidden"></div></form></section><aside class="workspace-review panel"><div class="section-heading"><h2>آخر نسخة</h2>${d.versions[0]?`<span class="version-pill">V${d.versions[0].number}</span>`:''}</div>${d.versions[0]?`<div class="internal-preview">${internalPreview(d)}</div><p class="version-note">${esc(d.versions[0].notes||'بدون ملاحظات')}</p>${latestOptions.length?'<div class="designer-options"><b class="designer-options-title">خيارات التصميم</b><div class="designer-options-grid">'+latestOptions.map((o,i)=>{const isSel=o.status==='SELECTED';const isApp=o.status==='APPROVED';return `<div class="designer-option-card ${isSel?'is-selected':''} ${isApp?'is-approved':''}"><div class="option-preview">${optionImage(o)}</div><strong>${formatOptionName(o.name)||('الخيار '+(i+1))}</strong><small>${esc(o.name)}</small><span class="designer-option-status-badge ${isSel?'status-selected':isApp?'status-approved':'status-proposed'}">${isSel?'مختار للمراجعة':isApp?'معتمد':'مقترح'}</span></div>`}).join('')+'</div></div>':''}${state.user.role==='DESIGNER'?(p.status==='NEW_TASK'?'<button class="btn btn-gold btn-block" onclick="startProject('+p.id+')">بدء التنفيذ</button>':'<button class="btn btn-primary btn-block" onclick="uploadVersion('+p.id+')">تسليم التصميم</button>'):''}`:'<div class="empty-state"><h3>لم يتم تسليم تصميم رسمي بعد</h3><p>مرفقات المحادثة تبقى في الملفات فقط. استخدم زر تسليم التصميم لإرسال V1 للعميل.</p></div>'+ (state.user.role==='DESIGNER'?(p.status==='NEW_TASK'?'<button class="btn btn-gold btn-block" onclick="startProject('+p.id+')">بدء التنفيذ</button>':'<button class="btn btn-primary btn-block" onclick="uploadVersion('+p.id+')">تسليم التصميم V1</button>'):'')}<h3>طلبات التعديل</h3>${revisions.map(r=>`<div class="revision-card"><b>تعديل على V${r.version_number}${r.option_name?' — '+esc(formatOptionName(r.option_name)):''}</b><p>${esc(r.request)}</p><small>${fmt(r.created_at)}</small></div>`).join('')||'<div class="compact-empty">لا توجد طلبات تعديل</div>'}</aside></div>`;const ms=await api('/api/projects/'+id+'/messages');$('#messages').innerHTML='';ms.forEach(appendMessage);$('#internal-attach').onclick=()=>$('#internal-file').click();setupAttachmentPreview($('#internal-file'),$('#internal-attachment'));$('#internal-composer').onsubmit=async e=>{e.preventDefault();const input=e.target.body,file=$('#internal-file').files[0];if(!input.value.trim()&&!file)return;const sendBtn=e.target.querySelector('.send-button');if(sendBtn)sendBtn.disabled=true;try{if(file){const fd=new FormData();fd.append('file',file);if(input.value.trim())fd.append('body',input.value.trim());fd.append('client_event_id',crypto.randomUUID());const resMsg=await api('/api/projects/'+id+'/messages/attachment',{method:'POST',body:fd});if(resMsg){appendMessage(resMsg);syncProjectFileFromMessage(resMsg);}}else{const resMsg=await api('/api/projects/'+id+'/messages',{method:'POST',body:JSON.stringify({body:input.value.trim(),client_event_id:crypto.randomUUID()})});if(resMsg)appendMessage(resMsg);}e.target.reset();$('#internal-file').value='';const box=$('#internal-attachment');if(box){box.classList.add('hidden');box.innerHTML=''}toast('تم الإرسال')}catch(x){toast(x.message||'تعذر إرسال المرفق','error')}finally{if(sendBtn)sendBtn.disabled=false}};setupVoiceComposer({composer:$('#internal-composer'),recordBtn:$('#internal-voice-btn'),bar:$('#internal-voice-bar'),uploadEndpoint:'/api/projects/'+id+'/messages/voice'});openStream('/api/projects/'+id+'/stream',x=>{if(x.type==='message'){appendMessage(x.message);if(x.message&&x.message.file_id)syncProjectFileFromMessage(x.message);}else if(x.type==='file'){if(x.file)syncProjectFileFromMessage({file_id:x.file.id,original_name:x.file.original_name,mime:x.file.mime,file_size:x.file.size,created_at:x.file.created_at,sender_type:x.file.uploaded_by_type});else openProject(id,false);}else if(['version','revision','approved','status','option'].includes(x.type))openProject(id,false)})}function fileItem(f){return`<div class="file-item"><span class="file-icon">${f.mime.startsWith('image/')?'▧':'▤'}</span><span><b>${esc(f.original_name)}</b><small>${f.uploaded_by_type==='CLIENT'?'ملف من العميل':'ملف من المصمم'} · ${Math.ceil(f.size/1024)} KB</small></span><a href="/api/files/${f.id}" target="_blank">فتح</a></div>`}function internalPreview(d){const f=d.files.find(x=>x.version_id===d.versions[0].id&&x.mime.startsWith('image/'));return f?`<a href="/api/files/${f.id}" target="_blank"><img src="/api/files/${f.id}" alt="V${d.versions[0].number}"></a>`:'<span class="muted">ملف التصميم متاح ضمن الملفات</span>'}async function loadMessages(){const ms=await api('/api/projects/'+state.project.project.id+'/messages');$('#messages').innerHTML='';ms.forEach(appendMessage)}function openImageLightbox(url,name){let lightbox=document.getElementById('chat-image-lightbox');if(!lightbox){lightbox=document.createElement('div');lightbox.id='chat-image-lightbox';lightbox.className='chat-image-lightbox hidden';lightbox.innerHTML='<div class="chat-image-lightbox-backdrop"></div><div class="chat-image-lightbox-content"><div class="chat-image-lightbox-header"><span class="chat-image-lightbox-title"></span><div class="chat-image-lightbox-actions"><a href="#" target="_blank" download class="chat-image-lightbox-download" title="تحميل" aria-label="تحميل الصورة"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a><button type="button" class="chat-image-lightbox-close" aria-label="إغلاق">✕</button></div></div><div class="chat-image-lightbox-body"><img src="" alt="" class="chat-image-lightbox-img"/></div></div>';document.body.appendChild(lightbox);lightbox.querySelector('.chat-image-lightbox-backdrop').onclick=()=>lightbox.classList.add('hidden');lightbox.querySelector('.chat-image-lightbox-close').onclick=()=>lightbox.classList.add('hidden');document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!lightbox.classList.contains('hidden'))lightbox.classList.add('hidden')})}lightbox.querySelector('.chat-image-lightbox-title').textContent=name||'';const img=lightbox.querySelector('.chat-image-lightbox-img');img.src=url;img.alt=name||'';const dl=lightbox.querySelector('.chat-image-lightbox-download');dl.href=url;dl.setAttribute('download',name||'image');lightbox.classList.remove('hidden')}function setupAttachmentPreview(fileInput,previewBox){if(!fileInput||!previewBox)return;fileInput.onchange=e=>{const f=e.target.files[0];if(!f){previewBox.classList.add('hidden');previewBox.innerHTML='';return}const isImg=f.type.startsWith('image/'),sizeStr=f.size>1024*1024?(f.size/(1024*1024)).toFixed(1)+' MB':Math.ceil(f.size/1024)+' KB',ext=f.name.includes('.')?f.name.split('.').pop().toUpperCase():'FILE';previewBox.classList.remove('hidden');if(isImg){const objUrl=URL.createObjectURL(f);previewBox.innerHTML='<div class="attachment-preview-card attachment-preview-img-card"><div class="attachment-preview-thumb-wrap"><img src="'+objUrl+'" alt="'+esc(f.name)+'" class="attachment-preview-thumb"/></div><div class="attachment-preview-info"><span class="attachment-preview-name" title="'+esc(f.name)+'">'+esc(f.name)+'</span><span class="attachment-preview-size">'+sizeStr+' • صورة</span></div><button type="button" class="attachment-preview-remove" aria-label="إلغاء المرفق" title="إلغاء المرفق">✕</button></div>'}else{previewBox.innerHTML='<div class="attachment-preview-card attachment-preview-doc-card"><div class="attachment-preview-file-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="attachment-preview-ext-badge">'+esc(ext.slice(0,4))+'</span></div><div class="attachment-preview-info"><span class="attachment-preview-name" title="'+esc(f.name)+'">'+esc(f.name)+'</span><span class="attachment-preview-size">'+sizeStr+' • ملف</span></div><button type="button" class="attachment-preview-remove" aria-label="إلغاء المرفق" title="إلغاء المرفق">✕</button></div>'}const removeBtn=previewBox.querySelector('.attachment-preview-remove');if(removeBtn){removeBtn.onclick=()=>{fileInput.value='';previewBox.classList.add('hidden');previewBox.innerHTML=''}}}}function formatAudioTime(s){const sec=Math.max(0,Math.floor(Number(s)||0)),m=Math.floor(sec/60),rem=sec%60;return`${m}:${rem<10?'0':''}${rem}`}function setupVoiceComposer(opts){const{composer,recordBtn,bar,uploadEndpoint}=opts;if(!composer||!recordBtn||!bar)return;let mediaRecorder=null,audioChunks=[],stream=null,timerInterval=null,secondsElapsed=0,audioBlob=null,previewAudio=null,previewUrl=null;const maxDuration=120;function cleanupStream(){if(stream){try{stream.getTracks().forEach(t=>t.stop())}catch(e){}stream=null}}function resetComposer(){clearInterval(timerInterval);timerInterval=null;cleanupStream();if(previewAudio){previewAudio.pause();previewAudio=null}if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}mediaRecorder=null;audioChunks=[];secondsElapsed=0;audioBlob=null;bar.innerHTML='';bar.classList.add('hidden');composer.classList.remove('is-recording-active')}recordBtn.onclick=async e=>{e.preventDefault();if(!navigator.mediaDevices?.getUserMedia){toast('المتصفح الحالي لا يدعم تسجيل الصوت','error');return}let mime='';const candidates=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/aac'];for(const c of candidates){if(window.MediaRecorder&&MediaRecorder.isTypeSupported(c)){mime=c;break}}try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(err){if(err.name==='NotAllowedError'||err.name==='PermissionDeniedError'){toast('تم رفض إذن الوصول للميكروفون. يرجى السماح به من إعدادات المتصفح.','error')}else{toast('تعذر الوصول إلى الميكروفون: '+err.message,'error')}return}composer.classList.add('is-recording-active');bar.classList.remove('hidden');bar.innerHTML=`<div class="voice-rec-live"><span class="voice-pulse-dot"></span><span class="voice-timer">00:00</span><span class="voice-rec-hint">جارٍ تسجيل رسالة صوتية...</span></div><div class="voice-rec-actions"><button type="button" class="btn-voice-cancel" aria-label="إلغاء التسجيل">🗑️ إلغاء</button><button type="button" class="btn-voice-stop" aria-label="إيقاف التسجيل">⏹️ إيقاف</button></div>`;audioChunks=[];try{mediaRecorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream)}catch(e){mediaRecorder=new MediaRecorder(stream)}mediaRecorder.ondataavailable=ev=>{if(ev.data&&ev.data.size>0)audioChunks.push(ev.data)};secondsElapsed=0;timerInterval=setInterval(()=>{secondsElapsed++;const m=Math.floor(secondsElapsed/60),s=secondsElapsed%60;const timerEl=bar.querySelector('.voice-timer');if(timerEl)timerEl.textContent=`${m<10?'0':''}${m}:${s<10?'0':''}${s}`;if(secondsElapsed>=maxDuration){stopRecording()}},1000);const cancelBtn=bar.querySelector('.btn-voice-cancel'),stopBtn=bar.querySelector('.btn-voice-stop');cancelBtn.onclick=()=>resetComposer();function stopRecording(){clearInterval(timerInterval);timerInterval=null;if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.onstop=()=>{cleanupStream();if(secondsElapsed<1){toast('التسجيل قصير جداً');resetComposer();return}audioBlob=new Blob(audioChunks,{type:mime||'audio/webm'});showPreview(mime)};mediaRecorder.stop()}else{cleanupStream();resetComposer()}}stopBtn.onclick=()=>stopRecording();mediaRecorder.start(250)};function showPreview(mime){previewUrl=URL.createObjectURL(audioBlob);previewAudio=new Audio(previewUrl);bar.innerHTML=`<div class="voice-preview-box"><button type="button" class="btn-preview-play" aria-label="تشغيل المعاينة"><svg class="preview-ic-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg><svg class="preview-ic-pause hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button><div class="voice-preview-track-wrap"><div class="voice-preview-track"><div class="voice-preview-fill" style="width:0%"></div></div><span class="voice-preview-time">0:00 / ${formatAudioTime(secondsElapsed)}</span></div><div class="voice-preview-actions"><button type="button" class="btn-preview-rerecord" title="إعادة التسجيل">🔄 إعادة</button><button type="button" class="btn-preview-discard" title="إلغاء">✕ إلغاء</button><button type="button" class="btn-preview-send" title="إرسال">إرسال ➤</button></div></div>`;const playBtn=bar.querySelector('.btn-preview-play'),playIc=bar.querySelector('.preview-ic-play'),pauseIc=bar.querySelector('.preview-ic-pause'),fill=bar.querySelector('.voice-preview-fill'),timeEl=bar.querySelector('.voice-preview-time'),rerecordBtn=bar.querySelector('.btn-preview-rerecord'),discardBtn=bar.querySelector('.btn-preview-discard'),sendBtn=bar.querySelector('.btn-preview-send');playBtn.onclick=()=>{if(!previewAudio)return;if(previewAudio.paused){if(window._currentPlayingAudio)window._currentPlayingAudio.pause();window._currentPlayingAudio=previewAudio;previewAudio.play();playIc.classList.add('hidden');pauseIc.classList.remove('hidden')}else{previewAudio.pause();playIc.classList.remove('hidden');pauseIc.classList.add('hidden')}};previewAudio.ontimeupdate=()=>{if(!previewAudio)return;const pct=previewAudio.duration?(previewAudio.currentTime/previewAudio.duration)*100:0;fill.style.width=pct+'%';timeEl.textContent=`${formatAudioTime(previewAudio.currentTime)} / ${formatAudioTime(secondsElapsed)}`};previewAudio.onended=()=>{playIc.classList.remove('hidden');pauseIc.classList.add('hidden');fill.style.width='0%';timeEl.textContent=`0:00 / ${formatAudioTime(secondsElapsed)}`};rerecordBtn.onclick=()=>{resetComposer();recordBtn.click()};discardBtn.onclick=()=>resetComposer();sendBtn.onclick=async()=>{sendBtn.disabled=true;sendBtn.textContent='جارٍ الإرسال...';try{const ext=(mime&&mime.includes('mp4'))?'mp4':(mime&&mime.includes('ogg'))?'ogg':'webm';const fd=new FormData();fd.append('audio',audioBlob,`voice-message.${ext}`);fd.append('duration',secondsElapsed);fd.append('client_event_id',crypto.randomUUID());await api(uploadEndpoint,{method:'POST',body:fd});resetComposer();toast('تم إرسال الرسالة الصوتية')}catch(err){toast(err.message,'error');sendBtn.disabled=false;sendBtn.textContent='إرسال ➤'}}}}function appendMessage(m){const container=$('#messages');if(!container||!m)return;if(m.id&&container.querySelector(`[data-id="${m.id}"]`))return;if(m.client_event_id&&container.querySelector(`[data-event-id="${m.client_event_id}"]`))return;const lastEl=container.lastElementChild,prevSenderType=lastEl?.dataset?.senderType,isConsecutive=prevSenderType===m.sender_type,inPortal=!!state.portal,isClient=m.sender_type==='CLIENT',isMine=inPortal?isClient:(m.sender_type===state.user?.role||(state.user?.role==='ADMIN'&&(m.sender_type==='ADMIN'||m.sender_type==='DESIGNER')));let senderLabel='';if(!isMine&&!isConsecutive){if(inPortal){senderLabel=m.sender_type==='ADMIN'?'إدارة G.PACK':(m.sender_name?`المصمم · ${m.sender_name}`:'المصمم')}else{senderLabel=m.sender_name?`العميل · ${m.sender_name}`:'العميل'}}const timeFormatted=m.created_at?new Date(m.created_at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'';const el=document.createElement('div');el.className=`message ${isClient?'message-client':'message-designer'} ${isMine?'message-mine mine':'message-theirs theirs'} ${isConsecutive?'is-consecutive':''} ${m.type==='AUDIO'?'message-voice':''} ${m.type==='IMAGE'?'message-image':''} ${m.type==='FILE'?'message-file':''}`;el.dataset.senderType=m.sender_type;if(m.id)el.dataset.id=m.id;if(m.client_event_id)el.dataset.eventId=m.client_event_id;let contentHtml='';if(m.type==='AUDIO'){const durStr=formatAudioTime(m.duration||0);const audioUrl=m.file_url||(m.file_id?`/api/files/${m.file_id}`:'');contentHtml=`<div class="message-voice-bubble" data-url="${esc(audioUrl)}"><button type="button" class="voice-play-btn" aria-label="تشغيل التسجيل الصوتي"><svg class="icon-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg><svg class="icon-pause hidden" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button><div class="voice-bubble-main"><div class="voice-seek-bar" role="slider" aria-label="شريط تقديم التسجيل الصوتي" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="voice-seek-track"><div class="voice-seek-fill" style="width:0%"></div></div><div class="voice-seek-thumb" style="left:0%"></div></div><div class="voice-bubble-meta"><span class="voice-bubble-time">0:00 / ${durStr}</span><span class="voice-mic-icon" title="رسالة صوتية"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg></span></div></div><audio preload="metadata" src="${esc(audioUrl)}"></audio></div>`}else if(m.type==='IMAGE'){const imgUrl=m.file_url||(m.file_id?(inPortal?'/api/portal/'+state.portalData?.project?.id+'/files/'+m.file_id:'/api/files/'+m.file_id):'');const fileName=m.original_name||m.body||'صورة';const hasCustomCap=m.body&&m.body!==m.original_name&&m.body!==fileName;contentHtml='<div class="message-image-bubble"><div class="message-image-wrap" data-img-url="'+esc(imgUrl)+'" data-img-name="'+esc(fileName)+'"><img src="'+esc(imgUrl)+'" alt="'+esc(fileName)+'" class="message-chat-image" loading="lazy"/><button type="button" class="message-image-zoom-btn" aria-label="تكبير الصورة"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button></div>'+(hasCustomCap?'<div class="message-attachment-caption">'+esc(m.body)+'</div>':'')+'</div>'}else if(m.type==='FILE'){const fileUrl=m.file_url||(m.file_id?(inPortal?'/api/portal/'+state.portalData?.project?.id+'/files/'+m.file_id:'/api/files/'+m.file_id):'');const fileName=m.original_name||m.body||'ملف مرفق';const sizeStr=m.file_size?(m.file_size>1024*1024?(m.file_size/(1024*1024)).toFixed(1)+' MB':Math.ceil(m.file_size/1024)+' KB'):'';const ext=fileName.includes('.')?fileName.split('.').pop().toUpperCase():'FILE';const hasCustomCap=m.body&&m.body!==m.original_name&&m.body!==fileName;contentHtml='<div class="message-file-bubble"><a href="'+esc(fileUrl)+'" target="_blank" download="'+esc(fileName)+'" class="message-file-card"><div class="message-file-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="message-file-ext-tag">'+esc(ext.slice(0,4))+'</span></div><div class="message-file-info"><span class="message-file-name" title="'+esc(fileName)+'">'+esc(fileName)+'</span>'+(sizeStr?'<span class="message-file-size">'+esc(sizeStr)+'</span>':'')+'</div><div class="message-file-action" title="تحميل"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div></a>'+(hasCustomCap?'<div class="message-attachment-caption">'+esc(m.body)+'</div>':'')+'</div>'}else{const bodyText=m.body||'';if(bodyText.startsWith('طلب تعديل [')){const bEnd=bodyText.indexOf(']:');if(bEnd!==-1){const target=bodyText.slice(10,bEnd),notes=bodyText.slice(bEnd+2).trim();contentHtml=`<div class="chat-structured-card chat-structured-revision"><span class="chat-structured-badge">طلب تعديل</span><strong class="chat-structured-title">${esc(target)}</strong><div class="chat-structured-notes">${esc(notes)}</div></div>`;}else{contentHtml='<div class="message-bubble-body">'+esc(bodyText)+'</div>';}}else if(bodyText.startsWith('تم اعتماد التصميم [')){const bEnd=bodyText.indexOf(']');if(bEnd!==-1){const target=bodyText.slice(19,bEnd);contentHtml=`<div class="chat-structured-card chat-structured-approval"><span class="chat-structured-badge approved">اعتماد نهائي ✓</span><strong class="chat-structured-title">${esc(target)}</strong><div class="chat-structured-notes" style="background:transparent;padding:2px 0;font-weight:700;color:#15803d;">تم اعتماد هذا التصميم بنجاح من قبل العميل ✅</div></div>`;}else{contentHtml='<div class="message-bubble-body">'+esc(bodyText)+'</div>';}}else{contentHtml='<div class="message-bubble-body">'+esc(bodyText)+'</div>';}}el.innerHTML=`${senderLabel?`<div class="message-sender-name">${esc(senderLabel)}</div>`:''}${contentHtml}<div class="message-meta"><time datetime="${esc(m.created_at||'')}" class="message-time">${esc(timeFormatted)}</time></div>`;if(m.type==='AUDIO'){const audioEl=el.querySelector('audio'),playBtn=el.querySelector('.voice-play-btn'),iconPlay=el.querySelector('.icon-play'),iconPause=el.querySelector('.icon-pause'),fill=el.querySelector('.voice-seek-fill'),thumb=el.querySelector('.voice-seek-thumb'),timeText=el.querySelector('.voice-bubble-time'),seekBar=el.querySelector('.voice-seek-bar'),durTotal=Number(m.duration)||0;if(playBtn&&audioEl){playBtn.onclick=()=>{if(audioEl.paused){if(window._currentPlayingAudio&&window._currentPlayingAudio!==audioEl){window._currentPlayingAudio.pause()}window._currentPlayingAudio=audioEl;audioEl.play().catch(e=>{console.error('Audio playback error',e);toast('تعذر تشغيل الصوت','error')})}else{audioEl.pause()}};audioEl.onplay=()=>{iconPlay.classList.add('hidden');iconPause.classList.remove('hidden')};audioEl.onpause=()=>{iconPlay.classList.remove('hidden');iconPause.classList.add('hidden')};audioEl.ontimeupdate=()=>{const total=audioEl.duration&&!isNaN(audioEl.duration)?audioEl.duration:durTotal;const cur=audioEl.currentTime||0;const pct=total>0?Math.min(100,(cur/total)*100):0;if(fill)fill.style.width=pct+'%';if(thumb)thumb.style.left=pct+'%';if(timeText)timeText.textContent=`${formatAudioTime(cur)} / ${formatAudioTime(total)}`};audioEl.onended=()=>{iconPlay.classList.remove('hidden');iconPause.classList.add('hidden');if(fill)fill.style.width='0%';if(thumb)thumb.style.left='0%';if(timeText)timeText.textContent=`0:00 / ${formatAudioTime(audioEl.duration||durTotal)}`};if(seekBar){seekBar.onclick=e=>{const rect=seekBar.getBoundingClientRect();const clickPos=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));const total=audioEl.duration&&!isNaN(audioEl.duration)?audioEl.duration:durTotal;if(total>0){audioEl.currentTime=clickPos*total}}}}}if(m.type==='IMAGE'){const wrap=el.querySelector('.message-image-wrap');if(wrap)wrap.onclick=()=>openImageLightbox(wrap.dataset.imgUrl,wrap.dataset.imgName);}container.append(el);container.scrollTop=container.scrollHeight}async function startProject(id){try{await api('/api/projects/'+id+'/start',{method:'POST',body:'{}'});toast('بدأت مهمة التصميم');openProject(id)}catch(e){toast(e.message,'error')}}function uploadVersion(id){modal('تسليم التصميم','<div class="field"><label>ملاحظات النسخة</label><textarea name="notes" rows="3"></textarea></div><div class="field"><label>أسماء الخيارات (اختياري)</label><input name="options" placeholder="الخيار A, الخيار B, الخيار C"></div><div class="field"><label>ملفات الخيار A</label><input name="option_0" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></div><div class="field"><label>ملفات الخيار B</label><input name="option_1" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></div><div class="field"><label>ملفات الخيار C</label><input name="option_2" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></div>',async f=>{const r=await fetch('/api/projects/'+id+'/versions',{method:'POST',body:f,credentials:'same-origin'});if(!r.ok)throw Error((await r.json()).error||'فشل رفع النسخة');return r.json()},'إرسال للمراجعة')}function normalizeSaudiPhone(value){let p=String(value||'').replace(/[^0-9+]/g,'');if(p.startsWith('00'))p='+'+p.slice(2);if(p.startsWith('+966'))p=p.slice(1);else if(p.startsWith('966'))p=p;else if(p.startsWith('05'))p='966'+p.slice(1);else if(p.startsWith('5'))p='966'+p;else return '';return /^9665[0-9]{8}$/.test(p)?p:''}async function generateAccess(id,phone='',clientName='العميل'){try{const d=await api('/api/projects/'+id+'/access',{method:'POST',body:'{}'}),url=new URL(d.url,location.origin).href,waPhone=normalizeSaudiPhone(phone),waText=encodeURIComponent(`مرحبًا،\n\nتم تجهيز بوابة خاصة لمتابعة مشروع التصميم الخاص بكم مع G.PACK.\n\nيمكنكم الدخول إلى المشروع ومتابعة التصميم والتواصل مع المصمم وطلب التعديلات واعتماد التصميم من خلال الرابط التالي:\n\n${url}\n\nمع تحيات فريق G.PACK`);modal('رابط بوابة العميل',`<p class="muted">شارك هذا الرابط مع ${esc(clientName)} للوصول إلى مشروعه.</p><div class="copy-link"><input id="portal-link" value="${esc(url)}" readonly><button type="button" onclick="copyPortalLink()">نسخ</button></div><div class="link-status"><span class="status status-approved"><i></i>الرابط نشط</span></div><div class="link-actions"><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">فتح الرابط</a>${waPhone?`<a class="btn whatsapp-button" href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener noreferrer">إرسال عبر واتساب</a>`:'<button type="button" class="btn btn-soft" onclick="state.tab=\'clients\';renderInternal();toast(\'أضف رقم جوال العميل لاستخدام الإرسال عبر واتساب\')">إضافة رقم واتساب</button>'}</div><hr><button type="button" class="link-danger" onclick="regenerateAccess(${id},'${esc(phone)}','${esc(clientName)}')">تجديد الرابط</button><button type="button" class="link-danger" onclick="revokeAccess(${id})">إلغاء الوصول</button>`,async()=>{},'إغلاق')}catch(e){toast('تعذر إنشاء رابط العميل','error')}}async function copyPortalLink(){try{await navigator.clipboard.writeText($('#portal-link').value);toast('تم نسخ رابط العميل')}catch{toast('تعذر النسخ تلقائياً، حدّد الرابط وانسخه يدوياً','error')}}async function regenerateAccess(id,phone,name){if(!confirm('سيتم إلغاء الرابط الحالي وإنشاء رابط جديد. هل تريد المتابعة؟'))return;$('#modal')?.remove();generateAccess(id,phone,name)}async function revokeAccess(id){if(!confirm('لن يتمكن العميل من فتح البوابة بالرابط الحالي. هل تريد إلغاء الوصول؟'))return;try{await api('/api/projects/'+id+'/access/revoke',{method:'POST',body:'{}'});$('#modal')?.remove();toast('تم إلغاء وصول العميل');renderInternal()}catch(e){toast(e.message,'error')}}
async function renderPortal(){
  try{
    const m=await api('/api/portal/me'),full=await api('/api/portal/'+m.project.id);
    state.portalData=full;
    state.portalProject=m.project;
    clientPortalView();
  }catch(e){
    document.body.innerHTML=`<main class="login"><div class="login-card"><div class="brand brand-large"><img class="brand-image" src="/brand-logo.png" alt="G.PACK"></div><h2>تعذر الوصول إلى المشروع</h2><p class="muted">${esc(e.message)}<br>استخدم رابط الوصول المرسل من G.PACK.</p></div></main>`;
  }
}

function selectClientVersion(id){
  state.selectedVersionId=id;
  clientPortalView();
}

function clientPortalView(){
  closeStream();
  const d=state.portalData,p=d.project;
  const activeVerId=state.selectedVersionId||d.versions[0]?.id;
  const v=d.versions.find(x=>x.id===activeVerId)||d.versions[0];
  const isLatest=v&&d.versions[0]&&v.id===d.versions[0].id;
  const vfiles=v?d.files.filter(f=>f.version_id===v.id):[];
  const clientOptions=v?normalizeOptions(v.options||[],vfiles):[];
  const selectedOption=clientOptions.find(o=>o.status==='SELECTED'||o.status==='APPROVED')||clientOptions[0];
  const mainFiles=selectedOption?selectedOption.files:(clientOptions.length?[]:vfiles);

  state.clientFilesTab=state.clientFilesTab||'all';
  const totalFiles=(d.files||[]).length;
  const designerCount=(d.files||[]).filter(f=>f.uploaded_by_type==='DESIGNER'||f.uploaded_by_type==='ADMIN').length;
  const clientCount=(d.files||[]).filter(f=>f.uploaded_by_type==='CLIENT').length;

  const currentOptionLabel=selectedOption?formatOptionName(selectedOption.name):(v?('الإصدار V'+v.number):'التصميم');
  const fullDesignTitle=selectedOption?(formatOptionName(selectedOption.name)+(v?(' — الإصدار V'+v.number):'')):(v?('الإصدار V'+v.number):'التصميم قيد التجهيز');

  document.body.innerHTML=`
    <main class="client-portal client-redesign">
      <!-- 1. Header: Logo Right, Client Name Left -->
      <header class="client-nav-header">
        <div class="brand"><img class="brand-logo-img" src="/brand-logo.png" alt="G.PACK"></div>
        <div class="client-header-user">
          <span class="user-tag">بوابة العميل</span>
          <b class="user-display-name">${esc(d.client.name)}</b>
        </div>
      </header>

      <!-- 2. Project Hero Banner -->
      <section class="client-project-banner">
        <div class="client-project-titles">
          <span class="eyebrow" style="color:var(--muted);font-size:12px;font-weight:700;">المشروع</span>
          <h1>${esc(p.name)}</h1>
          <p>${esc(statusText[p.status]||'تابع آخر مستجدات وتفاصيل مشروعك')}</p>
        </div>
        <div class="client-project-status-box">
          ${badge(p.status)}
          <small class="muted" style="font-size:12px;">آخر تحديث ${ago(p.updated_at)}</small>
        </div>
      </section>

      <!-- 3. Post-Closure Thank You & Rating Experience (If Completed) -->
      ${p.status==='COMPLETED'?`
        <section class="client-closed-feedback-card" id="client-review-section">
          <span class="heart-icon">❤️</span>
          <h2>شكرًا لك</h2>
          <p>تم إغلاق المشروع بنجاح ويسعدنا معرفة رأيك في تجربتك مع المصمم.</p>
          ${d.review?`
            <div class="submitted-review-box">
              <span class="submitted-stars">${'★'.repeat(d.review.rating)}${'☆'.repeat(5-d.review.rating)} (${d.review.rating}/5)</span>
              <strong style="color:var(--ink);font-size:15px;display:block;">تقييمك لتجربتك مع المصمم</strong>
              ${d.review.comment?`<p class="submitted-comment">"${esc(d.review.comment)}"</p>`:''}
              <small class="muted" style="display:block;margin-top:8px;">شكرًا على مشاركتنا رأيك!</small>
            </div>
          `:`
            <div class="review-form-wrap" id="review-form-wrap">
              <span style="font-size:14px;font-weight:800;color:var(--purple);display:block;margin-bottom:6px;">قيّم تجربتك مع المصمم</span>
              <div class="rating-stars-group" id="rating-stars-group">
                <button type="button" class="star-btn active" data-val="1" aria-label="1 نجمة">★</button>
                <button type="button" class="star-btn active" data-val="2" aria-label="2 نجمتان">★</button>
                <button type="button" class="star-btn active" data-val="3" aria-label="3 نجوم">★</button>
                <button type="button" class="star-btn active" data-val="4" aria-label="4 نجوم">★</button>
                <button type="button" class="star-btn active" data-val="5" aria-label="5 نجوم">★</button>
              </div>
              <input type="hidden" id="selected-rating-val" value="5">
              <textarea id="review-comment-input" class="review-comment-textarea" rows="3" placeholder="أخبرنا برأيك أو ملاحظاتك الإضافية (اختياري)..."></textarea>
              <button type="button" id="btn-submit-review" class="btn-submit-review">إرسال التقييم</button>
            </div>
          `}
        </section>
      `:''}

      <!-- 4. Primary Design Stage Card -->
      <section class="client-design-card">
        <div class="design-card-head">
          <div class="design-identity-title">
            <h2 id="design-identity-heading">${fullDesignTitle}</h2>
            ${v?`<span class="version-pill ${isLatest?'':'is-prev'}">V${v.number}</span>`:''}
          </div>
          <div class="design-status-badge-wrap" id="design-status-badge-wrap">
            ${v?.status==='APPROVED'?'<span class="status status-approved"><i></i> معتمد نهائيًا</span>':(p.status==='REVISION_REQUESTED'?'<span class="status status-review"><i></i> تم طلب تعديل</span>':'<span class="status status-waiting"><i></i> بانتظار المراجعة</span>')}
          </div>
        </div>

        ${v?`
          <!-- Large Main Preview -->
          <div class="design-card-main-preview client-design-stage">
            ${clientPreview(mainFiles,v.number)}
          </div>

          <!-- Explicit Design Options Selector -->
          ${clientOptions.length?`
            <div class="design-options-selector">
              <span class="design-options-selector-title">خيارات التصميم المتاحة (${clientOptions.length} خيارات)</span>
              <div class="design-options-cards-grid">
                ${clientOptions.map((o,i)=>{
                  const isSelected=selectedOption&&selectedOption.id===o.id;
                  const isApproved=o.status==='APPROVED';
                  return `
                    <div class="client-opt-btn ${isSelected?'is-active':''} ${isApproved?'is-approved':''}" data-option-id="${o.id}" onclick="selectOption(${o.id})" role="button" tabindex="0">
                      <span class="client-opt-radio"></span>
                      <span class="client-opt-label">${formatOptionName(o.name)||('الخيار '+(i+1))}</span>
                      ${isSelected?`<span class="client-opt-badge-pill ${isApproved?'approved':''}">${isApproved?'✓ معتمد':'مختار للمراجعة'}</span>`:''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `:''}

          <!-- Versions History (Responsive Chips) -->
          ${d.versions.length>1?`
            <div class="version-history" style="margin-top:16px;">
              <span class="version-history-label">النسخ السابقة:</span>
              <div class="version-chips-wrap" role="tablist" aria-label="النسخ السابقة">
                ${[...d.versions].sort((a,b)=>a.number-b.number).map(x=>{
                  const isSelected=x.id===v.id;
                  const isCur=x.id===d.versions[0].id;
                  const label=isCur?'الحالية':(x.status==='APPROVED'?'معتمدة':'سابقة');
                  return `<button type="button" class="version-chip ${isSelected?'active is-selected':''} ${x.status==='APPROVED'?'is-approved':''}" onclick="selectClientVersion(${x.id})">
                    <span class="version-chip-num">V${x.number}</span>
                    <span class="version-chip-sep">·</span>
                    <span class="version-chip-status">${label}</span>
                  </button>`;
                }).join('')}
              </div>
            </div>
          `:''}

          <!-- Prominent Action Bar -->
          <div id="client-decision-bar-wrap">
            ${isLatest&&v.status==='PENDING'?`
              <div class="client-decision-bar">
                <div style="flex:1;">
                  <strong style="display:block;font-size:14px;color:var(--ink);">هل أنت راضٍ عن هذا التصميم؟</strong>
                  <small class="muted">يمكنك طلب تعديلات محددة أو اعتماد التصميم رسميًا للمشروع.</small>
                </div>
                <button type="button" class="btn-client-revision" id="client-revision">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  <span>طلب تعديل</span>
                </button>
                <button type="button" class="btn-client-approve" id="client-approve">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>اعتماد التصميم</span>
                </button>
              </div>
            `:(v.status==='APPROVED'?`
              <div class="client-decision-bar" style="background:#f0fdf4;border-color:#bbf7d0;">
                <span style="font-size:22px;">✅</span>
                <div style="flex:1;">
                  <strong style="color:#166534;font-size:14px;">تم اعتماد هذا التصميم بنجاح</strong>
                  <small style="color:#15803d;display:block;">النسخة المعتمدة: ${selectedOption?formatOptionName(selectedOption.name)+' — ':''}الإصدار V${v.number}</small>
                </div>
              </div>
            `:(!isLatest?`
              <div class="client-decision-bar">
                <span class="muted" style="flex:1;">أنت تتصفح إصداراً سابقاً (V${v.number}) للاطلاع والمقارنة.</span>
                <button type="button" class="btn btn-soft" onclick="selectClientVersion(${d.versions[0].id})">العودة للتصميم الأخير (V${d.versions[0].number}) ←</button>
              </div>
            `:''))}
          </div>
        `:`
          <div class="design-empty">
            <span>✦</span>
            <h3>التصميم قيد التجهيز</h3>
            <p>سيظهر التصميم هنا بمجرد رفعه من المصمم.</p>
          </div>
        `}
      </section>

      <!-- 5. WhatsApp-Style Conversation Section -->
      <section class="client-conversation" style="background:#ffffff;border-radius:24px;border:1px solid var(--line);box-shadow:0 8px 30px rgba(90,61,99,0.06);margin-bottom:24px;overflow:hidden;">
        <div class="section-heading" style="padding:18px 24px;border-bottom:1px solid var(--line);margin:0;">
          <div>
            <span class="eyebrow">تواصل فوري</span>
            <h2 style="font-size:18px;margin:0;">المحادثة المباشرة</h2>
          </div>
          <span class="live-pill"><i></i> مباشرة</span>
        </div>
        <div class="messages" id="messages" style="min-height:350px;max-height:550px;overflow-y:auto;padding:20px;background:#fdfcfd;"></div>
        <form class="client-composer" id="client-composer">
          <input type="file" id="client-file" hidden accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/illustrator,application/postscript,application/x-photoshop,image/vnd.adobe.photoshop">
          <button type="button" class="attach-button" id="attach-button" aria-label="إرفاق ملف" title="إرفاق ملف">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.49-8.49a4 4 0 0 1 5.66 5.66l-8.5 8.5a2 2 0 0 1-2.83-2.83l7.78-7.78"/></svg>
          </button>
          <input name="body" placeholder="اكتب رسالتك أو ملاحظتك هنا..." autocomplete="off">
          <button type="button" class="voice-record-btn" id="client-voice-btn" aria-label="تسجيل رسالة صوتية" title="تسجيل رسالة صوتية">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          </button>
          <button class="send-button" aria-label="إرسال">➤</button>
          <div id="attachment-preview" class="attachment-preview hidden"></div>
          <div id="client-voice-bar" class="voice-composer-bar hidden"></div>
        </form>
      </section>

      <!-- 6. Unified Project Files Card -->
      <section class="client-unified-files-card">
        <div class="unified-files-head">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>ملفات المشروع الموحدة</span>
          </h3>
          <div class="files-tabs-wrap client-files-tabs">
            <button type="button" class="files-tab-btn client-files-tab-btn ${(state.clientFilesTab||'all')==='all'?'active':''}" data-tab="all" onclick="setClientFilesTab('all')">
              <span>كل الملفات</span>
              <span class="files-count-badge">${totalFiles}</span>
            </button>
            <button type="button" class="files-tab-btn client-files-tab-btn ${state.clientFilesTab==='designer'?'active':''}" data-tab="designer" onclick="setClientFilesTab('designer')">
              <span>ملفات التصميم</span>
              <span class="files-count-badge">${designerCount}</span>
            </button>
            <button type="button" class="files-tab-btn client-files-tab-btn ${state.clientFilesTab==='client'?'active':''}" data-tab="client" onclick="setClientFilesTab('client')">
              <span>ملفاتي</span>
              <span class="files-count-badge">${clientCount}</span>
            </button>
          </div>
        </div>
        <div class="client-card-scroll client-files-scroll" id="client-files-scroll-list">
          ${renderClientFilesList(d.files,state.clientFilesTab||'all')}
        </div>
      </section>
    </main>
  `;

  loadPortalMessages();

  // Setup Attachment & Composer
  $('#attach-button').onclick=()=>$('#client-file').click();
  setupAttachmentPreview($('#client-file'),$('#attachment-preview'));

  $('#client-composer').onsubmit=async e=>{
    e.preventDefault();
    const input=e.target.body,file=$('#client-file').files[0];
    if(!input.value.trim()&&!file)return;
    const btn=e.target.querySelector('.send-button');
    if(btn)btn.disabled=true;
    try{
      if(file){
        const fd=new FormData();
        fd.append('file',file);
        if(input.value.trim())fd.append('body',input.value.trim());
        fd.append('client_event_id',crypto.randomUUID());
        const resMsg=await api('/api/portal/'+p.id+'/messages/attachment',{method:'POST',body:fd});
        if(resMsg){
          appendMessage(resMsg);
          syncPortalFileFromMessage(resMsg);
        }
      }else{
        const resMsg=await api('/api/portal/'+p.id+'/messages',{method:'POST',body:JSON.stringify({body:input.value.trim(),client_event_id:crypto.randomUUID()})});
        if(resMsg)appendMessage(resMsg);
      }
      e.target.reset();
      $('#client-file').value='';
      const box=$('#attachment-preview');
      if(box){box.classList.add('hidden');box.innerHTML='';}
      toast('تم الإرسال');
    }catch(x){
      toast(x.message||'تعذر إرسال المرفق','error');
    }finally{
      if(btn)btn.disabled=false;
    }
  };

  setupVoiceComposer({
    composer:$('#client-composer'),
    recordBtn:$('#client-voice-btn'),
    bar:$('#client-voice-bar'),
    uploadEndpoint:'/api/portal/'+p.id+'/messages/voice'
  });

  // Setup Revision Modal Action
  if(v?.status==='PENDING'){
    const revBtn=$('#client-revision');
    if(revBtn){
      revBtn.onclick=()=>{
        const targetDesc=(selectedOption?formatOptionName(selectedOption.name)+' — ':'')+('الإصدار V'+v.number);
        modal('طلب تعديل على '+targetDesc,`
          <div class="field">
            <label style="font-weight:700;margin-bottom:6px;display:block;">التصميم المستهدف: <span style="color:var(--purple);">${esc(targetDesc)}</span></label>
            <p class="muted" style="font-size:13px;margin:0 0 10px;">اكتب ملاحظاتك وتعديلاتك المطلوبة بدقة ليقوم المصمم بتنفيذها في النسخة التالية.</p>
            <textarea name="request" rows="5" required placeholder="مثال: يرجى تعديل موضع الشعار وجعل اللون الذهبي بدرجة أفتح..."></textarea>
          </div>
        `,async f=>{
          const reqText=f.get('request');
          await api('/api/portal/'+p.id+'/revisions',{
            method:'POST',
            body:JSON.stringify({
              version_id:v.id,
              option_id:selectedOption?.id||null,
              request:reqText
            })
          });
          toast('تم إرسال طلب التعديل بنجاح');
          // Optimistic in-place update without tearing down the chat
          p.status='REVISION_REQUESTED';
          const badgeWrap=$('#design-status-badge-wrap');
          if(badgeWrap)badgeWrap.innerHTML='<span class="status status-review"><i></i> تم طلب تعديل</span>';
          const decisionWrap=$('#client-decision-bar-wrap');
          if(decisionWrap){
            decisionWrap.innerHTML=`
              <div class="client-decision-bar" style="background:#fdf2f2;border-color:#fecaca;">
                <span style="font-size:20px;">🔄</span>
                <div style="flex:1;">
                  <strong style="color:#991b1b;font-size:14px;">تم إرسال طلب التعديل للمصمم</strong>
                  <small style="color:#b91c1c;display:block;">سيعمل المصمم على تجهيز النسخة القادمة بناءً على ملاحظاتك.</small>
                </div>
              </div>
            `;
          }
        },'إرسال طلب التعديل');
      };
    }

    // Setup Approval Modal Action
    const appBtn=$('#client-approve');
    if(appBtn){
      appBtn.onclick=()=>{
        const targetDesc=(selectedOption?formatOptionName(selectedOption.name)+' — ':'')+('الإصدار V'+v.number);
        modal('تأكيد اعتماد التصميم',`
          <div class="portal-confirm-modal">
            <div class="portal-confirm-icon">⭐</div>
            <div class="portal-confirm-title">اعتماد ${esc(targetDesc)}</div>
            <p class="portal-confirm-desc">هل أنت متأكد من اعتماد هذا التصميم نهائيًا؟ بمجرد الاعتماد سيتم اعتماد النسخة وتجهيز المشروع للإغلاق والتسليم النهائي.</p>
          </div>
        `,async()=>{
          await api('/api/portal/'+p.id+'/approve',{
            method:'POST',
            body:JSON.stringify({
              version_id:v.id,
              option_id:selectedOption?.id||null
            })
          });
          toast('تم اعتماد التصميم بنجاح');
          v.status='APPROVED';
          p.status='APPROVED';
          const badgeWrap=$('#design-status-badge-wrap');
          if(badgeWrap)badgeWrap.innerHTML='<span class="status status-approved"><i></i> معتمد نهائيًا</span>';
          const decisionWrap=$('#client-decision-bar-wrap');
          if(decisionWrap){
            decisionWrap.innerHTML=`
              <div class="client-decision-bar" style="background:#f0fdf4;border-color:#bbf7d0;">
                <span style="font-size:22px;">✅</span>
                <div style="flex:1;">
                  <strong style="color:#166534;font-size:14px;">تم اعتماد هذا التصميم بنجاح</strong>
                  <small style="color:#15803d;display:block;">النسخة المعتمدة: ${esc(targetDesc)}</small>
                </div>
              </div>
            `;
          }
        },'نعم، اعتماد التصميم نهائيًا');
      };
    }
  }

  // Setup Star Rating in Post-Closure section
  setupRatingSection(p.id);

  // Realtime SSE
  openStream('/api/portal/'+p.id+'/stream',x=>{
    if(x.type==='message'){
      appendMessage(x.message);
      if(x.message&&x.message.file_id)syncPortalFileFromMessage(x.message);
    }else if(x.type==='file'){
      if(x.file)syncPortalFileFromMessage({file_id:x.file.id,original_name:x.file.original_name,mime:x.file.mime,file_size:x.file.size,created_at:x.file.created_at,sender_type:x.file.uploaded_by_type});
    }else if(x.type==='option'){
      // Update selected option in DOM without page reload
      updateSelectedOptionUI(x.id);
    }else if(x.type==='revision'){
      const bWrap=$('#design-status-badge-wrap');
      if(bWrap)bWrap.innerHTML='<span class="status status-review"><i></i> تم طلب تعديل</span>';
    }else if(x.type==='approved'){
      const bWrap=$('#design-status-badge-wrap');
      if(bWrap)bWrap.innerHTML='<span class="status status-approved"><i></i> معتمد نهائيًا</span>';
    }else if(x.type==='status'){
      if(x.status==='COMPLETED'){
        clientPortalRefresh();
      }
    }else if(x.type==='review'){
      if(state.portalData)state.portalData.review=x.review;
      renderSubmittedReview(x.review);
    }else if(x.type==='version'){
      clientPortalRefresh();
    }
  });

  // Background sync fallback (every 20s without resetting scroll or chat)
  clearInterval(state.syncTimer);
  state.syncTimer=setInterval(async()=>{
    try{
      const fresh=await api('/api/portal/'+p.id),old=state.portalData?.project?.updated_at;
      if(fresh.project.updated_at!==old){
        state.portalData=fresh;
        // If versions changed or project status changed to completed, refresh view
        if(fresh.versions.length!==d.versions.length||fresh.project.status!==p.status){
          clientPortalView();
        }
      }
    }catch{}
  },20000);
}

function setupRatingSection(projectId){
  const starsGroup=$('#rating-stars-group');
  if(!starsGroup)return;
  const stars=starsGroup.querySelectorAll('.star-btn');
  const ratingInput=$('#selected-rating-val');
  stars.forEach(btn=>{
    btn.onmouseover=()=>{
      const val=Number(btn.dataset.val);
      stars.forEach(s=>s.classList.toggle('active',Number(s.dataset.val)<=val));
    };
    btn.onclick=()=>{
      const val=Number(btn.dataset.val);
      ratingInput.value=val;
      stars.forEach(s=>s.classList.toggle('active',Number(s.dataset.val)<=val));
    };
  });
  starsGroup.onmouseleave=()=>{
    const currentVal=Number(ratingInput.value)||5;
    stars.forEach(s=>s.classList.toggle('active',Number(s.dataset.val)<=currentVal));
  };

  const submitBtn=$('#btn-submit-review');
  if(submitBtn){
    submitBtn.onclick=async()=>{
      const rating=Number(ratingInput.value)||5;
      const comment=($('#review-comment-input')?.value||'').trim();
      submitBtn.disabled=true;
      submitBtn.textContent='جارٍ الإرسال...';
      try{
        const review=await api('/api/portal/'+projectId+'/review',{
          method:'POST',
          body:JSON.stringify({rating,comment})
        });
        toast('شكرًا جزيلاً على تقييمك!');
        if(state.portalData)state.portalData.review=review;
        renderSubmittedReview(review);
      }catch(err){
        toast(err.message||'تعذر إرسال التقييم','error');
        submitBtn.disabled=false;
        submitBtn.textContent='إرسال التقييم';
      }
    };
  }
}

function renderSubmittedReview(review){
  const formWrap=$('#review-form-wrap');
  if(!formWrap||!review)return;
  formWrap.outerHTML=`
    <div class="submitted-review-box">
      <span class="submitted-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)} (${review.rating}/5)</span>
      <strong style="color:var(--ink);font-size:15px;display:block;">تقييمك لتجربتك مع المصمم</strong>
      ${review.comment?`<p class="submitted-comment">"${esc(review.comment)}"</p>`:''}
      <small class="muted" style="display:block;margin-top:8px;">شكرًا على مشاركتنا رأيك!</small>
    </div>
  `;
}

function updateSelectedOptionUI(id){
  const activeVerId=state.selectedVersionId||state.portalData?.versions[0]?.id;
  const v=state.portalData?.versions.find(x=>x.id===activeVerId)||state.portalData?.versions[0];
  if(!v)return;
  const vfiles=state.portalData?.files?state.portalData.files.filter(f=>f.version_id===v.id):[];
  const opts=normalizeOptions(v.options||[],vfiles);
  const targetOpt=opts.find(o=>o.id===id);

  document.querySelectorAll('.client-opt-btn').forEach(btn=>{
    const cardId=Number(btn.dataset.optionId);
    const isThis=cardId===id;
    btn.classList.toggle('is-active',isThis);
    btn.querySelector('.client-opt-badge-pill')?.remove();
    if(isThis&&!btn.classList.contains('is-approved')){
      btn.insertAdjacentHTML('beforeend','<span class="client-opt-badge-pill">مختار للمراجعة</span>');
    }
  });

  if(targetOpt){
    const heading=$('#design-identity-heading');
    if(heading)heading.textContent=formatOptionName(targetOpt.name)+' — الإصدار V'+v.number;
    const stage=document.querySelector('.client-design-stage');
    if(stage)stage.innerHTML=clientPreview(targetOpt.files,v.number);
  }
}

async function selectOption(id){
  if(!state.portalData?.versions?.length)return;
  const activeVerId=state.selectedVersionId||state.portalData.versions[0].id;
  const v=state.portalData.versions.find(x=>x.id===activeVerId)||state.portalData.versions[0];
  const vfiles=state.portalData.files?state.portalData.files.filter(f=>f.version_id===v.id):[];
  const opts=normalizeOptions(v.options||[],vfiles);
  const targetOpt=opts.find(o=>o.id===id);
  if(!targetOpt)return;

  // Immediate optimistic UI update
  updateSelectedOptionUI(id);

  // Update in memory
  v.options?.forEach(o=>{
    if(o.id===id)o.status='SELECTED';
    else if(o.status!=='APPROVED')o.status='PROPOSED';
  });

  try{
    await api('/api/portal/'+state.portalData.project.id+'/options/select',{
      method:'POST',
      body:JSON.stringify({version_id:v.id,option_id:id})
    });
    toast('تم اختيار التصميم للمراجعة');
  }catch(e){
    toast(e.message,'error');
  }
}

function setClientFilesTab(tab){
  state.clientFilesTab=tab;
  document.querySelectorAll('.client-files-tab-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.tab===tab);
  });
  const listEl=document.querySelector('#client-files-scroll-list');
  if(listEl&&state.portalData?.files){
    listEl.innerHTML=renderClientFilesList(state.portalData.files,tab);
  }
}

function renderClientFilesList(files=[],activeTab='all'){
  const filtered=files.filter(f=>{
    if(activeTab==='client')return f.uploaded_by_type==='CLIENT';
    if(activeTab==='designer')return f.uploaded_by_type==='DESIGNER'||f.uploaded_by_type==='ADMIN';
    return true; // all
  });
  if(!filtered.length){
    const emptyMsg=activeTab==='client'?'لا توجد ملفات مرفقة من طرفك':(activeTab==='designer'?'لا توجد ملفات من المصمم بعد':'لا توجد ملفات في المشروع بعد');
    return `<div class="compact-empty">${emptyMsg}</div>`;
  }
  return filtered.map(renderClientFileRow).join('');
}

function renderClientFileRow(f){
  const info=getFileTypeInfo(f);
  const pId=state.portalData?.project?.id;
  const url=`/api/portal/${pId}/files/${f.id}`;
  const iconHtml=info.isImage?`<div class="file-thumb-mini-wrap"><img src="${url}" alt="${esc(f.original_name)}" class="file-thumb-mini" loading="lazy"></div>`:`<div class="file-icon-badge ${info.badgeClass}"><span>${info.type}</span></div>`;
  const uploaderText=f.uploaded_by_type==='CLIENT'?'مرفق من طرفك':'مرفق من المصمم';
  const chatBadge=f.message_id?'<span class="file-source-badge file-source-chat">مرفق محادثة</span>':'<span class="file-source-badge file-source-upload">ملف تصميم</span>';
  return `<div class="compact-file-row">
    <div class="file-row-main">
      ${iconHtml}
      <div class="file-row-details">
        <span class="file-row-name" title="${esc(f.original_name)}">${esc(f.original_name)}</span>
        <div class="file-row-meta">
          <span class="file-row-size">${info.size}</span>
          <span class="file-row-dot">•</span>
          <span class="file-row-uploader">${uploaderText}</span>
          <span class="file-row-dot">•</span>
          ${chatBadge}
        </div>
      </div>
    </div>
    <div class="file-row-action">
      <a href="${url}" target="_blank" download="${esc(f.original_name)}" class="file-action-btn" title="تحميل / فتح">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>
    </div>
  </div>`;
}

function clientPreview(files,n){
  const f=files.find(x=>x.mime.startsWith('image/')),url=f?'/api/portal/'+state.portalData.project.id+'/files/'+f.id:'';
  return f?`<a href="${url}" target="_blank" class="client-image-link" style="display:block;width:100%;height:100%;text-align:center;"><img src="${url}" alt="التصميم V${n}" style="max-width:100%;max-height:550px;object-fit:contain;border-radius:12px;"><span style="display:block;margin-top:8px;font-size:13px;color:var(--purple);font-weight:700;">فتح بالحجم الكامل ↗</span></a>`:`<div class="file-design-placeholder" style="padding:40px 20px;text-align:center;color:var(--muted);"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;opacity:0.6;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><div style="font-weight:800;font-size:15px;color:var(--ink);margin-bottom:4px;">اختر أحد خيارات التصميم للمعاينة</div><small>كل خيار تصميم له معاينة وصور مستقلة</small></div>`;
}

function clientFile(f){
  return renderClientFileRow(f);
}

async function loadPortalMessages(){
  const ms=await api('/api/portal/'+state.portalData.project.id+'/messages');
  $('#messages').innerHTML='';
  ms.forEach(appendMessage);
}

function compareOptions(v,d){
  const opts=normalizeOptions(v.options||[],d.files.filter(f=>f.version_id===v.id));
  modal('مقارنة التصميمات',`<div class="compare-grid">${opts.map(o=>`<div class="compare-option"><h3>${esc(o.name)}</h3>${clientOptionPreview(d,o,d.files.filter(f=>f.version_id===v.id))}</div>`).join('')}</div>`,async()=>{},'إغلاق');
}

function clientOptionPreview(d,o,files){
  return optionImage(o,true);
}

async function clientPortalRefresh(){
  const d=await api('/api/portal/'+state.portalData.project.id);
  state.portalData=d;
  if(state.selectedVersionId&&!d.versions.some(x=>x.id===state.selectedVersionId)){
    state.selectedVersionId=null;
  }
  clientPortalView();
}

async function logout(){closeStream();await api('/api/auth/logout',{method:'POST'}).catch(()=>{});state.user=null;login()}async function activityCenter(v){const q=new URLSearchParams();if(state.activityType)q.set('type',state.activityType);if(state.activitySearch)q.set('search',state.activitySearch);q.set('page',state.activityPage||1);const d=await api('/api/activity?'+q);const s=d.summary;v.innerHTML=`<div class="manager-page-container"><header class="page-header"><div><span class="eyebrow">مركز العمليات</span><h1>النشاط</h1><p>سجل موحد لأحدث أحداث المشاريع والمستخدمين.</p></div></header><section class="kpi-grid manager-kpis">${kpi('إجمالي الأحداث',s.total,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>','purple')}${kpi('اليوم',s.today,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','gold')}${kpi('هذا الأسبوع',s.week,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>','blue')}${kpi('طلبات التعديل',s.revisions,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>','red')}${kpi('التصميمات المعتمدة',s.approvals,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15l-2 5 2-1 2 1-2-5"/><circle cx="12" cy="8" r="6"/><path d="m9 8 2 2 4-4"/></svg>','green')}</section><div class="manager-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" placeholder="ابحث بالمشروع أو العميل أو الحدث..." value="${esc(state.activitySearch||'')}" oninput="state.activitySearch=this.value;clearTimeout(window.activityTimer);window.activityTimer=setTimeout(()=>{state.activityPage=1;activityCenter($('#internal-view'))},350)"></div><div class="filter-chips"><button class="filter-chip ${!state.activityType?'active':''}" onclick="state.activityType='';activityCenter($('#internal-view'))">كل النشاط</button><button class="filter-chip ${state.activityType==='projects'?'active':''}" onclick="state.activityType='projects';activityCenter($('#internal-view'))">المشاريع</button><button class="filter-chip ${state.activityType==='designs'?'active':''}" onclick="state.activityType='designs';activityCenter($('#internal-view'))">التصميمات</button><button class="filter-chip ${state.activityType==='revisions'?'active':''}" onclick="state.activityType='revisions';activityCenter($('#internal-view'))">التعديلات</button><button class="filter-chip ${state.activityType==='approvals'?'active':''}" onclick="state.activityType='approvals';activityCenter($('#internal-view'))">الاعتمادات</button></div></div><section class="panel activity-feed-panel">${d.events.length?activityCards(d.events):'<div class="empty-state-compact"><div class="empty-icon-pill">⚡</div><h4>لا توجد أنشطة مطابقة</h4><p>سيظهر هنا سجل حركة المشاريع والتصميمات والتحديثات.</p></div>'}<div class="pagination">${d.page>1?'<button class="btn btn-soft btn-sm" onclick="state.activityPage--;activityCenter($(\'#internal-view\'))">‹ السابق</button>':''}<span>صفحة ${d.page} من ${Math.max(1,d.pages)}</span>${d.page<d.pages?'<button class="btn btn-soft btn-sm" onclick="state.activityPage++;activityCenter($(\'#internal-view\'))">التالي ›</button>':''}</div></section></div>`}function activityCards(events){const groups={};const now=new Date();events.forEach(e=>{const d=new Date(e.created_at);const isToday=d.toDateString()===now.toDateString();const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);const isYesterday=d.toDateString()===yesterday.toDateString();const key=isToday?'اليوم':isYesterday?'أمس':d.toLocaleDateString('ar-SA',{day:'numeric',month:'long',year:'numeric'});(groups[key]??=[]).push(e)});return Object.entries(groups).map(([day,items])=>`<div class="activity-day-group"><h3 class="activity-day-title">${day}</h3><div class="activity-day-list">${items.map(e=>`<article class="activity-card-v2" onclick="openProject(${e.project_id})"><div class="activity-card-lead"><span class="activity-icon-pill ${activityKind(e.action)}">${activityIcon(e.action)}</span><div class="activity-card-meta"><div class="activity-action-row"><strong class="activity-action-title">${esc(e.action)}</strong><span class="activity-project-tag">${esc(e.project_name)}</span></div><p class="activity-details-text">${esc(e.details||'تم تحديث بيانات المشروع')}${e.actor_name?` <span class="activity-actor">· بواسطة ${esc(e.actor_name)}</span>`:''}</p></div></div><div class="activity-card-trail"><time class="activity-time-stamp">${new Date(e.created_at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'})}</time><span class="activity-arrow">←</span></div></article>`).join('')}</div></div>`).join('')}function activityKind(a){return a==='اعتماد التصميم'?'approval':a==='طلب تعديل'?'revision':a==='رفع ملف'?'file':a==='إرسال رسالة'?'message':'design'}function activityIcon(a){return a==='اعتماد التصميم'?'✓':a==='طلب تعديل'?'✎':a==='رفع ملف'?'▧':a==='إرسال رسالة'?'💬':'◇'}async function designers2(v){const rows=await api('/api/designers?search='+encodeURIComponent(state.designerSearch||'')+(state.designerFilter?'&active='+state.designerFilter:''));const active=rows.filter(x=>x.active).length,projects=rows.reduce((n,x)=>n+(x.active_projects||0),0),approved=rows.reduce((n,x)=>n+(x.approved_projects||0),0);v.innerHTML=`<div class="manager-page-container"><header class="page-header"><div><span class="eyebrow">إدارة الفريق</span><h1>المصممون</h1><p>متابعة فريق التصميم وتوزيع المشاريع والإنتاجية.</p></div><button class="btn btn-primary" onclick="newDesigner()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>مصمم جديد</span></button></header><section class="kpi-grid manager-kpis">${kpi('إجمالي المصممين',rows.length,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>','purple')}${kpi('المصممون النشطون',active,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>','green')}${kpi('المشاريع قيد التنفيذ',projects,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','gold')}${kpi('التصاميم المعتمدة',approved,'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15l-2 5 2-1 2 1-2-5"/><circle cx="12" cy="8" r="6"/><path d="m9 8 2 2 4-4"/></svg>','blue')}</section><div class="manager-toolbar"><div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg><input class="search-input" id="designer-search-input" placeholder="ابحث باسم المصمم أو البريد أو الجوال..." value="${esc(state.designerSearch||'')}" oninput="state.designerSearch=this.value;clearTimeout(window.designerTimer);window.designerTimer=setTimeout(()=>designers2($('#internal-view')),300)"></div><div class="filter-chips"><button class="filter-chip ${!state.designerFilter?'active':''}" onclick="state.designerFilter='';designers2($('#internal-view'))">الكل (${rows.length})</button><button class="filter-chip ${state.designerFilter==='true'?'active':''}" onclick="state.designerFilter='true';designers2($('#internal-view'))">نشط (${active})</button><button class="filter-chip ${state.designerFilter==='false'?'active':''}" onclick="state.designerFilter='false';designers2($('#internal-view'))">غير نشط (${rows.length-active})</button></div></div><section class="panel designers-panel-v2">${rows.length?`<div class="designers-list-v2">${rows.map(d=>`<article class="designer-card-v2"><div class="designer-card-lead"><div class="designer-avatar-v2">${esc((d.name||'م').slice(0,1))}</div><div class="designer-meta-block"><h3 class="designer-name">${esc(d.name)}</h3><span class="designer-last-active">${d.last_activity?'آخر نشاط '+ago(d.last_activity):'لا يوجد نشاط مسجل بعد'}</span></div></div><div class="designer-contact-block"><div class="contact-line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>${esc(d.email||'—')}</span></div><div class="contact-line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${esc(d.phone||'—')}</span></div></div><div class="designer-stats-block"><div class="stat-pill"><span class="stat-num">${d.active_projects||0}</span><span class="stat-lbl">مشاريع نشطة</span></div><div class="stat-pill stat-pill-approved"><span class="stat-num">${d.approved_projects||0}</span><span class="stat-lbl">معتمدة</span></div></div><div class="designer-status-block">${d.active?'<span class="status-pill status-approved">نشط</span>':'<span class="status-pill status-cancelled">معطل</span>'}</div><div class="designer-actions-block"><button class="btn btn-soft btn-sm" onclick="editDesigner(${d.id},'${esc(d.name)}','${esc(d.email||'')}','${esc(d.phone||'')}',${d.active})">تعديل</button><details class="action-menu"><summary aria-label="خيارات">⋮</summary><div><button onclick="editDesigner(${d.id},'${esc(d.name)}','${esc(d.email||'')}','${esc(d.phone||'')}',${d.active})">تعديل البيانات</button><button onclick="toggleDesigner(${d.id},${d.active},${d.active_projects||0},'${esc(d.name)}')">${d.active?'تعطيل المصمم':'تفعيل المصمم'}</button><button class="danger-text" onclick="deleteDesigner(${d.id},'${esc(d.name)}')">حذف المصمم</button></div></details></div></article>`).join('')}</div>`:'<div class="empty-state-compact"><div class="empty-icon-pill">🎨</div><h4>لا يوجد مصممون مطابقون</h4><p>جرّب تعديل نص البحث أو إضافة مصمم جديد للفريق.</p></div>'}</section></div>`}function editDesigner(id,name,email,phone,active){modal('تعديل بيانات المصمم',`<div class="field"><label>اسم المصمم <span class="req">*</span></label><input name="name" value="${esc(name)}" required></div><div class="form-row-2"><div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" value="${esc(email||'')}"></div><div class="field"><label>رقم الجوال</label><input name="phone" value="${esc(phone||'')}"></div></div><div class="field"><label>كلمة المرور الجديدة</label><input name="password" type="password" placeholder="اتركها فارغة إذا لم ترد تغيير كلمة المرور" autocomplete="new-password"></div><div class="field"><label>حالة الحساب</label><select name="active"><option value="true" ${active?'selected':''}>نشط ومفعل</option><option value="false" ${!active?'selected':''}>معطل</option></select></div>`,async f=>{const b=Object.fromEntries(f);b.active=b.active==='true';return api('/api/designers/'+id,{method:'PATCH',body:JSON.stringify(b)})},'حفظ التغييرات')}async function toggleDesigner(id,active,count,name){if(active&&count>0&&!confirm(`هذا المصمم لديه ${count} مشاريع نشطة. هل تريد تعطيله؟`))return;if(!active&&!confirm('هل تريد تفعيل هذا المصمم؟'))return;try{await api('/api/designers/'+id,{method:'PATCH',body:JSON.stringify({name,active:!active})});toast(active?'تم تعطيل المصمم':'تم تفعيل المصمم');designers2($('#internal-view'))}catch(e){toast(e.message,'error')}}async function deleteDesigner(id,name){if(!confirm(`لا يمكن التراجع عن حذف المصمم ${name} إذا لم تكن لديه سجلات. هل تريد المتابعة؟`))return;try{await api('/api/designers/'+id,{method:'DELETE'});toast('تم حذف المصمم');designers2($('#internal-view'))}catch(e){toast(e.message,'error')}}render();
