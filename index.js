// ================================================================
//  functions/index.js
//  Firebase Cloud Functions — Contract Builder
//  Version: 2.0.0  |  Node 20 Runtime
//
//  DEPLOY:
//    cd functions && npm install && cd ..
//    firebase deploy --only functions
//
//  CÀI ĐẶT:
//    cd functions
//    npm install firebase-admin firebase-functions @sparticuz/chromium
//        puppeteer-core nodemailer docx
//
//  ENV CONFIG (set trước khi deploy):
//    firebase functions:secrets:set SMTP_USER
//    firebase functions:secrets:set SMTP_PASS
//    firebase functions:secrets:set SMTP_HOST   (mặc định: smtp.gmail.com)
//
//  COLLECTIONS đọc/ghi:
//    exportJobs, contracts, contractDrafts, export_history, auditLogs
// ================================================================

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// ── Secrets (set qua firebase functions:secrets:set) ─────────────
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');

// ── Config ───────────────────────────────────────────────────────
const APP_ID = 'demo-marketing-crm-v4'; // Đồng bộ với app.js
const REGION = 'asia-southeast1';
const STORAGE_BUCKET = 'crm-neo-wave.firebasestorage.app';

const col = (name) => db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection(name);
const docRef = (colName, id) => col(colName).doc(id);

// ─────────────────────────────────────────────────────────────────
//  TRIGGER: processExportJob
//  Kích hoạt khi tạo document mới trong exportJobs collection.
//  Xử lý: pdf | docx | email
// ─────────────────────────────────────────────────────────────────
exports.processExportJob = onDocumentCreated(
    {
        document: `artifacts/${APP_ID}/public/data/exportJobs/{jobId}`,
        region: REGION,
        secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS],
        memory: '1GiB',
        timeoutSeconds: 120,
    },
    async (event) => {
        const jobId = event.params.jobId;
        const jobData = event.data?.data();
        if (!jobData) return;

        const { contractId, type, options = {}, createdBy } = jobData;

        logger.info(`[processExportJob] jobId=${jobId} type=${type} contractId=${contractId}`);

        // Mark as processing
        await _updateJob(jobId, { status: 'processing' });

        try {
            // Load contract data
            const contractSnap = await docRef('contracts', contractId).get();
            if (!contractSnap.exists) throw new Error('Contract not found: ' + contractId);
            const contract = { id: contractSnap.id, ...contractSnap.data() };

            let fileUrl = null;

            if (type === 'pdf') {
                fileUrl = await _generatePDF(jobId, contract);
            } else if (type === 'docx') {
                fileUrl = await _generateDOCX(jobId, contract);
            } else if (type === 'email') {
                await _sendEmail(contract, options);
            } else {
                throw new Error('Unknown export type: ' + type);
            }

            // Mark done
            await _updateJob(jobId, {
                status: 'done',
                fileUrl: fileUrl || null,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Save to export_history
            await _saveExportHistory(contractId, type, fileUrl, createdBy, contract);

            // Audit log
            await col('auditLogs').add({
                action: 'export_completed',
                contractId,
                userId: createdBy,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                changes: { type, fileUrl },
            });

            logger.info(`[processExportJob] ✅ Done. jobId=${jobId} fileUrl=${fileUrl}`);

        } catch (err) {
            logger.error(`[processExportJob] ❌ Error:`, err);
            await _updateJob(jobId, {
                status: 'failed',
                error: err.message,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
);

// ─────────────────────────────────────────────────────────────────
//  CALLABLE: sendContractEmail
//  Gọi từ client: window.cbBackend.sendEmail(...)
// ─────────────────────────────────────────────────────────────────
exports.sendContractEmail = onCall(
    {
        region: REGION,
        secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS],
        enforceAppCheck: false,
    },
    async (request) => {
        // Auth check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Vui lòng đăng nhập');
        }

        const { contractId, toEmail, subject, body } = request.data;

        if (!contractId || !toEmail) {
            throw new HttpsError('invalid-argument', 'contractId và toEmail là bắt buộc');
        }

        // Email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
            throw new HttpsError('invalid-argument', 'Email không hợp lệ: ' + toEmail);
        }

        // Load contract
        const snap = await docRef('contracts', contractId).get();
        if (!snap.exists) {
            throw new HttpsError('not-found', 'Không tìm thấy hợp đồng: ' + contractId);
        }
        const contract = snap.data();

        // Kiểm tra quyền: chỉ chủ hợp đồng hoặc admin
        if (contract.createdBy !== request.auth.uid) {
            const userSnap = await docRef('users', request.auth.uid).get();
            const role = userSnap.exists ? userSnap.data().role : 'viewer';
            if (!['admin', 'editor'].includes(role)) {
                throw new HttpsError('permission-denied', 'Không có quyền gửi email hợp đồng này');
            }
        }

        await _sendEmail(contract, { toEmail, subject, body });

        // Audit log
        await col('auditLogs').add({
            action: 'email_sent',
            contractId,
            userId: request.auth.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            changes: { toEmail, subject },
        });

        return { success: true, toEmail };
    }
);

// ─────────────────────────────────────────────────────────────────
//  CALLABLE: updateProgressStatus
//  Cập nhật tiến độ contract từ client (nếu cần)
// ─────────────────────────────────────────────────────────────────
exports.updateProgressStatus = onCall(
    { region: REGION },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Chưa đăng nhập');

        const { contractId, status } = request.data;
        const validStatuses = ['draft', 'in_review', 'approved', 'exported', 'archived'];

        if (!validStatuses.includes(status)) {
            throw new HttpsError('invalid-argument', 'Trạng thái không hợp lệ: ' + status);
        }

        const snap = await docRef('contracts', contractId).get();
        if (!snap.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng');

        const contract = snap.data();
        if (contract.createdBy !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Không có quyền cập nhật');
        }

        await docRef('contracts', contractId).update({
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            version: (contract.version || 1) + 1,
        });

        return { success: true, status };
    }
);

// ─────────────────────────────────────────────────────────────────
//  HELPER: Generate PDF via Puppeteer + Chromium
// ─────────────────────────────────────────────────────────────────
async function _generatePDF(jobId, contract) {
    let chromium, puppeteer;
    try {
        chromium = require('@sparticuz/chromium');
        puppeteer = require('puppeteer-core');
    } catch (e) {
        throw new Error('puppeteer-core hoặc @sparticuz/chromium chưa được cài. Chạy: npm install @sparticuz/chromium puppeteer-core');
    }

    const html = _buildContractHTML(contract);

    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    let pdfBuffer;
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
            printBackground: true,
        });
    } finally {
        await browser.close();
    }

    // Upload to Firebase Storage
    const filename = `contracts/${contract.contractNumber || jobId}_${Date.now()}.pdf`;
    const fileRef = storage.bucket(STORAGE_BUCKET).file(filename);
    await fileRef.save(pdfBuffer, { contentType: 'application/pdf' });
    await fileRef.makePublic();
    const [metadata] = await fileRef.getMetadata();
    return metadata.mediaLink || `https://storage.googleapis.com/${STORAGE_BUCKET}/${filename}`;
}

// ─────────────────────────────────────────────────────────────────
//  HELPER: Generate DOCX via docx npm package
// ─────────────────────────────────────────────────────────────────
async function _generateDOCX(jobId, contract) {
    let docxLib;
    try {
        docxLib = require('docx');
    } catch (e) {
        throw new Error('docx package chưa được cài. Chạy: npm install docx');
    }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, BorderStyle, WidthType } = docxLib;

    const fmt = n => n ? new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ' : '–';
    const d = contract;
    const pt = d.paymentTerms || {};
    const pA = d.partyA || {};
    const pB = d.partyB || {};
    const wp = d.warrantyPolicy || {};
    const scope = d.scopeOfServices || {};

    const features = [
        ...(scope.selectedFeatures || []),
        ...(scope.customFeatures || []),
    ];

    const doc = new Document({
        styles: {
            default: {
                document: { run: { font: 'Times New Roman', size: 24 } },
            },
        },
        sections: [{
            children: [
                new Paragraph({
                    text: d.contractType || 'HỢP ĐỒNG DỊCH VỤ WEBSITE',
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                }),
                new Paragraph({ text: `Số: ${d.contractNumber || '...'}`, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: `Ngày ký: ${d.signingDate || '...'} — Tại: ${d.signingPlace || '...'}` }),
                new Paragraph({ text: '' }),

                new Paragraph({ text: 'Điều 1. THÔNG TIN CÁC BÊN', heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: 'BÊN A (Bên cung cấp dịch vụ):', bold: true }),
                new Paragraph({ text: `Tên công ty: ${pA.company || '...'}` }),
                new Paragraph({ text: `Địa chỉ: ${pA.address || '...'}` }),
                new Paragraph({ text: `Điện thoại: ${pA.phone || '...'}  |  Email: ${pA.email || '...'}` }),
                new Paragraph({ text: `Người đại diện: ${pA.representative || '...'} — Chức vụ: ${pA.title || '...'}` }),
                new Paragraph({ text: '' }),

                new Paragraph({ text: 'BÊN B (Bên thuê dịch vụ):', bold: true }),
                new Paragraph({ text: `Họ tên: ${pB.name || '...'}  |  CCCD: ${pB.nationalId || '...'}` }),
                new Paragraph({ text: `Địa chỉ: ${pB.address || '...'}` }),
                new Paragraph({ text: `Điện thoại: ${pB.phone || '...'}  |  Email: ${pB.email || '...'}` }),
                new Paragraph({ text: '' }),

                new Paragraph({ text: 'Điều 2. PHẠM VI DỊCH VỤ', heading: HeadingLevel.HEADING_2 }),
                ...features.map((f, i) => new Paragraph({ text: `${i + 1}. ${f}`, bullet: { level: 0 } })),
                new Paragraph({ text: '' }),

                new Paragraph({ text: 'Điều 3. GIÁ TRỊ VÀ THANH TOÁN', heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: `Giá trị dịch vụ: ${fmt(pt.totalValue)}` }),
                pt.hostingFee > 0 ? new Paragraph({ text: `Phí hosting: ${fmt(pt.hostingFee)}` }) : null,
                pt.domainFee > 0 ? new Paragraph({ text: `Phí domain: ${fmt(pt.domainFee)}` }) : null,
                new Paragraph({ text: `VAT (${pt.vatPercent || 0}%): ${fmt(pt.vatAmount)}` }),
                new Paragraph({
                    children: [
                        new TextRun({ text: `TỔNG CỘNG: ${fmt(pt.grandTotal)}`, bold: true, size: 28 }),
                    ],
                }),
                new Paragraph({ text: '' }),

                ...(pt.rounds || []).map((r, i) =>
                    new Paragraph({ text: `Đợt ${i + 1}: ${r.label} — ${r.pct}% (${fmt(r.amount)})` })
                ),
                new Paragraph({ text: '' }),

                new Paragraph({ text: 'Điều 5. BẢO HÀNH & CHỈNH SỬA', heading: HeadingLevel.HEADING_2 }),
                wp.enabled
                    ? new Paragraph({ text: `Thời gian bảo hành: ${wp.months || 12} tháng. Số lần chỉnh sửa miễn phí: ${wp.freeEdits || 3} lần.` })
                    : new Paragraph({ text: 'Không áp dụng bảo hành.' }),
                new Paragraph({ text: '' }),

                // Legal clauses
                new Paragraph({ text: 'Điều 6. ĐIỀU KHOẢN PHÁP LÝ', heading: HeadingLevel.HEADING_2 }),
                ...Object.entries(d.legalTerms || {}).map(([key, val]) =>
                    new Paragraph({ text: val || '' })
                ),
            ].filter(Boolean),
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `contracts/${d.contractNumber || jobId}_${Date.now()}.docx`;
    const fileRef = storage.bucket(STORAGE_BUCKET).file(filename);
    await fileRef.save(buffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await fileRef.makePublic();
    const [metadata] = await fileRef.getMetadata();
    return metadata.mediaLink || `https://storage.googleapis.com/${STORAGE_BUCKET}/${filename}`;
}

// ─────────────────────────────────────────────────────────────────
//  HELPER: Send Email via Nodemailer
// ─────────────────────────────────────────────────────────────────
async function _sendEmail(contract, options = {}) {
    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch (e) {
        throw new Error('nodemailer chưa được cài. Chạy: npm install nodemailer');
    }

    const smtpHost = SMTP_HOST.value() || 'smtp.gmail.com';
    const smtpUser = SMTP_USER.value();
    const smtpPass = SMTP_PASS.value();

    if (!smtpUser || !smtpPass) {
        throw new Error('SMTP_USER hoặc SMTP_PASS chưa được cấu hình. Dùng: firebase functions:secrets:set SMTP_USER');
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: 587,
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false },
    });

    const toEmail = options.toEmail || contract.partyB?.email;
    if (!toEmail) throw new Error('Không có địa chỉ email người nhận');

    const subject = options.subject || `Hợp đồng dịch vụ website - Số: ${contract.contractNumber || '...'}`;
    const body = options.body || `Kính gửi ${contract.partyB?.name || 'Quý khách'},\n\nChúng tôi gửi đến Quý khách hợp đồng dịch vụ website đã thỏa thuận.\n\nTrân trọng.`;

    const htmlBody = _buildEmailHTML(contract, body);

    await transporter.sendMail({
        from: `"${contract.partyA?.company || 'CRM System'}" <${smtpUser}>`,
        to: toEmail,
        subject,
        text: body,
        html: htmlBody,
    });

    logger.info(`[sendEmail] Email gửi thành công đến: ${toEmail}`);
}

// ─────────────────────────────────────────────────────────────────
//  HELPER: Build contract HTML for PDF/Email
// ─────────────────────────────────────────────────────────────────
function _buildContractHTML(contract) {
    const fmt = n => n ? new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ' : '–';
    const fmtD = s => s ? new Date(s).toLocaleDateString('vi-VN') : '...';
    const d = contract;
    const pA = d.partyA || {};
    const pB = d.partyB || {};
    const pt = d.paymentTerms || {};
    const wp = d.warrantyPolicy || {};
    const scope = d.scopeOfServices || {};
    const legal = d.legalTerms || {};

    const features = [
        ...(scope.selectedFeatures || []),
        ...(scope.customFeatures || []),
    ];

    const paymentRows = (pt.rounds || []).map((r, i) => `
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${i + 1}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${r.label}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${r.pct}%</td>
      <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-weight:bold">${fmt(r.amount)}</td>
    </tr>
  `).join('');

    const legalHtml = Object.entries(legal).map(([, val]) =>
        `<p style="margin:6px 0">${val}</p>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8">
<style>
  body { font-family: "Times New Roman", serif; font-size: 12px; color: #000; margin: 0; padding: 20mm; }
  h1 { font-size: 16px; text-align: center; text-transform: uppercase; font-weight: 900; letter-spacing: 2px; }
  h2 { font-size: 13px; font-weight: 800; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  p { margin: 4px 0; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  td, th { border: 1px solid #ccc; padding: 5px 8px; }
  th { background: #f3f4f6; font-weight: 700; }
  .signature { display: flex; justify-content: space-between; margin-top: 40px; }
  .sig-box { text-align: center; flex: 1; }
  .sig-line { height: 60px; border-bottom: 1px solid #333; margin: 8px 20px 4px; }
</style>
</head><body>
  <h1>${d.contractType || 'HỢP ĐỒNG DỊCH VỤ WEBSITE'}</h1>
  <p style="text-align:center">Số: <strong>${d.contractNumber || '...'}</strong></p>
  <p style="text-align:center">Ngày ký: <strong>${fmtD(d.signingDate)}</strong> — Tại: <strong>${d.signingPlace || '...'}</strong></p>
  <hr style="border:none;border-top:2px solid #000;margin:16px 0">

  <h2>Điều 1. Thông tin các bên</h2>
  <p><strong>BÊN A (Bên cung cấp dịch vụ):</strong></p>
  <p>Tên công ty: <strong>${pA.company || '...'}</strong></p>
  <p>Địa chỉ: ${pA.address || '...'}</p>
  <p>Điện thoại: ${pA.phone || '...'}  &nbsp;|&nbsp; Email: ${pA.email || '...'}</p>
  <p>Người đại diện: <strong>${pA.representative || '...'}</strong> — Chức vụ: ${pA.title || '...'}</p>
  <br>
  <p><strong>BÊN B (Bên thuê dịch vụ):</strong></p>
  <p>Họ tên: <strong>${pB.name || '...'}</strong> &nbsp;|&nbsp; CCCD: ${pB.nationalId || '...'}</p>
  <p>Địa chỉ: ${pB.address || '...'}</p>
  <p>Điện thoại: ${pB.phone || '...'}  &nbsp;|&nbsp; Email: ${pB.email || '...'}</p>

  <h2>Điều 2. Phạm vi dịch vụ</h2>
  <ol>${features.map((f, i) => `<li>${f}</li>`).join('')}</ol>

  <h2>Điều 3. Giá trị và thanh toán</h2>
  <table>
    <thead>
      <tr><th>STT</th><th>Đợt thanh toán</th><th>%</th><th>Số tiền</th></tr>
    </thead>
    <tbody>${paymentRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;font-weight:700">Tổng cộng (VAT ${pt.vatPercent || 0}%):</td>
        <td style="text-align:right;font-weight:900">${fmt(pt.grandTotal)}</td>
      </tr>
    </tfoot>
  </table>

  <h2>Điều 4. Tiến độ thực hiện</h2>
  ${(d.timeline || []).map(t => `<p><strong>${t.days}:</strong> ${t.title} — ${t.desc}</p>`).join('')}

  <h2>Điều 5. Bảo hành & chỉnh sửa</h2>
  ${wp.enabled
            ? `<p>Thời gian bảo hành: <strong>${wp.months} tháng</strong> kể từ bàn giao.</p>
       <p>Chỉnh sửa miễn phí: <strong>${wp.freeEdits} lần</strong>.</p>
       ${wp.extraTerms ? `<p>Điều kiện phát sinh: ${wp.extraTerms}</p>` : ''}`
            : '<p>Không áp dụng bảo hành.</p>'}

  <h2>Điều 6. Điều khoản pháp lý</h2>
  ${legalHtml}

  <hr style="border:none;border-top:1px solid #ccc;margin:32px 0 16px">
  <div class="signature">
    <div class="sig-box">
      <p><strong>BÊN A</strong></p>
      <div class="sig-line"></div>
      <p>${pA.representative || ''}</p>
      <p>${pA.company || ''}</p>
    </div>
    <div class="sig-box">
      <p><strong>BÊN B</strong></p>
      <div class="sig-line"></div>
      <p>${pB.name || ''}</p>
    </div>
  </div>
</body></html>`;
}

function _buildEmailHTML(contract, bodyText) {
    const d = contract;
    const pA = d.partyA || {};
    return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;text-align:center">
      <h2 style="color:#fff;margin:0;font-size:20px">${d.contractType || 'Hợp đồng dịch vụ'}</h2>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">Số: ${d.contractNumber || '...'}</p>
    </div>
    <div style="padding:24px">
      <p style="white-space:pre-line;line-height:1.8;color:#374151">${bodyText}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <p style="font-size:12px;color:#9ca3af;text-align:center">
        ${pA.company || ''} &mdash; ${pA.phone || ''} &mdash; ${pA.email || ''}
      </p>
    </div>
  </div>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────
//  HELPER: Update exportJob
// ─────────────────────────────────────────────────────────────────
async function _updateJob(jobId, data) {
    await col('exportJobs').doc(jobId).update({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// ─────────────────────────────────────────────────────────────────
//  HELPER: Save export history (tương thích app.js historyData)
// ─────────────────────────────────────────────────────────────────
async function _saveExportHistory(contractId, type, fileUrl, userId, contract) {
    await col('export_history').add({
        contractId,
        contractNumber: contract.contractNumber || '',
        contractType: contract.contractType || 'HỢP ĐỒNG',
        partyBName: contract.partyB?.name || '',
        exportType: type,
        fileUrl: fileUrl || '',
        exportedBy: userId,
        exportedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Compat với renderHistory() trong app.js
        name: `HopDong_${contract.contractNumber || contractId}.${type}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}