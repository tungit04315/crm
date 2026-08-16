/* ================================================================
   LEADS & CUSTOMERS IMPORT/EXPORT MODULE — leads-customers-io.js v1.0
   CRM NeoWave

   TÍCH HỢP — 2 dòng thêm vào index.html, SAU app.js:
     <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
     <script type="module" src="leads-customers-io.js"></script>

   TÍNH NĂNG:
   ─────────────────────────────────────────────────────────────
   1. Xuất Excel (.xlsx) danh sách Leads / Khách hàng đang hiển thị
      (tôn trọng ô tìm kiếm + bộ lọc hiện có trên mỗi trang)
   2. Tải file mẫu Excel để nhập đúng cấu trúc cột
   3. Nhập Excel: đọc file → validate từng dòng → xem trước
      (mới / trùng SĐT / lỗi) → xác nhận từng dòng trùng trước khi ghi
   4. Chọn nhiều Lead (checkbox) → "Chuyển hàng loạt sang KH"

   NGUYÊN TẮC AN TOÀN:
   - KHÔNG sửa app.js. Chỉ wrap (override) window.renderLeads /
     window.renderCustomers theo đúng pattern đã dùng trong
     services-upgrade.js (const _orig = window.fn; window.fn = ...).
   - KHÔNG đổi cấu trúc field Firestore hiện có (name, phone, email,
     source, type, note, createdAt cho leads; + address, bankOwner,
     bankAccount, bankName, bankBranch cho customers).
   - Dùng writeBatch (chunk 450 ops/lần) để không vượt giới hạn
     Firestore (500 ops/batch).
   - Tự khởi tạo Firestore refs riêng qua getApp() (không init lại
     Firebase App), tự subscribe leads/customers riêng — không phụ
     thuộc biến nội bộ của app.js.
   ================================================================ */

import { getApp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
    writeBatch, onSnapshot, query
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Firebase refs (dùng chung app đã init trong app.js) ─────────
const _db = getFirestore(getApp());
const _appId = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const col = (name) => collection(_db, 'artifacts', _appId, 'public', 'data', name);

const $ = (id) => document.getElementById(id);
const toast = (msg, type = 'success') => window.showToast?.(msg, type);

// ── Cache dữ liệu riêng để đối chiếu trùng SĐT khi import ────────
let _leadsCache = [];
let _customersCache = [];
onSnapshot(query(col('leads')), snap => {
    _leadsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
});
onSnapshot(query(col('customers')), snap => {
    _customersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

// ── Helpers chung ────────────────────────────────────────────────
const normPhone = (p) => (p || '').toString().replace(/\D/g, '');
const stripVN = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').trim();

function todayStr() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

// Map các biến thể tiêu đề cột (không dấu, lowercase) → field nội bộ
const LEAD_HEADER_MAP = {
    'ten': 'name', 'ten khach hang': 'name', 'khach hang': 'name', 'name': 'name',
    'sdt': 'phone', 'so dien thoai': 'phone', 'dien thoai': 'phone', 'phone': 'phone',
    'email': 'email',
    'nguon': 'source', 'source': 'source',
    'loai': 'type', 'type': 'type',
    'ghi chu': 'note', 'note': 'note',
};
const CUSTOMER_HEADER_MAP = {
    'ten': 'name', 'ten khach hang': 'name', 'khach hang': 'name', 'name': 'name',
    'sdt': 'phone', 'so dien thoai': 'phone', 'dien thoai': 'phone', 'phone': 'phone',
    'email': 'email',
    'dia chi': 'address', 'address': 'address',
    'chu tk': 'bankOwner', 'chu tai khoan': 'bankOwner', 'bank owner': 'bankOwner',
    'so tk': 'bankAccount', 'so tai khoan': 'bankAccount', 'bank account': 'bankAccount',
    'ngan hang': 'bankName', 'bank name': 'bankName',
    'chi nhanh': 'bankBranch', 'bank branch': 'bankBranch',
    'nguon': 'source', 'source': 'source',
    'ghi chu': 'note', 'note': 'note',
};

const LEAD_EXPORT_COLS = [
    ['Tên khách hàng', 'name'], ['Số điện thoại', 'phone'], ['Email', 'email'],
    ['Loại', 'type'], ['Nguồn', 'source'], ['Ghi chú', 'note'],
];
const CUSTOMER_EXPORT_COLS = [
    ['Tên khách hàng', 'name'], ['Số điện thoại', 'phone'], ['Email', 'email'],
    ['Địa chỉ', 'address'], ['Chủ tài khoản', 'bankOwner'], ['Số tài khoản', 'bankAccount'],
    ['Ngân hàng', 'bankName'], ['Chi nhánh', 'bankBranch'], ['Nguồn', 'source'], ['Ghi chú', 'note'],
];

// ================================================================
//  EXPORT EXCEL
// ================================================================
function getVisibleLeads() {
    const txt = ($('search-lead')?.value || '').toLowerCase();
    const dt = $('filter-lead-date')?.value || '';
    const tp = $('filter-lead-type')?.value || '';
    return _leadsCache.filter(l => {
        const matchTxt = (l.name || '').toLowerCase().includes(txt) || (l.phone || '').includes(txt);
        const matchDt = !dt || (l.createdAt?.toDate ? l.createdAt.toDate() : new Date(l.createdAt))
            .toISOString().slice(0, 10) === dt;
        const matchTp = !tp || l.type === tp;
        return matchTxt && matchDt && matchTp;
    });
}
function getVisibleCustomers() {
    const txt = ($('search-customer')?.value || '').toLowerCase();
    const dt = $('filter-customer-date')?.value || '';
    return _customersCache.filter(c => {
        const matchTxt = (c.name || '').toLowerCase().includes(txt) || (c.phone || '').includes(txt);
        const matchDt = !dt || (c.createdAt?.toDate ? c.createdAt.toDate() : new Date(c.createdAt))
            .toISOString().slice(0, 10) === dt;
        return matchTxt && matchDt;
    });
}

function exportToExcel(rows, cols, filenamePrefix, sheetName) {
    if (!window.XLSX) { toast('Thư viện Excel chưa sẵn sàng, thử lại sau giây lát', 'error'); return; }
    if (!rows.length) { toast('Không có dữ liệu để xuất', 'error'); return; }
    const data = rows.map(r => {
        const obj = {};
        cols.forEach(([label, field]) => { obj[label] = r[field] ?? ''; });
        return obj;
    });
    const ws = window.XLSX.utils.json_to_sheet(data);
    ws['!cols'] = cols.map(() => ({ wch: 20 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    window.XLSX.writeFile(wb, `${filenamePrefix}_${todayStr()}.xlsx`);
    toast(`Đã xuất ${rows.length} dòng ra Excel`);
}

window.exportLeadsToExcel = () => exportToExcel(getVisibleLeads(), LEAD_EXPORT_COLS, 'Leads_NeoWaveCRM', 'Leads');
window.exportCustomersToExcel = () => exportToExcel(getVisibleCustomers(), CUSTOMER_EXPORT_COLS, 'KhachHang_NeoWaveCRM', 'KhachHang');

function downloadTemplate(cols, sample, filenamePrefix, sheetName) {
    if (!window.XLSX) { toast('Thư viện Excel chưa sẵn sàng, thử lại sau giây lát', 'error'); return; }
    const ws = window.XLSX.utils.json_to_sheet([sample]);
    ws['!cols'] = cols.map(() => ({ wch: 20 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    window.XLSX.writeFile(wb, `Mau_${filenamePrefix}.xlsx`);
}
window.downloadLeadTemplate = () => downloadTemplate(LEAD_EXPORT_COLS, {
    'Tên khách hàng': 'Nguyễn Văn A', 'Số điện thoại': '0901234567', 'Email': 'a@example.com',
    'Loại': 'Thường', 'Nguồn': 'Facebook', 'Ghi chú': ''
}, 'Import_Leads', 'Leads');
window.downloadCustomerTemplate = () => downloadTemplate(CUSTOMER_EXPORT_COLS, {
    'Tên khách hàng': 'Nguyễn Văn A', 'Số điện thoại': '0901234567', 'Email': 'a@example.com',
    'Địa chỉ': '', 'Chủ tài khoản': '', 'Số tài khoản': '', 'Ngân hàng': '', 'Chi nhánh': '',
    'Nguồn': 'Facebook', 'Ghi chú': ''
}, 'Import_KhachHang', 'KhachHang');

// ================================================================
//  IMPORT EXCEL — đọc file, validate, preview, ghi Firestore
// ================================================================
let _importCtx = null; // { type: 'leads'|'customers', rows: [...] }

function readWorkbook(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = window.XLSX.read(e.target.result, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                resolve(window.XLSX.utils.sheet_to_json(ws, { defval: '' }));
            } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function mapRow(raw, headerMap) {
    const out = {};
    Object.keys(raw).forEach(h => {
        const key = headerMap[stripVN(h)];
        if (key) out[key] = (raw[h] ?? '').toString().trim();
    });
    return out;
}

async function handleImportFile(type, file) {
    if (!window.XLSX) { toast('Thư viện Excel chưa sẵn sàng, thử lại sau giây lát', 'error'); return; }
    let rawRows;
    try { rawRows = await readWorkbook(file); }
    catch (err) { toast('Không đọc được file Excel: ' + err.message, 'error'); return; }

    const headerMap = type === 'leads' ? LEAD_HEADER_MAP : CUSTOMER_HEADER_MAP;
    const cache = type === 'leads' ? _leadsCache : _customersCache;

    const rows = rawRows.map((raw, idx) => {
        const m = mapRow(raw, headerMap);
        const rowNo = idx + 2; // dòng 1 là header
        if (!m.name && !m.phone) return null; // dòng trống, bỏ qua âm thầm
        let status = 'new', reason = '';
        if (!m.name || !m.phone) { status = 'error'; reason = !m.name ? 'Thiếu tên' : 'Thiếu SĐT'; }
        else {
            const dup = cache.find(x => normPhone(x.phone) === normPhone(m.phone) && normPhone(m.phone));
            if (dup) { status = 'dup'; m._existingId = dup.id; }
        }
        return { rowNo, data: m, status, reason, action: status === 'dup' ? 'skip' : 'add' };
    }).filter(Boolean);

    if (!rows.length) { toast('File không có dòng dữ liệu hợp lệ', 'error'); return; }
    _importCtx = { type, rows };
    renderImportPreview();
    openIEModal('ie-import-modal');
}

function renderImportPreview() {
    const { type, rows } = _importCtx;
    const total = rows.length;
    const errCount = rows.filter(r => r.status === 'error').length;
    const dupCount = rows.filter(r => r.status === 'dup').length;
    const newCount = rows.filter(r => r.status === 'new').length;

    $('ie-import-title').textContent = type === 'leads'
        ? 'Xem trước dữ liệu nhập — Leads' : 'Xem trước dữ liệu nhập — Khách hàng';
    $('ie-import-summary').innerHTML =
        `Tổng <b>${total}</b> dòng — <span class="text-green-600 font-semibold">${newCount} mới</span> · ` +
        `<span class="text-amber-600 font-semibold">${dupCount} trùng SĐT</span> · ` +
        `<span class="text-red-500 font-semibold">${errCount} lỗi</span>`;

    $('ie-import-rows').innerHTML = rows.map((r, i) => {
        let badge, actionCell;
        if (r.status === 'error') {
            badge = `<span class="ie-badge ie-badge-err">Lỗi</span>`;
            actionCell = `<span class="text-xs text-red-500">${r.reason}</span>`;
        } else if (r.status === 'dup') {
            badge = `<span class="ie-badge ie-badge-dup">Trùng SĐT</span>`;
            actionCell = `<select class="ie-action-select" data-idx="${i}">
                <option value="skip" selected>Bỏ qua</option>
                <option value="overwrite">Ghi đè cập nhật</option>
                <option value="add">Vẫn thêm mới</option>
            </select>`;
        } else {
            badge = `<span class="ie-badge ie-badge-new">Mới</span>`;
            actionCell = `<span class="text-xs text-gray-400">Sẽ thêm mới</span>`;
        }
        return `<tr class="border-b border-gray-100 dark:border-slate-800">
            <td class="py-1.5 px-2 text-xs text-gray-400">${r.rowNo}</td>
            <td class="py-1.5 px-2 text-xs font-medium">${r.data.name || '<span class=\'text-gray-300\'>—</span>'}</td>
            <td class="py-1.5 px-2 text-xs font-mono">${r.data.phone || '<span class=\'text-gray-300\'>—</span>'}</td>
            <td class="py-1.5 px-2">${badge}</td>
            <td class="py-1.5 px-2">${actionCell}</td>
        </tr>`;
    }).join('');

    $('ie-import-confirm-btn').textContent = `Xác nhận nhập (${newCount + dupCount} dòng hợp lệ)`;
    $('ie-import-confirm-btn').disabled = (newCount + dupCount) === 0;

    // Gắn sự kiện đổi lựa chọn cho dòng trùng
    $('ie-import-rows').querySelectorAll('.ie-action-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            _importCtx.rows[+e.target.dataset.idx].action = e.target.value;
        });
    });
}

async function confirmImport() {
    if (!_importCtx) return;
    const { type, rows } = _importCtx;
    const targetCol = col(type);
    const toWrite = rows.filter(r => r.status !== 'error' && r.action !== 'skip');
    if (!toWrite.length) { toast('Không có dòng nào để ghi (tất cả bị bỏ qua)', 'error'); closeIEModal('ie-import-modal'); return; }

    const btn = $('ie-import-confirm-btn');
    btn.disabled = true; btn.textContent = 'Đang nhập...';

    let added = 0, updated = 0;
    try {
        for (let i = 0; i < toWrite.length; i += 450) {
            const chunk = toWrite.slice(i, i + 450);
            const batch = writeBatch(_db);
            chunk.forEach(r => {
                const payload = { ...r.data };
                delete payload._existingId;
                if (r.action === 'overwrite' && r.data._existingId) {
                    batch.update(doc(targetCol, r.data._existingId), payload);
                    updated++;
                } else {
                    const ref = doc(targetCol);
                    batch.set(ref, { ...payload, createdAt: new Date() });
                    added++;
                }
            });
            await batch.commit();
        }
        toast(`Nhập xong: ${added} dòng mới, ${updated} dòng cập nhật`);
        closeIEModal('ie-import-modal');
        _importCtx = null;
    } catch (err) {
        toast('Lỗi khi ghi dữ liệu: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ================================================================
//  BULK CONVERT LEAD → CUSTOMER (chọn nhiều dòng)
// ================================================================
const _selectedLeadIds = new Set();

function extractIdFromOnclick(el, fnName) {
    const btn = el.querySelector(`[onclick^="${fnName}("]`);
    if (!btn) return null;
    const m = btn.getAttribute('onclick').match(/^[a-zA-Z]+\('([^']+)'\)/);
    return m ? m[1] : null;
}

function decorateLeadsTable() {
    // Header: chèn cột checkbox 1 lần duy nhất
    const theadRow = document.querySelector('#view-leads thead tr');
    if (theadRow && !theadRow.querySelector('.ie-th-check')) {
        const th = document.createElement('th');
        th.className = 'pb-3 font-semibold ie-th-check w-8';
        th.innerHTML = `<input type="checkbox" id="ie-select-all-leads" class="ie-checkbox">`;
        theadRow.insertBefore(th, theadRow.firstChild);
        $('ie-select-all-leads').addEventListener('change', (e) => {
            document.querySelectorAll('#leads-list .ie-row-check').forEach(cb => {
                cb.checked = e.target.checked;
                if (e.target.checked) _selectedLeadIds.add(cb.dataset.id); else _selectedLeadIds.delete(cb.dataset.id);
            });
            updateBulkConvertBtn();
        });
    }
    // Body rows: chèn ô checkbox đầu mỗi hàng đang hiển thị
    document.querySelectorAll('#leads-list tr').forEach(tr => {
        if (tr.querySelector('.ie-row-check')) return;
        const id = extractIdFromOnclick(tr, 'deleteLead');
        if (!id) return; // dòng "chưa có lead phù hợp"
        const td = document.createElement('td');
        td.className = 'py-3 pl-2';
        td.innerHTML = `<input type="checkbox" class="ie-checkbox ie-row-check" data-id="${id}" ${_selectedLeadIds.has(id) ? 'checked' : ''}>`;
        tr.insertBefore(td, tr.firstChild);
        td.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) _selectedLeadIds.add(id); else _selectedLeadIds.delete(id);
            updateBulkConvertBtn();
        });
    });
    // Mobile cards: chèn checkbox góc trên
    document.querySelectorAll('#leads-card-list .mobile-card-item').forEach(card => {
        if (card.querySelector('.ie-row-check')) return;
        const id = extractIdFromOnclick(card, 'deleteLead');
        if (!id) return;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'ie-checkbox ie-row-check absolute top-3 right-3';
        box.dataset.id = id;
        box.checked = _selectedLeadIds.has(id);
        card.style.position = 'relative';
        card.appendChild(box);
        box.addEventListener('change', (e) => {
            if (e.target.checked) _selectedLeadIds.add(id); else _selectedLeadIds.delete(id);
            updateBulkConvertBtn();
        });
    });
}

function updateBulkConvertBtn() {
    const btn = $('ie-bulk-convert-btn');
    if (!btn) return;
    if (_selectedLeadIds.size > 0) {
        btn.classList.remove('hidden');
        btn.textContent = `person_add Chuyển hàng loạt (${_selectedLeadIds.size})`.replace('person_add ', '');
        btn.querySelector('.ie-bulk-count').textContent = _selectedLeadIds.size;
    } else {
        btn.classList.add('hidden');
    }
}

function openBulkConvertModal() {
    const selected = _leadsCache.filter(l => _selectedLeadIds.has(l.id));
    if (!selected.length) return;
    $('ie-bulk-list').innerHTML = selected.map(l =>
        `<div class="flex justify-between text-xs py-1.5 border-b border-gray-100 dark:border-slate-800">
            <span class="font-medium">${l.name}</span><span class="font-mono text-gray-400">${l.phone}</span>
        </div>`).join('');
    $('ie-bulk-confirm-btn').textContent = `Xác nhận chuyển (${selected.length} lead)`;
    openIEModal('ie-bulk-convert-modal');
}

async function confirmBulkConvert() {
    const selected = _leadsCache.filter(l => _selectedLeadIds.has(l.id));
    if (!selected.length) return;
    const btn = $('ie-bulk-confirm-btn');
    btn.disabled = true; btn.textContent = 'Đang chuyển...';
    try {
        for (let i = 0; i < selected.length; i += 200) {
            const chunk = selected.slice(i, i + 200);
            const batch = writeBatch(_db);
            chunk.forEach(l => {
                const ref = doc(col('customers'));
                batch.set(ref, {
                    name: l.name || '', phone: l.phone || '', email: l.email || '',
                    source: l.source || '', note: l.note || '', createdAt: new Date()
                });
                batch.delete(doc(col('leads'), l.id));
            });
            await batch.commit();
        }
        toast(`Đã chuyển ${selected.length} Lead sang Khách hàng`);
        _selectedLeadIds.clear();
        updateBulkConvertBtn();
        closeIEModal('ie-bulk-convert-modal');
    } catch (err) {
        toast('Lỗi khi chuyển: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ================================================================
//  UI INJECTION — toolbar buttons, file inputs, modals, CSS
// ================================================================
function openIEModal(id) {
    const m = $(id); if (!m) return;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.remove('opacity-0'), 10);
}
function closeIEModal(id) {
    const m = $(id); if (!m) return;
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 150);
}
window.closeIEModal = closeIEModal;

function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
    .ie-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:8px 12px;
        border-radius:8px; font-size:13px; font-weight:600; border:1px solid #e5e7eb; background:#fff; color:#374151; }
    .dark .ie-btn { background:#1e293b; border-color:#334155; color:#cbd5e1; }
    .ie-btn:hover { background:#f9fafb; } .dark .ie-btn:hover { background:#0f172a; }
    .ie-btn .material-symbols-outlined { font-size:16px; }
    .ie-bulk-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:8px;
        font-size:13px; font-weight:700; background:#16a34a; color:#fff; }
    .ie-checkbox { width:16px; height:16px; cursor:pointer; accent-color:#f97316; }
    .ie-badge { font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 8px; border-radius:9999px; }
    .ie-badge-new { background:#dcfce7; color:#16a34a; } .dark .ie-badge-new { background:#14532d55; color:#4ade80; }
    .ie-badge-dup { background:#fef3c7; color:#b45309; } .dark .ie-badge-dup { background:#78350f55; color:#fbbf24; }
    .ie-badge-err { background:#fee2e2; color:#dc2626; } .dark .ie-badge-err { background:#7f1d1d55; color:#f87171; }
    .ie-action-select { font-size:11px; border:1px solid #e5e7eb; border-radius:6px; padding:3px 6px; background:#fff; }
    .dark .ie-action-select { background:#1e293b; border-color:#334155; color:#e2e8f0; }
    .ie-modal { position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.5); backdrop-filter:blur(2px); padding:16px; transition:opacity .15s; }
    .ie-modal.hidden { display:none !important; pointer-events:none; }
    .ie-modal-box { background:#fff; width:100%; max-width:680px; max-height:85vh; border-radius:16px;
        display:flex; flex-direction:column; overflow:hidden; box-shadow:0 25px 50px -12px rgba(0,0,0,.35); }
    .dark .ie-modal-box { background:#0f172a; border:1px solid #1e293b; }
    `;
    document.head.appendChild(s);
}

function injectModals() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="ie-import-modal" class="ie-modal hidden opacity-0">
        <div class="ie-modal-box">
            <div class="p-4 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <h3 id="ie-import-title" class="font-bold text-base"></h3>
                <button onclick="closeIEModal('ie-import-modal')" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-full"><span class="material-symbols-outlined text-lg">close</span></button>
            </div>
            <div id="ie-import-summary" class="px-4 py-2 text-xs text-gray-500 shrink-0"></div>
            <div class="flex-1 overflow-auto px-2">
                <table class="w-full text-left border-collapse">
                    <thead><tr class="text-[10px] text-gray-400 uppercase sticky top-0 bg-white dark:bg-slate-900">
                        <th class="py-1.5 px-2">Dòng</th><th class="py-1.5 px-2">Tên</th><th class="py-1.5 px-2">SĐT</th>
                        <th class="py-1.5 px-2">Trạng thái</th><th class="py-1.5 px-2">Hành động</th>
                    </tr></thead>
                    <tbody id="ie-import-rows"></tbody>
                </table>
            </div>
            <div class="p-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-2 shrink-0">
                <button onclick="closeIEModal('ie-import-modal')" class="ie-btn">Hủy</button>
                <button id="ie-import-confirm-btn" class="ie-bulk-btn"></button>
            </div>
        </div>
    </div>

    <div id="ie-bulk-convert-modal" class="ie-modal hidden opacity-0">
        <div class="ie-modal-box" style="max-width:480px;">
            <div class="p-4 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <h3 class="font-bold text-base">Chuyển hàng loạt Lead → Khách hàng</h3>
                <button onclick="closeIEModal('ie-bulk-convert-modal')" class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-full"><span class="material-symbols-outlined text-lg">close</span></button>
            </div>
            <div class="px-4 py-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 shrink-0">
                Chỉ chuyển thông tin cơ bản (Tên, SĐT, Email, Nguồn, Ghi chú). Bổ sung ngân hàng/địa chỉ sau bằng nút Sửa khách hàng.
            </div>
            <div id="ie-bulk-list" class="flex-1 overflow-auto px-4 py-2"></div>
            <div class="p-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-2 shrink-0">
                <button onclick="closeIEModal('ie-bulk-convert-modal')" class="ie-btn">Hủy</button>
                <button id="ie-bulk-confirm-btn" class="ie-bulk-btn"></button>
            </div>
        </div>
    </div>

    <input type="file" id="ie-leads-file-input" accept=".xlsx,.xls" class="hidden">
    <input type="file" id="ie-customers-file-input" accept=".xlsx,.xls" class="hidden">
    `;
    document.body.appendChild(wrap);

    $('ie-import-confirm-btn').addEventListener('click', confirmImport);
    $('ie-bulk-confirm-btn').addEventListener('click', confirmBulkConvert);
    $('ie-leads-file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportFile('leads', e.target.files[0]);
        e.target.value = '';
    });
    $('ie-customers-file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportFile('customers', e.target.files[0]);
        e.target.value = '';
    });
}

function injectToolbarButtons() {
    // ── Leads toolbar ──
    const leadAddBtn = document.querySelector('#view-leads button[onclick*="lead-modal"]');
    if (leadAddBtn && !$('ie-leads-toolbar')) {
        const box = document.createElement('div');
        box.id = 'ie-leads-toolbar';
        box.className = 'flex items-center gap-1.5 flex-wrap';
        box.innerHTML = `
            <button id="ie-bulk-convert-btn" class="ie-bulk-btn hidden">
                <span class="material-symbols-outlined text-base">person_add</span>
                Chuyển hàng loạt (<span class="ie-bulk-count">0</span>)
            </button>
            <button class="ie-btn" onclick="downloadLeadTemplate()" title="Tải file mẫu">
                <span class="material-symbols-outlined">download</span>
            </button>
            <button class="ie-btn" onclick="document.getElementById('ie-leads-file-input').click()">
                <span class="material-symbols-outlined">upload_file</span> Nhập Excel
            </button>
            <button class="ie-btn" onclick="exportLeadsToExcel()">
                <span class="material-symbols-outlined">file_download</span> Xuất Excel
            </button>`;
        leadAddBtn.parentNode.insertBefore(box, leadAddBtn);
        $('ie-bulk-convert-btn').addEventListener('click', openBulkConvertModal);
    }

    // ── Customers toolbar ──
    const cusAddBtn = document.querySelector('#view-customers button[onclick*="customer-modal"]');
    if (cusAddBtn && !$('ie-customers-toolbar')) {
        const box = document.createElement('div');
        box.id = 'ie-customers-toolbar';
        box.className = 'flex items-center gap-1.5 flex-wrap';
        box.innerHTML = `
            <button class="ie-btn" onclick="downloadCustomerTemplate()" title="Tải file mẫu">
                <span class="material-symbols-outlined">download</span>
            </button>
            <button class="ie-btn" onclick="document.getElementById('ie-customers-file-input').click()">
                <span class="material-symbols-outlined">upload_file</span> Nhập Excel
            </button>
            <button class="ie-btn" onclick="exportCustomersToExcel()">
                <span class="material-symbols-outlined">file_download</span> Xuất Excel
            </button>`;
        cusAddBtn.parentNode.insertBefore(box, cusAddBtn);
    }
}

// ── Wrap renderLeads để chèn checkbox mỗi khi bảng được vẽ lại ───
function overrideRenderLeads() {
    const _orig = window.renderLeads;
    if (!_orig || _orig.__ieWrapped) return;
    window.renderLeads = function () {
        _orig.apply(this, arguments);
        requestAnimationFrame(decorateLeadsTable);
    };
    window.renderLeads.__ieWrapped = true;
}

// ── Khởi tạo ──────────────────────────────────────────────────
function init() {
    injectStyles();
    injectModals();

    const tryAttach = () => {
        injectToolbarButtons();
        overrideRenderLeads();
        // Nếu renderLeads đã từng chạy trước khi ta wrap kịp, decorate ngay lần đầu
        if (document.getElementById('leads-list')) requestAnimationFrame(decorateLeadsTable);
    };

    // app.js render theo dữ liệu bất đồng bộ (đăng nhập → onSnapshot) nên
    // thử gắn nhiều lần trong vài giây đầu để chắc chắn nút/toolbar đã có trong DOM
    let tries = 0;
    const timer = setInterval(() => {
        tryAttach();
        tries++;
        if (tries > 20) clearInterval(timer);
    }, 500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
