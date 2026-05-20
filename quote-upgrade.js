/* ================================================================
   QUOTE UPGRADE MODULE  —  quote-upgrade.js  v2.1
   CRM NeoWave

   TÍCH HỢP — thêm 1 dòng vào index.html, SAU app.js:
     <script type="module" src="quote-upgrade.js"></script>

   THAY ĐỔI v2.1 (so với v2.0):
   ─────────────────────────────────────────────────────────────
   - Panel khách hàng mới, zoom bar, sig-block đã có trong HTML
     → xóa hàm inject DOM (giảm race condition)
   - Thêm Firestore subscription cho services → luôn có `desc`
     dù app.js không expose window.servicesData với desc
   - _overrideNavigate() chỉ cần sync sig form
   - Zoom: 30%–200%, reset sau mỗi lần tạo báo giá
   - Giữ trạng thái tick khi services list re-render
   ================================================================ */

import { getApp }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import { getFirestore, doc, getDoc, setDoc, collection, onSnapshot }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Firebase refs ─────────────────────────────────────────────────
const _db = getFirestore(getApp());
const _appId = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';

const sigRef = () => doc(_db, 'artifacts', _appId, 'public', 'data', 'system_settings', 'signature');
const srvCol = () => collection(_db, 'artifacts', _appId, 'public', 'data', 'services');

// ── Module state ──────────────────────────────────────────────────
window._sysSignature = { image: '', name: '' };
let _quoteZoom = 1;
let _servicesCache = [];   // services với desc từ Firestore

const el = id => document.getElementById(id);
const toast = (msg, type = 'success') => window.showToast?.(msg, type);


/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
_initServicesCache();
_setupCustomerPanelToggle();
_overrideNavigate();
_overrideGenerateQuote();
_watchCustomerSelect();
_watchServicesList();
_setupSigFileInput();
_loadSignatureWhenReady();


/* ════════════════════════════════════════════════════════════════
   1. FIRESTORE SERVICES CACHE
      Subscribe trực tiếp để luôn có desc
   ════════════════════════════════════════════════════════════════ */
function _initServicesCache() {
    try {
        onSnapshot(srvCol(), snap => {
            _servicesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Re-enhance nếu list đã render rồi
            const container = el('quote-services-list');
            if (container && container.querySelector('label')) {
                _enhanceServicesList(container);
            }
        }, err => console.warn('[quote-upgrade] services snapshot error:', err));
    } catch (e) {
        console.warn('[quote-upgrade] initServicesCache failed:', e);
    }
}


/* ════════════════════════════════════════════════════════════════
   2. TOGGLE PANEL "KHÁCH HÀNG MỚI"
      Panel HTML đã có sẵn trong index.html (#new-customer-panel)
   ════════════════════════════════════════════════════════════════ */
function _setupCustomerPanelToggle() {
    const attach = () => {
        const sel = el('quote-customer');
        if (!sel) { setTimeout(attach, 150); return; }
        if (sel.dataset.qupgradePanel) return;
        sel.dataset.qupgradePanel = '1';

        sel.addEventListener('change', function () {
            const panel = el('new-customer-panel');
            if (!panel) return;
            const show = this.value === 'new';
            panel.classList.toggle('hidden', !show);
            if (show) {
                setTimeout(() => el('new-cus-name')?.focus(), 80);
            } else {
                ['new-cus-name', 'new-cus-phone', 'new-cus-email']
                    .forEach(id => { if (el(id)) el(id).value = ''; });
            }
        });
    };
    attach();
}


/* ════════════════════════════════════════════════════════════════
   3. FILE INPUT CHỮ KÝ
      Element sys-sig-file-input đã có trong HTML
   ════════════════════════════════════════════════════════════════ */
function _setupSigFileInput() {
    const attach = () => {
        const fileInput = el('sys-sig-file-input');
        if (!fileInput) { setTimeout(attach, 200); return; }
        if (fileInput.dataset.qupgradeSig) return;
        fileInput.dataset.qupgradeSig = '1';

        fileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 1_048_576) {
                toast('Ảnh chữ ký tối đa 1MB', 'error');
                this.value = '';
                return;
            }
            const r = new FileReader();
            r.onload = ev => {
                if (el('sys-sig-cache')) el('sys-sig-cache').value = ev.target.result;
                _applySigPreview(ev.target.result);
            };
            r.readAsDataURL(file);
        });
    };
    attach();
}


/* ════════════════════════════════════════════════════════════════
   4. HOOK window.navigate
   ════════════════════════════════════════════════════════════════ */
function _overrideNavigate() {
    const tryHook = () => {
        if (typeof window.navigate !== 'function') { setTimeout(tryHook, 100); return; }
        if (window.navigate._qupgrade) return;

        const orig = window.navigate;
        window.navigate = function (target) {
            orig(target);
            if (target === 'settings') _syncSigFormFromCache();
        };
        window.navigate._qupgrade = true;
    };
    tryHook();
}


/* ════════════════════════════════════════════════════════════════
   5. MUTATIONOBSERVER: #quote-customer
      Thêm option "Khách hàng mới" mỗi khi app.js re-render select
   ════════════════════════════════════════════════════════════════ */
function _watchCustomerSelect() {
    const sel = el('quote-customer');
    if (!sel) return;

    const addNewOpt = () => {
        if (sel.querySelector('option[value="new"]')) return;
        // Dùng select.add(option, index) thay vì insertBefore
        // để tránh lỗi khi options nằm trong <optgroup> (không phải direct child)
        sel.add(new Option('➕ Khách hàng mới…', 'new'), 1);
    };

    addNewOpt();
    new MutationObserver(addNewOpt).observe(sel, { childList: true });
}


/* ════════════════════════════════════════════════════════════════
   6. MUTATIONOBSERVER: #quote-services-list
      Nâng cấp render: thêm toggle "Kèm mô tả dịch vụ"
   ════════════════════════════════════════════════════════════════ */
function _watchServicesList() {
    const container = el('quote-services-list');
    if (!container) return;

    const tryEnhance = () => {
        if (container.querySelector('label') && !container.querySelector('[data-qid]')) {
            _enhanceServicesList(container);
        }
    };

    tryEnhance();
    new MutationObserver(tryEnhance).observe(container, { childList: true });
}

function _enhanceServicesList(container) {
    const services = _servicesCache.length
        ? _servicesCache
        : _parseServicesFromDOM(container);
    if (!services.length) return;

    // Giữ lại trạng thái tick trước khi rewrite
    const checkedSrv = new Set([...container.querySelectorAll('.quote-srv-cb:checked')].map(c => c.value));
    const checkedDesc = new Set([...container.querySelectorAll('.quote-desc-cb:checked')].map(c => c.dataset.for));

    container.innerHTML = services.map(srv => {
        const price = Number(srv.price) || 0;
        const safeDesc = (srv.desc || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const hasDesc = safeDesc.trim().length > 0;
        const fmtPrice = window.formatCurrency
            ? window.formatCurrency(price)
            : price.toLocaleString('vi-VN') + ' đ';

        const isSrvChecked = checkedSrv.has(srv.id) ? 'checked' : '';
        // Mặc định desc checked nếu chưa từng thay đổi (checkedDesc rỗng) hoặc đã checked
        const isDescChecked = (!checkedDesc.size || checkedDesc.has(srv.id)) ? 'checked' : '';

        return `
        <div data-qid="${srv.id}"
             class="rounded-lg overflow-hidden border-b border-gray-100 dark:border-slate-700/50 last:border-0">
            <label class="flex items-center gap-3 p-2.5 cursor-pointer
                          hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors">
                <input type="checkbox"
                    class="quote-srv-cb form-checkbox h-5 w-5 lg:h-4 lg:w-4 text-primary rounded shrink-0"
                    value="${srv.id}"
                    data-name="${(srv.name || '').replace(/"/g, '&quot;')}"
                    data-price="${price}"
                    data-desc="${safeDesc}"
                    onchange="_srvToggle(this)"
                    ${isSrvChecked}>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold truncate">${srv.name || ''}</div>
                    <div class="text-xs text-gray-500">${fmtPrice}</div>
                </div>
            </label>
            ${hasDesc ? `
            <div class="desc-row ${isSrvChecked ? '' : 'hidden'} px-3 pb-2.5 pt-0">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox"
                        class="quote-desc-cb form-checkbox h-3.5 w-3.5 text-primary rounded"
                        data-for="${srv.id}" ${isDescChecked}>
                    <span class="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[13px]">description</span>
                        Kèm mô tả dịch vụ
                    </span>
                </label>
                <p class="mt-1 text-[11px] text-gray-400 italic leading-snug line-clamp-2 pl-5">${srv.desc}</p>
            </div>` : ''}
        </div>`;
    }).join('');
}

function _parseServicesFromDOM(container) {
    return [...container.querySelectorAll('input[type=checkbox]')].map(cb => ({
        id: cb.value,
        name: cb.dataset.name || '',
        price: Number(cb.dataset.price) || 0,
        desc: cb.dataset.desc || '',
    }));
}

window._srvToggle = function (cb) {
    cb.closest('[data-qid]')?.querySelector('.desc-row')
        ?.classList.toggle('hidden', !cb.checked);
};


/* ════════════════════════════════════════════════════════════════
   7. GENERATE STANDARD QUOTE (override hoàn toàn)
   ════════════════════════════════════════════════════════════════ */
function _overrideGenerateQuote() {
    window.generateStandardQuote = () => {

        /* ── Khách hàng ── */
        const selEl = el('quote-customer');
        const selId = selEl?.value;
        let target = null;

        if (selId === 'new') {
            const name = el('new-cus-name')?.value.trim();
            const phone = el('new-cus-phone')?.value.trim();
            const email = el('new-cus-email')?.value.trim();
            if (!name) return toast('Vui lòng nhập họ và tên khách hàng mới', 'error');
            target = { name, phone: phone || '', email: email || '', isNew: true };

        } else if (selId) {
            if (selId.startsWith('cus_')) {
                const id = selId.slice(4);
                target = (window.customersData || []).find(c => c.id === id) || null;
            }
            if (!target) {
                const optText = selEl.options[selEl.selectedIndex]?.text || '';
                const dash = optText.lastIndexOf(' - ');
                target = {
                    name: dash > -1 ? optText.slice(0, dash) : optText,
                    phone: dash > -1 ? optText.slice(dash + 3) : '',
                    email: '',
                };
            }
        }

        if (!target) return toast('Vui lòng chọn hoặc nhập thông tin khách hàng', 'error');

        /* ── Dịch vụ ── */
        const checks = [...document.querySelectorAll('.quote-srv-cb:checked')];
        if (!checks.length) return toast('Vui lòng chọn ít nhất một dịch vụ', 'error');

        const vatPct = Number(el('quote-vat')?.value) || 0;
        let subtotal = 0, rowsHtml = '';

        checks.forEach((cb, i) => {
            const price = Number(cb.dataset.price) || 0;
            subtotal += price;
            const descCb = document.querySelector(`.quote-desc-cb[data-for="${cb.value}"]`);
            const withDesc = descCb?.checked ?? true;
            const rawDesc = (cb.dataset.desc || '')
                .replace(/&quot;/g, '"').replace(/&lt;/g, '<');
            const cell = (withDesc && rawDesc)
                ? `${cb.dataset.name}<br><span style="font-size:11px;color:#888;font-style:italic;">${rawDesc}</span>`
                : cb.dataset.name;

            rowsHtml += `
                <tr>
                    <td style="border:1px solid #cbd5e1;padding:7px 10px;text-align:center;">${i + 1}</td>
                    <td style="border:1px solid #cbd5e1;padding:7px 10px;">${cell}</td>
                    
                </tr>`;
        });

        const vatAmt = subtotal * (vatPct / 100);
        const total = subtotal + vatAmt;
        const fmt = n => n.toLocaleString('vi-VN');

        /* ── Chữ ký công ty từ Cài đặt hệ thống ── */
        const sig = window._sysSignature || {};
        const sigName = sig.name || '................................';
        const sigW = sig.size || 130;
        const sigH = Math.round(sigW * (60 / 130));
        const sigImg = sig.image
            ? `<img src="${sig.image}" style="width:${sigW}px;height:${sigH}px;object-fit:contain;display:block;margin:6px auto 2px;">`
            : `<div style="height:${sigH}px;border-bottom:1px solid #cbd5e1;margin:8px 20px 0;"></div>`;

        const cusName = target.name || '................................';
        const cusNewTag = target.isNew
            ? ' <em style="color:#6366f1;font-size:11px;">(Khách hàng mới)</em>'
            : '';

        el('document-preview-area').innerHTML = `
<div style="text-align:center;margin-bottom:28px;border-bottom:2px solid #1e293b;padding-bottom:16px;">
    <h1 style="font-size:20px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px;">
        BÁO GIÁ DỊCH VỤ
    </h1>
    <p style="color:#64748b;font-size:13px;margin:0;">Ngày: ${new Date().toLocaleDateString('vi-VN')}</p>
</div>

<div style="margin-bottom:20px;line-height:2;font-size:13px;">
    <p><strong>Kính gửi:</strong> ${cusName}${cusNewTag}</p>
    ${target.phone ? `<p><strong>Điện thoại:</strong> ${target.phone}</p>` : ''}
    ${target.email ? `<p><strong>Email:</strong> ${target.email}</p>` : ''}
</div>

<p style="margin-bottom:12px;font-size:13px;">
    Chúng tôi hân hạnh gửi tới Quý khách hàng bảng báo giá chi tiết:
</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
    <thead>
        <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1;padding:8px;width:40px;text-align:center;">STT</th>
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left;">Nội dung dịch vụ</th>
            
        </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-bottom:36px;">
    <div style="min-width:230px;text-align:right;font-size:13px;line-height:2.2;">
        <p>Cộng tiền hàng: <strong>${fmt(subtotal)} đ</strong></p>
        <p>Thuế VAT (${vatPct}%): <strong>${fmt(vatAmt)} đ</strong></p>
        <div style="border-top:1.5px solid #1e293b;padding-top:6px;margin-top:4px;">
            <p style="font-size:15px;margin:0;">Tổng cộng:
                <strong style="color:#dc2626;">${fmt(total)} đ</strong>
            </p>
        </div>
    </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;text-align:center;margin-top:40px;font-size:13px;">
    <div>
        <strong>ĐẠI DIỆN KHÁCH HÀNG</strong>
        <p style="font-size:11px;color:#94a3b8;margin:4px 0 0;font-style:italic;">(Ký, ghi rõ họ tên)</p>
        <div style="height:60px;border-bottom:1px solid #cbd5e1;margin:8px 20px 0;"></div>
        <p style="padding-top:6px;margin:0;">${cusName}</p>
    </div>
    <div>
        <strong>ĐẠI DIỆN CÔNG TY</strong>
        <p style="font-size:11px;color:#94a3b8;margin:4px 0 0;font-style:italic;">(Ký, đóng dấu)</p>
        ${sigImg}
        <p style="border-top:1px solid #cbd5e1;padding-top:6px;margin:0;">${sigName}</p>
    </div>
</div>`;

        /* Reset zoom sau mỗi lần tạo mới */
        quoteZoomReset();
    };
}


/* ════════════════════════════════════════════════════════════════
   8. ZOOM CONTROLS  (phạm vi 30%–200%)
      Buttons đã có trong HTML (#quote-zoom-bar)
   ════════════════════════════════════════════════════════════════ */
window.quoteZoomIn = () => {
    _quoteZoom = Math.min(+(_quoteZoom + 0.1).toFixed(1), 2.0);
    _applyZoom();
};
window.quoteZoomOut = () => {
    _quoteZoom = Math.max(+(_quoteZoom - 0.1).toFixed(1), 0.3);
    _applyZoom();
};
window.quoteZoomReset = () => {
    _quoteZoom = 1.0;
    _applyZoom();
};

function _applyZoom() {
    const docEl = el('document-preview-area');
    if (docEl) docEl.style.transform = `scale(${_quoteZoom})`;
    const lbl = el('quote-zoom-label');
    if (lbl) lbl.textContent = Math.round(_quoteZoom * 100) + '%';
}


/* ════════════════════════════════════════════════════════════════
   9. SYSTEM SIGNATURE — Lưu / Tải / Xóa
      Elements (sys-sig-*) đã có trong index.html
   ════════════════════════════════════════════════════════════════ */
window.saveSystemSignature = async () => {
    const name = el('sys-sig-name')?.value.trim() || '';
    const image = el('sys-sig-cache')?.value || '';
    const size = Number(el('sys-sig-size')?.value) || 130;

    const btn = el('btn-save-sig');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Đang lưu…';
    }
    try {
        await setDoc(sigRef(), { sigName: name, sigImage: image, sigSize: size, updatedAt: new Date() }, { merge: true });
        window._sysSignature = { name, image, size };
        toast('Đã lưu chữ ký & tên đại diện');
    } catch (e) {
        toast('Lỗi lưu: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined text-sm">save</span> Lưu Cài Đặt Chữ Ký';
        }
    }
};

window.clearSysSignature = () => {
    if (el('sys-sig-cache')) el('sys-sig-cache').value = '';
    if (el('sys-sig-file-input')) el('sys-sig-file-input').value = '';
    _applySigPreview('');
    toast('Đã xóa ảnh (chưa lưu)', 'info');
};

function _applySigPreview(src) {
    const img = el('sys-sig-preview');
    const ph = el('sys-sig-placeholder');
    if (!img || !ph) return;
    if (src) {
        img.src = src; img.classList.remove('hidden'); ph.classList.add('hidden');
    } else {
        img.src = ''; img.classList.add('hidden'); ph.classList.remove('hidden');
    }
}

function _syncSigFormFromCache() {
    const sig = window._sysSignature || {};
    const nameEl = el('sys-sig-name');
    if (nameEl && !nameEl.value) nameEl.value = sig.name || '';
    if (el('sys-sig-cache')) el('sys-sig-cache').value = sig.image || '';
    _applySigPreview(sig.image || '');
}

window.loadSystemSignature = async () => {
    try {
        const snap = await getDoc(sigRef());
        if (!snap.exists()) return;
        const d = snap.data();
        window._sysSignature = { image: d.sigImage || '', name: d.sigName || '', size: d.sigSize || 130 };
        if (el('sys-sig-name')) el('sys-sig-name').value = d.sigName || '';
        const sz = d.sigSize || 130;
        if (el('sys-sig-size')) el('sys-sig-size').value = sz;
        if (el('sys-sig-size-label')) el('sys-sig-size-label').textContent = sz + 'px';
        if (el('sys-sig-cache')) el('sys-sig-cache').value = d.sigImage || '';
        _applySigPreview(d.sigImage || '');
    } catch (_) { /* lần đầu chưa có data — bình thường */ }
};

function _loadSignatureWhenReady() {
    const check = () => window.currentUser
        ? window.loadSystemSignature()
        : setTimeout(check, 400);
    check();
}

/* ════════════════════════════════════════════════════════════════
   10. SIG SIZE HELPERS
   ════════════════════════════════════════════════════════════════ */
window.sigSizePreview = function (val) {
    const v = Number(val);
    if (el('sys-sig-size-label')) el('sys-sig-size-label').textContent = v + 'px';
};
window.sigSizeStep = function (delta) {
    const slider = el('sys-sig-size');
    if (!slider) return;
    const newVal = Math.min(300, Math.max(60, Number(slider.value) + delta));
    slider.value = newVal;
    window.sigSizePreview(newVal);
};

console.log('[quote-upgrade] ✅ v2.1 loaded');
