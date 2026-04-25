import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/*
========================================================
FIRESTORE SCHEMA DOCUMENTATION (Workflow Management)
========================================================
1. workflows:
   {
       name: string,
       serviceId: string,
       desc: string,
       steps: array of objects [{id, name, order}], // Embedded steps for fast read/writes
       createdAt: timestamp
   }
2. jobs:
   {
       name: string,
       customerId: string,
       serviceId: string,
       workflowId: string,
       status: string, ("doing", "done")
       steps: array of objects [{id, name, status("pending", "doing", "done"), assignee, deadline, note, order}], // Cloned from workflow
       createdAt: timestamp
   }
========================================================
*/

window.currentUser = null;
let leadsData = [];
let customersData = [];
let servicesData = [];
let webfeaturesData = [];
let templatesData = [];
let historyData = [];
let workflowsData = [];
let jobsData = [];

let currentEditingTemplateHtml = "";
let unsubscribes = [];
let isLoginMode = true;

const getCollectionPath = (name) => collection(db, 'artifacts', app_id, 'public', 'data', name);

// Utilities
window.showToast = (msg, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast-enter p-4 rounded-xl shadow-lg flex items-center gap-3 text-white w-full sm:max-w-sm ${type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'} pointer-events-auto`;
    toast.innerHTML = `<span class="material-symbols-outlined">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}</span><span class="text-sm font-medium flex-1">${msg}</span>`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
};
window.formatCurrency = (num) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
window.formatDateStr = (timestamp) => {
    if (!timestamp) return '...';
    const date = timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp);
    return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const getISODate = (timestamp) => {
    if (!timestamp) return null;
    const date = timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
};

// --- AUTH LOGIC ---
const usernameInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const tail = document.getElementById('tail');
const paws = document.getElementById('paws');
const leftPupil = document.getElementById('left-pupil');
const rightPupil = document.getElementById('right-pupil');
const mouth = document.getElementById('mouth');

document.addEventListener('mousemove', (e) => {
    if (document.activeElement === passwordInput) return;
    const mouseX = e.clientX, mouseY = e.clientY;
    [leftPupil, rightPupil].forEach(pupil => {
        const rect = pupil.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
        const distance = Math.min(6, Math.hypot(mouseX - centerX, mouseY - centerY) / 50);
        pupil.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
    });
});

usernameInput.addEventListener('input', () => { tail.classList.toggle('wag-fast', usernameInput.value.length > 0); tail.classList.toggle('wag-normal', usernameInput.value.length === 0); });
passwordInput.addEventListener('focus', () => { paws.style.opacity = '1'; paws.style.transform = 'translateY(-60px)'; leftPupil.style.transform = 'scale(0)'; rightPupil.style.transform = 'scale(0)'; mouth.style.width = '10px'; });
passwordInput.addEventListener('blur', () => { paws.style.opacity = '0'; paws.style.transform = 'translateY(24px)'; leftPupil.style.transform = 'scale(1)'; rightPupil.style.transform = 'scale(1)'; mouth.style.width = '16px'; });

window.toggleAuthMode = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Chào mừng trở lại!' : 'Tạo tài khoản mới';
    document.getElementById('auth-subtitle').innerText = isLoginMode ? 'Đăng nhập vào hệ thống CRM' : 'Đăng ký tài khoản không gian làm việc';
    document.getElementById('auth-btn').innerHTML = isLoginMode ? '<span>Đăng nhập</span><span class="material-symbols-outlined text-sm">arrow_forward</span>' : '<span>Đăng ký</span><span class="material-symbols-outlined text-sm">person_add</span>';
    document.getElementById('toggle-auth-btn').innerText = isLoginMode ? 'Đăng ký ngay' : 'Đăng nhập';
};

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = usernameInput.value; const password = passwordInput.value;
    const btn = document.getElementById('auth-btn'); btn.disabled = true; btn.style.opacity = '0.7';
    try {
        if (isLoginMode) await signInWithEmailAndPassword(auth, email, password);
        else {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName: email.split('@')[0] });
            showToast('Đăng ký thành công!');
        }
        mouth.style.height = '12px'; mouth.style.borderRadius = '0 0 20px 20px'; mouth.style.borderBottomWidth = '4px';
    } catch (error) {
        mouth.style.borderRadius = '20px 20px 0 0'; mouth.style.borderBottom = 'none'; mouth.style.borderTop = '2px solid #b31b25';
        showToast(error.message.includes('invalid') ? 'Sai thông tin!' : error.message, 'error');
    } finally { btn.disabled = false; btn.style.opacity = '1'; }
});
window.logout = async () => { if (confirm('Đăng xuất?')) await signOut(auth); };
window.resetPassword = async () => { if (usernameInput.value) sendPasswordResetEmail(auth, usernameInput.value).then(() => showToast('Đã gửi email reset')); };

onAuthStateChanged(auth, async (user) => {
    const ls = document.getElementById('login-screen'); const as = document.getElementById('app-screen');
    if (user) {
        window.currentUser = user;
        document.getElementById('user-name-display').innerText = user.displayName || user.email.split('@')[0];
        document.getElementById('user-email-display').innerText = user.email;
        //document.getElementById('user-avatar').innerText = (user.displayName || user.email).charAt(0).toUpperCase();
        document.getElementById('user-avatar').innerText = (user.displayName || user.email).charAt(0).toUpperCase();
        // [PATCH 6] Load avatar từ Firestore
        try {
            const { getDoc, doc: _doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            const userSnap = await getDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'users', user.uid));
            if (userSnap.exists()) {
                const userData = userSnap.data();
                if (userData.fullname) document.getElementById('profile-fullname').value = userData.fullname;
                if (userData.avatarUrl) {
                    applyAvatarToSidebar(userData.avatarUrl, user.displayName || user.email.split('@')[0]);
                    loadAvatarInSettings(userData.avatarUrl, user.displayName || user.email.split('@')[0]);
                } else {
                    loadAvatarInSettings('', user.displayName || user.email.split('@')[0]);
                }
            } else {
                loadAvatarInSettings('', user.displayName || user.email.split('@')[0]);
            }
        } catch (e) { loadAvatarInSettings('', user.displayName || user.email.split('@')[0]); }
        document.getElementById('profile-email').value = user.email;
        document.getElementById('profile-username').value = user.displayName || user.email.split('@')[0];

        ls.classList.add('opacity-0');
        setTimeout(() => { ls.classList.add('hidden'); as.classList.remove('hidden'); setTimeout(() => as.classList.remove('opacity-0'), 50); initAppLogic(); }, 500);
    } else {
        window.currentUser = null; unsubscribes.forEach(fn => fn()); unsubscribes = [];
        as.classList.add('opacity-0');
        setTimeout(() => { as.classList.add('hidden'); ls.classList.remove('hidden'); setTimeout(() => ls.classList.remove('opacity-0'), 50); }, 500);
    }
});

//Update Profile
// window.updateProfileData = async () => {
//     const username = document.getElementById('profile-username').value.trim();
//     const fullname = document.getElementById('profile-fullname').value.trim();
//     const newPassword = document.getElementById('profile-password').value;

//     if (!username) return showToast('Username không được để trống', 'error');

//     const btn = document.getElementById('btn-update-profile');
//     btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">refresh</span> Đang xử lý...';
//     btn.disabled = true;

//     try {
//         await updateProfile(auth.currentUser, { displayName: username });
//         const userRef = doc(db, 'artifacts', app_id, 'public', 'data', 'users', auth.currentUser.uid);
//         await setDoc(userRef, { username, fullname, updatedAt: new Date() }, { merge: true });

//         if (newPassword) {
//             await updatePassword(auth.currentUser, newPassword);
//             document.getElementById('profile-password').value = '';
//             showToast('Đã cập nhật mật khẩu mới!');
//         }

//         document.getElementById('user-name-display').innerText = username;
//         document.getElementById('user-avatar').innerText = username.charAt(0).toUpperCase();
//         showToast('Đã cập nhật thông tin thành công!');
//     } catch (e) {
//         showToast('Lỗi cập nhật: ' + e.message, 'error');
//     } finally {
//         btn.innerHTML = 'Lưu Thay Đổi';
//         btn.disabled = false;
//     }
// };

window.updateProfileData = async () => {
    const username = document.getElementById('profile-username').value.trim();
    const fullname = document.getElementById('profile-fullname').value.trim();
    const newPassword = document.getElementById('profile-password').value;
    // [PATCH 6] lấy avatar data
    const avatarData = document.getElementById('avatar-data-cache')?.value || '';

    if (!username) return showToast('Username không được để trống', 'error');

    const btn = document.getElementById('btn-update-profile');
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">refresh</span> Đang xử lý...';
    btn.disabled = true;

    try {
        await updateProfile(auth.currentUser, { displayName: username });
        const userRef = doc(db, 'artifacts', app_id, 'public', 'data', 'users', auth.currentUser.uid);
        await setDoc(userRef, { username, fullname, avatarUrl: avatarData, updatedAt: new Date() }, { merge: true });

        if (newPassword) {
            await updatePassword(auth.currentUser, newPassword);
            document.getElementById('profile-password').value = '';
            showToast('Đã cập nhật mật khẩu mới!');
        }

        document.getElementById('user-name-display').innerText = username;
        // [PATCH 6] cập nhật avatar ở sidebar
        applyAvatarToSidebar(avatarData, username);
        showToast('Đã cập nhật thông tin thành công!');
    } catch (e) {
        showToast('Lỗi cập nhật: ' + e.message, 'error');
    } finally {
        btn.innerHTML = 'Lưu Thay Đổi';
        btn.disabled = false;
    }
};

// --- APP NAVIGATION & MOBILE MENU LOGIC ---

window.toggleMobileMenu = () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    const isOpen = sidebar.classList.contains('translate-x-0');

    if (isOpen) {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    } else {
        overlay.classList.remove('hidden');
        // Trigger reflow
        void overlay.offsetWidth;
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
    }
};

const views = ['dashboard', 'leads', 'customers', 'services', 'webfeatures', 'projects', 'jobs', 'quotes', 'history', 'settings']; // ADDED 'jobs'

const originalNavigate = (target) => {
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.add('hidden');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('bg-primary/10', 'text-primary', 'active-nav');
        if (btn.dataset.target === target) btn.classList.add('bg-primary/10', 'text-primary', 'active-nav');
    });

    const tgtEl = document.getElementById(`view-${target}`);
    if (tgtEl) tgtEl.classList.remove('hidden');

    const titles = { dashboard: 'Tổng quan', leads: 'Quản lý Lead', customers: 'Quản lý Khách hàng', services: 'Dịch vụ', webfeatures: 'Tính năng Website', projects: 'Quản lý Dự Án', jobs: 'Quy trình & Công việc', quotes: 'Báo giá & Hợp đồng', history: 'Lịch sử xuất', settings: 'Cài đặt hệ thống' };
    document.getElementById('page-title').innerText = titles[target] || 'CRM';

    if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('translate-x-0')) toggleMobileMenu();
    }
};

window.navigate = (target) => {
    originalNavigate(target);

    document.querySelectorAll('.float-nav-btn').forEach(btn => {
        const isTarget = btn.dataset.target === target;
        const dot = btn.querySelector('.dot');

        if (btn.classList.contains('bg-gradient-to-tr')) {
            if (isTarget) btn.classList.add('ring-4', 'ring-primary/40');
            else btn.classList.remove('ring-4', 'ring-primary/40');
        } else {
            if (isTarget) {
                btn.classList.add('text-primary');
                btn.classList.remove('text-gray-400');
                if (dot) {
                    dot.classList.remove('opacity-0', 'scale-0');
                    dot.classList.add('opacity-100', 'scale-100');
                }
            } else {
                btn.classList.remove('text-primary');
                btn.classList.add('text-gray-400');
                if (dot) {
                    dot.classList.add('opacity-0', 'scale-0');
                    dot.classList.remove('opacity-100', 'scale-100');
                }
            }
        }
    });
};

function initAppLogic() {
    //unsubscribes.push(onSnapshot(query(getCollectionPath('leads')), snap => { leadsData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderLeads(); updateDashboardStats(); updateQuoteCustomerSelect(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('leads')), snap => { leadsData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderLeads(); updateDashboardStats(); updateQuoteCustomerSelect(); if (myChart) initChart(); }));
    //unsubscribes.push(onSnapshot(query(getCollectionPath('customers')), snap => { customersData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderCustomers(); updateDashboardStats(); updateQuoteCustomerSelect(); updateJobCustomerSelect(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('customers')), snap => { customersData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderCustomers(); updateDashboardStats(); updateQuoteCustomerSelect(); updateJobCustomerSelect(); if (myChart) initChart(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('services')), snap => { servicesData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderServices(); updateDashboardStats(); updateWorkflowServiceSelect(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('webfeatures')), snap => { webfeaturesData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderWebfeatures(); updateDashboardStats(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('templates')), snap => { templatesData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTemplatesList(); updateTemplateSelector(); updateDashboardStats(); }));
    //unsubscribes.push(onSnapshot(query(getCollectionPath('export_history')), snap => { historyData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderHistory(); updateDashboardStats(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('export_history')), snap => { historyData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderHistory(); updateDashboardStats(); if (myChart) initChart(); }));
    // New Listeners for Workflow Module
    unsubscribes.push(onSnapshot(query(getCollectionPath('workflows')), snap => { workflowsData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderWorkflows(); updateJobWorkflowSelect(); updateKanbanWorkflowSelect(); }));
    //unsubscribes.push(onSnapshot(query(getCollectionPath('jobs')), snap => { jobsData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderJobsTable(); renderJobsKanban(); updateDashboardStats(); renderJobReports(); }));
    unsubscribes.push(onSnapshot(query(getCollectionPath('jobs')), snap => { jobsData = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderJobsTable(); renderJobsKanban(); updateDashboardStats(); renderJobReports(); if (myChart) initChart(); }));

    initProjectsModule();
    initChart();
    setupImageDropzone('cus-gpkd'); setupImageDropzone('cus-cccd'); setupImageDropzone('cus-store');
}


// --- COMMON UI LOGIC ---
window.openModal = (id, data = null) => {
    const modal = document.getElementById(id); const content = document.getElementById(`${id}-content`);
    modal.classList.remove('hidden'); setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);

    if (id === 'lead-modal') {
        document.getElementById('lead-modal-title').innerText = data ? 'Sửa Khách Hàng Tiềm Năng' : 'Thêm Lead Mới';
        ['id', 'name', 'phone', 'email', 'source', 'type', 'note'].forEach(k => {
            const el = document.getElementById(`lead-${k}`);
            if (el) el.value = data ? (data[k] || '') : (k === 'type' ? 'Thường' : '');
        });
    } else if (id === 'customer-modal') {
        document.getElementById('customer-modal-title').innerText = data ? 'Sửa Khách Hàng' : 'Thêm Khách Hàng Mới';
        ['id', 'name', 'address', 'email', 'phone', 'bank-owner', 'bank-account', 'bank-name', 'bank-branch', 'note', 'source', 'convert-lead-id'].forEach(k => {
            const el = document.getElementById(`cus-${k}`);
            if (el) el.value = data ? (data[k.replace('-', '')] || data[k] || '') : '';
        });
        if (data && data.bankOwner) document.getElementById('cus-bank-owner').value = data.bankOwner;
        if (data && data.bankAccount) document.getElementById('cus-bank-account').value = data.bankAccount;
        if (data && data.bankName) document.getElementById('cus-bank-name').value = data.bankName;
        if (data && data.bankBranch) document.getElementById('cus-bank-branch').value = data.bankBranch;

        window.clearImage_cus_gpkd(); window.clearImage_cus_cccd(); window.clearImage_cus_store();
        if (data) {
            if (data.gpkd) loadExistingImageToZone('cus-gpkd', data.gpkd);
            if (data.cccd) loadExistingImageToZone('cus-cccd', data.cccd);
            if (data.storeImage) loadExistingImageToZone('cus-store', data.storeImage);
        }
    } else if (id === 'service-modal') {
        document.getElementById('service-modal-title').innerText = data ? 'Sửa Dịch Vụ' : 'Thêm Dịch Vụ';
        ['id', 'name', 'price', 'desc'].forEach(k => document.getElementById(`srv-${k}`).value = data ? (data[k] || '') : '');
    } else if (id === 'webfeature-modal') {
        document.getElementById('webfeature-modal-title').innerText = data ? 'Sửa Tính năng Website' : 'Thêm Tính năng Website';
        ['id', 'name', 'price', 'demo', 'desc'].forEach(k => document.getElementById(`wf-${k}`).value = data ? (data[k] || '') : '');

        window.clearWebFeatureImage();
        if (data && data.image) {
            document.getElementById('wf-image-data').value = data.image;
            document.getElementById('wf-image-preview').src = data.image;
            document.getElementById('wf-image-preview-container').classList.remove('hidden');
        }
    } else if (id === 'template-upload-modal') {
        document.getElementById('tpl-name').value = '';
        document.getElementById('tpl-file').value = '';
        document.getElementById('tpl-extract-status').classList.add('hidden');
        document.getElementById('tpl-detected-fields').innerHTML = '';
        window.tempExtractedHtml = null;
        window.tempExtractedFields = [];
    } else if (id === 'workflow-modal') {
        document.getElementById('workflow-modal-title').innerText = data ? 'Sửa Workflow' : 'Thêm Workflow';
        document.getElementById('wf-doc-id').value = data ? data.id : '';
        document.getElementById('wfm-name').value = data ? data.name : '';
        document.getElementById('wfm-desc').value = data ? (data.desc || '') : '';
        document.getElementById('wfm-service').value = data ? data.serviceId : '';

        const container = document.getElementById('workflow-steps-container');
        container.innerHTML = '';
        if (data && data.steps) {
            data.steps.forEach(step => window.addWorkflowStepInput(step.name));
        } else {
            window.addWorkflowStepInput('Khởi tạo / Tiếp nhận');
            window.addWorkflowStepInput('Thực hiện');
            window.addWorkflowStepInput('Nghiệm thu');
        }
    } else if (id === 'job-modal') {
        document.getElementById('job-id').value = '';
        document.getElementById('job-name').value = '';
        document.getElementById('job-customer').value = '';
        document.getElementById('job-workflow').value = '';
    }
};

window.closeModal = (id) => {
    const m = document.getElementById(id); const c = document.getElementById(`${id}-content`);
    m.classList.add('opacity-0'); c.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 300);
};

function setupImageDropzone(prefix) {
    const z = document.getElementById(`${prefix}-zone`), f = document.getElementById(`${prefix}-file`), d = document.getElementById(`${prefix}-data`), p = document.getElementById(`${prefix}-preview`), c = document.getElementById(`${prefix}-clear`), pl = document.getElementById(`${prefix}-placeholder`);
    if (!z) return;
    z.addEventListener('click', e => { if (e.target !== c && e.target.tagName !== 'SPAN') f.click(); });
    f.addEventListener('change', e => hF(e.target.files[0]));
    z.addEventListener('paste', e => { e.preventDefault(); const i = (e.clipboardData || e.originalEvent.clipboardData).items; for (let idx in i) if (i[idx].kind === 'file') { hF(i[idx].getAsFile()); break; } });
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('border-primary'); });
    z.addEventListener('dragleave', () => z.classList.remove('border-primary'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('border-primary'); hF(e.dataTransfer.files[0]); });
    function hF(file) {
        if (!file || !file.type.startsWith('image/')) return showToast('Chỉ nhận ảnh', 'error');
        if (file.size > 1.5 * 1024 * 1024) return showToast('Ảnh < 1.5MB', 'error');
        const r = new FileReader(); r.onload = e => { d.value = e.target.result; p.src = e.target.result; p.classList.remove('hidden'); pl.classList.add('hidden'); c.classList.remove('hidden'); }; r.readAsDataURL(file);
    }
    window[`clearImage_${prefix.replace('-', '_')}`] = (e) => { if (e) e.stopPropagation(); f.value = ''; d.value = ''; p.src = ''; p.classList.add('hidden'); pl.classList.remove('hidden'); c.classList.add('hidden'); };
}
function loadExistingImageToZone(prefix, b64) { document.getElementById(`${prefix}-data`).value = b64; const p = document.getElementById(`${prefix}-preview`); p.src = b64; p.classList.remove('hidden'); document.getElementById(`${prefix}-placeholder`).classList.add('hidden'); document.getElementById(`${prefix}-clear`).classList.remove('hidden'); }


// --- LEADS LOGIC ---
// window.renderLeads = () => {
//     const txt = document.getElementById('search-lead').value.toLowerCase();
//     const dt = document.getElementById('filter-lead-date').value;
//     const tp = document.getElementById('filter-lead-type').value;

//     const filtered = leadsData.filter(l => {
//         const matchTxt = l.name.toLowerCase().includes(txt) || l.phone.includes(txt);
//         const matchDt = !dt || getISODate(l.createdAt) === dt;
//         const matchTp = !tp || l.type === tp;
//         return matchTxt && matchDt && matchTp;
//     });

//     const tbody = document.getElementById('leads-list');
//     if (filtered.length === 0) return tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500">Chưa có Lead phù hợp</td></tr>`;

//     tbody.innerHTML = filtered.map(l => {
//         let badgeClass = 'badge-lead-normal';
//         if (l.type === 'Tiềm năng') badgeClass = 'badge-lead-potential';
//         if (l.type === 'VIP') badgeClass = 'badge-lead-vip';

//         return `
//                 <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50 transition-colors">
//                     <td class="py-3 font-semibold text-orange-600 max-w-[150px] sm:max-w-[200px] truncate pl-2">${l.name}</td>
//                     <td class="py-3"><div class="text-xs font-mono font-bold">${l.phone}</div><div class="text-[11px] text-gray-500 max-w-[120px] truncate">${l.email || ''}</div></td>
//                     <td class="py-3 text-center"><span class="px-2 py-1 text-[10px] uppercase font-bold rounded-full whitespace-nowrap ${badgeClass}">${l.type}</span></td>
//                     <td class="py-3"><div class="text-xs font-medium max-w-[100px] truncate">${l.source || 'N/A'}</div><div class="text-[10px] text-gray-400 whitespace-nowrap">${formatDateStr(l.createdAt)}</div></td>
//                     <td class="py-3 text-right pr-2 whitespace-nowrap">
//                         <button onclick="convertLeadToCustomer('${l.id}')" class="p-2 lg:p-1 text-green-500 hover:text-green-600 mr-1 bg-green-50 lg:bg-transparent rounded" title="Chuyển sang Khách Hàng"><span class="material-symbols-outlined text-base lg:text-sm">person_add</span></button>
//                         <button onclick='editLead(${JSON.stringify(l).replace(/'/g, "&#39;")})' class="p-2 lg:p-1 text-gray-400 hover:text-primary mr-1 bg-gray-100 lg:bg-transparent rounded" title="Sửa"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
//                         <button onclick="deleteLead('${l.id}')" class="p-2 lg:p-1 text-gray-400 hover:text-red-500 bg-gray-100 lg:bg-transparent rounded" title="Xóa"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
//                     </td>
//                 </tr>
//             `}).join('');
// };
// ['search-lead', 'filter-lead-date', 'filter-lead-type'].forEach(id => document.getElementById(id).addEventListener('input', renderLeads));

// document.getElementById('lead-form').addEventListener('submit', async (e) => {
//     e.preventDefault();
//     const id = document.getElementById('lead-id').value;
//     const data = {
//         name: document.getElementById('lead-name').value.trim(),
//         phone: document.getElementById('lead-phone').value.trim(),
//         email: document.getElementById('lead-email').value.trim(),
//         source: document.getElementById('lead-source').value.trim(),
//         type: document.getElementById('lead-type').value,
//         note: document.getElementById('lead-note').value.trim(),
//     };
//     try {
//         if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'leads', id), data);
//         else await addDoc(getCollectionPath('leads'), { ...data, createdAt: new Date() });
//         showToast(id ? 'Cập nhật Lead thành công' : 'Đã thêm Lead mới');
//         closeModal('lead-modal');
//     } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
// });

// window.editLead = (data) => openModal('lead-modal', data);
// window.deleteLead = async (id) => { if (confirm('Xóa Lead này?')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'leads', id)); };

// window.convertLeadToCustomer = (leadId) => {
//     const lead = leadsData.find(l => l.id === leadId);
//     if (!lead) return;
//     openModal('customer-modal', {
//         name: lead.name, phone: lead.phone, email: lead.email, source: lead.source, note: lead.note, 'convert-lead-id': lead.id
//     });
//     showToast('Vui lòng bổ sung thêm thông tin để hoàn tất chuyển đổi', 'info');
// };

// ==============================================
// PAGINATION ENGINE (dùng chung cho tất cả)
// ==============================================
const PG = {}; // trạng thái phân trang mỗi section

function buildPagination(key, totalItems, container, infoEl, perPage) {
    const totalPages = Math.ceil(totalItems / perPage) || 1;
    if (!PG[key]) PG[key] = 1;
    if (PG[key] > totalPages) PG[key] = totalPages;

    const paginEl = document.getElementById(`${key}-pagination`);
    if (totalItems <= perPage) { if (paginEl) paginEl.classList.add('hidden'); }
    else { if (paginEl) paginEl.classList.remove('hidden'); }

    const from = (PG[key] - 1) * perPage + 1;
    const to = Math.min(PG[key] * perPage, totalItems);
    if (infoEl) infoEl.textContent = `${from}–${to} / ${totalItems}`;

    if (!container) return;
    let html = '';
    // Prev
    html += `<button class="pagination-btn arrow" onclick="goPage('${key}',${PG[key] - 1})" ${PG[key] === 1 ? 'disabled' : ''}><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>`;
    // Pages
    const delta = 1;
    let pages = new Set([1, totalPages]);
    for (let i = Math.max(2, PG[key] - delta); i <= Math.min(totalPages - 1, PG[key] + delta); i++) pages.add(i);
    const sorted = [...pages].sort((a, b) => a - b);
    let prev = 0;
    sorted.forEach(p => {
        if (prev && p - prev > 1) html += `<span class="text-gray-400 px-1 text-sm">…</span>`;
        html += `<button class="pagination-btn ${PG[key] === p ? 'active' : ''}" onclick="goPage('${key}',${p})">${p}</button>`;
        prev = p;
    });
    // Next
    html += `<button class="pagination-btn arrow" onclick="goPage('${key}',${PG[key] + 1})" ${PG[key] === totalPages ? 'disabled' : ''}><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>`;
    container.innerHTML = html;
}

window.goPage = (key, page) => {
    const totalMap = {
        leads: () => { PG.leads = page; renderLeads(); },
        customers: () => { PG.customers = page; renderCustomers(); },
        services: () => { PG.services = page; renderServices(); },
        webfeatures: () => { PG.webfeatures = page; renderWebfeatures(); },
        history: () => { PG.history = page; renderHistory(); },
    };
    if (totalMap[key]) totalMap[key]();
    // Scroll top of list area
    const el = document.getElementById(`view-${key === 'webfeatures' ? 'webfeatures' : key}`);
    if (el) el.querySelector('.overflow-auto')?.scrollTo(0, 0);
};

function getPageSlice(arr, key, perPage) {
    if (!PG[key]) PG[key] = 1;
    const start = (PG[key] - 1) * perPage;
    return arr.slice(start, start + perPage);
}

// ==============================================
// LEADS LOGIC — với responsive card + pagination
// ==============================================
const LEADS_PER_PAGE = 10;

window.renderLeads = () => {
    const txt = document.getElementById('search-lead').value.toLowerCase();
    const dt = document.getElementById('filter-lead-date').value;
    const tp = document.getElementById('filter-lead-type').value;

    const filtered = leadsData.filter(l => {
        const matchTxt = l.name.toLowerCase().includes(txt) || l.phone.includes(txt);
        const matchDt = !dt || getISODate(l.createdAt) === dt;
        const matchTp = !tp || l.type === tp;
        return matchTxt && matchDt && matchTp;
    });

    // Reset page khi filter thay đổi (chỉ khi gọi từ input event)
    const badge = document.getElementById('lead-count-badge');
    if (badge) badge.textContent = `${filtered.length} leads`;

    const paged = getPageSlice(filtered, 'leads', LEADS_PER_PAGE);

    // ── Desktop Table ──
    const tbody = document.getElementById('leads-list');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400">
            <span class="material-symbols-outlined text-3xl block mb-2">search_off</span>Chưa có Lead phù hợp</td></tr>`;
    } else {
        tbody.innerHTML = paged.map(l => {
            let badgeClass = 'badge-lead-normal';
            if (l.type === 'Tiềm năng') badgeClass = 'badge-lead-potential';
            if (l.type === 'VIP') badgeClass = 'badge-lead-vip';
            return `
            <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50 transition-colors">
                <td class="py-3 font-semibold text-orange-600 max-w-[150px] sm:max-w-[200px] truncate pl-2">${l.name}</td>
                <td class="py-3"><div class="text-xs font-mono font-bold">${l.phone}</div><div class="text-[11px] text-gray-500 max-w-[120px] truncate">${l.email || ''}</div></td>
                <td class="py-3 text-center"><span class="px-2 py-1 text-[10px] uppercase font-bold rounded-full whitespace-nowrap ${badgeClass}">${l.type || 'Thường'}</span></td>
                <td class="py-3"><div class="text-xs font-medium max-w-[100px] truncate">${l.source || 'N/A'}</div><div class="text-[10px] text-gray-400 whitespace-nowrap">${formatDateStr(l.createdAt)}</div></td>
                <td class="py-3 text-right pr-2 whitespace-nowrap">
                    <button onclick="convertLeadToCustomer('${l.id}')" class="p-2 lg:p-1 text-green-500 hover:text-green-600 mr-1 bg-green-50 lg:bg-transparent rounded" title="Chuyển KH"><span class="material-symbols-outlined text-base lg:text-sm">person_add</span></button>
                    <button onclick='editLead(${JSON.stringify(l).replace(/'/g, "&#39;")})' class="p-2 lg:p-1 text-gray-400 hover:text-primary mr-1 bg-gray-100 lg:bg-transparent rounded" title="Sửa"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
                    <button onclick="deleteLead('${l.id}')" class="p-2 lg:p-1 text-gray-400 hover:text-red-500 bg-gray-100 lg:bg-transparent rounded" title="Xóa"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Mobile Cards ──
    const cardList = document.getElementById('leads-card-list');
    if (filtered.length === 0) {
        cardList.innerHTML = `<div class="text-center py-10 text-gray-400"><span class="material-symbols-outlined text-4xl block mb-2">search_off</span>Chưa có Lead phù hợp</div>`;
    } else {
        cardList.innerHTML = paged.map(l => {
            let badgeClass = 'badge-lead-normal';
            if (l.type === 'Tiềm năng') badgeClass = 'badge-lead-potential';
            if (l.type === 'VIP') badgeClass = 'badge-lead-vip';
            return `
            <div class="mobile-card-item">
                <span class="card-badge ${badgeClass}">${l.type || 'Thường'}</span>
                <div class="card-title text-orange-600">${l.name}</div>
                <div class="card-sub">${l.phone}${l.email ? ' · ' + l.email : ''}</div>
                <div class="card-meta">
                    ${l.source ? `<span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">hub</span>${l.source}</span>` : ''}
                    <span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">schedule</span>${formatDateStr(l.createdAt)}</span>
                </div>
                <div class="card-actions">
                    <button onclick="convertLeadToCustomer('${l.id}')" class="card-action-btn bg-green-50 text-green-600" title="Chuyển KH"><span class="material-symbols-outlined text-[18px]">person_add</span></button>
                    <button onclick='editLead(${JSON.stringify(l).replace(/'/g, "&#39;")})' class="card-action-btn bg-gray-100 dark:bg-slate-700 text-gray-500" title="Sửa"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                    <button onclick="deleteLead('${l.id}')" class="card-action-btn bg-red-50 text-red-400" title="Xóa"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
            </div>`;
        }).join('');
    }

    buildPagination('leads', filtered.length,
        document.getElementById('leads-page-btns'),
        document.getElementById('leads-page-info'), LEADS_PER_PAGE);
};

['search-lead', 'filter-lead-date', 'filter-lead-type'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => { PG.leads = 1; renderLeads(); });
});

// ==============================================
// LEADS CRUD — Thêm / Sửa / Xóa / Chuyển đổi
// ==============================================
document.getElementById('lead-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('lead-id').value;
    const data = {
        name: document.getElementById('lead-name').value.trim(),
        phone: document.getElementById('lead-phone').value.trim(),
        email: document.getElementById('lead-email').value.trim(),
        source: document.getElementById('lead-source').value.trim(),
        type: document.getElementById('lead-type').value,
        note: document.getElementById('lead-note').value.trim(),
    };
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }
    try {
        if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'leads', id), data);
        else await addDoc(getCollectionPath('leads'), { ...data, createdAt: new Date() });
        showToast(id ? 'Cập nhật Lead thành công' : 'Đã thêm Lead mới');
        closeModal('lead-modal');
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Lưu'; } }
});

window.editLead = (data) => openModal('lead-modal', data);

window.deleteLead = async (id) => {
    if (confirm('Xóa Lead này?')) {
        try {
            await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'leads', id));
            showToast('Đã xóa Lead');
        } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    }
};

window.convertLeadToCustomer = (leadId) => {
    const lead = leadsData.find(l => l.id === leadId);
    if (!lead) return;
    openModal('customer-modal', {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        source: lead.source,
        note: lead.note,
        'convert-lead-id': lead.id
    });
    showToast('Bổ sung thêm thông tin để hoàn tất chuyển đổi', 'info');
};

// ==============================================
// CUSTOMERS LOGIC — với responsive card + pagination
// ==============================================
const CUSTOMERS_PER_PAGE = 10;

window.renderCustomers = () => {
    const txt = document.getElementById('search-customer').value.toLowerCase();
    const dt = document.getElementById('filter-customer-date').value;

    const filtered = customersData.filter(c => {
        const matchTxt = c.name.toLowerCase().includes(txt) || (c.phone && c.phone.includes(txt));
        const matchDt = !dt || getISODate(c.createdAt) === dt;
        return matchTxt && matchDt;
    });

    const badge = document.getElementById('customer-count-badge');
    if (badge) badge.textContent = `${filtered.length} KH`;

    const paged = getPageSlice(filtered, 'customers', CUSTOMERS_PER_PAGE);

    // ── Desktop Table ──
    const tbody = document.getElementById('customers-list');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400">
            <span class="material-symbols-outlined text-3xl block mb-2">search_off</span>Chưa có dữ liệu</td></tr>`;
    } else {
        tbody.innerHTML = paged.map(cus => {
            const bankInfoStr = cus.bankName
                ? `${cus.bankName}<br><span class="text-gray-400 font-mono text-[10px]">${cus.bankAccount || ''}</span>`
                : '<span class="text-gray-300 dark:text-gray-600 italic">Chưa có</span>';
            return `
            <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50 transition-colors">
                <td class="py-3 font-semibold text-primary max-w-[150px] sm:max-w-[200px] truncate pl-2">${cus.name}</td>
                <td class="py-3"><div class="text-xs font-mono font-bold">${cus.phone}</div><div class="text-[11px] text-gray-500 max-w-[120px] truncate">${cus.email || ''}</div></td>
                <td class="py-3 text-xs leading-tight whitespace-nowrap">${bankInfoStr}</td>
                <td class="py-3"><div class="text-[11px] text-gray-500 truncate max-w-[100px]">${cus.source || 'N/A'}</div><div class="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">${formatDateStr(cus.createdAt)}</div></td>
                <td class="py-3 text-right pr-2 whitespace-nowrap">
                    <button onclick="previewCustomer('${cus.id}')" class="p-2 lg:p-1 text-blue-500 hover:text-blue-700 mr-1 bg-blue-50 lg:bg-transparent rounded" title="Xem chi tiết"><span class="material-symbols-outlined text-base lg:text-sm">visibility</span></button>
                    <button onclick='editCustomer(${JSON.stringify(cus).replace(/'/g, "&#39;")})' class="p-2 lg:p-1 text-gray-400 hover:text-primary mr-1 bg-gray-100 lg:bg-transparent rounded" title="Sửa"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
                    <button onclick="deleteCustomer('${cus.id}')" class="p-2 lg:p-1 text-gray-400 hover:text-red-500 bg-gray-100 lg:bg-transparent rounded" title="Xóa"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Mobile Cards ──
    const cardList = document.getElementById('customers-card-list');
    if (filtered.length === 0) {
        cardList.innerHTML = `<div class="text-center py-10 text-gray-400"><span class="material-symbols-outlined text-4xl block mb-2">search_off</span>Chưa có dữ liệu</div>`;
    } else {
        cardList.innerHTML = paged.map(cus => `
            <div class="mobile-card-item">
                <div class="card-title text-primary">${cus.name}</div>
                <div class="card-sub">${cus.phone}${cus.email ? ' · ' + cus.email : ''}</div>
                <div class="card-meta">
                    ${cus.bankName ? `<span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">account_balance</span>${cus.bankName}</span>` : ''}
                    ${cus.source ? `<span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">hub</span>${cus.source}</span>` : ''}
                    <span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">schedule</span>${formatDateStr(cus.createdAt)}</span>
                </div>
                <div class="card-actions">
                    <button onclick="previewCustomer('${cus.id}')" class="card-action-btn bg-blue-50 text-blue-500" title="Xem"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
                    <button onclick='editCustomer(${JSON.stringify(cus).replace(/'/g, "&#39;")})' class="card-action-btn bg-gray-100 dark:bg-slate-700 text-gray-500" title="Sửa"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                    <button onclick="deleteCustomer('${cus.id}')" class="card-action-btn bg-red-50 text-red-400" title="Xóa"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
            </div>`).join('');
    }

    buildPagination('customers', filtered.length,
        document.getElementById('customers-page-btns'),
        document.getElementById('customers-page-info'), CUSTOMERS_PER_PAGE);
};

['search-customer', 'filter-customer-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => { PG.customers = 1; renderCustomers(); });
});

// --- CUSTOMERS LOGIC --- (định nghĩa duy nhất — bản đầy đủ với mobile cards ở trên)

document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('cus-id').value;
    const convertLeadId = document.getElementById('cus-convert-lead-id').value;

    const data = {
        name: document.getElementById('cus-name').value.trim(),
        address: document.getElementById('cus-address').value.trim(),
        email: document.getElementById('cus-email').value.trim(),
        phone: document.getElementById('cus-phone').value.trim(),
        bankOwner: document.getElementById('cus-bank-owner').value.trim(),
        bankAccount: document.getElementById('cus-bank-account').value.trim(),
        bankName: document.getElementById('cus-bank-name').value.trim(),
        bankBranch: document.getElementById('cus-bank-branch').value.trim(),
        note: document.getElementById('cus-note').value.trim(),
        source: document.getElementById('cus-source').value.trim(),
        gpkd: document.getElementById('cus-gpkd-data').value,
        cccd: document.getElementById('cus-cccd-data').value,
        storeImage: document.getElementById('cus-store-data').value
    };

    try {
        if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'customers', id), data);
        else await addDoc(getCollectionPath('customers'), { ...data, createdAt: new Date() });

        if (convertLeadId) {
            await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'leads', convertLeadId));
            showToast('Đã chuyển Lead thành Khách Hàng!');
        } else {
            showToast(id ? 'Cập nhật thành công' : 'Đã thêm khách hàng mới');
        }
        closeModal('customer-modal');
    } catch (error) { showToast('Lỗi: ' + error.message, 'error'); }
});
window.editCustomer = (data) => openModal('customer-modal', data);
window.deleteCustomer = async (id) => { if (confirm('Xóa khách hàng này?')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'customers', id)); };

window.previewCustomer = (id) => {
    const cus = customersData.find(c => c.id === id);
    if (!cus) return;

    document.getElementById('prev-cus-name').innerText = cus.name || '---';
    document.getElementById('prev-cus-address').innerText = cus.address || '---';
    document.getElementById('prev-cus-email').innerText = cus.email || '---';
    document.getElementById('prev-cus-phone').innerText = cus.phone || '---';

    document.getElementById('prev-cus-bank-name').innerText = cus.bankName || '---';
    document.getElementById('prev-cus-bank-branch').innerText = cus.bankBranch || '---';
    document.getElementById('prev-cus-bank-owner').innerText = cus.bankOwner || '---';
    document.getElementById('prev-cus-bank-account').innerText = cus.bankAccount || '---';

    document.getElementById('prev-cus-note').innerText = cus.note || '---';

    const sourceEl = document.getElementById('prev-cus-source');
    if (cus.source) { sourceEl.innerText = cus.source; sourceEl.href = cus.source; }
    else { sourceEl.innerText = '---'; sourceEl.removeAttribute('href'); }

    const setPreviewImage = (elId, src) => {
        const img = document.getElementById(elId);
        if (src) { img.src = src; img.style.display = 'block'; img.nextElementSibling.style.display = 'none'; }
        else { img.src = ''; img.style.display = 'none'; img.nextElementSibling.style.display = 'block'; }
    };

    setPreviewImage('prev-cus-gpkd', cus.gpkd);
    setPreviewImage('prev-cus-cccd', cus.cccd);
    setPreviewImage('prev-cus-store', cus.storeImage);

    openModal('customer-preview-modal');
};

// --- SERVICES LOGIC ---
function updateWorkflowServiceSelect() {
    document.getElementById('wfm-service').innerHTML = '<option value="">-- Chọn Dịch Vụ --</option>' + servicesData.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

// function renderServices() {
//     const grid = document.getElementById('services-grid');
//     grid.innerHTML = servicesData.map(srv => `
//         <div class="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm relative overflow-hidden group">
//             <h4 class="font-bold text-lg leading-tight mb-2">${srv.name}</h4>
//             <p class="text-xl font-extrabold text-primary mb-3">${formatCurrency(srv.price)}</p>
//             <p class="text-xs text-gray-500 line-clamp-2 mb-4 h-8">${srv.desc || ''}</p>
//             <div class="flex gap-2">
//                 <button onclick='editService(${JSON.stringify(srv).replace(/'/g, "&#39;")})' class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
//                 <button onclick="deleteService('${srv.id}')" class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
//             </div>
//         </div>
//     `).join('');
//     document.getElementById('quote-services-list').innerHTML = servicesData.map(srv => `
//         <label class="flex items-center gap-3 p-3 lg:p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded cursor-pointer border-b border-gray-100 dark:border-slate-700 last:border-0">
//             <input type="checkbox" class="quote-srv-cb form-checkbox h-5 w-5 lg:h-4 lg:w-4 text-primary rounded" value="${srv.id}" data-name="${srv.name}" data-price="${srv.price}">
//             <div class="flex-1"><div class="text-sm font-semibold">${srv.name}</div><div class="text-xs text-gray-500">${formatCurrency(srv.price)}</div></div>
//         </label>
//     `).join('');
// }

// Dịch vụ: Cập nhật hàm renderServices() để lọc theo tên

// function renderServices() {
//     const grid = document.getElementById('services-grid');
//     const searchEl = document.getElementById('search-service');
//     const keyword = searchEl ? searchEl.value.toLowerCase() : '';
//     const filtered = servicesData.filter(srv =>
//         srv.name.toLowerCase().includes(keyword)
//     );
//     if (filtered.length === 0) {
//         grid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500">${keyword ? 'Không tìm thấy dịch vụ phù hợp.' : 'Chưa có dịch vụ nào.'}</div>`;
//     } else {
//         grid.innerHTML = filtered.map(srv => `
//             <div class="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm relative overflow-hidden group">
//                 <h4 class="font-bold text-lg leading-tight mb-2">${srv.name}</h4>
//                 <p class="text-xl font-extrabold text-primary mb-3">${formatCurrency(srv.price)}</p>
//                 <p class="text-xs text-gray-500 line-clamp-2 mb-4 h-8">${srv.desc || ''}</p>
//                 <div class="flex gap-2">
//                     <button onclick='editService(${JSON.stringify(srv).replace(/'/g, "&#39;")})' class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
//                     <button onclick="deleteService('${srv.id}')" class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
//                 </div>
//             </div>
//         `).join('');
//     }
//     document.getElementById('quote-services-list').innerHTML = servicesData.map(srv => `
//         <label class="flex items-center gap-3 p-3 lg:p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded cursor-pointer border-b border-gray-100 dark:border-slate-700 last:border-0">
//             <input type="checkbox" class="quote-srv-cb form-checkbox h-5 w-5 lg:h-4 lg:w-4 text-primary rounded" value="${srv.id}" data-name="${srv.name}" data-price="${srv.price}">
//             <div class="flex-1"><div class="text-sm font-semibold">${srv.name}</div><div class="text-xs text-gray-500">${formatCurrency(srv.price)}</div></div>
//         </label>
//     `).join('');
// }

// [PATCH 2] Lắng nghe tìm kiếm dịch vụ
// document.getElementById('search-service')?.addEventListener('input', renderServices);

// ==============================================
// SERVICES LOGIC — grid + pagination
// ==============================================
const SERVICES_PER_PAGE = 9; // 3x3 trên desktop

function renderServices() {
    const searchEl = document.getElementById('search-service');
    const keyword = searchEl ? searchEl.value.toLowerCase() : '';
    const filtered = servicesData.filter(s =>
        s.name.toLowerCase().includes(keyword)
    );

    const badge = document.getElementById('service-count-badge');
    if (badge) badge.textContent = `${filtered.length} dịch vụ`;

    const paged = getPageSlice(filtered, 'services', SERVICES_PER_PAGE);
    const grid = document.getElementById('services-grid');

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-gray-400">
            <span class="material-symbols-outlined text-4xl block mb-2">search_off</span>
            ${keyword ? 'Không tìm thấy dịch vụ phù hợp.' : 'Chưa có dịch vụ nào.'}
        </div>`;
    } else {
        grid.innerHTML = paged.map(srv => `
            <div class="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm relative overflow-hidden group flex flex-col">
                <div class="flex items-start justify-between mb-2">
                    <h4 class="font-bold text-base leading-tight flex-1 pr-2">${srv.name}</h4>
                    <div class="flex gap-1.5 shrink-0">
                        <button onclick='editService(${JSON.stringify(srv).replace(/'/g, "&#39;")})' class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary transition-colors"><span class="material-symbols-outlined text-sm">edit</span></button>
                        <button onclick="deleteService('${srv.id}')" class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500 transition-colors"><span class="material-symbols-outlined text-sm">delete</span></button>
                    </div>
                </div>
                <p class="text-lg sm:text-xl font-extrabold text-primary mb-2">${formatCurrency(srv.price)}</p>
                <p class="text-xs text-gray-500 line-clamp-3 flex-1">${srv.desc || '<span class="italic">Không có mô tả.</span>'}</p>
            </div>
        `).join('');
    }

    // Quote services list (không phân trang, dùng toàn bộ)
    document.getElementById('quote-services-list').innerHTML = servicesData.map(srv => `
        <label class="flex items-center gap-3 p-3 lg:p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded cursor-pointer border-b border-gray-100 dark:border-slate-700 last:border-0">
            <input type="checkbox" class="quote-srv-cb form-checkbox h-5 w-5 lg:h-4 lg:w-4 text-primary rounded" value="${srv.id}" data-name="${srv.name}" data-price="${srv.price}">
            <div class="flex-1"><div class="text-sm font-semibold">${srv.name}</div><div class="text-xs text-gray-500">${formatCurrency(srv.price)}</div></div>
        </label>
    `).join('');

    buildPagination('services', filtered.length,
        document.getElementById('services-page-btns'),
        document.getElementById('services-page-info'), SERVICES_PER_PAGE);
}

document.getElementById('search-service')?.addEventListener('input', () => { PG.services = 1; renderServices(); });

document.getElementById('service-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const id = document.getElementById('srv-id').value;
    const data = { name: document.getElementById('srv-name').value, price: Number(document.getElementById('srv-price').value), desc: document.getElementById('srv-desc').value };
    try {
        if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'services', id), data);
        else await addDoc(getCollectionPath('services'), data);
        showToast('Lưu dịch vụ thành công');
        closeModal('service-modal');
    } catch (e) { showToast('Lỗi', 'error'); }
});
window.editService = (data) => openModal('service-modal', data);
window.deleteService = async (id) => { if (confirm('Xóa?')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'services', id)); };

// --- WORKFLOW & JOBS LOGIC ---
window.switchJobsTab = (tab) => {
    ['kanban', 'list', 'workflows', 'report'].forEach(t => {
        document.getElementById(`panel-job-${t}`).classList.add('hidden');
        document.getElementById(`tab-job-${t}`).className = "px-4 py-2 text-sm font-semibold rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap";
    });
    document.getElementById(`panel-job-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-job-${tab}`).className = "px-4 py-2 text-sm font-bold rounded-lg bg-primary text-white shadow whitespace-nowrap";
    if (tab === 'report') updateJobReportCharts();
};

// -> Manage Workflow 
window.addWorkflowStepInput = (val = '') => {
    const container = document.getElementById('workflow-steps-container');
    const div = document.createElement('div');
    div.className = "flex gap-2 items-center wf-step-item bg-white dark:bg-slate-900 p-2 rounded border border-gray-200 dark:border-slate-700";
    div.innerHTML = `
                <span class="material-symbols-outlined text-gray-400 cursor-move" title="Sắp xếp">drag_indicator</span>
                <input type="text" value="${val}" required class="wf-step-input flex-1 px-3 py-1.5 bg-transparent border-none text-sm outline-none focus:ring-0" placeholder="Tên bước...">
                <button type="button" onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 p-1"><span class="material-symbols-outlined text-sm">delete</span></button>
            `;
    container.appendChild(div);
};

document.getElementById('workflow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('wf-doc-id').value;
    const name = document.getElementById('wfm-name').value.trim();
    const serviceId = document.getElementById('wfm-service').value;
    const desc = document.getElementById('wfm-desc').value.trim();

    const stepInputs = document.querySelectorAll('.wf-step-input');
    if (stepInputs.length === 0) return showToast('Cần ít nhất 1 bước', 'error');

    const steps = Array.from(stepInputs).map((input, idx) => ({
        id: 'step_' + new Date().getTime() + '_' + idx,
        name: input.value.trim(),
        order: idx + 1
    }));

    const data = { name, serviceId, desc, steps };

    try {
        if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'workflows', id), data);
        else await addDoc(getCollectionPath('workflows'), { ...data, createdAt: new Date() });
        showToast(id ? 'Cập nhật Workflow thành công' : 'Đã tạo Workflow mới');
        closeModal('workflow-modal');
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
});

window.renderWorkflows = () => {
    const grid = document.getElementById('workflows-grid');
    if (workflowsData.length === 0) return grid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500">Chưa có Workflow mẫu nào.</div>`;
    grid.innerHTML = workflowsData.map(wf => {
        const srv = servicesData.find(s => s.id === wf.serviceId);
        return `
                <div class="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm relative flex flex-col">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold text-base leading-tight pr-8">${wf.name}</h4>
                        <div class="absolute top-4 right-4 flex gap-1">
                            <button onclick='editWorkflow(${JSON.stringify(wf).replace(/'/g, "&#39;")})' class="text-gray-400 hover:text-primary"><span class="material-symbols-outlined text-sm">edit</span></button>
                            <button onclick="deleteWorkflow('${wf.id}')" class="text-gray-400 hover:text-red-500"><span class="material-symbols-outlined text-sm">delete</span></button>
                        </div>
                    </div>
                    <p class="text-xs text-primary font-semibold mb-2">${srv ? srv.name : 'Dịch vụ đã xoá'}</p>
                    <p class="text-xs text-gray-500 mb-4 line-clamp-2">${wf.desc || 'Không có mô tả'}</p>
                    
                    <div class="mt-auto bg-gray-50 dark:bg-slate-900/50 p-3 rounded-lg border border-gray-100 dark:border-slate-700">
                        <p class="text-[10px] font-bold text-gray-500 uppercase mb-2">Các bước (${wf.steps ? wf.steps.length : 0})</p>
                        <div class="flex flex-col gap-1.5">
                            ${(wf.steps || []).slice(0, 3).map((s, i) => `<div class="text-xs flex gap-2"><span class="text-gray-400">${i + 1}.</span> <span class="truncate">${s.name}</span></div>`).join('')}
                            ${wf.steps && wf.steps.length > 3 ? `<div class="text-[10px] text-gray-400 italic">... và ${wf.steps.length - 3} bước khác</div>` : ''}
                        </div>
                    </div>
                </div>
            `}).join('');
};

window.editWorkflow = (data) => openModal('workflow-modal', data);
window.deleteWorkflow = async (id) => { if (confirm('Xóa Workflow này? Không ảnh hưởng đến các Job đã tạo.')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'workflows', id)); };

// -> Manage Jobs
function updateJobCustomerSelect() {
    document.getElementById('job-customer').innerHTML = '<option value="">-- Chọn Khách hàng --</option>' + customersData.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('');
}
function updateJobWorkflowSelect() {
    document.getElementById('job-workflow').innerHTML = '<option value="">-- Chọn Workflow --</option>' + workflowsData.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
}
function updateKanbanWorkflowSelect() {
    const select = document.getElementById('kanban-workflow-select');
    const current = select.value;
    select.innerHTML = '<option value="">-- Chọn Quy trình để xem bảng --</option>' + workflowsData.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    if (workflowsData.find(w => w.id === current)) select.value = current;
    else if (workflowsData.length > 0) select.value = workflowsData[0].id;
    renderJobsKanban();
}

document.getElementById('job-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('job-name').value.trim();
    const customerId = document.getElementById('job-customer').value;
    const workflowId = document.getElementById('job-workflow').value;

    const wf = workflowsData.find(w => w.id === workflowId);
    if (!wf || !wf.steps || wf.steps.length === 0) return showToast('Workflow này bị lỗi hoặc không có bước nào', 'error');

    const jobSteps = wf.steps.map(s => ({
        id: s.id,
        name: s.name,
        order: s.order,
        status: 'pending', // pending, doing, done
        assignee: '',
        deadline: '',
        note: ''
    }));

    const data = {
        name,
        customerId,
        workflowId,
        serviceId: wf.serviceId,
        status: 'doing', // overall status: doing / done
        steps: jobSteps,
        createdAt: new Date()
    };

    try {
        await addDoc(getCollectionPath('jobs'), data);
        showToast('Tạo Job thành công!');
        closeModal('job-modal');
        switchJobsTab('kanban');
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
});

// -> Render Job List Table
window.renderJobsTable = () => {
    const txt = document.getElementById('search-job-list').value.toLowerCase();
    const st = document.getElementById('filter-job-status').value;
    const tbody = document.getElementById('jobs-list-tbody');

    const filtered = jobsData.filter(j => {
        const matchTxt = j.name.toLowerCase().includes(txt);
        const matchSt = !st || j.status === st;
        return matchTxt && matchSt;
    });

    if (filtered.length === 0) return tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">Chưa có công việc nào</td></tr>`;

    tbody.innerHTML = filtered.map(job => {
        const cus = customersData.find(c => c.id === job.customerId);
        const wf = workflowsData.find(w => w.id === job.workflowId);
        const doneSteps = job.steps ? job.steps.filter(s => s.status === 'done').length : 0;
        const totalSteps = job.steps ? job.steps.length : 1;
        const isDone = job.status === 'done';

        return `
                <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50 transition-colors cursor-pointer" onclick="openJobDetail('${job.id}')">
                    <td class="py-3 font-semibold text-primary pl-2 max-w-[200px] truncate">${job.name}</td>
                    <td class="py-3 text-sm">${cus ? cus.name : 'N/A'}</td>
                    <td class="py-3 text-xs text-gray-500">${wf ? wf.name : 'N/A'}</td>
                    <td class="py-3 text-center">
                        <div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold ${isDone ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
                            ${isDone ? 'Hoàn thành' : 'Đang làm'} (${doneSteps}/${totalSteps})
                        </div>
                    </td>
                    <td class="py-3 text-xs text-gray-500">${formatDateStr(job.createdAt)}</td>
                    <td class="py-3 text-right pr-2">
                        <button class="p-2 lg:p-1 text-gray-400 hover:text-red-500 bg-gray-100 lg:bg-transparent rounded" onclick="event.stopPropagation(); deleteJob('${job.id}')" title="Xóa"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
                    </td>
                </tr>
            `}).join('');
};
['search-job-list', 'filter-job-status'].forEach(id => document.getElementById(id)?.addEventListener('input', renderJobsTable));

window.deleteJob = async (id) => { if (confirm('Xoá công việc này?')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'jobs', id)); };

// -> Kanban Board Logic — Slideshow / Carousel
let _kanbanCols = [];         // [{id, name}]
let _kanbanJobMap = {};       // {colId: [{job, cus, assigneeStr}]}
let _kanbanColCounts = {};
let _kanbanSlideIdx = 0;      // current slide index

window.renderJobsKanban = () => {
    const wfId = document.getElementById('kanban-workflow-select').value;
    const container = document.getElementById('kanban-board');
    if (!wfId) {
        container.innerHTML = `<div class="w-full text-center py-10 text-gray-500 flex flex-col items-center gap-2">
            <span class="material-symbols-outlined text-4xl text-gray-300">account_tree</span>
            <p>Vui lòng chọn 1 Quy trình để xem bảng Kanban</p></div>`;
        return;
    }

    const wf = workflowsData.find(w => w.id === wfId);
    if (!wf || !wf.steps) return;

    _kanbanCols = [...wf.steps.sort((a, b) => a.order - b.order), { id: 'col_done', name: '✅ Hoàn Thành' }];
    _kanbanJobMap = {};
    _kanbanColCounts = {};
    _kanbanCols.forEach(c => { _kanbanJobMap[c.id] = []; _kanbanColCounts[c.id] = 0; });

    const relevantJobs = jobsData.filter(j => j.workflowId === wfId);
    relevantJobs.forEach(job => {
        let currentStepId = 'col_done';
        if (job.status !== 'done') {
            const activeStep = (job.steps || []).sort((a, b) => a.order - b.order).find(s => s.status !== 'done');
            if (activeStep) currentStepId = activeStep.id;
        }
        if (!_kanbanJobMap[currentStepId]) currentStepId = _kanbanCols[0].id;
        _kanbanColCounts[currentStepId]++;
        const cus = customersData.find(c => c.id === job.customerId);
        const activeStepObj = (job.steps || []).find(s => s.id === currentStepId);
        const assigneeStr = activeStepObj?.assignee
            ? `<div class="mt-2 text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-2 py-1 rounded-full inline-flex items-center gap-1">
                <span class="material-symbols-outlined text-[10px]">person</span>${activeStepObj.assignee}</div>`
            : '';
        _kanbanJobMap[currentStepId].push({ job, cus, assigneeStr });
    });

    // Clamp slide index
    if (_kanbanSlideIdx >= _kanbanCols.length) _kanbanSlideIdx = 0;

    // Build HTML
    const totalCols = _kanbanCols.length;
    const dotsHtml = _kanbanCols.map((col, i) => `
        <button class="kanban-dot ${i === _kanbanSlideIdx ? 'active' : ''}" onclick="kanbanGoSlide(${i})" title="${col.name}"></button>`).join('');

    const slidesHtml = _kanbanCols.map((col, i) => {
        const cards = _kanbanJobMap[col.id].map(({ job, cus, assigneeStr }) => `
            <div class="kanban-card" draggable="true" ondragstart="dragStartKanban(event)"
                 data-job-id="${job.id}" onclick="openJobDetail('${job.id}')">
                <div class="text-[10px] text-gray-400 mb-1.5 flex justify-between">
                    <span class="font-mono">#${job.id.slice(-5)}</span>
                    <span>${formatDateStr(job.createdAt).split(' ')[0]}</span>
                </div>
                <h5 class="font-bold text-sm text-gray-800 dark:text-gray-200 leading-snug mb-1">${job.name}</h5>
                <p class="text-xs text-primary font-medium truncate">
                    <span class="material-symbols-outlined text-[12px] align-middle">business</span> ${cus ? cus.name : 'Unknown'}
                </p>
                ${assigneeStr}
            </div>`).join('') || `<div class="text-center text-gray-400 dark:text-gray-600 py-10 text-sm">
                <span class="material-symbols-outlined text-3xl block mb-2">inbox</span>Không có job nào</div>`;

        return `<div class="kanban-slide ${i === _kanbanSlideIdx ? 'active' : ''}"
                     data-col-id="${col.id}"
                     ondragover="allowDrop(event)" ondrop="dropKanban(event)">
            <div class="kanban-cards-container" id="cards-${col.id}">${cards}</div>
        </div>`;
    }).join('');

    const prevCol = _kanbanCols[_kanbanSlideIdx - 1];
    const nextCol = _kanbanCols[_kanbanSlideIdx + 1];
    const curCol  = _kanbanCols[_kanbanSlideIdx];
    const curCount = _kanbanColCounts[curCol.id] || 0;

    container.innerHTML = `
        <div class="kanban-slider-wrapper">
            <!-- Navigation header -->
            <div class="kanban-slider-nav">
                <button class="kanban-nav-btn ${_kanbanSlideIdx === 0 ? 'opacity-30 cursor-not-allowed' : ''}"
                        onclick="kanbanGoSlide(${_kanbanSlideIdx - 1})" ${_kanbanSlideIdx === 0 ? 'disabled' : ''}>
                    <span class="material-symbols-outlined">chevron_left</span>
                </button>

                <div class="kanban-step-info">
                    <div class="kanban-step-label">
                        <span class="kanban-step-num">${_kanbanSlideIdx + 1}/${totalCols}</span>
                        <span class="kanban-step-name">${curCol.name}</span>
                        <span class="kanban-step-count">${curCount} job</span>
                    </div>
                    <div class="kanban-step-sub">
                        ${prevCol ? `<span class="kanban-adjacent prev">← ${prevCol.name}</span>` : ''}
                        ${nextCol ? `<span class="kanban-adjacent next">${nextCol.name} →</span>` : ''}
                    </div>
                </div>

                <button class="kanban-nav-btn ${_kanbanSlideIdx === totalCols - 1 ? 'opacity-30 cursor-not-allowed' : ''}"
                        onclick="kanbanGoSlide(${_kanbanSlideIdx + 1})" ${_kanbanSlideIdx === totalCols - 1 ? 'disabled' : ''}>
                    <span class="material-symbols-outlined">chevron_right</span>
                </button>
            </div>

            <!-- Progress bar -->
            <div class="kanban-progress-bar">
                <div class="kanban-progress-fill" style="width:${((_kanbanSlideIdx + 1) / totalCols) * 100}%"></div>
            </div>

            <!-- Slides -->
            <div class="kanban-slides-viewport" id="kanban-slides-viewport">
                <div class="kanban-slides-track" id="kanban-slides-track"
                     style="transform: translateX(-${_kanbanSlideIdx * 100}%)">
                    ${slidesHtml}
                </div>
            </div>

            <!-- Dots -->
            <div class="kanban-dots-row">${dotsHtml}</div>
        </div>`;

    // Bind swipe gestures
    _bindKanbanSwipe();
};

window.kanbanGoSlide = (idx) => {
    if (idx < 0 || idx >= _kanbanCols.length) return;
    _kanbanSlideIdx = idx;
    // Update track position
    const track = document.getElementById('kanban-slides-track');
    if (track) track.style.transform = `translateX(-${idx * 100}%)`;
    // Re-render nav header only (full re-render causes flicker)
    window.renderJobsKanban();
};

// Swipe gesture binding
function _bindKanbanSwipe() {
    const viewport = document.getElementById('kanban-slides-viewport');
    if (!viewport) return;
    let startX = 0, isDragging = false;
    viewport.addEventListener('touchstart', e => { startX = e.touches[0].clientX; isDragging = true; }, { passive: true });
    viewport.addEventListener('touchend', e => {
        if (!isDragging) return;
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) diff > 0 ? kanbanGoSlide(_kanbanSlideIdx + 1) : kanbanGoSlide(_kanbanSlideIdx - 1);
        isDragging = false;
    }, { passive: true });
    // Mouse drag (desktop)
    viewport.addEventListener('mousedown', e => { startX = e.clientX; isDragging = true; });
    viewport.addEventListener('mouseup', e => {
        if (!isDragging) return;
        const diff = startX - e.clientX;
        if (Math.abs(diff) > 60) diff > 0 ? kanbanGoSlide(_kanbanSlideIdx + 1) : kanbanGoSlide(_kanbanSlideIdx - 1);
        isDragging = false;
    });
    viewport.addEventListener('mouseleave', () => { isDragging = false; });
}


window.allowDrop = (ev) => {
    ev.preventDefault();
    const slide = ev.currentTarget.closest ? ev.currentTarget.closest('.kanban-slide') : ev.currentTarget;
    if (slide) slide.classList.add('drag-over');
};
window.dragStartKanban = (ev) => { ev.dataTransfer.setData("jobId", ev.currentTarget.dataset.jobId); };
window.dropKanban = async (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.kanban-slide').forEach(el => el.classList.remove('drag-over'));

    const slide = ev.currentTarget.closest ? ev.currentTarget.closest('.kanban-slide') : ev.currentTarget;
    const targetStepId = slide ? slide.dataset.colId : ev.currentTarget.dataset.colId;

    if (!jobId || !targetStepId) return;

    const job = jobsData.find(j => j.id === jobId);
    if (!job) return;

    const wf = workflowsData.find(w => w.id === job.workflowId);
    if (!wf || !wf.steps) return;

    let updatedSteps = [...job.steps].sort((a, b) => a.order - b.order);
    let overallStatus = 'doing';

    if (targetStepId === 'col_done') {
        updatedSteps = updatedSteps.map(s => ({ ...s, status: 'done' }));
        overallStatus = 'done';
    } else {
        // Find index of target step in workflow
        const targetOrder = wf.steps.find(s => s.id === targetStepId)?.order || 0;
        updatedSteps = updatedSteps.map(s => {
            if (s.order < targetOrder) return { ...s, status: 'done' };
            if (s.order === targetOrder) return { ...s, status: 'doing' }; // Current active
            return { ...s, status: 'pending' };
        });
    }

    try {
        await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'jobs', jobId), { steps: updatedSteps, status: overallStatus });
        showToast('Đã cập nhật trạng thái Job');
    } catch (err) { showToast('Lỗi cập nhật: ' + err.message, 'error'); }
};

// -> Job Detail Modal
let currentEditingJobId = null;
window.openJobDetail = (jobId) => {
    const job = jobsData.find(j => j.id === jobId);
    if (!job) return;
    currentEditingJobId = jobId;

    const cus = customersData.find(c => c.id === job.customerId);
    const wf = workflowsData.find(w => w.id === job.workflowId);

    document.getElementById('jd-name').innerText = job.name;
    document.getElementById('jd-customer').innerText = cus ? cus.name : 'Unknown';
    document.getElementById('jd-workflow').innerText = wf ? wf.name : 'Unknown';

    // Progress
    const steps = job.steps || [];
    const doneSteps = steps.filter(s => s.status === 'done').length;
    const percent = steps.length === 0 ? 0 : Math.round((doneSteps / steps.length) * 100);
    document.getElementById('jd-progress-text').innerText = `${percent}% (${doneSteps}/${steps.length})`;
    document.getElementById('jd-progress-bar').style.width = `${percent}%`;

    // Steps List Render
    const container = document.getElementById('jd-steps-container');
    container.innerHTML = steps.sort((a, b) => a.order - b.order).map((s, i) => `
                <div class="border border-gray-200 dark:border-slate-700 rounded-xl p-4 ${s.status === 'done' ? 'bg-green-50/50 dark:bg-green-900/10' : s.status === 'doing' ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'bg-white dark:bg-slate-800'} transition-colors">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-3 pb-3 border-b border-gray-100 dark:border-slate-700">
                        <div class="font-bold flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 text-xs flex items-center justify-center">${i + 1}</span>
                            ${s.name}
                        </div>
                        <select onchange="updateSingleStepStatus('${s.id}', this.value)" class="px-3 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm font-semibold outline-none focus:ring-2 ${s.status === 'done' ? 'text-green-600 border-green-200' : s.status === 'doing' ? 'text-blue-600 border-blue-200' : ''}">
                            <option value="pending" ${s.status === 'pending' ? 'selected' : ''}>⏳ Chờ xử lý</option>
                            <option value="doing" ${s.status === 'doing' ? 'selected' : ''}>🚀 Đang làm</option>
                            <option value="done" ${s.status === 'done' ? 'selected' : ''}>✅ Hoàn thành</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-gray-500 mb-1">Người phụ trách (Assignee)</label>
                            <input type="text" id="js_ass_${s.id}" value="${s.assignee || ''}" onblur="saveStepInfo('${s.id}')" placeholder="Tên NV..." class="w-full px-3 py-2 bg-transparent border border-gray-200 dark:border-slate-600 rounded text-sm outline-none focus:border-primary">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-gray-500 mb-1">Hạn chót (Deadline)</label>
                            <input type="date" id="js_dead_${s.id}" value="${s.deadline || ''}" onblur="saveStepInfo('${s.id}')" class="w-full px-3 py-2 bg-transparent border border-gray-200 dark:border-slate-600 rounded text-sm outline-none focus:border-primary">
                        </div>
                        <div class="sm:col-span-2">
                            <label class="block text-xs font-semibold text-gray-500 mb-1">Ghi chú nội bộ</label>
                            <textarea id="js_note_${s.id}" rows="2" onblur="saveStepInfo('${s.id}')" placeholder="Tiến độ, link file, v.v..." class="w-full px-3 py-2 bg-transparent border border-gray-200 dark:border-slate-600 rounded text-sm outline-none focus:border-primary">${s.note || ''}</textarea>
                        </div>
                    </div>
                </div>
            `).join('');

    openModal('job-detail-modal');
};

window.updateSingleStepStatus = async (stepId, newStatus) => {
    const job = jobsData.find(j => j.id === currentEditingJobId);
    if (!job) return;
    const updatedSteps = job.steps.map(s => s.id === stepId ? { ...s, status: newStatus } : s);
    const allDone = updatedSteps.every(s => s.status === 'done');

    try {
        await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'jobs', job.id), { steps: updatedSteps, status: allDone ? 'done' : 'doing' });
        // Do not close modal, it will re-render via onSnapshot but input focus might be lost. 
        // Because onSnapshot fires, jobsData updates, but we need to re-call openJobDetail to update UI
        // A better UX is silent update, let the DB sync. We re-render only progress.
        setTimeout(() => openJobDetail(job.id), 100);
    } catch (e) { showToast('Lỗi', 'error'); }
};

window.saveStepInfo = async (stepId) => {
    const job = jobsData.find(j => j.id === currentEditingJobId);
    if (!job) return;
    const ass = document.getElementById(`js_ass_${stepId}`).value;
    const dead = document.getElementById(`js_dead_${stepId}`).value;
    const note = document.getElementById(`js_note_${stepId}`).value;

    const updatedSteps = job.steps.map(s => s.id === stepId ? { ...s, assignee: ass, deadline: dead, note: note } : s);
    // Check if actually changed to avoid spamming writes
    const oldStep = job.steps.find(s => s.id === stepId);
    if (oldStep.assignee === ass && oldStep.deadline === dead && oldStep.note === note) return;

    try { await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'jobs', job.id), { steps: updatedSteps }); } catch (e) { }
};

// -> Reports & Stats
let jobStatusChartInst = null;
let jobWfChartInst = null;

window.renderJobReports = () => {
    // Stats Panel
    document.getElementById('report-total-jobs').innerText = jobsData.length;
    document.getElementById('report-doing-jobs').innerText = jobsData.filter(j => j.status === 'doing').length;
    document.getElementById('report-done-jobs').innerText = jobsData.filter(j => j.status === 'done').length;
    if (document.getElementById('panel-job-report').classList.contains('hidden')) return; // Only draw charts if visible
    updateJobReportCharts();
};

function updateJobReportCharts() {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#cbd5e1' : '#64748b';

    // Chart 1: Status Donut
    const doing = jobsData.filter(j => j.status === 'doing').length;
    const done = jobsData.filter(j => j.status === 'done').length;
    if (jobStatusChartInst) jobStatusChartInst.destroy();
    jobStatusChartInst = new Chart(document.getElementById('jobStatusChart'), {
        type: 'doughnut',
        data: { labels: ['Đang làm', 'Hoàn thành'], datasets: [{ data: [doing, done], backgroundColor: ['#f97316', '#22c55e'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
    });

    // Chart 2: By Workflow
    const wfCounts = {};
    workflowsData.forEach(w => wfCounts[w.name] = 0);
    jobsData.forEach(j => {
        const wf = workflowsData.find(w => w.id === j.workflowId);
        if (wf) wfCounts[wf.name]++;
    });
    const wfLabels = Object.keys(wfCounts);
    const wfData = Object.values(wfCounts);

    if (jobWfChartInst) jobWfChartInst.destroy();
    jobWfChartInst = new Chart(document.getElementById('jobWorkflowChart'), {
        type: 'bar',
        data: { labels: wfLabels, datasets: [{ label: 'Số lượng Job', data: wfData, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor, display: false } } }, plugins: { legend: { display: false } } }
    });
}

// --- WEB FEATURES LOGIC ---
document.getElementById('wf-image-file').addEventListener('change', function (e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { showToast('Ảnh < 1.5MB.', 'error'); this.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function (event) {
        const b64 = event.target.result;
        document.getElementById('wf-image-data').value = b64;
        document.getElementById('wf-image-preview').src = b64;
        document.getElementById('wf-image-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
});

window.clearWebFeatureImage = () => {
    document.getElementById('wf-image-file').value = '';
    document.getElementById('wf-image-data').value = '';
    document.getElementById('wf-image-preview-container').classList.add('hidden');
    document.getElementById('wf-image-preview').src = '';
}

// function renderWebfeatures() {
//     const grid = document.getElementById('webfeatures-grid');
//     if (webfeaturesData.length === 0) return grid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500">Chưa có tính năng nào.</div>`;

//     grid.innerHTML = webfeaturesData.map(wf => `
//         <div class="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col relative group">
//             <div class="h-40 sm:h-32 bg-gray-100 dark:bg-slate-700 relative flex-shrink-0">
//                 ${wf.image ? `<img src="${wf.image}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/400x200/e2e8f0/64748b?text=No+Image'">` : `<div class="flex items-center justify-center h-full text-gray-400"><span class="material-symbols-outlined text-4xl">image</span></div>`}
//                 <div class="absolute inset-0 bg-black/50 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
//                     <button onclick="viewWebfeature('${wf.id}')" class="w-12 h-12 lg:w-9 lg:h-9 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">visibility</span></button>
//                     ${wf.demo ? `<a href="${wf.demo}" target="_blank" class="w-12 h-12 lg:w-9 lg:h-9 rounded-full bg-blue-500 text-white flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">open_in_new</span></a>` : ''}
//                 </div>
//             </div>
//             <div class="p-4 flex-1 flex flex-col">
//                 <h4 class="font-bold text-base leading-tight mb-1 truncate" title="${wf.name}">${wf.name}</h4>
//                 <p class="text-sm font-extrabold text-primary mb-2">${formatCurrency(wf.price)}</p>
//                 <p class="text-xs text-gray-500 line-clamp-2 mb-4 flex-1">${wf.desc || 'Không có mô tả.'}</p>
//                 <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 mt-auto">
//                     <button onclick='editWebfeature(${JSON.stringify(wf).replace(/'/g, "&#39;")})' class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
//                     <button onclick="deleteWebfeature('${wf.id}')" class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
//                 </div>
//             </div>
//         </div>
//     `).join('');
// }

// tìm kiếm tính năng
// function renderWebfeatures() {
//     const grid = document.getElementById('webfeatures-grid');
//     const searchEl = document.getElementById('search-webfeature');
//     const keyword = searchEl ? searchEl.value.toLowerCase() : '';
//     const filtered = webfeaturesData.filter(wf =>
//         wf.name.toLowerCase().includes(keyword) ||
//         (wf.desc || '').toLowerCase().includes(keyword)
//     );
//     if (filtered.length === 0) {
//         grid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500">${keyword ? 'Không tìm thấy tính năng phù hợp.' : 'Chưa có tính năng nào.'}</div>`;
//         return;
//     }
//     grid.innerHTML = filtered.map(wf => `
//         <div class="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col relative group">
//             <div class="h-40 sm:h-32 bg-gray-100 dark:bg-slate-700 relative flex-shrink-0">
//                 ${wf.image ? `<img src="${wf.image}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/400x200/e2e8f0/64748b?text=No+Image'">` : `<div class="flex items-center justify-center h-full text-gray-400"><span class="material-symbols-outlined text-4xl">image</span></div>`}
//                 <div class="absolute inset-0 bg-black/50 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
//                     <button onclick="viewWebfeature('${wf.id}')" class="w-12 h-12 lg:w-9 lg:h-9 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">visibility</span></button>
//                     ${wf.demo ? `<a href="${wf.demo}" target="_blank" class="w-12 h-12 lg:w-9 lg:h-9 rounded-full bg-blue-500 text-white flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">open_in_new</span></a>` : ''}
//                 </div>
//             </div>
//             <div class="p-4 flex-1 flex flex-col">
//                 <h4 class="font-bold text-base leading-tight mb-1 truncate" title="${wf.name}">${wf.name}</h4>
//                 <p class="text-sm font-extrabold text-primary mb-2">${formatCurrency(wf.price)}</p>
//                 <p class="text-xs text-gray-500 line-clamp-2 mb-4 flex-1">${wf.desc || 'Không có mô tả.'}</p>
//                 <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 mt-auto">
//                     <button onclick='editWebfeature(${JSON.stringify(wf).replace(/'/g, "&#39;")})' class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
//                     <button onclick="deleteWebfeature('${wf.id}')" class="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
//                 </div>
//             </div>
//         </div>
//     `).join('');
// }

// [PATCH 4] Lắng nghe tìm kiếm tính năng website
//document.getElementById('search-webfeature')?.addEventListener('input', renderWebfeatures);
// ==============================================
// WEB FEATURES LOGIC — grid + pagination
// ==============================================
const WEBFEATURES_PER_PAGE = 8; // 4x2 trên desktop

function renderWebfeatures() {
    const searchEl = document.getElementById('search-webfeature');
    const keyword = searchEl ? searchEl.value.toLowerCase() : '';
    const filtered = webfeaturesData.filter(wf =>
        wf.name.toLowerCase().includes(keyword) ||
        (wf.desc || '').toLowerCase().includes(keyword)
    );

    const badge = document.getElementById('webfeature-count-badge');
    if (badge) badge.textContent = `${filtered.length} tính năng`;

    const paged = getPageSlice(filtered, 'webfeatures', WEBFEATURES_PER_PAGE);
    const grid = document.getElementById('webfeatures-grid');

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-gray-400">
            <span class="material-symbols-outlined text-4xl block mb-2">search_off</span>
            ${keyword ? 'Không tìm thấy tính năng phù hợp.' : 'Chưa có tính năng nào.'}
        </div>`;
    } else {
        grid.innerHTML = paged.map(wf => `
            <div class="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col relative group">
                <div class="h-36 sm:h-32 bg-gray-100 dark:bg-slate-700 relative flex-shrink-0">
                    ${wf.image
                ? `<img src="${wf.image}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/400x200/e2e8f0/64748b?text=No+Image'">`
                : `<div class="flex items-center justify-center h-full text-gray-400"><span class="material-symbols-outlined text-4xl">image</span></div>`}
                    <div class="absolute inset-0 bg-black/50 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button onclick="viewWebfeature('${wf.id}')" class="w-11 h-11 lg:w-9 lg:h-9 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">visibility</span></button>
                        ${wf.demo ? `<a href="${wf.demo}" target="_blank" class="w-11 h-11 lg:w-9 lg:h-9 rounded-full bg-blue-500 text-white flex items-center justify-center hover:scale-110 shadow"><span class="material-symbols-outlined text-base lg:text-sm">open_in_new</span></a>` : ''}
                    </div>
                </div>
                <div class="p-3 sm:p-4 flex-1 flex flex-col">
                    <h4 class="font-bold text-sm sm:text-base leading-tight mb-1 truncate" title="${wf.name}">${wf.name}</h4>
                    <p class="text-sm font-extrabold text-primary mb-2">${formatCurrency(wf.price)}</p>
                    <p class="text-xs text-gray-500 line-clamp-2 flex-1">${wf.desc || 'Không có mô tả.'}</p>
                    <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 mt-3">
                        <button onclick='editWebfeature(${JSON.stringify(wf).replace(/'/g, "&#39;")})' class="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-primary transition-colors"><span class="material-symbols-outlined text-sm">edit</span></button>
                        <button onclick="deleteWebfeature('${wf.id}')" class="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:text-red-500 transition-colors"><span class="material-symbols-outlined text-sm">delete</span></button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    buildPagination('webfeatures', filtered.length,
        document.getElementById('webfeatures-page-btns'),
        document.getElementById('webfeatures-page-info'), WEBFEATURES_PER_PAGE);
}

document.getElementById('search-webfeature')?.addEventListener('input', () => { PG.webfeatures = 1; renderWebfeatures(); });

document.getElementById('webfeature-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('wf-id').value;
    const data = {
        name: document.getElementById('wf-name').value,
        image: document.getElementById('wf-image-data').value,
        price: Number(document.getElementById('wf-price').value),
        demo: document.getElementById('wf-demo').value,
        desc: document.getElementById('wf-desc').value
    };
    try {
        if (id) await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'webfeatures', id), data);
        else await addDoc(getCollectionPath('webfeatures'), { ...data, createdAt: new Date() });
        showToast(id ? 'Cập nhật tính năng thành công' : 'Đã thêm tính năng Website');
        closeModal('webfeature-modal');
    } catch (error) { showToast('Lỗi khi lưu', 'error'); }
});

window.editWebfeature = (data) => openModal('webfeature-modal', data);
window.deleteWebfeature = async (id) => { if (confirm('Xóa tính năng này?')) await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'webfeatures', id)); };
window.viewWebfeature = (id) => {
    const wf = webfeaturesData.find(w => w.id === id); if (!wf) return;
    document.getElementById('view-wf-image').src = wf.image || 'https://placehold.co/600x300/e2e8f0/64748b?text=No+Image';
    document.getElementById('view-wf-name').innerText = wf.name;
    document.getElementById('view-wf-price').innerText = formatCurrency(wf.price);
    document.getElementById('view-wf-desc').innerText = wf.desc || 'Chưa có mô tả chi tiết.';
    const demoBtn = document.getElementById('view-wf-demo-btn');
    if (wf.demo) { demoBtn.href = wf.demo; demoBtn.classList.remove('hidden'); demoBtn.classList.add('flex'); }
    else { demoBtn.classList.add('hidden'); demoBtn.classList.remove('flex'); }
    openModal('webfeature-view-modal');
};

// --- TEMPLATES LOGIC ---
function updateTemplateSelector() {
    const selector = document.getElementById('template-selector');
    const currentSelection = selector.value;
    selector.innerHTML = '<option value="">-- Chọn Mẫu Word --</option>' + templatesData.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (templatesData.find(t => t.id === currentSelection)) selector.value = currentSelection;
}

window.renderTemplatesList = () => {
    const tbody = document.getElementById('templates-list');
    if (templatesData.length === 0) return tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-gray-500">Chưa có mẫu nào được lưu</td></tr>`;
    tbody.innerHTML = templatesData.map(tpl => `
                <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50">
                    <td class="py-3 font-semibold text-primary pl-2">${tpl.name}</td>
                    <td class="py-3 text-xs text-gray-500">${tpl.fields ? tpl.fields.length : 0} trường trống</td>
                    <td class="py-3 text-right pr-2 whitespace-nowrap">
                        <button onclick="selectTemplateToView('${tpl.id}')" class="p-2 lg:p-1 text-gray-400 hover:text-green-500 mr-1 bg-gray-100 lg:bg-transparent rounded" title="Sử dụng"><span class="material-symbols-outlined text-base lg:text-sm">visibility</span></button>
                        <button onclick='editTemplate(${JSON.stringify(tpl).replace(/'/g, "&#39;")})' class="p-2 lg:p-1 text-gray-400 hover:text-primary mr-1 bg-gray-100 lg:bg-transparent rounded" title="Sửa tên"><span class="material-symbols-outlined text-base lg:text-sm">edit</span></button>
                        <button onclick="deleteTemplate('${tpl.id}')" class="p-2 lg:p-1 text-gray-400 hover:text-red-500 bg-gray-100 lg:bg-transparent rounded" title="Xóa"><span class="material-symbols-outlined text-base lg:text-sm">delete</span></button>
                    </td>
                </tr>
            `).join('');
};

window.selectTemplateToView = (id) => { closeModal('template-manage-modal'); document.getElementById('template-selector').value = id; loadSelectedTemplate(); };
window.editTemplate = (tpl) => { document.getElementById('edit-tpl-id').value = tpl.id; document.getElementById('edit-tpl-name').value = tpl.name; openModal('template-edit-modal'); };

document.getElementById('template-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const id = document.getElementById('edit-tpl-id').value; const newName = document.getElementById('edit-tpl-name').value.trim();
    if (newName) { try { await updateDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'templates', id), { name: newName }); showToast('Đã cập nhật tên mẫu'); closeModal('template-edit-modal'); } catch (err) { } }
});
window.deleteTemplate = async (id) => {
    if (confirm('Xóa vĩnh viễn mẫu hợp đồng này?')) {
        try { await deleteDoc(doc(db, 'artifacts', app_id, 'public', 'data', 'templates', id)); showToast('Đã xóa mẫu'); if (document.getElementById('template-selector').value === id) { document.getElementById('template-selector').value = ''; loadSelectedTemplate(); } } catch (err) { }
    }
};

document.getElementById('tpl-file').addEventListener('change', function (e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (loadEvent) {
        const arrayBuffer = loadEvent.target.result;
        mammoth.convertToHtml({ arrayBuffer: arrayBuffer }).then(function (result) {
            let html = result.value; let blankCounter = 1; const blankRegex = /(\.{3,}|…{2,}|_{3,})/g;
            html = html.replace(blankRegex, function () { return `{{Trống_${blankCounter++}}}`; });
            window.tempExtractedHtml = html;
            const regex = /\{\{([^}]+)\}\}/g; const fieldsFound = new Set(); let match;
            while ((match = regex.exec(html)) !== null) fieldsFound.add(match[1].trim());
            window.tempExtractedFields = Array.from(fieldsFound);
            const statusDiv = document.getElementById('tpl-extract-status'); const fieldsDiv = document.getElementById('tpl-detected-fields');
            statusDiv.classList.remove('hidden');
            if (window.tempExtractedFields.length > 0) fieldsDiv.innerHTML = window.tempExtractedFields.map(f => `<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-[11px] font-mono">{{${f}}}</span>`).join('');
            else fieldsDiv.innerHTML = `<span class="text-sm text-gray-500">Không tìm thấy trường trống.</span>`;
        }).catch(function (err) { showToast("Lỗi đọc file Word.", "error"); });
    };
    reader.readAsArrayBuffer(file);
});

window.processAndSaveTemplate = async () => {
    const name = document.getElementById('tpl-name').value.trim();
    if (!name) return showToast('Vui lòng nhập tên mẫu', 'error');
    if (!window.tempExtractedHtml) return showToast('Vui lòng chọn file Word', 'error');
    const btn = document.getElementById('btn-save-tpl'); btn.disabled = true; btn.innerHTML = 'Đang lưu...';
    try {
        await addDoc(getCollectionPath('templates'), { name: name, htmlContent: window.tempExtractedHtml, fields: window.tempExtractedFields, createdAt: new Date() });
        showToast('Đã lưu mẫu!'); closeModal('template-upload-modal');
    } catch (e) { showToast('Lỗi lưu: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Lưu Mẫu'; }
};

// --- QUOTES LOGIC ---
function updateQuoteCustomerSelect() {
    let html = '<option value="">-- Chọn --</option>';
    html += '<optgroup label="Khách Hàng">';
    customersData.forEach(c => html += `<option value="cus_${c.id}">${c.name} - ${c.phone}</option>`);
    html += '</optgroup><optgroup label="Lead (Tiềm năng)">';
    leadsData.forEach(l => html += `<option value="lead_${l.id}">${l.name} - ${l.phone}</option>`);
    html += '</optgroup>';
    document.getElementById('quote-customer').innerHTML = html;
}

window.switchQuoteTab = (tab) => {
    document.getElementById('panel-standard').classList.toggle('hidden', tab !== 'standard');
    document.getElementById('panel-template').classList.toggle('hidden', tab !== 'template');
    ['standard', 'template'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (t === tab) btn.classList.add('bg-white', 'shadow', 'text-primary');
        else btn.classList.remove('bg-white', 'shadow', 'text-primary');
        if (t !== tab) btn.classList.add('text-gray-500'); else btn.classList.remove('text-gray-500');
    });
    document.getElementById('document-preview-area').innerHTML = '<div class="text-center text-gray-400 mt-20 italic" id="empty-preview-msg">Vui lòng chọn tạo báo giá cơ bản hoặc chọn mẫu hợp đồng ở cột bên trái.</div>';
};

window.generateStandardQuote = () => {
    const selId = document.getElementById('quote-customer').value;
    if (!selId) return showToast('Chọn đối tượng', 'error');
    const type = selId.split('_')[0]; const trueId = selId.split('_')[1];
    const target = type === 'cus' ? customersData.find(c => c.id === trueId) : leadsData.find(l => l.id === trueId);

    const checkboxes = document.querySelectorAll('.quote-srv-cb:checked');
    if (checkboxes.length === 0) return showToast('Chọn dịch vụ', 'error');

    const vatPercent = Number(document.getElementById('quote-vat').value) || 0;
    let subtotal = 0; let rowsHtml = '';
    checkboxes.forEach((cb, index) => {
        const price = Number(cb.dataset.price); subtotal += price;
        rowsHtml += `<tr><td style="border:1px solid #000; padding:4px; text-align:center">${index + 1}</td><td style="border:1px solid #000; padding:4px;">${cb.dataset.name}</td><td style="border:1px solid #000; padding:4px; text-align:right">${price.toLocaleString('vi-VN')}</td></tr>`;
    });
    const vatAmount = subtotal * (vatPercent / 100); const total = subtotal + vatAmount;

    const html = `
                <div class="text-center mb-8 border-b-2 border-black pb-4"><h1 class="text-2xl font-bold uppercase tracking-widest">Báo Giá Dịch Vụ Marketing</h1><p class="text-gray-600 mt-1">Ngày: ${new Date().toLocaleDateString('vi-VN')}</p></div>
                <div class="mb-6"><p><strong>Kính gửi:</strong> ${target.name} ${type === 'lead' ? '(Lead)' : ''}</p><p><strong>Số điện thoại:</strong> ${target.phone}</p><p><strong>Email:</strong> ${target.email || '.......................'}</p></div>
                <p class="mb-4">Chúng tôi hân hạnh gửi tới Quý khách hàng bảng báo giá chi tiết:</p>
                <table style="width:100%; border-collapse:collapse; margin-bottom:24px;"><tr style="background:#f3f4f6"><th style="border:1px solid #000; padding:4px;">STT</th><th style="border:1px solid #000; padding:4px;">Nội dung</th><th style="border:1px solid #000; padding:4px; text-align:right">Thành tiền (VNĐ)</th></tr>${rowsHtml}</table>
                <div class="flex justify-end mb-8"><div class="w-64 text-right"><p>Cộng tiền: <strong>${subtotal.toLocaleString('vi-VN')} đ</strong></p><p>VAT (${vatPercent}%): <strong>${vatAmount.toLocaleString('vi-VN')} đ</strong></p><p class="border-t border-black pt-1 mt-1 text-lg">Tổng cộng: <strong class="text-red-600">${total.toLocaleString('vi-VN')} đ</strong></p></div></div>
                <div class="grid grid-cols-2 text-center mt-16"><div><strong>Đại diện Khách hàng</strong></div><div><strong>Đại diện Công ty</strong></div></div>
            `;
    document.getElementById('document-preview-area').innerHTML = html;
};

window.loadSelectedTemplate = () => {
    const tplId = document.getElementById('template-selector').value;
    const container = document.getElementById('dynamic-fields-container');
    const inputsList = document.getElementById('dynamic-inputs-list');

    if (!tplId) {
        container.classList.add('hidden');
        document.getElementById('document-preview-area').innerHTML = '<div class="text-center text-gray-400 mt-20 italic" id="empty-preview-msg">Chọn mẫu hợp đồng.</div>';
        return;
    }

    const template = templatesData.find(t => t.id === tplId);
    currentEditingTemplateHtml = template.htmlContent;
    inputsList.innerHTML = '';

    if (template.fields && template.fields.length > 0) {
        container.classList.remove('hidden');
        template.fields.forEach(field => {
            const labelName = field.replace('_', ' ');
            inputsList.innerHTML += `
                        <div>
                            <label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">${labelName}</label>
                            <input type="text" data-field="${field}" class="dynamic-tpl-input w-full px-2 py-3 lg:py-1.5 bg-white border border-gray-300 rounded text-sm outline-none focus:border-primary" placeholder="Nhập nội dung...">
                        </div>
                    `;
        });
    } else { container.classList.add('hidden'); }
    updateTemplatePreview();
};

window.updateTemplatePreview = () => {
    let html = currentEditingTemplateHtml;
    const inputs = document.querySelectorAll('.dynamic-tpl-input');
    inputs.forEach(input => {
        const fieldName = input.dataset.field;
        const val = input.value || `<span style="background-color: #fee2e2; color: #dc2626; padding: 0 4px; border-radius: 4px; border: 1px dashed #f87171;">[Chưa điền: ${fieldName.replace('_', ' ')}]</span>`;
        const regex = new RegExp(`\\{\\{\\s*${fieldName}\\s*\\}\\}`, 'g');
        html = html.replace(regex, val);
    });
    document.getElementById('document-preview-area').innerHTML = html;
};

window.exportPDF = async () => {
    const element = document.getElementById('document-preview-area');
    if (element.querySelector('#empty-preview-msg')) return showToast('Vui lòng tạo nội dung trước', 'error');

    let docName = "Tài liệu chưa đặt tên";
    const isStandardTab = !document.getElementById('panel-standard').classList.contains('hidden');
    if (isStandardTab) {
        const cusSelect = document.getElementById('quote-customer');
        const cusName = cusSelect.options[cusSelect.selectedIndex]?.text || 'Khách hàng';
        docName = `Báo giá - ${cusName.split(' - ')[0]}`;
    } else {
        const tplSelect = document.getElementById('template-selector');
        const tplName = tplSelect.options[tplSelect.selectedIndex]?.text || 'Mẫu hợp đồng';
        docName = `Hợp đồng - ${tplName}`;
    }

    const opt = { margin: 10, filename: `${docName}_${new Date().getTime()}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    const htmlToSave = element.innerHTML;

    const btn = document.querySelector('button[onclick="exportPDF()"]');
    const oldText = btn.innerHTML; btn.innerHTML = `Đang tạo...`;

    html2pdf().set(opt).from(element).save().then(async () => {
        btn.innerHTML = oldText;
        try { await addDoc(getCollectionPath('export_history'), { name: docName, htmlContent: htmlToSave, createdAt: new Date() }); showToast('Đã xuất PDF và lưu lịch sử'); } catch (e) { }
    });
};

// --- HISTORY LOGIC ---
// function renderHistory() {
//     const tbody = document.getElementById('history-list');
//     if (historyData.length === 0) return tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-gray-500">Chưa có lịch sử xuất tài liệu nào</td></tr>`;

//     const sortedHistory = [...historyData].sort((a, b) => {
//         const ta = a.createdAt ? (a.createdAt.seconds || a.createdAt) : 0;
//         const tb = b.createdAt ? (b.createdAt.seconds || b.createdAt) : 0;
//         return tb - ta;
//     });

//     tbody.innerHTML = sortedHistory.map((item, idx) => `
//                 <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50">
//                     <td class="py-3 text-center font-mono text-gray-500 pl-2">${idx + 1}</td>
//                     <td class="py-3 font-semibold text-primary max-w-[150px] sm:max-w-none truncate">${item.name}</td>
//                     <td class="py-3 text-xs text-gray-500 whitespace-nowrap">${formatDateStr(item.createdAt)}</td>
//                     <td class="py-3 text-center pr-2">
//                         <button onclick="viewHistoricalDoc('${item.id}')" class="p-2 lg:p-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200" title="Xem lại file PDF"><span class="material-symbols-outlined text-base">visibility</span></button>
//                     </td>
//                 </tr>
//             `).join('');
// }

// ==============================================
// HISTORY LOGIC — table + mobile card + pagination
// ==============================================
const HISTORY_PER_PAGE = 15;

function renderHistory() {
    const searchEl = document.getElementById('search-history');
    const keyword = searchEl ? searchEl.value.toLowerCase() : '';

    const sortedHistory = [...historyData].sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.seconds || a.createdAt) : 0;
        const tb = b.createdAt ? (b.createdAt.seconds || b.createdAt) : 0;
        return tb - ta;
    });

    const filtered = keyword
        ? sortedHistory.filter(h => (h.name || '').toLowerCase().includes(keyword))
        : sortedHistory;

    const badge = document.getElementById('history-count-badge');
    if (badge) badge.textContent = `${filtered.length} tài liệu`;

    const paged = getPageSlice(filtered, 'history', HISTORY_PER_PAGE);
    const globalOffset = (PG.history || 1 - 1) * HISTORY_PER_PAGE;

    // ── Desktop Table ──
    const tbody = document.getElementById('history-list');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-gray-400">
            <span class="material-symbols-outlined text-3xl block mb-2">search_off</span>
            ${keyword ? 'Không tìm thấy tài liệu phù hợp.' : 'Chưa có lịch sử xuất tài liệu nào'}
        </td></tr>`;
    } else {
        tbody.innerHTML = paged.map((item, idx) => `
            <tr class="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 border-b border-gray-100 dark:border-slate-800/50 transition-colors">
                <td class="py-3 text-center font-mono text-gray-400 text-xs pl-2">${globalOffset + idx + 1}</td>
                <td class="py-3 font-semibold text-primary max-w-[160px] sm:max-w-none truncate">${item.name}</td>
                <td class="py-3 text-xs text-gray-500 whitespace-nowrap">${formatDateStr(item.createdAt)}</td>
                <td class="py-3 text-center pr-2">
                    <button onclick="viewHistoricalDoc('${item.id}')" class="w-9 h-9 lg:w-8 lg:h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-200 mx-auto transition-colors" title="Xem lại PDF">
                        <span class="material-symbols-outlined text-base lg:text-sm">visibility</span>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ── Mobile Cards ──
    const cardList = document.getElementById('history-card-list');
    if (filtered.length === 0) {
        cardList.innerHTML = `<div class="text-center py-10 text-gray-400"><span class="material-symbols-outlined text-4xl block mb-2">search_off</span>${keyword ? 'Không tìm thấy.' : 'Chưa có lịch sử.'}</div>`;
    } else {
        cardList.innerHTML = paged.map((item, idx) => `
            <div class="mobile-card-item">
                <div class="card-title">${item.name}</div>
                <div class="card-meta">
                    <span class="card-meta-chip"><span class="material-symbols-outlined text-[12px]">schedule</span>${formatDateStr(item.createdAt)}</span>
                    <span class="card-meta-chip text-gray-400">#${globalOffset + idx + 1}</span>
                </div>
                <div class="card-actions">
                    <button onclick="viewHistoricalDoc('${item.id}')" class="card-action-btn bg-blue-50 text-blue-500 flex-1 rounded-lg justify-center gap-2 text-sm font-semibold" style="width:auto;padding:0 12px;">
                        <span class="material-symbols-outlined text-[16px]">visibility</span> Xem lại
                    </button>
                </div>
            </div>`).join('');
    }

    buildPagination('history', filtered.length,
        document.getElementById('history-page-btns'),
        document.getElementById('history-page-info'), HISTORY_PER_PAGE);
}

document.getElementById('search-history')?.addEventListener('input', () => { PG.history = 1; renderHistory(); });

window.viewHistoricalDoc = (historyId) => {
    const item = historyData.find(h => h.id === historyId);
    if (!item) return;
    document.getElementById('history-doc-title').innerText = item.name;
    document.getElementById('history-doc-time').innerText = `Thời gian xuất: ${formatDateStr(item.createdAt)}`;
    document.getElementById('history-doc-content').innerHTML = item.htmlContent;
    openModal('history-view-modal');
};

window.reExportHistoryPDF = () => {
    const element = document.getElementById('history-doc-content');
    const title = document.getElementById('history-doc-title').innerText;
    const opt = { margin: 10, filename: `${title}_ReExport.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save().then(() => { showToast('Đã tải lại file PDF!'); });
};

// --- DASHBOARD ---
function updateDashboardStats() {
    document.getElementById('stat-leads').innerText = leadsData.length;
    document.getElementById('stat-customers').innerText = customersData.length;
    document.getElementById('stat-services').innerText = servicesData.length;
    if (document.getElementById('stat-jobs')) document.getElementById('stat-jobs').innerText = jobsData.length;
    if (document.getElementById('stat-templates')) document.getElementById('stat-templates').innerText = templatesData.length;
    if (document.getElementById('stat-history')) document.getElementById('stat-history').innerText = historyData.length;
}

// let myChart = null;
// function initChart() {
//     if (myChart) myChart.destroy();
//     const ctx = document.getElementById('mainChart').getContext('2d');
//     const isDark = document.documentElement.classList.contains('dark');
//     const textColor = isDark ? '#cbd5e1' : '#64748b';
//     const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
//     myChart = new Chart(ctx, { type: 'line', data: { labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], datasets: [{ label: 'Tương tác', data: [12, 19, 15, 25, 22, 30], borderColor: primaryColor, tension: 0.4, fill: true, backgroundColor: primaryColor + '20' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } } } });
// }

let myChart = null;
let chartTimeFilter = 'today'; // today | week | month | year
let chartActiveSeries = { leads: true, customers: true, jobs: true, history: true };

window.setChartTimeFilter = (filter) => {
    chartTimeFilter = filter;
    document.querySelectorAll('.chart-time-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-primary', 'shadow');
        btn.classList.add('text-gray-500');
    });
    const active = document.getElementById(`chart-filter-${filter}`);
    if (active) {
        active.classList.add('bg-white', 'dark:bg-slate-700', 'text-primary', 'shadow');
        active.classList.remove('text-gray-500');
    }
    initChart();
};

window.toggleChartSeries = (series) => {
    chartActiveSeries[series] = !chartActiveSeries[series];
    const btn = document.getElementById(`series-btn-${series}`);
    if (btn) {
        const colorMap = { leads: 'orange', customers: 'blue', jobs: 'indigo', history: 'yellow' };
        const c = colorMap[series];
        if (chartActiveSeries[series]) {
            btn.dataset.active = '1';
            btn.classList.remove(`border-${c}-200`, `text-${c}-400`, 'bg-transparent');
            btn.classList.add(`bg-${c}-400`, 'text-white', `border-${c}-400`);
        } else {
            btn.dataset.active = '0';
            btn.classList.add(`border-${c}-200`, `text-${c}-400`, 'bg-transparent');
            btn.classList.remove(`bg-${c}-400`, 'text-white', `border-${c}-400`);
        }
    }
    initChart();
};

function getDateLabelsAndFilter(filter) {
    const now = new Date();
    let labels = [], ranges = [];
    if (filter === 'today') {
        for (let h = 0; h < 24; h++) {
            labels.push(`${String(h).padStart(2, '0')}h`);
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0);
            const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 59, 59);
            ranges.push({ start, end });
        }
    } else if (filter === 'week') {
        const day = now.getDay(); // 0=Sun
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - day); weekStart.setHours(0, 0, 0, 0);
        const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
            labels.push(dayNames[i]);
            const start = new Date(d); start.setHours(0, 0, 0, 0);
            const end = new Date(d); end.setHours(23, 59, 59, 999);
            ranges.push({ start, end });
        }
    } else if (filter === 'month') {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            labels.push(`${d}`);
            const start = new Date(now.getFullYear(), now.getMonth(), d, 0, 0, 0);
            const end = new Date(now.getFullYear(), now.getMonth(), d, 23, 59, 59);
            ranges.push({ start, end });
        }
    } else if (filter === 'year') {
        const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        for (let m = 0; m < 12; m++) {
            labels.push(monthNames[m]);
            const start = new Date(now.getFullYear(), m, 1, 0, 0, 0);
            const end = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59);
            ranges.push({ start, end });
        }
    }
    return { labels, ranges };
}

function countByRange(items, ranges) {
    return ranges.map(({ start, end }) =>
        items.filter(item => {
            const d = item.createdAt;
            if (!d) return false;
            const ts = d.seconds ? new Date(d.seconds * 1000) : new Date(d);
            return ts >= start && ts <= end;
        }).length
    );
}

function initChart() {
    if (myChart) myChart.destroy();
    const ctx = document.getElementById('mainChart');
    if (!ctx) return;
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#cbd5e1' : '#64748b';
    const { labels, ranges } = getDateLabelsAndFilter(chartTimeFilter);

    const datasets = [];
    if (chartActiveSeries.leads)
        datasets.push({ label: 'Lead tạo mới', data: countByRange(leadsData, ranges), borderColor: '#f97316', backgroundColor: '#f9731620', tension: 0.4, fill: true });
    if (chartActiveSeries.customers)
        datasets.push({ label: 'Khách hàng', data: countByRange(customersData, ranges), borderColor: '#3b82f6', backgroundColor: '#3b82f620', tension: 0.4, fill: true });
    if (chartActiveSeries.jobs)
        datasets.push({ label: 'Jobs tạo', data: countByRange(jobsData, ranges), borderColor: '#6366f1', backgroundColor: '#6366f120', tension: 0.4, fill: true });
    if (chartActiveSeries.history)
        datasets.push({ label: 'HĐ Xuất', data: countByRange(historyData, ranges), borderColor: '#eab308', backgroundColor: '#eab30820', tension: 0.4, fill: true });

    myChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', labels: { color: textColor, boxWidth: 12, padding: 10 } } },
            scales: { y: { beginAtZero: true, ticks: { color: textColor, precision: 0 } }, x: { ticks: { color: textColor, maxTicksLimit: 12 } } }
        }
    });
}

window.toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('crm_theme', isDark ? 'dark' : 'light');
    document.getElementById('theme-icon').innerText = isDark ? 'light_mode' : 'dark_mode';
    if (myChart) initChart();
    if (jobStatusChartInst) updateJobReportCharts();
};

if (localStorage.getItem('crm_theme') === 'dark' || (!('crm_theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark'); document.getElementById('theme-icon').innerText = 'light_mode';
}

const savedColor = localStorage.getItem('crm_primary_color');
if (savedColor) { document.documentElement.style.setProperty('--color-primary', savedColor); document.getElementById('color-picker').value = savedColor; }

window.applyThemeColor = () => {
    const color = document.getElementById('color-picker').value;
    document.documentElement.style.setProperty('--color-primary', color);
    localStorage.setItem('crm_primary_color', color);
    if (myChart) initChart(); showToast('Đã áp dụng màu chủ đạo mới');
};

window.resetThemeColor = () => {
    document.documentElement.style.setProperty('--color-primary', '#6366f1');
    document.getElementById('color-picker').value = '#6366f1';
    localStorage.removeItem('crm_primary_color');
    if (myChart) initChart(); showToast('Đã khôi phục màu mặc định');
};

// --- FLOATING NAV LOGIC & SETTINGS ---
const fNav = document.getElementById('floating-nav');
const fNavToggle = document.getElementById('toggle-floating-nav');

window.toggleFloatingNavSetting = () => {
    const isEnabled = fNavToggle.checked;
    localStorage.setItem('crm_floating_nav', isEnabled ? 'true' : 'false');
    if (isEnabled) {
        fNav.classList.remove('translate-y-[150%]', 'opacity-0');
    } else {
        fNav.classList.add('translate-y-[150%]', 'opacity-0');
    }
};

if (localStorage.getItem('crm_floating_nav') === 'false') {
    if (fNavToggle) fNavToggle.checked = false;
    if (fNav) fNav.classList.add('translate-y-[150%]', 'opacity-0');
} else {
    if (fNavToggle) fNavToggle.checked = true;
}

// Start Scripts for Translate
const gScript2 = document.createElement('script');
gScript2.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
document.body.appendChild(gScript2);
window.googleTranslateElementInit = function () { new google.translate.TranslateElement({ pageLanguage: 'vi', includedLanguages: 'vi,en,zh-CN,ja,ko', autoDisplay: false }, 'google_translate_element'); };
window.changeLanguage = function (langCode, displayName) {
    document.getElementById('currentLang').innerText = displayName;
    const selectField = document.querySelector(".goog-te-combo");
    if (selectField) { selectField.value = langCode; selectField.dispatchEvent(new Event('change')); }
    else { setTimeout(() => window.changeLanguage(langCode, displayName), 500); }
};

// ============================================
// [PATCH 6] AVATAR LOGIC
// ============================================
(function () {
    // Hidden cache input để lưu base64 tạm
    const cache = document.createElement('input');
    cache.type = 'hidden'; cache.id = 'avatar-data-cache';
    document.body.appendChild(cache);

    document.getElementById('avatar-file-input').addEventListener('change', function (e) {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 1 * 1024 * 1024) { showToast('Ảnh tối đa 1MB', 'error'); this.value = ''; return; }
        const reader = new FileReader();
        reader.onload = function (ev) {
            const b64 = ev.target.result;
            cache.value = b64;
            // Hiển thị preview trong settings
            const img = document.getElementById('settings-avatar-img');
            const ini = document.getElementById('settings-avatar-initial');
            img.src = b64; img.classList.remove('hidden');
            ini.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    });
})();

window.clearAvatarImage = () => {
    document.getElementById('avatar-data-cache').value = '';
    document.getElementById('avatar-file-input').value = '';
    const img = document.getElementById('settings-avatar-img');
    const ini = document.getElementById('settings-avatar-initial');
    img.src = ''; img.classList.add('hidden');
    ini.classList.remove('hidden');
    showToast('Đã xóa ảnh đại diện (chưa lưu)');
};

function applyAvatarToSidebar(avatarUrl, username) {
    const sidebarAvatar = document.getElementById('user-avatar');
    if (avatarUrl) {
        // Dùng img thay vì chữ
        sidebarAvatar.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full" onerror="this.parentElement.innerText='${(username || 'A').charAt(0).toUpperCase()}'">`;
        sidebarAvatar.style.padding = '0';
    } else {
        sidebarAvatar.innerHTML = (username || 'A').charAt(0).toUpperCase();
        sidebarAvatar.style.padding = '';
    }
}

function loadAvatarInSettings(avatarUrl, username) {
    const img = document.getElementById('settings-avatar-img');
    const ini = document.getElementById('settings-avatar-initial');
    const cache = document.getElementById('avatar-data-cache');
    ini.innerText = (username || 'A').charAt(0).toUpperCase();
    if (avatarUrl) {
        img.src = avatarUrl; img.classList.remove('hidden');
        ini.classList.add('hidden');
        if (cache) cache.value = avatarUrl;
    } else {
        img.src = ''; img.classList.add('hidden');
        ini.classList.remove('hidden');
        if (cache) cache.value = '';
    }
}

// code mới 23/4/26

// ════════════════════════════════════════════════════════════════
//  PROJECTS MODULE — inlined từ projects.js, chuyển đổi sang
//  Firebase Modular SDK v10 (không cần file projects.js riêng)
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── State
    let projectsData   = [];
    let filteredData   = [];
    let currentPage    = 1;
    const PER_PAGE     = 6;
    let lightboxImages = [];
    let lightboxIdx    = 0;
    let editingId      = null;
    let pendingImages  = [];
    let imagesToDelete = [];

    // ── Collection helpers (Modular SDK)
    function prjColRef()    { return collection(db, 'artifacts', app_id, 'public', 'data', 'projects'); }
    function prjDocRef(id)  { return doc(db, 'artifacts', app_id, 'public', 'data', 'projects', id); }

    // ── Shorthand helpers
    function el(id) { return document.getElementById(id); }
    function toast(msg, type) { if (window.showToast) window.showToast(msg, type || 'success'); }
    function fmtCurrency(n)  { return window.formatCurrency ? window.formatCurrency(n) : n; }
    function fmtDate(ts)     { return window.formatDateStr  ? window.formatDateStr(ts)  : ts; }
    function esc(s) {
        return String(s || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Public init — gọi từ initAppLogic()
    window.initProjectsModule = function () {
        startRealtimeListener();
        bindForm();
        bindFilters();
        bindLightboxKeys();
        bindDropzone();
    };

    // ════════════════════════════════
    //  FIRESTORE REALTIME LISTENER
    // ════════════════════════════════
    function startRealtimeListener() {
        onSnapshot(prjColRef(), function (snap) {
            projectsData = snap.docs.map(function (d) {
                return Object.assign({ id: d.id }, d.data());
            });
            applyFilters();
        }, function (err) {
            console.error('[Projects] Firestore error:', err);
            toast('Lỗi kết nối database: ' + err.message, 'error');
        });
    }

    // ════════════════════════════════
    //  FILTER + SORT + PAGINATE
    // ════════════════════════════════
    function applyFilters() {
        var q      = (el('prj-search')       ? el('prj-search').value       : '').toLowerCase().trim();
        var sector = (el('prj-filter-sector') ? el('prj-filter-sector').value : '');
        var minP   = parseFloat(el('prj-filter-min') ? el('prj-filter-min').value : 0) || 0;
        var rawMax = parseFloat(el('prj-filter-max') ? el('prj-filter-max').value : 0) || 0;
        var maxP   = rawMax > 0 ? rawMax : Infinity;
        var sort   = el('prj-sort') ? el('prj-sort').value : 'newest';

        filteredData = projectsData.filter(function (p) {
            var price = parseFloat(p.price) || 0;
            return (!q      || (p.name || '').toLowerCase().includes(q))
                && (!sector || (p.sector || '') === sector)
                && price >= minP && price <= maxP;
        });

        filteredData.sort(function (a, b) {
            var ts = function (x) { return x.createdAt && x.createdAt.seconds ? x.createdAt.seconds : 0; };
            if (sort === 'newest')     return ts(b) - ts(a);
            if (sort === 'oldest')     return ts(a) - ts(b);
            if (sort === 'price_asc')  return (parseFloat(a.price)||0) - (parseFloat(b.price)||0);
            if (sort === 'price_desc') return (parseFloat(b.price)||0) - (parseFloat(a.price)||0);
            return 0;
        });

        var maxPage = Math.max(1, Math.ceil(filteredData.length / PER_PAGE));
        if (currentPage > maxPage) currentPage = maxPage;

        renderGrid();
        renderPagination();
        refreshSectorOptions();
        updateCounters();
    }

    function updateCounters() {
        if (el('prj-count')) el('prj-count').textContent = filteredData.length;
        if (el('prj-total')) el('prj-total').textContent = projectsData.length;
    }

    function refreshSectorOptions() {
        var sel = el('prj-filter-sector');
        if (!sel) return;
        var cur  = sel.value;
        var opts = [];
        projectsData.forEach(function (p) { if (p.sector && !opts.includes(p.sector)) opts.push(p.sector); });
        opts.sort();
        sel.innerHTML = '<option value="">Tất cả ngành nghề</option>'
            + opts.map(function (s) {
                return '<option value="' + esc(s) + '"' + (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>';
            }).join('');
    }

    // ════════════════════════════════
    //  RENDER CARDS
    // ════════════════════════════════
    function renderGrid() {
        var grid  = el('projects-grid');
        var empty = el('prj-empty');
        if (!grid) return;
        if (filteredData.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');
        var start = (currentPage - 1) * PER_PAGE;
        grid.innerHTML = filteredData.slice(start, start + PER_PAGE).map(cardHTML).join('');
    }

    function cardHTML(p) {
        var imgs  = Array.isArray(p.images) ? p.images : [];
        var thumb = imgs[0] || '';
        var price = parseFloat(p.price) || 0;
        var desc  = (p.desc || '').length > 100 ? p.desc.slice(0, 100) + '…' : (p.desc || '');
        var id    = p.id;
        var name  = esc(p.name || 'Chưa đặt tên');

        return '<div class="prj-card glass rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col border border-gray-200/60 dark:border-slate-700/60 group">'
            + '<div class="relative overflow-hidden bg-gray-100 dark:bg-slate-800 aspect-video cursor-pointer flex-shrink-0" onclick="window.openProjectDetail(\'' + id + '\')">'
            + (thumb
                ? '<img src="' + thumb + '" alt="' + name + '" loading="lazy" class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" onerror="this.parentElement.innerHTML=\'<div class=\\\'flex items-center justify-center h-full text-gray-300 dark:text-slate-600\\\'><span class=\\\'material-symbols-outlined text-4xl\\\'>broken_image</span></div>\'">'
                : '<div class="flex flex-col items-center justify-center h-full text-gray-300 dark:text-slate-600 gap-1"><span class="material-symbols-outlined text-4xl">add_photo_alternate</span><span class="text-xs">Chưa có ảnh</span></div>')
            + (imgs.length > 1
                ? '<div class="absolute top-2 right-2 bg-black/50 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 backdrop-blur-sm"><span class="material-symbols-outlined text-[13px]">photo_library</span>' + imgs.length + '</div>'
                : '')
            + '</div>'
            + '<div class="p-4 flex flex-col flex-1 gap-2.5">'
            + '<div class="flex items-start gap-2">'
            + '<h3 class="font-bold text-sm leading-snug flex-1 line-clamp-2 cursor-pointer hover:text-primary transition-colors" onclick="window.openProjectDetail(\'' + id + '\')">' + name + '</h3>'
            + (p.sector ? '<span class="shrink-0 mt-0.5 text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">' + esc(p.sector) + '</span>' : '')
            + '</div>'
            + (desc ? '<p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">' + esc(desc) + '</p>' : '')
            + '<div class="mt-auto pt-3 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-slate-800">'
            + '<span class="font-bold text-sm text-primary">'
            + (price > 0 ? fmtCurrency(price) : '<span class="font-normal text-xs text-gray-400">Liên hệ</span>')
            + '</span>'
            + '<div class="flex items-center gap-1.5">'
            + '<button onclick="window.openProjectDetail(\'' + id + '\')" title="Chi tiết" class="w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white flex items-center justify-center transition-all active:scale-90"><span class="material-symbols-outlined text-[16px]">visibility</span></button>'
            + '<button onclick="window.editProject(\'' + id + '\')" title="Sửa" class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 hover:bg-amber-500 hover:text-white flex items-center justify-center transition-all active:scale-90"><span class="material-symbols-outlined text-[16px]">edit</span></button>'
            + '<button onclick="window.deleteProject(\'' + id + '\',\'' + name.replace(/'/g, "\\'") + '\')" title="Xoá" class="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all active:scale-90"><span class="material-symbols-outlined text-[16px]">delete</span></button>'
            + '</div></div></div></div>';
    }

    // ════════════════════════════════
    //  PAGINATION
    // ════════════════════════════════
    function renderPagination() {
        var wrap  = el('prj-pagination');
        if (!wrap) return;
        var total = Math.ceil(filteredData.length / PER_PAGE);
        if (total <= 1) { wrap.innerHTML = ''; return; }
        var range = pageRange(currentPage, total);
        var html  = '<button class="pagination-btn arrow" onclick="window.prjPage(' + (currentPage - 1) + ')" '
            + (currentPage === 1 ? 'disabled' : '') + '><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>';
        range.forEach(function (n) {
            html += n === '…'
                ? '<span class="px-1 text-gray-400 self-end pb-1 text-sm">…</span>'
                : '<button class="pagination-btn' + (n === currentPage ? ' active' : '') + '" onclick="window.prjPage(' + n + ')">' + n + '</button>';
        });
        html += '<button class="pagination-btn arrow" onclick="window.prjPage(' + (currentPage + 1) + ')" '
            + (currentPage === total ? 'disabled' : '') + '><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>';
        wrap.innerHTML = html;
    }

    function pageRange(cur, total) {
        if (total <= 7) { var r = []; for (var i = 1; i <= total; i++) r.push(i); return r; }
        if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
        if (cur >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
        return [1, '…', cur-1, cur, cur+1, '…', total];
    }

    window.prjPage = function (page) {
        var total = Math.ceil(filteredData.length / PER_PAGE);
        if (page < 1 || page > total) return;
        currentPage = page;
        renderGrid();
        renderPagination();
        if (el('view-projects')) el('view-projects').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // ════════════════════════════════
    //  CHI TIẾT + LIGHTBOX
    // ════════════════════════════════
    window.openProjectDetail = function (id) {
        var p = projectsData.find(function (x) { return x.id === id; });
        if (!p) return;

        lightboxImages = Array.isArray(p.images) ? p.images : [];
        lightboxIdx    = 0;

        setText('pdm-name',     p.name    || '—');
        setText('pdm-sector',   p.sector  || '—');
        setText('pdm-price',    p.price   ? fmtCurrency(p.price) : 'Liên hệ');
        setText('pdm-desc',     p.desc    || 'Không có mô tả.');
        setText('pdm-created',  fmtDate(p.createdAt));
        setText('pdm-updated',  fmtDate(p.updatedAt));
        setText('pdm-imgcount', lightboxImages.length + ' ảnh');

        var editBtn = el('pdm-edit-btn');
        if (editBtn) editBtn.onclick = function () { prjCloseModal('project-detail-modal'); window.editProject(id); };

        updateLightboxImg();

        var strip = el('pdm-thumbs');
        if (strip) {
            strip.innerHTML = lightboxImages.map(function (url, i) {
                return '<button onclick="window.prjLbGo(' + i + ')" data-lbthumb="' + i
                    + '" class="prj-thumb shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all '
                    + (i === 0 ? 'border-primary' : 'border-transparent opacity-50 hover:opacity-100')
                    + ' bg-gray-100 dark:bg-slate-800"><img src="' + url + '" class="w-full h-full object-cover" loading="lazy"></button>';
            }).join('');
        }

        var multi = lightboxImages.length > 1;
        ['pdm-nav-prev','pdm-nav-next','pdm-counter','pdm-thumbs-wrap'].forEach(function (eid) {
            var e = el(eid); if (!e) return;
            if (multi) e.classList.remove('hidden'); else e.classList.add('hidden');
        });

        window.openModal('project-detail-modal');
    };

    function setText(id, val) { var e = el(id); if (e) e.textContent = val; }

    function updateLightboxImg() {
        var img   = el('pdm-main-img');
        var noImg = el('pdm-no-img');
        var cnt   = el('pdm-counter');

        if (!lightboxImages.length) {
            if (img)   img.classList.add('hidden');
            if (noImg) noImg.classList.remove('hidden');
            return;
        }
        if (noImg) noImg.classList.add('hidden');
        if (img) {
            img.style.opacity = '0';
            img.src = lightboxImages[lightboxIdx];
            img.onload  = function () { img.style.opacity = '1'; };
            img.onerror = function () { img.style.opacity = '1'; };
            img.classList.remove('hidden');
        }
        if (cnt) cnt.textContent = (lightboxIdx + 1) + ' / ' + lightboxImages.length;

        document.querySelectorAll('[data-lbthumb]').forEach(function (e) {
            var i = parseInt(e.getAttribute('data-lbthumb'));
            e.classList.toggle('border-primary',     i === lightboxIdx);
            e.classList.toggle('opacity-50',         i !== lightboxIdx);
            e.classList.toggle('border-transparent', i !== lightboxIdx);
        });
    }

    window.prjLbGo = function (idx) {
        if (!lightboxImages.length) return;
        lightboxIdx = ((idx % lightboxImages.length) + lightboxImages.length) % lightboxImages.length;
        updateLightboxImg();
    };

    function bindLightboxKeys() {
        document.addEventListener('keydown', function (e) {
            var m = el('project-detail-modal');
            if (!m || m.classList.contains('hidden')) return;
            if (e.key === 'ArrowLeft')  window.prjLbGo(lightboxIdx - 1);
            if (e.key === 'ArrowRight') window.prjLbGo(lightboxIdx + 1);
            if (e.key === 'Escape')     prjCloseModal('project-detail-modal');
        });
    }

    // ════════════════════════════════
    //  MODAL THÊM / SỬA
    // ════════════════════════════════
    window.openAddProject = function () {
        editingId = null; pendingImages = []; imagesToDelete = [];
        resetForm();
        setText('project-modal-title', 'Thêm Dự Án Mới');
        window.openModal('project-modal');
    };

    window.editProject = function (id) {
        var p = projectsData.find(function (x) { return x.id === id; });
        if (!p) return;
        editingId = id; imagesToDelete = [];
        if (el('prj-form-name'))   el('prj-form-name').value   = p.name   || '';
        if (el('prj-form-sector')) el('prj-form-sector').value = p.sector || '';
        if (el('prj-form-price'))  el('prj-form-price').value  = p.price  || '';
        if (el('prj-form-desc'))   el('prj-form-desc').value   = p.desc   || '';
        var imgs = Array.isArray(p.images) ? p.images : [];
        pendingImages = imgs.map(function (url) { return { isExisting: true, storageUrl: url, previewUrl: url }; });
        renderPreviews();
        setText('project-modal-title', 'Sửa Dự Án');
        window.openModal('project-modal');
    };

    function resetForm() {
        ['prj-form-name','prj-form-sector','prj-form-price','prj-form-desc'].forEach(function (id) {
            if (el(id)) el(id).value = '';
        });
        pendingImages = [];
        renderPreviews();
    }

    // ════════════════════════════════
    //  IMAGE DROPZONE
    // ════════════════════════════════
    function bindDropzone() {
        var zone  = el('prj-dropzone');
        var input = el('prj-img-input');
        if (!zone || !input) return;
        zone.addEventListener('click',     function () { input.click(); });
        zone.addEventListener('dragover',  function (e) { e.preventDefault(); zone.classList.add('border-primary', 'bg-primary/5'); });
        zone.addEventListener('dragleave', function ()  { zone.classList.remove('border-primary', 'bg-primary/5'); });
        zone.addEventListener('drop', function (e) {
            e.preventDefault();
            zone.classList.remove('border-primary', 'bg-primary/5');
            addFiles(Array.from(e.dataTransfer.files));
        });
        input.addEventListener('change', function () { addFiles(Array.from(input.files)); input.value = ''; });
    }

    function addFiles(files) {
        files.filter(function (f) { return f.type.startsWith('image/'); }).forEach(function (file) {
            if (file.size > 5 * 1024 * 1024) { toast('"' + file.name + '" vượt 5MB', 'error'); return; }
            var r = new FileReader();
            r.onload = function (e) {
                pendingImages.push({ file: file, previewUrl: e.target.result, isExisting: false });
                renderPreviews();
            };
            r.readAsDataURL(file);
        });
    }

    function renderPreviews() {
        var wrap = el('prj-img-previews');
        if (!wrap) return;
        if (!pendingImages.length) {
            wrap.innerHTML = '<p class="text-xs text-gray-400 text-center py-3 col-span-full">Chưa có ảnh nào — kéo thả hoặc nhấn chọn</p>';
            return;
        }
        wrap.innerHTML = pendingImages.map(function (img, i) {
            return '<div class="relative group/img rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 aspect-square bg-gray-50 dark:bg-slate-800">'
                + '<img src="' + img.previewUrl + '" class="w-full h-full object-contain" loading="lazy">'
                + '<div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/50 transition-all flex items-center justify-center">'
                + '<button type="button" onclick="window.prjRemoveImg(' + i + ')" class="opacity-0 group-hover/img:opacity-100 w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all active:scale-90"><span class="material-symbols-outlined text-[15px]">delete</span></button>'
                + '</div>'
                + (i === 0 ? '<span class="absolute top-1.5 left-1.5 bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">ĐẠI DIỆN</span>' : '')
                + '</div>';
        }).join('');
    }

    window.prjRemoveImg = function (idx) {
        var img = pendingImages[idx];
        if (img && img.isExisting && img.storageUrl && img.storageUrl.startsWith('https://')) {
            imagesToDelete.push(img.storageUrl);
        }
        pendingImages.splice(idx, 1);
        renderPreviews();
    };

    // ════════════════════════════════
    //  LƯU DỰ ÁN
    // ════════════════════════════════
    function bindForm() {
        var form = el('project-form');
        if (!form) return;
        form.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); saveProject(); });
    }

    function saveProject() {
        var name   = (el('prj-form-name')   ? el('prj-form-name').value   : '').trim();
        var sector = (el('prj-form-sector') ? el('prj-form-sector').value : '').trim();
        var price  = parseFloat(el('prj-form-price') ? el('prj-form-price').value : 0) || 0;
        var desc   = (el('prj-form-desc')   ? el('prj-form-desc').value   : '').trim();
        if (!name) { toast('Vui lòng nhập tên dự án!', 'error'); return; }

        var btn = el('prj-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin mr-1">refresh</span> Đang lưu...'; }

        uploadPendingImages(function (urls) {
            // Xóa ảnh cũ trên Storage
            var delPromises = imagesToDelete.map(function (url) {
                try { return deleteObject(_storageRefFromURL(url)).catch(function () {}); } catch (e) { return Promise.resolve(); }
            });

            Promise.all(delPromises).then(function () {
                var payload = { name: name, sector: sector, price: price, desc: desc, images: urls, updatedAt: serverTimestamp() };
                var done = function () {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm mr-1">save</span> Lưu dự án'; }
                };
                var savePromise;
                if (editingId) {
                    savePromise = updateDoc(prjDocRef(editingId), payload).then(function () { toast('Đã cập nhật dự án!'); });
                } else {
                    payload.createdAt = serverTimestamp();
                    savePromise = addDoc(prjColRef(), payload).then(function () { toast('Đã thêm dự án mới!'); });
                }
                savePromise
                    .then(function () { done(); prjCloseModal('project-modal'); })
                    .catch(function (err) { console.error(err); toast('Lỗi lưu: ' + err.message, 'error'); done(); });
            });
        }, function (err) {
            toast('Lỗi upload ảnh: ' + err.message, 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm mr-1">save</span> Lưu dự án'; }
        });
    }

    function uploadPendingImages(onDone, onError) {
        var result  = new Array(pendingImages.length);
        var newImgs = [];

        pendingImages.forEach(function (img, i) {
            if (img.isExisting) result[i] = img.storageUrl;
            else newImgs.push({ img: img, pos: i });
        });

        if (newImgs.length === 0) { onDone(result.filter(Boolean)); return; }

        var uploaded = 0;
        var failed   = false;

        newImgs.forEach(function (item) {
            var path    = 'projects/' + app_id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            var fileRef = sRef(storage, path);

            // Chuyển data URL → Blob (uploadBytes ổn định hơn uploadString)
            var blob;
            try {
                var parts  = item.img.previewUrl.split(',');
                var mime   = parts[0].match(/:(.*?);/)[1];
                var bstr   = atob(parts[1]);
                var buf    = new Uint8Array(bstr.length);
                for (var i = 0; i < bstr.length; i++) buf[i] = bstr.charCodeAt(i);
                blob = new Blob([buf], { type: mime });
            } catch (e) {
                if (!failed) { failed = true; onError(new Error('Không đọc được file ảnh: ' + e.message)); }
                return;
            }

            uploadBytes(fileRef, blob)
                .then(function (snapshot) { return getDownloadURL(snapshot.ref); })
                .then(function (url) {
                    result[item.pos] = url;
                    uploaded++;
                    if (uploaded === newImgs.length && !failed) onDone(result.filter(Boolean));
                })
                .catch(function (err) {
                    console.error('[Projects] Upload lỗi:', err);
                    if (!failed) { failed = true; onError(err); }
                });
        });
    }

    // Helper: lấy storage ref từ HTTPS download URL (Modular SDK không tự parse)
    function _storageRefFromURL(url) {
        try {
            // Firebase Storage URL: .../o/{encoded-path}?...
            var match = url.match(/\/o\/([^?#]+)/);
            if (match) return sRef(storage, decodeURIComponent(match[1]));
        } catch (e) { /* fallback */ }
        return sRef(storage, url);
    }

    // ════════════════════════════════
    //  XOÁ DỰ ÁN
    // ════════════════════════════════
    window.deleteProject = function (id, name) {
        if (!confirm('Xác nhận xoá dự án:\n"' + name + '"?\n\nHành động này không thể hoàn tác.')) return;
        var p    = projectsData.find(function (x) { return x.id === id; });
        var imgs = (p && Array.isArray(p.images)) ? p.images : [];
        var delImgs = imgs
            .filter(function (u) { return u && u.startsWith('https://'); })
            .map(function (url) {
                try { return deleteObject(_storageRefFromURL(url)).catch(function () {}); } catch (e) { return Promise.resolve(); }
            });
        Promise.all(delImgs)
            .then(function () { return deleteDoc(prjDocRef(id)); })
            .then(function () { toast('Đã xoá dự án!'); })
            .catch(function (err) { toast('Lỗi xoá: ' + err.message, 'error'); });
    };

    // ════════════════════════════════
    //  FILTER EVENTS
    // ════════════════════════════════
    function bindFilters() {
        ['prj-search','prj-filter-sector','prj-filter-min','prj-filter-max','prj-sort'].forEach(function (id) {
            var e = el(id); if (!e) return;
            var handler = function () { currentPage = 1; applyFilters(); };
            e.addEventListener('input',  handler);
            e.addEventListener('change', handler);
        });
    }

    window.resetProjectFilters = function () {
        ['prj-search','prj-filter-min','prj-filter-max'].forEach(function (id) { if (el(id)) el(id).value = ''; });
        if (el('prj-filter-sector')) el('prj-filter-sector').value = '';
        if (el('prj-sort'))          el('prj-sort').value = 'newest';
        currentPage = 1;
        applyFilters();
        toast('Đã đặt lại bộ lọc', 'info');
    };

    // ════════════════════════════════
    //  MODAL CLOSE HELPER
    // ════════════════════════════════
    function prjCloseModal(id) {
        var modal   = el(id);
        var content = el(id + '-content');
        if (!modal) return;
        modal.classList.add('opacity-0');
        if (content) content.classList.add('scale-95');
        setTimeout(function () {
            modal.classList.add('hidden');
            if (id === 'project-modal' && typeof window.navigate === 'function') {
                window.navigate('projects');
            }
        }, 200);
    }

    window.prjCloseModal = prjCloseModal;

}());
