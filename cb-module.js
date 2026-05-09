/* =============================================
   CONTRACT BUILDER ADMIN — JavaScript
   
   CHÈN VÀO: app.js
   Vị trí: Cuối file, trước dòng cuối cùng
   
   HOẶC tạo file riêng: cb-module.js
   Và thêm vào index.html:
   <script src="cb-module.js"></script>
   Trước thẻ <script type="module" src="app.js"></script>
   ============================================= */

/* ── CB STATE ── */
const cbState = {
  step: 0,
  zoom: 1,
  data: {},
  completedSteps: new Set(),
  paymentRounds: [],
  customFeatures: [],
  selectedFeatures: [],
  legalClauses: {
    termination: 'Hợp đồng có thể bị chấm dứt trước thời hạn nếu một trong hai bên vi phạm các điều khoản đã thỏa thuận. Bên vi phạm phải thông báo bằng văn bản trước ít nhất 15 ngày.',
    privacy: 'Tất cả thông tin, dữ liệu, tài liệu liên quan đến dự án được bảo mật tuyệt đối. Không bên nào được tiết lộ cho bên thứ ba khi chưa có sự đồng ý bằng văn bản.',
    ownership: 'Toàn bộ mã nguồn, thiết kế và tài nguyên kỹ thuật số được bàn giao cho Bên B sau khi thanh toán đầy đủ. Bên A không được tái sử dụng cho các dự án khác.',
    liability: 'Bên A chịu trách nhiệm về chất lượng kỹ thuật sản phẩm trong phạm vi hợp đồng. Không chịu trách nhiệm về thiệt hại gián tiếp từ việc sử dụng sản phẩm.',
    general: 'Hợp đồng được lập thành 02 bản có giá trị pháp lý ngang nhau, mỗi bên giữ 01 bản. Mọi tranh chấp được giải quyết theo pháp luật Việt Nam hiện hành.'
  }
};

const CB_STEPS = [
  { icon: 'description',   label: 'Thông tin hợp đồng' },
  { icon: 'business',      label: 'Thông tin bên A' },
  { icon: 'person',        label: 'Thông tin bên B' },
  { icon: 'checklist',     label: 'Phạm vi dịch vụ' },
  { icon: 'payments',      label: 'Thanh toán' },
  { icon: 'timeline',      label: 'Tiến độ thực hiện' },
  { icon: 'verified_user', label: 'Bảo hành & chỉnh sửa' },
  { icon: 'gavel',         label: 'Điều khoản pháp lý' },
  { icon: 'picture_as_pdf',label: 'Preview & Export' },
];

const CB_DEFAULT_FEATURES = [
  'Trang chủ', 'SEO cơ bản', 'Banner động', 'Popup quảng cáo',
  'Tin tức / Blog', 'Giỏ hàng nâng cao', 'Bộ lọc sản phẩm',
  'Responsive Mobile', 'SSL & Bảo mật', 'Chat Messenger / Zalo',
  'Đăng nhập / Đăng ký', 'Lịch sử đơn hàng'
];

const CB_TIMELINE_DEFAULT = [
  { days: 'Ngày 1–2', title: 'Khởi động & Phân tích', desc: 'Tiếp nhận yêu cầu, phân tích kỹ thuật, lập kế hoạch chi tiết.' },
  { days: 'Ngày 3–5', title: 'Thiết kế UI/UX', desc: 'Wireframe, mockup giao diện, chờ khách hàng duyệt.' },
  { days: 'Ngày 6',   title: 'Phát triển & Lập trình', desc: 'Code frontend, backend, tích hợp các tính năng.' },
  { days: 'Ngày 7',   title: 'Kiểm thử & Bàn giao', desc: 'Test toàn bộ chức năng, fix bug, bàn giao sản phẩm hoàn chỉnh.' },
];

const CB_LEGAL_SECTIONS = [
  { key: 'termination', label: 'Chấm dứt hợp đồng', icon: 'cancel' },
  { key: 'privacy',     label: 'Bảo mật thông tin',  icon: 'lock' },
  { key: 'ownership',   label: 'Sở hữu mã nguồn',    icon: 'code' },
  { key: 'liability',   label: 'Trách nhiệm pháp lý', icon: 'shield' },
  { key: 'general',     label: 'Điều khoản chung',    icon: 'article' },
];

/* ── INIT ── */
function cbInit() {
  cbLoadFromStorage();
  cbRenderStepsNav();
  cbRenderMobileSteps();
  cbRenderFeaturesGrid();
  cbRenderTimeline();
  cbRenderLegalAccordion();
  cbRenderPaymentRounds();
  cbGoToStep(cbState.step);
  cbRestoreFormData();
  cbUpdatePreview();
  // Set default sign date to today
  const signDateEl = document.getElementById('cb-sign-date');
  if (signDateEl && !signDateEl.value) signDateEl.value = new Date().toISOString().split('T')[0];
}

/* ── STEP NAVIGATION ── */
window.cbGoToStep = function(idx) {
  if (idx < 0 || idx > 8) return;
  // Mark previous step as completed if moving forward
  if (idx > cbState.step) cbState.completedSteps.add(cbState.step);
  cbState.step = idx;

  // Show/hide tabs
  document.querySelectorAll('.cb-tab').forEach((el, i) => {
    el.classList.toggle('hidden', i !== idx);
  });

  // Step 8: remove max-width constraint so preview fills available width
  const formInner = document.getElementById('cb-form-inner');
  if (formInner) {
    if (idx === 8) {
      formInner.classList.remove('max-w-2xl', 'mx-auto');
      formInner.classList.add('max-w-none', 'p-0', 'lg:p-0');
      // Trigger preview render when arriving at step 8
      if (typeof cbUpdatePreview === 'function') cbUpdatePreview();
    } else {
      formInner.classList.remove('max-w-none', 'p-0', 'lg:p-0');
      formInner.classList.add('max-w-2xl', 'mx-auto');
    }
  }

  // Update sidebar wizard
  cbRenderStepsNav();
  cbRenderMobileSteps();

  // Update navigation buttons
  const prevBtn = document.getElementById('cb-btn-prev');
  const nextBtn = document.getElementById('cb-btn-next');
  if (prevBtn) prevBtn.disabled = (idx === 0);
  if (nextBtn) {
    nextBtn.innerHTML = idx === 8
      ? '<span class="material-symbols-outlined text-[18px]">picture_as_pdf</span> Xuất'
      : 'Tiếp <span class="material-symbols-outlined text-[18px]">arrow_forward</span>';
  }

  const stepLabel = document.getElementById('cb-current-step-label');
  if (stepLabel) stepLabel.textContent = idx + 1;

  // Update progress
  const pct = Math.round(((idx + 1) / 9) * 100);
  ['cb-progress-bar', 'cb-wizard-progress'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = pct + '%';
  });
  ['cb-progress-pct', 'cb-wizard-pct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = pct + '%';
  });
  const wl = document.getElementById('cb-wizard-pct-label');
  if (wl) wl.textContent = `${idx + 1}/9 bước`;

  cbAutoSave();
};

window.cbNextStep = function() { cbGoToStep(cbState.step + 1); };
window.cbPrevStep = function() { cbGoToStep(cbState.step - 1); };

/* ── RENDER STEPS NAV ── */
function cbRenderStepsNav() {
  const nav = document.getElementById('cb-steps-nav');
  if (!nav) return;
  nav.innerHTML = '';
  CB_STEPS.forEach((step, i) => {
    const isActive = i === cbState.step;
    const isCompleted = cbState.completedSteps.has(i);
    const stateClass = isActive ? 'cb-step-active' : isCompleted ? 'cb-step-completed' : '';

    const iconContent = isCompleted
      ? '<span class="material-symbols-outlined text-[16px]">check</span>'
      : `<span class="material-symbols-outlined text-[16px]">${step.icon}</span>`;

    const item = document.createElement('div');
    item.className = `cb-step-item ${stateClass}`;
    item.onclick = () => cbGoToStep(i);
    item.innerHTML = `
      <div class="cb-step-icon">${iconContent}</div>
      <span class="cb-step-label">${step.label}</span>
      ${isActive ? '<span class="material-symbols-outlined text-[14px] text-indigo-400">chevron_right</span>' : ''}
    `;
    nav.appendChild(item);

    // Connector between steps
    if (i < CB_STEPS.length - 1) {
      const conn = document.createElement('div');
      conn.className = `cb-step-connector ${isCompleted ? 'completed' : ''}`;
      nav.appendChild(conn);
    }
  });
}

/* ── RENDER MOBILE STEP CHIPS ── */
function cbRenderMobileSteps() {
  const el = document.getElementById('cb-mobile-steps');
  if (!el) return;
  el.innerHTML = '';
  CB_STEPS.forEach((step, i) => {
    const isActive = i === cbState.step;
    const isCompleted = cbState.completedSteps.has(i);
    const chip = document.createElement('button');
    chip.className = `cb-mobile-step-chip ${isActive ? 'active' : isCompleted ? 'completed' : ''}`;
    chip.innerHTML = `<span class="material-symbols-outlined text-[13px]">${step.icon}</span>${i + 1}`;
    chip.title = step.label;
    chip.onclick = () => cbGoToStep(i);
    el.appendChild(chip);
  });
}

/* ── RENDER FEATURES GRID ── */
function cbRenderFeaturesGrid() {
  const grid = document.getElementById('cb-features-grid');
  if (!grid) return;
  grid.innerHTML = '';
  CB_DEFAULT_FEATURES.forEach((feat, i) => {
    const isSelected = cbState.selectedFeatures.includes(feat);
    const card = document.createElement('label');
    card.className = `cb-feature-card ${isSelected ? 'selected' : ''}`;
    card.innerHTML = `
      <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="cbToggleFeature('${feat}', this.checked)">
      <span class="material-symbols-outlined text-[16px] text-indigo-400">check_box${isSelected ? '' : '_outline_blank'}</span>
      <span class="cb-feature-card-label">${feat}</span>
    `;
    // Update icon on change
    const chk = card.querySelector('input');
    chk.addEventListener('change', function() {
      const icon = card.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = this.checked ? 'check_box' : 'check_box_outline_blank';
      card.classList.toggle('selected', this.checked);
    });
    grid.appendChild(card);
  });
  cbUpdateFeaturesCount();
}

window.cbToggleFeature = function(feat, checked) {
  if (checked && !cbState.selectedFeatures.includes(feat)) {
    cbState.selectedFeatures.push(feat);
  } else if (!checked) {
    cbState.selectedFeatures = cbState.selectedFeatures.filter(f => f !== feat);
  }
  cbUpdateFeaturesCount();
  cbRenderSelectedFeaturesList();
  cbAutoSave();
  cbUpdatePreview();
};

function cbUpdateFeaturesCount() {
  const total = cbState.selectedFeatures.length + cbState.customFeatures.filter(f => f.enabled).length;
  const el = document.getElementById('cb-features-count');
  if (el) el.textContent = `${total} tính năng`;
}

function cbRenderSelectedFeaturesList() {
  const section = document.getElementById('cb-selected-features-section');
  const list = document.getElementById('cb-selected-features-list');
  if (!list) return;

  const allFeats = [
    ...cbState.selectedFeatures,
    ...cbState.customFeatures.filter(f => f.enabled).map(f => f.text)
  ];

  section.classList.toggle('hidden', allFeats.length === 0);
  list.innerHTML = '';
  allFeats.forEach((feat, i) => {
    const item = document.createElement('div');
    item.className = 'cb-sortable-item';
    item.setAttribute('draggable', 'true');
    item.dataset.index = i;
    item.innerHTML = `
      <span class="material-symbols-outlined drag-handle text-[18px]">drag_indicator</span>
      <span class="flex-1 text-[12px] font-semibold">${i + 1}. ${feat}</span>
      <span class="text-[11px] text-indigo-500 font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30">#${String(i + 1).padStart(2, '0')}</span>
    `;
    list.appendChild(item);
  });
  cbSetupDragSort(list, allFeats);
}

/* Basic drag-to-reorder */
function cbSetupDragSort(list, arr) {
  let dragIdx = null;
  list.querySelectorAll('.cb-sortable-item').forEach((item, i) => {
    item.addEventListener('dragstart', () => { dragIdx = i; item.style.opacity = '0.4'; });
    item.addEventListener('dragend', () => { item.style.opacity = '1'; });
    item.addEventListener('dragover', e => { e.preventDefault(); item.style.background = 'rgba(99,102,241,0.05)'; });
    item.addEventListener('dragleave', () => { item.style.background = ''; });
    item.addEventListener('drop', (e) => {
      e.preventDefault(); item.style.background = '';
      if (dragIdx === null || dragIdx === i) return;
      // Reorder
      const moved = arr.splice(dragIdx, 1)[0];
      arr.splice(i, 0, moved);
      // Split back
      cbState.selectedFeatures = arr.filter(f => CB_DEFAULT_FEATURES.includes(f) || !cbState.customFeatures.some(cf => cf.text === f));
      cbRenderSelectedFeaturesList();
      cbUpdatePreview();
    });
  });
}

/* ── CUSTOM FEATURES ── */
window.cbAddCustomFeature = function() {
  const id = Date.now();
  cbState.customFeatures.push({ id, text: '', enabled: true });
  cbRenderCustomFeatures();
};

function cbRenderCustomFeatures() {
  const container = document.getElementById('cb-custom-features');
  if (!container) return;
  container.innerHTML = '';
  cbState.customFeatures.forEach((feat, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 animate-[cbFadeSlide_0.2s_ease]';
    row.innerHTML = `
      <label class="cb-toggle" style="transform:scale(0.85)">
        <input type="checkbox" ${feat.enabled ? 'checked' : ''} onchange="cbToggleCustomFeatureEnabled(${i}, this.checked)">
        <span class="cb-toggle-slider"></span>
      </label>
      <input type="text" value="${feat.text}" placeholder="Tên tính năng..." class="cb-input flex-1" style="padding:8px 12px; font-size:12px"
        oninput="cbUpdateCustomFeature(${i}, this.value)">
      <button onclick="cbRemoveCustomFeature(${i})" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    `;
    container.appendChild(row);
  });
}

window.cbUpdateCustomFeature = function(idx, val) {
  cbState.customFeatures[idx].text = val;
  cbRenderSelectedFeaturesList();
  cbAutoSave();
  cbUpdatePreview();
};
window.cbToggleCustomFeatureEnabled = function(idx, checked) {
  cbState.customFeatures[idx].enabled = checked;
  cbUpdateFeaturesCount();
  cbRenderSelectedFeaturesList();
  cbAutoSave();
  cbUpdatePreview();
};
window.cbRemoveCustomFeature = function(idx) {
  cbState.customFeatures.splice(idx, 1);
  cbRenderCustomFeatures();
  cbUpdateFeaturesCount();
  cbRenderSelectedFeaturesList();
  cbAutoSave();
  cbUpdatePreview();
};

/* ── PAYMENT ── */
function cbRenderPaymentRounds() {
  if (cbState.paymentRounds.length === 0) {
    cbState.paymentRounds = [
      { label: 'Đợt 1: Ký hợp đồng', pct: 50 },
      { label: 'Đợt 2: Bàn giao sản phẩm', pct: 50 },
    ];
  }
  cbRefreshPaymentRounds();
}

function cbRefreshPaymentRounds() {
  const container = document.getElementById('cb-payment-rounds');
  if (!container) return;
  container.innerHTML = '';
  cbState.paymentRounds.forEach((round, i) => {
    const row = document.createElement('div');
    row.className = 'cb-payment-row';
    row.innerHTML = `
      <span class="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 text-[11px] font-black flex items-center justify-center flex-shrink-0">${i + 1}</span>
      <input type="text" value="${round.label}" placeholder="Tên đợt thanh toán..." class="flex-1 text-[12px]" oninput="cbUpdatePaymentRound(${i}, 'label', this.value)" style="min-width:0">
      <div class="flex items-center gap-1 flex-shrink-0">
        <input type="number" value="${round.pct}" min="0" max="100" class="w-14 text-center text-[13px] font-bold border border-gray-200 dark:border-slate-600 rounded-lg px-1 py-1 bg-transparent" oninput="cbUpdatePaymentRound(${i}, 'pct', +this.value)">
        <span class="text-[11px] font-bold text-gray-500">%</span>
      </div>
      <button onclick="cbRemovePaymentRound(${i})" class="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
        <span class="material-symbols-outlined text-[16px]">remove_circle</span>
      </button>
    `;
    container.appendChild(row);
  });
  cbUpdatePaymentSummary();
}

window.cbAddPaymentRound = function() {
  cbState.paymentRounds.push({ label: `Đợt ${cbState.paymentRounds.length + 1}`, pct: 0 });
  cbRefreshPaymentRounds();
  cbAutoSave();
};
window.cbRemovePaymentRound = function(idx) {
  cbState.paymentRounds.splice(idx, 1);
  cbRefreshPaymentRounds();
  cbAutoSave();
  cbUpdatePreview();
};
window.cbUpdatePaymentRound = function(idx, field, val) {
  cbState.paymentRounds[idx][field] = val;
  cbUpdatePaymentSummary();
  cbAutoSave();
  cbUpdatePreview();
};
window.cbRecalcPayment = function() { cbUpdatePaymentSummary(); cbUpdatePreview(); cbAutoSave(); };

function cbUpdatePaymentSummary() {
  const total = parseFloat(document.getElementById('cb-total-value')?.value || 0);
  const hosting = parseFloat(document.getElementById('cb-hosting-fee')?.value || 0);
  const domain = parseFloat(document.getElementById('cb-domain-fee')?.value || 0);
  const vatPct = parseFloat(document.getElementById('cb-vat')?.value || 0);

  const extra = hosting + domain;
  const vat = (total * vatPct) / 100;
  const grandTotal = total + extra + vat;

  const fmt = n => n ? new Intl.NumberFormat('vi-VN').format(n) + 'đ' : '–';
  const el = id => document.getElementById(id);

  if (el('cb-sum-service')) el('cb-sum-service').textContent = fmt(total);
  if (el('cb-sum-extra')) el('cb-sum-extra').textContent = fmt(extra);
  if (el('cb-sum-vat')) el('cb-sum-vat').textContent = fmt(vat);
  if (el('cb-sum-total')) el('cb-sum-total').textContent = fmt(grandTotal);

  // Payment progress
  const totalPct = cbState.paymentRounds.reduce((s, r) => s + (+r.pct || 0), 0);
  const bar = el('cb-payment-progress');
  const lbl = el('cb-payment-pct-label');
  const warn = el('cb-payment-warning');
  if (bar) bar.style.width = Math.min(totalPct, 100) + '%';
  if (lbl) lbl.textContent = totalPct + '%';
  if (warn) warn.classList.toggle('hidden', totalPct === 100 || cbState.paymentRounds.length === 0);
}

/* ── TIMELINE ── */
function cbRenderTimeline() {
  const container = document.getElementById('cb-timeline');
  if (!container) return;
  container.innerHTML = '';
  CB_TIMELINE_DEFAULT.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'cb-timeline-item';
    el.innerHTML = `
      <div class="cb-timeline-dot-wrap">
        <div class="cb-timeline-dot">${i + 1}</div>
        ${i < CB_TIMELINE_DEFAULT.length - 1 ? '<div class="cb-timeline-line"></div>' : ''}
      </div>
      <div class="cb-timeline-content">
        <div class="flex items-start justify-between gap-2 mb-1">
          <div>
            <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">${item.days}</span>
            <h4 class="cb-timeline-title">${item.title}</h4>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 shrink-0">Đang lên kế hoạch</span>
        </div>
        <p class="cb-timeline-desc">${item.desc}</p>
        <textarea rows="2" placeholder="Ghi chú thêm..." class="cb-input resize-none text-[11px] mt-2" style="padding:6px 10px;"
          oninput="cbAutoSave()" id="cb-timeline-note-${i}"></textarea>
      </div>
    `;
    container.appendChild(el);
  });
}

/* ── LEGAL ACCORDION ── */
function cbRenderLegalAccordion() {
  const container = document.getElementById('cb-legal-accordion');
  if (!container) return;
  container.innerHTML = '';
  CB_LEGAL_SECTIONS.forEach((sec, i) => {
    const item = document.createElement('div');
    item.className = `cb-accordion-item${i === 0 ? ' open' : ''}`;
    item.innerHTML = `
      <div class="cb-accordion-header" onclick="cbToggleAccordion(this)">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[18px] text-indigo-400">${sec.icon}</span>
          <span>${sec.label}</span>
        </div>
        <span class="material-symbols-outlined cb-accordion-chevron text-gray-400">expand_more</span>
      </div>
      <div class="cb-accordion-body${i === 0 ? ' open' : ''}">
        <textarea rows="4" id="cb-legal-${sec.key}" oninput="cbAutoSave();cbUpdatePreview()">${cbState.legalClauses[sec.key]}</textarea>
      </div>
    `;
    container.appendChild(item);
  });
}

window.cbToggleAccordion = function(header) {
  const item = header.closest('.cb-accordion-item');
  const body = item.querySelector('.cb-accordion-body');
  const isOpen = item.classList.contains('open');
  item.classList.toggle('open', !isOpen);
  body.classList.toggle('open', !isOpen);
};

/* ── PROFILE UPDATE ── */
window.cbUpdateBProfile = function() {
  const name = document.getElementById('cb-b-name')?.value || '';
  const phone = document.getElementById('cb-b-phone')?.value || '';
  const card = document.getElementById('cb-b-profile-card');
  const avatar = document.getElementById('cb-b-avatar');
  const nameDisplay = document.getElementById('cb-b-name-display');
  const contactDisplay = document.getElementById('cb-b-contact-display');

  if (!card) return;
  if (name || phone) {
    card.classList.remove('hidden');
    if (avatar) avatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
    if (nameDisplay) nameDisplay.textContent = name || '–';
    if (contactDisplay) contactDisplay.textContent = phone || '–';
  } else {
    card.classList.add('hidden');
  }
};

window.cbFillDefaultB = function() {
  // Pull from customersData if available
  if (typeof customersData !== 'undefined' && customersData.length > 0) {
    const c = customersData[0];
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('cb-b-name', c.name);
    setVal('cb-b-phone', c.phone);
    setVal('cb-b-email', c.email);
    setVal('cb-b-address', c.address || c.company || '');
    cbUpdateBProfile();
    cbAutoSave();
    cbUpdatePreview();
    if (window.showToast) showToast('Đã điền thông tin từ danh sách khách hàng');
  } else {
    if (window.showToast) showToast('Chưa có dữ liệu khách hàng', 'info');
  }
};

window.cbFillSideA = function() {
  const user = window.currentUser;
  if (!user) return;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('cb-a-company', 'Công ty TNHH Dịch vụ số ' + (user.displayName || ''));
  setVal('cb-a-email', user.email || '');
  setVal('cb-a-rep', user.displayName || '');
  cbAutoSave();
  cbUpdatePreview();
  if (window.showToast) showToast('Đã điền thông tin Bên A từ tài khoản');
};

window.cbSaveBTemplate = function() {
  const data = cbCollectData();
  localStorage.setItem('cb-b-template', JSON.stringify({ name: data.bName, phone: data.bPhone, email: data.bEmail, address: data.bAddress, id: data.bId, bank: data.bBank }));
  if (window.showToast) showToast('Đã lưu mẫu Bên B!');
};

/* ── ZOOM ── */
/* ── ZOOM HELPER ── */
function cbApplyZoom() {
  const z = cbState.zoom;
  const doc = document.getElementById('cb-contract-doc');
  if (!doc) return;

  doc.style.transform = `scale(${z})`;
  doc.style.transformOrigin = 'top center';

  // Adjust the scaler wrapper so the scroll container reflects true visual height
  const scaler = document.getElementById('cb-preview-scaler');
  if (scaler) {
    // Natural height before any scaling (store on first call)
    if (!cbState._docNaturalH || z === 1) {
      cbState._docNaturalH = doc.offsetHeight || 1123; // ~297mm at 96dpi
    }
    const scaledH = cbState._docNaturalH * z;
    scaler.style.minHeight = (scaledH + 48) + 'px'; // 48 = py-6

    // Horizontal overflow when zoomed in: expand scaler width
    const naturalW = doc.offsetWidth || 794; // ~210mm at 96dpi
    scaler.style.minWidth = z > 1 ? (naturalW * z + 32) + 'px' : '';
  }

  // Update both label slots (desktop header + any extras)
  document.querySelectorAll('#cb-zoom-label').forEach(el => {
    el.textContent = Math.round(z * 100) + '%';
  });
}

window.cbZoom = function(delta) {
  cbState.zoom = Math.min(2, Math.max(0.4, cbState.zoom + delta));
  cbApplyZoom();
};

window.cbZoomReset = function() {
  cbState.zoom = 1;
  cbState._docNaturalH = null; // reset stored height
  cbApplyZoom();
};

/* ── AUTO SAVE ── */
let cbSaveTimer = null;
window.cbAutoSave = function() {
  const badge = document.getElementById('cb-autosave-badge');
  if (badge) {
    badge.classList.remove('hidden');
    badge.classList.add('cb-autosave-saving');
    badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">sync</span><span>Đang lưu...</span>`;
  }
  clearTimeout(cbSaveTimer);
  cbSaveTimer = setTimeout(() => {
    const data = cbCollectData();
    localStorage.setItem('cb-contract-draft', JSON.stringify({ ...data, step: cbState.step, completedSteps: [...cbState.completedSteps], paymentRounds: cbState.paymentRounds, selectedFeatures: cbState.selectedFeatures, customFeatures: cbState.customFeatures, legalClauses: cbState.legalClauses }));
    if (badge) {
      badge.classList.remove('cb-autosave-saving');
      badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">cloud_done</span><span>Đã lưu</span>`;
    }
  }, 800);
};

window.cbSaveDraft = function() {
  cbAutoSave();
  if (window.showToast) showToast('Đã lưu nháp hợp đồng!');
};

function cbLoadFromStorage() {
  try {
    const raw = localStorage.getItem('cb-contract-draft');
    if (!raw) return;
    const data = JSON.parse(raw);
    cbState.step = data.step || 0;
    cbState.completedSteps = new Set(data.completedSteps || []);
    cbState.paymentRounds = data.paymentRounds || [];
    cbState.selectedFeatures = data.selectedFeatures || [];
    cbState.customFeatures = data.customFeatures || [];
    if (data.legalClauses) cbState.legalClauses = { ...cbState.legalClauses, ...data.legalClauses };
    cbState._restoringData = data;
  } catch(e) {}
}

function cbRestoreFormData() {
  const data = cbState._restoringData;
  if (!data) return;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
  setVal('cb-contract-no', data.contractNo);
  setVal('cb-sign-date', data.signDate);
  setVal('cb-sign-place', data.signPlace);
  setVal('cb-contract-type', data.contractType);
  setVal('cb-project-code', data.projectCode);
  setVal('cb-a-company', data.aCompany);
  setVal('cb-a-address', data.aAddress);
  setVal('cb-a-email', data.aEmail);
  setVal('cb-a-phone', data.aPhone);
  setVal('cb-a-rep', data.aRep);
  setVal('cb-a-title', data.aTitle);
  setVal('cb-b-name', data.bName);
  setVal('cb-b-id', data.bId);
  setVal('cb-b-address', data.bAddress);
  setVal('cb-b-phone', data.bPhone);
  setVal('cb-b-email', data.bEmail);
  setVal('cb-b-bank', data.bBank);
  setVal('cb-total-value', data.totalValue);
  setVal('cb-hosting-fee', data.hostingFee);
  setVal('cb-domain-fee', data.domainFee);
  setVal('cb-vat', data.vat);
  setVal('cb-warranty-months', data.warrantyMonths);
  setVal('cb-warranty-edits', data.warrantyEdits);
  setVal('cb-warranty-extra', data.warrantyExtra);
  if (data.warrantyEnabled !== undefined) {
    const el = document.getElementById('cb-warranty-enabled');
    if (el) el.checked = data.warrantyEnabled;
  }
  // Legal
  CB_LEGAL_SECTIONS.forEach(sec => {
    const el = document.getElementById(`cb-legal-${sec.key}`);
    if (el && data.legalClauses?.[sec.key]) el.value = data.legalClauses[sec.key];
  });
  cbRenderFeaturesGrid();
  cbRenderCustomFeatures();
  cbRenderSelectedFeaturesList();
  cbRefreshPaymentRounds();
  cbUpdateBProfile();
  cbUpdatePaymentSummary();
  delete cbState._restoringData;
}

/* ── COLLECT DATA ── */
function cbCollectData() {
  const g = id => document.getElementById(id)?.value || '';
  const gc = id => document.getElementById(id)?.checked;
  const legalClauses = {};
  CB_LEGAL_SECTIONS.forEach(sec => { legalClauses[sec.key] = document.getElementById(`cb-legal-${sec.key}`)?.value || cbState.legalClauses[sec.key]; });

  return {
    contractNo: g('cb-contract-no'),
    signDate: g('cb-sign-date'),
    signPlace: g('cb-sign-place'),
    contractType: g('cb-contract-type'),
    projectCode: g('cb-project-code'),
    aCompany: g('cb-a-company'),
    aAddress: g('cb-a-address'),
    aEmail: g('cb-a-email'),
    aPhone: g('cb-a-phone'),
    aRep: g('cb-a-rep'),
    aTitle: g('cb-a-title'),
    bName: g('cb-b-name'),
    bId: g('cb-b-id'),
    bAddress: g('cb-b-address'),
    bPhone: g('cb-b-phone'),
    bEmail: g('cb-b-email'),
    bBank: g('cb-b-bank'),
    totalValue: g('cb-total-value'),
    hostingFee: g('cb-hosting-fee'),
    domainFee: g('cb-domain-fee'),
    vat: g('cb-vat'),
    warrantyEnabled: gc('cb-warranty-enabled'),
    warrantyMonths: g('cb-warranty-months'),
    warrantyEdits: g('cb-warranty-edits'),
    warrantyExtra: g('cb-warranty-extra'),
    legalClauses,
  };
}

/* ── LIVE PREVIEW ── */
window.cbUpdatePreview = function() {
  const d = cbCollectData();
  const features = [
    ...cbState.selectedFeatures,
    ...cbState.customFeatures.filter(f => f.enabled && f.text).map(f => f.text)
  ];

  const fmt = n => n ? new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ' : '–';
  const fmtDate = s => s ? new Date(s).toLocaleDateString('vi-VN') : '................';

  const total = parseFloat(d.totalValue || 0);
  const hosting = parseFloat(d.hostingFee || 0);
  const domain = parseFloat(d.domainFee || 0);
  const vatPct = parseFloat(d.vat || 0);
  const vat = (total * vatPct) / 100;
  const grandTotal = total + hosting + domain + vat;

  const paymentRowsHtml = cbState.paymentRounds.map((r, i) =>
    `<tr><td style="padding:4px 8px; border:1px solid #ddd">${i + 1}</td><td style="padding:4px 8px; border:1px solid #ddd">${r.label}</td><td style="padding:4px 8px; border:1px solid #ddd; text-align:center">${r.pct}%</td><td style="padding:4px 8px; border:1px solid #ddd; text-align:right">${fmt(total * r.pct / 100)}</td></tr>`
  ).join('');

  const featuresHtml = features.length > 0
    ? features.map((f, i) => `<li style="margin-bottom:3px">${i + 1}. ${f}</li>`).join('')
    : '<li>Chưa chọn tính năng nào</li>';

  const warrantyHtml = d.warrantyEnabled
    ? `<p>- Thời gian bảo hành: <strong>${d.warrantyMonths || 12} tháng</strong> kể từ ngày bàn giao.</p>
       <p>- Số lần chỉnh sửa miễn phí: <strong>${d.warrantyEdits || 3} lần</strong>.</p>
       ${d.warrantyExtra ? `<p>- Điều kiện phát sinh: ${d.warrantyExtra}</p>` : ''}`
    : '<p>Không áp dụng bảo hành theo hợp đồng này.</p>';

  const legalHtml = CB_LEGAL_SECTIONS.map(sec => {
    const text = document.getElementById(`cb-legal-${sec.key}`)?.value || cbState.legalClauses[sec.key] || '';
    return `<h3 style="font-weight:700; margin:12px 0 4px; font-size:12px">${sec.label.toUpperCase()}</h3><p>${text}</p>`;
  }).join('');

  const html = `
    <div class="cb-watermark"><span>DRAFT</span></div>
    <div style="position:relative; z-index:1;">
      <h1 style="font-size:15px; text-align:center; text-transform:uppercase; font-weight:900; letter-spacing:1.5px; margin-bottom:4px">
        ${d.contractType || 'HỢP ĐỒNG DỊCH VỤ'}
      </h1>
      <p style="text-align:center; font-size:11px; margin-bottom:2px">Số: <strong>${d.contractNo || '...........'}</strong></p>
      <p style="text-align:center; font-size:11px; margin-bottom:16px">Ngày ký: <strong>${fmtDate(d.signDate)}</strong> — Tại: <strong>${d.signPlace || '...........'}</strong>${d.projectCode ? ` — Mã DA: <strong>${d.projectCode}</strong>` : ''}</p>
      <hr style="border:none; border-top:1.5px solid #333; margin-bottom:16px">

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px">Điều 1. Thông tin các bên</h2>
      <p><strong>BÊN A (Bên cung cấp dịch vụ):</strong></p>
      <p>Tên công ty: <strong>${d.aCompany || '...........................'}</strong></p>
      <p>Địa chỉ: ${d.aAddress || '...........................'}</p>
      <p>Điện thoại: ${d.aPhone || '..............'}   |   Email: ${d.aEmail || '...............'}</p>
      <p>Người đại diện: <strong>${d.aRep || '...........................'}</strong> — Chức vụ: ${d.aTitle || '...........'}</p>
      <br>
      <p><strong>BÊN B (Bên thuê dịch vụ):</strong></p>
      <p>Họ tên: <strong>${d.bName || '...........................'}</strong>   |   CCCD: ${d.bId || '...............'}</p>
      <p>Địa chỉ: ${d.bAddress || '...........................'}</p>
      <p>Điện thoại: ${d.bPhone || '..............'}   |   Email: ${d.bEmail || '...............'}</p>
      ${d.bBank ? `<p>Tài khoản ngân hàng: ${d.bBank}</p>` : ''}

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px">Điều 2. Phạm vi dịch vụ</h2>
      <p>Bên A cam kết thực hiện các hạng mục sau:</p>
      <ol style="padding-left:16px; margin-top:6px">${featuresHtml}</ol>

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px">Điều 3. Giá trị và thanh toán</h2>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:8px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:5px 8px; border:1px solid #ddd; text-align:center">STT</th>
            <th style="padding:5px 8px; border:1px solid #ddd">Đợt thanh toán</th>
            <th style="padding:5px 8px; border:1px solid #ddd; text-align:center">%</th>
            <th style="padding:5px 8px; border:1px solid #ddd; text-align:right">Số tiền</th>
          </tr>
        </thead>
        <tbody>${paymentRowsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:5px 8px; border:1px solid #ddd; font-weight:700; text-align:right">Tổng cộng (bao gồm VAT ${vatPct || 0}%):</td>
            <td style="padding:5px 8px; border:1px solid #ddd; font-weight:900; text-align:right">${fmt(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px">Điều 4. Tiến độ thực hiện</h2>
      ${CB_TIMELINE_DEFAULT.map(t => `<p><strong>${t.days}:</strong> ${t.title} — ${t.desc}</p>`).join('')}

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px">Điều 5. Bảo hành & chỉnh sửa</h2>
      ${warrantyHtml}

      <h2 style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px">Điều 6. Điều khoản pháp lý</h2>
      ${legalHtml}

      <hr style="border:none; border-top:1px solid #ccc; margin:24px 0 16px">
      <div style="display:flex; justify-content:space-between; margin-top:8px">
        <div style="text-align:center; flex:1">
          <p style="font-weight:800; font-size:11px; text-transform:uppercase">BÊN A</p>
          <p style="font-size:10px; color:#6b7280">${d.aRep || '(Ký, ghi rõ họ tên)'}</p>
          <div style="height:56px; border-bottom:1px solid #333; margin:8px 16px 4px"></div>
          <p style="font-size:10px">${d.aCompany || ''}</p>
        </div>
        <div style="text-align:center; flex:1">
          <p style="font-weight:800; font-size:11px; text-transform:uppercase">BÊN B</p>
          <p style="font-size:10px; color:#6b7280">${d.bName || '(Ký, ghi rõ họ tên)'}</p>
          <div style="height:56px; border-bottom:1px solid #333; margin:8px 16px 4px"></div>
          <p style="font-size:10px">${d.bName || ''}</p>
        </div>
      </div>
    </div>
  `;

  const doc = document.getElementById('cb-contract-doc');
  if (doc) doc.innerHTML = html;
  // Reset zoom scaler height after re-render
  const scaler = document.getElementById('cb-preview-scaler');
  if (scaler && cbState.zoom !== 1) cbApplyZoom();
};

/* ── AI SUGGEST LEGAL ── */
window.cbSuggestLegal = function() {
  const d = cbCollectData();
  const type = d.contractType || 'Hợp đồng dịch vụ';
  CB_LEGAL_SECTIONS.forEach(sec => {
    const el = document.getElementById(`cb-legal-${sec.key}`);
    if (el && !el.value.trim()) el.value = cbState.legalClauses[sec.key];
  });
  cbUpdatePreview();
  if (window.showToast) showToast(`Đã áp dụng điều khoản mẫu cho ${type}`);
};

/* ── EXPORT PDF ── */
window.cbExportPDF = function() {
  const el = document.getElementById('cb-contract-doc');
  if (!el || typeof html2pdf === 'undefined') {
    if (window.showToast) showToast('html2pdf chưa được tải', 'error');
    return;
  }
  const d = cbCollectData();
  const filename = `HopDong_${d.contractNo || 'Draft'}_${new Date().toISOString().slice(0,10)}.pdf`;
  html2pdf().set({
    margin: [10, 10, 10, 10],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  }).from(el).save();
  if (window.showToast) showToast('Đang xuất PDF...', 'info');
};

/* ── EXPORT DOCX (simple HTML→DOCX via Blob) ── */
window.cbExportDOCX = function() {
  const doc = document.getElementById('cb-contract-doc');
  if (!doc) return;
  const content = doc.innerHTML;
  const d = cbCollectData();
  const filename = `HopDong_${d.contractNo || 'Draft'}_${new Date().toISOString().slice(0,10)}.docx`;

  // Basic HTML-wrapped DOCX blob
  const mhtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>${filename}</title></head><body>${content}</body></html>`;
  const blob = new Blob(['\ufeff', mhtml], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  if (window.showToast) showToast('Đã tải file DOCX!');
};

/* ── PRINT ── */
window.cbPrint = function() {
  const content = document.getElementById('cb-contract-doc')?.innerHTML || '';
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>In hợp đồng</title><style>body{font-family:'Times New Roman',serif;font-size:12px;color:#000;margin:20mm}h1,h2,h3{font-weight:bold}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}@media print{.cb-watermark{opacity:0.05}}</style></head><body>${content}</body></html>`);
  w.document.close();
  w.print();
};

/* ── SAVE AS TEMPLATE ── */
window.cbSaveAsTemplate = function() {
  const d = cbCollectData();
  const name = prompt('Nhập tên mẫu hợp đồng:', d.contractType || 'Mẫu hợp đồng mới');
  if (!name) return;
  const templates = JSON.parse(localStorage.getItem('cb-saved-templates') || '[]');
  templates.push({ name, data: d, features: cbState.selectedFeatures, savedAt: new Date().toISOString() });
  localStorage.setItem('cb-saved-templates', JSON.stringify(templates));
  if (window.showToast) showToast(`Đã lưu mẫu: ${name}`);
};

/* ── Hook into existing navigate ── */
(function() {
  // Extend views array if originalNavigate references it
  const origNav = window.navigate;
  if (origNav) {
    const _orig = origNav;
    window.navigate = function(target) {
      _orig(target);
      if (target === 'contract-builder') {
        document.getElementById('page-title').innerText = 'Contract Builder Admin';
        // Init on first visit
        if (!window._cbInited) {
          window._cbInited = true;
          setTimeout(cbInit, 50);
        }
      }
    };
  }

  // Also update the views array and titles in originalNavigate
  if (typeof views !== 'undefined' && !views.includes('contract-builder')) {
    views.push('contract-builder');
  }
})();

// Patch page titles object by extending navigate
document.addEventListener('DOMContentLoaded', () => {
  // Ensure cb-module is available when navigating
  const origNav = window.navigate;
  if (origNav && !window._cbNavPatched) {
    window._cbNavPatched = true;
    const _orig2 = origNav;
    window.navigate = function(target) {
      if (target === 'contract-builder') {
        // Hide all views manually since 'contract-builder' may not be in the views array yet
        document.querySelectorAll('.page-view').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-btn').forEach(btn => {
          btn.classList.remove('bg-primary/10', 'text-primary', 'active-nav');
          if (btn.dataset.target === target) btn.classList.add('bg-primary/10', 'text-primary', 'active-nav');
        });
        const el = document.getElementById('view-contract-builder');
        if (el) el.classList.remove('hidden');
        document.getElementById('page-title').innerText = 'Contract Builder Admin';
        if (window.innerWidth < 1024) {
          const sidebar = document.getElementById('sidebar');
          if (sidebar && sidebar.classList.contains('translate-x-0')) toggleMobileMenu();
        }
        if (!window._cbInited) { window._cbInited = true; setTimeout(cbInit, 80); }
        return;
      }
      _orig2(target);
    };
  }
});