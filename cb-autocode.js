/* ================================================================
   cb-autocode.js  —  Tự động tạo Mã hợp đồng & Mã dự án
   Version: 1.0.0

   CÁCH THÊM VÀO DỰ ÁN:
   ─────────────────────────────────────────────────────────────
   Chèn 1 dòng vào index.html, SAU cb-module-patch.js:

       <script type="module" src="cb-autocode.js"></script>

   ─────────────────────────────────────────────────────────────
   LOGIC:
   - Mỗi loại mã lưu counter trong Firestore:
       artifacts/{app_id}/public/data/counters/contract_no
       artifacts/{app_id}/public/data/counters/project_code
   - Dùng runTransaction → đảm bảo tăng dần, không bao giờ trùng
     dù nhiều tab / nhiều user cùng tạo đồng thời
   - Sang năm mới → tự reset về 001
   - Chỉ fill khi ô đang TRỐNG → không ghi đè draft đã có sẵn
   - Tự gọi khi navigate đến 'contract-builder'
   - Expose window.cbGenerateCodes() để gọi thủ công (nút Refresh)

   FORMAT MẶC ĐỊNH:
       Hợp đồng : HD-2026-001
       Dự án    : DA-2026-001
   (Đổi prefix bằng cách sửa 2 hằng CONTRACT_PREFIX / PROJECT_PREFIX)
   ================================================================ */

import { getApp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import { getAuth, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { getFirestore, doc, runTransaction, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Cấu hình ─────────────────────────────────────────────────────
const APP_ID = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const CONTRACT_PREFIX = 'HD';   // → HD-2026-001
const PROJECT_PREFIX = 'DA';   // → DA-2026-001
const SEQ_PAD = 3;      // số chữ số (3 → 001, 4 → 0001)

// ── Core: lấy số thứ tự kế tiếp bằng Firestore Transaction ───────
// runTransaction đảm bảo atomic → không bao giờ 2 client lấy cùng số
async function _nextCode(db, prefix, counterKey) {
    const year = new Date().getFullYear();
    const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'counters', counterKey);

    let seq;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};

        // Nếu sang năm mới → reset về 0 trước khi tăng
        const base = (data.year === year) ? (data.seq || 0) : 0;
        seq = base + 1;

        tx.set(ref, { year, seq, updatedAt: serverTimestamp() });
    });

    return `${prefix}-${year}-${String(seq).padStart(SEQ_PAD, '0')}`;
}

// ── Điền mã vào form ─────────────────────────────────────────────
window.cbGenerateCodes = async function (force = false) {
    const contractEl = document.getElementById('cb-contract-no');
    const projectEl = document.getElementById('cb-project-code');

    // force=false → chỉ fill ô trống; force=true → ghi đè (dùng cho nút Refresh)
    const needContract = contractEl && (force || !contractEl.value.trim());
    const needProject = projectEl && (force || !projectEl.value.trim());

    if (!needContract && !needProject) return;

    try {
        const db = getFirestore(getApp());

        // Chạy song song 2 transaction → nhanh hơn chạy tuần tự
        const [contractCode, projectCode] = await Promise.all([
            needContract ? _nextCode(db, CONTRACT_PREFIX, 'contract_no') : Promise.resolve(null),
            needProject ? _nextCode(db, PROJECT_PREFIX, 'project_code') : Promise.resolve(null),
        ]);

        if (contractCode && contractEl) {
            contractEl.value = contractCode;
            // Kích hoạt cbAutoSave + cbUpdatePreview qua event
            contractEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (projectCode && projectEl) {
            projectEl.value = projectCode;
            projectEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Update preview ngay
        if (typeof cbUpdatePreview === 'function') cbUpdatePreview();
        if (typeof cbAutoSave === 'function') cbAutoSave();

        // Toast thông báo
        const parts = [contractCode, projectCode].filter(Boolean);
        if (window.showToast && parts.length) {
            window.showToast(`Đã tạo mã: ${parts.join(' · ')}`, 'success');
        }

    } catch (err) {
        console.error('[cb-autocode] Lỗi tạo mã:', err);
        if (window.showToast) window.showToast('Không thể tạo mã tự động: ' + err.message, 'error');
    }
};

// ── Hook navigate → tự gọi khi mở Contract Builder ───────────────
(function _hookNavigate() {
    const MAX_WAIT_MS = 8000;
    const start = Date.now();

    const iv = setInterval(() => {
        if (typeof window.navigate === 'function') {
            clearInterval(iv);

            const _orig = window.navigate;
            window.navigate = function (target) {
                _orig(target);
                if (target === 'contract-builder') {
                    // Đợi form render xong (cbInit / cbInitWithFirestore chạy ~50-100ms)
                    setTimeout(() => window.cbGenerateCodes(false), 400);
                }
            };

            console.log('[cb-autocode] ✅ navigate hooked');
        }

        if (Date.now() - start > MAX_WAIT_MS) clearInterval(iv);
    }, 80);
})();

// ── Fallback: nếu CB đang mở sẵn khi Auth xác nhận ──────────────
onAuthStateChanged(getAuth(getApp()), (user) => {
    if (!user) return;
    const cbView = document.getElementById('view-contract-builder');
    if (cbView && !cbView.classList.contains('hidden')) {
        setTimeout(() => window.cbGenerateCodes(false), 500);
    }
});


/* ================================================================
   cb-customer-picker.js  —  Chọn khách hàng nhanh cho Bên B
   Version: 1.1.0

   CÁCH TÍCH HỢP:
   ─────────────────────────────────────────────────────────────
   1. Thêm 1 dòng vào app.js, trong onSnapshot customers (dòng ~340):
         customersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
         window.customersData = customersData;   ← thêm dòng này
         renderCustomers();

   2. Thêm vào index.html, SAU cb-autocode.js:
         <script src="cb-customer-picker.js"></script>

   ─────────────────────────────────────────────────────────────
   LOGIC:
   - Wrap window.renderCustomers → mỗi lần Firestore push data mới,
     renderCustomers() chạy → picker tự đồng bộ cache từ window.customersData
   - Dropdown floating gắn vào nút "Lấy từ khách hàng" (Step 3)
   - Tìm kiếm realtime theo tên / SĐT / email (highlight match)
   - Click chọn → điền 6 field Bên B → kích cbUpdatePreview + cbAutoSave
   ================================================================ */

(function () {

    /* ── Cache nội bộ — được cập nhật mỗi khi renderCustomers chạy ── */
    let _cache = [];

    /* ── Wrap window.renderCustomers để đồng bộ cache ── */
    function _hookRenderCustomers() {
        const orig = window.renderCustomers;
        if (typeof orig !== 'function') return false;

        window.renderCustomers = function () {
            orig.apply(this, arguments);
            /* window.customersData được set trong onSnapshot trước khi
               renderCustomers() được gọi → luôn là bản mới nhất */
            if (Array.isArray(window.customersData)) {
                _cache = window.customersData;
            }
        };
        return true;
    }

    /* Thử hook ngay; nếu app.js chưa define renderCustomers thì retry */
    if (!_hookRenderCustomers()) {
        const iv = setInterval(() => {
            if (_hookRenderCustomers()) clearInterval(iv);
        }, 100);
        setTimeout(() => clearInterval(iv), 10000);
    }

    /* ── Điền dữ liệu vào form Bên B ── */
    function _fillPartyB(cus) {
        const bankStr = [cus.bankName, cus.bankAccount].filter(Boolean).join(' – ');

        const map = {
            'cb-b-name': cus.name || '',
            'cb-b-phone': cus.phone || '',
            'cb-b-email': cus.email || '',
            'cb-b-address': cus.address || '',
            'cb-b-id': cus.cccd || '',
            'cb-b-bank': bankStr,
        };

        Object.entries(map).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });

        if (typeof window.cbUpdateBProfile === 'function') window.cbUpdateBProfile();
        if (typeof window.cbUpdatePreview === 'function') window.cbUpdatePreview();
        if (typeof window.cbAutoSave === 'function') window.cbAutoSave();

        if (window.showToast) window.showToast(`Đã điền thông tin: ${cus.name}`, 'success');
    }

    /* ── Render danh sách trong dropdown ── */
    function _renderList(listEl, query) {
        const q = query.trim().toLowerCase();

        const filtered = q
            ? _cache.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.phone || '').includes(q) ||
                (c.email || '').toLowerCase().includes(q)
            )
            : _cache;

        if (_cache.length === 0) {
            listEl.innerHTML = `
                <div class="py-8 text-center text-gray-400 text-sm">
                    <span class="material-symbols-outlined block text-3xl mb-1">group_off</span>
                    Chưa có khách hàng nào
                </div>`;
            return;
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `
                <div class="py-8 text-center text-gray-400 text-sm">
                    <span class="material-symbols-outlined block text-3xl mb-1">search_off</span>
                    Không tìm thấy "<strong class="text-gray-600">${q}</strong>"
                </div>`;
            return;
        }

        const hl = (str) => {
            if (!q || !str) return str || '';
            const i = str.toLowerCase().indexOf(q);
            if (i === -1) return str;
            return str.slice(0, i)
                + `<mark class="bg-yellow-100 dark:bg-yellow-700/40 text-inherit rounded-sm">${str.slice(i, i + q.length)}</mark>`
                + str.slice(i + q.length);
        };

        listEl.innerHTML = filtered.map(c => {
            const initial = (c.name || '?').charAt(0).toUpperCase();
            const sub = [c.phone, c.email].filter(Boolean).join(' · ');
            const bank = [c.bankName, c.bankAccount].filter(Boolean).join(' – ');

            return `
            <button type="button" class="cb-picker-item w-full flex items-center gap-3 px-3 py-2.5 text-left
                rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/25 transition-colors group"
                data-id="${c.id}">
                <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-400 to-violet-400
                    flex items-center justify-center text-white font-bold text-base shrink-0 select-none">
                    ${initial}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-sm text-gray-800 dark:text-gray-100 truncate
                        group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                        ${hl(c.name)}
                    </p>
                    <p class="text-[11px] text-gray-500 truncate">${hl(sub)}</p>
                    ${bank ? `<p class="text-[10px] text-gray-400 truncate mt-0.5">🏦 ${bank}</p>` : ''}
                </div>
                <span class="material-symbols-outlined text-[18px] text-gray-300
                    group-hover:text-indigo-400 shrink-0">chevron_right</span>
            </button>`;
        }).join('');

        /* Sự kiện chọn */
        listEl.querySelectorAll('.cb-picker-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const cus = _cache.find(c => c.id === btn.dataset.id);
                if (cus) _fillPartyB(cus);
                _close();
            });
        });
    }

    /* ── Cập nhật counter ── */
    function _updateCounter(picker) {
        const el = picker.querySelector('#cb-picker-counter');
        const shown = picker.querySelectorAll('.cb-picker-item').length;
        const total = _cache.length;
        if (!el) return;
        el.textContent = (shown < total)
            ? `Hiển thị ${shown} / ${total} khách hàng`
            : `${total} khách hàng`;
    }

    /* ── Tạo dropdown (singleton) ── */
    const PICKER_ID = 'cb-cus-picker';

    function _getOrCreate() {
        let el = document.getElementById(PICKER_ID);
        if (el) return el;

        el = document.createElement('div');
        el.id = PICKER_ID;
        el.className = [
            'fixed z-[200]',
            'bg-white dark:bg-slate-900',
            'border border-gray-200 dark:border-slate-700',
            'rounded-2xl shadow-2xl',
            'w-[340px] max-w-[calc(100vw-24px)]',
            'flex flex-col overflow-hidden',
            'opacity-0 scale-95',
            'transition-[opacity,transform] duration-200',
        ].join(' ');

        el.innerHTML = `
            <div class="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-indigo-500 text-[20px]">person_search</span>
                    <span class="font-bold text-sm text-gray-800 dark:text-gray-100">Chọn khách hàng</span>
                </div>
                <button id="cb-picker-close" type="button"
                    class="w-7 h-7 flex items-center justify-center rounded-full
                    bg-gray-100 dark:bg-slate-800 text-gray-500
                    hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                    <span class="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>

            <div class="px-3 pb-2 shrink-0">
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2
                        text-gray-400 text-[18px] pointer-events-none">search</span>
                    <input id="cb-picker-search" type="text" autocomplete="off"
                        placeholder="Tìm theo tên, SĐT, email..."
                        class="w-full pl-9 pr-3 py-2 text-sm
                        bg-gray-50 dark:bg-slate-800
                        border border-gray-200 dark:border-slate-700 rounded-xl
                        outline-none focus:border-indigo-400 dark:focus:border-indigo-500
                        transition-colors">
                </div>
            </div>

            <p id="cb-picker-counter" class="px-4 text-[11px] text-gray-400 mb-1 shrink-0"></p>

            <div id="cb-picker-list" class="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5"
                style="max-height:300px; scrollbar-width:thin;"></div>
        `;

        document.body.appendChild(el);

        el.querySelector('#cb-picker-close')
            .addEventListener('click', _close);

        el.querySelector('#cb-picker-search')
            .addEventListener('input', function () {
                const list = el.querySelector('#cb-picker-list');
                _renderList(list, this.value);
                _updateCounter(el);
            });

        el.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); _close(); }
        });

        return el;
    }

    /* ── Mở dropdown, căn chỉnh vị trí theo anchor ── */
    function _open(anchor) {
        const picker = _getOrCreate();
        const list = picker.querySelector('#cb-picker-list');
        const search = picker.querySelector('#cb-picker-search');

        if (search) search.value = '';
        _renderList(list, '');
        _updateCounter(picker);

        const rect = anchor.getBoundingClientRect();
        const estH = Math.min(420, 120 + _cache.length * 56);
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;

        const top = (spaceBelow >= estH || spaceBelow >= spaceAbove)
            ? rect.bottom + 6
            : rect.top - Math.min(estH, spaceAbove) - 6;
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - 352));

        picker.style.top = `${top}px`;
        picker.style.left = `${left}px`;

        picker.classList.remove('hidden');
        requestAnimationFrame(() => {
            picker.style.opacity = '1';
            picker.style.transform = 'scale(1)';
        });

        setTimeout(() => search?.focus(), 80);
    }

    function _close() {
        const picker = document.getElementById(PICKER_ID);
        if (!picker) return;
        picker.style.opacity = '0';
        picker.style.transform = 'scale(0.95)';
        setTimeout(() => picker.classList.add('hidden'), 180);
    }

    /* ── Click ngoài → đóng ── */
    document.addEventListener('pointerdown', e => {
        const picker = document.getElementById(PICKER_ID);
        if (!picker || picker.classList.contains('hidden')) return;
        if (!picker.contains(e.target)) _close();
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') _close();
    });

    /* ── Override cbFillDefaultB (nút "Lấy từ khách hàng" trong Step 3) ── */
    window.cbFillDefaultB = function () {
        const btn = document.querySelector('#cb-tab-2 button[onclick*="cbFillDefaultB"]');
        const picker = document.getElementById(PICKER_ID);
        const isOpen = picker && !picker.classList.contains('hidden')
            && picker.style.opacity !== '0';

        if (isOpen) { _close(); return; }
        _open(btn || document.body);
    };

    console.log('[cb-customer-picker] ✅ v1.1 loaded — renderCustomers hooked.');

})();