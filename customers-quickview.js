/* ================================================================
   CUSTOMER QUICKVIEW DRAWER — customers-quickview.js v1.0
   CRM NeoWave — bản nâng cấp "Quản lý Khách hàng" theo đúng mô hình
   Drawer + Continuous Navigation đã làm cho Leads (leads-quickview.js)

   TÍCH HỢP — chỉ 1 dòng thêm vào index.html, NGAY SAU thẻ:
     <script type="module" src="leads-quickview.js"></script>

   Thêm:
     <script type="module" src="customers-quickview.js"></script>

   TÍNH NĂNG (giống hệt cơ chế Lead QuickView, áp dụng cho Khách hàng):
   ─────────────────────────────────────────────────────────────
   - Click vào 1 Khách hàng trong bảng/card → mở Drawer bên phải,
     danh sách phía sau KHÔNG bị đóng (desktop).
   - "← Trước / Tiếp →", vuốt (touch) / kéo chuột (drag), phím
     mũi tên ← → để chuyển Khách hàng kế tiếp ngay trong Drawer.
   - Điều hướng đúng tập đang lọc/tìm kiếm/sắp xếp hiện tại của
     bảng Khách hàng (giữ nguyên filter/search/sort).
   - READ mặc định → [Chỉnh sửa] → sửa tại chỗ (UPDATE) →
     [Lưu]/[Hủy], cập nhật Firestore, không reload trang.
   - [Xóa] có xác nhận; sau khi xóa tự chuyển sang KH kế tiếp tại
     đúng vị trí, danh sách phía sau tự cập nhật.
   - 3 tab: Thông tin (kèm ngân hàng), Ghi chú, Hình ảnh (GPKD /
     CCCD / Ảnh cửa hàng — xem phóng to, đổi ảnh, xóa ảnh khi sửa).
   - Copy riêng từng trường (icon ⧉) + "Sao chép tất cả".
   - Phím tắt: ← / → chuyển KH, E = Chỉnh sửa, Esc = thoát sửa /
     đóng Drawer — tự vô hiệu khi đang gõ trong input/textarea.

   NGUYÊN TẮC AN TOÀN (giống leads-customers-io.js / leads-quickview.js):
   - KHÔNG sửa app.js. Chỉ đọc window.* / DOM đã có sẵn, và ghi đè
     window.editCustomer + window.previewCustomer (để nút "Sửa" và
     "Xem chi tiết" trên hàng mở Drawer thay vì popup cũ) — có
     fallback về hành vi gốc nếu cần.
   - Tự khởi tạo Firestore refs riêng qua getApp(), tự subscribe
     collection 'customers' riêng — không phụ thuộc biến nội bộ
     của app.js.
   - Không đổi cấu trúc field Firestore hiện có của Khách hàng
     (name, address, email, phone, bankOwner, bankAccount,
     bankName, bankBranch, note, source, gpkd, cccd, storeImage,
     createdAt).
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
const customersCol = collection(_db, 'artifacts', _appId, 'public', 'data', 'customers');
const customerDocRef = (id) => doc(_db, 'artifacts', _appId, 'public', 'data', 'customers', id);

const $ = (id) => document.getElementById(id);
const toast = (msg, type = 'success') => window.showToast ? window.showToast(msg, type) : console.log(msg);

// ── State ─────────────────────────────────────────────────────
let _custCache = [];    // toàn bộ khách hàng (realtime)
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
// Tái tạo đúng logic lọc/sắp xếp của window.renderCustomers (app.js) để
// Drawer luôn điều hướng trên đúng tập Khách hàng đang hiển thị cho user.
function getFilteredSortedCustomers() {
    const txt = ($('search-customer')?.value || '').toLowerCase();
    const dt = $('filter-customer-date')?.value || '';
    const sortOrder = $('sort-customer')?.value || 'newest';
    const filtered = _custCache.filter(c => {
        const matchTxt = (c.name || '').toLowerCase().includes(txt) || (c.phone || '').includes(txt);
        const matchDt = !dt || isoDate(c.createdAt) === dt;
        return matchTxt && matchDt;
    });
    return sortByCreatedAt(filtered, sortOrder);
}
// Lấy id Khách hàng từ 1 hàng bảng / thẻ mobile bằng cách đọc onclick
// của nút Xóa sẵn có (deleteCustomer('id')) — không cần render lại danh sách.
function extractCustomerId(el) {
    const btn = el.querySelector('[onclick*="deleteCustomer("]');
    if (!btn) return null;
    const m = btn.getAttribute('onclick').match(/deleteCustomer\('([^']+)'\)/);
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
    if ($('cqv-styles')) return;
    const style = document.createElement('style');
    style.id = 'cqv-styles';
    style.textContent = `
        #customers-list tr, #customers-card-list .mobile-card-item { cursor: pointer; }
        @keyframes cqvFade { from { opacity:.35; transform: translateX(8px);} to { opacity:1; transform:none; } }
        .cqv-anim-in { animation: cqvFade .16s ease-out; }
        #cqv-panel textarea, #cqv-panel input, #cqv-panel select { cursor: text; }
    `;
    document.head.appendChild(style);
}

// ── Xây dựng Drawer (chèn 1 lần vào <body>) ──────────────────────
function injectPanel() {
    if ($('cqv-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'cqv-panel';
    panel.className = 'fixed top-0 right-0 h-full w-full sm:w-[480px] md:w-[600px] z-[150] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl flex flex-col transform translate-x-full transition-transform duration-300 ease-out';
    panel.innerHTML = `
        <div class="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-gray-200 dark:border-slate-700 shrink-0">
            <button data-action="prev" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <span class="material-symbols-outlined text-base">arrow_back</span><span class="hidden sm:inline">Trước</span>
            </button>
            <div id="cqv-counter" class="text-sm font-bold text-gray-700 dark:text-gray-200 px-1 whitespace-nowrap">1 / 1</div>
            <button data-action="next" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <span class="hidden sm:inline">Tiếp</span><span class="material-symbols-outlined text-base">arrow_forward</span>
            </button>
            <div class="hidden lg:block text-[11px] text-gray-400 ml-2 truncate">Kéo ngang hoặc dùng ← → để chuyển KH</div>
            <button data-action="close" class="ml-auto w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-red-500 shrink-0">
                <span class="material-symbols-outlined text-lg">close</span>
            </button>
        </div>
        <div id="cqv-body" class="flex-1 overflow-y-auto">
            <div class="px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 dark:border-slate-800">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <h2 id="cqv-name" class="text-lg sm:text-xl font-extrabold text-primary leading-snug break-words"></h2>
                        <div id="cqv-address" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate"></div>
                    </div>
                    <button data-action="copyall" class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 whitespace-nowrap">
                        <span class="material-symbols-outlined text-[16px]">content_copy</span>Sao chép tất cả
                    </button>
                </div>
                <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <a id="cqv-source-link" href="#" target="_blank" rel="noopener" class="text-blue-500 hover:underline truncate max-w-[220px]"></a>
                    <button data-copy-field="source" title="Sao chép nguồn" class="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-primary">
                        <span class="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                    <span id="cqv-created" class="ml-auto whitespace-nowrap"></span>
                </div>
            </div>
            <div class="flex items-center gap-1 px-4 sm:px-5 pt-3 flex-wrap">
                <button data-tab="info" class="px-3 py-1.5 rounded-lg text-xs font-bold">Thông tin</button>
                <button data-tab="note" class="px-3 py-1.5 rounded-lg text-xs font-bold">Ghi chú</button>
                <button data-tab="images" class="px-3 py-1.5 rounded-lg text-xs font-bold">Hình ảnh</button>
                <div class="ml-auto flex items-center gap-2 flex-wrap">
                    <button data-action="edit" id="cqv-edit" class="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:opacity-90 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[15px]">edit</span>Chỉnh sửa
                    </button>
                    <button data-action="save" id="cqv-save" class="hidden px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-green-600 hover:opacity-90">Lưu</button>
                    <button data-action="cancel" id="cqv-cancel" class="hidden px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">Hủy</button>
                    <button data-action="delete" class="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[15px]">delete</span>Xóa
                    </button>
                </div>
            </div>
            <div id="cqv-panel-info" class="px-4 sm:px-5 py-4"></div>
            <div id="cqv-panel-note" class="px-4 sm:px-5 py-4 hidden"></div>
            <div id="cqv-panel-images" class="px-4 sm:px-5 py-4 hidden"></div>
        </div>
        <div class="shrink-0 px-4 py-2 border-t border-gray-100 dark:border-slate-800 text-center text-[11px] text-gray-400">
            ← Vuốt / phím ← → để chuyển Khách hàng →
        </div>`;
    document.body.appendChild(panel);
    wirePanelEvents(panel);
}

// ── Lightbox xem ảnh phóng to (dùng chung cho cả 3 ảnh) ──────────
function ensureLightbox() {
    let lb = $('cqv-lightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.id = 'cqv-lightbox';
    lb.className = 'fixed inset-0 z-[300] bg-black/80 hidden items-center justify-center p-6 cursor-zoom-out';
    lb.innerHTML = `<img id="cqv-lightbox-img" class="max-w-full max-h-full rounded-lg shadow-2xl">`;
    lb.addEventListener('click', () => { lb.classList.add('hidden'); lb.classList.remove('flex'); });
    document.body.appendChild(lb);
    return lb;
}
function openLightbox(src) {
    if (!src) return;
    const lb = ensureLightbox();
    $('cqv-lightbox-img').src = src;
    lb.classList.remove('hidden');
    lb.classList.add('flex');
}

// ── Render 1 ô dữ liệu văn bản (view hoặc edit) ──────────────────
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
                ${val ? `<button data-copy-field="${key}" title="Sao chép" class="shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 hover:text-primary"><span class="material-symbols-outlined text-[16px]">content_copy</span></button>` : ''}
            </div>
        </div>`;
    }
    if (type === 'textarea') {
        const val = (rawVal || '').toString();
        return `
        <div class="${colClass}">
            ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>` : ''}
            <textarea data-input="${key}" rows="7" maxlength="500" class="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-primary resize-none">${esc(val)}</textarea>
            <div class="text-right text-[11px] text-gray-400 mt-1"><span data-note-count>${val.length}</span>/500</div>
        </div>`;
    }
    const val = (rawVal || '').toString();
    return `
    <div class="${colClass}">
        ${label ? `<div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}${required ? ' *' : ''}</div>` : ''}
        <input type="${type}" data-input="${key}" value="${esc(val)}" class="w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-primary">
    </div>`;
}

// ── Render 1 ô ảnh (view: thumbnail + phóng to; edit: chọn/xóa ảnh) ─
function imageBlock(label, key, icon, src) {
    const val = src ? (src[key] || '') : '';
    if (!_editMode) {
        return `
        <div>
            <div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>
            ${val
                ? `<img data-lightbox="${key}" src="${val}" class="w-full h-28 object-cover rounded-lg border border-gray-200 dark:border-slate-700 cursor-zoom-in">`
                : `<div class="flex items-center justify-center h-28 rounded-lg bg-gray-50 dark:bg-slate-800/60 border border-dashed border-gray-200 dark:border-slate-700 text-gray-300 dark:text-gray-600">
                       <span class="material-symbols-outlined text-3xl">${icon}</span>
                   </div>`}
        </div>`;
    }
    return `
    <div>
        <div class="text-[11px] font-semibold text-gray-400 uppercase mb-1">${esc(label)}</div>
        <div class="relative h-28">
            <label class="flex items-center justify-center w-full h-full rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800/50 overflow-hidden cursor-pointer">
                ${val ? `<img src="${val}" class="w-full h-full object-cover">` : `<span class="material-symbols-outlined text-3xl text-gray-400">${icon}</span>`}
                <input type="file" accept="image/*" class="hidden" data-img-input="${key}">
            </label>
            ${val ? `<button type="button" data-img-clear="${key}" title="Xóa ảnh" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow"><span class="material-symbols-outlined text-[14px]">close</span></button>` : ''}
        </div>
    </div>`;
}

function currentCustomer() { return _navList[_curIndex] || null; }

function renderDrawer() {
    const cus = currentCustomer();
    if (!cus) return;
    const total = _navList.length;
    const src = _editMode ? _draft : cus;

    $('cqv-counter').textContent = `${_curIndex + 1} / ${total}`;
    const prevBtn = $('cqv-panel').querySelector('[data-action="prev"]');
    const nextBtn = $('cqv-panel').querySelector('[data-action="next"]');
    prevBtn.disabled = _curIndex <= 0;
    nextBtn.disabled = _curIndex >= total - 1;

    $('cqv-name').textContent = cus.name || '(Không tên)';
    $('cqv-address').textContent = cus.address || '';

    const srcLink = $('cqv-source-link');
    if (cus.source) {
        srcLink.textContent = cus.source;
        const isUrl = /^https?:\/\//i.test(cus.source);
        srcLink.href = isUrl ? cus.source : '#';
        srcLink.classList.toggle('pointer-events-none', !isUrl);
        srcLink.classList.remove('hidden');
    } else {
        srcLink.classList.add('hidden');
    }
    $('cqv-created').textContent = `Thêm lúc: ${fmtDateTime(cus.createdAt)}`;

    $('cqv-edit').classList.toggle('hidden', _editMode);
    $('cqv-save').classList.toggle('hidden', !_editMode);
    $('cqv-cancel').classList.toggle('hidden', !_editMode);

    $('cqv-panel').querySelectorAll('[data-tab]').forEach(btn => {
        const active = btn.dataset.tab === _activeTab;
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold ' + (active
            ? 'bg-primary text-white shadow'
            : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700');
    });
    $('cqv-panel-info').classList.toggle('hidden', _activeTab !== 'info');
    $('cqv-panel-note').classList.toggle('hidden', _activeTab !== 'note');
    $('cqv-panel-images').classList.toggle('hidden', _activeTab !== 'images');

    $('cqv-panel-info').innerHTML = `
        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-3">Thông tin khách hàng</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldBlock('Tên khách hàng / Công ty', 'name', { required: true, full: true }, src)}
            ${fieldBlock('Địa chỉ thường trú', 'address', { required: true, full: true }, src)}
            ${fieldBlock('Email', 'email', { type: 'email' }, src)}
            ${fieldBlock('Số điện thoại', 'phone', { required: true }, src)}
            ${fieldBlock('Nguồn (dán link)', 'source', { type: 'url', full: true }, src)}
        </div>
        <div class="text-xs font-bold text-primary mt-5 mb-3">Thông tin ngân hàng (QR VNPAY)</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldBlock('Chủ tài khoản', 'bankOwner', {}, src)}
            ${fieldBlock('Số tài khoản', 'bankAccount', {}, src)}
            ${fieldBlock('Ngân hàng', 'bankName', {}, src)}
            ${fieldBlock('Chi nhánh', 'bankBranch', {}, src)}
        </div>`;

    $('cqv-panel-note').innerHTML = fieldBlock('Ghi chú', 'note', { type: 'textarea', full: true }, src);

    $('cqv-panel-images').innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${imageBlock('GPKD', 'gpkd', 'add_photo_alternate', src)}
            ${imageBlock('2 mặt CCCD', 'cccd', 'id_card', src)}
            ${imageBlock('Ảnh cửa hàng', 'storeImage', 'storefront', src)}
        </div>`;

    const body = $('cqv-body');
    body.classList.remove('cqv-anim-in');
    void body.offsetWidth;
    body.classList.add('cqv-anim-in');
}

// ── Mở / đóng / điều hướng Drawer ───────────────────────────────
function isDrawerOpen() {
    const p = $('cqv-panel');
    return !!p && !p.classList.contains('translate-x-full') && _curIndex >= 0;
}
function confirmLeaveEdit() {
    if (!_editMode) return true;
    return confirm('Bạn đang chỉnh sửa. Rời đi sẽ hủy các thay đổi chưa lưu. Tiếp tục?');
}
function openCustomerDrawer(id, startEdit = false) {
    injectStyles();
    injectPanel();
    if (isDrawerOpen() && !confirmLeaveEdit()) return;

    const freshList = getFilteredSortedCustomers();
    let idx = freshList.findIndex(c => c.id === id);
    if (idx === -1) {
        const found = _custCache.find(c => c.id === id);
        if (!found) { toast('Không tìm thấy Khách hàng', 'error'); return; }
        freshList.unshift(found);
        idx = 0;
    }
    _navList = freshList;
    _curIndex = idx;
    _activeTab = 'info';
    _editMode = false;
    _draft = null;

    $('cqv-panel').classList.remove('translate-x-full');
    renderDrawer();
    if (startEdit) enterEdit();
}
function closeDrawer(force = false) {
    if (!force && !confirmLeaveEdit()) return;
    const p = $('cqv-panel');
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
    const cus = currentCustomer();
    if (!cus) return;
    _editMode = true;
    _draft = {
        name: cus.name || '', address: cus.address || '', email: cus.email || '', phone: cus.phone || '',
        bankOwner: cus.bankOwner || '', bankAccount: cus.bankAccount || '', bankName: cus.bankName || '', bankBranch: cus.bankBranch || '',
        note: cus.note || '', source: cus.source || '',
        gpkd: cus.gpkd || '', cccd: cus.cccd || '', storeImage: cus.storeImage || ''
    };
    renderDrawer();
}
function cancelEdit() {
    _editMode = false; _draft = null;
    renderDrawer();
}
async function saveCustomer() {
    if (!_draft) return;
    const cus = currentCustomer();
    if (!cus) return;
    const data = {
        name: (_draft.name || '').trim(),
        address: (_draft.address || '').trim(),
        email: (_draft.email || '').trim(),
        phone: (_draft.phone || '').trim(),
        bankOwner: (_draft.bankOwner || '').trim(),
        bankAccount: (_draft.bankAccount || '').trim(),
        bankName: (_draft.bankName || '').trim(),
        bankBranch: (_draft.bankBranch || '').trim(),
        note: (_draft.note || '').trim(),
        source: (_draft.source || '').trim(),
        gpkd: _draft.gpkd || '',
        cccd: _draft.cccd || '',
        storeImage: _draft.storeImage || ''
    };
    if (!data.name || !data.phone || !data.address) { toast('Vui lòng nhập Tên, Địa chỉ và Số điện thoại', 'error'); return; }
    const saveBtn = $('cqv-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...'; }
    try {
        await updateDoc(customerDocRef(cus.id), data);
        _editMode = false; _draft = null;
        toast('Cập nhật Khách hàng thành công');
        Object.assign(cus, data);
        renderDrawer();
    } catch (err) {
        console.error(err);
        toast('Lỗi khi lưu: ' + err.message, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Lưu'; }
    }
}
async function deleteCustomerFromDrawer() {
    const cus = currentCustomer();
    if (!cus) return;
    if (!confirm(`Xóa khách hàng này?\n\n${cus.name}`)) return;
    try {
        await deleteDoc(customerDocRef(cus.id));
        toast('Đã xóa Khách hàng');
        // onSnapshot bên dưới sẽ tự cập nhật _navList và chuyển Drawer
        // sang KH kế tiếp tại đúng vị trí, hoặc đóng Drawer nếu hết dữ liệu.
    } catch (err) {
        console.error(err);
        toast('Lỗi khi xóa: ' + err.message, 'error');
    }
}

// ── Ảnh: chọn ảnh mới / xóa ảnh khi đang sửa ─────────────────────
function handleImageInput(inputEl) {
    if (!inputEl.files || !inputEl.files[0] || !_draft) return;
    const key = inputEl.dataset.imgInput;
    const file = inputEl.files[0];
    if (!file.type.startsWith('image/')) { toast('Chỉ nhận file ảnh', 'error'); return; }
    if (file.size > 1.5 * 1024 * 1024) { toast('Ảnh phải nhỏ hơn 1.5MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        _draft[key] = ev.target.result;
        renderDrawer();
    };
    reader.readAsDataURL(file);
}

// ── Copy ─────────────────────────────────────────────────────────
const FIELD_LABELS = {
    name: 'Tên khách hàng', address: 'Địa chỉ', email: 'Email', phone: 'Số điện thoại',
    bankOwner: 'Chủ tài khoản', bankAccount: 'Số tài khoản', bankName: 'Ngân hàng', bankBranch: 'Chi nhánh',
    source: 'Nguồn', note: 'Ghi chú'
};
function copyField(key) {
    const cus = currentCustomer();
    if (!cus) return;
    const val = (cus[key] || '').toString();
    if (!val) return;
    copyText(val);
    toast(`Đã sao chép ${FIELD_LABELS[key] || key}`);
}
function copyAllFields() {
    const cus = currentCustomer();
    if (!cus) return;
    const text = [
        'Tên khách hàng:', cus.name || '', '',
        'Số điện thoại:', cus.phone || '', '',
        'Email:', cus.email || '', '',
        'Địa chỉ:', cus.address || '', '',
        'Chủ tài khoản:', cus.bankOwner || '', '',
        'Số tài khoản:', cus.bankAccount || '', '',
        'Ngân hàng:', cus.bankName || '', '',
        'Chi nhánh:', cus.bankBranch || '', '',
        'Nguồn:', cus.source || '', '',
        'Ghi chú:', cus.note || ''
    ].join('\n');
    copyText(text);
    toast('Đã sao chép toàn bộ dữ liệu Khách hàng');
}

// ── Gắn sự kiện cho Drawer (1 lần, dùng event delegation) ─────────
function wirePanelEvents(panel) {
    panel.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) { _activeTab = tabBtn.dataset.tab; renderDrawer(); return; }

        const lightboxImg = e.target.closest('[data-lightbox]');
        if (lightboxImg) { openLightbox(lightboxImg.getAttribute('src')); return; }

        const imgClear = e.target.closest('[data-img-clear]');
        if (imgClear) { if (_draft) { _draft[imgClear.dataset.imgClear] = ''; renderDrawer(); } return; }

        const copyBtn = e.target.closest('[data-copy-field]');
        if (copyBtn) { copyField(copyBtn.dataset.copyField); return; }

        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn || actionBtn.disabled) return;
        const action = actionBtn.dataset.action;
        if (action === 'prev') goPrev();
        else if (action === 'next') goNext();
        else if (action === 'close') closeDrawer();
        else if (action === 'edit') enterEdit();
        else if (action === 'save') saveCustomer();
        else if (action === 'cancel') cancelEdit();
        else if (action === 'delete') deleteCustomerFromDrawer();
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

    // Chọn ảnh mới (GPKD / CCCD / Ảnh cửa hàng) khi đang sửa
    panel.addEventListener('change', (e) => {
        const inp = e.target.closest('[data-img-input]');
        if (inp) handleImageInput(inp);
    });

    // Vuốt (touch) / kéo (mouse) để chuyển KH — bỏ qua khi thao tác
    // bắt đầu trong input/textarea/select/button/a/label (đọc, chọn text,
    // cuộn, hoặc mở hộp thoại chọn ảnh)
    let dragging = false, startX = 0, startY = 0, pid = null;
    panel.addEventListener('pointerdown', (e) => {
        if (e.target.closest('textarea, input, select, button, a, label')) { dragging = false; return; }
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
            if ($('cqv-lightbox') && !$('cqv-lightbox').classList.contains('hidden')) {
                $('cqv-lightbox').classList.add('hidden'); $('cqv-lightbox').classList.remove('flex'); return;
            }
            if (_editMode) cancelEdit(); else closeDrawer();
            return;
        }
        if (typing) return; // không hijack khi đang gõ (giữ Ctrl+C / gõ bình thường)
        if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
        else if (e.key.toLowerCase() === 'e' && !_editMode) { enterEdit(); }
    });
}

// ── Mở Drawer khi click vào 1 hàng/thẻ Khách hàng trong danh sách ─
function wireRowOpen() {
    const handler = (e) => {
        if (e.target.closest('button, input, a')) return; // không giành click của nút hành động
        const row = e.target.closest('tr, .mobile-card-item');
        if (!row) return;
        const id = extractCustomerId(row);
        if (!id) return;
        openCustomerDrawer(id, false);
    };
    const tbody = $('customers-list');
    const cardList = $('customers-card-list');
    if (tbody && !tbody.dataset.cqvWired) { tbody.addEventListener('click', handler); tbody.dataset.cqvWired = '1'; }
    if (cardList && !cardList.dataset.cqvWired) { cardList.addEventListener('click', handler); cardList.dataset.cqvWired = '1'; }
}

// ── Giữ Drawer đồng bộ khi filter/search/sort thay đổi ────────────
function wireFilterSync() {
    ['search-customer', 'filter-customer-date', 'sort-customer'].forEach(id => {
        $(id)?.addEventListener('input', () => {
            if (!isDrawerOpen() || _editMode) return;
            const curId = currentCustomer()?.id;
            const freshList = getFilteredSortedCustomers();
            if (freshList.length === 0) { closeDrawer(true); return; }
            let newIdx = freshList.findIndex(c => c.id === curId);
            if (newIdx === -1) newIdx = 0;
            _navList = freshList; _curIndex = newIdx;
            renderDrawer();
        });
    });
}

// ── Ghi đè nút "Sửa" và "Xem chi tiết" trên hàng để mở Drawer ─────
function overrideEditCustomer() {
    if (window.editCustomer && window.editCustomer.__cqvWrapped) return;
    const _orig = window.editCustomer;
    window.editCustomer = function (data) {
        if (data && data.id) { openCustomerDrawer(data.id, true); return; }
        if (typeof _orig === 'function') _orig(data);
    };
    window.editCustomer.__cqvWrapped = true;
}
function overridePreviewCustomer() {
    if (window.previewCustomer && window.previewCustomer.__cqvWrapped) return;
    const _orig = window.previewCustomer;
    window.previewCustomer = function (id) {
        if (id) { openCustomerDrawer(id, false); return; }
        if (typeof _orig === 'function') _orig(id);
    };
    window.previewCustomer.__cqvWrapped = true;
}

// ── Realtime cache Khách hàng (độc lập với app.js) ────────────────
onSnapshot(query(customersCol), (snap) => {
    _custCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!isDrawerOpen()) return;

    const curId = currentCustomer()?.id;
    const freshList = getFilteredSortedCustomers();
    if (freshList.length === 0) { closeDrawer(true); return; }
    let newIdx = freshList.findIndex(c => c.id === curId);
    if (newIdx === -1) newIdx = Math.min(_curIndex, freshList.length - 1);
    _navList = freshList; _curIndex = newIdx;
    if (!_editMode) renderDrawer();
    else $('cqv-counter').textContent = `${_curIndex + 1} / ${_navList.length}`; // tránh mất dữ liệu đang gõ
});

// ── Khởi tạo ────────────────────────────────────────────────────
function init() {
    injectStyles();
    wireRowOpen();
    wireFilterSync();
    wireKeyboard();
    overrideEditCustomer();
    overridePreviewCustomer();

    // app.js có thể gán window.editCustomer / window.previewCustomer / vẽ
    // DOM theo thứ tự bất đồng bộ — thử lại vài lần trong vài giây đầu để
    // chắc chắn override và các listener đã được gắn đúng (cùng pattern
    // với leads-quickview.js / leads-customers-io.js).
    let tries = 0;
    const timer = setInterval(() => {
        overrideEditCustomer();
        overridePreviewCustomer();
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