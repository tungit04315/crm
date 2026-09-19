/* ================================================================
   LEAD QUICKVIEW DRAWER — leads-quickview.js v1.0
   CRM NeoWave — "Neo Wave CRM — Lead QuickView"

   TÍCH HỢP — chỉ 1 dòng thêm vào index.html, NGAY SAU thẻ:
     <script type="module" src="leads-customers-io.js"></script>

   Thêm:
     <script type="module" src="leads-quickview.js"></script>

   TÍNH NĂNG:
   ─────────────────────────────────────────────────────────────
   - Click vào 1 Lead trong bảng/card → mở Drawer bên phải, danh
     sách Lead phía sau KHÔNG bị đóng / không bị che (desktop).
   - "← Trước / Tiếp →", vuốt (touch) / kéo chuột (drag), và phím
     mũi tên ← → để chuyển Lead kế tiếp ngay trong Drawer, không
     cần đóng - tìm - mở lại.
   - Điều hướng chạy trên đúng tập dữ liệu đang lọc/tìm kiếm/sắp
     xếp hiện tại của bảng Lead (giữ nguyên filter/search/sort).
   - Xem nhanh (READ) → [Chỉnh sửa] → sửa tại chỗ (UPDATE) →
     [Lưu]/[Hủy], cập nhật Firestore, không reload trang.
   - [Xóa] có xác nhận; sau khi xóa tự chuyển sang Lead kế tiếp
     tại đúng vị trí đó, danh sách phía sau tự cập nhật.
   - Copy riêng từng trường (icon ⧉) + "Sao chép tất cả" theo
     định dạng văn bản để dán ra ngoài.
   - Phím tắt: ← / → chuyển Lead, E = Chỉnh sửa, Esc = thoát sửa
     / đóng Drawer. Các phím tắt tự vô hiệu khi đang gõ trong
     input/textarea (không phá hành vi gõ/Ctrl+C bình thường).

   NGUYÊN TẮC AN TOÀN (giống leads-customers-io.js):
   - KHÔNG sửa app.js. Chỉ đọc window.* / DOM đã có sẵn, và ghi
     đè duy nhất window.editLead (để nút "Sửa" ở hàng bảng mở
     Drawer thay vì popup cũ) — có fallback về hành vi gốc.
   - Tự khởi tạo Firestore refs riêng qua getApp(), tự subscribe
     collection 'leads' riêng — không phụ thuộc biến nội bộ của
     app.js (đúng pattern đã dùng trong leads-customers-io.js).
   - Không đổi cấu trúc field Firestore hiện có của Lead (name,
     phone, email, source, type, note, createdAt).
   ================================================================ */

import { getApp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore, collection, doc, updateDoc, deleteDoc,
    onSnapshot, query
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Firebase refs (dùng chung app đã init trong app.js) ─────────
const _db = getFirestore(getApp());
const _appId = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const leadsCol = collection(_db, 'artifacts', _appId, 'public', 'data', 'leads');
const leadDocRef = (id) => doc(_db, 'artifacts', _appId, 'public', 'data', 'leads', id);

const $ = (id) => document.getElementById(id);
const toast = (msg, type = 'success') => window.showToast ? window.showToast(msg, type) : console.log(msg);

// ── State ─────────────────────────────────────────────────────
let _leadsCache = [];   // toàn bộ leads (realtime)
let _navList = [];      // tập đang điều hướng (đã lọc/sắp xếp theo bộ lọc hiện tại)
let _curIndex = -1;
let _editMode = false;
let _activeTab = 'info';
let _draft = null;      // bản nháp khi đang chỉnh sửa

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isoDate(ts) {
    if (!ts) return null;
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toISOString().split('T')[0];
}
function fmtDateTime(ts) {
    if (window.formatDateStr) return window.formatDateStr(ts);
    if (!ts) return '...';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleString('vi-VN');
}
function sortByCreatedAt(arr, order = 'newest') {
    const toMs = (ts) => ts?.seconds ? ts.seconds * 1000 : new Date(ts || 0).getTime();
    return [...arr].sort((a, b) => order === 'oldest' ? toMs(a.createdAt) - toMs(b.createdAt) : toMs(b.createdAt) - toMs(a.createdAt));
}
// Tái tạo đúng logic lọc/sắp xếp của window.renderLeads (app.js) để
// Drawer luôn điều hướng trên đúng tập Lead đang hiển thị cho user.
function getFilteredSortedLeads() {
    const txt = ($('search-lead')?.value || '').toLowerCase();
    const dt = $('filter-lead-date')?.value || '';
    const tp = $('filter-lead-type')?.value || '';
    const sortOrder = $('sort-lead')?.value || 'newest';
    const filtered = _leadsCache.filter(l => {
        const matchTxt = (l.name || '').toLowerCase().includes(txt) || (l.phone || '').includes(txt);
        const matchDt = !dt || isoDate(l.createdAt) === dt;
        const matchTp = !tp || l.type === tp;
        return matchTxt && matchDt && matchTp;
    });
    return sortByCreatedAt(filtered, sortOrder);
}
// Lấy id Lead từ 1 hàng bảng / thẻ mobile bằng cách đọc onclick của
// nút Xóa sẵn có (deleteLead('id')) — không cần render lại danh sách.
function extractLeadId(el) {
    const btn = el.querySelector('[onclick*="deleteLead("]');
    if (!btn) return null;
    const m = btn.getAttribute('onclick').match(/deleteLead\('([^']+)'\)/);
    return m ? m[1] : null;
}
function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
}

// ── CSS (tối thiểu — phần còn lại dùng Tailwind utility có sẵn) ──
function injectStyles() {
    if ($('lqv-styles')) return;
    const style = document.createElement('style');
    style.id = 'lqv-styles';
    style.textContent = `
        #leads-list tr, #leads-card-list .mobile-card-item { cursor: pointer; }
        @keyframes lqvFade { from { opacity:.35; transform: translateX(8px);} to { opacity:1; transform:none; } }
        .lqv-anim-in { animation: lqvFade .16s ease-out; }
        #lqv-panel textarea, #lqv-panel input, #lqv-panel select { cursor: text; }
    `;
    document.head.appendChild(style);
}

// ── Xây dựng Drawer (chèn 1 lần vào <body>) ──────────────────────
function injectPanel() {
    if ($('lqv-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'lqv-panel';
    panel.className = 'fixed top-0 right-0 h-full w-full sm:w-[480px] md:w-[560px] z-[150] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl flex flex-col transform translate-x-full transition-transform duration-300 ease-out';
    panel.innerHTML = `
        <div class="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-gray-200 dark:border-slate-700 shrink-0">
            <button data-action="prev" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <span class="material-symbols-outlined text-base">arrow_back</span><span class="hidden sm:inline">Trước</span>
            </button>
            <div id="lqv-counter" class="text-sm font-bold text-gray-700 dark:text-gray-200 px-1 whitespace-nowrap">1 / 1</div>
            <button data-action="next" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <span class="hidden sm:inline">Tiếp</span><span class="material-symbols-outlined text-base">arrow_forward</span>
            </button>
            <div class="hidden lg:block text-[11px] text-gray-400 ml-2 truncate">Kéo ngang hoặc dùng ← → để chuyển lead</div>
            <button data-action="close" class="ml-auto w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-red-500 shrink-0">
                <span class="material-symbols-outlined text-lg">close</span>
            </button>
        </div>
        <div id="lqv-body" class="flex-1 overflow-y-auto">
            <div class="px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 dark:border-slate-800">
                <div class="flex items-start justify-between gap-3">
                    <h2 id="lqv-name" class="text-lg sm:text-xl font-extrabold text-orange-600 leading-snug break-words"></h2>
                    <button data-action="copyall" class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-50 dark:bg-orange-500/10 text-orange-600 hover:bg-orange-100 whitespace-nowrap">
                        <span class="material-symbols-outlined text-[16px]">content_copy</span>Sao chép tất cả
                    </button>
                </div>
                <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span id="lqv-badge" class="px-2 py-1 text-[10px] uppercase font-bold rounded-full badge-lead-normal"></span>
                    <a id="lqv-source-link" href="#" target="_blank" rel="noopener" class="text-blue-500 hover:underline truncate max-w-[200px]"></a>
                    <button data-copy-field="source" title="Sao chép nguồn" class="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-orange-500">
                        <span class="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                    <span id="lqv-created" class="ml-auto whitespace-nowrap"></span>
                </div>
            </div>
            <div class="flex items-center gap-1 px-4 sm:px-5 pt-3 flex-wrap">
                <button data-tab="info" class="px-3 py-1.5 rounded-lg text-xs font-bold">Thông tin lead</button>
                <button data-tab="note" class="px-3 py-1.5 rounded-lg text-xs font-bold">Ghi chú</button>
                <div class="ml-auto flex items-center gap-2 flex-wrap">
                    <button data-action="edit" id="lqv-edit" class="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:opacity-90 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[15px]">edit</span>Chỉnh sửa
                    </button>
                    <button data-action="save" id="lqv-save" class="hidden px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-green-600 hover:opacity-90">Lưu</button>
                    <button data-action="cancel" id="lqv-cancel" class="hidden px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">Hủy</button>
                    <button data-action="delete" class="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[15px]">delete</span>Xóa
                    </button>
                </div>
            </div>
            <div id="lqv-panel-info" class="px-4 sm:px-5 py-4"></div>
            <div id="lqv-panel-note" class="px-4 sm:px-5 py-4 hidden"></div>
        </div>
        <div class="shrink-0 px-4 py-2 border-t border-gray-100 dark:border-slate-800 text-center text-[11px] text-gray-400">
            ← Vuốt / phím ← → để chuyển Lead →
        </div>`;
    document.body.appendChild(panel);
    wirePanelEvents(panel);
}

// ── Render 1 ô dữ liệu (view hoặc edit) ──────────────────────────
function fieldBlock(label, key, opts, src) {
    const { type = 'text', full = false, required = false } = opts;
    const colClass = full ? 'sm:col-span-2' : '';
    const rawVal = src ? src[key] : '';

    if (!_editMode) {
        const val = (rawVal || '').toString();
        return `
        <div class="${colClass}">
            ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>` : ''}
            <div class="flex items-start justify-between gap-2 bg-gray-50 dark:bg-slate-800/60 rounded-lg px-3 py-2.5">
                <div class="text-sm text-gray-800 dark:text-gray-100 break-words whitespace-pre-wrap flex-1">${val ? esc(val) : '<span class="text-gray-400 italic">Chưa có</span>'}</div>
                ${val ? `<button data-copy-field="${key}" title="Sao chép" class="shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 hover:text-orange-500"><span class="material-symbols-outlined text-[16px]">content_copy</span></button>` : ''}
            </div>
        </div>`;
    }
    if (type === 'select') {
        const options = ['Thường', 'Tiềm năng', 'VIP'];
        return `
        <div class="${colClass}">
            ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>` : ''}
            <select data-input="${key}" class="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-orange-500">
                ${options.map(o => `<option value="${o}" ${rawVal === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
        </div>`;
    }
    if (type === 'textarea') {
        const val = (rawVal || '').toString();
        return `
        <div class="${colClass}">
            ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>` : ''}
            <textarea data-input="${key}" rows="7" maxlength="500" class="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-orange-500 resize-none">${esc(val)}</textarea>
            <div class="text-right text-[11px] text-gray-400 mt-1"><span data-note-count>${val.length}</span>/500</div>
        </div>`;
    }
    const val = (rawVal || '').toString();
    return `
    <div class="${colClass}">
        ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}${required ? ' *' : ''}</div>` : ''}
        <input type="${type}" data-input="${key}" value="${esc(val)}" class="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-orange-500">
    </div>`;
}

function currentLead() { return _navList[_curIndex] || null; }

function renderDrawer() {
    const lead = currentLead();
    if (!lead) return;
    const total = _navList.length;
    const src = _editMode ? _draft : lead;

    $('lqv-counter').textContent = `${_curIndex + 1} / ${total}`;
    const prevBtn = $('lqv-panel').querySelector('[data-action="prev"]');
    const nextBtn = $('lqv-panel').querySelector('[data-action="next"]');
    prevBtn.disabled = _curIndex <= 0;
    nextBtn.disabled = _curIndex >= total - 1;

    let badgeClass = 'badge-lead-normal';
    if (lead.type === 'Tiềm năng') badgeClass = 'badge-lead-potential';
    if (lead.type === 'VIP') badgeClass = 'badge-lead-vip';
    $('lqv-name').textContent = lead.name || '(Không tên)';
    $('lqv-badge').textContent = lead.type || 'Thường';
    $('lqv-badge').className = `px-2 py-1 text-[10px] uppercase font-bold rounded-full ${badgeClass}`;

    const srcLink = $('lqv-source-link');
    if (lead.source) {
        srcLink.textContent = lead.source;
        const isUrl = /^https?:\/\//i.test(lead.source);
        srcLink.href = isUrl ? lead.source : '#';
        srcLink.classList.toggle('pointer-events-none', !isUrl);
        srcLink.classList.remove('hidden');
    } else {
        srcLink.classList.add('hidden');
    }
    $('lqv-created').textContent = `Thêm lúc: ${fmtDateTime(lead.createdAt)}`;

    $('lqv-edit').classList.toggle('hidden', _editMode);
    $('lqv-save').classList.toggle('hidden', !_editMode);
    $('lqv-cancel').classList.toggle('hidden', !_editMode);

    $('lqv-panel').querySelectorAll('[data-tab]').forEach(btn => {
        const active = btn.dataset.tab === _activeTab;
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold ' + (active
            ? 'bg-orange-500 text-white shadow'
            : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700');
    });
    $('lqv-panel-info').classList.toggle('hidden', _activeTab !== 'info');
    $('lqv-panel-note').classList.toggle('hidden', _activeTab !== 'note');

    $('lqv-panel-info').innerHTML = `
        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-3">Thông tin khách hàng</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldBlock('Tên khách hàng', 'name', { required: true }, src)}
            ${fieldBlock('Email', 'email', { type: 'email' }, src)}
            ${fieldBlock('Số điện thoại', 'phone', { required: true }, src)}
            ${fieldBlock('Loại khách hàng', 'type', { type: 'select' }, src)}
            ${fieldBlock('Nguồn (Facebook, Google...)', 'source', { full: true }, src)}
        </div>`;
    $('lqv-panel-note').innerHTML = fieldBlock('Ghi chú thêm', 'note', { type: 'textarea', full: true }, src);

    const body = $('lqv-body');
    body.classList.remove('lqv-anim-in');
    void body.offsetWidth;
    body.classList.add('lqv-anim-in');
}

// ── Mở / đóng / điều hướng Drawer ───────────────────────────────
function isDrawerOpen() {
    const p = $('lqv-panel');
    return !!p && !p.classList.contains('translate-x-full') && _curIndex >= 0;
}
function confirmLeaveEdit() {
    if (!_editMode) return true;
    return confirm('Bạn đang chỉnh sửa. Rời đi sẽ hủy các thay đổi chưa lưu. Tiếp tục?');
}
function openLeadDrawer(id, startEdit = false) {
    injectStyles();
    injectPanel();
    if (isDrawerOpen() && !confirmLeaveEdit()) return;

    const freshList = getFilteredSortedLeads();
    let idx = freshList.findIndex(l => l.id === id);
    if (idx === -1) {
        const found = _leadsCache.find(l => l.id === id);
        if (!found) { toast('Không tìm thấy Lead', 'error'); return; }
        freshList.unshift(found);
        idx = 0;
    }
    _navList = freshList;
    _curIndex = idx;
    _activeTab = 'info';
    _editMode = false;
    _draft = null;

    $('lqv-panel').classList.remove('translate-x-full');
    renderDrawer();
    if (startEdit) enterEdit();
}
function closeDrawer(force = false) {
    if (!force && !confirmLeaveEdit()) return;
    const p = $('lqv-panel');
    if (p) p.classList.add('translate-x-full');
    _navList = []; _curIndex = -1; _editMode = false; _draft = null;
}
function goPrev() {
    if (_curIndex <= 0) return;
    if (!confirmLeaveEdit()) return;
    _editMode = false; _draft = null;
    _curIndex--;
    renderDrawer();
}
function goNext() {
    if (_curIndex >= _navList.length - 1) return;
    if (!confirmLeaveEdit()) return;
    _editMode = false; _draft = null;
    _curIndex++;
    renderDrawer();
}

// ── Sửa / Lưu / Hủy / Xóa ────────────────────────────────────────
function enterEdit() {
    const lead = currentLead();
    if (!lead) return;
    _editMode = true;
    _draft = {
        name: lead.name || '', phone: lead.phone || '', email: lead.email || '',
        source: lead.source || '', type: lead.type || 'Thường', note: lead.note || ''
    };
    renderDrawer();
}
function cancelEdit() {
    _editMode = false; _draft = null;
    renderDrawer();
}
async function saveLead() {
    if (!_draft) return;
    const lead = currentLead();
    if (!lead) return;
    const data = {
        name: (_draft.name || '').trim(),
        phone: (_draft.phone || '').trim(),
        email: (_draft.email || '').trim(),
        source: (_draft.source || '').trim(),
        type: _draft.type || 'Thường',
        note: (_draft.note || '').trim(),
    };
    if (!data.name || !data.phone) { toast('Vui lòng nhập Tên khách hàng và Số điện thoại', 'error'); return; }
    const saveBtn = $('lqv-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...'; }
    try {
        await updateDoc(leadDocRef(lead.id), data);
        _editMode = false; _draft = null;
        toast('Cập nhật Lead thành công');
        // onSnapshot sẽ tự đồng bộ lại _navList; render lại ngay cho mượt
        Object.assign(lead, data);
        renderDrawer();
    } catch (err) {
        console.error(err);
        toast('Lỗi khi lưu Lead: ' + err.message, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Lưu'; }
    }
}
async function deleteLeadFromDrawer() {
    const lead = currentLead();
    if (!lead) return;
    if (!confirm(`Xóa Lead này?\n\n${lead.name}`)) return;
    try {
        await deleteDoc(leadDocRef(lead.id));
        toast('Đã xóa Lead');
        // onSnapshot (bên dưới) sẽ tự cập nhật _navList và chuyển Drawer
        // sang Lead kế tiếp tại đúng vị trí, hoặc đóng Drawer nếu hết dữ liệu.
    } catch (err) {
        console.error(err);
        toast('Lỗi khi xóa Lead: ' + err.message, 'error');
    }
}

// ── Copy ─────────────────────────────────────────────────────────
const FIELD_LABELS = { name: 'Tên khách hàng', phone: 'Số điện thoại', email: 'Email', source: 'Nguồn', type: 'Loại khách hàng', note: 'Ghi chú' };
function copyField(key) {
    const lead = currentLead();
    if (!lead) return;
    const val = (lead[key] || '').toString();
    if (!val) return;
    copyText(val);
    toast(`Đã sao chép ${FIELD_LABELS[key] || key}`);
}
function copyAllFields() {
    const lead = currentLead();
    if (!lead) return;
    const text = [
        'Tên khách hàng:', lead.name || '', '',
        'Số điện thoại:', lead.phone || '', '',
        'Email:', lead.email || '', '',
        'Nguồn:', lead.source || '', '',
        'Loại khách hàng:', lead.type || 'Thường', '',
        'Ghi chú:', lead.note || ''
    ].join('\n');
    copyText(text);
    toast('Đã sao chép toàn bộ dữ liệu Lead');
}

// ── Gắn sự kiện cho Drawer (1 lần, dùng event delegation) ─────────
function wirePanelEvents(panel) {
    panel.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) { _activeTab = tabBtn.dataset.tab; renderDrawer(); return; }

        const copyBtn = e.target.closest('[data-copy-field]');
        if (copyBtn) { copyField(copyBtn.dataset.copyField); return; }

        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn || actionBtn.disabled) return;
        const action = actionBtn.dataset.action;
        if (action === 'prev') goPrev();
        else if (action === 'next') goNext();
        else if (action === 'close') closeDrawer();
        else if (action === 'edit') enterEdit();
        else if (action === 'save') saveLead();
        else if (action === 'cancel') cancelEdit();
        else if (action === 'delete') deleteLeadFromDrawer();
        else if (action === 'copyall') copyAllFields();
    });

    // Đồng bộ bản nháp khi gõ (giữ dữ liệu khi đổi tab giữa lúc đang sửa)
    panel.addEventListener('input', (e) => {
        const el = e.target.closest('[data-input]');
        if (!el || !_draft) return;
        _draft[el.dataset.input] = el.value;
        if (el.dataset.input === 'note') {
            const counter = panel.querySelector('[data-note-count]');
            if (counter) counter.textContent = el.value.length;
        }
    });

    // Vuốt (touch) / kéo (mouse) để chuyển Lead — bỏ qua khi thao tác
    // bắt đầu trong input/textarea/select/button/a (đọc, chọn text, cuộn)
    let dragging = false, startX = 0, startY = 0, pid = null;
    panel.addEventListener('pointerdown', (e) => {
        if (e.target.closest('textarea, input, select, button, a')) { dragging = false; return; }
        dragging = true; pid = e.pointerId; startX = e.clientX; startY = e.clientY;
    });
    panel.addEventListener('pointerup', (e) => {
        if (!dragging || e.pointerId !== pid) return;
        dragging = false;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (dx < 0) goNext(); else goPrev();
        }
    });
    panel.addEventListener('pointercancel', () => { dragging = false; });
}

// ── Phím tắt bàn phím ─────────────────────────────────────────────
function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (!isDrawerOpen()) return;
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = ['input', 'textarea', 'select'].includes(tag);
        if (e.key === 'Escape') {
            if (typing) { e.target.blur(); return; }
            if (_editMode) cancelEdit(); else closeDrawer();
            return;
        }
        if (typing) return; // không hijack khi đang gõ (giữ Ctrl+C / gõ bình thường)
        if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
        else if (e.key.toLowerCase() === 'e' && !_editMode) { enterEdit(); }
    });
}

// ── Mở Drawer khi click vào 1 hàng/thẻ Lead trong danh sách ───────
function wireRowOpen() {
    const handler = (e) => {
        if (e.target.closest('button, input, a')) return; // không giành click của nút hành động / checkbox
        const row = e.target.closest('tr, .mobile-card-item');
        if (!row) return;
        const id = extractLeadId(row);
        if (!id) return;
        openLeadDrawer(id, false);
    };
    const tbody = $('leads-list');
    const cardList = $('leads-card-list');
    if (tbody && !tbody.dataset.lqvWired) { tbody.addEventListener('click', handler); tbody.dataset.lqvWired = '1'; }
    if (cardList && !cardList.dataset.lqvWired) { cardList.addEventListener('click', handler); cardList.dataset.lqvWired = '1'; }
}

// ── Giữ Drawer đồng bộ khi filter/search/sort thay đổi ────────────
function wireFilterSync() {
    ['search-lead', 'filter-lead-date', 'filter-lead-type', 'sort-lead'].forEach(id => {
        $(id)?.addEventListener('input', () => {
            if (!isDrawerOpen() || _editMode) return;
            const curId = currentLead()?.id;
            const freshList = getFilteredSortedLeads();
            if (freshList.length === 0) { closeDrawer(true); return; }
            let newIdx = freshList.findIndex(l => l.id === curId);
            if (newIdx === -1) newIdx = 0;
            _navList = freshList; _curIndex = newIdx;
            renderDrawer();
        });
    });
}

// ── Ghi đè nút "Sửa" (bút chì) trên hàng để mở Drawer ở chế độ sửa ─
function overrideEditLead() {
    if (window.editLead && window.editLead.__lqvWrapped) return;
    const _origEditLead = window.editLead;
    window.editLead = function (data) {
        if (data && data.id) { openLeadDrawer(data.id, true); return; }
        if (typeof _origEditLead === 'function') _origEditLead(data);
    };
    window.editLead.__lqvWrapped = true;
}

// ── Realtime cache Lead (độc lập với app.js) ──────────────────────
onSnapshot(query(leadsCol), (snap) => {
    _leadsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!isDrawerOpen()) return;

    const curId = currentLead()?.id;
    const freshList = getFilteredSortedLeads();
    if (freshList.length === 0) { closeDrawer(true); return; }
    let newIdx = freshList.findIndex(l => l.id === curId);
    if (newIdx === -1) newIdx = Math.min(_curIndex, freshList.length - 1);
    _navList = freshList; _curIndex = newIdx;
    if (!_editMode) renderDrawer();
    else $('lqv-counter').textContent = `${_curIndex + 1} / ${_navList.length}`; // tránh mất dữ liệu đang gõ
});

// ── Khởi tạo ────────────────────────────────────────────────────
function init() {
    injectStyles();
    wireRowOpen();
    wireFilterSync();
    wireKeyboard();
    overrideEditLead();

    // app.js/leads-customers-io.js có thể gán window.editLead / render DOM
    // theo thứ tự bất đồng bộ — thử lại vài lần trong vài giây đầu để chắc
    // chắn override và các listener đã được gắn đúng, cùng pattern với
    // leads-customers-io.js.
    let tries = 0;
    const timer = setInterval(() => {
        overrideEditLead();
        wireRowOpen();
        tries++;
        if (tries > 20) clearInterval(timer);
    }, 500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
