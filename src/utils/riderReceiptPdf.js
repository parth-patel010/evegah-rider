import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoPngUrl from "../assets/logo.png";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "./dateFormat";

function safeString(value) {
  if (value === null || value === undefined) return "-";
  const s = String(value);
  return s.trim() ? s : "-";
}

function formatPublicId(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  const base = s.split("-")[0] || s;
  if (base && base.length >= 6) return `EVEGAH-${base.toUpperCase()}`;
  return s;
}

function formatDateTime(value) {
  return formatDateTimeDDMMYYYY(value, safeString(value));
}

function maskAadhaar(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 12) return safeString(value);
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

function toInr(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return safeString(value);
  return `₹ ${n.toFixed(2)}`;
}

let cachedRupeePngDataUrl = null;

function getRupeePngDataUrl() {
  if (cachedRupeePngDataUrl) return cachedRupeePngDataUrl;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";

    // Use common system fonts; the browser will pick one that supports ₹.
    ctx.font = '700 72px "Noto Sans", "Segoe UI Symbol", "Segoe UI", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("₹", canvas.width / 2, canvas.height / 2 + 2);

    cachedRupeePngDataUrl = canvas.toDataURL("image/png");
    return cachedRupeePngDataUrl;
  } catch {
    return null;
  }
}

function getCellPaddingLeft(cell) {
  try {
    if (cell && typeof cell.padding === "function") return Number(cell.padding("left")) || 0;
  } catch {
    // ignore
  }
  return 0;
}

function bumpLeftPadding(cell, deltaMm) {
  const current = cell?.styles?.cellPadding;
  if (typeof current === "number") {
    cell.styles.cellPadding = { top: current, right: current, bottom: current, left: current + deltaMm };
    return;
  }
  const left = Number(current?.left ?? 0) || 0;
  const top = Number(current?.top ?? 0) || 0;
  const right = Number(current?.right ?? 0) || 0;
  const bottom = Number(current?.bottom ?? 0) || 0;
  cell.styles.cellPadding = { top, right, bottom, left: left + deltaMm };
}

const BRAND = {
  // Matches Tailwind `evegah.primary` / logo primary: #2A195C
  primary: [42, 25, 92],
  // Light purple used for subtle accents: #E7E0FF
  primaryLight: [231, 224, 255],
  border: [210, 210, 210],
  mutedText: [90, 90, 90],
};

const RULES_AND_REGULATIONS_BULLETS = [
  "ID Documentation: Renters must provide a valid government-issued ID, which will be photocopied for verification purposes. Evegah guarantees that IDs will be used solely for verification purposes. All personal data will be managed in strict compliance with applicable privacy laws and regulations.",
  "Usage Instructions: Evegah will provide clear instructions on the proper use of the e-bike, including details on electric assist technology and battery charging procedures.",
  "Pre-Ride Inspection: Renters are required to inspect the e-bike for any visible defects or issues before use and report them to Evegah immediately.",
  "General Care: Renters are responsible for maintaining the e-bike in good condition to ensure it remains functional for the next user.",
  "Security and Safety: Renters must secure the e-bike with a lock when not in use. The e-bike must not be used in hazardous environments, such as lakes, muddy trails, or unsafe terrains. In the event of theft, the Renter is responsible for reimbursing Evegah for the full value of the e-bike as per the current price list.",
  "E-bike Condition on Return: E-bikes must be returned in the same technical condition as they were rented. Any defects or damages must be reported immediately to Evegah Customer Service/Helpline Number: 8980966376, 8980966343.",
  "Accessories: Renters will be charged for the loss or damage of accessories based on current market prices.",
  "Damages and Liability: Renters are liable for damages caused by improper use and will be charged accordingly. Renters are also responsible for any third-party damages resulting from their negligence.",
  "Personal Health and Safety: Evegah does not provide personal health or accident insurance. Renters assume full responsibility for any injury, disability, or fatality resulting from e-bike use. Evegah will not be held liable for such incidents.",
  "Protection of Electric Components: Renters must protect the e-bike's electric components, particularly during wet or extreme weather conditions.",
  "Late Return: E-bikes returned more than one day after the agreed return time will result in the forfeiture of the security deposit.",
  "Subleasing: Subleasing or re-renting the e-bike to another party is strictly prohibited.",
  "Single Rider Use: E-bikes are designed for single riders only. Carrying passengers is not allowed.",
  "Smoking Prohibited: Smoking is strictly forbidden while using the e-bike.",
  "Intoxication Prohibited: Riding an e-bike under the influence of alcohol is strictly prohibited.",
  "Traffic Rules: Rider must follow all traffic and safety rules while riding.",
  "Termination of Rental: Company can terminate rental on misuse of eBike and rental pay.",
];

async function downscaleDataUrl(dataUrl, {
  maxWidth = 1000,
  maxHeight = 400,
  mimeType = "image/jpeg",
  quality = 0.75,
} = {}) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return null;
  }

  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // White background for JPEG
        if (mimeType === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(img, 0, 0, width, height);
        const out = canvas.toDataURL(mimeType, quality);
        resolve(out || dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let cachedLogoDataUrl = null;
let cachedLogoJpegDataUrl = null;

async function urlToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Logo fetch failed");
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Logo read failed"));
    reader.readAsDataURL(blob);
  });
}

async function getLogoDataUrl() {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  try {
    cachedLogoDataUrl = await urlToDataUrl(logoPngUrl);
    return cachedLogoDataUrl;
  } catch {
    return null;
  }
}

async function getLogoJpegDataUrl() {
  if (cachedLogoJpegDataUrl) return cachedLogoJpegDataUrl;
  const png = await getLogoDataUrl();
  if (!png) return null;
  cachedLogoJpegDataUrl =
    (await downscaleDataUrl(png, { maxWidth: 600, maxHeight: 600, mimeType: "image/jpeg", quality: 0.75 })) || png;
  return cachedLogoJpegDataUrl;
}

function drawHeader(doc, { receiptNo, generatedAt, logoDataUrl }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const headerTop = 10;
  const headerBottom = 44;

  // Logo
  if (logoDataUrl && logoDataUrl.startsWith("data:image/")) {
    try {
      doc.addImage(logoDataUrl, "JPEG", margin, headerTop, 26, 26);
    } catch {
      // ignore
    }
  }

  // Title
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("Rider Registration", margin + 30, headerTop + 9);

  doc.setFontSize(12);
  doc.setTextColor(...BRAND.mutedText);
  doc.text("Payment Receipt", margin + 30, headerTop + 16);

  // Receipt meta (right)
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.mutedText);
  doc.text(`Receipt No: ${safeString(receiptNo)}`, pageWidth - margin, headerTop + 9, {
    align: "right",
  });
  doc.text(`Date: ${safeString(generatedAt)}`, pageWidth - margin, headerTop + 16, {
    align: "right",
  });

  // Accent bars (similar layout to provided sample)
  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, headerBottom - 10, pageWidth - margin * 2, 8, "F");
  doc.setFillColor(...BRAND.primaryLight);
  doc.rect(margin, headerBottom - 2, pageWidth - margin * 2, 2, "F");

  return headerBottom;
}

function addSection(doc, title, rows) {
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const startY = (doc.lastAutoTable?.finalY || 44) + 10;
  const rupeePng = getRupeePngDataUrl();

  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, startY, pageWidth - margin * 2, 8, "F");
  doc.setFontSize(11);
  doc.setTextColor(255);
  doc.text(title, margin + 3, startY + 5.6);

  autoTable(doc, {
    startY: startY + 10,
    theme: "grid",
    body: rows,
    styles: { fontSize: 10, cellPadding: 2, textColor: 30 },
    tableLineColor: BRAND.border,
    tableLineWidth: 0.2,
    columnStyles: {
      0: { cellWidth: 58, fontStyle: "bold", textColor: 60 },
      1: { cellWidth: pageWidth - margin * 2 - 58 },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      // jsPDF default fonts can render ₹ as a stray glyph (often "1").
      // If we detect ₹, remove it from text and draw it as an image in didDrawCell.
      const raw = typeof data?.cell?.raw === "string" ? data.cell.raw : "";
      if (!rupeePng || !raw.includes("₹")) return;

      data.cell.__hasRupeeGlyph = true;
      const cleaned = raw.replace("₹", "").trimStart();
      data.cell.text = [cleaned];

      // Make space for the ₹ icon on the left.
      bumpLeftPadding(data.cell, 6);
    },
    didDrawCell: (data) => {
      if (!rupeePng || !data?.cell?.__hasRupeeGlyph) return;

      const cell = data.cell;
      const paddingLeft = getCellPaddingLeft(cell);

      // Draw a small ₹ icon vertically centered in the cell.
      const iconW = 3.4;
      const iconH = 4.4;
      const x = cell.x + paddingLeft - 5.5; // align icon into the space created by bumpLeftPadding
      const y = cell.y + (cell.height - iconH) / 2;

      try {
        doc.addImage(rupeePng, "PNG", x, y, iconW, iconH);
      } catch {
        // ignore
      }
    },
  });
}

function addBulletedSection(doc, title, bullets) {
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const startY = (doc.lastAutoTable?.finalY || 44) + 10;

  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, startY, pageWidth - margin * 2, 8, "F");
  doc.setFontSize(11);
  doc.setTextColor(255);
  doc.text(title, margin + 3, startY + 5.6);

  const rows = (bullets || []).map((text, idx) => [`${idx + 1}.`, safeString(text)]);

  autoTable(doc, {
    startY: startY + 10,
    theme: "grid",
    body: rows,
    styles: { fontSize: 9, cellPadding: 2, textColor: 30, valign: "top" },
    tableLineColor: BRAND.border,
    tableLineWidth: 0.2,
    columnStyles: {
      0: { cellWidth: 14, fontStyle: "bold", textColor: 60 },
      1: { cellWidth: pageWidth - margin * 2 - 14 },
    },
    margin: { left: margin, right: margin },
  });
}

function ensureSpace(doc, requiredHeightMm) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const currentY = (doc.lastAutoTable?.finalY || 20) + 10;
  if (currentY + requiredHeightMm > pageHeight - 10) {
    doc.addPage();
  }
}

export async function downloadRiderReceiptPdf({ formData, registration } = {}) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  const receiptGeneratedAt = new Date();
  const receiptNo = registration?.rentalId || registration?.riderId
    ? formatPublicId(registration?.rentalId || registration?.riderId)
    : `LOCAL-${receiptGeneratedAt.getTime()}`;

  const logoDataUrl = await getLogoJpegDataUrl();
  drawHeader(doc, {
    receiptNo,
    generatedAt: formatDateTimeDDMMYYYY(receiptGeneratedAt, "-"),
    logoDataUrl,
  });

  // Rider details
  addSection(doc, "Rider Details", [
    ["Rider Unique ID", safeString(registration?.riderCode)],
    ["Full Name", safeString(formData?.name || formData?.fullName)],
    ["Mobile", safeString(formData?.phone || formData?.mobile)],
    ["Aadhaar", maskAadhaar(formData?.aadhaar)],
    ["DOB", formatDateDDMMYYYY(formData?.dob, safeString(formData?.dob))],
    ["Gender", safeString(formData?.gender)],
    ["Operational Zone", safeString(formData?.operationalZone)],
    ["Reference", safeString(formData?.reference)],
    ["Permanent Address", safeString(formData?.permanentAddress)],
    ["Temporary Address", safeString(formData?.temporaryAddress)],
  ]);

  // Rental details
  addSection(doc, "Rental Details", [
    ["Rental Start", formatDateTime(formData?.rentalStart)],
    ["Return Date", formatDateTime(formData?.rentalEnd)],
    ["Package", safeString(formData?.rentalPackage)],
    ["Bike Model", safeString(formData?.bikeModel)],
    ["Bike ID", safeString(formData?.bikeId)],
    ["Battery ID", safeString(formData?.batteryId)],
    [
      "Accessories",
      Array.isArray(formData?.accessories) && formData.accessories.length
        ? formData.accessories.join(", ")
        : "-",
    ],
    ["Other Accessories", safeString(formData?.otherAccessories)],
  ]);

  // Payment receipt
  addSection(doc, "Payment Receipt", [
    ["Payment Mode", safeString(formData?.paymentMode || formData?.paymentMethod)],
    ["Rental Amount", toInr(formData?.rentalAmount)],
    ["Security Deposit", toInr(formData?.securityDeposit)],
    ["Total Amount", toInr(formData?.totalAmount)],
    ["Amount Paid", toInr(formData?.amountPaid || formData?.paidAmount || formData?.totalAmount)],
  ]);

  // Agreement summary
  addSection(doc, "Agreement", [
    ["Accepted", formData?.agreementAccepted ? "Yes" : "No"],
    ["Agreement Date", formatDateTime(formData?.agreementDate)],
    ["Issued By", safeString(formData?.issuedByName)],
  ]);

  // Terms & Conditions
  addBulletedSection(doc, "Terms & Conditions", [
    "This receipt is proof of payment only; it does not guarantee vehicle availability.",
    "Security deposit (if any) is refundable subject to vehicle return and inspection as per company policy.",
    "Rider must carry valid ID and follow all traffic rules and local regulations.",
    "Charges may apply for damages, missing accessories, late returns, or policy violations.",
    "For corrections or support, contact the EVegah team with the receipt number.",
  ]);

  // Rules & Regulations (Rental Agreement)
  ensureSpace(doc, 22);
  addBulletedSection(doc, "Rules & Regulations", RULES_AND_REGULATIONS_BULLETS);

  // Signature (optional)
  const signatureDataUrl =
    typeof formData?.riderSignature === "string" ? formData.riderSignature : "";

  if (signatureDataUrl && signatureDataUrl.startsWith("data:image/")) {
    ensureSpace(doc, 50);
    const y = (doc.lastAutoTable?.finalY || 20) + 14;
    doc.setFillColor(...BRAND.primary);
    doc.rect(14, y, 182, 8, "F");
    doc.setFontSize(11);
    doc.setTextColor(255);
    doc.text("Rider Signature", 17, y + 5.6);

    try {
      const signatureOptimized =
        (await downscaleDataUrl(signatureDataUrl, {
          maxWidth: 900,
          maxHeight: 300,
          mimeType: "image/jpeg",
          quality: 0.75,
        })) || signatureDataUrl;

      // Place signature box
      doc.setDrawColor(...BRAND.border);
      doc.rect(14, y + 10, 80, 30);
      doc.addImage(signatureOptimized, "JPEG", 16, y + 12, 76, 26);
    } catch {
      // Ignore image failures; the rest of the PDF is still valuable.
    }
  }

  ensureSpace(doc, 20);
  const footerY = (doc.lastAutoTable?.finalY || 20) + 18;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    "This is a system-generated receipt. Please keep it for your records.",
    14,
    footerY
  );

  const phoneDigits =
    String(formData?.phone || formData?.mobile || "").replace(/\D/g, "").slice(-10) || "unknown";
  const ddmmyyyy = formatDateDDMMYYYY(receiptGeneratedAt, receiptGeneratedAt.toISOString().slice(0, 10));
  const code = String(registration?.riderCode || "").trim();
  const codePart = code ? `-${code}` : "";
  doc.save(`evegah-receipt${codePart}-${phoneDigits}-${ddmmyyyy}.pdf`);
}
