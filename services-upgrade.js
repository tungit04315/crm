import { getApp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
    getFirestore, collection, doc,
    addDoc, updateDoc, deleteDoc,
    onSnapshot, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Constants ─────────────────────────────────────────────────────
const APP_ID = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';

const CATEGORIES = [
    { value: 'website', label: '🌐 Thiết kế Website', color: '#3b82f6', light: '#eff6ff', text: '#1d4ed8' },
    { value: 'app', label: '📱 Mobile App', color: '#8b5cf6', light: '#f5f3ff', text: '#6d28d9' },
    { value: 'seo', label: '🔍 SEO & Marketing', color: '#10b981', light: '#ecfdf5', text: '#065f46' },
    { value: 'design', label: '🎨 Thiết kế đồ họa', color: '#ec4899', light: '#fdf2f8', text: '#9d174d' },
    { value: 'consulting', label: '💡 Tư vấn IT', color: '#f59e0b', light: '#fffbeb', text: '#92400e' },
    { value: 'other', label: '📦 Khác', color: '#64748b', light: '#f8fafc', text: '#334155' },
];

const PRICE_UNITS = [
    { value: 'fixed', label: 'Trọn gói' },
    { value: 'monthly', label: '/ tháng' },
    { value: 'hourly', label: '/ giờ' },
];

// ── State ─────────────────────────────────────────────────────────
let _db;
let _servicesCache = [];
let _ckEditor = null;
let _isMyRender = false;
let _currentTags = [];

// ── DOM helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const cat = val => CATEGORIES.find(c => c.value === val) || CATEGORIES[CATEGORIES.length - 1];
const fmt = n => window.formatCurrency
    ? window.formatCurrency(n)
    : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
const toast = (msg, type = 'success') => window.showToast?.(msg, type);

// ─────────────────────────────────────────────────────────────────
//  CKEditor lifecycle
// ─────────────────────────────────────────────────────────────────
async function _initCKEditor(initialData = '') {
    if (!window.ClassicEditor) {
        console.warn('[services-upgrade] ClassicEditor not loaded. Add CKEditor script before this module.');
        return;
    }
    await _destroyCKEditor();

    const el = $('srv-desc-editor');
    if (!el) return;

    try {
        _ckEditor = await ClassicEditor.create(el, {
            toolbar: {
                items: [
                    'heading', '|',
                    'bold', 'italic', 'underline', '|',
                    'bulletedList', 'numberedList', '|',
                    'blockQuote', 'insertTable', '|',
                    'undo', 'redo',
                ],
            },
            placeholder: 'Soạn mô tả chi tiết dịch vụ… (hỗ trợ tiêu đề, danh sách, bảng…)',
        });
        _ckEditor.setData(initialData);
    } catch (e) {
        console.error('[services-upgrade] CKEditor init error:', e);
    }
}

async function _destroyCKEditor() {
    if (_ckEditor) {
        try { await _ckEditor.destroy(); } catch (_) { }
        _ckEditor = null;

        // Re-create blank div for next open (CKEditor removes original element)
        const wrapper = $('srv-desc-wrapper');
        if (wrapper && !$('srv-desc-editor')) {
            const div = document.createElement('div');
            div.id = 'srv-desc-editor';
            wrapper.appendChild(div);
        }
    }
}

const _getCKData = () => _ckEditor ? _ckEditor.getData() : '';

// ─────────────────────────────────────────────────────────────────
//  Tag chip input
// ─────────────────────────────────────────────────────────────────
function _setupTagInput() {
    const input = $('srv-tags-input');
    if (!input) return;

    const addTag = (raw) => {
        const val = raw.trim().replace(/,$/, '');
        if (val && !_currentTags.includes(val)) {
            _currentTags.push(val);
            _renderChips();
        }
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(input.value);
            input.value = '';
        } else if (e.key === 'Backspace' && !input.value && _currentTags.length) {
            _currentTags.pop();
            _renderChips();
        }
    });

    input.addEventListener('blur', () => {
        if (input.value.trim()) { addTag(input.value); input.value = ''; }
    });
}

function _renderChips() {
    const container = $('srv-tags-container');
    const input = $('srv-tags-input');
    if (!container || !input) return;

    container.querySelectorAll('.su-chip').forEach(el => el.remove());

    _currentTags.forEach((tag, idx) => {
        const chip = document.createElement('span');
        chip.className = 'su-chip inline-flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full font-medium';
        chip.innerHTML = `${_esc(tag)}<button type="button" class="opacity-60 hover:opacity-100 ml-0.5 leading-none">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            _currentTags.splice(idx, 1);
            _renderChips();
        });
        container.insertBefore(chip, input);
    });
}

function _setTags(arr) {
    _currentTags = Array.isArray(arr) ? [...arr] : [];
    _renderChips();
}

// ─────────────────────────────────────────────────────────────────
//  Build & inject upgraded service modal HTML
// ─────────────────────────────────────────────────────────────────
function _injectUpgradedModal() {
    const content = $('service-modal-content');
    if (!content) return;

    // Widen the modal
    content.classList.remove('max-w-md');
    content.classList.add('max-w-2xl');

    const catOptions = CATEGORIES.map(c =>
        `<option value="${c.value}">${c.label}</option>`).join('');
    const unitOptions = PRICE_UNITS.map(u =>
        `<option value="${u.value}">${u.label}</option>`).join('');

    content.innerHTML = `
    <!-- ── Header ── -->
    <div class="px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3 shrink-0">
        <div class="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-indigo-500 text-[20px]">design_services</span>
        </div>
        <div class="flex-1 min-w-0">
            <h3 class="font-bold text-base leading-tight" id="service-modal-title">Thêm Dịch Vụ</h3>
            <p class="text-xs text-gray-400">Điền đầy đủ thông tin để tạo dịch vụ</p>
        </div>
        <button onclick="closeModal('service-modal')"
            class="text-gray-400 hover:text-red-500 w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-full transition-colors shrink-0">
            <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
    </div>

    <!-- ── Form ── -->
    <form id="service-form" class="flex-1 overflow-y-auto" autocomplete="off">
        <!-- Hidden backward-compat fields that app.js openModal tries to write -->
        <input type="hidden" id="srv-id">
        <input type="hidden" id="srv-desc">

        <div class="p-5 space-y-6">

            <!-- ══ Section 1: Thông tin cơ bản ══ -->
            <div class="space-y-4">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black uppercase tracking-widest text-indigo-500">01</span>
                    <span class="h-px flex-1 bg-gradient-to-r from-indigo-200 to-transparent dark:from-indigo-700"></span>
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Thông tin cơ bản</span>
                    <span class="h-px w-8 bg-gray-100 dark:bg-slate-700"></span>
                </div>

                <!-- Tên dịch vụ -->
                <div>
                    <label class="su-label">Tên dịch vụ <span class="text-red-400">*</span></label>
                    <input type="text" id="srv-name" required
                        placeholder="VD: Thiết kế Website Landing Page Pro"
                        class="su-input">
                </div>

                <!-- Danh mục + Trạng thái -->
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="su-label">Danh mục</label>
                        <select id="srv-category" class="su-input">${catOptions}</select>
                    </div>
                    <div>
                        <label class="su-label">Trạng thái</label>
                        <select id="srv-status" class="su-input">
                            <option value="active">✅ Đang hoạt động</option>
                            <option value="inactive">⏸️ Tạm dừng</option>
                        </select>
                    </div>
                </div>

                <!-- Nổi bật toggle -->
                <label id="srv-highlight-label"
                    class="flex items-center gap-3 p-3 rounded-xl border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-900/10 cursor-pointer transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20">
                    <input type="checkbox" id="srv-highlight" class="h-4 w-4 accent-amber-500 rounded">
                    <div>
                        <p class="text-sm font-semibold text-amber-700 dark:text-amber-400">⭐ Đánh dấu nổi bật</p>
                        <p class="text-xs text-amber-600/70 dark:text-amber-500/60">Hiển thị huy hiệu "Nổi bật" trên thẻ dịch vụ</p>
                    </div>
                </label>
            </div>

            <!-- ══ Section 2: Giá & Điều khoản ══ -->
            <div class="space-y-4">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black uppercase tracking-widest text-emerald-500">02</span>
                    <span class="h-px flex-1 bg-gradient-to-r from-emerald-200 to-transparent dark:from-emerald-700"></span>
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Giá & Điều khoản</span>
                    <span class="h-px w-8 bg-gray-100 dark:bg-slate-700"></span>
                </div>

                <!-- Giá + Hình thức -->
                <div class="grid grid-cols-5 gap-3">
                    <div class="col-span-3">
                        <label class="su-label">Giá dịch vụ (VNĐ) <span class="text-red-400">*</span></label>
                        <div class="relative">
                            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">₫</span>
                            <input type="number" id="srv-price" required min="0" placeholder="5000000"
                                class="su-input pl-7">
                        </div>
                    </div>
                    <div class="col-span-2">
                        <label class="su-label">Hình thức</label>
                        <select id="srv-price-unit" class="su-input">${unitOptions}</select>
                    </div>
                </div>

                <!-- Thời gian + Chỉnh sửa + Bảo hành -->
                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="su-label">Thời gian HT</label>
                        <input type="text" id="srv-duration" placeholder="7–14 ngày"
                            class="su-input">
                    </div>
                    <div>
                        <label class="su-label">Chỉnh sửa miễn phí</label>
                        <div class="relative">
                            <input type="number" id="srv-free-edits" min="0" placeholder="3"
                                class="su-input pr-9">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium">lần</span>
                        </div>
                    </div>
                    <div>
                        <label class="su-label">Bảo hành</label>
                        <div class="relative">
                            <input type="number" id="srv-warranty" min="0" placeholder="12"
                                class="su-input pr-11">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium">tháng</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ══ Section 3: Tags & Mô tả ngắn ══ -->
            <div class="space-y-4">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black uppercase tracking-widest text-violet-500">03</span>
                    <span class="h-px flex-1 bg-gradient-to-r from-violet-200 to-transparent dark:from-violet-700"></span>
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Tags & Mô tả card</span>
                    <span class="h-px w-8 bg-gray-100 dark:bg-slate-700"></span>
                </div>

                <!-- Tags chip input -->
                <div>
                    <label class="su-label">Tags
                        <span class="font-normal text-gray-400">(Enter hoặc dấu phẩy để thêm)</span>
                    </label>
                    <div id="srv-tags-container"
                        class="min-h-[44px] px-2 py-1.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl flex flex-wrap gap-1.5 items-center focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:focus-within:ring-indigo-900 transition cursor-text"
                        onclick="document.getElementById('srv-tags-input').focus()">
                        <input type="text" id="srv-tags-input"
                            placeholder="Nhập tag…"
                            class="flex-1 min-w-[80px] bg-transparent text-sm outline-none py-0.5 px-1">
                    </div>
                </div>

                <!-- Mô tả ngắn -->
                <div>
                    <label class="su-label">Mô tả ngắn
                        <span class="font-normal text-gray-400">(hiển thị trực tiếp trên card)</span>
                    </label>
                    <textarea id="srv-short-desc" rows="2"
                        placeholder="Tóm tắt ngắn gọn, dễ hiểu về dịch vụ này…"
                        class="su-input resize-none"></textarea>
                </div>
            </div>

            <!-- ══ Section 4: Mô tả chi tiết CKEditor ══ -->
            <div class="space-y-3">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black uppercase tracking-widest text-rose-500">04</span>
                    <span class="h-px flex-1 bg-gradient-to-r from-rose-200 to-transparent dark:from-rose-700"></span>
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Mô tả chi tiết</span>
                    <span class="h-px w-8 bg-gray-100 dark:bg-slate-700"></span>
                </div>
                <p class="text-xs text-gray-400 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-indigo-400">info</span>
                    Nội dung đầy đủ — chỉ hiện khi bấm <strong class="text-gray-600 dark:text-gray-300">Xem chi tiết</strong> trên card
                </p>
                <div id="srv-desc-wrapper"
                    class="rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 focus-within:border-indigo-400 transition">
                    <div id="srv-desc-editor"></div>
                </div>
            </div>

        </div><!-- /p-5 -->

        <!-- ── Footer buttons ── -->
        <div class="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row justify-end gap-2 shrink-0 bg-gray-50/60 dark:bg-slate-800/40">
            <button type="button" onclick="closeModal('service-modal')"
                class="order-last sm:order-first w-full sm:w-auto px-5 py-2.5 text-sm font-medium bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                Hủy
            </button>
            <button type="submit"
                class="order-first sm:order-last w-full sm:w-auto px-6 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 dark:shadow-indigo-900/30 flex items-center justify-center gap-2 transition-colors">
                <span class="material-symbols-outlined text-[16px]">save</span>
                Lưu dịch vụ
            </button>
        </div>
    </form>`;

    _setupTagInput();
    $('service-form').addEventListener('submit', _handleServiceSubmit);
}

// ─────────────────────────────────────────────────────────────────
//  Populate form fields
// ─────────────────────────────────────────────────────────────────
function _populateServiceForm(data) {
    $('srv-id').value = data?.id || '';
    $('srv-name').value = data?.name || '';
    $('srv-category').value = data?.category || 'website';
    $('srv-status').value = data?.status || 'active';
    $('srv-price').value = data?.price || '';
    $('srv-price-unit').value = data?.priceUnit || 'fixed';
    $('srv-duration').value = data?.duration || '';
    $('srv-free-edits').value = data?.freeEdits != null ? data.freeEdits : '';
    $('srv-warranty').value = data?.warranty != null ? data.warranty : '';
    $('srv-highlight').checked = !!data?.highlight;

    // Backward compat: old records store plain desc; new ones have shortDesc + desc (HTML)
    $('srv-short-desc').value = data?.shortDesc
        ?? (data?.desc ? data.desc.replace(/<[^>]+>/g, '').slice(0, 200) : '');

    _setTags(data?.tags || []);
}

// ─────────────────────────────────────────────────────────────────
//  Form submit handler
// ─────────────────────────────────────────────────────────────────
async function _handleServiceSubmit(e) {
    e.preventDefault();
    e.stopImmediatePropagation(); // prevent old app.js listener if it's still live

    const id = $('srv-id').value.trim();
    const richDesc = _getCKData();

    const data = {
        name: $('srv-name').value.trim(),
        category: $('srv-category').value,
        status: $('srv-status').value,
        price: Number($('srv-price').value) || 0,
        priceUnit: $('srv-price-unit').value,
        duration: $('srv-duration').value.trim(),
        freeEdits: Number($('srv-free-edits').value) || 0,
        warranty: Number($('srv-warranty').value) || 0,
        highlight: $('srv-highlight').checked,
        shortDesc: $('srv-short-desc').value.trim(),
        desc: richDesc,   // HTML from CKEditor (used in detail modal)
        tags: [..._currentTags],
        updatedAt: serverTimestamp(),
    };

    if (!data.name) { toast('Vui lòng nhập tên dịch vụ', 'error'); return; }
    if (!data.price) { toast('Vui lòng nhập giá dịch vụ', 'error'); return; }

    try {
        const col = collection(_db, 'artifacts', APP_ID, 'public', 'data', 'services');
        if (id) {
            await updateDoc(doc(_db, 'artifacts', APP_ID, 'public', 'data', 'services', id), data);
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(col, data);
        }
        toast('✅ Lưu dịch vụ thành công!');
        window.closeModal('service-modal');
    } catch (err) {
        console.error('[services-upgrade] save error:', err);
        toast('Lỗi khi lưu: ' + err.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────
//  Service Detail Modal
// ─────────────────────────────────────────────────────────────────
function _injectDetailModal() {
    if ($('service-detail-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'service-detail-modal';
    modal.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm hidden opacity-0 transition-opacity duration-200 p-4';

    modal.innerHTML = `
    <div id="service-detail-content"
         class="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col max-h-[90vh] transform scale-95 transition-transform duration-200">

        <!-- Header -->
        <div class="p-5 border-b border-gray-100 dark:border-slate-800 flex items-start gap-4 shrink-0">
            <div id="sdm-cat-icon"
                class="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm">
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span id="sdm-cat-badge"    class="text-[10px] font-bold px-2 py-0.5 rounded-full"></span>
                    <span id="sdm-highlight-b"  class="hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⭐ Nổi bật</span>
                    <span id="sdm-status-b"     class="text-[10px] font-bold px-2 py-0.5 rounded-full"></span>
                </div>
                <h2 id="sdm-name" class="font-black text-xl leading-tight truncate"></h2>
                <p  id="sdm-price" class="text-2xl font-black mt-0.5"></p>
            </div>
            <div class="flex gap-2 shrink-0">
                <button id="sdm-edit-btn"
                    class="px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100">
                    <span class="material-symbols-outlined text-[14px]">edit</span> Sửa
                </button>
                <button onclick="window._closeServiceDetail()"
                    class="text-gray-400 hover:text-red-500 w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-full transition-colors">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>

        <!-- Meta row -->
        <div id="sdm-meta"
            class="px-5 py-3 bg-gray-50 dark:bg-slate-800/60 border-b border-gray-100 dark:border-slate-800 flex flex-wrap gap-5 shrink-0">
        </div>

        <!-- Tags -->
        <div id="sdm-tags-row"
            class="hidden px-5 py-3 border-b border-gray-100 dark:border-slate-800 shrink-0">
            <div id="sdm-tags" class="flex flex-wrap gap-1.5"></div>
        </div>

        <!-- Short desc -->
        <div id="sdm-short-desc-row"
            class="hidden px-5 py-3 border-b border-gray-100 dark:border-slate-800 shrink-0">
            <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Tóm tắt</p>
            <p id="sdm-short-desc" class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed"></p>
        </div>

        <!-- Rich content -->
        <div class="flex-1 overflow-y-auto p-5">
            <div id="sdm-desc-empty" class="hidden text-center py-10 text-gray-400">
                <span class="material-symbols-outlined text-4xl block mb-2 opacity-40">description</span>
                <p class="text-sm">Chưa có mô tả chi tiết.</p>
                <button onclick="window._closeServiceDetail(); setTimeout(()=>document.getElementById('sdm-edit-btn-inline')?.click(), 200)"
                    class="mt-3 text-xs text-indigo-500 hover:underline">Thêm mô tả →</button>
            </div>
            <div id="sdm-desc-content" class="sdm-rich-content hidden"></div>
        </div>
    </div>`;

    document.body.appendChild(modal);

    window._closeServiceDetail = () => {
        modal.classList.add('opacity-0');
        $('service-detail-content')?.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 200);
    };

    modal.addEventListener('click', e => {
        if (e.target === modal) window._closeServiceDetail();
    });
}

function _openServiceDetail(srvId) {
    const srv = _servicesCache.find(s => s.id === srvId);
    if (!srv) { toast('Không tìm thấy dịch vụ', 'error'); return; }

    const c = cat(srv.category);
    const unit = PRICE_UNITS.find(u => u.value === srv.priceUnit)?.label || '';

    // Cat icon
    const icon = $('sdm-cat-icon');
    icon.textContent = c.label.split(' ')[0]; // emoji
    icon.style.background = c.light;

    // Badges
    const catBadge = $('sdm-cat-badge');
    catBadge.textContent = c.label;
    catBadge.style.background = c.light;
    catBadge.style.color = c.text;

    const hlBadge = $('sdm-highlight-b');
    hlBadge.classList.toggle('hidden', !srv.highlight);

    const stBadge = $('sdm-status-b');
    const isActive = srv.status !== 'inactive';
    stBadge.textContent = isActive ? '✅ Hoạt động' : '⏸ Tạm dừng';
    stBadge.style.background = isActive ? '#f0fdf4' : '#f1f5f9';
    stBadge.style.color = isActive ? '#15803d' : '#64748b';

    // Name + price
    $('sdm-name').textContent = srv.name;
    const priceEl = $('sdm-price');
    priceEl.textContent = fmt(srv.price) + (unit ? `  ${unit}` : '');
    priceEl.style.background = `linear-gradient(135deg, ${c.color}, ${c.color}bb)`;
    priceEl.style.webkitBackgroundClip = 'text';
    priceEl.style.webkitTextFillColor = 'transparent';
    priceEl.style.backgroundClip = 'text';

    // Meta row
    const metas = [];
    if (srv.duration) metas.push(_metaItem('schedule', 'Thời gian', srv.duration, c.color));
    if (srv.warranty) metas.push(_metaItem('shield', 'Bảo hành', `${srv.warranty} tháng`, '#10b981'));
    if (srv.freeEdits) metas.push(_metaItem('edit_note', 'Chỉnh sửa miễn phí', `${srv.freeEdits} lần`, '#3b82f6'));
    $('sdm-meta').innerHTML = metas.length
        ? metas.join('')
        : '<p class="text-xs text-gray-400 italic">Không có thông tin bổ sung</p>';

    // Tags
    const tags = Array.isArray(srv.tags) ? srv.tags : [];
    const tagsRow = $('sdm-tags-row');
    if (tags.length) {
        tagsRow.classList.remove('hidden');
        $('sdm-tags').innerHTML = tags.map(t =>
            `<span class="inline-block text-xs px-2.5 py-0.5 rounded-full font-medium"
                   style="background:${c.light};color:${c.text}">#${_esc(t)}</span>`
        ).join('');
    } else {
        tagsRow.classList.add('hidden');
    }

    // Short desc
    const sdRow = $('sdm-short-desc-row');
    const shortDesc = srv.shortDesc || '';
    if (shortDesc) {
        sdRow.classList.remove('hidden');
        $('sdm-short-desc').textContent = shortDesc;
    } else {
        sdRow.classList.add('hidden');
    }

    // Rich content
    const raw = srv.desc || '';
    const hasRich = raw.trim() && raw !== '<p></p>' && raw !== '<p>&nbsp;</p>';
    $('sdm-desc-empty').classList.toggle('hidden', hasRich);
    const richEl = $('sdm-desc-content');
    richEl.classList.toggle('hidden', !hasRich);
    if (hasRich) richEl.innerHTML = raw;

    // Edit button
    $('sdm-edit-btn').onclick = () => {
        window._closeServiceDetail();
        setTimeout(() => window.editService(srv), 250);
    };

    // Animate in
    const modal = $('service-detail-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        $('service-detail-content')?.classList.remove('scale-95');
    });
}

function _metaItem(icon, label, value, color) {
    return `
    <div class="flex items-center gap-2 text-sm">
        <span class="material-symbols-outlined text-[18px]" style="color:${color}">${icon}</span>
        <div>
            <p class="text-[10px] text-gray-400 leading-none mb-0.5">${label}</p>
            <p class="font-bold text-gray-800 dark:text-gray-200 leading-none">${value}</p>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
//  Enhanced card render (replaces app.js renderServices output)
// ─────────────────────────────────────────────────────────────────
function _renderEnhancedGrid() {
    if (_isMyRender) return;

    const grid = $('services-grid');
    if (!grid) return;

    // Only replace content when in services view
    const viewEl = document.getElementById('view-services');
    if (!viewEl || viewEl.classList.contains('hidden')) return;

    if (!_servicesCache.length) return; // let app.js empty state show

    const keyword = ($('search-service')?.value || '').toLowerCase();
    const filtered = _servicesCache.filter(s =>
        (s.name || '').toLowerCase().includes(keyword) ||
        (s.shortDesc || '').toLowerCase().includes(keyword) ||
        (s.category || '').toLowerCase().includes(keyword) ||
        (s.tags || []).some(t => t.toLowerCase().includes(keyword))
    );

    if (!filtered.length) return; // let app.js "Không tìm thấy" show

    _isMyRender = true;

    grid.innerHTML = filtered.map(srv => {
        const c = cat(srv.category);
        const unit = PRICE_UNITS.find(u => u.value === srv.priceUnit)?.label || '';
        const tags = Array.isArray(srv.tags) ? srv.tags.slice(0, 3) : [];
        const isActive = srv.status !== 'inactive';
        const desc = srv.shortDesc
            || (srv.desc ? srv.desc.replace(/<[^>]+>/g, '').slice(0, 150) : '');

        const srvJson = JSON.stringify(srv).replace(/'/g, '&#39;');

        return `
        <div class="srv-card-u flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden group transition-all duration-200 hover:shadow-xl hover:-translate-y-1 ${!isActive ? 'opacity-70' : ''}">

            <!-- Colored top stripe -->
            <div class="h-[5px] w-full" style="background:linear-gradient(90deg, ${c.color}, ${c.color}88)"></div>

            <div class="flex flex-col flex-1 p-4">
                <!-- Badges + action buttons -->
                <div class="flex items-start justify-between mb-3 gap-2">
                    <div class="flex flex-wrap gap-1 flex-1 min-w-0">
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full leading-none"
                              style="background:${c.light};color:${c.text}">${c.label}</span>
                        ${srv.highlight ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 leading-none">⭐ Nổi bật</span>` : ''}
                        ${!isActive ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 leading-none">⏸ Tạm dừng</span>` : ''}
                    </div>
                    <!-- Action buttons (hover) -->
                    <div class="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button onclick='window.editService(${srvJson})' title="Sửa"
                            class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 bg-gray-100 dark:bg-slate-700 transition-colors">
                            <span class="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button onclick="window.deleteService('${srv.id}')" title="Xóa"
                            class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-500 bg-gray-100 dark:bg-slate-700 transition-colors">
                            <span class="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                    </div>
                </div>

                <!-- Name -->
                <h4 class="font-bold text-sm leading-snug mb-2 line-clamp-2">${_esc(srv.name)}</h4>

                <!-- Price -->
                <p class="text-lg font-black mb-1" style="color:${c.color}">${fmt(srv.price)}<span class="text-xs font-normal text-gray-400 ml-1">${unit}</span></p>

                <!-- Short description -->
                ${desc
                ? `<p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 flex-1 leading-relaxed">${_esc(desc)}</p>`
                : `<div class="flex-1"></div>`
            }

                <!-- Meta pills -->
                <div class="flex flex-wrap gap-1.5 mb-3">
                    ${srv.duration ? `<span class="srv-pill"><span class="material-symbols-outlined text-[11px]">schedule</span>${_esc(srv.duration)}</span>` : ''}
                    ${srv.warranty ? `<span class="srv-pill srv-pill-green"><span class="material-symbols-outlined text-[11px]">shield</span>BH ${srv.warranty}T</span>` : ''}
                    ${srv.freeEdits ? `<span class="srv-pill srv-pill-blue"><span class="material-symbols-outlined text-[11px]">edit_note</span>${srv.freeEdits} sửa</span>` : ''}
                </div>

                <!-- Tags -->
                ${tags.length ? `
                <div class="flex flex-wrap gap-1 mb-3">
                    ${tags.map(t => `<span class="text-[10px] px-1.5 py-0.5 rounded font-medium" style="background:${c.light};color:${c.color}">#${_esc(t)}</span>`).join('')}
                    ${(srv.tags?.length || 0) > 3 ? `<span class="text-[10px] text-gray-400 self-center">+${srv.tags.length - 3}</span>` : ''}
                </div>` : ''}

                <!-- Detail button -->
                <button onclick="window._openServiceDetail('${srv.id}')"
                    class="mt-auto w-full py-2 text-xs font-semibold rounded-xl border transition-all duration-150 flex items-center justify-center gap-1.5"
                    style="color:${c.color};border-color:${c.color}44"
                    onmouseover="this.style.background='${c.color}';this.style.color='#fff'"
                    onmouseout="this.style.background='transparent';this.style.color='${c.color}'">
                    <span class="material-symbols-outlined text-[14px]">open_in_full</span>
                    Xem chi tiết
                </button>
            </div>
        </div>`;
    }).join('');

    _isMyRender = false;
}

// ─────────────────────────────────────────────────────────────────
//  Override global functions
// ─────────────────────────────────────────────────────────────────
function _overrideGlobals() {
    // editService: open modal + populate extended fields + init CKEditor
    window.editService = (data) => {
        // Call original openModal to handle modal show animation + basic fields
        window.openModal('service-modal', null); // null so app.js sets title + clears srv-desc
        // Then fix title and populate OUR extended fields
        setTimeout(() => {
            if ($('service-modal-title')) $('service-modal-title').innerText = 'Sửa Dịch Vụ';
            _populateServiceForm(data);
        }, 30);
        // Init CKEditor with existing rich desc
        const richDesc = data?.desc || '';
        setTimeout(() => _initCKEditor(richDesc), 120);
    };

    // deleteService: friendlier confirm
    window.deleteService = async (id) => {
        if (!confirm('Xóa dịch vụ này?\nThao tác không thể hoàn tác.')) return;
        try {
            await deleteDoc(doc(_db, 'artifacts', APP_ID, 'public', 'data', 'services', id));
            toast('🗑️ Đã xóa dịch vụ');
        } catch (e) {
            toast('Lỗi khi xóa: ' + e.message, 'error');
        }
    };

    // Expose detail modal opener
    window._openServiceDetail = _openServiceDetail;

    // Wrap openModal: when opening service-modal for NEW service, init CKEditor
    const origOpen = window.openModal;
    window.openModal = function (id, data = null) {
        origOpen(id, data);
        if (id === 'service-modal' && data === null) {
            // "Thêm Dịch Vụ" path
            setTimeout(() => _populateServiceForm(null), 30);
            setTimeout(() => _initCKEditor(''), 120);
        }
    };

    // Wrap closeModal: destroy CKEditor when service modal closes
    const origClose = window.closeModal;
    window.closeModal = function (id) {
        if (id === 'service-modal') _destroyCKEditor();
        origClose(id);
    };
}

// ─────────────────────────────────────────────────────────────────
//  Watch services-grid for app.js re-renders → replace with ours
// ─────────────────────────────────────────────────────────────────
function _watchGrid() {
    const grid = $('services-grid');
    if (!grid) return;

    const obs = new MutationObserver(() => {
        if (_isMyRender) return;
        requestAnimationFrame(_renderEnhancedGrid);
    });
    obs.observe(grid, { childList: true });
}

// ─────────────────────────────────────────────────────────────────
//  Inject CSS
// ─────────────────────────────────────────────────────────────────
function _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
    /* ── Form input base ── */
    .su-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #6b7280;
        margin-bottom: 6px;
        letter-spacing: .01em;
    }
    .dark .su-label { color: #9ca3af; }

    .su-input {
        width: 100%;
        padding: 10px 12px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        font-size: 13px;
        outline: none;
        transition: border-color .15s, box-shadow .15s;
        color: inherit;
        line-height: 1.4;
    }
    .dark .su-input {
        background: #1e293b;
        border-color: #334155;
        color: #e2e8f0;
    }
    .su-input:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99,102,241,.12);
    }
    select.su-input { cursor: pointer; }

    /* ── Service card pills ── */
    .srv-pill {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #475569;
        border: 1px solid #e2e8f0;
        font-weight: 500;
    }
    .dark .srv-pill { background: #1e293b; color: #94a3b8; border-color: #334155; }
    .srv-pill-green { background: #f0fdf4 !important; color: #15803d !important; border-color: #dcfce7 !important; }
    .srv-pill-blue  { background: #eff6ff !important; color: #1d4ed8 !important; border-color: #dbeafe !important; }
    .dark .srv-pill-green { background: rgba(16,185,129,.1) !important; color: #34d399 !important; border-color: rgba(16,185,129,.2) !important; }
    .dark .srv-pill-blue  { background: rgba(59,130,246,.1) !important; color: #60a5fa !important; border-color: rgba(59,130,246,.2) !important; }

    /* ── Card hover ── */
    .srv-card-u { will-change: transform, box-shadow; }

    /* ── Detail modal rich content ── */
    .sdm-rich-content h1,.sdm-rich-content h2,.sdm-rich-content h3 {
        font-weight: 700; margin: 1.2em 0 .5em; color: #1e293b;
    }
    .dark .sdm-rich-content h1,.dark .sdm-rich-content h2,.dark .sdm-rich-content h3 { color: #e2e8f0; }
    .sdm-rich-content h1 { font-size: 1.35em; }
    .sdm-rich-content h2 { font-size: 1.15em; }
    .sdm-rich-content h3 { font-size: 1em; }
    .sdm-rich-content p  { margin: .5em 0; line-height: 1.75; font-size: 14px; color: #374151; }
    .dark .sdm-rich-content p { color: #cbd5e1; }
    .sdm-rich-content ul,.sdm-rich-content ol { padding-left: 1.5em; margin: .6em 0; }
    .sdm-rich-content li { margin: .3em 0; font-size: 14px; color: #374151; }
    .dark .sdm-rich-content li { color: #cbd5e1; }
    .sdm-rich-content blockquote {
        border-left: 3px solid #6366f1; padding-left: 1em;
        color: #64748b; margin: 1em 0; font-style: italic;
        background: #f8fafc; border-radius: 0 8px 8px 0; padding: .75em 1em;
    }
    .sdm-rich-content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
    .sdm-rich-content td,.sdm-rich-content th {
        border: 1px solid #e2e8f0; padding: 7px 12px;
    }
    .sdm-rich-content th { background: #f8fafc; font-weight: 700; text-align: left; }
    .dark .sdm-rich-content th { background: #1e293b; border-color: #334155; }
    .dark .sdm-rich-content td { border-color: #334155; }
    .sdm-rich-content strong,.sdm-rich-content b { font-weight: 700; }

    /* ── CKEditor theme fixes ── */
    .ck-editor__editable_inline { min-height: 200px !important; font-size: 13px !important; }
    .ck.ck-toolbar {
        border-radius: 10px 10px 0 0 !important;
        background: #f8fafc !important;
        border-color: transparent !important;
    }
    .ck.ck-editor__main > .ck-editor__editable {
        border-radius: 0 0 10px 10px !important;
        border-color: transparent !important;
        font-size: 13px;
        line-height: 1.75;
    }
    .dark .ck.ck-toolbar { background: #1e293b !important; }
    .dark .ck.ck-editor__main > .ck-editor__editable {
        background: #0f172a !important;
        color: #e2e8f0 !important;
    }
    .dark .ck.ck-button:not(.ck-disabled) { color: #94a3b8; }
    `;
    document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────
//  XSS-safe text escape
// ─────────────────────────────────────────────────────────────────
function _esc(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// ─────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────
function _init() {
    try {
        _db = getFirestore(getApp());
    } catch (e) {
        // Firebase App not ready yet — retry
        setTimeout(_init, 200);
        return;
    }

    _injectStyles();
    _injectDetailModal();
    _injectUpgradedModal();
    _overrideGlobals();
    _watchGrid();

    // Own Firestore subscription — powers the enhanced card render
    const col = collection(_db, 'artifacts', APP_ID, 'public', 'data', 'services');
    onSnapshot(query(col), snap => {
        _servicesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderEnhancedGrid();
    });

    console.info('[services-upgrade] ✅ v1.0 loaded');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 250));
} else {
    setTimeout(_init, 250);
}