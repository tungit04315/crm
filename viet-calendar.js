/**
 * ================================================================
 *  viet-calendar.js  —  Lịch Vạn Niên Việt Nam
 *  Version: 1.0.0  |  CRM NeoWave
 *  TÍNH NĂNG:
 *  - Chuyển đổi Dương lịch ↔ Âm lịch (thuật toán Ho Ngoc Duc)
 *  - Can Chi ngày / tháng / năm
 *  - Mệnh ngày (Nạp Âm / Ngũ hành)
 *  - Giờ Hoàng Đạo theo Can ngày
 *  - Ngày Hoàng Đạo / Hắc Đạo (hệ Kiến Trừ)
 *  - Tuổi Xung theo Chi ngày
 *  - Ngày lễ Dương lịch & Âm lịch
 *  - Điều hướng tháng, click xem chi tiết từng ngày
 * ================================================================
 */

// ════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════

const TZ = 7; // GMT+7 Việt Nam

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
const CHI_ANIMAL = ['Chuột', 'Trâu', 'Hổ', 'Mèo', 'Rồng', 'Rắn', 'Ngựa', 'Dê', 'Khỉ', 'Gà', 'Chó', 'Heo'];

const CHI_HOUR_LABELS = [
    'Tý (23–1h)', 'Sửu (1–3h)', 'Dần (3–5h)', 'Mão (5–7h)',
    'Thìn (7–9h)', 'Tỵ (9–11h)', 'Ngọ (11–13h)', 'Mùi (13–15h)',
    'Thân (15–17h)', 'Dậu (17–19h)', 'Tuất (19–21h)', 'Hợi (21–23h)'
];

const DOW_VN = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const MONTH_VN = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

// Nạp Âm — 30 mục, mỗi mục áp dụng cho 2 ngày Can Chi liên tiếp
const NAP_AM = [
    ['Hải Trung Kim', 'Kim'], ['Lô Trung Hỏa', 'Hỏa'], ['Đại Lâm Mộc', 'Mộc'],
    ['Lộ Bàng Thổ', 'Thổ'], ['Kiếm Phong Kim', 'Kim'], ['Sơn Đầu Hỏa', 'Hỏa'],
    ['Giản Hạ Thủy', 'Thủy'], ['Thành Đầu Thổ', 'Thổ'], ['Bạch Lạp Kim', 'Kim'],
    ['Dương Liễu Mộc', 'Mộc'], ['Tuyền Trung Thủy', 'Thủy'], ['Ốc Thượng Thổ', 'Thổ'],
    ['Tích Lịch Hỏa', 'Hỏa'], ['Tùng Bách Mộc', 'Mộc'], ['Trường Lưu Thủy', 'Thủy'],
    ['Sa Trung Kim', 'Kim'], ['Sơn Hạ Hỏa', 'Hỏa'], ['Bình Địa Mộc', 'Mộc'],
    ['Bích Thượng Thổ', 'Thổ'], ['Kim Bạc Kim', 'Kim'], ['Phú Đăng Hỏa', 'Hỏa'],
    ['Thiên Hà Thủy', 'Thủy'], ['Đại Dịch Thổ', 'Thổ'], ['Thoa Xuyến Kim', 'Kim'],
    ['Tang Đố Mộc', 'Mộc'], ['Đại Khê Thủy', 'Thủy'], ['Sa Trung Thổ', 'Thổ'],
    ['Thiên Thượng Hỏa', 'Hỏa'], ['Thạch Lựu Mộc', 'Mộc'], ['Đại Hải Thủy', 'Thủy']
];

const MENH_COLOR = {
    'Kim': '#f59e0b', 'Mộc': '#22c55e', 'Thủy': '#3b82f6',
    'Hỏa': '#ef4444', 'Thổ': '#a16207'
};

// Giờ Hoàng Đạo theo nhóm Can ngày (can % 5 → mảng 6 chỉ số Chi hoàng đạo)
const GIO_HOANG_DAO = [
    [0, 1, 3, 6, 8, 9],    // Giáp / Kỷ  : Tý Sửu Mão Ngọ Thân Dậu
    [2, 3, 5, 8, 10, 11],  // Ất  / Canh : Dần Mão Tỵ Thân Tuất Hợi
    [0, 2, 4, 6, 9, 11],   // Bính/ Tân  : Tý Dần Thìn Ngọ Dậu Hợi
    [1, 3, 4, 7, 10, 11],  // Đinh/ Nhâm : Sửu Mão Thìn Mùi Tuất Hợi
    [2, 4, 5, 7, 8, 10],   // Mậu / Quý  : Dần Thìn Tỵ Mùi Thân Tuất
];

// Trực Hoàng Đạo (Trừ=1, Bình=3, Định=4, Nguy=7, Thành=8, Khai=10)
const TRUC_HOANG_DAO = new Set([1, 3, 4, 7, 8, 10]);
const TRUC_NAMES = ['Kiến', 'Trừ', 'Mãn', 'Bình', 'Định', 'Chấp', 'Phá', 'Nguy', 'Thành', 'Thu', 'Khai', 'Bế'];

// Ngày lễ Dương lịch (dd/mm)
const SOLAR_HOL = {
    '01/01': '🎆 Tết Dương Lịch',
    '08/03': '🌸 Quốc tế Phụ nữ',
    '30/04': '🏳️ Giải Phóng Miền Nam',
    '01/05': '✊ Quốc tế Lao Động',
    '19/05': '🌟 Sinh nhật Bác Hồ',
    '02/09': '🇻🇳 Quốc Khánh',
    '20/10': '🌹 Phụ nữ Việt Nam',
    '22/12': '⭐ Thành lập QĐND',
};

// Ngày lễ Âm lịch (dd/mm âm)
const LUNAR_HOL = {
    '01/01': '🎊 Mùng 1 Tết Nguyên Đán',
    '02/01': '🎊 Mùng 2 Tết',
    '03/01': '🎊 Mùng 3 Tết',
    '15/01': '🏮 Rằm tháng Giêng',
    '10/03': '🏔️ Giỗ Tổ Hùng Vương',
    '15/04': '🪷 Lễ Phật Đản',
    '05/05': '🎉 Tết Đoan Ngọ',
    '15/07': '🕯️ Rằm Tháng Bảy (Vu Lan)',
    '15/08': '🥮 Tết Trung Thu',
    '23/12': '🎋 Tiễn Ông Táo',
    '30/12': '🎊 Tất Niên',
};

// ════════════════════════════════════════════════════════════════
//  THUẬT TOÁN ÂM LỊCH  (Ho Ngoc Duc Algorithm)
// ════════════════════════════════════════════════════════════════

function INT(d) { return Math.floor(d); }

function jdFromDate(dd, mm, yy) {
    const a = INT((14 - mm) / 12);
    const y = yy + 4800 - a;
    const m = mm + 12 * a - 3;
    let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
}

function getNewMoonDay(k, tz) {
    const dr = Math.PI / 180;
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
        + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 357.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    const C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M)
        - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(2 * dr * Mpr) - 0.0004 * Math.sin(3 * dr * Mpr)
        + 0.0104 * Math.sin(2 * dr * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr))
        + 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M))
        - 0.0006 * Math.sin(dr * (2 * F + Mpr)) + 0.001 * Math.sin(dr * (2 * F - Mpr))
        + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    const deltat = T < -11
        ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
        : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return INT(Jd1 + C1 - deltat + 0.5 + tz / 24);
}

function getSunLongitude(jdn, tz) {
    const dr = Math.PI / 180;
    const T = (jdn - 2451545.5 - tz / 24) / 36525, T2 = T * T;
    const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M)
        + (0.019993 - 0.000101 * T) * Math.sin(2 * dr * M) + 0.00029 * Math.sin(3 * dr * M);
    let L = (L0 + DL) * dr;
    L -= Math.PI * 2 * INT(L / (Math.PI * 2));
    return INT(L / Math.PI * 6);
}

function getLunarMonth11(yy, tz) {
    const k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853);
    let nm = getNewMoonDay(k, tz);
    if (getSunLongitude(nm, tz) >= 9) nm = getNewMoonDay(k - 1, tz);
    return nm;
}

function getLeapMonthOffset(a11, tz) {
    const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let i = 1, last = 0, arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
    do { last = arc; i++; arc = getSunLongitude(getNewMoonDay(k + i, tz), tz); } while (arc !== last && i < 14);
    return i - 1;
}

/** Chuyển Dương lịch → Âm lịch. Trả về {day, month, year, leap} */
function solar2Lunar(dd, mm, yy) {
    const jd = jdFromDate(dd, mm, yy);
    let k = INT((jd - 2415021.076998695) / 29.530588853);
    let mStart = getNewMoonDay(k + 1, TZ);
    if (mStart > jd) mStart = getNewMoonDay(k, TZ);
    let a11 = getLunarMonth11(yy, TZ), b11 = a11, lunarYear = yy;
    if (a11 >= mStart) { a11 = getLunarMonth11(yy - 1, TZ); }
    else { lunarYear = yy + 1; b11 = getLunarMonth11(yy + 1, TZ); }
    const lunarDay = jd - mStart + 1;
    const diff = INT((mStart - a11) / 29);
    let lunarLeap = 0, lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
        const leapOff = getLeapMonthOffset(a11, TZ);
        if (diff >= leapOff) { lunarMonth = diff + 10; if (diff === leapOff) lunarLeap = 1; }
    }
    if (lunarMonth > 12) lunarMonth -= 12;
    if (lunarMonth >= 11 && diff < 4) lunarYear--;
    return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap === 1 };
}

// ════════════════════════════════════════════════════════════════
//  CAN CHI & TIỆN ÍCH
// ════════════════════════════════════════════════════════════════

function canChiYear(year) {
    return `${CAN[(year + 6) % 10]} ${CHI[(year + 8) % 12]}`;
}

function canChiMonth(lMonth, lYear) {
    const off = (lYear - 2000) * 12 + lMonth + 2;
    return `${CAN[((off % 10) + 10) % 10]} ${CHI[((off % 12) + 12) % 12]}`;
}

/** Trả về {canIdx, chiIdx, canStr, chiStr} cho một Julian Day */
function canChiDay(jd) {
    const c = ((jd + 9) % 10 + 10) % 10;
    const h = ((jd + 1) % 12 + 12) % 12;
    return { c, h, canStr: CAN[c], chiStr: CHI[h] };
}

function getNapAm(jd) {
    const idx = Math.floor(((jd - 11) % 60 + 60) % 60 / 2);
    return NAP_AM[idx] || NAP_AM[0];
}

function isHoangDaoDay(lDay, lMonth) {
    const truc = (lDay - 1 + (lMonth + 1) % 12) % 12;
    return TRUC_HOANG_DAO.has(truc);
}

function getTrucName(lDay, lMonth) {
    const truc = (lDay - 1 + (lMonth + 1) % 12) % 12;
    return TRUC_NAMES[truc];
}

function getGioHoangDao(canIdx) {
    return GIO_HOANG_DAO[canIdx % 5].map(i => CHI_HOUR_LABELS[i]);
}

function getTuoiXung(chiIdx) {
    const xungChi = (chiIdx + 6) % 12;
    const now = new Date().getFullYear();
    const years = [];
    for (let y = now + 1; y >= now - 70; y--) {
        if ((y + 8) % 12 === xungChi) { years.push(y); if (years.length >= 4) break; }
    }
    return { label: CHI[xungChi], animal: CHI_ANIMAL[xungChi], years };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function getSolarHol(d, m) { return SOLAR_HOL[`${pad2(d)}/${pad2(m)}`] || null; }
function getLunarHol(ld, lm) { return LUNAR_HOL[`${pad2(ld)}/${pad2(lm)}`] || null; }

// ════════════════════════════════════════════════════════════════
//  INJECT CSS
// ════════════════════════════════════════════════════════════════

function injectStyles() {
    if (document.getElementById('vc-css')) return;
    const css = `
    /* ── Overlay ── */
    #vc-overlay {
      position: fixed; inset: 0;
      background: rgba(2, 6, 23, .65);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
      opacity: 0; pointer-events: none;
      transition: opacity .3s ease;
    }
    #vc-overlay.vc-open { opacity: 1; pointer-events: all; }

    /* ── Modal shell ── */
    #vc-modal {
      width: 100%; max-width: 920px;
      display: grid; grid-template-columns: 300px 1fr;
      border-radius: 1.5rem;
      overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06);
      transform: translateY(28px) scale(.96);
      transition: transform .35s cubic-bezier(.34,1.56,.64,1);
      max-height: 90vh;
    }
    #vc-overlay.vc-open #vc-modal { transform: translateY(0) scale(1); }

    /* ── Left panel ── */
    #vc-panel-l {
      background: linear-gradient(155deg, #1e1b4b 0%, #3730a3 40%, #4f46e5 70%, #6d28d9 100%);
      color: #fff;
      padding: 1.75rem 1.6rem;
      display: flex; flex-direction: column; gap: 1.1rem;
      overflow-y: auto;
      position: relative;
    }
    #vc-panel-l::before {
      content: '';
      position: absolute; inset: 0;
      background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;
      pointer-events: none;
    }

    /* ── Right panel ── */
    #vc-panel-r {
      background: #ffffff;
      padding: 1.5rem;
      overflow-y: auto;
    }
    .dark #vc-panel-r { background: #0f172a; color: #e2e8f0; }

    /* ── Left panel components ── */
    .vc-header-row { display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1; }
    .vc-logo-badge {
      font-size:.65rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase;
      background:rgba(255,255,255,.15); padding:.3rem .75rem; border-radius:9999px;
      border:1px solid rgba(255,255,255,.2);
    }
    .vc-close-btn {
      background:rgba(255,255,255,.12); border:none; border-radius:.6rem;
      color:#fff; width:2.1rem; height:2.1rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      font-size:1rem; transition:background .15s;
    }
    .vc-close-btn:hover { background:rgba(255,255,255,.25); }

    .vc-date-hero { position:relative; z-index:1; }
    .vc-dow { font-size:.78rem; font-weight:600; opacity:.7; margin-bottom:.15rem; }
    .vc-solar-day { font-size:5rem; font-weight:900; line-height:.95; letter-spacing:-.06em; }
    .vc-solar-month { font-size:.9rem; font-weight:600; opacity:.75; margin-top:.2rem; }

    .vc-lunar-card {
      background:rgba(255,255,255,.13); border:1px solid rgba(255,255,255,.18);
      border-radius:.9rem; padding:.8rem 1rem; position:relative; z-index:1;
    }
    .vc-lunar-label { font-size:.62rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; opacity:.65; margin-bottom:.25rem; }
    .vc-lunar-day { font-size:1.5rem; font-weight:800; line-height:1.1; }
    .vc-lunar-year { font-size:.8rem; font-weight:600; opacity:.8; margin-top:.1rem; }
    .vc-leap-badge {
      display:inline-block; font-size:.58rem; font-weight:700; background:rgba(251,191,36,.3);
      color:#fbbf24; border-radius:9999px; padding:.15rem .5rem; margin-left:.4rem; vertical-align:middle;
    }

    .vc-chips-row { display:flex; flex-wrap:wrap; gap:.4rem; position:relative; z-index:1; }
    .vc-chip {
      font-size:.72rem; font-weight:700; padding:.3rem .7rem; border-radius:9999px;
      background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18);
    }
    .vc-chip.menh { border-color:rgba(255,255,255,.3); }

    .vc-section { position:relative; z-index:1; }
    .vc-section-title {
      font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
      opacity:.6; margin-bottom:.5rem; display:flex; align-items:center; gap:.4rem;
    }
    .vc-gio-grid { display:flex; flex-wrap:wrap; gap:.35rem; }
    .vc-gio-pill {
      font-size:.7rem; font-weight:600; padding:.3rem .65rem; border-radius:.5rem;
      background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.15);
      line-height:1.3;
    }
    .vc-gio-pill.active-hour { background:rgba(251,191,36,.25); border-color:#fbbf24; color:#fde68a; }

    .vc-xung-box {
      background:rgba(0,0,0,.2); border-radius:.75rem; padding:.7rem .9rem; border:1px solid rgba(255,255,255,.1);
    }
    .vc-xung-chi { font-size:1rem; font-weight:800; }
    .vc-xung-years { font-size:.7rem; opacity:.65; margin-top:.2rem; }

    /* ── Today button ── */
    #vc-today-btn {
      position:relative; z-index:1; margin-top:auto;
      background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.25);
      border-radius:.75rem; color:#fff; font-size:.78rem; font-weight:700;
      padding:.55rem 1rem; cursor:pointer; transition:background .15s; width:100%;
    }
    #vc-today-btn:hover { background:rgba(255,255,255,.25); }

    /* ── Right panel: Calendar ── */
    .vc-cal-nav {
      display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;
    }
    .vc-cal-nav-btn {
      background:#f1f5f9; border:none; border-radius:.6rem;
      width:2.2rem; height:2.2rem; cursor:pointer; font-size:1.1rem;
      display:flex; align-items:center; justify-content:center; transition:background .15s;
      color:#374151;
    }
    .dark .vc-cal-nav-btn { background:#1e293b; color:#e2e8f0; }
    .vc-cal-nav-btn:hover { background:#e0e7ff; color:#4f46e5; }
    .dark .vc-cal-nav-btn:hover { background:#312e81; color:#a5b4fc; }
    .vc-cal-title { font-weight:800; font-size:1.05rem; text-align:center; }

    .vc-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
    .vc-dow-hdr {
      text-align:center; font-size:.65rem; font-weight:700;
      color:#9ca3af; padding:.35rem 0; letter-spacing:.04em;
    }
    .dark .vc-dow-hdr { color:#64748b; }
    .vc-dow-hdr.wknd { color:#f87171; }

    .vc-day {
      border-radius:.55rem; padding:.3rem .15rem;
      text-align:center; cursor:pointer;
      transition:background .12s, transform .1s;
      min-height:54px; display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:1px;
      position:relative;
    }
    .vc-day:hover:not(.vc-other) { background:#eef2ff; transform:scale(1.06); }
    .dark .vc-day:hover:not(.vc-other) { background:#1e1b4b; }
    .vc-day.vc-other { opacity:.3; cursor:default; }
    .vc-day.vc-today {
      background:linear-gradient(135deg, #4f46e5, #7c3aed);
      color:#fff !important;
    }
    .vc-day.vc-selected:not(.vc-today) {
      background:#e0e7ff; color:#3730a3;
      box-shadow:inset 0 0 0 2px #6366f1;
    }
    .dark .vc-day.vc-selected:not(.vc-today) { background:#1e1b4b; color:#a5b4fc; }

    .vc-day-sol {
      font-size:.9rem; font-weight:700; line-height:1;
    }
    .vc-day.wknd-day .vc-day-sol { color:#ef4444; }
    .vc-day.vc-today .vc-day-sol, .vc-day.vc-today .vc-day-lun { color:#fff !important; }
    .vc-day.solar-hol .vc-day-sol { color:#ef4444; font-weight:800; }
    .vc-day.lunar-hol .vc-day-sol { color:#f59e0b; }

    .vc-day-lun { font-size:.58rem; color:#94a3b8; line-height:1; font-weight:500; }
    .dark .vc-day-lun { color:#64748b; }
    .vc-day.vc-selected:not(.vc-today) .vc-day-lun { color:#6366f1; }

    .vc-hd-dot {
      width:4px; height:4px; border-radius:50%; margin-top:1px;
    }
    .vc-hd-dot.hd { background:#f59e0b; }
    .vc-hd-dot.hac { background:#cbd5e1; }
    .dark .vc-hd-dot.hac { background:#475569; }
    .vc-day.vc-today .vc-hd-dot { opacity:.7; }

    /* ── Legend & Holiday info ── */
    .vc-legend {
      display:flex; gap:.85rem; flex-wrap:wrap; margin-top:.85rem;
      font-size:.68rem; color:#9ca3af; align-items:center;
    }
    .dark .vc-legend { color:#64748b; }
    .vc-legend-item { display:flex; align-items:center; gap:.3rem; }
    .vc-hol-banner {
      margin-top:.85rem; padding:.6rem .9rem; border-radius:.75rem;
      font-size:.8rem; font-weight:700;
      background:linear-gradient(135deg,#fef3c7,#fde68a);
      color:#92400e; border:1px solid #fcd34d;
    }
    .dark .vc-hol-banner { background:rgba(251,191,36,.15); color:#fde68a; border-color:rgba(251,191,36,.3); }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      #vc-modal { grid-template-columns:1fr; max-height:95dvh; }
      #vc-panel-l { border-radius:0; padding:1.25rem; max-height:45dvh; }
      #vc-panel-r { max-height:50dvh; }
    }
  `;
    const el = document.createElement('style');
    el.id = 'vc-css';
    el.textContent = css;
    document.head.appendChild(el);
}

// ════════════════════════════════════════════════════════════════
//  BUILD HTML SKELETON
// ════════════════════════════════════════════════════════════════

function buildHTML() {
    return `
  <div id="vc-overlay" role="dialog" aria-modal="true" aria-label="Lịch Vạn Niên">
    <div id="vc-modal">

      <!-- LEFT PANEL: Today Info -->
      <div id="vc-panel-l">
        <div class="vc-header-row">
          <span class="vc-logo-badge">🗓 Lịch Vạn Niên</span>
          <button class="vc-close-btn" id="vc-close" aria-label="Đóng">✕</button>
        </div>

        <div class="vc-date-hero" id="vc-date-hero"></div>
        <div class="vc-lunar-card" id="vc-lunar-card"></div>
        <div class="vc-chips-row" id="vc-chips"></div>
        <div class="vc-section" id="vc-gio-section"></div>
        <div class="vc-section" id="vc-xung-section"></div>

        <button id="vc-today-btn" onclick="window.vcGoToday()">↩ Về hôm nay</button>
      </div>

      <!-- RIGHT PANEL: Calendar Grid -->
      <div id="vc-panel-r">
        <div class="vc-cal-nav" id="vc-cal-nav"></div>
        <div class="vc-cal-grid" id="vc-cal-grid"></div>
        <div class="vc-legend" id="vc-legend"></div>
        <div id="vc-hol-info"></div>
      </div>

    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
//  RENDER FUNCTIONS
// ════════════════════════════════════════════════════════════════

/** Render thông tin ngày đã chọn vào Left Panel */
function renderDayInfo(date) {
    const dd = date.getDate(), mm = date.getMonth() + 1, yy = date.getFullYear();
    const jd = jdFromDate(dd, mm, yy);
    const lunar = solar2Lunar(dd, mm, yy);
    const { c, h, canStr, chiStr } = canChiDay(jd);
    const [napAmName, napAmMenh] = getNapAm(jd);
    const ccMonth = canChiMonth(lunar.month, lunar.year);
    const ccYear = canChiYear(lunar.year);
    const hd = isHoangDaoDay(lunar.day, lunar.month);
    const truc = getTrucName(lunar.day, lunar.month);

    // Current hour's chi
    const nowHour = new Date().getHours();
    const currentChiHour = INT((nowHour + 1) / 2) % 12;

    // Date hero
    document.getElementById('vc-date-hero').innerHTML = `
    <div class="vc-dow">${DOW_VN[date.getDay()]} · ${MONTH_VN[mm - 1]} ${yy}</div>
    <div class="vc-solar-day">${dd}</div>
    <div class="vc-solar-month">${MONTH_VN[mm - 1]} năm ${yy}</div>
  `;

    // Lunar card
    document.getElementById('vc-lunar-card').innerHTML = `
    <div class="vc-lunar-label">☾ Âm Lịch</div>
    <div class="vc-lunar-day">
      Ngày ${lunar.day} Tháng ${lunar.month}
      ${lunar.leap ? '<span class="vc-leap-badge">Nhuận</span>' : ''}
    </div>
    <div class="vc-lunar-year">${canStr} ${chiStr} · ${ccMonth} · Năm ${ccYear}</div>
    <div style="font-size:.72rem;opacity:.6;margin-top:.35rem">
      Trực: <b>${truc}</b> · <span style="color:${hd ? '#fbbf24' : '#94a3b8'};font-weight:700">${hd ? '✦ Ngày Hoàng Đạo' : '▪ Ngày Hắc Đạo'}</span>
    </div>
  `;

    // Chips
    const menhColor = MENH_COLOR[napAmMenh] || '#94a3b8';
    document.getElementById('vc-chips').innerHTML = `
    <span class="vc-chip menh" style="background:${menhColor}22;border-color:${menhColor}55;color:${menhColor}">
      ◈ ${napAmMenh} · ${napAmName}
    </span>
    <span class="vc-chip">🗓 ${canStr} ${chiStr}</span>
  `;

    // Giờ Hoàng Đạo
    const gioHD = getGioHoangDao(c);
    const hdChiIdxes = GIO_HOANG_DAO[c % 5];
    document.getElementById('vc-gio-section').innerHTML = `
    <div class="vc-section-title">⭐ Giờ Hoàng Đạo</div>
    <div class="vc-gio-grid">
      ${gioHD.map((g, i) => {
        const chiIdx = hdChiIdxes[i];
        const isCurrent = chiIdx === currentChiHour;
        return `<span class="vc-gio-pill${isCurrent ? ' active-hour' : ''}">${isCurrent ? '▶ ' : ''}${g}</span>`;
    }).join('')}
    </div>
  `;

    // Tuổi xung
    const xung = getTuoiXung(h);
    document.getElementById('vc-xung-section').innerHTML = `
    <div class="vc-section-title">⚡ Tuổi Xung</div>
    <div class="vc-xung-box">
      <div class="vc-xung-chi">Tuổi ${xung.label} (${xung.animal})</div>
      <div class="vc-xung-years">Các năm: ${xung.years.join(' · ')}</div>
    </div>
  `;
}

/** Render lưới lịch tháng vào Right Panel */
function renderCalendar(year, month) {
    _vcState.year = year;
    _vcState.month = month;

    // Nav header
    document.getElementById('vc-cal-nav').innerHTML = `
    <button class="vc-cal-nav-btn" id="vc-prev" title="Tháng trước">‹</button>
    <div>
      <div class="vc-cal-title">${MONTH_VN[month - 1]} ${year}</div>
    </div>
    <button class="vc-cal-nav-btn" id="vc-next" title="Tháng sau">›</button>
  `;
    document.getElementById('vc-prev').onclick = () => {
        let m = month - 1, y = year;
        if (m < 1) { m = 12; y--; }
        renderCalendar(y, m);
    };
    document.getElementById('vc-next').onclick = () => {
        let m = month + 1, y = year;
        if (m > 12) { m = 1; y++; }
        renderCalendar(y, m);
    };

    const today = new Date();
    const selectedD = _vcState.selectedDate;

    // Day-of-week headers (Mon → Sun)
    const DOW_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    let html = DOW_SHORT.map((d, i) =>
        `<div class="vc-dow-hdr${i >= 5 ? ' wknd' : ''}">${d}</div>`
    ).join('');

    const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const startOffset = firstDow === 0 ? 6 : firstDow - 1;  // Convert to Mon=0
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevDays = new Date(year, month - 1, 0).getDate();

    // Previous month filler
    for (let i = startOffset - 1; i >= 0; i--) {
        const d = prevDays - i;
        const pm = month - 1 < 1 ? 12 : month - 1;
        const py = month - 1 < 1 ? year - 1 : year;
        const lun = solar2Lunar(d, pm, py);
        html += `<div class="vc-day vc-other">
      <div class="vc-day-sol">${d}</div>
      <div class="vc-day-lun">${lun.day}</div>
    </div>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const isWknd = dow === 0 || dow === 6;
        const isToday = d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
        const isSel = selectedD && d === selectedD.d && month === selectedD.m && year === selectedD.y;
        const lun = solar2Lunar(d, month, year);
        const hd = isHoangDaoDay(lun.day, lun.month);
        const sHol = getSolarHol(d, month);
        const lHol = getLunarHol(lun.day, lun.month);

        const cls = ['vc-day',
            isToday ? 'vc-today' : '',
            isSel && !isToday ? 'vc-selected' : '',
            isWknd && !isToday ? 'wknd-day' : '',
            sHol ? 'solar-hol' : '',
            !sHol && lHol ? 'lunar-hol' : ''
        ].filter(Boolean).join(' ');

        const lunLabel = lun.day === 1 ? `${lun.day}/${lun.month}` : `${lun.day}`;

        html += `<div class="${cls}"
      data-d="${d}" data-m="${month}" data-y="${year}"
      onclick="window.vcSelectDay(${d},${month},${year})">
      <div class="vc-day-sol">${d}</div>
      <div class="vc-day-lun">${lunLabel}</div>
      <div class="vc-hd-dot ${hd ? 'hd' : 'hac'}"></div>
    </div>`;
    }

    // Next month filler
    const totalCells = startOffset + daysInMonth;
    const trail = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= trail; d++) {
        const nm = month + 1 > 12 ? 1 : month + 1;
        const ny = month + 1 > 12 ? year + 1 : year;
        const lun = solar2Lunar(d, nm, ny);
        html += `<div class="vc-day vc-other">
      <div class="vc-day-sol">${d}</div>
      <div class="vc-day-lun">${lun.day}</div>
    </div>`;
    }

    document.getElementById('vc-cal-grid').innerHTML = html;

    // Legend
    document.getElementById('vc-legend').innerHTML = `
    <div class="vc-legend-item"><div class="vc-hd-dot hd"></div><span>Hoàng đạo</span></div>
    <div class="vc-legend-item"><div class="vc-hd-dot hac"></div><span>Hắc đạo</span></div>
    <div class="vc-legend-item" style="color:#ef4444">■ Lễ / Cuối tuần</div>
    <div class="vc-legend-item" style="color:#f59e0b">■ Âm lịch đặc biệt</div>
  `;
}

/** Cập nhật banner ngày lễ */
function updateHolInfo(d, m, y) {
    const lun = solar2Lunar(d, m, y);
    const sHol = getSolarHol(d, m);
    const lHol = getLunarHol(lun.day, lun.month);
    const el = document.getElementById('vc-hol-info');
    if (sHol || lHol) {
        el.innerHTML = `<div class="vc-hol-banner">${sHol || lHol}</div>`;
    } else {
        el.innerHTML = '';
    }
}

// ════════════════════════════════════════════════════════════════
//  STATE & PUBLIC API
// ════════════════════════════════════════════════════════════════

const _vcState = { year: 0, month: 0, selectedDate: null };

/** Click vào một ô ngày trong lịch */
window.vcSelectDay = function (d, m, y) {
    _vcState.selectedDate = { d, m, y };
    renderDayInfo(new Date(y, m - 1, d));
    // Re-render để cập nhật highlight vc-selected (không render lại header)
    renderCalendar(_vcState.year, _vcState.month);
    updateHolInfo(d, m, y);
};

/** Về hôm nay */
window.vcGoToday = function () {
    const t = new Date();
    _vcState.selectedDate = { d: t.getDate(), m: t.getMonth() + 1, y: t.getFullYear() };
    renderDayInfo(t);
    renderCalendar(t.getFullYear(), t.getMonth() + 1);
    updateHolInfo(t.getDate(), t.getMonth() + 1, t.getFullYear());
};

/** Mở modal lịch */
window.vcOpen = function () {
    const overlay = document.getElementById('vc-overlay');
    const t = new Date();
    _vcState.selectedDate = { d: t.getDate(), m: t.getMonth() + 1, y: t.getFullYear() };
    renderDayInfo(t);
    renderCalendar(t.getFullYear(), t.getMonth() + 1);
    updateHolInfo(t.getDate(), t.getMonth() + 1, t.getFullYear());
    overlay.classList.add('vc-open');
};

/** Đóng modal lịch */
window.vcClose = function () {
    document.getElementById('vc-overlay')?.classList.remove('vc-open');
};

// ════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════

function vcInit() {
    injectStyles();
    document.body.insertAdjacentHTML('beforeend', buildHTML());
    document.getElementById('vc-close').addEventListener('click', window.vcClose);
    document.getElementById('vc-overlay').addEventListener('click', e => {
        if (e.target.id === 'vc-overlay') window.vcClose();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') window.vcClose();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', vcInit);
} else {
    vcInit();
}