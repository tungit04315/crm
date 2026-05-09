/* ================================================================
   CONTRACT BUILDER — BACKEND MODULE  (cb-backend.js)
   Version: 2.0.0  |  Production-ready

   CÁCH TÍCH HỢP VÀO DỰ ÁN:
   ─────────────────────────────────────────────────────────────
   1. Thêm vào index.html, SAU app.js và cb-module.js:
        <script type="module" src="cb-backend.js"></script>
        <script type="module" src="cb-module-patch.js"></script>

   2. Module này:
      - Tự lấy Firebase App đã init trong app.js qua getApp()
      - Export window.cbBackend → dùng trong cb-module-patch.js
      - Thay thế hoàn toàn localStorage bằng Firestore
      - Autosave debounced, version history, realtime preview
      - Cloud Function triggers: export PDF/DOCX/Email

   DEPENDENCIES:
      - Firebase SDK 10.8.0 (đã init trong app.js)
      - app.js phải init Firebase TRƯỚC khi module này load
   ================================================================ */

import {
    getApp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    writeBatch,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
    getFunctions,
    httpsCallable
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

// ── Constants ────────────────────────────────────────────────────
const APP_ID = typeof __app_id !== 'undefined' ? __app_id : 'demo-marketing-crm-v4';
const AUTOSAVE_DEBOUNCE_MS = 1500;
const TAB_ID = crypto.randomUUID();

// ── Internal state ───────────────────────────────────────────────
let _db = null;
let _functions = null;
let _currentUserId = null;
let _autosaveTimer = null;
let _draftUnsubscribe = null;
let _previewUnsubscribe = null;
let _activeDraftId = null;
let _currentContractId = null;
let _initialized = false;

// ── Collection helpers ───────────────────────────────────────────
const _col = (name) =>
    collection(_db, 'artifacts', APP_ID, 'public', 'data', name);

const _docRef = (colName, id) =>
    doc(_db, 'artifacts', APP_ID, 'public', 'data', colName, id);

// ─────────────────────────────────────────────────────────────────
//  INIT
//  Gọi một lần sau khi Firebase Auth xác định được user.
//  Sử dụng getApp() để lấy app đã init sẵn trong app.js.
// ─────────────────────────────────────────────────────────────────
async function init(userId) {
    if (_initialized && _currentUserId === userId) return;
    try {
        const firebaseApp = getApp();          // lấy app đã init từ app.js
        _db = getFirestore(firebaseApp);
        _functions = getFunctions(firebaseApp, 'asia-southeast1');
        _currentUserId = userId;
        _initialized = true;
        console.log('[cb-backend] ✅ Initialized. userId:', userId, '| tabId:', TAB_ID);
    } catch (err) {
        console.error('[cb-backend] Init failed:', err);
    }
}

// Auto-init khi Auth state thay đổi
(function _autoInit() {
    try {
        const firebaseApp = getApp();
        const auth = getAuth(firebaseApp);
        onAuthStateChanged(auth, (user) => {
            if (user) {
                init(user.uid);
            } else {
                cleanup();
            }
        });
    } catch (e) {
        // Firebase chưa sẵn sàng — cb-module-patch.js sẽ gọi init() thủ công
        console.warn('[cb-backend] Auto-init deferred:', e.message);
    }
})();

// ─────────────────────────────────────────────────────────────────
//  DATA MODEL HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Build document Firestore từ cbData + cbStateObj (frontend state).
 * Map: tên field frontend → tên field Firestore chuẩn.
 */
function buildContractDoc(cbData, cbStateObj) {
    const d = cbData || {};

    const totalValue = parseFloat(d.totalValue || 0);
    const hostingFee = parseFloat(d.hostingFee || 0);
    const domainFee = parseFloat(d.domainFee || 0);
    const vatPct = parseFloat(d.vat || 0);
    const vatAmount = (totalValue * vatPct) / 100;
    const grandTotal = totalValue + hostingFee + domainFee + vatAmount;

    // Timeline: merge default với custom notes
    const timeline = (cbStateObj.timeline && cbStateObj.timeline.length)
        ? cbStateObj.timeline
        : (window.CB_TIMELINE_DEFAULT || []).map((t, i) => ({
            days: t.days,
            title: t.title,
            desc: t.desc,
            note: (document.getElementById?.(`cb-timeline-note-${i}`)?.value) || '',
        }));

    return {
        // ── Meta ────────────────────────────────────────────────────
        contractNumber: d.contractNo || '',
        contractType: d.contractType || 'HỢP ĐỒNG DỊCH VỤ WEBSITE',
        signingDate: d.signDate || '',
        signingPlace: d.signPlace || '',
        projectCode: d.projectCode || '',

        // ── Party A ─────────────────────────────────────────────────
        partyA: {
            company: d.aCompany || '',
            address: d.aAddress || '',
            email: d.aEmail || '',
            phone: d.aPhone || '',
            representative: d.aRep || '',
            title: d.aTitle || '',
        },

        // ── Party B ─────────────────────────────────────────────────
        partyB: {
            name: d.bName || '',
            nationalId: d.bId || '',
            address: d.bAddress || '',
            phone: d.bPhone || '',
            email: d.bEmail || '',
            bankAccount: d.bBank || '',
        },

        // ── Scope of services ───────────────────────────────────────
        scopeOfServices: {
            selectedFeatures: cbStateObj.selectedFeatures || [],
            customFeatures: (cbStateObj.customFeatures || [])
                .filter(f => f.enabled && f.text.trim())
                .map(f => f.text.trim()),
        },

        // ── Payment ─────────────────────────────────────────────────
        paymentTerms: {
            totalValue,
            hostingFee,
            domainFee,
            vatPercent: vatPct,
            vatAmount,
            grandTotal,
            rounds: (cbStateObj.paymentRounds || []).map(r => ({
                label: r.label,
                pct: +r.pct || 0,
                amount: totalValue * (+r.pct || 0) / 100,
            })),
        },

        // ── Timeline ────────────────────────────────────────────────
        timeline,

        // ── Warranty ────────────────────────────────────────────────
        warrantyPolicy: {
            enabled: !!d.warrantyEnabled,
            months: parseInt(d.warrantyMonths || 12),
            freeEdits: parseInt(d.warrantyEdits || 3),
            extraTerms: d.warrantyExtra || '',
        },

        // ── Legal ───────────────────────────────────────────────────
        legalTerms: cbStateObj.legalClauses || {},

        // ── Computed ────────────────────────────────────────────────
        progressPercent: calculateProgress(d, cbStateObj),
        currentStep: cbStateObj.step || 0,
        completedSteps: [...(cbStateObj.completedSteps || [])],
    };
}

/**
 * Tính progressPercent (0–100) từ các trường bắt buộc đã điền.
 */
function calculateProgress(d, state) {
    const checks = [
        !!d.contractNo?.trim(),
        !!d.signDate,
        !!d.contractType?.trim(),
        !!d.aCompany?.trim(),
        !!d.aRep?.trim(),
        !!d.bName?.trim(),
        !!d.bPhone?.trim(),
        (state.selectedFeatures || []).length > 0,
        (state.paymentRounds || []).length > 0,
        parseFloat(d.totalValue || 0) > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ─────────────────────────────────────────────────────────────────
//  VALIDATION PER STEP
// ─────────────────────────────────────────────────────────────────
const STEP_RULES = {
    0: [
        { field: 'contractNo', label: 'Số hợp đồng', validate: v => v.trim().length > 0 },
        { field: 'signDate', label: 'Ngày ký', validate: v => !!v },
        { field: 'contractType', label: 'Loại hợp đồng', validate: v => v.trim().length > 0 },
    ],
    1: [
        { field: 'aCompany', label: 'Tên công ty bên A', validate: v => v.trim().length > 1 },
        { field: 'aAddress', label: 'Địa chỉ bên A', validate: v => v.trim().length > 5 },
        { field: 'aEmail', label: 'Email bên A', validate: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
        { field: 'aPhone', label: 'Điện thoại bên A', validate: v => /^[0-9]{9,11}$/.test(v.replace(/[\s\-\+]/g, '')) },
        { field: 'aRep', label: 'Người đại diện A', validate: v => v.trim().length > 1 },
    ],
    2: [
        { field: 'bName', label: 'Họ tên bên B', validate: v => v.trim().length > 1 },
        { field: 'bId', label: 'CCCD/CMND bên B', validate: v => /^[0-9]{9,12}$/.test(v.replace(/\s/g, '')) },
        { field: 'bPhone', label: 'Điện thoại bên B', validate: v => /^[0-9]{9,11}$/.test(v.replace(/[\s\-\+]/g, '')) },
        { field: 'bEmail', label: 'Email bên B', validate: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
    ],
    3: [], // validated at state level
    4: [
        { field: 'totalValue', label: 'Giá trị hợp đồng', validate: v => parseFloat(v) > 0 },
    ],
    5: [], 6: [], 7: [], 8: [],
};

window.cbValidateStep = function (stepIdx, cbData, cbStateObj) {
    const rules = STEP_RULES[stepIdx] || [];
    const errors = [];
    rules.forEach(rule => {
        const v = String(cbData[rule.field] || '');
        if (!rule.validate(v)) errors.push(`${rule.label}: Không hợp lệ hoặc còn trống`);
    });
    if (stepIdx === 3 && (cbStateObj?.selectedFeatures || []).length === 0)
        errors.push('Phạm vi dịch vụ: Cần chọn ít nhất 1 tính năng');
    if (stepIdx === 4 && (cbStateObj?.paymentRounds || []).length === 0)
        errors.push('Thanh toán: Cần thêm ít nhất 1 đợt thanh toán');
    const totalPct = (cbStateObj?.paymentRounds || []).reduce((s, r) => s + (+r.pct || 0), 0);
    if (stepIdx === 4 && cbStateObj?.paymentRounds?.length > 0 && totalPct !== 100)
        errors.push(`Thanh toán: Tổng các đợt phải = 100% (hiện: ${totalPct}%)`);
    return { valid: errors.length === 0, errors };
};

// ─────────────────────────────────────────────────────────────────
//  AUTOSAVE DRAFT  — debounced, Firestore
// ─────────────────────────────────────────────────────────────────

/**
 * Kích hoạt autosave debounced 1.5s.
 * Thay thế cbAutoSave() của cb-module.js khi backend active.
 */
function triggerAutosave(cbData, cbStateObj) {
    _setAutosaveBadge('saving');
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => _saveDraftNow(cbData, cbStateObj), AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Ghi nháp vào Firestore ngay lập tức (không debounce).
 * Tạo mới nếu chưa có, cập nhật nếu đã có.
 */
async function _saveDraftNow(cbData, cbStateObj) {
    if (!_db || !_currentUserId) {
        _setAutosaveBadge('idle');
        return;
    }

    const contractData = buildContractDoc(cbData, cbStateObj);
    const payload = {
        userId: _currentUserId,
        tabId: TAB_ID,
        contractId: _currentContractId || null,
        currentStep: cbStateObj.step || 0,
        completedSteps: [...(cbStateObj.completedSteps || [])],
        selectedFeatures: cbStateObj.selectedFeatures || [],
        customFeatures: cbStateObj.customFeatures || [],
        paymentRounds: cbStateObj.paymentRounds || [],
        timeline: cbStateObj.timeline || [],
        legalClauses: cbStateObj.legalClauses || {},
        formData: cbData,
        contractSnapshot: contractData,
        lastSavedAt: serverTimestamp(),
        status: 'draft',
    };

    try {
        if (_activeDraftId) {
            await updateDoc(_docRef('contractDrafts', _activeDraftId), payload);
        } else {
            const ref = await addDoc(_col('contractDrafts'), {
                ...payload,
                createdAt: serverTimestamp(),
            });
            _activeDraftId = ref.id;
            console.log('[cb-backend] New draft created:', _activeDraftId);
        }
        _setAutosaveBadge('done');
    } catch (err) {
        console.error('[cb-backend] Autosave failed:', err);
        _setAutosaveBadge('error');
    }
}

function _setAutosaveBadge(state) {
    // Hỗ trợ cả badge cũ (#cb-autosave-badge) và indicator mới (#cb-save-indicator)
    const badge = document.getElementById('cb-autosave-badge');
    const indicator = document.getElementById('cb-save-indicator');

    if (state === 'saving') {
        if (badge) {
            badge.classList.remove('hidden');
            badge.classList.add('cb-autosave-saving');
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">sync</span><span>Đang lưu...</span>`;
        }
        if (indicator) { indicator.textContent = 'Đang lưu...'; indicator.className = 'text-xs text-blue-400'; }
    } else if (state === 'done') {
        const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        if (badge) {
            badge.classList.remove('cb-autosave-saving');
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">cloud_done</span><span>Đã lưu ${time}</span>`;
        }
        if (indicator) { indicator.textContent = 'Đã lưu ' + time; indicator.className = 'text-xs text-green-500'; }
    } else if (state === 'error') {
        if (badge) {
            badge.classList.remove('cb-autosave-saving');
            badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">cloud_off</span><span>Lưu thất bại!</span>`;
        }
        if (indicator) { indicator.textContent = 'Lưu thất bại!'; indicator.className = 'text-xs text-red-500'; }
    } else {
        // idle
        if (badge) badge.classList.add('hidden');
    }
}

// ─────────────────────────────────────────────────────────────────
//  LOAD DRAFT  — khi mở trang / đăng nhập lại
// ─────────────────────────────────────────────────────────────────

/**
 * Load nháp gần nhất cho user hiện tại.
 * @param {string|null} contractId  - nếu đang edit contract cụ thể
 * @returns {object|null} draftData hoặc null nếu chưa có nháp
 */
async function loadDraft(contractId = null) {
    if (!_db || !_currentUserId) return null;

    try {
        let q;
        if (contractId) {
            q = query(
                _col('contractDrafts'),
                where('userId', '==', _currentUserId),
                where('contractId', '==', contractId),
                orderBy('lastSavedAt', 'desc'),
                limit(1)
            );
        } else {
            q = query(
                _col('contractDrafts'),
                where('userId', '==', _currentUserId),
                where('contractId', '==', null),
                orderBy('lastSavedAt', 'desc'),
                limit(1)
            );
        }

        const snap = await getDocs(q);
        if (snap.empty) return null;

        const draftDoc = snap.docs[0];
        const draftData = draftDoc.data();
        _activeDraftId = draftDoc.id;

        // Conflict detection: cảnh báo nếu tab khác đang mở
        if (draftData.tabId && draftData.tabId !== TAB_ID) {
            const lastSaved = draftData.lastSavedAt?.toDate?.();
            const diffSec = lastSaved ? (Date.now() - lastSaved.getTime()) / 1000 : 9999;
            if (diffSec < 60) _showConflictWarning();
        }

        return draftData;
    } catch (err) {
        console.error('[cb-backend] loadDraft failed:', err);
        return null;
    }
}

function _showConflictWarning() {
    if (window.showToast) {
        window.showToast('⚠️ Hợp đồng này đang được chỉnh sửa ở tab/thiết bị khác. Dữ liệu có thể xung đột!', 'info');
    }
}

// ─────────────────────────────────────────────────────────────────
//  REALTIME PREVIEW LISTENER
// ─────────────────────────────────────────────────────────────────

/**
 * Lắng nghe thay đổi realtime của một draft document.
 * Mỗi thay đổi trong Firestore → gọi onUpdateCallback(draftData).
 */
function subscribePreview(draftId, onUpdateCallback) {
    if (_previewUnsubscribe) {
        _previewUnsubscribe();
        _previewUnsubscribe = null;
    }
    if (!draftId || !_db) return;

    _previewUnsubscribe = onSnapshot(
        _docRef('contractDrafts', draftId),
        (snap) => {
            if (!snap.exists()) return;
            if (typeof onUpdateCallback === 'function') onUpdateCallback(snap.data());
        },
        (err) => console.error('[cb-backend] Preview listener error:', err)
    );
}

// ─────────────────────────────────────────────────────────────────
//  CREATE / UPDATE CONTRACT  (đã xác nhận, không phải nháp)
// ─────────────────────────────────────────────────────────────────

/**
 * Tạo contract mới từ draft hiện tại.
 * @returns {string} contractId mới
 */
async function createContract(cbData, cbStateObj) {
    _assertAuth();

    const contractData = buildContractDoc(cbData, cbStateObj);
    const batch = writeBatch(_db);

    // 1. Contract document
    const contractRef = doc(_col('contracts'));
    batch.set(contractRef, {
        ...contractData,
        status: 'draft',
        createdBy: _currentUserId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastSavedAt: serverTimestamp(),
        version: 1,
    });

    // 2. Version snapshot đầu tiên
    const v1Ref = doc(
        _db, 'artifacts', APP_ID, 'public', 'data',
        'contracts', contractRef.id, 'versions', 'v1'
    );
    batch.set(v1Ref, {
        version: 1,
        data: contractData,
        changedBy: _currentUserId,
        changedAt: serverTimestamp(),
        changeSummary: 'Tạo mới hợp đồng',
    });

    // 3. Link draft → contract
    if (_activeDraftId) {
        batch.update(_docRef('contractDrafts', _activeDraftId), {
            contractId: contractRef.id,
            updatedAt: serverTimestamp(),
        });
    }

    // 4. Audit log
    batch.set(doc(_col('auditLogs')), {
        action: 'contract_created',
        contractId: contractRef.id,
        userId: _currentUserId,
        timestamp: serverTimestamp(),
        changes: { status: 'draft', contractNumber: contractData.contractNumber },
    });

    await batch.commit();
    _currentContractId = contractRef.id;
    if (window.showToast) window.showToast('Đã lưu hợp đồng vào hệ thống!', 'success');
    return contractRef.id;
}

/**
 * Cập nhật contract đã có + tạo version snapshot.
 */
async function updateContract(contractId, cbData, cbStateObj, changeSummary = '') {
    _assertAuth();

    const contractRef = _docRef('contracts', contractId);
    const currentSnap = await getDoc(contractRef);
    if (!currentSnap.exists()) throw new Error('[cb-backend] Contract not found: ' + contractId);

    const newVersion = (currentSnap.data().version || 1) + 1;
    const contractData = buildContractDoc(cbData, cbStateObj);
    const batch = writeBatch(_db);

    batch.update(contractRef, {
        ...contractData,
        version: newVersion,
        updatedAt: serverTimestamp(),
        lastSavedAt: serverTimestamp(),
    });

    batch.set(
        doc(_db, 'artifacts', APP_ID, 'public', 'data', 'contracts', contractId, 'versions', `v${newVersion}`),
        {
            version: newVersion,
            data: contractData,
            changedBy: _currentUserId,
            changedAt: serverTimestamp(),
            changeSummary: changeSummary || `Cập nhật tại step ${cbStateObj.step}`,
        }
    );

    batch.set(doc(_col('auditLogs')), {
        action: 'contract_updated',
        contractId,
        userId: _currentUserId,
        timestamp: serverTimestamp(),
        changes: { version: newVersion, summary: changeSummary },
    });

    await batch.commit();
    if (window.showToast) window.showToast('Đã cập nhật hợp đồng!', 'success');
}

// ─────────────────────────────────────────────────────────────────
//  VERSION HISTORY
// ─────────────────────────────────────────────────────────────────

/**
 * Lấy toàn bộ phiên bản của một contract.
 * @returns {Array} mảng version docs, mới nhất trước
 */
async function getVersionHistory(contractId) {
    if (!_db) return [];
    try {
        const q = query(
            collection(_db, 'artifacts', APP_ID, 'public', 'data', 'contracts', contractId, 'versions'),
            orderBy('version', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error('[cb-backend] getVersionHistory failed:', err);
        return [];
    }
}

/**
 * Khôi phục về một phiên bản cũ.
 * Tạo version mới với dữ liệu đã restore.
 */
async function restoreVersion(contractId, versionId) {
    _assertAuth();

    const vRef = doc(_db, 'artifacts', APP_ID, 'public', 'data', 'contracts', contractId, 'versions', versionId);
    const vSnap = await getDoc(vRef);
    if (!vSnap.exists()) throw new Error('Version not found: ' + versionId);

    const restoredData = vSnap.data();
    const contractRef = _docRef('contracts', contractId);
    const cSnap = await getDoc(contractRef);
    if (!cSnap.exists()) throw new Error('Contract not found: ' + contractId);

    const newVersion = (cSnap.data().version || 1) + 1;
    const batch = writeBatch(_db);

    batch.update(contractRef, {
        ...restoredData.data,
        version: newVersion,
        updatedAt: serverTimestamp(),
        lastSavedAt: serverTimestamp(),
    });

    batch.set(
        doc(_db, 'artifacts', APP_ID, 'public', 'data', 'contracts', contractId, 'versions', `v${newVersion}`),
        {
            version: newVersion,
            data: restoredData.data,
            changedBy: _currentUserId,
            changedAt: serverTimestamp(),
            changeSummary: `Khôi phục từ phiên bản ${restoredData.version}`,
            restoredFrom: versionId,
        }
    );

    batch.set(doc(_col('auditLogs')), {
        action: 'contract_restored',
        contractId,
        userId: _currentUserId,
        timestamp: serverTimestamp(),
        changes: { restoredFrom: versionId, newVersion },
    });

    await batch.commit();
    if (window.showToast) window.showToast(`Đã khôi phục phiên bản ${restoredData.version}!`, 'success');
}

// ─────────────────────────────────────────────────────────────────
//  CONTRACT TEMPLATES
// ─────────────────────────────────────────────────────────────────

/**
 * Lưu trạng thái hiện tại thành template để tái sử dụng.
 */
async function saveAsTemplate(name, cbData, cbStateObj, isPublic = false) {
    _assertAuth();

    const contractData = buildContractDoc(cbData, cbStateObj);
    await addDoc(_col('contractTemplates'), {
        name,
        contractType: cbData.contractType || '',
        templateData: contractData,
        formData: cbData,
        selectedFeatures: cbStateObj.selectedFeatures || [],
        customFeatures: cbStateObj.customFeatures || [],
        paymentRounds: cbStateObj.paymentRounds || [],
        legalClauses: cbStateObj.legalClauses || {},
        isPublic,
        createdBy: _currentUserId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        usageCount: 0,
    });

    if (window.showToast) window.showToast(`Đã lưu mẫu hợp đồng: "${name}"`, 'success');
}

/**
 * Load một template theo ID.
 * @returns {object|null}
 */
async function loadTemplate(templateId) {
    if (!_db) return null;
    try {
        const snap = await getDoc(_docRef('contractTemplates', templateId));
        if (!snap.exists()) return null;
        // Tăng usageCount
        updateDoc(_docRef('contractTemplates', templateId), {
            usageCount: (snap.data().usageCount || 0) + 1,
        }).catch(() => { });
        return { id: snap.id, ...snap.data() };
    } catch (err) {
        console.error('[cb-backend] loadTemplate failed:', err);
        return null;
    }
}

/**
 * Lấy danh sách template public + của chính user.
 * @returns {Array}
 */
async function getTemplates() {
    if (!_db || !_currentUserId) return [];
    try {
        // Public templates
        const pubQ = query(_col('contractTemplates'), where('isPublic', '==', true), orderBy('usageCount', 'desc'));
        // Own templates
        const ownQ = query(_col('contractTemplates'), where('createdBy', '==', _currentUserId), orderBy('createdAt', 'desc'));

        const [pubSnap, ownSnap] = await Promise.all([getDocs(pubQ), getDocs(ownQ)]);

        const seen = new Set();
        const result = [];
        [...ownSnap.docs, ...pubSnap.docs].forEach(d => {
            if (!seen.has(d.id)) { seen.add(d.id); result.push({ id: d.id, ...d.data() }); }
        });
        return result;
    } catch (err) {
        console.error('[cb-backend] getTemplates failed:', err);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────
//  EXPORT JOBS  (queue-based, xử lý bởi Cloud Functions)
// ─────────────────────────────────────────────────────────────────

/**
 * Tạo export job. Cloud Function sẽ pick up và xử lý.
 * type: 'pdf' | 'docx' | 'email'
 * @returns {Promise<{jobId, fileUrl}>}
 */
async function createExportJob(contractId, type, options = {}) {
    _assertAuth();
    if (!contractId) throw new Error('[cb-backend] contractId bắt buộc để export');

    const jobRef = await addDoc(_col('exportJobs'), {
        contractId,
        type,
        status: 'queued',
        options,
        createdBy: _currentUserId,
        createdAt: serverTimestamp(),
        fileUrl: null,
        error: null,
        completedAt: null,
    });

    if (window.showToast) window.showToast(`Đang tạo ${type.toUpperCase()}...`, 'info');

    // Lắng nghe job hoàn tất (timeout 90s)
    return new Promise((resolve, reject) => {
        const unsub = onSnapshot(_docRef('exportJobs', jobRef.id), (snap) => {
            const job = snap.data();
            if (!job) return;

            if (job.status === 'done') {
                unsub();
                _saveExportHistory(contractId, type, job.fileUrl).catch(() => { });
                if (window.showToast) window.showToast(`Xuất ${type.toUpperCase()} thành công! 🎉`, 'success');
                resolve({ jobId: jobRef.id, fileUrl: job.fileUrl });
            } else if (job.status === 'failed') {
                unsub();
                const msg = job.error || 'Lỗi không xác định';
                if (window.showToast) window.showToast(`Xuất thất bại: ${msg}`, 'error');
                reject(new Error(msg));
            }
        });

        setTimeout(() => {
            unsub();
            reject(new Error('Export timeout sau 90 giây'));
        }, 90000);
    });
}

/**
 * Đánh dấu export job đã hoàn tất (gọi từ Cloud Function hoặc client-side fallback).
 */
async function markExportJobDone(jobId, fileUrl) {
    if (!_db) return;
    await updateDoc(_docRef('exportJobs', jobId), {
        status: 'done',
        fileUrl: fileUrl || null,
        completedAt: serverTimestamp(),
        error: null,
    });
}

/**
 * Ghi lịch sử xuất tài liệu (tích hợp với renderHistory() của app.js).
 * @param {string} contractId
 * @param {string} type - 'pdf' | 'docx'
 * @param {string|null} fileUrl
 * @param {string} htmlContent - HTML nội dung hợp đồng để xem lại
 */
async function _saveExportHistory(contractId, type, fileUrl, htmlContent = '') {
    if (!_db) return;
    let contract = {};
    try {
        const snap = await getDoc(_docRef('contracts', contractId));
        if (snap.exists()) contract = snap.data();
    } catch (_) { }

    const partyBName = contract.partyB?.name || '';
    const contractNumber = contract.contractNumber || '';

    // Tên hiển thị: TÊN KHÁCH HÀNG - MÃ HỢP ĐỒNG
    const docName = partyBName && contractNumber
        ? `${partyBName} - ${contractNumber}`
        : partyBName || contractNumber || 'HopDong_Draft';

    await addDoc(_col('export_history'), {
        contractId,
        contractNumber,
        contractType: contract.contractType || 'HỢP ĐỒNG',
        partyBName,
        exportType: type,
        fileUrl: fileUrl || '',
        exportedBy: _currentUserId,
        exportedAt: serverTimestamp(),
        // Compat với schema historyData của app.js (renderHistory + viewHistoricalDoc)
        name: docName,
        htmlContent: htmlContent || '',
        createdAt: serverTimestamp(),
    });
}

// ─────────────────────────────────────────────────────────────────
//  CLIENT-SIDE EXPORT FALLBACKS (khi Cloud Functions chưa set up)
// ─────────────────────────────────────────────────────────────────

/**
 * Xuất PDF phía client dùng html2pdf.js.
 */
async function exportPDFLocal(contractId) {
    if (typeof html2pdf === 'undefined') {
        if (window.showToast) window.showToast('html2pdf.js chưa được tải. Thêm script vào index.html.', 'error');
        return;
    }

    // Lấy tên khách hàng + mã hợp đồng từ form (fallback khi chưa lưu Firestore)
    const formData = typeof cbCollectData === 'function' ? cbCollectData() : {};
    let customerName = (formData.bName || '').trim() || 'KhachHang';
    let contractNo = (formData.contractNo || '').trim() || 'Draft';

    // Nếu có contractId → ưu tiên dữ liệu từ Firestore
    if (contractId && _db) {
        try {
            const snap = await getDoc(_docRef('contracts', contractId));
            if (snap.exists()) {
                const cData = snap.data();
                customerName = (cData.partyB?.name || customerName).trim();
                contractNo = (cData.contractNumber || contractNo).trim();
            }
        } catch (_) { }
    }

    // Tên file: TÊN KHÁCH HÀNG - MÃ HỢP ĐỒNG_ngày.pdf
    const docName = `${customerName} - ${contractNo}`;
    const filename = `${docName}_${new Date().toISOString().slice(0, 10)}.pdf`;

    const el = document.getElementById('cb-contract-doc');
    if (!el) { if (window.showToast) window.showToast('Không tìm thấy nội dung hợp đồng', 'error'); return; }

    const htmlContent = el.innerHTML;

    try {
        await html2pdf().set({
            margin: [10, 10, 10, 10],
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        }).from(el).save();

        // Lưu lịch sử xuất (kèm htmlContent để xem lại)
        if (contractId) {
            await _saveExportHistory(contractId, 'pdf', null, htmlContent);
        } else if (typeof window.saveExportHistory === 'function') {
            // Fallback khi chưa có contractId (draft chưa lưu)
            await window.saveExportHistory(docName, htmlContent);
        }

        if (window.showToast) window.showToast('Đã xuất PDF thành công!', 'success');
    } catch (err) {
        if (window.showToast) window.showToast('Lỗi xuất PDF: ' + err.message, 'error');
    }
}

/**
 * Xuất DOCX phía client dùng blob HTML-to-Word.
 */
async function exportDOCXLocal(contractId) {
    const el = document.getElementById('cb-contract-doc');
    if (!el) return;

    // Lấy tên khách hàng + mã hợp đồng từ form (fallback khi chưa lưu Firestore)
    const formData = typeof cbCollectData === 'function' ? cbCollectData() : {};
    let customerName = (formData.bName || '').trim() || 'KhachHang';
    let contractNo = (formData.contractNo || '').trim() || 'Draft';

    // Nếu có contractId → ưu tiên dữ liệu từ Firestore
    if (contractId && _db) {
        try {
            const snap = await getDoc(_docRef('contracts', contractId));
            if (snap.exists()) {
                const cData = snap.data();
                customerName = (cData.partyB?.name || customerName).trim();
                contractNo = (cData.contractNumber || contractNo).trim();
            }
        } catch (_) { }
    }

    // Tên file: TÊN KHÁCH HÀNG - MÃ HỢP ĐỒNG_ngày.docx
    const docName = `${customerName} - ${contractNo}`;
    const filename = `${docName}_${new Date().toISOString().slice(0, 10)}.docx`;
    const htmlContent = el.innerHTML;

    const mhtml = [
        '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
        ' xmlns:w="urn:schemas-microsoft-com:office:word"',
        ' xmlns="http://www.w3.org/TR/REC-html40">',
        `<head><meta charset="UTF-8"><title>${filename}</title>`,
        '<style>body{font-family:"Times New Roman",serif;font-size:12pt;}',
        'table{border-collapse:collapse;}td,th{border:1px solid #ccc;padding:4px 8px;}</style>',
        '</head><body>', htmlContent, '</body></html>',
    ].join('');

    const blob = new Blob(['\ufeff', mhtml], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    // Lưu lịch sử xuất (kèm htmlContent để xem lại)
    if (contractId) {
        await _saveExportHistory(contractId, 'docx', null, htmlContent);
    } else if (typeof window.saveExportHistory === 'function') {
        // Fallback khi chưa có contractId (draft chưa lưu)
        await window.saveExportHistory(docName, htmlContent);
    }

    if (window.showToast) window.showToast('Đã tải file DOCX!', 'success');
}

// ─────────────────────────────────────────────────────────────────
//  CONTRACT STATUS
// ─────────────────────────────────────────────────────────────────

/**
 * Đổi trạng thái contract với audit log.
 * Allowed: 'draft' → 'in_review' → 'approved' → 'exported' | 'archived'
 */
async function updateStatus(contractId, newStatus) {
    _assertAuth();

    const VALID_STATUSES = ['draft', 'in_review', 'approved', 'exported', 'archived'];
    if (!VALID_STATUSES.includes(newStatus)) throw new Error('Trạng thái không hợp lệ: ' + newStatus);

    const contractRef = _docRef('contracts', contractId);
    const snap = await getDoc(contractRef);
    if (!snap.exists()) throw new Error('Contract not found: ' + contractId);

    const currentStatus = snap.data().status;
    const currentVersion = snap.data().version || 1;

    const batch = writeBatch(_db);

    batch.update(contractRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
        version: currentVersion + 1,
    });

    batch.set(doc(_col('auditLogs')), {
        action: 'status_changed',
        contractId,
        userId: _currentUserId,
        timestamp: serverTimestamp(),
        changes: { from: currentStatus, to: newStatus },
    });

    await batch.commit();
    if (window.showToast) window.showToast(`Trạng thái: ${currentStatus} → ${newStatus}`, 'success');
}

// ─────────────────────────────────────────────────────────────────
//  SEND EMAIL VIA CLOUD FUNCTION
// ─────────────────────────────────────────────────────────────────

/**
 * Gửi hợp đồng qua email bằng Cloud Function.
 * Cloud Function 'sendContractEmail' phải được deploy.
 */
async function sendEmail(contractId, toEmail, subject, body) {
    if (!_functions) throw new Error('[cb-backend] Functions chưa được khởi tạo');

    const sendContractEmail = httpsCallable(_functions, 'sendContractEmail');

    try {
        const result = await sendContractEmail({
            contractId,
            toEmail,
            subject: subject || `Hợp đồng dịch vụ website - ${contractId}`,
            body: body || '',
            requestedBy: _currentUserId,
        });
        if (window.showToast) window.showToast(`Đã gửi email đến ${toEmail}!`, 'success');
        return result.data;
    } catch (err) {
        if (window.showToast) window.showToast('Gửi email thất bại: ' + err.message, 'error');
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────
//  REALTIME PREVIEW — field mapping
// ─────────────────────────────────────────────────────────────────

/**
 * Map dữ liệu Firestore contract → placeholder values cho preview.
 * Dùng ở step 8 (Preview & Export).
 */
function generatePreviewData(contractDoc) {
    if (!contractDoc) return {};

    const fmt = n => (n && n > 0) ? new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ' : '–';
    const fmtDate = s => s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '................';

    return {
        '{{CONTRACT_NUMBER}}': contractDoc.contractNumber || '...........',
        '{{CONTRACT_TYPE}}': contractDoc.contractType || 'HỢP ĐỒNG DỊCH VỤ',
        '{{SIGNING_DATE}}': fmtDate(contractDoc.signingDate),
        '{{SIGNING_PLACE}}': contractDoc.signingPlace || '...........',
        '{{PROJECT_CODE}}': contractDoc.projectCode || '',

        '{{PARTY_A_COMPANY}}': contractDoc.partyA?.company || '...........................',
        '{{PARTY_A_ADDRESS}}': contractDoc.partyA?.address || '...........................',
        '{{PARTY_A_EMAIL}}': contractDoc.partyA?.email || '...............',
        '{{PARTY_A_PHONE}}': contractDoc.partyA?.phone || '..............',
        '{{PARTY_A_REP}}': contractDoc.partyA?.representative || '...........................',
        '{{PARTY_A_TITLE}}': contractDoc.partyA?.title || '...........',

        '{{PARTY_B_NAME}}': contractDoc.partyB?.name || '...........................',
        '{{PARTY_B_ID}}': contractDoc.partyB?.nationalId || '...............',
        '{{PARTY_B_ADDRESS}}': contractDoc.partyB?.address || '...........................',
        '{{PARTY_B_PHONE}}': contractDoc.partyB?.phone || '..............',
        '{{PARTY_B_EMAIL}}': contractDoc.partyB?.email || '...............',
        '{{PARTY_B_BANK}}': contractDoc.partyB?.bankAccount || '',

        '{{TOTAL_VALUE}}': fmt(contractDoc.paymentTerms?.totalValue),
        '{{HOSTING_FEE}}': fmt(contractDoc.paymentTerms?.hostingFee),
        '{{DOMAIN_FEE}}': fmt(contractDoc.paymentTerms?.domainFee),
        '{{VAT_PERCENT}}': (contractDoc.paymentTerms?.vatPercent || 0) + '%',
        '{{GRAND_TOTAL}}': fmt(contractDoc.paymentTerms?.grandTotal),

        '{{WARRANTY_MONTHS}}': String(contractDoc.warrantyPolicy?.months || 12),
        '{{WARRANTY_EDITS}}': String(contractDoc.warrantyPolicy?.freeEdits || 3),
        '{{WARRANTY_EXTRA}}': contractDoc.warrantyPolicy?.extraTerms || '',

        '{{PROGRESS_PERCENT}}': String(contractDoc.progressPercent || 0) + '%',
        '{{STATUS}}': contractDoc.status || 'draft',
        '{{VERSION}}': String(contractDoc.version || 1),
    };
}

// ─────────────────────────────────────────────────────────────────
//  GET CONTRACT BY ID
// ─────────────────────────────────────────────────────────────────
async function getContractById(contractId) {
    if (!_db) return null;
    try {
        const snap = await getDoc(_docRef('contracts', contractId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
        console.error('[cb-backend] getContractById failed:', err);
        return null;
    }
}

/**
 * Subscribe realtime updates cho một contract document.
 */
function subscribeContract(contractId, onUpdateCallback) {
    if (_draftUnsubscribe) { _draftUnsubscribe(); _draftUnsubscribe = null; }
    if (!contractId || !_db) return;

    _draftUnsubscribe = onSnapshot(
        _docRef('contracts', contractId),
        (snap) => {
            if (snap.exists() && typeof onUpdateCallback === 'function') {
                onUpdateCallback({ id: snap.id, ...snap.data() });
            }
        },
        (err) => console.error('[cb-backend] subscribeContract error:', err)
    );
}

// ─────────────────────────────────────────────────────────────────
//  CLEAR DRAFT (sau khi export / lưu thành công)
// ─────────────────────────────────────────────────────────────────
async function clearActiveDraft() {
    if (!_activeDraftId || !_db) return;
    try {
        await deleteDoc(_docRef('contractDrafts', _activeDraftId));
        _activeDraftId = null;
        console.log('[cb-backend] Draft cleared.');
    } catch (err) {
        console.warn('[cb-backend] clearActiveDraft error:', err);
    }
}

// ─────────────────────────────────────────────────────────────────
//  PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────
function _assertAuth() {
    if (!_db || !_currentUserId) throw new Error('[cb-backend] Chưa xác thực. Vui lòng đăng nhập.');
}

// ─────────────────────────────────────────────────────────────────
//  CLEANUP  — gọi khi logout / unload trang
// ─────────────────────────────────────────────────────────────────
function cleanup() {
    if (_draftUnsubscribe) { _draftUnsubscribe(); _draftUnsubscribe = null; }
    if (_previewUnsubscribe) { _previewUnsubscribe(); _previewUnsubscribe = null; }
    clearTimeout(_autosaveTimer);
    _activeDraftId = null;
    _currentContractId = null;
    _currentUserId = null;
    _initialized = false;
    console.log('[cb-backend] Cleaned up.');
}

// ─────────────────────────────────────────────────────────────────
//  PUBLIC API  →  window.cbBackend
// ─────────────────────────────────────────────────────────────────
window.cbBackend = {
    // Init & lifecycle
    init,
    cleanup,

    // Draft
    loadDraft,
    triggerAutosave,
    saveDraftNow: _saveDraftNow,
    clearActiveDraft,

    // Contract CRUD
    createContract,
    updateContract,
    updateStatus,
    getContractById,

    // Realtime
    subscribePreview,
    subscribeContract,

    // Version history
    getVersionHistory,
    restoreVersion,

    // Templates
    saveAsTemplate,
    loadTemplate,
    getTemplates,

    // Export
    createExportJob,
    markExportJobDone,
    exportPDFLocal,
    exportDOCXLocal,
    sendEmail,

    // Validation & helpers
    validateStep: window.cbValidateStep,
    generatePreviewData,
    buildContractDoc,
    calculateProgress,

    // State getters/setters (dùng trong cb-module-patch.js)
    getDraftId: () => _activeDraftId,
    getContractId: () => _currentContractId,
    setContractId: (id) => { _currentContractId = id; },
    isInitialized: () => _initialized,
};

console.log('[cb-backend] ✅ Module loaded. TAB_ID:', TAB_ID);