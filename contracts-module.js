/* ================================================================
   CONTRACTS MODULE — Quản lý Vòng đời Hợp đồng (contracts)
   ----------------------------------------------------------------
   Phạm vi: P1 (dữ liệu + CRUD) · P2 (cảnh báo sắp hết hạn) ·
            P4 (nhật ký CSKH) · P5 (báo cáo Renew/Doanh thu) ·
            P6 (chuỗi liên kết gia hạn)
   KHÔNG bao gồm P3 (Apps Script server-side) — cần Service Account,
   triển khai riêng ở Google Apps Script, ngoài phạm vi file này.

   File này tự chứa (self-contained), theo đúng pattern các file mở
   rộng khác trong dự án (quote-upgrade.js, cb-module.js...): tự
   import Firebase, tự chèn UI của mình vào DOM, không sửa app.js
   (ngoại trừ 2 dòng đăng ký view/title đã thêm sẵn).
   ================================================================ */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBqdX8HpUSP_atbFPQEDur_lQsjMI3TPXo",
    authDomain: "crm-neo-wave.firebaseapp.com",
    databaseURL: "https://crm-neo-wave-default-rtdb.firebaseio.com",
    projectId: "crm-neo-wave",
    storageBucket: "crm-neo-wave.firebasestorage.app",
    messagingSenderId: "221144536693",
    appId: "1:221144536693:web:09a81e9abc09afd81b4a3c"
};

const app_id = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const getCollectionPath = (name) => collection(db, 'artifacts', app_id, 'public', 'data', name);

/* ---------------- STATE ---------------- */
let contractsData = [];
let servicesCache = null;           // fetch 1 lần khi cần (không cần realtime cho datalist)
let CPG = 1;                        // trang hiện tại của bảng contracts
const CONTRACTS_PER_PAGE = 8;
let contractFilters = { status: '', careOwner: '', q: '' };
let editingContractId = null;       // đang sửa (null = đang tạo mới)
let pendingRenewalOf = null;        // nếu modal đang mở để tạo hợp đồng GIA HẠN từ 1 hợp đồng cũ
let currentDetailId = null;         // hợp đồng đang mở ở drawer chi tiết
let renewalRateChart = null;
let revenueChart = null;
let _contractsUnsub = null;

/* ---------------- META / LABELS ---------------- */
const CONTRACT_STATUS = {
    active: { label: 'Đang hiệu lực', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10', border: 'border-green-200 dark:border-green-800', dot: 'bg-green-500' },
    expiring_soon: { label: 'Sắp hết hạn', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
    expired: { label: 'Đã hết hạn', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-800', dot: 'bg-red-500' },
    renewed: { label: 'Đã gia hạn', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/10', border: 'border-blue-200 dark:border-blue-800', dot: 'bg-blue-500' },
    cancelled: { label: 'Đã huỷ', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-slate-800', border: 'border-gray-200 dark:border-slate-700', dot: 'bg-gray-400' },
    lost: { label: 'Rời bỏ (churn)', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/10', border: 'border-rose-200 dark:border-rose-800', dot: 'bg-rose-500' },
};
const PAYMENT_STATUS = { unpaid: 'Chưa thanh toán', partial: 'Thanh toán 1 phần', paid: 'Đã thanh toán đủ' };
const CARE_TYPE = { call: '📞 Gọi điện', email: '📧 Email', zalo: '💬 Zalo', meeting: '🤝 Gặp mặt', note: '📝 Ghi chú' };
const CARE_RESULT = { interested: 'Quan tâm', not_interested: 'Không quan tâm', no_response: 'Không phản hồi', renewed: 'Đã gia hạn', other: 'Khác' };

/* ---------------- HELPERS ---------------- */
function toDate(v) {
    if (!v) return null;
    if (v.seconds) return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d) ? null : d;
}
function toInputDate(v) {
    const d = toDate(v);
    if (!d) return '';
    return d.toISOString().split('T')[0];
}
function fmtDate(v) {
    const d = toDate(v);
    if (!d) return '—';
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoney(n) {
    return (window.formatCurrency ? window.formatCurrency(n || 0) : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0));
}
function daysLeft(endDate) {
    const d = toDate(endDate);
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
}
function computeContractStatus(c, today = new Date()) {
    if (['cancelled', 'renewed', 'lost'].includes(c.status)) return c.status;
    const dl = daysLeft(c.endDate);
    if (dl === null) return c.status || 'active';
    if (dl < 0) return 'expired';
    if (dl <= 15) return 'expiring_soon';
    return 'active';
}
function monthKey(d) { const dt = toDate(d); return dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : null; }
function monthLabel(key) { const [y, m] = key.split('-'); return `T${parseInt(m)}/${y}`; }
function last6Months() {
    const out = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function suggestContractCode() {
    const y = new Date().getFullYear();
    const countThisYear = contractsData.filter(c => (c.contractCode || '').includes(`HD-${y}-`)).length;
    return `HD-${y}-${String(countThisYear + 1).padStart(4, '0')}`;
}
function escapeHtml(s) { return (s ?? '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ================================================================
   INJECT UI VÀO DOM
   ================================================================ */
function injectContractsUI() {
    injectSidebarNav();
    injectContractsView();
    injectContractModal();
    injectDetailDrawer();
    injectCareLogModal();
    injectDashboardBlock();
}

function injectSidebarNav() {
    if (document.querySelector('[data-target="contracts"]')) return;
    const quotesBtn = document.querySelector('.nav-btn[data-target="quotes"]');
    if (!quotesBtn) return;
    const btn = document.createElement('button');
    btn.setAttribute('onclick', "navigate('contracts')");
    btn.className = 'nav-btn w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-primary/10 hover:text-primary transition-colors relative';
    btn.setAttribute('data-target', 'contracts');
    btn.innerHTML = `<span class="material-symbols-outlined mr-3 text-lg">assignment_late</span> Vòng đời Hợp đồng
        <span id="contracts-expiring-badge" class="hidden ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">0</span>`;
    quotesBtn.insertAdjacentElement('afterend', btn);
}

function injectContractsView() {
    if (document.getElementById('view-contracts')) return;
    const anchor = document.getElementById('view-dashboard');
    if (!anchor || !anchor.parentElement) return;
    const section = document.createElement('section');
    section.id = 'view-contracts';
    section.className = 'page-view hidden';
    section.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
            <h3 class="text-lg font-bold">Vòng đời Hợp đồng</h3>
            <p class="text-sm text-gray-500">Theo dõi ngày hết hạn, gia hạn, doanh thu và chăm sóc khách hàng.</p>
        </div>
        <button onclick="window.openContractModal()" class="inline-flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/30 hover:opacity-90 active:scale-95 transition-all shrink-0">
            <span class="material-symbols-outlined text-lg">add</span> Thêm hợp đồng
        </button>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <div class="relative flex-1">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
            <input id="ct-search" oninput="window.renderContractsTable()" type="text" placeholder="Tìm mã HĐ, khách hàng, dịch vụ..." class="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-primary/40 outline-none">
        </div>
        <select id="ct-filter-status" onchange="window.renderContractsTable()" class="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm px-3 py-2.5">
            <option value="">Tất cả trạng thái</option>
            <option value="active">Đang hiệu lực</option>
            <option value="expiring_soon">Sắp hết hạn</option>
            <option value="expired">Đã hết hạn (chưa renew)</option>
            <option value="renewed">Đã gia hạn</option>
            <option value="cancelled">Đã huỷ</option>
            <option value="lost">Rời bỏ (churn)</option>
        </select>
        <select id="ct-filter-owner" onchange="window.renderContractsTable()" class="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm px-3 py-2.5">
            <option value="">Tất cả CSKH</option>
        </select>
    </div>

    <!-- Desktop table -->
    <div class="desktop-table-wrap bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead class="bg-gray-50 dark:bg-slate-900/40 text-gray-500 text-xs uppercase tracking-wide">
                    <tr>
                        <th class="text-left px-4 py-3">Mã HĐ</th>
                        <th class="text-left px-4 py-3">Khách hàng</th>
                        <th class="text-left px-4 py-3">Dịch vụ</th>
                        <th class="text-right px-4 py-3">Giá trị</th>
                        <th class="text-left px-4 py-3">Hết hạn</th>
                        <th class="text-left px-4 py-3">Trạng thái</th>
                        <th class="text-left px-4 py-3">CSKH</th>
                        <th class="text-right px-4 py-3">Hành động</th>
                    </tr>
                </thead>
                <tbody id="contracts-table-body"></tbody>
            </table>
        </div>
    </div>

    <!-- Mobile cards -->
    <div id="contracts-mobile-list" class="mobile-card-list space-y-3"></div>

    <div id="contracts-empty" class="hidden text-center py-16 text-gray-400">
        <span class="material-symbols-outlined text-5xl mb-2">description</span>
        <p>Chưa có hợp đồng nào. Bấm "Thêm hợp đồng" để bắt đầu.</p>
    </div>

    <div class="flex items-center justify-between mt-4">
        <span id="contracts-pagination-info" class="text-xs text-gray-500"></span>
        <div id="contracts-pagination" class="flex items-center gap-1"></div>
    </div>`;
    anchor.parentElement.appendChild(section);
}

function injectContractModal() {
    if (document.getElementById('contract-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="contract-modal" class="fixed inset-0 z-[200] hidden opacity-0 transition-opacity duration-200 bg-black/50 flex items-center justify-center p-3">
        <div id="contract-modal-content" class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-200 shadow-2xl">
            <form onsubmit="window.saveContract(event)">
                <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
                    <h3 id="contract-modal-title" class="font-bold text-lg">Thêm hợp đồng</h3>
                    <button type="button" onclick="window.closeContractModal()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-700"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div id="contract-renewal-banner" class="hidden mx-5 mt-4 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium"></div>
                <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Mã hợp đồng *</label>
                        <input id="ct-code" required class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" placeholder="VD: HD-2026-0001">
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Khách hàng *</label>
                        <select id="ct-customer" required onchange="window._ctSyncCustomerName()" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"></select>
                    </div>
                    <div class="sm:col-span-2">
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Tên dịch vụ * <span class="font-normal text-gray-400">(gõ tự do hoặc chọn gợi ý)</span></label>
                        <input id="ct-service" required list="ct-service-suggestions" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" placeholder="VD: Thiết kế website, SEO, Chạy Ads...">
                        <datalist id="ct-service-suggestions"></datalist>
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Giá trị hợp đồng (VNĐ) *</label>
                        <input id="ct-value" type="number" min="0" required class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Đã thanh toán (VNĐ)</label>
                        <input id="ct-paid" type="number" min="0" value="0" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Trạng thái thanh toán</label>
                        <select id="ct-payment-status" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                            <option value="unpaid">Chưa thanh toán</option>
                            <option value="partial">Thanh toán 1 phần</option>
                            <option value="paid">Đã thanh toán đủ</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">CSKH phụ trách</label>
                        <select id="ct-owner" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"></select>
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Ngày ký</label>
                        <input id="ct-signed" type="date" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Ngày hiệu lực</label>
                        <input id="ct-start" type="date" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Ngày hết hạn *</label>
                        <input id="ct-end" type="date" required class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                    </div>
                    <div class="sm:col-span-2">
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Ghi chú</label>
                        <textarea id="ct-note" rows="2" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"></textarea>
                    </div>
                </div>
                <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-slate-700 sticky bottom-0 bg-white dark:bg-slate-800">
                    <button type="button" onclick="window.closeContractModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700">Huỷ</button>
                    <button type="submit" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white shadow-lg shadow-primary/30 hover:opacity-90">Lưu hợp đồng</button>
                </div>
            </form>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
}

function injectDetailDrawer() {
    if (document.getElementById('contract-detail-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="contract-detail-modal" class="fixed inset-0 z-[200] hidden opacity-0 transition-opacity duration-200 bg-black/50 flex items-center justify-center p-3">
        <div id="contract-detail-modal-content" class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-200 shadow-2xl">
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
                <h3 class="font-bold text-lg">Chi tiết hợp đồng</h3>
                <button onclick="window.closeContractDetail()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-700"><span class="material-symbols-outlined">close</span></button>
            </div>
            <div id="contract-detail-body" class="p-5 space-y-5"></div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
}

function injectCareLogModal() {
    if (document.getElementById('carelog-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="carelog-modal" class="fixed inset-0 z-[210] hidden opacity-0 transition-opacity duration-200 bg-black/60 flex items-center justify-center p-3">
        <div class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
            <form onsubmit="window.submitCareLog(event)">
                <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
                    <h3 class="font-bold text-base">Ghi nhận chăm sóc</h3>
                    <button type="button" onclick="window.closeCareLogModal()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-700"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div class="p-5 space-y-3">
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Hình thức</label>
                        <select id="cl-type" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                            <option value="call">📞 Gọi điện</option>
                            <option value="email">📧 Email</option>
                            <option value="zalo">💬 Zalo</option>
                            <option value="meeting">🤝 Gặp mặt</option>
                            <option value="note">📝 Ghi chú</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Kết quả</label>
                        <select id="cl-result" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
                            <option value="interested">Quan tâm</option>
                            <option value="not_interested">Không quan tâm</option>
                            <option value="no_response">Không phản hồi</option>
                            <option value="renewed">Đã gia hạn</option>
                            <option value="other">Khác</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs font-semibold text-gray-500 mb-1 block">Nội dung</label>
                        <textarea id="cl-content" rows="3" class="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" placeholder="Ghi lại nội dung trao đổi..."></textarea>
                    </div>
                </div>
                <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-slate-700">
                    <button type="button" onclick="window.closeCareLogModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700">Huỷ</button>
                    <button type="submit" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white shadow-lg shadow-primary/30 hover:opacity-90">Lưu nhật ký</button>
                </div>
            </form>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
}

function injectDashboardBlock() {
    if (document.getElementById('contracts-dashboard-block')) return;
    const dash = document.getElementById('view-dashboard');
    if (!dash) return;
    const block = document.createElement('div');
    block.id = 'contracts-dashboard-block';
    block.className = 'mt-6 space-y-6';
    block.innerHTML = `
    <div class="flex items-center justify-between">
        <h3 class="text-base font-bold flex items-center gap-2"><span class="material-symbols-outlined text-primary">assignment_late</span> Vòng đời Hợp đồng</h3>
        <button onclick="navigate('contracts')" class="text-xs font-semibold text-primary hover:underline">Xem tất cả →</button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-1 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
            <h4 class="text-sm font-bold mb-3">Sắp hết hạn (30 ngày tới)</h4>
            <div id="contracts-expiring-widget" class="space-y-2 max-h-72 overflow-y-auto"></div>
        </div>
        <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                <h4 class="text-sm font-bold mb-2">Tỷ lệ Renew theo tháng</h4>
                <div class="h-48"><canvas id="contract-renewal-rate-chart"></canvas></div>
            </div>
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                <h4 class="text-sm font-bold mb-2">Doanh thu: Mới vs Gia hạn</h4>
                <div class="h-48"><canvas id="contract-revenue-chart"></canvas></div>
            </div>
        </div>
    </div>

    <div class="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <h4 class="text-sm font-bold mb-3">Hiệu suất CSKH</h4>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead class="text-gray-500 text-xs uppercase">
                    <tr>
                        <th class="text-left py-2">Nhân viên</th>
                        <th class="text-right py-2">Số HĐ phụ trách</th>
                        <th class="text-right py-2">HĐ đến hạn (kỳ)</th>
                        <th class="text-right py-2">Tỷ lệ Renew</th>
                        <th class="text-right py-2">Doanh thu gia hạn</th>
                    </tr>
                </thead>
                <tbody id="cskh-ranking-body"></tbody>
            </table>
        </div>
    </div>`;
    dash.appendChild(block);
}

/* ================================================================
   FIRESTORE
   ================================================================ */
// ⚠️ Collection "contracts" là DÀNH RIÊNG cho module Vòng đời Hợp đồng (CRUD add/edit/delete ở đây).
// Contract Builder (cb-backend.js) đã được tách sang collection "cb_contracts" — KHÔNG dùng chung
// collection "contracts" cho bất kỳ tính năng nào khác để tránh đụng độ schema/status.
function startContractsListener() {
    return onSnapshot(query(getCollectionPath('contracts')), snap => {
        contractsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window.contractsData = contractsData;
        renderContractsTable();
        renderContractsDashboard();
        updateOwnerFilterOptions();
    }, err => console.error('[contracts listener]', err));
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        if (!_contractsUnsub) _contractsUnsub = startContractsListener();
    } else {
        if (_contractsUnsub) { _contractsUnsub(); _contractsUnsub = null; }
        contractsData = [];
    }
});

async function fetchServicesOnce() {
    if (servicesCache) return servicesCache;
    try {
        const snap = await getDocs(query(getCollectionPath('services')));
        servicesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { servicesCache = []; }
    return servicesCache;
}

/* ================================================================
   RENDER: BẢNG DANH SÁCH
   ================================================================ */
function getFilteredSortedContracts() {
    const q = (document.getElementById('ct-search')?.value || '').toLowerCase().trim();
    const statusF = document.getElementById('ct-filter-status')?.value || '';
    const ownerF = document.getElementById('ct-filter-owner')?.value || '';
    return contractsData
        .map(c => ({ ...c, _status: computeContractStatus(c) }))
        .filter(c => {
            if (statusF && c._status !== statusF) return false;
            if (ownerF && c.careOwnerId !== ownerF) return false;
            if (q) {
                const hay = `${c.contractCode || ''} ${c.customerNameSnapshot || ''} ${c.serviceName || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        })
        .sort((a, b) => (toDate(a.endDate) || 0) - (toDate(b.endDate) || 0));
}

window.renderContractsTable = function () {
    const list = getFilteredSortedContracts();
    const tbody = document.getElementById('contracts-table-body');
    const mobile = document.getElementById('contracts-mobile-list');
    const empty = document.getElementById('contracts-empty');
    if (!tbody || !mobile) return;

    if (list.length === 0) {
        tbody.innerHTML = ''; mobile.innerHTML = '';
        empty?.classList.remove('hidden');
        document.getElementById('contracts-pagination-info').textContent = '';
        document.getElementById('contracts-pagination').innerHTML = '';
        return;
    }
    empty?.classList.add('hidden');

    const totalPages = Math.max(1, Math.ceil(list.length / CONTRACTS_PER_PAGE));
    if (CPG > totalPages) CPG = totalPages;
    const start = (CPG - 1) * CONTRACTS_PER_PAGE;
    const pageItems = list.slice(start, start + CONTRACTS_PER_PAGE);

    tbody.innerHTML = pageItems.map(c => rowHtml(c)).join('');
    mobile.innerHTML = pageItems.map(c => cardHtml(c)).join('');

    const infoEl = document.getElementById('contracts-pagination-info');
    infoEl.textContent = `${start + 1}–${Math.min(start + CONTRACTS_PER_PAGE, list.length)} / ${list.length} hợp đồng`;

    const pagEl = document.getElementById('contracts-pagination');
    let html = `<button class="pagination-btn arrow" onclick="window._ctGoPage(${CPG - 1})" ${CPG === 1 ? 'disabled' : ''}><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>`;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - CPG) <= 1) {
            html += `<button class="pagination-btn ${CPG === p ? 'active' : ''}" onclick="window._ctGoPage(${p})">${p}</button>`;
        } else if (Math.abs(p - CPG) === 2) html += `<span class="text-gray-400 px-1 text-sm">…</span>`;
    }
    html += `<button class="pagination-btn arrow" onclick="window._ctGoPage(${CPG + 1})" ${CPG === totalPages ? 'disabled' : ''}><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>`;
    pagEl.innerHTML = html;

    updateSidebarBadge();
};
window._ctGoPage = (p) => { CPG = p; window.renderContractsTable(); };

function statusBadge(status) {
    const m = CONTRACT_STATUS[status] || CONTRACT_STATUS.active;
    return `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${m.bg} ${m.color} border ${m.border}"><span class="w-1.5 h-1.5 rounded-full ${m.dot}"></span>${m.label}</span>`;
}
function expiryChip(c) {
    const dl = daysLeft(c.endDate);
    if (dl === null) return '<span class="text-gray-400 text-xs">—</span>';
    let cls = 'text-gray-500';
    if (dl < 0) cls = 'text-red-600 font-semibold';
    else if (dl <= 7) cls = 'text-red-500 font-semibold';
    else if (dl <= 15) cls = 'text-amber-600 font-semibold';
    else cls = 'text-green-600';
    const txt = dl < 0 ? `Quá hạn ${Math.abs(dl)} ngày` : (dl === 0 ? 'Hết hạn hôm nay' : `Còn ${dl} ngày`);
    return `<div>${fmtDate(c.endDate)}</div><div class="text-xs ${cls}">${txt}</div>`;
}

function rowHtml(c) {
    return `<tr class="border-t border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-900/30 cursor-pointer" onclick="window.viewContractDetail('${c.id}')">
        <td class="px-4 py-3 font-semibold">${escapeHtml(c.contractCode)}</td>
        <td class="px-4 py-3">${escapeHtml(c.customerNameSnapshot)}</td>
        <td class="px-4 py-3">${escapeHtml(c.serviceName)}</td>
        <td class="px-4 py-3 text-right whitespace-nowrap">${fmtMoney(c.contractValue)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${expiryChip(c)}</td>
        <td class="px-4 py-3">${statusBadge(c._status)}</td>
        <td class="px-4 py-3 text-xs">${escapeHtml(c.careOwnerName || '—')}</td>
        <td class="px-4 py-3 text-right" onclick="event.stopPropagation()">
            <button onclick="window.openContractModal('${c.id}')" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500" title="Sửa"><span class="material-symbols-outlined text-[18px]">edit</span></button>
            <button onclick="window.deleteContract('${c.id}')" class="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Xoá"><span class="material-symbols-outlined text-[18px]">delete</span></button>
        </td>
    </tr>`;
}
function cardHtml(c) {
    return `<div class="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4" onclick="window.viewContractDetail('${c.id}')">
        <div class="flex items-start justify-between mb-2">
            <div>
                <p class="font-bold">${escapeHtml(c.contractCode)}</p>
                <p class="text-sm text-gray-500">${escapeHtml(c.customerNameSnapshot)}</p>
            </div>
            ${statusBadge(c._status)}
        </div>
        <p class="text-sm mb-1">${escapeHtml(c.serviceName)}</p>
        <div class="flex items-center justify-between text-sm">
            <span class="font-semibold">${fmtMoney(c.contractValue)}</span>
            ${expiryChip(c)}
        </div>
    </div>`;
}

function updateOwnerFilterOptions() {
    const sel = document.getElementById('ct-filter-owner');
    if (!sel) return;
    const cur = sel.value;
    const owners = [...new Map(contractsData.filter(c => c.careOwnerId).map(c => [c.careOwnerId, c.careOwnerName])).entries()];
    sel.innerHTML = '<option value="">Tất cả CSKH</option>' + owners.map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
    sel.value = cur;
}

function updateSidebarBadge() {
    const badge = document.getElementById('contracts-expiring-badge');
    if (!badge) return;
    const n = contractsData.filter(c => { const s = computeContractStatus(c); return s === 'expiring_soon' || s === 'expired'; }).length;
    if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
}

/* ================================================================
   MODAL: THÊM / SỬA HỢP ĐỒNG
   ================================================================ */
window.openContractModal = async function (id = null, renewalOfId = null) {
    editingContractId = id;
    pendingRenewalOf = renewalOfId;

    // Nguồn khách hàng
    const custSel = document.getElementById('ct-customer');
    const customers = window.customersData || [];
    custSel.innerHTML = '<option value="">— Chọn khách hàng —</option>' + customers.map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name || c.companyName || '')}">${escapeHtml(c.name || c.companyName || '(Không tên)')}</option>`).join('');

    // Nguồn CSKH (dùng danh bạ email nội bộ đã có sẵn trong hệ thống)
    const ownerSel = document.getElementById('ct-owner');
    const staff = window.emailContactsData || [];
    ownerSel.innerHTML = '<option value="">— Chưa gán —</option>' + staff.map(s => `<option value="${s.id}" data-name="${escapeHtml(s.name || s.email)}" data-email="${escapeHtml(s.email || '')}">${escapeHtml(s.name || s.email)}</option>`).join('');

    // Gợi ý dịch vụ
    const services = await fetchServicesOnce();
    document.getElementById('ct-service-suggestions').innerHTML = services.map(s => `<option value="${escapeHtml(s.name)}">`).join('');

    const banner = document.getElementById('contract-renewal-banner');
    const form = document.getElementById('contract-modal-content').querySelector('form');
    form.reset();

    if (id) {
        const c = contractsData.find(x => x.id === id);
        if (!c) return;
        document.getElementById('contract-modal-title').innerText = 'Sửa hợp đồng';
        document.getElementById('ct-code').value = c.contractCode || '';
        custSel.value = c.customerId || '';
        document.getElementById('ct-service').value = c.serviceName || '';
        document.getElementById('ct-value').value = c.contractValue || 0;
        document.getElementById('ct-paid').value = c.paidAmount || 0;
        document.getElementById('ct-payment-status').value = c.paymentStatus || 'unpaid';
        ownerSel.value = c.careOwnerId || '';
        document.getElementById('ct-signed').value = toInputDate(c.signedDate);
        document.getElementById('ct-start').value = toInputDate(c.startDate);
        document.getElementById('ct-end').value = toInputDate(c.endDate);
        document.getElementById('ct-note').value = c.note || '';
        banner.classList.add('hidden');
    } else {
        document.getElementById('contract-modal-title').innerText = renewalOfId ? 'Tạo hợp đồng gia hạn' : 'Thêm hợp đồng';
        document.getElementById('ct-code').value = suggestContractCode();
        document.getElementById('ct-payment-status').value = 'unpaid';
        document.getElementById('ct-paid').value = 0;
        document.getElementById('ct-signed').value = toInputDate(new Date());

        if (renewalOfId) {
            const old = contractsData.find(x => x.id === renewalOfId);
            if (old) {
                custSel.value = old.customerId || '';
                document.getElementById('ct-service').value = old.serviceName || '';
                document.getElementById('ct-value').value = old.contractValue || 0;
                ownerSel.value = old.careOwnerId || '';
                banner.textContent = `🔗 Hợp đồng này sẽ được liên kết là GIA HẠN của "${old.contractCode}". Vui lòng nhập ngày ký/hiệu lực/hết hạn mới.`;
                banner.classList.remove('hidden');
            }
        } else {
            banner.classList.add('hidden');
        }
    }

    const modal = document.getElementById('contract-modal');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); document.getElementById('contract-modal-content').classList.remove('scale-95'); }, 10);
};

window.closeContractModal = function () {
    const modal = document.getElementById('contract-modal');
    modal.classList.add('opacity-0'); document.getElementById('contract-modal-content').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
    editingContractId = null; pendingRenewalOf = null;
};

window._ctSyncCustomerName = function () {
    // no-op hook giữ lại cho khả năng mở rộng (ví dụ auto-fill thông tin khách hàng khác)
};

window.saveContract = async function (e) {
    e.preventDefault();
    const custSel = document.getElementById('ct-customer');
    const ownerSel = document.getElementById('ct-owner');
    const code = document.getElementById('ct-code').value.trim();
    const customerId = custSel.value;
    const customerNameSnapshot = custSel.selectedOptions[0]?.dataset.name || '';
    const serviceName = document.getElementById('ct-service').value.trim();
    const contractValue = Number(document.getElementById('ct-value').value) || 0;
    const paidAmount = Number(document.getElementById('ct-paid').value) || 0;
    const paymentStatus = document.getElementById('ct-payment-status').value;
    const careOwnerId = ownerSel.value;
    const careOwnerName = ownerSel.selectedOptions[0]?.dataset.name || '';
    const signedDate = document.getElementById('ct-signed').value ? new Date(document.getElementById('ct-signed').value) : null;
    const startDate = document.getElementById('ct-start').value ? new Date(document.getElementById('ct-start').value) : null;
    const endDate = document.getElementById('ct-end').value ? new Date(document.getElementById('ct-end').value) : null;
    const note = document.getElementById('ct-note').value.trim();

    if (!customerId) return window.showToast('Vui lòng chọn khách hàng', 'error');
    if (!endDate) return window.showToast('Vui lòng nhập ngày hết hạn', 'error');

    // Cảnh báo trùng mã HĐ (không chặn, chỉ cảnh báo — theo yêu cầu)
    const dup = contractsData.find(c => c.contractCode === code && c.id !== editingContractId);
    if (dup && !confirm(`Mã hợp đồng "${code}" đã tồn tại (khách hàng: ${dup.customerNameSnapshot}). Vẫn tiếp tục lưu?`)) return;

    let durationMonths = null;
    if (startDate && endDate) durationMonths = Math.max(1, Math.round((endDate - startDate) / (30 * 86400000)));

    // Tìm dịch vụ khớp trong danh mục có sẵn (nếu có) để map thống kê
    const services = servicesCache || [];
    const matchedService = services.find(s => (s.name || '').toLowerCase() === serviceName.toLowerCase());

    const payload = {
        contractCode: code, customerId, customerNameSnapshot,
        serviceName, serviceIdRef: matchedService ? matchedService.id : null,
        contractValue, paymentStatus, paidAmount,
        signedDate, startDate, endDate, durationMonths,
        careOwnerId: careOwnerId || null, careOwnerName: careOwnerName || null,
        note, updatedAt: serverTimestamp()
    };

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; const orig = btn.innerText; btn.innerText = 'Đang lưu...';

    try {
        if (editingContractId) {
            await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', editingContractId), payload);
            window.showToast('Đã cập nhật hợp đồng');
        } else {
            payload.status = 'active';
            payload.renewalOf = pendingRenewalOf || null;
            payload.renewedTo = null;
            payload.renewalCount = 0;
            payload.careLogs = [];
            payload.reminderLogs = [];
            payload.attachments = [];
            payload.createdAt = serverTimestamp();
            const newDoc = await addDoc(getCollectionPath('contracts'), payload);

            if (pendingRenewalOf) {
                const old = contractsData.find(x => x.id === pendingRenewalOf);
                await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', pendingRenewalOf), {
                    renewedTo: newDoc.id,
                    renewalCount: (old?.renewalCount || 0) + 1,
                    status: 'renewed',
                    updatedAt: serverTimestamp()
                });
            }
            window.showToast('Đã thêm hợp đồng' + (pendingRenewalOf ? ' gia hạn' : ''));
        }
        window.closeContractModal();
    } catch (err) {
        console.error('[saveContract]', err);
        window.showToast('Lỗi khi lưu hợp đồng: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.innerText = orig;
    }
};

window.deleteContract = async function (id) {
    if (!confirm('Xoá hợp đồng này? Hành động không thể hoàn tác.')) return;
    try {
        await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', id));
        window.showToast('Đã xoá hợp đồng');
        window.closeContractDetail();
    } catch (err) { window.showToast('Lỗi khi xoá: ' + err.message, 'error'); }
};

window.setContractStatus = async function (id, status) {
    try {
        await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', id), { status, updatedAt: serverTimestamp() });
        window.showToast('Đã cập nhật trạng thái');
    } catch (err) { window.showToast('Lỗi: ' + err.message, 'error'); }
};

/* ================================================================
   DRAWER CHI TIẾT + NHẬT KÝ CHĂM SÓC (P4) + GIA HẠN (P6)
   ================================================================ */
window.viewContractDetail = function (id) {
    currentDetailId = id;
    renderContractDetail();
    const modal = document.getElementById('contract-detail-modal');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); document.getElementById('contract-detail-modal-content').classList.remove('scale-95'); }, 10);
};
window.closeContractDetail = function () {
    const modal = document.getElementById('contract-detail-modal');
    modal.classList.add('opacity-0'); document.getElementById('contract-detail-modal-content').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
    currentDetailId = null;
};

function renderContractDetail() {
    const c = contractsData.find(x => x.id === currentDetailId);
    const body = document.getElementById('contract-detail-body');
    if (!c || !body) return;
    const status = computeContractStatus(c);
    const chainOld = c.renewalOf ? contractsData.find(x => x.id === c.renewalOf) : null;
    const chainNew = c.renewedTo ? contractsData.find(x => x.id === c.renewedTo) : null;

    const careLogs = (c.careLogs || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const reminderLogs = (c.reminderLogs || []).slice().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

    body.innerHTML = `
    <div class="flex items-start justify-between">
        <div>
            <h4 class="text-xl font-bold">${escapeHtml(c.contractCode)}</h4>
            <p class="text-sm text-gray-500">${escapeHtml(c.customerNameSnapshot)} · ${escapeHtml(c.serviceName)}</p>
        </div>
        ${statusBadge(status)}
    </div>

    ${chainOld || chainNew ? `<div class="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg px-3 py-2 space-y-1">
        ${chainOld ? `<div>🔗 Gia hạn từ: <button class="underline font-semibold" onclick="window.viewContractDetail('${chainOld.id}')">${escapeHtml(chainOld.contractCode)}</button></div>` : ''}
        ${chainNew ? `<div>🔗 Đã được gia hạn thành: <button class="underline font-semibold" onclick="window.viewContractDetail('${chainNew.id}')">${escapeHtml(chainNew.contractCode)}</button></div>` : ''}
        <div>Số lần đã gia hạn: <b>${c.renewalCount || 0}</b></div>
    </div>` : ''}

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div><p class="text-xs text-gray-400">Giá trị HĐ</p><p class="font-semibold">${fmtMoney(c.contractValue)}</p></div>
        <div><p class="text-xs text-gray-400">Đã thanh toán</p><p class="font-semibold">${fmtMoney(c.paidAmount)}</p></div>
        <div><p class="text-xs text-gray-400">Thanh toán</p><p class="font-semibold">${PAYMENT_STATUS[c.paymentStatus] || '—'}</p></div>
        <div><p class="text-xs text-gray-400">Ngày ký</p><p class="font-semibold">${fmtDate(c.signedDate)}</p></div>
        <div><p class="text-xs text-gray-400">Hiệu lực</p><p class="font-semibold">${fmtDate(c.startDate)}</p></div>
        <div><p class="text-xs text-gray-400">Hết hạn</p><p class="font-semibold">${fmtDate(c.endDate)}</p></div>
        <div><p class="text-xs text-gray-400">CSKH phụ trách</p><p class="font-semibold">${escapeHtml(c.careOwnerName || '—')}</p></div>
    </div>
    ${c.note ? `<div class="text-sm bg-gray-50 dark:bg-slate-900/40 rounded-lg p-3">${escapeHtml(c.note)}</div>` : ''}

    <div class="flex flex-wrap gap-2">
        <button onclick="window.openContractModal('${c.id}')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-slate-700 hover:opacity-80">✏️ Sửa</button>
        <button onclick="window.openCareLogModal('${c.id}')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:opacity-80">📝 Ghi nhận chăm sóc</button>
        <button onclick="window.sendRenewalReminderNow('${c.id}')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 hover:opacity-80">🔔 Gửi nhắc gia hạn ngay</button>
        ${!c.renewedTo ? `<button onclick="window.openContractModal(null, '${c.id}')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 hover:opacity-80">🔁 Tạo hợp đồng gia hạn</button>` : ''}
        ${status !== 'cancelled' ? `<button onclick="window.setContractStatus('${c.id}','cancelled')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-slate-700 hover:opacity-80">🚫 Huỷ hợp đồng</button>` : ''}
        <button onclick="window.deleteContract('${c.id}')" class="px-3 py-2 rounded-lg text-xs font-semibold bg-red-50 text-red-600 dark:bg-red-900/20 hover:opacity-80 ml-auto">🗑 Xoá</button>
    </div>

    <div>
        <h5 class="text-sm font-bold mb-2">Nhật ký chăm sóc (${careLogs.length})</h5>
        <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
            ${careLogs.length ? careLogs.map(l => `
                <div class="border border-gray-100 dark:border-slate-700 rounded-lg p-2.5 text-sm">
                    <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>${CARE_TYPE[l.type] || l.type} · ${escapeHtml(CARE_RESULT[l.result] || l.result)}</span>
                        <span>${l.date ? new Date(l.date).toLocaleString('vi-VN') : ''}</span>
                    </div>
                    <p>${escapeHtml(l.content || '')}</p>
                    <p class="text-xs text-gray-400 mt-1">— ${escapeHtml(l.staffName || '')}</p>
                </div>`).join('') : `<p class="text-xs text-gray-400">Chưa có nhật ký chăm sóc nào.</p>`}
        </div>
    </div>

    <div>
        <h5 class="text-sm font-bold mb-2">Lịch sử nhắc gia hạn (${reminderLogs.length})</h5>
        <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
            ${reminderLogs.length ? reminderLogs.map(r => `
                <div class="text-xs flex items-center justify-between border-b border-gray-50 dark:border-slate-700 py-1">
                    <span>${r.channel === 'email' ? '📧' : '💬'} Trước ${r.daysBeforeExpiry} ngày</span>
                    <span class="text-gray-400">${r.sentAt ? new Date(r.sentAt).toLocaleString('vi-VN') : ''}</span>
                </div>`).join('') : `<p class="text-xs text-gray-400">Chưa gửi nhắc gia hạn lần nào. (Nhắc tự động hàng ngày sẽ do Apps Script đảm nhận — xem P3.)</p>`}
        </div>
    </div>`;
}

window.openCareLogModal = function (contractId) {
    document.getElementById('carelog-modal').dataset.contractId = contractId;
    document.getElementById('cl-type').value = 'call';
    document.getElementById('cl-result').value = 'interested';
    document.getElementById('cl-content').value = '';
    const modal = document.getElementById('carelog-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};
window.closeCareLogModal = function () {
    const modal = document.getElementById('carelog-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 200);
};
window.submitCareLog = async function (e) {
    e.preventDefault();
    const contractId = document.getElementById('carelog-modal').dataset.contractId;
    const c = contractsData.find(x => x.id === contractId);
    if (!c) return;
    const entry = {
        id: genId(), date: new Date().toISOString(),
        type: document.getElementById('cl-type').value,
        content: document.getElementById('cl-content').value.trim(),
        result: document.getElementById('cl-result').value,
        staffId: window.currentUser?.uid || '', staffName: window.currentUser?.displayName || window.currentUser?.email || 'Nhân viên'
    };
    const newLogs = [...(c.careLogs || []), entry];
    try {
        await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', contractId), { careLogs: newLogs, updatedAt: serverTimestamp() });
        window.showToast('Đã lưu nhật ký chăm sóc');
        window.closeCareLogModal();
    } catch (err) { window.showToast('Lỗi: ' + err.message, 'error'); }
};

// Gửi nhắc gia hạn thủ công — chỉ nội bộ CSKH, qua Email (mailto, không phụ thuộc template EmailJS
// vốn được cấu hình riêng cho nhắc deadline job). Việc gửi tự động hàng ngày do Apps Script (P3) đảm nhận.
window.sendRenewalReminderNow = async function (id) {
    const c = contractsData.find(x => x.id === id);
    if (!c) return;
    const staff = (window.emailContactsData || []).find(s => s.id === c.careOwnerId);
    const toEmail = staff?.email;
    if (!toEmail) return window.showToast('Hợp đồng chưa gán CSKH có email — vui lòng gán CSKH trước', 'error');

    const dl = daysLeft(c.endDate);
    const subject = `Nhắc gia hạn hợp đồng ${c.contractCode} — ${c.customerNameSnapshot}`;
    const bodyText = `Hợp đồng ${c.contractCode} (${c.customerNameSnapshot} - ${c.serviceName}) sẽ hết hạn vào ${fmtDate(c.endDate)} (${dl !== null ? (dl < 0 ? `đã quá hạn ${Math.abs(dl)} ngày` : `còn ${dl} ngày`) : ''}). Vui lòng liên hệ khách hàng để chăm sóc/gia hạn.`;
    window.open(`mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`, '_blank');

    const newLog = { sentAt: new Date().toISOString(), channel: 'email', daysBeforeExpiry: dl, template: 'manual', success: true };
    try {
        await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'contracts', id), { reminderLogs: [...(c.reminderLogs || []), newLog], updatedAt: serverTimestamp() });
        window.showToast('Đã mở email nhắc gia hạn & ghi log');
        renderContractDetail();
    } catch (err) { console.error(err); }
};

/* ================================================================
   DASHBOARD: WIDGET SẮP HẾT HẠN + BÁO CÁO RENEW/DOANH THU (P2 + P5)
   ================================================================ */
function renderContractsDashboard() {
    renderExpiringWidget();
    renderRenewalRateChart();
    renderRevenueChart();
    renderCskhRanking();
}

function renderExpiringWidget() {
    const el = document.getElementById('contracts-expiring-widget');
    if (!el) return;
    const soon = contractsData
        .map(c => ({ ...c, _dl: daysLeft(c.endDate), _status: computeContractStatus(c) }))
        .filter(c => c._dl !== null && c._dl <= 30 && ['active', 'expiring_soon', 'expired'].includes(c._status))
        .sort((a, b) => a._dl - b._dl)
        .slice(0, 8);

    if (soon.length === 0) { el.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Không có hợp đồng nào sắp hết hạn 🎉</p>`; return; }

    el.innerHTML = soon.map(c => {
        let dot = 'bg-green-500';
        if (c._dl < 0) dot = 'bg-red-500'; else if (c._dl <= 7) dot = 'bg-red-400'; else if (c._dl <= 15) dot = 'bg-amber-500';
        const txt = c._dl < 0 ? `Quá hạn ${Math.abs(c._dl)} ngày` : (c._dl === 0 ? 'Hôm nay' : `Còn ${c._dl} ngày`);
        return `<div class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900/30 rounded-lg p-1.5" onclick="window.viewContractDetail('${c.id}')">
            <span class="w-2 h-2 rounded-full ${dot} shrink-0"></span>
            <div class="min-w-0 flex-1">
                <p class="truncate font-medium">${escapeHtml(c.customerNameSnapshot)}</p>
                <p class="truncate text-xs text-gray-400">${escapeHtml(c.contractCode)}</p>
            </div>
            <span class="text-xs shrink-0 text-gray-500">${txt}</span>
        </div>`;
    }).join('');
}

function computeMonthlyRenewalRate() {
    const months = last6Months();
    return months.map(mk => {
        const inMonth = contractsData.filter(c => monthKey(c.endDate) === mk && c.status !== 'cancelled');
        const renewed = inMonth.filter(c => c.renewedTo).length;
        const rate = inMonth.length ? Math.round((renewed / inMonth.length) * 100) : 0;
        return { mk, total: inMonth.length, renewed, rate };
    });
}
function computeMonthlyRevenue() {
    const months = last6Months();
    return months.map(mk => {
        const inMonth = contractsData.filter(c => monthKey(c.signedDate) === mk);
        const newRevenue = inMonth.filter(c => !c.renewalOf).reduce((s, c) => s + (c.contractValue || 0), 0);
        const renewalRevenue = inMonth.filter(c => c.renewalOf).reduce((s, c) => s + (c.contractValue || 0), 0);
        return { mk, newRevenue, renewalRevenue };
    });
}

function chartColors() {
    const dark = document.documentElement.classList.contains('dark');
    return { text: dark ? '#94a3b8' : '#64748b', grid: dark ? 'rgba(148,163,184,.1)' : 'rgba(100,116,139,.08)' };
}

function renderRenewalRateChart() {
    const canvas = document.getElementById('contract-renewal-rate-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const data = computeMonthlyRenewalRate();
    const { text, grid } = chartColors();
    if (renewalRateChart) renewalRateChart.destroy();
    renewalRateChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: data.map(d => monthLabel(d.mk)),
            datasets: [{ label: 'Tỷ lệ Renew (%)', data: data.map(d => d.rate), borderColor: '#6366f1', backgroundColor: '#6366f120', tension: 0.35, fill: true }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100, ticks: { color: text, callback: v => v + '%' }, grid: { color: grid } }, x: { ticks: { color: text }, grid: { display: false } } }
        }
    });
}
function renderRevenueChart() {
    const canvas = document.getElementById('contract-revenue-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const data = computeMonthlyRevenue();
    const { text, grid } = chartColors();
    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: data.map(d => monthLabel(d.mk)),
            datasets: [
                { label: 'Mới', data: data.map(d => d.newRevenue), backgroundColor: '#6366f1', stack: 's' },
                { label: 'Gia hạn', data: data.map(d => d.renewalRevenue), backgroundColor: '#22c55e', stack: 's' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: text, boxWidth: 10, font: { size: 10 } } } },
            scales: {
                y: { beginAtZero: true, ticks: { color: text, callback: v => (v / 1000000) + 'tr' }, grid: { color: grid } },
                x: { ticks: { color: text }, grid: { display: false }, stacked: true }
            }
        }
    });
}

function renderCskhRanking() {
    const body = document.getElementById('cskh-ranking-body');
    if (!body) return;
    const map = new Map();
    contractsData.forEach(c => {
        if (!c.careOwnerId) return;
        if (!map.has(c.careOwnerId)) map.set(c.careOwnerId, { name: c.careOwnerName, total: 0, due: 0, renewed: 0, renewalRevenue: 0 });
        const rec = map.get(c.careOwnerId);
        rec.total++;
        const dl = daysLeft(c.endDate);
        const isDue = dl !== null && dl <= 0 || c.renewedTo || c.status === 'renewed';
        if (isDue) { rec.due++; if (c.renewedTo) rec.renewed++; }
        if (c.renewalOf) rec.renewalRevenue += (c.contractValue || 0);
    });
    const rows = [...map.values()].sort((a, b) => b.renewalRevenue - a.renewalRevenue);
    if (rows.length === 0) { body.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-xs text-gray-400">Chưa có dữ liệu — hãy gán CSKH phụ trách cho hợp đồng</td></tr>`; return; }
    body.innerHTML = rows.map(r => {
        const rate = r.due ? Math.round((r.renewed / r.due) * 100) : 0;
        return `<tr class="border-t border-gray-50 dark:border-slate-700">
            <td class="py-2 font-medium">${escapeHtml(r.name)}</td>
            <td class="py-2 text-right">${r.total}</td>
            <td class="py-2 text-right">${r.due}</td>
            <td class="py-2 text-right font-semibold ${rate >= 50 ? 'text-green-600' : 'text-amber-600'}">${rate}%</td>
            <td class="py-2 text-right">${fmtMoney(r.renewalRevenue)}</td>
        </tr>`;
    }).join('');
}

/* ================================================================
   BOOTSTRAP
   ================================================================ */
function boot() { injectContractsUI(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
