/**
 * ============================================================
 *  PROJECTS MODULE — Quản Lý Dự Án
 *  Tích hợp vào CRM NeoWave (gắn sau app.js)
 *  Firebase App + Firestore + Storage dùng chung instance.
 * ============================================================
 */

import {
    getStorage, ref as storageRef, uploadString,
    getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import {
    getFirestore, collection, addDoc, updateDoc, deleteDoc,
    doc, onSnapshot, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

// ── Firebase instances — khởi tạo lazy bên trong initProjectsModule()
//    để tránh lỗi "No Firebase App" khi module load trước app.js
let _db, _storage;

const APP_ID      = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const projectsCol = () => collection(_db, 'artifacts', APP_ID, 'public', 'data', 'projects');
const projectsRef = (id) => doc(_db, 'artifacts', APP_ID, 'public', 'data', 'projects', id);

// ── Helpers (fallback nếu app.js chưa có)
const toast = (msg, type = 'success') =>
    window.showToast ? window.showToast(msg, type) : console.log(`[${type}]`, msg);
const fmtCurrency = (n) =>
    window.formatCurrency
        ? window.formatCurrency(n)
        : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
const fmtDate = (ts) =>
    window.formatDateStr
        ? window.formatDateStr(ts)
        : (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts || 0))
              .toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── State
let projectsData    = [];   // Toàn bộ raw data từ Firestore
let filteredData    = [];   // Sau filter/sort
let currentPage     = 1;
const PER_PAGE      = 6;

let lightboxImages  = [];   // URLs đang xem trong lightbox
let lightboxIdx     = 0;

let editingId       = null; // null = thêm mới
let pendingImages   = [];   // [{isExisting, storageUrl?, previewUrl, file?}]
let imagesToDelete  = [];   // Storage URLs cần xóa khi save

// ═══════════════════════════════════════════════════════════
//  KHỞI ĐỘNG – gọi từ initAppLogic() trong app.js
// ═══════════════════════════════════════════════════════════
export function initProjectsModule() {
    // Khởi tạo Firebase sau khi app.js đã gọi initializeApp()
    const _app = getApp();
    _db      = getFirestore(_app);
    _storage = getStorage(_app);

    // Realtime listener Firestore
    const unsub = onSnapshot(query(projectsCol()), snap => {
        projectsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _applyFilters();
    });
    // Đăng ký vào danh sách unsubscribes của app.js (nếu có)
    if (Array.isArray(window.__projectUnsubs)) window.__projectUnsubs.push(unsub);

    _bindForm();
    _bindFilters();
    _bindLightboxKeys();
    _bindDropzone();
}

// ═══════════════════════════════════════════════════════════
//  FILTER + SORT + PAGINATE
// ═══════════════════════════════════════════════════════════
function _applyFilters() {
    const q      = (document.getElementById('prj-search')?.value || '').toLowerCase();
    const sector = document.getElementById('prj-filter-sector')?.value || '';
    const minP   = parseFloat(document.getElementById('prj-filter-min')?.value) || 0;
    const rawMax = parseFloat(document.getElementById('prj-filter-max')?.value) || 0;
    const maxP   = rawMax > 0 ? rawMax : Infinity;
    const sort   = document.getElementById('prj-sort')?.value || 'newest';

    filteredData = projectsData.filter(p => {
        const price = parseFloat(p.price) || 0;
        return (!q      || (p.name || '').toLowerCase().includes(q))
            && (!sector || (p.sector || '') === sector)
            && price >= minP && price <= maxP;
    });

    const ts = x => x.createdAt?.seconds || 0;
    filteredData.sort((a, b) => {
        if (sort === 'newest')     return ts(b) - ts(a);
        if (sort === 'oldest')     return ts(a) - ts(b);
        if (sort === 'price_asc')  return (parseFloat(a.price)||0) - (parseFloat(b.price)||0);
        if (sort === 'price_desc') return (parseFloat(b.price)||0) - (parseFloat(a.price)||0);
        return 0;
    });

    const maxPage = Math.max(1, Math.ceil(filteredData.length / PER_PAGE));
    if (currentPage > maxPage) currentPage = maxPage;

    _renderGrid();
    _renderPagination();
    _refreshSectorOptions();
    _updateCounters();
}

function _updateCounters() {
    const el  = document.getElementById('prj-count');   if (el) el.textContent  = filteredData.length;
    const tel = document.getElementById('prj-total');   if (tel) tel.textContent = projectsData.length;
}

function _refreshSectorOptions() {
    const sel = document.getElementById('prj-filter-sector');
    if (!sel) return;
    const cur = sel.value;
    const opts = [...new Set(projectsData.map(p => p.sector).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">Tất cả ngành nghề</option>`
        + opts.map(s => `<option value="${s}"${s===cur?' selected':''}>${s}</option>`).join('');
}

// ═══════════════════════════════════════════════════════════
//  RENDER CARDS
// ═══════════════════════════════════════════════════════════
function _renderGrid() {
    const grid  = document.getElementById('projects-grid');
    const empty = document.getElementById('prj-empty');
    if (!grid) return;

    const start = (currentPage - 1) * PER_PAGE;
    const items = filteredData.slice(start, start + PER_PAGE);

    if (filteredData.length === 0) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');
    grid.innerHTML = items.map(_cardHTML).join('');
}

function _cardHTML(p) {
    const imgs   = Array.isArray(p.images) ? p.images : [];
    const thumb  = imgs[0] || '';
    const price  = parseFloat(p.price) || 0;
    const desc   = (p.desc || '').length > 100 ? p.desc.slice(0, 100) + '…' : (p.desc || '');
    const safe   = (s) => (s || '').replace(/'/g, "\\'");

    return `<div class="prj-card glass rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col border border-gray-200/60 dark:border-slate-700/60 group">

        <!-- Thumbnail -->
        <div class="relative overflow-hidden bg-gray-100 dark:bg-slate-800 aspect-video cursor-pointer flex-shrink-0"
             onclick="window.openProjectDetail('${p.id}')">
            ${thumb
                ? `<img src="${thumb}" alt="${safe(p.name)}" loading="lazy"
                        class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'flex items-center justify-center h-full text-gray-300',innerHTML:'<span class=\\'material-symbols-outlined text-5xl\\'>broken_image</span>'}))"/>`
                : `<div class="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                       <span class="material-symbols-outlined text-4xl">add_photo_alternate</span>
                       <span class="text-xs">Chưa có ảnh</span></div>`}
            ${imgs.length > 1
                ? `<div class="absolute top-2 right-2 bg-black/50 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 backdrop-blur-sm">
                       <span class="material-symbols-outlined text-[13px]">photo_library</span>${imgs.length}
                   </div>` : ''}
        </div>

        <!-- Body -->
        <div class="p-4 flex flex-col flex-1 gap-2.5">
            <div class="flex items-start gap-2">
                <h3 class="font-bold text-sm leading-snug flex-1 line-clamp-2 cursor-pointer hover:text-primary transition-colors"
                    onclick="window.openProjectDetail('${p.id}')">${p.name || 'Chưa đặt tên'}</h3>
                ${p.sector ? `<span class="shrink-0 mt-0.5 text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">${p.sector}</span>` : ''}
            </div>

            ${desc ? `<p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">${desc}</p>` : ''}

            <div class="mt-auto pt-3 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-slate-800">
                <span class="font-bold text-sm text-primary">
                    ${price > 0 ? fmtCurrency(price) : `<span class="font-normal text-xs text-gray-400">Liên hệ</span>`}
                </span>
                <div class="flex items-center gap-1.5">
                    <button onclick="window.openProjectDetail('${p.id}')" title="Xem chi tiết"
                        class="w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white flex items-center justify-center transition-all active:scale-90">
                        <span class="material-symbols-outlined text-[16px]">visibility</span>
                    </button>
                    <button onclick="window.editProject('${p.id}')" title="Sửa"
                        class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 hover:bg-amber-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                        <span class="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button onclick="window.deleteProject('${p.id}','${safe(p.name)}')" title="Xoá"
                        class="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                        <span class="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                </div>
            </div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  PAGINATION
// ═══════════════════════════════════════════════════════════
function _renderPagination() {
    const wrap  = document.getElementById('prj-pagination');
    if (!wrap) return;
    const total = Math.ceil(filteredData.length / PER_PAGE);
    if (total <= 1) { wrap.innerHTML = ''; return; }

    const range = _pageRange(currentPage, total);
    let html = `<button class="pagination-btn arrow" onclick="window.prjPage(${currentPage-1})" ${currentPage===1?'disabled':''}><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>`;
    range.forEach(n => {
        html += n === '…'
            ? `<span class="px-1 text-gray-400 self-end pb-1 text-sm">…</span>`
            : `<button class="pagination-btn${n===currentPage?' active':''}" onclick="window.prjPage(${n})">${n}</button>`;
    });
    html += `<button class="pagination-btn arrow" onclick="window.prjPage(${currentPage+1})" ${currentPage===total?'disabled':''}><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>`;
    wrap.innerHTML = html;
}

function _pageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', cur-1, cur, cur+1, '…', total];
}

window.prjPage = (page) => {
    const total = Math.ceil(filteredData.length / PER_PAGE);
    if (page < 1 || page > total) return;
    currentPage = page;
    _renderGrid();
    _renderPagination();
    document.getElementById('view-projects')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ═══════════════════════════════════════════════════════════
//  CHI TIẾT DỰ ÁN + LIGHTBOX
// ═══════════════════════════════════════════════════════════
window.openProjectDetail = (id) => {
    const p = projectsData.find(x => x.id === id);
    if (!p) return;

    lightboxImages = Array.isArray(p.images) ? p.images : [];
    lightboxIdx    = 0;

    // Text info
    _setText('pdm-name',    p.name || '—');
    _setText('pdm-sector',  p.sector || '—');
    _setText('pdm-price',   p.price ? fmtCurrency(p.price) : 'Liên hệ');
    _setText('pdm-desc',    p.desc || 'Không có mô tả.');
    _setText('pdm-created', fmtDate(p.createdAt));
    _setText('pdm-updated', fmtDate(p.updatedAt));
    _setText('pdm-imgcount', `${lightboxImages.length} ảnh`);

    // Edit shortcut
    const editBtn = document.getElementById('pdm-edit-btn');
    if (editBtn) editBtn.onclick = () => { window.closeModal('project-detail-modal'); window.editProject(id); };

    _updateLightboxImg();

    // Thumbnails strip
    const strip = document.getElementById('pdm-thumbs');
    if (strip) {
        strip.innerHTML = lightboxImages.map((url, i) =>
            `<button onclick="window.prjLbGo(${i})" data-lbthumb="${i}"
                class="prj-thumb shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${i===0?'border-primary':'border-transparent opacity-50 hover:opacity-100'} bg-gray-100 dark:bg-slate-800">
                <img src="${url}" class="w-full h-full object-cover" loading="lazy">
            </button>`
        ).join('');
    }

    // Show/hide nav elements
    const multi = lightboxImages.length > 1;
    ['pdm-nav-prev','pdm-nav-next','pdm-counter','pdm-thumbs-wrap'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !multi);
    });

    _openModal('project-detail-modal');
};

function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function _updateLightboxImg() {
    const img    = document.getElementById('pdm-main-img');
    const noImg  = document.getElementById('pdm-no-img');
    const cnt    = document.getElementById('pdm-counter');

    if (!lightboxImages.length) {
        img?.classList.add('hidden');
        noImg?.classList.remove('hidden');
        return;
    }
    noImg?.classList.add('hidden');
    if (img) {
        img.style.opacity = '0';
        img.src = lightboxImages[lightboxIdx];
        img.onload = () => { img.style.opacity = '1'; };
        img.onerror = () => { img.alt = 'Không tải được ảnh'; img.style.opacity = '1'; };
        img.classList.remove('hidden');
    }
    if (cnt) cnt.textContent = `${lightboxIdx + 1} / ${lightboxImages.length}`;

    // Sync thumbnail active state
    document.querySelectorAll('[data-lbthumb]').forEach(el => {
        const i = parseInt(el.dataset.lbthumb);
        el.classList.toggle('border-primary', i === lightboxIdx);
        el.classList.toggle('opacity-50', i !== lightboxIdx);
        el.classList.toggle('border-transparent', i !== lightboxIdx);
    });
}

window.prjLbGo = (idx) => {
    if (!lightboxImages.length) return;
    lightboxIdx = ((idx % lightboxImages.length) + lightboxImages.length) % lightboxImages.length;
    _updateLightboxImg();
};

function _bindLightboxKeys() {
    document.addEventListener('keydown', e => {
        const m = document.getElementById('project-detail-modal');
        if (!m || m.classList.contains('hidden')) return;
        if (e.key === 'ArrowLeft')  window.prjLbGo(lightboxIdx - 1);
        if (e.key === 'ArrowRight') window.prjLbGo(lightboxIdx + 1);
        if (e.key === 'Escape')     window.closeModal('project-detail-modal');
    });
}

// ═══════════════════════════════════════════════════════════
//  MODAL THÊM / SỬA
// ═══════════════════════════════════════════════════════════
window.openAddProject = () => {
    editingId = null; pendingImages = []; imagesToDelete = [];
    _resetForm();
    _setText('project-modal-title', 'Thêm Dự Án Mới');
    _openModal('project-modal');
};

window.editProject = (id) => {
    const p = projectsData.find(x => x.id === id);
    if (!p) return;
    editingId = id; imagesToDelete = [];

    document.getElementById('prj-form-name').value   = p.name   || '';
    document.getElementById('prj-form-sector').value = p.sector || '';
    document.getElementById('prj-form-price').value  = p.price  || '';
    document.getElementById('prj-form-desc').value   = p.desc   || '';

    const imgs = Array.isArray(p.images) ? p.images : [];
    pendingImages = imgs.map(url => ({ isExisting: true, storageUrl: url, previewUrl: url }));
    _renderPreviews();
    _setText('project-modal-title', 'Sửa Dự Án');
    _openModal('project-modal');
};

function _resetForm() {
    ['prj-form-name','prj-form-sector','prj-form-price','prj-form-desc']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    _renderPreviews();
}

// ═══════════════════════════════════════════════════════════
//  IMAGE DROPZONE
// ═══════════════════════════════════════════════════════════
function _bindDropzone() {
    const zone  = document.getElementById('prj-dropzone');
    const input = document.getElementById('prj-img-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('border-primary','bg-primary/5'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('border-primary','bg-primary/5'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('border-primary','bg-primary/5');
        _addFiles([...e.dataTransfer.files]);
    });
    input.addEventListener('change', () => { _addFiles([...input.files]); input.value = ''; });
}

function _addFiles(files) {
    files.filter(f => f.type.startsWith('image/')).forEach(file => {
        if (file.size > 5 * 1024 * 1024) { toast(`"${file.name}" vượt 5MB`, 'error'); return; }
        const r = new FileReader();
        r.onload = e => { pendingImages.push({ file, previewUrl: e.target.result, isExisting: false }); _renderPreviews(); };
        r.readAsDataURL(file);
    });
}

function _renderPreviews() {
    const wrap = document.getElementById('prj-img-previews');
    if (!wrap) return;
    if (!pendingImages.length) {
        wrap.innerHTML = '<p class="text-xs text-gray-400 text-center py-3 col-span-full">Chưa có ảnh nào — kéo thả hoặc nhấn chọn</p>';
        return;
    }
    wrap.innerHTML = pendingImages.map((img, i) => `
        <div class="relative group/img rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 aspect-square bg-gray-50 dark:bg-slate-800">
            <img src="${img.previewUrl}" class="w-full h-full object-contain" loading="lazy">
            <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/50 transition-all flex items-center justify-center">
                <button type="button" onclick="window.prjRemoveImg(${i})"
                    class="opacity-0 group-hover/img:opacity-100 w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all active:scale-90">
                    <span class="material-symbols-outlined text-[15px]">delete</span>
                </button>
            </div>
            ${i === 0 ? '<span class="absolute top-1.5 left-1.5 bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">ĐẠI DIỆN</span>' : ''}
        </div>`
    ).join('');
}

window.prjRemoveImg = (idx) => {
    const img = pendingImages[idx];
    if (img?.isExisting && img.storageUrl?.startsWith('https://')) imagesToDelete.push(img.storageUrl);
    pendingImages.splice(idx, 1);
    _renderPreviews();
};

// ═══════════════════════════════════════════════════════════
//  LƯU DỰ ÁN (CREATE / UPDATE)
// ═══════════════════════════════════════════════════════════
function _bindForm() {
    document.getElementById('project-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        await _saveProject();
    });
}

async function _saveProject() {
    const name   = document.getElementById('prj-form-name').value.trim();
    const sector = document.getElementById('prj-form-sector').value.trim();
    const price  = parseFloat(document.getElementById('prj-form-price').value) || 0;
    const desc   = document.getElementById('prj-form-desc').value.trim();

    if (!name) { toast('Vui lòng nhập tên dự án!', 'error'); return; }

    const btn = document.getElementById('prj-save-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin mr-1">refresh</span> Đang lưu...`;

    try {
        // Upload ảnh mới lên Firebase Storage
        const urls = [];
        for (const img of pendingImages) {
            if (img.isExisting) {
                urls.push(img.storageUrl);
            } else {
                const path = `projects/${APP_ID}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const sRef = storageRef(_storage, path);
                await uploadString(sRef, img.previewUrl, 'data_url');
                urls.push(await getDownloadURL(sRef));
            }
        }

        // Xóa ảnh cũ bị remove khỏi Storage
        for (const url of imagesToDelete) {
            try { await deleteObject(storageRef(_storage, url)); } catch { /* ignore */ }
        }

        const payload = { name, sector, price, desc, images: urls, updatedAt: serverTimestamp() };

        if (editingId) {
            await updateDoc(projectsRef(editingId), payload);
            toast('Đã cập nhật dự án!');
        } else {
            payload.createdAt = serverTimestamp();
            await addDoc(projectsCol(), payload);
            toast('Đã thêm dự án mới!');
        }

        window.closeModal('project-modal');
    } catch (err) {
        console.error(err);
        toast('Lỗi lưu: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-sm mr-1">save</span> Lưu dự án`;
    }
}

// ═══════════════════════════════════════════════════════════
//  XOÁ DỰ ÁN
// ═══════════════════════════════════════════════════════════
window.deleteProject = async (id, name) => {
    if (!confirm(`Xác nhận xoá dự án:\n"${name}"?\n\nHành động này không thể hoàn tác.`)) return;
    try {
        const p = projectsData.find(x => x.id === id);
        // Xoá ảnh trên Storage
        for (const url of (p?.images || [])) {
            if (url?.startsWith('https://')) try { await deleteObject(storageRef(_storage, url)); } catch {}
        }
        await deleteDoc(projectsRef(id));
        toast('Đã xoá dự án!');
    } catch (err) { toast('Lỗi xoá: ' + err.message, 'error'); }
};

// ═══════════════════════════════════════════════════════════
//  FILTER EVENTS
// ═══════════════════════════════════════════════════════════
function _bindFilters() {
    ['prj-search','prj-filter-sector','prj-filter-min','prj-filter-max','prj-sort'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const handler = () => { currentPage = 1; _applyFilters(); };
        el.addEventListener('input',  handler);
        el.addEventListener('change', handler);
    });
}

window.resetProjectFilters = () => {
    ['prj-search','prj-filter-min','prj-filter-max'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const sel = document.getElementById('prj-filter-sector'); if (sel) sel.value = '';
    const srt = document.getElementById('prj-sort');          if (srt) srt.value = 'newest';
    currentPage = 1;
    _applyFilters();
    toast('Đã đặt lại bộ lọc', 'info');
};

// ═══════════════════════════════════════════════════════════
//  MODAL HELPERS (dùng chung pattern với app.js)
// ═══════════════════════════════════════════════════════════
function _openModal(id) {
    const modal   = document.getElementById(id);
    const content = document.getElementById(`${id}-content`);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content?.classList.remove('scale-95');
    }, 10);
}