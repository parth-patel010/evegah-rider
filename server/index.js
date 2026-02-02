/* eslint-env node */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import admin from "firebase-admin";
import multer from "multer";
import PDFDocument from "pdfkit";
import {
  buildIciciEncryptedRequest,
  decryptIciciAsymmetricPayload,
  encryptIciciAsymmetricPayload,
  getIciciCryptoStatus,
} from "./iciciCrypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer server/.env so local DB config stays with the API.
// Use override so a globally-set DATABASE_URL doesn't silently take precedence.
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(
  express.json({
    limit: "15mb",
    verify: (req, _res, buf) => {
      // Preserve raw body for webhook signature verification.
      // Safe for other routes; the buffer is already in memory.
      req.rawBody = buf;
    },
  })
);

const port = Number(process.env.PORT || 5050);
const databaseUrl = process.env.DATABASE_URL;

const whatsappPhoneNumberId = String(
  process.env.WHATSAPP_PHONE_NUMBER_ID || "982622404928198"
).trim();
const whatsappAccessToken = String(process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || "").trim();
const whatsappWebhookVerifyToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
const whatsappAppSecret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
const fetchApi = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

const iciciMid = String(process.env.ICICI_MID || "").trim();
const iciciVpa = String(process.env.ICICI_VPA || "").trim();
const iciciApiKey = String(process.env.ICICI_API_KEY || "").trim();
const iciciBaseUrl = String(process.env.ICICI_BASE_URL || "").trim();
const iciciQrEndpoint = String(process.env.ICICI_QR_ENDPOINT || "").trim();
const iciciTransactionStatusEndpoint = String(process.env.ICICI_TRANSACTION_STATUS_ENDPOINT || "").trim();
const iciciCallbackStatusEndpoint = String(process.env.ICICI_CALLBACK_STATUS_ENDPOINT || "").trim();
const iciciRefundEndpoint = String(process.env.ICICI_REFUND_ENDPOINT || "").trim();

function tryParseJson(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (!(s.startsWith("{") || s.startsWith("["))) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function looksLikeBase64(text) {
  const s = String(text || "").trim();
  if (!s || s.length < 24) return false;
  if (s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(s);
}

function decodeIciciAsymmetricResponseOrThrow(rawText) {
  // ICICI docs say response is encrypted Base64(RSA(...)), but some environments return JSON.
  const asJson = tryParseJson(rawText);
  if (asJson !== null) return asJson;

  const trimmed = String(rawText || "").trim();
  if (!trimmed) return "";

  // Only attempt decrypt if it looks like encrypted base64.
  if (!looksLikeBase64(trimmed)) return trimmed;

  const cryptoStatus = getIciciCryptoStatus();
  if (!cryptoStatus.hasPrivateKey) {
    const err = new Error(
      "ICICI response looks encrypted. Configure ICICI_CLIENT_PRIVATE_KEY_P12_PATH (and passphrase) to decrypt response."
    );
    err.code = "ICICI_PRIVATE_KEY_REQUIRED";
    throw err;
  }

  return decryptIciciAsymmetricPayload(trimmed);
}

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "adminev@gmail.com").trim().toLowerCase();

if (!databaseUrl) {
  // Keep the server running to show a clear error on requests.
  console.warn("Missing DATABASE_URL in environment");
}

const pool = new Pool({
  connectionString: databaseUrl,
});

async function ensureDbInitialized() {
  if (!databaseUrl) return;
  const auto = String(process.env.AUTO_MIGRATE ?? "true").toLowerCase();
  if (auto === "false" || auto === "0" || auto === "no") return;

  try {
    const check = await pool.query(
      "select to_regclass('public.riders') as riders_table, to_regclass('public.battery_swaps') as battery_swaps_table"
    );
    const ridersOk = Boolean(check.rows?.[0]?.riders_table);
    const batterySwapsOk = Boolean(check.rows?.[0]?.battery_swaps_table);
    if (ridersOk && batterySwapsOk) return;

    const initDir = path.resolve(__dirname, "..", "db", "init");
    if (!fs.existsSync(initDir)) {
      console.warn("DB init skipped: db/init folder not found:", initDir);
      return;
    }

    const files = (await fs.promises.readdir(initDir))
      .filter((f) => f.toLowerCase().endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.warn("DB init skipped: no .sql files found in", initDir);
      return;
    }

    console.log("DB schema missing; applying db/init migrations...", files);
    for (const f of files) {
      const sql = await fs.promises.readFile(path.join(initDir, f), "utf8");
      if (!sql.trim()) continue;
      await pool.query(sql);
    }
    console.log("DB init complete.");
  } catch (error) {
    console.warn(
      "DB init failed (check DATABASE_URL / permissions):",
      String(error?.message || error)
    );
  }
}

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const safeBase = String(file.originalname || "upload")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .slice(0, 80);
      const ext = path.extname(safeBase) || "";
      const name = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post("/api/uploads/image", upload.single("photo"), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "photo file is required" });
  }

  return res.status(201).json({
    url: `/uploads/${file.filename}`,
    file_name: file.filename,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
  });
});

function toDigits(value, maxLen) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, maxLen);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

// Keep a small in-memory log of webhook events to debug delivery.
const whatsappWebhookEvents = [];
const WHATSAPP_WEBHOOK_EVENTS_MAX = 200;

function pushWhatsAppWebhookEvent(event) {
  whatsappWebhookEvents.push({
    at: new Date().toISOString(),
    ...event,
  });
  if (whatsappWebhookEvents.length > WHATSAPP_WEBHOOK_EVENTS_MAX) {
    whatsappWebhookEvents.splice(0, whatsappWebhookEvents.length - WHATSAPP_WEBHOOK_EVENTS_MAX);
  }
}

// ------------------------------
// WhatsApp Cloud API Webhook
// ------------------------------
// Configure in Meta Developer Dashboard:
// Callback URL: https://<your-domain>/api/webhooks/whatsapp
// Verify token: WHATSAPP_WEBHOOK_VERIFY_TOKEN
function handleWhatsAppWebhookVerify(req, res) {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");

  if (mode === "subscribe" && whatsappWebhookVerifyToken && token === whatsappWebhookVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

function handleWhatsAppWebhookReceive(req, res) {
  try {
    // Optional verification (recommended). If you don't set WHATSAPP_APP_SECRET, we accept the webhook.
    if (whatsappAppSecret) {
      const signatureHeader = String(req.get("x-hub-signature-256") || "");
      const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice("sha256=".length) : "";
      const rawBody = req.rawBody instanceof Buffer ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
      const expected = crypto.createHmac("sha256", whatsappAppSecret).update(rawBody).digest("hex");
      if (!provided || !safeEqual(provided, expected)) {
        return res.sendStatus(403);
      }
    }

    // WhatsApp webhook payloads come under entry[].changes[].value
    const entry = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const e of entry) {
      const changes = Array.isArray(e?.changes) ? e.changes : [];
      for (const c of changes) {
        const value = c?.value || {};
        const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        if (statuses.length) {
          // This is what you need to debug “sent but not received” cases.
          pushWhatsAppWebhookEvent({ type: "statuses", statuses });
          console.log("WhatsApp webhook statuses", JSON.stringify(statuses));
        }
        if (messages.length) {
          pushWhatsAppWebhookEvent({ type: "messages", messages });
          console.log("WhatsApp webhook messages", JSON.stringify(messages));
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("WhatsApp webhook handler failed", error);
    return res.sendStatus(200);
  }
}

// Primary endpoint
app.get("/api/webhooks/whatsapp", handleWhatsAppWebhookVerify);
app.post("/api/webhooks/whatsapp", handleWhatsAppWebhookReceive);

// Alias endpoint (matches Meta quickstart screenshots some users follow)
app.get("/api/whatsapp/webhook", handleWhatsAppWebhookVerify);
app.post("/api/whatsapp/webhook", handleWhatsAppWebhookReceive);

// Debug endpoint to inspect recent webhook events (requires admin token)
app.get("/api/whatsapp/webhook-events", requireAdmin, (_req, res) => {
  return res.json({
    count: whatsappWebhookEvents.length,
    events: whatsappWebhookEvents.slice(-100),
  });
});

function parseDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const match = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  return "";
}

function safeFilePart(value, maxLen) {
  // Keep filenames URL-friendly and filesystem-safe.
  // Convert spaces/symbols to '-', collapse repeats, and trim.
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, maxLen);
}

function formatYyyyMm(date) {
  const d = date instanceof Date ? date : new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}${mm}`;
}

function randomReadableCode(len = 6) {
  // Excludes ambiguous chars: 0,O,1,I
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function makeRiderCode(now = new Date()) {
  // Example: RDR-202512-K8Q2MZ
  return `RDR-${formatYyyyMm(now)}-${randomReadableCode(6)}`;
}

async function ensureRiderCode({ client, riderId }) {
  const existingQ = await client.query(
    `select coalesce(meta->>'rider_code','') as rider_code
     from public.riders
     where id = $1`,
    [riderId]
  );
  const existing = String(existingQ.rows?.[0]?.rider_code || "").trim();
  if (existing) return existing;

  // Try a few times to avoid collisions.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = makeRiderCode(new Date());
    const dupe = await client.query(
      `select 1
       from public.riders
       where meta->>'rider_code' = $1
       limit 1`,
      [candidate]
    );
    if (dupe.rowCount) continue;

    const updated = await client.query(
      `update public.riders
       set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('rider_code', $1::text)
       where id = $2
       returning coalesce(meta->>'rider_code','') as rider_code`,
      [candidate, riderId]
    );
    const value = String(updated.rows?.[0]?.rider_code || "").trim();
    if (value) return value;
  }

  throw new Error("Unable to allocate unique rider code");
}

function normalizeZone(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const cleaned = raw.replace(/\bzone\b/g, "").replace(/\s+/g, " ").trim();

  if (cleaned.includes("gotri")) return "Gotri";
  if (cleaned.includes("manjalpur")) return "Manjalpur";
  if (cleaned.includes("karelibaug")) return "Karelibaug";
  if (cleaned.includes("daman")) return "Daman";
  if (cleaned.includes("aatapi") || cleaned.includes("atapi")) return "Aatapi";
  return "";
}

function normalizeIdForCompare(value) {
  return String(value || "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}

async function getActiveAvailability({ client }) {
  const q = await client.query(
    `with active_rentals as (
       select r.id as rental_id, r.start_time, r.bike_id, r.battery_id, r.vehicle_number
       from public.rentals r
       where not exists (select 1 from public.returns ret where ret.rental_id = r.id)
     ),
     active_with_current as (
       select ar.rental_id,
              ar.bike_id,
              ar.vehicle_number,
              coalesce(
                (
                  select s.battery_in
                  from public.battery_swaps s
                  where regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g') =
                        regexp_replace(lower(coalesce(ar.vehicle_number,'')),'[^a-z0-9]+','','g')
                    and s.swapped_at >= ar.start_time
                  order by s.swapped_at desc, s.created_at desc
                  limit 1
                ),
                ar.battery_id
              ) as current_battery_id
       from active_rentals ar
     )
     select
       coalesce(array_agg(distinct bike_id) filter (where coalesce(bike_id,'') <> ''), '{}') as vehicle_ids,
       coalesce(array_agg(distinct vehicle_number) filter (where coalesce(vehicle_number,'') <> ''), '{}') as vehicle_numbers,
       coalesce(array_agg(distinct current_battery_id) filter (where coalesce(current_battery_id,'') <> ''), '{}') as battery_ids
     from active_with_current`
  );

  const row = q.rows?.[0] || {};
  const vehicleIds = Array.isArray(row.vehicle_ids) ? row.vehicle_ids : [];
  const vehicleNumbers = Array.isArray(row.vehicle_numbers) ? row.vehicle_numbers : [];
  const batteryIds = Array.isArray(row.battery_ids) ? row.battery_ids : [];

  const vehicleIdSet = new Set(vehicleIds.map(normalizeIdForCompare).filter(Boolean));
  const vehicleNumberSet = new Set(vehicleNumbers.map(normalizeIdForCompare).filter(Boolean));
  const batteryIdSet = new Set(batteryIds.map(normalizeIdForCompare).filter(Boolean));

  return {
    unavailableVehicleIds: vehicleIds,
    unavailableVehicleNumbers: vehicleNumbers,
    unavailableBatteryIds: batteryIds,
    unavailableVehicleIdSet: vehicleIdSet,
    unavailableVehicleNumberSet: vehicleNumberSet,
    unavailableBatteryIdSet: batteryIdSet,
  };
}

async function autoCreateBatterySwapForRental({ client, rental }) {
  const vehicleNumber = String(rental?.vehicle_number || "").trim();
  const batteryIn = String(rental?.battery_id || "").trim();
  const swappedAt = rental?.start_time;

  const meta = rental?.meta && typeof rental.meta === "object" ? rental.meta : {};
  const employeeUid = String(meta.employee_uid || meta.employeeUid || "").trim() || "system";
  const employeeEmail = String(meta.employee_email || meta.employeeEmail || "").trim() || null;

  if (!vehicleNumber || !batteryIn || !swappedAt) return;

  // Prevent duplicate auto swaps (same vehicle + same start time + same battery)
  const dupe = await client.query(
    `select 1
     from public.battery_swaps
     where regexp_replace(lower(coalesce(vehicle_number,'')),'[^a-z0-9]+','','g') =
           regexp_replace(lower($1::text),'[^a-z0-9]+','','g')
       and swapped_at = $2::timestamptz
       and regexp_replace(lower(coalesce(battery_in,'')),'[^a-z0-9]+','','g') =
           regexp_replace(lower($3::text),'[^a-z0-9]+','','g')
     limit 1`,
    [vehicleNumber, swappedAt, batteryIn]
  );
  if (dupe.rowCount) return;

  const prev = await client.query(
    `select battery_in
     from public.battery_swaps
     where regexp_replace(lower(coalesce(vehicle_number,'')),'[^a-z0-9]+','','g') =
           regexp_replace(lower($1::text),'[^a-z0-9]+','','g')
       and swapped_at < $2::timestamptz
     order by swapped_at desc, created_at desc
     limit 1`,
    [vehicleNumber, swappedAt]
  );
  const previousBattery = String(prev.rows?.[0]?.battery_in || "").trim();
  const batteryOut = previousBattery || "UNKNOWN";

  await client.query(
    `insert into public.battery_swaps
       (employee_uid, employee_email, vehicle_number, battery_out, battery_in, swapped_at, notes)
     values
       ($1,$2,$3,$4,$5,$6,$7)`,
    [
      employeeUid,
      employeeEmail,
      vehicleNumber,
      batteryOut,
      batteryIn,
      swappedAt,
      "Auto: rental started",
    ]
  );
}

async function saveDataUrlToUploads({ dataUrl, fileNameHint }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Invalid image data");

  const ext = extFromMime(parsed.mime) || path.extname(String(fileNameHint || "")) || ".bin";
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
  const absPath = path.join(uploadsDir, fileName);
  const buffer = Buffer.from(parsed.base64, "base64");
  await fs.promises.writeFile(absPath, buffer);

  return {
    url: `/uploads/${fileName}`,
    file_name: fileName,
    mime_type: parsed.mime,
    size_bytes: buffer.length,
  };
}

function createReceiptPdfBuffer({ formData, registration }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const now = new Date();
      const rawReceiptNo = registration?.rentalId || registration?.riderId || "";
      const receiptNo = (() => {
        const s = String(rawReceiptNo || "").trim();
        if (!s) return "";
        const base = s.split("-")[0] || s;
        if (base && base.length >= 6) return `EVEGAH-${base.toUpperCase()}`;
        return s;
      })();
      const riderCode = registration?.riderCode || "";

      const primary = "#1A574A";
      const border = "#D2D2D2";
      const pageWidth = doc.page.width;
      const margin = doc.page.margins.left;
      const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

      const logoPath = path.resolve(__dirname, "..", "src", "assets", "logo.png");
      const hasLogo = fs.existsSync(logoPath);

      // Header
      const headerTop = doc.y;
      if (hasLogo) {
        try {
          doc.image(logoPath, margin, headerTop, { width: 90 });
        } catch {
          // ignore
        }
      }

      doc
        .fillColor("#111")
        .fontSize(18)
        .text("Rider Registration", hasLogo ? margin + 100 : margin, headerTop, {
          continued: false,
        });
      doc
        .fillColor("#444")
        .fontSize(13)
        .text("Payment Receipt", hasLogo ? margin + 100 : margin, headerTop + 22);

      doc
        .fillColor("#555")
        .fontSize(10)
        .text(`Receipt No: ${receiptNo || "-"}`, margin, headerTop + 5, {
          width: contentWidth,
          align: "right",
        })
        .text(`Date: ${now.toLocaleString()}`, margin, headerTop + 20, {
          width: contentWidth,
          align: "right",
        });

      doc.moveDown(2);
      doc
        .rect(margin, doc.y, contentWidth, 10)
        .fill(primary);
      doc
        .rect(margin, doc.y + 10, contentWidth, 3)
        .fill("#E6F3EF");
      doc.moveDown(2);

      const drawSection = (title, lines) => {
        doc
          .fillColor(primary)
          .rect(margin, doc.y, contentWidth, 16)
          .fill();
        doc
          .fillColor("#fff")
          .fontSize(11)
          .text(title, margin + 10, doc.y + 4);
        doc.moveDown(1.2);
        const boxTop = doc.y;
        doc
          .rect(margin, boxTop, contentWidth, Math.max(24, lines.length * 14 + 10))
          .strokeColor(border)
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.5);
        doc.fillColor("#222").fontSize(10);
        lines.forEach(([k, v]) => {
          doc
            .fillColor("#555")
            .text(String(k), margin + 10, doc.y, { width: 160 })
            .fillColor("#111")
            .text(String(v ?? "-"), margin + 180, doc.y - 12, { width: contentWidth - 190 });
          doc.moveDown(0.2);
        });
        doc.y = boxTop + Math.max(24, lines.length * 14 + 10) + 14;
      };

      drawSection("Rider Details", [
        ["Rider Unique ID", riderCode || "-"],
        ["Full Name", formData?.fullName || formData?.name || "-"],
        ["Mobile", formData?.phone || formData?.mobile || "-"],
        ["Zone", formData?.zone || formData?.operationalZone || "-"],
      ]);

      const paidAmount =
        formData?.paidAmount ?? formData?.securityDepositAmount ?? formData?.amountPaid ?? "";
      drawSection("Payment Receipt", [
        ["Payment Mode", formData?.paymentMode || formData?.paymentMethod || "-"],
        ["Rental Amount", formData?.rentalAmount ?? "-"],
        ["Security Deposit", formData?.securityDeposit ?? "-"],
        ["Total Amount", formData?.totalAmount ?? "-"],
        ["Amount Paid", paidAmount || "-"],
      ]);

      drawSection("Rental Details", [
        ["Vehicle Number", formData?.vehicleNumber || formData?.bikeId || "-"],
        ["Rental Start", formData?.rentalStart || "-"],
        ["Return Date", formData?.rentalEnd || "-"],
        ["Package", formData?.rentalPackage || "-"],
      ]);

      drawSection("Terms & Conditions", [
        ["1.", "This receipt is proof of payment only; it does not guarantee vehicle availability."],
        ["2.", "Security deposit (if any) is refundable subject to vehicle return and inspection as per company policy."],
        ["3.", "Rider must carry valid ID and follow all traffic rules and local regulations."],
        ["4.", "Charges may apply for damages, missing accessories, late returns, or policy violations."],
        ["5.", "For corrections or support, contact the EVegah team with the receipt number."],
      ]);

      doc
        .fillColor(primary)
        .rect(margin, doc.y, contentWidth, 16)
        .fill();
      doc
        .fillColor("#fff")
        .fontSize(11)
        .text("Agreement", margin + 10, doc.y + 4);
      doc.moveDown(1.2);
      doc
        .strokeColor(border)
        .lineWidth(1)
        .rect(margin, doc.y, contentWidth, 60)
        .stroke();
      doc
        .fillColor("#333")
        .fontSize(10)
        .text(
          "This receipt is generated electronically and acts as a payment acknowledgement for rider registration.",
          margin + 10,
          doc.y + 10,
          { width: contentWidth - 20 }
        );
      doc.moveDown(4);

      doc
        .fillColor("#555")
        .fontSize(9)
        .text("System-generated message for rider registration.", margin, doc.y + 10, {
          width: contentWidth,
          align: "left",
        });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

const adminEmail = "adminev@gmail.com";

let firebaseReady = false;
try {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const pathRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  let serviceAccount = null;
  if (jsonRaw) {
    serviceAccount = JSON.parse(jsonRaw);
  } else if (pathRaw) {
    const absPath = path.isAbsolute(pathRaw)
      ? pathRaw
      : path.resolve(__dirname, pathRaw);
    const file = fs.readFileSync(absPath, "utf8");
    serviceAccount = JSON.parse(file);
  } else {
    // Local dev convenience: if repo-root serviceAccountKey.json exists, use it.
    const defaultPath = path.resolve(__dirname, "..", "serviceAccountKey.json");
    if (fs.existsSync(defaultPath)) {
      const file = fs.readFileSync(defaultPath, "utf8");
      serviceAccount = JSON.parse(file);
    }
  }

  if (serviceAccount && !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseReady = true;
  } else if (admin.apps.length) {
    firebaseReady = true;
  } else {
    console.warn(
      "Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (preferred) or FIREBASE_SERVICE_ACCOUNT_JSON in server/.env"
    );
  }
} catch (e) {
  console.warn(
    "Failed to init Firebase Admin. Check FIREBASE_SERVICE_ACCOUNT_PATH/JSON:",
    String(e?.message || e)
  );
}

async function requireAdmin(req, res, next) {
  if (!firebaseReady) {
    return res.status(500).json({
      error:
        "Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (preferred) or FIREBASE_SERVICE_ACCOUNT_JSON in server/.env",
    });
  }

  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Authorization token required" });

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    const email = String(decoded.email || "").toLowerCase();
    const role = decoded.role || "employee";

    if (email !== adminEmail && role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function requireUser(req, res, next) {
  if (!firebaseReady) {
    return res.status(500).json({
      error:
        "Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (preferred) or FIREBASE_SERVICE_ACCOUNT_JSON in server/.env",
    });
  }

  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Authorization token required" });

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function envStr(name, fallback = "") {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  return String(raw).trim();
}

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (!s) continue;
    url.searchParams.set(k, s);
  }
  return url.toString();
}

function parseScopeList(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
}

function removeScope(scopeStr, scopeToRemove) {
  const target = String(scopeToRemove || "").trim().toLowerCase();
  if (!target) return String(scopeStr || "").trim();
  const parts = String(scopeStr || "")
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.filter((p) => p.toLowerCase() !== target).join(" ");
}

function isProbablyBase64(s) {
  const v = String(s || "").trim();
  if (!v || v.length < 16) return false;
  // Base64 strings are usually length%4==0, but not always (URL-safe variants / trimmed padding exist).
  return /^[A-Za-z0-9+/=\r\n_-]+$/.test(v);
}

function tryDecodeBase64ToUtf8(s) {
  const v = String(s || "").trim();
  if (!isProbablyBase64(v)) return null;
  try {
    const cleaned = v.replace(/\s+/g, "");
    const buf = Buffer.from(cleaned, "base64");
    const text = buf.toString("utf8");
    // Very rough sanity check: XML should contain '<'
    if (text.includes("<") && text.includes(">")) return text;
    return null;
  } catch {
    return null;
  }
}

function parseAadhaarXmlLike(input) {
  // DigiLocker eaadhaar endpoints often return XML text (not JSON).
  // We extract attributes from <PrintLetterBarcodeData ... /> when present.
  const xml = String(input || "");
  const m = xml.match(/<\s*PrintLetterBarcodeData\b([^>]*)\/?\s*>/i);
  if (!m) return null;
  const attrText = m[1] || "";
  const attrs = {};
  const re = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*"([^"]*)"/g;
  let mm;
  while ((mm = re.exec(attrText))) {
    const key = String(mm[1] || "").trim();
    const val = String(mm[2] || "").trim();
    if (key) attrs[key] = val;
  }
  return Object.keys(attrs).length ? attrs : null;
}

function buildAadhaarAddressFromAttrs(attrs) {
  if (!attrs) return "";
  const parts = [
    attrs.co,
    attrs.house,
    attrs.street,
    attrs.lm,
    attrs.loc,
    attrs.vtc,
    attrs.po,
    attrs.dist,
    attrs.subdist,
    attrs.state,
    attrs.pc,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return parts.join(", ").replace(/\s+/g, " ").trim();
}

function normalizeDobToIso(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  // Already ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Common Aadhaar XML format: DD-MM-YYYY (or DD/MM/YYYY)
  const m = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return v;
}

function normalizeGender(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const up = v.toUpperCase();
  if (up === "M" || up === "MALE") return "Male";
  if (up === "F" || up === "FEMALE") return "Female";
  if (up === "O" || up === "OTHER") return "Other";
  return v;
}

function normalizeIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  // Keep last 10 digits for Indian mobiles.
  const last10 = digits.slice(-10);
  return last10.length === 10 ? last10 : "";
}

function extractDigiLockerRiderData({ userinfo, aadhaarResponse, fallbackLast4 }) {
  // Returns { aadhaarNumber, aadhaarLast4, name, dob, gender, permanentAddress, mobile }
  let aadhaarXmlText = "";
  let aadhaarAttrs = null;

  if (typeof aadhaarResponse === "string") {
    aadhaarXmlText = aadhaarResponse;
  } else if (aadhaarResponse && typeof aadhaarResponse === "object") {
    const candidates = [
      aadhaarResponse.xml,
      aadhaarResponse.data,
      aadhaarResponse.response,
      aadhaarResponse.eaadhaar,
      aadhaarResponse.eAadhaar,
      aadhaarResponse.xml_data,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        aadhaarXmlText = c;
        break;
      }
    }
  }

  if (aadhaarXmlText) {
    const decoded = tryDecodeBase64ToUtf8(aadhaarXmlText);
    if (decoded) aadhaarXmlText = decoded;
    aadhaarAttrs = parseAadhaarXmlLike(aadhaarXmlText);
  }

  const aadhaarNumber = (() => {
    const candidates = [
      aadhaarAttrs?.uid,
      aadhaarResponse?.aadhaar,
      aadhaarResponse?.aadhaarNumber,
      aadhaarResponse?.aadhaar_no,
      userinfo?.aadhaar,
      userinfo?.aadhaarNumber,
      userinfo?.aadhaar_no,
    ];
    for (const c of candidates) {
      const digits = String(c || "").replace(/\D/g, "");
      if (digits.length === 12) return digits;
    }
    return "";
  })();

  const aadhaarLast4 = (aadhaarNumber ? aadhaarNumber.slice(-4) : String(fallbackLast4 || "").replace(/\D/g, "").slice(-4)) || "";
  const permanentAddress = buildAadhaarAddressFromAttrs(aadhaarAttrs);

  const name =
    userinfo?.name ||
    userinfo?.full_name ||
    aadhaarAttrs?.name ||
    "";

  const gender = normalizeGender(
    userinfo?.gender ||
    userinfo?.gender_name ||
    aadhaarAttrs?.gender ||
    ""
  );

  const dobRaw =
    userinfo?.dob ||
    userinfo?.date_of_birth ||
    userinfo?.birthdate ||
    aadhaarAttrs?.dob ||
    (aadhaarAttrs?.yob ? String(aadhaarAttrs.yob) : "") ||
    "";

  const dob = normalizeDobToIso(dobRaw);

  const mobile = normalizeIndianMobile(
    userinfo?.mobile ||
    userinfo?.mobile_number ||
    userinfo?.phone_number ||
    userinfo?.phone ||
    ""
  );

  return {
    aadhaarNumber,
    aadhaarLast4,
    name: String(name || ""),
    dob: String(dob || ""),
    gender: String(gender || ""),
    permanentAddress: String(permanentAddress || ""),
    mobile: String(mobile || ""),
  };
}

function inferDigiLockerDocument(aadhaarResponse) {
  // Prefer Aadhaar response; it may be XML (string), base64 (string), or JSON (object).
  if (aadhaarResponse === null || aadhaarResponse === undefined) return null;

  const fromText = (textRaw) => {
    let text = String(textRaw || "").trim();
    if (!text) return null;

    // If it's base64, decode (often the case for eAadhaar).
    const decoded = tryDecodeBase64ToUtf8(text);
    if (decoded) text = decoded;

    const lower = text.toLowerCase();
    if (text.startsWith("%PDF-")) {
      return { mime: "application/pdf", filename: "eaadhaar.pdf", buffer: Buffer.from(text, "utf8") };
    }
    if (lower.includes("<printletterbarcodedata") || lower.includes("<?xml")) {
      return { mime: "application/xml", filename: "eaadhaar.xml", buffer: Buffer.from(text, "utf8") };
    }
    return { mime: "text/plain", filename: "digilocker.txt", buffer: Buffer.from(text, "utf8") };
  };

  if (typeof aadhaarResponse === "string") {
    return fromText(aadhaarResponse);
  }

  if (typeof aadhaarResponse === "object") {
    if (aadhaarResponse?.error) return null;
    const candidates = [
      aadhaarResponse.xml,
      aadhaarResponse.data,
      aadhaarResponse.response,
      aadhaarResponse.eaadhaar,
      aadhaarResponse.eAadhaar,
      aadhaarResponse.xml_data,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return fromText(c);
    }
    const json = JSON.stringify(aadhaarResponse);
    return { mime: "application/json", filename: "digilocker.json", buffer: Buffer.from(json, "utf8") };
  }

  return null;
}

const DIGILOCKER = {
  clientId: envStr("DIGILOCKER_CLIENT_ID"),
  clientSecret: envStr("DIGILOCKER_CLIENT_SECRET"),
  authorizeUrl: envStr("DIGILOCKER_AUTHORIZE_URL"),
  tokenUrl: envStr("DIGILOCKER_TOKEN_URL"),
  redirectUri: envStr("DIGILOCKER_REDIRECT_URI"),
  // DigiLocker/APISetu scope support varies by API product. Keep this fully configurable.
  // If your token endpoint complains about "openid", remove it from DIGILOCKER_SCOPES.
  scopes: parseScopeList(envStr("DIGILOCKER_SCOPES")),
  disableOpenId: ["true", "1", "yes"].includes(envStr("DIGILOCKER_DISABLE_OPENID", "false").toLowerCase()),
  tokenAuthMethod: envStr("DIGILOCKER_TOKEN_AUTH_METHOD", "body").toLowerCase(),
  usePkce: ["true", "1", "yes"].includes(envStr("DIGILOCKER_USE_PKCE", "false").toLowerCase()),
  dlFlow: envStr("DIGILOCKER_DL_FLOW"),
  acr: envStr("DIGILOCKER_ACR"),
  amr: envStr("DIGILOCKER_AMR"),
  userinfoUrl: envStr("DIGILOCKER_USERINFO_URL"),
  aadhaarUrl: envStr("DIGILOCKER_AADHAAR_URL"),
  webOrigin: envStr("PUBLIC_WEB_ORIGIN"),
};

const DIGILOCKER_ENABLED = Boolean(
  DIGILOCKER.clientId &&
  DIGILOCKER.clientSecret &&
  DIGILOCKER.authorizeUrl &&
  DIGILOCKER.tokenUrl &&
  DIGILOCKER.redirectUri
);

// state -> { uid, createdAtMs, aadhaarLast4, codeVerifier? }
const digilockerStateStore = new Map();
const DIGILOCKER_STATE_TTL_MS = 10 * 60 * 1000;

// docId -> { uid, createdAtMs, mime, filename, buffer }
const digilockerDocumentStore = new Map();
const DIGILOCKER_DOC_TTL_MS = 10 * 60 * 1000;

function pruneDigiLockerStates(now = Date.now()) {
  for (const [key, value] of digilockerStateStore.entries()) {
    if (!value?.createdAtMs || now - value.createdAtMs > DIGILOCKER_STATE_TTL_MS) {
      digilockerStateStore.delete(key);
    }
  }
}

function pruneDigiLockerDocuments(now = Date.now()) {
  for (const [key, value] of digilockerDocumentStore.entries()) {
    if (!value?.createdAtMs || now - value.createdAtMs > DIGILOCKER_DOC_TTL_MS) {
      digilockerDocumentStore.delete(key);
    }
  }
}

function createDigiLockerDocId() {
  return crypto.randomBytes(24).toString("hex");
}

function createDigiLockerState() {
  return crypto.randomBytes(24).toString("hex");
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkceCodeVerifier() {
  // RFC 7636: 43..128 characters, unreserved
  return base64UrlEncode(crypto.randomBytes(32));
}

function createPkceCodeChallengeS256(codeVerifier) {
  const digest = crypto.createHash("sha256").update(String(codeVerifier), "utf8").digest();
  return base64UrlEncode(digest);
}

async function postFormUrlEncoded(url, { headers = {}, bodyObj = {} } = {}) {
  if (!fetchApi) {
    const err = new Error("Node fetch API unavailable");
    err.status = 503;
    throw err;
  }

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(bodyObj)) {
    if (v === undefined || v === null) continue;
    body.set(k, String(v));
  }

  const res = await fetchApi(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.error_description || data.error))
        ? String(data.error_description || data.error)
        : typeof data === "string"
          ? data
          : `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  if (!fetchApi) {
    const err = new Error("Node fetch API unavailable");
    err.status = 503;
    throw err;
  }

  const res = await fetchApi(url, {
    method,
    headers,
    body,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data.error) ? String(data.error) :
        (typeof data === "string" && data) ? data :
          `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query(
      "select 1 as ok, current_database() as database, current_user as user, to_regclass('public.riders') as riders_table"
    );
    const row = result.rows?.[0] || {};
    res.json({
      ok: true,
      db: row.ok === 1,
      database: row.database || null,
      user: row.user || null,
      ridersTable: row.riders_table || null,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.get("/api/digilocker/status", (_req, res) => {
  return res.json({
    enabled: DIGILOCKER_ENABLED,
    configured: {
      clientId: Boolean(DIGILOCKER.clientId),
      clientSecret: Boolean(DIGILOCKER.clientSecret),
      authorizeUrl: Boolean(DIGILOCKER.authorizeUrl),
      tokenUrl: Boolean(DIGILOCKER.tokenUrl),
      redirectUri: Boolean(DIGILOCKER.redirectUri),
      scopes: Boolean(DIGILOCKER.scopes),
      webOrigin: Boolean(DIGILOCKER.webOrigin),
    },
  });
});

app.get("/api/digilocker/document/:id", requireUser, (req, res) => {
  pruneDigiLockerDocuments();
  const id = String(req.params?.id || "").trim();
  if (!id) return res.sendStatus(404);

  const entry = digilockerDocumentStore.get(id);
  if (!entry) return res.sendStatus(404);
  if (String(entry.uid || "") !== String(req.user?.uid || "")) return res.sendStatus(404);

  // One-time read to reduce exposure.
  digilockerDocumentStore.delete(id);

  const filename = String(entry.filename || "digilocker_document")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 120);

  res.setHeader("Content-Type", String(entry.mime || "application/octet-stream"));
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  return res.status(200).send(entry.buffer);
});

app.post("/api/digilocker/auth-url", requireUser, (req, res) => {
  pruneDigiLockerStates();

  if (!DIGILOCKER_ENABLED) {
    return res.status(503).json({
      error:
        "DigiLocker is not configured on the server. Set DIGILOCKER_CLIENT_ID, DIGILOCKER_CLIENT_SECRET, DIGILOCKER_AUTHORIZE_URL, DIGILOCKER_TOKEN_URL, DIGILOCKER_REDIRECT_URI in server/.env",
    });
  }

  const aadhaarDigits = String(req.body?.aadhaar || "").replace(/\D/g, "").slice(0, 12);
  const aadhaarLast4 = aadhaarDigits ? aadhaarDigits.slice(-4) : "";

  const state = createDigiLockerState();

  const statePayload = {
    uid: String(req.user?.uid || ""),
    createdAtMs: Date.now(),
    aadhaarLast4,
  };

  // APISetu portal generated URLs typically use PKCE (S256).
  let pkce = null;
  if (DIGILOCKER.usePkce) {
    const codeVerifier = createPkceCodeVerifier();
    const codeChallenge = createPkceCodeChallengeS256(codeVerifier);
    pkce = { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
    statePayload.codeVerifier = codeVerifier;
  }

  digilockerStateStore.set(state, statePayload);

  const effectiveScopes = DIGILOCKER.disableOpenId
    ? removeScope(DIGILOCKER.scopes, "openid")
    : DIGILOCKER.scopes;

  const authUrl = buildUrl(DIGILOCKER.authorizeUrl, {
    response_type: "code",
    // Some OAuth providers may default to returning the authorization code in the URL fragment.
    // Fragments are not sent to the server, so we explicitly prefer query mode.
    response_mode: "query",
    client_id: DIGILOCKER.clientId,
    redirect_uri: DIGILOCKER.redirectUri,
    scope: effectiveScopes,
    state,
    ...(DIGILOCKER.dlFlow ? { dl_flow: DIGILOCKER.dlFlow } : {}),
    ...(DIGILOCKER.acr ? { acr: DIGILOCKER.acr } : {}),
    ...(DIGILOCKER.amr ? { amr: DIGILOCKER.amr } : {}),
    ...(pkce
      ? {
        code_challenge: pkce.codeChallenge,
        code_challenge_method: pkce.codeChallengeMethod,
      }
      : {}),
  });

  return res.json({ url: authUrl, state });
});

app.get("/api/digilocker/callback", async (req, res) => {
  pruneDigiLockerStates();
  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();

  const oauthError = String(req.query?.error || "").trim();
  const oauthErrorDescription = String(req.query?.error_description || "").trim();

  const targetOrigin = DIGILOCKER.webOrigin || "*";

  const sendPopupResult = (payload) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>DigiLocker</title></head>
<body>
<script>
(function () {
  var payload = ${JSON.stringify(payload)};
  try {
    if (window.opener && window.opener.postMessage) {
      window.opener.postMessage(payload, ${JSON.stringify(targetOrigin)});
    }
  } catch (e) {}
  try { window.close(); } catch (e) {}
})();
</script>
</body>
</html>`);
  };

  if (oauthError) {
    const msg = oauthErrorDescription ? `${oauthError}: ${oauthErrorDescription}` : oauthError;
    return sendPopupResult({ type: "DIGILOCKER_RESULT", ok: false, error: msg });
  }

  if (!code || !state) {
    // If DigiLocker (or a proxy in between) returns the authorization code in the URL fragment,
    // the server will never see it. Recover it in the browser and reload with query params.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>DigiLocker</title></head>
<body>
<script>
(function () {
  function safePost(payload) {
    try {
      if (window.opener && window.opener.postMessage) {
        window.opener.postMessage(payload, ${JSON.stringify(targetOrigin)});
      }
    } catch (e) {}
    try { window.close(); } catch (e) {}
  }

  var search = new URLSearchParams(window.location.search || "");
  var hash = window.location.hash ? new URLSearchParams(String(window.location.hash).replace(/^#/, "")) : null;

  var err = search.get("error") || (hash && hash.get("error")) || "";
  var errDesc = search.get("error_description") || (hash && hash.get("error_description")) || "";
  if (err) {
    safePost({ type: "DIGILOCKER_RESULT", ok: false, error: errDesc ? (err + ": " + errDesc) : err });
    return;
  }

  var code2 = search.get("code") || (hash && hash.get("code")) || "";
  var state2 = search.get("state") || (hash && hash.get("state")) || "";

  // If code/state arrived via fragment, reload with query so the server can exchange the code.
  if (code2 && state2 && (!search.get("code") || !search.get("state"))) {
    try {
      var url = new URL(window.location.href);
      url.hash = "";
      url.searchParams.set("code", code2);
      url.searchParams.set("state", state2);
      window.location.replace(url.toString());
      return;
    } catch (e) {}
  }

  safePost({ type: "DIGILOCKER_RESULT", ok: false, error: "Missing code/state" });
})();
</script>
</body>
</html>`);
  }

  const stateEntry = digilockerStateStore.get(state);
  digilockerStateStore.delete(state);
  if (!stateEntry) {
    return sendPopupResult({ type: "DIGILOCKER_RESULT", ok: false, error: "Invalid or expired state" });
  }

  if (!DIGILOCKER_ENABLED) {
    return sendPopupResult({ type: "DIGILOCKER_RESULT", ok: false, error: "DigiLocker not configured" });
  }

  try {
    const tokenHeaders = {};
    const tokenBody = {
      grant_type: "authorization_code",
      code,
      redirect_uri: DIGILOCKER.redirectUri,
      client_id: DIGILOCKER.clientId,
    };

    if (stateEntry?.codeVerifier) {
      tokenBody.code_verifier = stateEntry.codeVerifier;
    }

    if (DIGILOCKER.tokenAuthMethod === "basic") {
      const basic = Buffer.from(`${DIGILOCKER.clientId}:${DIGILOCKER.clientSecret}`, "utf8").toString("base64");
      tokenHeaders.Authorization = `Basic ${basic}`;
    } else {
      tokenBody.client_secret = DIGILOCKER.clientSecret;
    }

    const exchangeToken = async (tokenUrl) => {
      return postFormUrlEncoded(tokenUrl, {
        headers: tokenHeaders,
        bodyObj: tokenBody,
      });
    };

    let token;
    try {
      token = await exchangeToken(DIGILOCKER.tokenUrl);
    } catch (e) {
      const message = String(e?.message || e || "").toLowerCase();
      // DigiLocker/APISetu has multiple OAuth endpoint versions; some client/API configurations
      // respond with a misleading "grant_type unsupported... disable openid" when using /oauth2/1/token.
      // Retry once against /oauth2/2/token to improve compatibility.
      const canRetry =
        message.includes("grant_type") &&
        message.includes("unsupported") &&
        message.includes("disable") &&
        message.includes("openid") &&
        String(DIGILOCKER.tokenUrl || "").includes("/oauth2/1/token");
      if (!canRetry) throw e;
      const tokenUrl2 = String(DIGILOCKER.tokenUrl).replace("/oauth2/1/token", "/oauth2/2/token");
      token = await exchangeToken(tokenUrl2);
    }

    const accessToken = String(token?.access_token || "").trim();
    if (!accessToken) {
      return sendPopupResult({ type: "DIGILOCKER_RESULT", ok: false, error: "No access_token returned" });
    }

    const authzHeaders = { Authorization: `Bearer ${accessToken}` };

    let userinfo = null;
    if (DIGILOCKER.userinfoUrl) {
      try {
        userinfo = await fetchJson(DIGILOCKER.userinfoUrl, { headers: authzHeaders });
      } catch (e) {
        userinfo = { error: String(e?.message || e) };
      }
    }

    let aadhaar = null;
    if (DIGILOCKER.aadhaarUrl) {
      try {
        aadhaar = await fetchJson(DIGILOCKER.aadhaarUrl, { headers: authzHeaders });
      } catch (e) {
        aadhaar = { error: String(e?.message || e) };
      }
    }

    pruneDigiLockerDocuments();
    const inferredDoc = inferDigiLockerDocument(aadhaar);
    const documentId = inferredDoc && inferredDoc.buffer && inferredDoc.buffer.length
      ? (() => {
        const id = createDigiLockerDocId();
        digilockerDocumentStore.set(id, {
          uid: stateEntry?.uid || "",
          createdAtMs: Date.now(),
          mime: inferredDoc.mime,
          filename: inferredDoc.filename,
          buffer: inferredDoc.buffer,
        });
        return id;
      })()
      : "";

    const extracted = extractDigiLockerRiderData({
      userinfo,
      aadhaarResponse: aadhaar,
      fallbackLast4: stateEntry?.aadhaarLast4 || "",
    });

    return sendPopupResult({
      type: "DIGILOCKER_RESULT",
      ok: true,
      uid: stateEntry?.uid || null,
      data: {
        aadhaar: extracted.aadhaarNumber || "",
        aadhaar_last4: extracted.aadhaarLast4 || "",
        name: extracted.name || "",
        dob: extracted.dob || "",
        gender: extracted.gender || "",
        permanent_address: extracted.permanentAddress || "",
        mobile: extracted.mobile || "",
        document_id: documentId || "",
        document_mime: inferredDoc?.mime || "",
        document_name: inferredDoc?.filename || "",
        // Add document_image as a base64 string if the document is an image
        ...(inferredDoc && inferredDoc.mime && inferredDoc.mime.startsWith("image/") && inferredDoc.buffer
          ? { document_image: `data:${inferredDoc.mime};base64,${inferredDoc.buffer.toString('base64')}` }
          : {}),
      },
    });
  } catch (e) {
    const message = String(e?.message || e || "DigiLocker error");
    return sendPopupResult({ type: "DIGILOCKER_RESULT", ok: false, error: message });
  }
});

app.get("/api/availability", async (_req, res) => {
  const client = await pool.connect();
  try {
    const availability = await getActiveAvailability({ client });
    res.json({
      unavailableVehicleIds: availability.unavailableVehicleIds,
      unavailableBatteryIds: availability.unavailableBatteryIds,
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

app.post("/api/receipts/rider/pdf", async (req, res) => {
  try {
    const { formData, registration } = req.body || {};
    if (!formData) return res.status(400).json({ error: "Missing formData" });

    const buffer = await createReceiptPdfBuffer({ formData, registration });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=EVegah_Receipt.pdf");
    return res.status(200).send(buffer);
  } catch (e) {
    console.error("Receipt PDF generation failed", e);
    return res.status(500).json({ error: "Failed to generate receipt PDF" });
  }
});

app.post("/api/whatsapp/send-receipt", async (req, res) => {
  try {
    const { to, formData, registration } = req.body || {};
    const toDigitsValue = toDigits(to, 10);
    if (toDigitsValue.length !== 10) return res.status(400).json({ error: "Invalid mobile number" });
    if (!formData) return res.status(400).json({ error: "Missing formData" });

    const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
    if (!publicBaseUrl) {
      return res.status(200).json({
        sent: false,
        mediaUrl: null,
        reason: "PUBLIC_BASE_URL is required to attach media on WhatsApp",
        fallback: null,
      });
    }

    // In most deployments (PM2 + Nginx), the Node API is proxied under /api.
    // Default to /api/uploads so the receipt is reachable externally without
    // requiring a separate Nginx rule for /uploads.
    // Override via PUBLIC_UPLOADS_PREFIX (e.g. "/uploads" or "/api/uploads").
    const uploadsPrefix = String(process.env.PUBLIC_UPLOADS_PREFIX || "/api/uploads").trim() || "/api/uploads";
    const publicUploadsPrefix = (() => {
      const base = publicBaseUrl.replace(/\/+$/, "");
      const prefix = uploadsPrefix.replace(/^\/+/, "").replace(/\/+$/, "");
      return prefix ? `${base}/${prefix}` : base;
    })();

    const rawReceiptId = `${registration?.rentalId || registration?.riderId || Date.now()}`;
    const receiptId = (() => {
      const s = String(rawReceiptId || "").trim();
      if (!s) return String(Date.now());
      const base = s.split("-")[0] || s;
      if (base && base.length >= 6) return `EVEGAH-${base.toUpperCase()}`;
      return s;
    })();

    // Prefer a human-friendly receipt number for templates / buttons when available.
    // `registration.riderCode` already exists in this app (e.g. RDR-202601-XXXXXX).
    const receiptNumber = String(registration?.riderCode || "").trim() || receiptId;

    // Always write a unique internal filename for storage/back-compat.
    const internalFileName = `receipt_${receiptId}.pdf`;
    const internalAbsPath = path.join(uploadsDir, internalFileName);
    const pdfBuffer = await createReceiptPdfBuffer({ formData, registration });
    await fs.promises.writeFile(internalAbsPath, pdfBuffer);

    // Public filename (stable, easy to share):
    // evegah-receipt-<receiptNumber>-<mobile>-<DD_MM_YYYY>.pdf
    const mobileForFile = toDigits(formData?.mobile || formData?.phone || toDigitsValue, 10);
    const receiptNumberForFile = safeFilePart(receiptNumber, 60) || safeFilePart(receiptId, 30);
    const dateSource = (() => {
      const v = formData?.agreementDate || formData?.rentalStart || formData?.rental_start;
      if (!v) return new Date();
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? new Date() : d;
    })();
    const dd = String(dateSource.getDate()).padStart(2, "0");
    const mm = String(dateSource.getMonth() + 1).padStart(2, "0");
    const yyyy = String(dateSource.getFullYear());
    const datePart = `${dd}_${mm}_${yyyy}`;

    const publicBase = safeFilePart(
      `evegah-receipt-${receiptNumberForFile}-${mobileForFile}-${datePart}`,
      140
    ) || `evegah-receipt-${safeFilePart(receiptId, 40)}`;

    let fileName = `${publicBase}.pdf`;
    let absPath = path.join(uploadsDir, fileName);

    // Avoid overwriting an existing public filename.
    try {
      await fs.promises.copyFile(internalAbsPath, absPath, fs.constants.COPYFILE_EXCL);
    } catch {
      fileName = `${safeFilePart(publicBase, 110)}_${safeFilePart(receiptId, 20)}.pdf`;
      absPath = path.join(uploadsDir, fileName);
      await fs.promises.copyFile(internalAbsPath, absPath).catch(() => null);
    }

    // Alias using receiptNumber (e.g. RDR-YYYYMM-XXXXXX) so templates can use {{1}} safely.
    const altKey = safeFilePart(receiptNumber, 80);
    if (altKey && altKey !== receiptId) {
      const altFileName = `receipt_${altKey}.pdf`;
      const altAbsPath = path.join(uploadsDir, altFileName);
      fs.promises.copyFile(internalAbsPath, altAbsPath).catch(() => null);
    }

    const mediaUrl = `${publicUploadsPrefix}/${encodeURIComponent(fileName)}`;

    const mediaPath = (() => {
      try {
        const u = new URL(mediaUrl);
        return `${u.pathname}${u.search || ""}`;
      } catch {
        return mediaUrl;
      }
    })();

    let mediaCheck = null;

    // Preflight: Meta must be able to fetch this URL from the public internet.
    // Without this, Meta may accept the send request but the user won't receive the document.
    if (fetchApi) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const mediaRes = await fetchApi(mediaUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            // Keep it small; we only need to confirm the URL is reachable.
            Range: "bytes=0-0",
          },
          signal: controller.signal,
        });
        mediaCheck = {
          ok: mediaRes.ok,
          status: mediaRes.status,
          contentType: String(mediaRes.headers?.get?.("content-type") || ""),
        };
        if (!mediaRes.ok) {
          return res.status(200).json({
            sent: false,
            mediaUrl,
            reason: `Receipt URL is not publicly reachable (HTTP ${mediaRes.status}). Check PUBLIC_BASE_URL / PUBLIC_UPLOADS_PREFIX / proxy rules.`,
            mediaCheck,
            fallback: null,
          });
        }
      } catch (e) {
        const msg = String(e?.name === "AbortError" ? "Timeout" : (e?.message || e));
        mediaCheck = { ok: false, error: msg };
        return res.status(200).json({
          sent: false,
          mediaUrl,
          reason: `Receipt URL preflight failed: ${msg}`,
          mediaCheck,
          fallback: null,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!whatsappPhoneNumberId || !whatsappAccessToken) {
      return res.status(200).json({
        sent: false,
        mediaUrl,
        reason: "WhatsApp Cloud API not configured",
        fallback: "manual",
      });
    }
    if (!fetchApi) {
      return res.status(503).json({
        sent: false,
        mediaUrl,
        reason: "Node fetch API unavailable",
      });
    }

    const riderName = formData?.fullName || "Rider";
    const messageBody = `Hello ${riderName},\nYour EVegah receipt is attached (PDF).`;
    const graphVersionRaw = String(
      process.env.WHATSAPP_GRAPH_VERSION || process.env.WHATSAPP_VERSION || "21.0"
    ).trim();
    // Meta Graph API expects versions like "v18.0" (leading 'v').
    const graphVersion = graphVersionRaw.toLowerCase().startsWith("v")
      ? graphVersionRaw
      : `v${graphVersionRaw}`;
    const apiUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(whatsappPhoneNumberId)}/messages`;

    // Restore template-based sending with document attachment if configured
    const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || "").trim();
    const templateLanguage = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US").trim();
    const templateBodyParams = String(process.env.WHATSAPP_TEMPLATE_BODY_PARAMS || "").trim();
    const templateHeaderType = String(process.env.WHATSAPP_TEMPLATE_HEADER_TYPE || "").trim().toLowerCase();
    const templateUrlButtonIndexRaw = String(process.env.WHATSAPP_TEMPLATE_URL_BUTTON_INDEX || "").trim();
    const templateUrlButtonValueKey = String(
      process.env.WHATSAPP_TEMPLATE_URL_BUTTON_VALUE_KEY || "mediaUrl"
    ).trim();

    const getTemplateValue = (values, key) => {
      const k = String(key || "").trim();
      if (!k) return "";
      if (values[k] !== undefined && values[k] !== null) return String(values[k]);

      // Try case-insensitive lookup to tolerate env typos like "receiptid" vs "receiptId".
      const lower = k.toLowerCase();
      for (const [vk, vv] of Object.entries(values)) {
        if (String(vk).toLowerCase() === lower) return String(vv ?? "");
      }

      // Common aliases
      if (lower === "receiptid" || lower === "receipt_id" || lower === "invoice" || lower === "invoiceid") {
        return String(values.receiptId ?? values.invoiceNo ?? values.invoice_no ?? "");
      }
      return "";
    };

    const basePayload = {
      messaging_product: "whatsapp",
      to: `91${toDigitsValue}`,
    };

    // WhatsApp Cloud API: business-initiated messages generally require a template.
    // If WHATSAPP_TEMPLATE_NAME is provided, we send a template.
    // Header is optional and must match your approved template (common cause of failures).
    // Otherwise we try a session document message.
    const payload = templateName
      ? {
        ...basePayload,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage || "en_US" },
          components: (() => {
            const components = [];

            // Optional template header (must match exactly what Meta template expects)
            // Supported: "document" (uses the receipt URL) or "text".
            if (templateHeaderType === "document") {
              components.push({
                type: "header",
                parameters: [
                  {
                    type: "document",
                    document: {
                      link: mediaUrl,
                      filename: fileName,
                    },
                  },
                ],
              });
            } else if (templateHeaderType === "text") {
              components.push({
                type: "header",
                parameters: [
                  {
                    type: "text",
                    text: String(process.env.WHATSAPP_TEMPLATE_HEADER_TEXT || ""),
                  },
                ],
              });
            }

            // Optional body parameters (map keys to values)
            const bodyKeys = templateBodyParams
              ? templateBodyParams.split(",").map((s) => s.trim()).filter(Boolean)
              : [];

            // Meta Cloud API template components are position-based: parameters are matched by order.
            // Some UI surfaces show "variable names" (e.g. {{name}}), but the API still expects
            // ordered parameters. Only enable `parameter_name` if you explicitly know your template
            // requires it.
            const templateParamModeRaw = String(process.env.WHATSAPP_TEMPLATE_PARAM_MODE || "positional")
              .trim()
              .toLowerCase();
            const useNamedParams = templateParamModeRaw === "named";

            // Try to derive amount if present
            const amount =
              formData?.amountPaid ??
              formData?.paidAmount ??
              formData?.paymentDetails?.totalAmount ??
              formData?.totalAmount ??
              formData?.amount ??
              "";

            const paymentMode =
              formData?.paymentMode ??
              formData?.payment_method ??
              formData?.paymentMethod ??
              "";

            const invoiceDateSource = (() => {
              const v = formData?.rentalStart ?? formData?.rental_start ?? formData?.start_time;
              if (!v) return new Date();
              const d = new Date(v);
              return Number.isNaN(d.getTime()) ? new Date() : d;
            })();

            const invoiceDate = (() => {
              const format = String(process.env.WHATSAPP_TEMPLATE_INVOICE_DATE_FORMAT || "DD/MM/YYYY")
                .trim()
                .toUpperCase();
              const d = invoiceDateSource;
              const dd = String(d.getDate()).padStart(2, "0");
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const yyyy = String(d.getFullYear());
              if (format === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
              if (format === "DD-MM-YYYY") return `${dd}-${mm}-${yyyy}`;
              if (format === "DDMMYYYY") return `${dd}${mm}${yyyy}`;
              if (format === "DD/MM/YYYY") return `${dd}/${mm}/${yyyy}`;
              // Default: DD/MM/YYYY
              return `${dd}/${mm}/${yyyy}`;
            })();

            const plan =
              formData?.rentalPackage ??
              formData?.rental_package ??
              formData?.planName ??
              formData?.plan ??
              formData?.subscriptionPlan ??
              "";

            const hub = formData?.operationalZone ?? formData?.zone ?? "";
            const vehicleType =
              formData?.bikeModel ??
              formData?.vehicleType ??
              formData?.vehicle_type ??
              "";

            if (bodyKeys.length) {
              // If the template is using positional variables ({{1}}, {{2}}, ...), map
              // the first 5 values in the expected order.
              const isNumericKeys = bodyKeys.every((k) => /^\d+$/.test(k));

              const values = {
                name: riderName,
                riderName,
                receiptId,
                receiptNumber,
                registrationId: receiptId,
                mediaUrl,
                mediaPath,
                mediaPathNoSlash: String(mediaPath || "").replace(/^\/+/, ""),
                messageBody,
                amount: String(amount ?? ""),
                paymentMode: String(paymentMode ?? ""),
                hub: String(hub ?? ""),
                vehicleType: String(vehicleType ?? ""),
                phone: `91${toDigitsValue}`,
                invoiceNo: receiptId,
                invoice_no: receiptId,
                invoiceDate,
                invoice_date: invoiceDate,
                plan: String(plan ?? ""),
                fileName,
              };

              const positionalValues = [
                riderName,
                receiptNumber,
                invoiceDate,
                String(plan ?? ""),
                String(amount ?? ""),
              ];

              components.push({
                type: "body",
                parameters: bodyKeys.map((key, idx) => {
                  const text = isNumericKeys && !useNamedParams
                    ? String(positionalValues[idx] ?? "")
                    : String(values[key] ?? "");
                  return {
                    type: "text",
                    text,
                    ...(useNamedParams ? { parameter_name: key } : {}),
                  };
                }),
              });
            }

            // Optional URL button parameter (for templates with a dynamic URL button)
            // Example: WHATSAPP_TEMPLATE_URL_BUTTON_INDEX=0 and the template URL is like https://.../{{1}}
            if (templateUrlButtonIndexRaw) {
              const index = Number.parseInt(templateUrlButtonIndexRaw, 10);
              if (Number.isFinite(index) && index >= 0) {
                const buttonValue = (() => {
                  const values = {
                    name: riderName,
                    riderName,
                    receiptId,
                    receiptNumber,
                    registrationId: receiptId,
                    mediaUrl,
                    mediaPath,
                    mediaPathNoSlash: String(mediaPath || "").replace(/^\/+/, ""),
                    messageBody,
                    amount: String(amount ?? ""),
                    paymentMode: String(paymentMode ?? ""),
                    hub: String(hub ?? ""),
                    vehicleType: String(vehicleType ?? ""),
                    phone: `91${toDigitsValue}`,
                    invoiceNo: receiptId,
                    invoice_no: receiptId,
                    invoiceDate,
                    invoice_date: invoiceDate,
                    plan: String(plan ?? ""),
                    fileName,
                  };
                  return getTemplateValue(values, templateUrlButtonValueKey);
                })();

                // If the template has a dynamic URL button, Meta requires a parameter.
                // Fail fast with a clear message rather than sending an invalid request.
                if (!buttonValue) {
                  components.push({
                    type: "button",
                    sub_type: "url",
                    index: String(index),
                    parameters: [
                      {
                        type: "text",
                        text: String(receiptNumber || receiptId || mediaPathNoSlash || mediaUrl || "").trim(),
                        ...(useNamedParams ? { parameter_name: "1" } : {}),
                      },
                    ],
                  });
                } else {
                  components.push({
                    type: "button",
                    sub_type: "url",
                    index: String(index),
                    // Dynamic URL buttons use a single placeholder (often {{1}}).
                    parameters: [
                      {
                        type: "text",
                        text: buttonValue,
                        ...(useNamedParams ? { parameter_name: "1" } : {}),
                      },
                    ],
                  });
                }
              }
            }

            return components.length ? components : undefined;
          })(),
        },
      }
      : {
        ...basePayload,
        type: "document",
        document: {
          link: mediaUrl,
          filename: fileName,
          caption: messageBody,
        },
      };

    // If we ended up with template.components === undefined, remove it entirely (Meta is picky).
    if (payload?.type === "template" && payload?.template && payload.template.components === undefined) {
      delete payload.template.components;
    }

    const response = await fetchApi(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${whatsappAccessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const metaError = responseBody?.error;
      const metaMessage =
        (metaError && typeof metaError.message === "string" && metaError.message.trim())
          ? metaError.message.trim()
          : "WhatsApp Cloud API rejected the request";

      console.error("WhatsApp Cloud API error", {
        status: response.status,
        meta: metaError || responseBody,
        apiUrl,
        graphVersion,
        whatsappPhoneNumberId,
        templateName: templateName || null,
        to: `91${toDigitsValue}`,
        mediaUrl,
        payloadSummary: {
          type: payload?.type || null,
          hasTemplate: payload?.type === "template",
          bodyParamCount: Array.isArray(payload?.template?.components)
            ? (payload.template.components.find((c) => c?.type === "body")?.parameters?.length || 0)
            : 0,
          bodyParamNames: Array.isArray(payload?.template?.components)
            ? (payload.template.components.find((c) => c?.type === "body")?.parameters || [])
              .map((p) => p?.parameter_name)
              .filter(Boolean)
            : [],
          buttonUrlParamText: Array.isArray(payload?.template?.components)
            ? (payload.template.components.find((c) => c?.type === "button" && c?.sub_type === "url")
              ?.parameters?.[0]?.text || "")
            : "",
          buttonUrlIndex: Array.isArray(payload?.template?.components)
            ? (payload.template.components.find((c) => c?.type === "button" && c?.sub_type === "url")
              ?.index || null)
            : null,
        },
      });

      // Return HTTP 200 so the client can gracefully fall back to opening WhatsApp
      // with the receipt link (e.g., via wa.me) instead of treating this as a hard
      // transport error.
      return res.status(200).json({
        sent: false,
        reason: `Failed to send WhatsApp receipt: ${metaMessage}`,
        error: `Failed to send WhatsApp receipt: ${metaMessage}`,
        providerStatus: response.status,
        detail: metaError || responseBody,
        fallback: null,
        debug: {
          apiUrl,
          graphVersion,
          whatsappPhoneNumberId,
          templateName: templateName || null,
          to: `91${toDigitsValue}`,
          mediaUrl,
          payloadSummary: {
            type: payload?.type || null,
            hasTemplate: payload?.type === "template",
            bodyParamCount: Array.isArray(payload?.template?.components)
              ? (payload.template.components.find((c) => c?.type === "body")?.parameters?.length || 0)
              : 0,
            bodyParamNames: Array.isArray(payload?.template?.components)
              ? (payload.template.components.find((c) => c?.type === "body")?.parameters || [])
                .map((p) => p?.parameter_name)
                .filter(Boolean)
              : [],
            buttonUrlParamText: Array.isArray(payload?.template?.components)
              ? (payload.template.components.find((c) => c?.type === "button" && c?.sub_type === "url")
                ?.parameters?.[0]?.text || "")
              : "",
            buttonUrlIndex: Array.isArray(payload?.template?.components)
              ? (payload.template.components.find((c) => c?.type === "button" && c?.sub_type === "url")
                ?.index || null)
              : null,
          },
        },
        mediaUrl,
        mediaCheck,
      });
    }

    return res.status(200).json({
      sent: true,
      result: responseBody,
      mediaUrl,
      mediaCheck,
      fallback: null,
      warning: !templateName
        ? "No WhatsApp template configured (WHATSAPP_TEMPLATE_NAME). Business-initiated messages may not be delivered unless the user has an active 24-hour session."
        : null,
      debug: {
        apiUrl,
        graphVersion,
        whatsappPhoneNumberId,
        templateName: templateName || null,
        to: `91${toDigitsValue}`,
      },
    });
  } catch (e) {
    console.error("WhatsApp send failed", e);
    return res.status(500).json({ error: "Failed to send WhatsApp receipt" });
  }
});

// ------------------------------
// Local Postgres APIs (replace Supabase)
// ------------------------------

app.get("/api/riders/lookup", async (req, res) => {
  const mobile = toDigits(req.query.phone || req.query.mobile || "", 10);
  const aadhaar = toDigits(req.query.aadhaar || "", 12);
  if (!mobile && !aadhaar) return res.json(null);

  try {
    const { rows } = await pool.query(
      `select id, full_name, mobile, aadhaar, gender, dob, status,
              coalesce(meta->>'rider_code','') as rider_code
       from public.riders
       where ($1 <> '' and mobile = $1)
          or ($2 <> '' and aadhaar = $2)
       limit 1`,
      [mobile, aadhaar]
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/riders", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;

  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all").trim();
  const rideStatus = String(req.query.rideStatus || "all").trim();
  const start = req.query.start ? String(req.query.start) : "";
  const end = req.query.end ? String(req.query.end) : "";

  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (search) {
    const p = push(`%${search}%`);
    where.push(`(full_name ilike ${p} or mobile ilike ${p} or aadhaar ilike ${p})`);
  }
  if (status && status !== "all") {
    where.push(`status = ${push(status)}`);
  }
  if (start) {
    where.push(`created_at >= ${push(start)}`);
  }
  if (end) {
    where.push(`created_at <= ${push(end)}`);
  }

  // Derived ride status (based on rentals + returns)
  // - Riding: has at least one active rental (no return record)
  // - Returned: no active rental, but has returned at least once
  // - No Ride: no rentals at all
  if (rideStatus && rideStatus !== "all") {
    if (rideStatus === "riding") {
      where.push(`ra.active_rental_id is not null`);
    } else if (rideStatus === "returned") {
      where.push(`ra.active_rental_id is null and ra.last_returned_at is not null`);
    } else if (rideStatus === "no_ride") {
      where.push(`coalesce(ra.rental_count,0) = 0`);
    }
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  try {
    const fromSql = `from public.riders r
      left join lateral (
        select
          (select count(*)::int from public.rentals rr where rr.rider_id = r.id) as rental_count,
          (select rr2.id
           from public.rentals rr2
           where rr2.rider_id = r.id
             and not exists (select 1 from public.returns rt where rt.rental_id = rr2.id)
           order by rr2.created_at desc
           limit 1) as active_rental_id,
          (select rr2.vehicle_number
           from public.rentals rr2
           where rr2.rider_id = r.id
             and not exists (select 1 from public.returns rt where rt.rental_id = rr2.id)
           order by rr2.created_at desc
           limit 1) as active_vehicle_number,
          (select max(rt.returned_at)
           from public.returns rt
           join public.rentals rr3 on rr3.id = rt.rental_id
           where rr3.rider_id = r.id) as last_returned_at
      ) ra on true`;

    const countResult = await pool.query(
      `select count(*)::int as count ${fromSql} ${whereSql}`,
      params
    );
    const totalCount = countResult.rows?.[0]?.count || 0;

    const dataResult = await pool.query(
      `select r.*,
              coalesce(r.meta->>'rider_code','') as rider_code,
              coalesce(ra.rental_count,0) as rental_count,
              ra.active_rental_id,
              coalesce(ra.active_vehicle_number,'') as active_vehicle_number,
              ra.last_returned_at,
              case
                when ra.active_rental_id is not null then 'Riding'
                when ra.last_returned_at is not null then 'Returned'
                when coalesce(ra.rental_count,0) = 0 then 'No Ride'
                else 'Returned'
              end as ride_status,
              case
                when coalesce(ra.rental_count,0) > 1 then 'Retain'
                when coalesce(ra.rental_count,0) = 1 then 'New'
                else 'New'
              end as rider_type
       ${fromSql}
       ${whereSql}
       order by r.created_at desc
       limit ${push(limit)} offset ${push(offset)}`,
      params
    );

    res.json({ data: dataResult.rows || [], totalCount });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/riders/stats", async (_req, res) => {
  try {
    const [
      totalQ,
      activeQ,
      suspendedQ,
      ridesQ,
      activeVehiclesQ,
      retainRidersQ,
      endedRidesQ,
      endedRidersQ,
    ] = await Promise.all([
      pool.query(`select count(*)::int as count from public.riders`),
      pool.query(`select count(*)::int as count from public.riders where status='active'`),
      pool.query(`select count(*)::int as count from public.riders where status='suspended'`),
      pool.query(`select count(*)::int as count from public.rentals`),
      pool.query(
        `select count(distinct nullif(trim(vehicle_number),''))::int as count
         from public.rentals r
         where not exists (select 1 from public.returns rt where rt.rental_id = r.id)`
      ),
      pool.query(
        `select count(*)::int as count
         from (
           select rider_id
           from public.rentals
           group by rider_id
           having count(*) > 1
         ) x`
      ),
      pool.query(
        `select count(distinct rental_id)::int as count
         from public.returns`
      ),
      pool.query(
        `select count(distinct r.rider_id)::int as count
         from public.rentals r
         where exists (select 1 from public.returns rt where rt.rental_id = r.id)`
      ),
    ]);

    res.json({
      totalRiders: totalQ.rows?.[0]?.count || 0,
      activeRiders: activeQ.rows?.[0]?.count || 0,
      suspendedRiders: suspendedQ.rows?.[0]?.count || 0,
      totalRides: ridesQ.rows?.[0]?.count || 0,
      activeRentedVehicles: activeVehiclesQ.rows?.[0]?.count || 0,
      retainRiders: retainRidersQ.rows?.[0]?.count || 0,
      endedRides: endedRidesQ.rows?.[0]?.count || 0,
      endedRiders: endedRidersQ.rows?.[0]?.count || 0,
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.patch("/api/riders/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const body = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });

  const fields = {
    full_name: body.full_name,
    mobile: body.mobile,
    aadhaar: body.aadhaar,
    gender: body.gender,
    status: body.status,
    permanent_address: body.permanent_address,
    temporary_address: body.temporary_address,
    reference: body.reference,
  };

  const set = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined) return;
    set.push(`${k} = ${push(v)}`);
  });

  if (set.length === 0) return res.json({ ok: true });
  params.push(id);

  try {
    const { rows } = await pool.query(
      `update public.riders set ${set.join(", ")}
       where id = $${params.length}
       returning *`,
      params
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.delete("/api/riders/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    await pool.query(`delete from public.riders where id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/riders/bulk-delete", async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: "ids required" });
  }

  try {
    const { rowCount } = await pool.query(
      `delete from public.riders where id = any($1::text[])`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/rentals", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select r.*,
              rd.full_name as rider_full_name,
              rd.mobile as rider_mobile,
              coalesce(r.meta->>'expected_end_time','') as expected_end_time,
              ret.returned_at
       from public.rentals r
       left join public.riders rd on rd.id = r.rider_id
       left join lateral (
         select max(returned_at) as returned_at
         from public.returns
         where rental_id = r.id
       ) ret on true
       order by r.created_at desc`
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/rentals", async (req, res) => {
  const body = req.body || {};
  const riderId = String(body.rider_id || "");
  const startTime = body.start_time;
  if (!riderId) return res.status(400).json({ error: "rider_id required" });
  if (!startTime) return res.status(400).json({ error: "start_time required" });

  const rentalMeta = body.meta && typeof body.meta === "object" ? body.meta : {};
  // end_time from UI is an expected end date/time; actual return time is set on /api/returns/submit.
  if (body.end_time) {
    rentalMeta.expected_end_time = body.end_time;
  }

  const documents = body.documents && typeof body.documents === "object" ? body.documents : {};
  const preRidePhotos = Array.isArray(documents.preRidePhotos) ? documents.preRidePhotos : [];

  if (preRidePhotos.length === 0) {
    return res.status(400).json({ error: "preRidePhotos required (at least 1 pre-ride vehicle photo)" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const availability = await getActiveAvailability({ client });
    const requestedVehicleId = normalizeIdForCompare(body.bike_id || "");
    const requestedVehicleNumber = normalizeIdForCompare(body.vehicle_number || "");
    const requestedBatteryId = normalizeIdForCompare(body.battery_id || "");

    if (requestedVehicleId && availability.unavailableVehicleIdSet.has(requestedVehicleId)) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected vehicle is unavailable (already in an active rental)." });
    }
    if (
      requestedVehicleNumber &&
      availability.unavailableVehicleNumberSet.has(requestedVehicleNumber)
    ) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected vehicle is unavailable (already in an active rental)." });
    }
    if (requestedBatteryId && availability.unavailableBatteryIdSet.has(requestedBatteryId)) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected battery is unavailable (already in an active rental)." });
    }

    const { rows } = await client.query(
      `insert into public.rentals
         (rider_id, start_time, end_time, rental_package, rental_amount, deposit_amount, total_amount, payment_mode, bike_model, bike_id, battery_id, vehicle_number, accessories, other_accessories, meta)
       values
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning *`,
      [
        riderId,
        startTime,
        null,
        body.rental_package || null,
        Number(body.rental_amount ?? 0),
        Number(body.deposit_amount ?? 0),
        Number(body.total_amount ?? 0),
        body.payment_mode || null,
        body.bike_model || null,
        body.bike_id || null,
        body.battery_id || null,
        body.vehicle_number || null,
        JSON.stringify(body.accessories || []),
        body.other_accessories || null,
        JSON.stringify(rentalMeta),
      ]
    );

    const rentalRow = rows[0] || null;
    const rentalId = rentalRow?.id;

    if (rentalRow) {
      await autoCreateBatterySwapForRental({ client, rental: rentalRow });
    }

    // Optional: store pre-ride photos for this rental (data URLs)
    if (rentalId) {
      for (const p of preRidePhotos) {
        if (!p?.dataUrl) continue;
        const saved = await saveDataUrlToUploads({
          dataUrl: p.dataUrl,
          fileNameHint: p.name || "pre-ride.jpg",
        });

        await client.query(
          `insert into public.documents (rider_id, rental_id, kind, file_name, mime_type, size_bytes, url)
           values ($1,$2,'pre_ride_photo',$3,$4,$5,$6)`,
          [riderId, rentalId, saved.file_name, saved.mime_type, saved.size_bytes, saved.url]
        );
      }
    }

    await client.query("commit");
    res.status(201).json(rentalRow);
  } catch (error) {
    await client.query("rollback");
    res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

// Update an active rental (used for retain rider when the rider hasn't returned yet)
// Includes payment verification for ICICI payment gateway integration
// Blocks rental update if payment is not verified as SUCCESS
app.patch("/api/rentals/:id", async (req, res) => {
  const rentalId = String(req.params.id || "").trim();
  if (!rentalId) return res.status(400).json({ error: "id required" });

  const body = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("begin");

    const rentalQ = await client.query(
      `select r.*,
              exists(select 1 from public.returns rt where rt.rental_id = r.id) as has_return
       from public.rentals r
       where r.id = $1`,
      [rentalId]
    );
    const rentalRow = rentalQ.rows?.[0] || null;
    if (!rentalRow) {
      await client.query("rollback");
      return res.status(404).json({ error: "Rental not found" });
    }
    if (rentalRow.has_return) {
      await client.query("rollback");
      return res.status(409).json({ error: "Rental already ended (returned)." });
    }

    // Payment verification for retain rider flow
    // Check if payment is required and verified before allowing rental update
    const paymentMode = String(body.payment_mode || body.paymentMode || rentalRow.payment_mode || "").trim().toLowerCase();
    const rentalMeta = rentalRow.meta && typeof rentalRow.meta === "object" ? rentalRow.meta : {};
    const newRentalMeta = body.meta && typeof body.meta === "object" ? body.meta : {};
    const merchantTranId = newRentalMeta.iciciMerchantTranId || newRentalMeta.merchantTranId || rentalMeta.iciciMerchantTranId || rentalMeta.merchantTranId || null;
    const iciciEnabled = String(process.env.VITE_ICICI_ENABLED || "false").toLowerCase() === "true";
    const totalAmount = Number(body.total_amount ?? body.totalAmount ?? rentalRow.total_amount ?? 0);

    if (iciciEnabled && paymentMode !== "cash" && merchantTranId && totalAmount > 0) {
      try {
        const { rows } = await pool.query(
          `select status, amount, transaction_type
           from public.payment_transactions
           where merchant_tran_id = $1
           limit 1`,
          [merchantTranId]
        );

        if (!rows || rows.length === 0) {
          await client.query("rollback");
          return res.status(402).json({
            error: "Payment transaction not found. Please complete payment before updating rental.",
            paymentRequired: true,
          });
        }

        const paymentTxn = rows[0];
        if (paymentTxn.status !== "SUCCESS") {
          await client.query("rollback");
          return res.status(402).json({
            error: `Payment not completed. Current status: ${paymentTxn.status}. Please complete payment before updating rental.`,
            paymentRequired: true,
            paymentStatus: paymentTxn.status,
          });
        }

        // Verify payment amount matches rental amount
        if (paymentTxn.amount !== totalAmount) {
          await client.query("rollback");
          return res.status(402).json({
            error: `Payment amount mismatch. Expected ₹${totalAmount}, but payment is ₹${paymentTxn.amount}.`,
            paymentRequired: true,
          });
        }
      } catch (error) {
        await client.query("rollback");
        console.error("Payment verification error during rental update", String(error?.message || error));
        return res.status(500).json({
          error: "Payment verification failed. Please try again or contact support.",
        });
      }
    }

    const set = [];
    const params = [];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (body.rental_package !== undefined) set.push(`rental_package = ${push(body.rental_package || null)}`);
    if (body.rental_amount !== undefined) set.push(`rental_amount = ${push(Number(body.rental_amount ?? 0))}`);
    if (body.deposit_amount !== undefined) set.push(`deposit_amount = ${push(Number(body.deposit_amount ?? 0))}`);
    if (body.total_amount !== undefined) set.push(`total_amount = ${push(Number(body.total_amount ?? 0))}`);
    if (body.payment_mode !== undefined) set.push(`payment_mode = ${push(body.payment_mode || null)}`);
    if (body.bike_model !== undefined) set.push(`bike_model = ${push(body.bike_model || null)}`);

    // expected end time is stored in meta
    if (body.expected_end_time !== undefined || body.end_time !== undefined) {
      const expected = body.expected_end_time !== undefined ? body.expected_end_time : body.end_time;
      set.push(
        `meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('expected_end_time', ${push(
          expected || null
        )}::text)`
      );
    }

    if (set.length === 0) {
      await client.query("commit");
      return res.json({ ok: true });
    }

    params.push(rentalId);
    const updated = await client.query(
      `update public.rentals
       set ${set.join(", ")}
       where id = $${params.length}
       returning *`,
      params
    );

    await client.query("commit");
    return res.json(updated.rows?.[0] || null);
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

// ICICI Payment Gateway Integration - Diagnostic endpoint
app.get("/api/payments/icici/status", async (req, res) => {
  try {
    const cryptoStatus = getIciciCryptoStatus();
    res.json({
      configured: Boolean(iciciBaseUrl && iciciQrEndpoint && iciciApiKey && iciciMid),
      crypto: {
        hasPublicKey: cryptoStatus.hasPublicKey,
        hasPrivateKey: cryptoStatus.hasPrivateKey,
      },
      publicKeyPath: process.env.ICICI_PUBLIC_KEY_PATH || null,
      privateKeyPath: process.env.ICICI_CLIENT_PRIVATE_KEY_P12_PATH || null,
      baseUrl: iciciBaseUrl || null,
      endpoint: iciciQrEndpoint || null,
      mid: iciciMid || null,
      hasApiKey: Boolean(iciciApiKey),
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// ICICI Payment Gateway Integration
app.post("/api/payments/icici/qr", async (req, res) => {
  try {
    const { amount, billNumber, merchantTranId, terminalId, validatePayerAccFlag, payerAccount, payerIFSC } =
      req.body || {};

    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }

    if (!iciciBaseUrl || !iciciQrEndpoint || !iciciApiKey || !iciciMid) {
      return res.status(500).json({ error: "ICICI payment gateway not configured" });
    }

    const cryptoStatus = getIciciCryptoStatus();
    if (!cryptoStatus.hasPublicKey) {
      return res.status(500).json({
        error:
          "ICICI encryption not configured. Set ICICI_PUBLIC_KEY_PATH (ICICI .cer) or ICICI_PUBLIC_KEY_PEM on the server.",
      });
    }

    if (!fetchApi) {
      return res.status(500).json({
        error: "Server fetch() not available. Use Node 18+ or provide a fetch polyfill.",
      });
    }

    const mcc = String(terminalId || process.env.ICICI_TERMINAL_ID || "5411").trim();
    const txnId =
      String(merchantTranId || "").trim() ||
      String(billNumber || "").trim() ||
      crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    const payload = {
      amount: Number(amount).toFixed(2),
      merchantId: String(iciciMid),
      terminalId: mcc,
      merchantTranId: txnId,
      billNumber: String(billNumber || txnId).slice(0, 50),
    };

    if (validatePayerAccFlag) {
      payload.validatePayerAccFlag = String(validatePayerAccFlag).toUpperCase() === "Y" ? "Y" : "N";
      if (payload.validatePayerAccFlag === "Y") {
        if (payerAccount) payload.payerAccount = String(payerAccount);
        if (payerIFSC) payload.payerIFSC = String(payerIFSC);
      }
    }

    const mode = String(process.env.ICICI_ENCRYPTION_MODE || "asymmetric").toLowerCase();
    const headers = {
      // As per PDF: content-type is text/plain, API key header name is apikey
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "*/*",
      apikey: iciciApiKey,
    };

    let outboundBody;
    if (mode === "hybrid") {
      const serviceName = String(process.env.ICICI_SERVICE_QR || "QR3").trim();
      outboundBody = JSON.stringify(
        buildIciciEncryptedRequest({ requestId: txnId, service: serviceName, payload })
      );
      headers["Content-Type"] = "application/json";
      headers.Accept = "application/json";
    } else {
      outboundBody = encryptIciciAsymmetricPayload(payload);
    }

    const response = await fetchApi(`${iciciBaseUrl}${iciciQrEndpoint}`, {
      method: "POST",
      headers,
      body: outboundBody,
    });

    const rawText = await response.text().catch(() => "");
    let decoded = null;
    if (mode === "hybrid") {
      try {
        decoded = rawText ? JSON.parse(rawText) : null;
      } catch {
        decoded = rawText;
      }
    } else {
      try {
        decoded = decodeIciciAsymmetricResponseOrThrow(rawText);
      } catch (error) {
        if (error?.code === "ICICI_PRIVATE_KEY_REQUIRED") {
          return res.status(500).json({
            error: String(error.message || error),
            upstreamStatus: response.status,
            upstreamBody: rawText,
          });
        }
        throw error;
      }
    }

    if (!response.ok) {
      console.error("ICICI QR API failed", decoded);
      const msg =
        decoded && typeof decoded === "object"
          ? decoded.message || decoded.error || decoded.response || "QR API failed"
          : decoded || "QR API failed";
      return res.status(response.status).json({
        error: msg,
        upstreamStatus: response.status,
        upstreamBody: decoded,
      });
    }

    const refId =
      (decoded && (decoded.refId || decoded.refid || decoded.RefId || decoded.refID)) || null;
    const respMerchantTranId =
      (decoded && (decoded.merchantTranId || decoded.merchantTranID)) || txnId;

    // PDF: upi://pay?pa=<merchant VPA>&pn=<merchant name>&tr=<Refid>&am=<amount>&cu=INR&mc=<MCC>
    const payeeName = String(process.env.ICICI_PAYEE_NAME || "Evegah").trim();
    const params = new URLSearchParams({
      pa: String(iciciVpa || "").trim(),
      pn: payeeName,
      tr: String(refId || "").trim(),
      am: Number(amount).toFixed(2),
      cu: "INR",
      mc: mcc,
    });

    // Store payment transaction record for tracking and verification
    // This allows us to verify payment status before allowing rider actions
    let paymentTransactionId = null;
    if (databaseUrl && respMerchantTranId) {
      try {
        const transactionType = String(req.body?.transactionType || "NEW_RIDER").toUpperCase();
        const rentalId = req.body?.rentalId || null;
        const batterySwapId = req.body?.batterySwapId || null;
        const riderId = req.body?.riderId || null;

        const { rows: insertedRows } = await pool.query(
          `insert into public.payment_transactions (
             merchant_tran_id, ref_id, amount, status, transaction_type,
             rental_id, battery_swap_id, rider_id, icici_response
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            respMerchantTranId,
            refId || null,
            Number(amount),
            "PENDING",
            transactionType,
            rentalId,
            batterySwapId,
            riderId,
            JSON.stringify(decoded || {}),
          ]
        );
        paymentTransactionId = insertedRows?.[0]?.id || null;
      } catch (error) {
        console.warn("Failed to create payment transaction record", String(error?.message || error));
      }
    }

    return res.json({
      merchantId: String(iciciMid),
      terminalId: mcc,
      merchantTranId: respMerchantTranId,
      refId,
      qrString: `upi://pay?${params.toString()}`,
      paymentTransactionId,
      upstream: decoded,
    });
  } catch (error) {
    console.error("ICICI QR generation error", error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

// ICICI Transaction Status API Endpoint
// Verifies payment status by querying ICICI Transaction Status API
// Updates payment_transactions table with latest status from ICICI
app.post("/api/payments/icici/status", async (req, res) => {
  try {
    const { merchantTranId, subMerchantId, terminalId } = req.body || {};

    if (!merchantTranId) {
      return res.status(400).json({ error: "merchantTranId is required" });
    }

    if (!iciciBaseUrl || !iciciTransactionStatusEndpoint || !iciciApiKey) {
      return res.status(500).json({ error: "ICICI payment gateway not configured" });
    }

    if (!fetchApi) {
      return res.status(500).json({
        error: "Server fetch() not available. Use Node 18+ or provide a fetch polyfill.",
      });
    }

    const mcc = String(terminalId || process.env.ICICI_TERMINAL_ID || "5411").trim();
    const subMid = String(subMerchantId || process.env.ICICI_SUB_MERCHANT_ID || iciciMid).trim();

    const payload = {
      merchantId: String(iciciMid),
      subMerchantId: subMid,
      terminalId: mcc,
      merchantTranId: String(merchantTranId),
    };

    const mode = String(process.env.ICICI_ENCRYPTION_MODE || "asymmetric").toLowerCase();
    const headers = {
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "*/*",
      apikey: iciciApiKey,
    };

    let outboundBody;
    if (mode === "hybrid") {
      const serviceName = String(process.env.ICICI_SERVICE_STATUS || "TransactionStatus3").trim();
      outboundBody = JSON.stringify(
        buildIciciEncryptedRequest({ requestId: crypto.randomUUID(), service: serviceName, payload })
      );
      headers["Content-Type"] = "application/json";
      headers.Accept = "application/json";
    } else {
      outboundBody = encryptIciciAsymmetricPayload(payload);
    }

    const response = await fetchApi(`${iciciBaseUrl}${iciciTransactionStatusEndpoint}`, {
      method: "POST",
      headers,
      body: outboundBody,
    });

    const rawText = await response.text().catch(() => "");
    let decoded = null;
    if (mode === "hybrid") {
      try {
        decoded = rawText ? JSON.parse(rawText) : null;
      } catch {
        decoded = rawText;
      }
    } else {
      try {
        decoded = decodeIciciAsymmetricResponseOrThrow(rawText);
      } catch (error) {
        if (error?.code === "ICICI_PRIVATE_KEY_REQUIRED") {
          return res.status(500).json({
            error: String(error.message || error),
            upstreamStatus: response.status,
            upstreamBody: rawText,
          });
        }
        throw error;
      }
    }

    if (!response.ok) {
      console.error("ICICI status check failed", decoded);
      const msg =
        decoded && typeof decoded === "object"
          ? decoded.message || decoded.error || decoded.response || "Status check failed"
          : decoded || "Status check failed";
      return res.status(response.status).json({
        error: msg,
        upstreamStatus: response.status,
        upstreamBody: decoded,
      });
    }

    // Update payment_transactions table with status from ICICI API
    // ICICI response format: response, merchantId, subMerchantId, terminalId, success, message,
    // merchantTranId, OriginalBankRRN, amount, status (PENDING/SUCCESS/FAILURE)
    if (databaseUrl && decoded) {
      try {
        const iciciStatus = String(decoded.status || decoded.Status || "PENDING").toUpperCase();
        const bankRRN = decoded.OriginalBankRRN || decoded.originalBankRRN || decoded.bankRRN || null;
        const transactionAmount = decoded.amount || decoded.Amount || null;

        // Map ICICI status to our payment_transactions status
        let paymentStatus = "PENDING";
        if (iciciStatus === "SUCCESS") {
          paymentStatus = "SUCCESS";
        } else if (iciciStatus === "FAILURE" || iciciStatus === "FAILED") {
          paymentStatus = "FAILURE";
        }

        await pool.query(
          `update public.payment_transactions
           set status = $1,
               bank_rrn = coalesce(nullif($2, ''), bank_rrn),
               icici_response = $3,
               last_status_check_at = now(),
               verification_attempts = verification_attempts + 1,
               verified_at = case when $1 = 'SUCCESS' and verified_at is null then now() else verified_at end,
               updated_at = now()
           where merchant_tran_id = $4`,
          [
            paymentStatus,
            bankRRN,
            JSON.stringify(decoded),
            merchantTranId,
          ]
        );
      } catch (error) {
        console.warn("Failed to update payment transaction status", String(error?.message || error));
      }
    }

    return res.json(decoded);
  } catch (error) {
    console.error("ICICI status check error", error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

// Payment Verification Endpoint
// Verifies if payment transaction exists and has SUCCESS status
// Used by frontend to check payment status before allowing rider actions
app.post("/api/payments/icici/verify", async (req, res) => {
  try {
    const { merchantTranId, rentalId, transactionType } = req.body || {};

    if (!merchantTranId && !rentalId) {
      return res.status(400).json({ error: "merchantTranId or rentalId is required" });
    }

    if (!databaseUrl) {
      return res.status(500).json({ error: "Database not configured" });
    }

    let query;
    let params;

    if (merchantTranId) {
      query = `select id, merchant_tran_id, ref_id, bank_rrn, amount, status, transaction_type,
                      rental_id, battery_swap_id, rider_id, verified_at, created_at
               from public.payment_transactions
               where merchant_tran_id = $1
               limit 1`;
      params = [merchantTranId];
    } else {
      query = `select id, merchant_tran_id, ref_id, bank_rrn, amount, status, transaction_type,
                      rental_id, battery_swap_id, rider_id, verified_at, created_at
               from public.payment_transactions
               where rental_id = $1`;
      params = [rentalId];
      if (transactionType) {
        query += ` and transaction_type = $2`;
        params.push(transactionType);
      }
      query += ` order by created_at desc limit 1`;
    }

    const { rows } = await pool.query(query, params);

    if (!rows || rows.length === 0) {
      return res.json({
        verified: false,
        exists: false,
        message: "Payment transaction not found",
      });
    }

    const transaction = rows[0];
    const isVerified = transaction.status === "SUCCESS";

    return res.json({
      verified: isVerified,
      exists: true,
      transaction: {
        id: transaction.id,
        merchantTranId: transaction.merchant_tran_id,
        refId: transaction.ref_id,
        bankRRN: transaction.bank_rrn,
        amount: transaction.amount,
        status: transaction.status,
        transactionType: transaction.transaction_type,
        rentalId: transaction.rental_id,
        batterySwapId: transaction.battery_swap_id,
        riderId: transaction.rider_id,
        verifiedAt: transaction.verified_at,
        createdAt: transaction.created_at,
      },
      message: isVerified ? "Payment verified successfully" : `Payment status: ${transaction.status}`,
    });
  } catch (error) {
    console.error("Payment verification error", error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/payments/icici/refund", async (req, res) => {
  try {
    const {
      originalBankRRN,
      merchantTranId,
      originalmerchantTranId,
      refundAmount,
      note,
      onlineRefund,
      payeeVA,
      subMerchantId,
      terminalId,
    } = req.body || {};

    if (!originalBankRRN || !merchantTranId || !originalmerchantTranId || !refundAmount || !note) {
      return res.status(400).json({
        error:
          "originalBankRRN, merchantTranId, originalmerchantTranId, refundAmount and note are required",
      });
    }

    if (!iciciBaseUrl || !iciciRefundEndpoint || !iciciApiKey) {
      return res.status(500).json({ error: "ICICI payment gateway not configured" });
    }

    if (!fetchApi) {
      return res.status(500).json({
        error: "Server fetch() not available. Use Node 18+ or provide a fetch polyfill.",
      });
    }

    const mcc = String(terminalId || process.env.ICICI_TERMINAL_ID || "5411").trim();
    const subMid = String(subMerchantId || process.env.ICICI_SUB_MERCHANT_ID || iciciMid).trim();

    const payload = {
      merchantId: String(iciciMid),
      subMerchantId: subMid,
      terminalId: mcc,
      originalBankRRN: String(originalBankRRN),
      merchantTranId: String(merchantTranId),
      originalmerchantTranId: String(originalmerchantTranId),
      refundAmount: Number(refundAmount).toFixed(2),
      note: String(note).slice(0, 50),
      onlineRefund: String(onlineRefund || "Y").toUpperCase() === "N" ? "N" : "Y",
    };

    if (payeeVA) payload.payeeVA = String(payeeVA);

    const mode = String(process.env.ICICI_ENCRYPTION_MODE || "asymmetric").toLowerCase();
    const headers = {
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "*/*",
      apikey: iciciApiKey,
    };

    let outboundBody;
    if (mode === "hybrid") {
      const serviceName = String(process.env.ICICI_SERVICE_REFUND || "Refund").trim();
      outboundBody = JSON.stringify(
        buildIciciEncryptedRequest({ requestId: crypto.randomUUID(), service: serviceName, payload })
      );
      headers["Content-Type"] = "application/json";
      headers.Accept = "application/json";
    } else {
      outboundBody = encryptIciciAsymmetricPayload(payload);
    }

    const response = await fetchApi(`${iciciBaseUrl}${iciciRefundEndpoint}`, {
      method: "POST",
      headers,
      body: outboundBody,
    });

    const rawText = await response.text().catch(() => "");
    let decoded = null;
    if (mode === "hybrid") {
      try {
        decoded = rawText ? JSON.parse(rawText) : null;
      } catch {
        decoded = rawText;
      }
    } else {
      try {
        decoded = decodeIciciAsymmetricResponseOrThrow(rawText);
      } catch (error) {
        if (error?.code === "ICICI_PRIVATE_KEY_REQUIRED") {
          return res.status(500).json({
            error: String(error.message || error),
            upstreamStatus: response.status,
            upstreamBody: rawText,
          });
        }
        throw error;
      }
    }

    if (!response.ok) {
      console.error("ICICI refund failed", decoded);
      const msg =
        decoded && typeof decoded === "object"
          ? decoded.message || decoded.error || decoded.response || "Refund failed"
          : decoded || "Refund failed";
      return res.status(response.status).json({
        error: msg,
        upstreamStatus: response.status,
        upstreamBody: decoded,
      });
    }

    return res.json(decoded);
  } catch (error) {
    console.error("ICICI refund error", error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

// ICICI Payment Gateway Callback Handler
// Handles encrypted callback responses from ICICI Bank UPI API
// Updates payment_transactions table and payment_notifications for reconciliation
// Performs signature verification if configured for security
app.post("/api/payments/icici/callback", async (req, res) => {
  let payload = req.body || {};
  const signatureSecret = String(process.env.ICICI_PAYMENT_SIGNATURE_SECRET || "").trim();
  let rawBody = req.rawBody || (payload ? JSON.stringify(payload) : "");

  // Handle encrypted callback payload - ICICI sends encrypted Base64 encoded response
  // Decrypt using client private key if payload appears encrypted
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("text/plain") && typeof rawBody === "string" && rawBody.trim()) {
    try {
      const decrypted = decodeIciciAsymmetricResponseOrThrow(rawBody);
      if (decrypted && typeof decrypted === "object") {
        payload = decrypted;
        rawBody = JSON.stringify(decrypted);
      }
    } catch (error) {
      console.warn("ICICI callback decryption attempt failed, treating as plain JSON", String(error?.message || error));
    }
  }

  // Signature verification for callback security
  const signatureHeader =
    req.headers["x-icici-signature"] ||
    req.headers["x-signature"] ||
    req.headers.signature ||
    "";
  const normalizedSignature = String(signatureHeader || "").trim().toLowerCase();

  if (signatureSecret) {
    if (!normalizedSignature) {
      return res.status(400).json({ error: "missing signature" });
    }
    const expected = crypto.createHmac("sha256", signatureSecret).update(rawBody).digest("hex");
    if (expected.toLowerCase() !== normalizedSignature) {
      console.warn("ICICI callback signature mismatch", {
        expected,
        provided: normalizedSignature,
      });
      return res.status(401).json({ error: "invalid signature" });
    }
  }

  // Extract callback data using ICICI API documentation field names
  // ICICI callback format: merchantId, subMerchantId, terminalId, BankRRN, merchantTranId,
  // PayerName, PayerMobile, PayerVA, PayerAmount, TxnStatus, TxnInitDate, TxnCompletionDate
  const findFirst = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const trimmed = String(value).trim();
      if (trimmed) return trimmed;
    }
    return "";
  };

  // Extract merchant transaction ID (primary identifier)
  const merchantTranId = findFirst(
    payload.merchantTranId,
    payload.merchantTranID,
    payload.merchant_tran_id,
    payload.merchantRefNo,
    payload.merchant_reference_no,
    payload.merchantReference,
    payload.referenceId,
    payload.reference
  );

  // Extract Bank RRN (Reference Number from ICICI)
  const bankRRN = findFirst(
    payload.BankRRN,
    payload.bankRRN,
    payload.bank_rrn,
    payload.rrn,
    payload.transactionId,
    payload.txnId,
    payload.transaction_reference
  );

  // Extract transaction status (ICICI uses TxnStatus field)
  const statusRaw = findFirst(
    payload.TxnStatus,
    payload.txnStatus,
    payload.status,
    payload.payment_status,
    payload.transactionStatus,
    payload.responseCode,
    payload.result
  );
  const status = statusRaw ? statusRaw.toUpperCase() : null;

  // Extract status message
  const statusMessage = findFirst(
    payload.statusMessage,
    payload.status_msg,
    payload.responseMessage,
    payload.response_message,
    payload.message,
    payload.note,
    payload.response_desc
  );

  // Parse amount (ICICI uses PayerAmount field)
  const parseAmount = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).replace(/[^0-9.\-]+/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Number(parsed.toFixed(2));
  };

  const amount = parseAmount(
    payload.PayerAmount,
    payload.payerAmount,
    payload.amount,
    payload.payment_amount,
    payload.transaction_amount,
    payload.txnAmount,
    payload.amountPaid,
    payload.value,
    payload.amt
  );

  // Extract payer information
  const payerName = findFirst(payload.PayerName, payload.payerName, payload.payer_name);
  const payerMobile = findFirst(payload.PayerMobile, payload.payerMobile, payload.payer_mobile);
  const payerVA = findFirst(payload.PayerVA, payload.payerVA, payload.payer_va);

  // Transaction dates
  const txnInitDate = findFirst(payload.TxnInitDate, payload.txnInitDate, payload.txn_init_date);
  const txnCompletionDate = findFirst(
    payload.TxnCompletionDate,
    payload.txnCompletionDate,
    payload.txn_completion_date
  );

  // Determine payment transaction status
  const successStates = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID", "APPROVED", "OK"]);
  const failureStates = new Set(["FAILED", "FAIL", "DECLINED", "REJECTED", "ERROR"]);
  const pendingStates = new Set(["PENDING", "IN_PROGRESS", "PROCESSING", "RECEIVED"]);

  const paymentStatus =
    status && successStates.has(status)
      ? "SUCCESS"
      : status && failureStates.has(status)
        ? "FAILURE"
        : status && pendingStates.has(status)
          ? "PENDING"
          : "PENDING";

  // Lookup payment transaction by merchantTranId
  let paymentTransactionId = null;
  let rentalId = null;
  let batterySwapId = null;
  let riderId = null;
  let transactionType = null;

  if (merchantTranId) {
    try {
      const { rows: txnRows } = await pool.query(
        `select id, rental_id, battery_swap_id, rider_id, transaction_type, status
         from public.payment_transactions
         where merchant_tran_id = $1
         limit 1`,
        [merchantTranId]
      );
      if (txnRows?.[0]) {
        paymentTransactionId = txnRows[0].id;
        rentalId = txnRows[0].rental_id;
        batterySwapId = txnRows[0].battery_swap_id;
        riderId = txnRows[0].rider_id;
        transactionType = txnRows[0].transaction_type;
      }
    } catch (error) {
      console.warn("Payment transaction lookup failed", String(error?.message || error));
    }
  }

  // If transaction not found by merchantTranId, try to find by rental_id from reference
  if (!paymentTransactionId && merchantTranId) {
    const isUuid = (value) =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (isUuid(merchantTranId)) {
      try {
        const { rows: rentalRows } = await pool.query(
          `select id, rider_id from public.rentals where id = $1 limit 1`,
          [merchantTranId]
        );
        if (rentalRows?.[0]) {
          rentalId = rentalRows[0].id;
          riderId = rentalRows[0].rider_id;
        }
      } catch (error) {
        console.warn("Rental lookup failed in callback", String(error?.message || error));
      }
    }
  }

  // Store callback notification for audit trail
  const headerSnapshot = {
    "x-icici-signature": req.headers["x-icici-signature"] || null,
    "x-signature": req.headers["x-signature"] || null,
    signature: req.headers.signature || null,
    "user-agent": req.headers["user-agent"] || null,
    "content-type": req.headers["content-type"] || null,
  };

  let notificationId = null;
  try {
    const { rows: insertedRows } = await pool.query(
      `insert into public.payment_notifications (
         reference, transaction_id, status, status_message,
         amount, payment_method, signature,
         headers, payload, raw_body,
         rental_id, payment_due_id
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       ) returning id`,
      [
        merchantTranId || null,
        bankRRN || null,
        status,
        statusMessage || null,
        amount,
        payerVA || null,
        normalizedSignature || null,
        headerSnapshot,
        payload,
        rawBody || null,
        rentalId,
        null,
      ]
    );
    notificationId = insertedRows?.[0]?.id || null;
  } catch (error) {
    console.error("Failed to store ICICI callback notification", String(error?.message || error));
    return res.status(500).json({ error: "failed to persist callback" });
  }

  // Update payment_transactions table with callback data
  if (paymentTransactionId) {
    try {
      await pool.query(
        `update public.payment_transactions
         set status = $1,
             bank_rrn = coalesce(nullif($2, ''), bank_rrn),
             callback_data = $3,
             verified_at = case when $1 = 'SUCCESS' then now() else verified_at end,
             updated_at = now()
         where id = $4`,
        [
          paymentStatus,
          bankRRN || null,
          JSON.stringify({
            payerName,
            payerMobile,
            payerVA,
            txnInitDate,
            txnCompletionDate,
            statusMessage,
            callbackReceivedAt: new Date().toISOString(),
          }),
          paymentTransactionId,
        ]
      );
    } catch (error) {
      console.error("Failed to update payment transaction from callback", String(error?.message || error));
    }
  } else if (merchantTranId && rentalId) {
    // Create payment transaction record if it doesn't exist (edge case)
    try {
      const { rows: createdRows } = await pool.query(
        `insert into public.payment_transactions (
           merchant_tran_id, ref_id, bank_rrn, amount, status, transaction_type,
           rental_id, rider_id, callback_data, verified_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $5 = 'SUCCESS' then now() else null end)
         returning id`,
        [
          merchantTranId,
          null,
          bankRRN || null,
          amount,
          paymentStatus,
          transactionType || "NEW_RIDER",
          rentalId,
          riderId,
          JSON.stringify({
            payerName,
            payerMobile,
            payerVA,
            txnInitDate,
            txnCompletionDate,
            statusMessage,
            callbackReceivedAt: new Date().toISOString(),
          }),
        ]
      );
      paymentTransactionId = createdRows?.[0]?.id || null;
    } catch (error) {
      console.warn("Failed to create payment transaction from callback", String(error?.message || error));
    }
  }

  return res.json({
    ok: true,
    recorded: Boolean(notificationId),
    payment_transaction_updated: Boolean(paymentTransactionId),
    merchant_tran_id: merchantTranId,
    bank_rrn: bankRRN,
    status: paymentStatus,
    status_message: statusMessage,
    amount,
    rental_id: rentalId,
    battery_swap_id: batterySwapId,
  });
});

app.get("/api/returns", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select
          ret.id as return_id,
          ret.rental_id,
          ret.returned_at,
          ret.condition_notes,
          ret.created_at as return_created_at,
          ret.meta as return_meta,

          r.rider_id,
          r.vehicle_number,
          r.bike_id,
          r.battery_id,
          r.start_time,
          coalesce(r.meta->>'expected_end_time','') as expected_end_time,
          r.rental_amount,
          r.deposit_amount,
          r.total_amount,
          r.payment_mode,

          rd.full_name as rider_full_name,
          rd.mobile as rider_mobile,
          coalesce(rd.meta->>'rider_code','') as rider_code,

          (coalesce(ret.meta->>'deposit_returned','false'))::boolean as deposit_returned,
          coalesce(nullif(ret.meta->>'deposit_returned_amount','')::numeric, 0) as deposit_returned_amount,
          coalesce(ret.meta->>'deposit_returned_at','') as deposit_returned_at
        from public.returns ret
        left join public.rentals r on r.id = ret.rental_id
        left join public.riders rd on rd.id = r.rider_id
        order by ret.created_at desc`
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/riders/:id/rentals", async (req, res) => {
  const riderId = String(req.params.id || "");
  if (!riderId) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await pool.query(
      `select * from public.rentals where rider_id = $1 order by start_time desc`,
      [riderId]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/riders/:id/documents", async (req, res) => {
  const riderId = String(req.params.id || "");
  if (!riderId) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await pool.query(
      `select distinct d.*
       from public.documents d
       where d.rider_id = $1
          or d.rental_id in (select id from public.rentals where rider_id = $1)
          or d.return_id in (
            select rt.id
            from public.returns rt
            join public.rentals r on r.id = rt.rental_id
            where r.rider_id = $1
          )
       order by d.created_at desc`,
      [riderId]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Rider-centric battery swap history (matched via vehicle_number + swapped_at inside rental window)
app.get("/api/riders/:id/battery-swaps", async (req, res) => {
  const riderId = String(req.params.id || "");
  if (!riderId) return res.status(400).json({ error: "id required" });

  try {
    const { rows } = await pool.query(
      `select s.id, s.created_at, s.swapped_at, s.employee_uid, s.employee_email,
              s.vehicle_number, s.battery_out, s.battery_in, s.notes,
              rr.rental_id, rr.rider_id, rr.rider_full_name, rr.rider_mobile
       from public.battery_swaps s
       join lateral (
         select r.id as rental_id,
                rd.id as rider_id,
                rd.full_name as rider_full_name,
                rd.mobile as rider_mobile
         from public.rentals r
         left join public.riders rd on rd.id = r.rider_id
         left join public.returns ret on ret.rental_id = r.id
         where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
               regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g')
           and r.start_time <= s.swapped_at
           and (ret.id is null or ret.returned_at > s.swapped_at)
         order by r.start_time desc
         limit 1
       ) rr on true
       where rr.rider_id = $1
       order by s.swapped_at desc
       `,
      [riderId]
    );

    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/rentals/:id/documents", async (req, res) => {
  const rentalId = String(req.params.id || "");
  if (!rentalId) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await pool.query(
      `select distinct d.*
       from public.documents d
       where d.rental_id = $1
          or d.return_id in (select id from public.returns where rental_id = $1)
       order by d.created_at desc`,
      [rentalId]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// New Rider registration: creates/updates rider + rental + stores images (data URLs)
// Includes payment verification for ICICI payment gateway integration
// Blocks registration if payment is not verified as SUCCESS
app.post("/api/registrations/new-rider", async (req, res) => {
  const body = req.body || {};

  const rider = body.rider || {};
  const rental = body.rental || {};
  const documents = body.documents || {};

  const rentalMeta = rental.meta && typeof rental.meta === "object" ? rental.meta : {};
  // In this app, end_time coming from the form is an *expected* end date/time.
  // The DB column end_time is reserved for the *actual* return time (set on /api/returns/submit).
  if (rental.end_time) {
    rentalMeta.expected_end_time = rental.end_time;
  }

  const fullName = String(rider.full_name || rider.name || "").trim();
  const mobile = toDigits(rider.mobile || rider.phone || "", 10);
  const aadhaar = toDigits(rider.aadhaar || "", 12);
  const riderMeta = rider.meta && typeof rider.meta === "object" ? rider.meta : {};

  if (!fullName) return res.status(400).json({ error: "full_name required" });
  if (mobile.length !== 10) return res.status(400).json({ error: "valid mobile required" });
  if (!rental.start_time) return res.status(400).json({ error: "start_time required" });

  // Payment verification for ICICI payment gateway
  // Check if payment transaction exists and has SUCCESS status
  // Only allow registration if payment is verified or payment mode is cash
  const paymentMode = String(rental.payment_mode || rental.paymentMode || "").trim().toLowerCase();
  const merchantTranId = rentalMeta.iciciMerchantTranId || rentalMeta.merchantTranId || null;
  const iciciEnabled = String(process.env.VITE_ICICI_ENABLED || "false").toLowerCase() === "true";

  if (iciciEnabled && paymentMode !== "cash" && merchantTranId) {
    try {
      // Check payment transaction status in database
      const { rows } = await pool.query(
        `select status, amount, transaction_type
         from public.payment_transactions
         where merchant_tran_id = $1
         limit 1`,
        [merchantTranId]
      );

      let paymentStatus = null;
      let paymentAmount = null;

      if (rows && rows.length > 0) {
        paymentStatus = rows[0].status;
        paymentAmount = rows[0].amount;
      } else {
        // Payment transaction not found in database - verify via ICICI API
        if (!iciciBaseUrl || !iciciTransactionStatusEndpoint || !iciciApiKey || !fetchApi) {
          return res.status(402).json({
            error: "Payment verification service unavailable. Please complete payment before registration.",
            paymentRequired: true,
          });
        }

        const mcc = String(process.env.ICICI_TERMINAL_ID || "5411").trim();
        const subMid = String(process.env.ICICI_SUB_MERCHANT_ID || iciciMid).trim();
        const statusPayload = {
          merchantId: String(iciciMid),
          subMerchantId: subMid,
          terminalId: mcc,
          merchantTranId: String(merchantTranId),
        };

        const mode = String(process.env.ICICI_ENCRYPTION_MODE || "asymmetric").toLowerCase();
        const headers = {
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "*/*",
          apikey: iciciApiKey,
        };

        let outboundBody;
        if (mode === "hybrid") {
          const serviceName = String(process.env.ICICI_SERVICE_STATUS || "TransactionStatus3").trim();
          outboundBody = JSON.stringify(
            buildIciciEncryptedRequest({ requestId: crypto.randomUUID(), service: serviceName, payload: statusPayload })
          );
          headers["Content-Type"] = "application/json";
          headers.Accept = "application/json";
        } else {
          outboundBody = encryptIciciAsymmetricPayload(statusPayload);
        }

        const statusResponse = await fetchApi(`${iciciBaseUrl}${iciciTransactionStatusEndpoint}`, {
          method: "POST",
          headers,
          body: outboundBody,
        });

        const rawText = await statusResponse.text().catch(() => "");
        let decoded = null;
        if (mode === "hybrid") {
          try {
            decoded = rawText ? JSON.parse(rawText) : null;
          } catch {
            decoded = rawText;
          }
        } else {
          try {
            decoded = decodeIciciAsymmetricResponseOrThrow(rawText);
          } catch (verifyError) {
            console.warn("ICICI status API decryption failed", String(verifyError?.message || verifyError));
            return res.status(402).json({
              error: "Payment verification failed. Please complete payment before registration.",
              paymentRequired: true,
            });
          }
        }

        if (!statusResponse.ok || !decoded) {
          return res.status(402).json({
            error: "Payment verification failed. Please complete payment before registration.",
            paymentRequired: true,
          });
        }

        const iciciStatus = String(decoded.status || decoded.Status || "PENDING").toUpperCase();
        paymentStatus = iciciStatus === "SUCCESS" ? "SUCCESS" : iciciStatus === "FAILURE" ? "FAILURE" : "PENDING";
        paymentAmount = decoded.amount || decoded.Amount || null;
      }

      // Verify payment status is SUCCESS
      if (paymentStatus !== "SUCCESS") {
        return res.status(402).json({
          error: `Payment not completed. Current status: ${paymentStatus}. Please complete payment before registration.`,
          paymentRequired: true,
          paymentStatus: paymentStatus,
        });
      }

      // Verify payment amount matches rental amount
      const rentalAmount = Number(rental.total_amount ?? rental.totalAmount ?? 0);
      if (paymentAmount !== null && paymentAmount !== rentalAmount) {
        return res.status(402).json({
          error: `Payment amount mismatch. Expected ₹${rentalAmount}, but payment is ₹${paymentAmount}.`,
          paymentRequired: true,
        });
      }
    } catch (error) {
      console.error("Payment verification error during registration", String(error?.message || error));
      return res.status(500).json({
        error: "Payment verification failed. Please try again or contact support.",
      });
    }
  }

  const preRide = Array.isArray(documents.preRidePhotos) ? documents.preRidePhotos : [];
  if (preRide.length === 0) {
    return res.status(400).json({ error: "preRidePhotos required (at least 1 pre-ride vehicle photo)" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const availability = await getActiveAvailability({ client });
    const requestedVehicleId = normalizeIdForCompare(rental.bike_id || rental.bikeId || "");
    const requestedVehicleNumber = normalizeIdForCompare(
      rental.vehicle_number || rental.vehicleNumber || rental.bikeId || ""
    );
    const requestedBatteryId = normalizeIdForCompare(rental.battery_id || rental.batteryId || "");

    if (requestedVehicleId && availability.unavailableVehicleIdSet.has(requestedVehicleId)) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected vehicle is unavailable (already in an active rental)." });
    }
    if (
      requestedVehicleNumber &&
      availability.unavailableVehicleNumberSet.has(requestedVehicleNumber)
    ) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected vehicle is unavailable (already in an active rental)." });
    }
    if (requestedBatteryId && availability.unavailableBatteryIdSet.has(requestedBatteryId)) {
      await client.query("rollback");
      return res.status(409).json({ error: "Selected battery is unavailable (already in an active rental)." });
    }

    // Block existing riders from using the New Rider flow.
    const existingRiderResult = await client.query(
      `select id
       from public.riders
       where mobile = $1
          or ($2::text is not null and aadhaar = $2)
       limit 1`,
      [mobile, aadhaar || null]
    );
    if (existingRiderResult.rows?.length) {
      await client.query("rollback");
      return res.status(409).json({
        error: "Rider already registered. Please use Retain Rider form.",
      });
    }

    // Insert rider (no upsert)
    const riderResult = await client.query(
      `insert into public.riders (full_name, mobile, aadhaar, dob, gender, permanent_address, temporary_address, reference, status, meta)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
       on conflict (mobile) do nothing
       returning id`,
      [
        fullName,
        mobile,
        aadhaar || null,
        rider.dob ? rider.dob : null,
        rider.gender || null,
        rider.permanent_address || rider.permanentAddress || null,
        rider.temporary_address || rider.temporaryAddress || null,
        rider.reference || null,
        JSON.stringify(riderMeta),
      ]
    );

    if (!riderResult.rows?.length) {
      await client.query("rollback");
      return res.status(409).json({
        error: "Rider already registered. Please use Retain Rider form.",
      });
    }

    const riderId = riderResult.rows?.[0]?.id;
    const riderCode = await ensureRiderCode({ client, riderId });

    const rentalResult = await client.query(
      `insert into public.rentals
         (rider_id, start_time, end_time, rental_package, rental_amount, deposit_amount, total_amount, payment_mode, bike_model, bike_id, battery_id, vehicle_number, accessories, other_accessories, meta)
       values
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning id`,
      [
        riderId,
        rental.start_time,
        null,
        rental.rental_package || rental.rentalPackage || null,
        Number(rental.rental_amount ?? rental.rentalAmount ?? 0),
        Number(rental.deposit_amount ?? rental.securityDeposit ?? 0),
        Number(rental.total_amount ?? rental.totalAmount ?? 0),
        rental.payment_mode || rental.paymentMode || null,
        rental.bike_model || rental.bikeModel || null,
        rental.bike_id || rental.bikeId || null,
        rental.battery_id || rental.batteryId || null,
        rental.vehicle_number || rental.vehicleNumber || rental.bikeId || null,
        JSON.stringify(rental.accessories || []),
        rental.other_accessories || rental.otherAccessories || null,
        JSON.stringify(rentalMeta),
      ]
    );

    const rentalId = rentalResult.rows?.[0]?.id;

    if (rentalId) {
      const rentalRowQ = await client.query(
        `select id, start_time, battery_id, vehicle_number
         from public.rentals
         where id = $1`,
        [rentalId]
      );
      const rentalRow = rentalRowQ.rows?.[0] || null;
      if (rentalRow) {
        await autoCreateBatterySwapForRental({ client, rental: rentalRow });
      }
    }

    const normalizeDocumentValue = (value) => {
      if (!value) return null;
      if (typeof value === "string") {
        return { dataUrl: value };
      }
      const candidate = value.upload || value;
      if (
        candidate &&
        candidate.url &&
        candidate.file_name &&
        candidate.mime_type
      ) {
        return {
          url: candidate.url,
          file_name: candidate.file_name,
          mime_type: candidate.mime_type,
          size_bytes: Number(candidate.size_bytes ?? 0),
        };
      }
      if (candidate && candidate.dataUrl) {
        return {
          dataUrl: candidate.dataUrl,
          fileNameHint: candidate.name,
        };
      }
      return null;
    };

    const docsToSave = [];
    const enqueueDocument = (kind, payload, targetRentalId = null) => {
      const normalized = normalizeDocumentValue(payload);
      if (!normalized) return;
      docsToSave.push({
        kind,
        riderId,
        rentalId: targetRentalId === undefined ? null : targetRentalId,
        ...normalized,
      });
    };

    enqueueDocument("rider_photo", documents.riderPhoto);
    enqueueDocument("government_id", documents.governmentId);
    enqueueDocument("rider_signature", documents.riderSignature);
    preRide.forEach((p) => enqueueDocument("pre_ride_photo", p, rentalId));

    for (const doc of docsToSave) {
      if (doc.url && doc.file_name && doc.mime_type) {
        await client.query(
          `insert into public.documents (rider_id, rental_id, kind, file_name, mime_type, size_bytes, url)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            doc.riderId || null,
            doc.rentalId || null,
            doc.kind,
            doc.file_name,
            doc.mime_type,
            doc.size_bytes || null,
            doc.url,
          ]
        );
        continue;
      }

      if (!doc.dataUrl) continue;

      const saved = await saveDataUrlToUploads({
        dataUrl: doc.dataUrl,
        fileNameHint: doc.fileNameHint || `${doc.kind}.jpg`,
      });

      await client.query(
        `insert into public.documents (rider_id, rental_id, kind, file_name, mime_type, size_bytes, url)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          doc.riderId || null,
          doc.rentalId || null,
          doc.kind,
          saved.file_name,
          saved.mime_type,
          saved.size_bytes,
          saved.url,
        ]
      );
    }

    await client.query("commit");
    res.status(201).json({ riderId, rentalId, riderCode });
  } catch (error) {
    await client.query("rollback");
    res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

// ------------------------------
// Analytics APIs (replace Supabase views/channels)
// ------------------------------

app.get("/api/analytics/summary", async (_req, res) => {
  try {
    const [totalQ, activeQ, suspendedQ, ridesQ, zonesQ] = await Promise.all([
      pool.query(`select count(*)::int as count from public.riders`),
      pool.query(`select count(*)::int as count from public.riders where status = 'active'`),
      pool.query(`select count(*)::int as count from public.riders where status = 'suspended'`),
      pool.query(`select count(*)::int as count from public.rentals`),
      pool.query(
        `select coalesce(meta->>'zone','') as zone_raw, count(*)::int as value
         from public.rentals
         group by 1`
      ),
    ]);

    const grouped = {};
    (zonesQ.rows || []).forEach((r) => {
      const z = normalizeZone(r.zone_raw);
      if (!z) return;
      grouped[z] = (grouped[z] || 0) + Number(r.value || 0);
    });

    const zoneStats = Object.entries(grouped).map(([zone, value]) => ({ zone, value }));

    res.json({
      totalRiders: totalQ.rows?.[0]?.count || 0,
      activeRiders: activeQ.rows?.[0]?.count || 0,
      suspendedRiders: suspendedQ.rows?.[0]?.count || 0,
      totalRides: ridesQ.rows?.[0]?.count || 0,
      zoneStats,
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/analytics/daily-riders", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 14)));
  const zone = String(req.query.zone || "").trim();
  const date = req.query.date ? String(req.query.date).slice(0, 10) : "";

  try {
    const params = [days];
    const where = [`start_time >= (date_trunc('day', now()) - ($1::int - 1) * interval '1 day')`];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (date) {
      where.push(`start_time >= ${push(`${date}T00:00:00Z`)}::timestamptz`);
      where.push(`start_time < ${push(`${date}T00:00:00Z`)}::timestamptz + interval '1 day'`);
    }

    if (zone) {
      // Zone stored in rentals.meta.zone
      where.push(`coalesce(meta->>'zone','') ilike ${push(`%${zone}%`)}`);
    }

    const { rows } = await pool.query(
      `select to_char(date_trunc('day', start_time), 'Mon DD') as day,
              to_char(date_trunc('day', start_time), 'YYYY-MM-DD') as date,
              count(*)::int as total
       from public.rentals
       where ${where.join(" and ")}
       group by 1,2, date_trunc('day', start_time)
       order by date_trunc('day', start_time) asc`,
      params
    );

    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/analytics/daily-earnings", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 14)));
  const date = req.query.date ? String(req.query.date).slice(0, 10) : "";

  try {
    const params = [days];
    const where = [`start_time >= (date_trunc('day', now()) - ($1::int - 1) * interval '1 day')`];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (date) {
      where.push(`start_time >= ${push(`${date}T00:00:00Z`)}::timestamptz`);
      where.push(`start_time < ${push(`${date}T00:00:00Z`)}::timestamptz + interval '1 day'`);
    }

    const { rows } = await pool.query(
      `select to_char(date_trunc('day', start_time), 'YYYY-MM-DD') as date,
              coalesce(sum(rental_amount),0)::numeric as amount
       from public.rentals
       where ${where.join(" and ")}
       group by 1, date_trunc('day', start_time)
       order by date_trunc('day', start_time) asc`,
      params
    );

    res.json((rows || []).map((r) => ({ date: r.date, amount: Number(r.amount || 0) })));
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/analytics/zone-distribution", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select coalesce(meta->>'zone','') as zone_raw, count(*)::int as value
       from public.rentals
       group by 1`
    );

    const grouped = {};
    (rows || []).forEach((r) => {
      const z = normalizeZone(r.zone_raw);
      if (!z) return;
      grouped[z] = (grouped[z] || 0) + Number(r.value || 0);
    });
    res.json(Object.entries(grouped).map(([zone, value]) => ({ zone, value })));
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/analytics/active-zone-counts", async (_req, res) => {
  const ZONES = ["Gotri", "Manjalpur", "Karelibaug", "Daman", "Aatapi"];
  const next = Object.fromEntries(ZONES.map((z) => [z, 0]));

  try {
    const { rows } = await pool.query(
      `select coalesce(meta->>'zone','') as zone_raw, count(*)::int as value
       from public.rentals
       where not exists (select 1 from public.returns ret where ret.rental_id = public.rentals.id)
       group by 1`
    );

    (rows || []).forEach((r) => {
      const z = normalizeZone(r.zone_raw);
      if (!z) return;
      next[z] = (next[z] || 0) + Number(r.value || 0);
    });

    res.json({ counts: next, zones: ZONES });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Return vehicle: close rental + create returns row + upload return photos
// Return Vehicle Endpoint
// Handles vehicle return submission with payment verification for overdue charges
// Blocks return submission if overdue charges exist and payment is not verified
app.post("/api/returns/submit", upload.array("photos", 10), async (req, res) => {
  const rentalId = String(req.body.rentalId || "");
  const conditionNotes = String(req.body.conditionNotes || "").trim();
  const feedback = String(req.body.feedback || "").trim();
  const overdueCharge = Number(req.body.overdueCharge || req.body.overdue_charge || 0);
  const extraPayment = Number(req.body.extraPayment || req.body.extra_payment || 0);
  const totalDueAmount = overdueCharge + extraPayment;

  if (!rentalId) return res.status(400).json({ error: "rentalId required" });
  if (!conditionNotes) return res.status(400).json({ error: "conditionNotes required" });

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    return res.status(400).json({ error: "At least 1 return photo is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const nowIso = new Date().toISOString();

    const rentalQ = await client.query(`select id, rider_id, deposit_amount from public.rentals where id = $1`, [
      rentalId,
    ]);
    const rentalRow = rentalQ.rows?.[0] || null;
    if (!rentalRow) {
      await client.query("rollback");
      return res.status(404).json({ error: "Rental not found" });
    }
    const riderId = rentalRow.rider_id;
    const depositAmount = Number(rentalRow.deposit_amount ?? 0);

    // Payment verification for return rider - check if overdue/extra charges are paid
    // Only verify payment if there are charges due
    if (totalDueAmount > 0) {
      const returnMeta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
      const merchantTranId = returnMeta.iciciMerchantTranId || returnMeta.merchantTranId || null;
      const iciciEnabled = String(process.env.VITE_ICICI_ENABLED || "false").toLowerCase() === "true";

      if (iciciEnabled && merchantTranId) {
        try {
          const { rows } = await pool.query(
            `select status, amount, transaction_type
             from public.payment_transactions
             where merchant_tran_id = $1
               and transaction_type = 'RETURN_RIDER'
             limit 1`,
            [merchantTranId]
          );

          if (!rows || rows.length === 0) {
            await client.query("rollback");
            return res.status(402).json({
              error: "Payment transaction not found for overdue charges. Please complete payment before returning vehicle.",
              paymentRequired: true,
            });
          }

          const paymentTxn = rows[0];
          if (paymentTxn.status !== "SUCCESS") {
            await client.query("rollback");
            return res.status(402).json({
              error: `Payment not completed for overdue charges. Current status: ${paymentTxn.status}. Please complete payment before returning vehicle.`,
              paymentRequired: true,
              paymentStatus: paymentTxn.status,
            });
          }

          // Verify payment amount matches total due amount
          if (paymentTxn.amount !== totalDueAmount) {
            await client.query("rollback");
            return res.status(402).json({
              error: `Payment amount mismatch. Expected ₹${totalDueAmount}, but payment is ₹${paymentTxn.amount}.`,
              paymentRequired: true,
            });
          }
        } catch (error) {
          await client.query("rollback");
          console.error("Payment verification error during return submission", String(error?.message || error));
          return res.status(500).json({
            error: "Payment verification failed. Please try again or contact support.",
          });
        }
      } else if (iciciEnabled && !merchantTranId) {
        // Payment required but merchant transaction ID not provided
        await client.query("rollback");
        return res.status(402).json({
          error: `Payment required for overdue charges (₹${totalDueAmount}). Please complete payment before returning vehicle.`,
          paymentRequired: true,
          amountDue: totalDueAmount,
        });
      }
    }

    await client.query(`update public.rentals set end_time = $1 where id = $2`, [nowIso, rentalId]);
    const ret = await client.query(
      `insert into public.returns (rental_id, returned_at, condition_notes)
       values ($1,$2,$3)
       returning id`,
      [rentalId, nowIso, conditionNotes]
    );
    const returnId = ret.rows?.[0]?.id;

    if (returnId && feedback) {
      await client.query(
        `update public.returns
         set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('feedback', $1::text)
         where id = $2`,
        [feedback, returnId]
      );
    }

    // Deposit refund: when return is recorded, mark deposit as returned to rider.
    // We store this as metadata to avoid schema changes.
    if (depositAmount > 0 && returnId) {
      await client.query(
        `update public.rentals
         set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object(
           'deposit_returned', true,
           'deposit_returned_amount', $1::numeric,
           'deposit_returned_at', $2::text
         )
         where id = $3`,
        [depositAmount, nowIso, rentalId]
      );

      await client.query(
        `update public.returns
         set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object(
           'deposit_returned', true,
           'deposit_returned_amount', $1::numeric,
           'deposit_returned_at', $2::text
         )
         where id = $3`,
        [depositAmount, nowIso, returnId]
      );
    }

    for (const f of files) {
      await client.query(
        `insert into public.documents (rider_id, rental_id, return_id, kind, file_name, mime_type, size_bytes, url)
         values ($1,$2,$3,'return_photo',$4,$5,$6,$7)`,
        [riderId, rentalId, returnId, f.filename, f.mimetype, f.size, `/uploads/${f.filename}`]
      );
    }

    await client.query("commit");
    res.status(201).json({ returnId, depositReturnedAmount: depositAmount > 0 ? depositAmount : 0 });
  } catch (error) {
    await client.query("rollback");
    res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

app.get("/api/rentals/active", async (req, res) => {
  const mobile = toDigits(req.query.mobile || "", 10);
  const vehicle = String(req.query.vehicle || "").trim();
  const riderName = String(req.query.name || "").trim();
  const battery = String(req.query.battery || req.query.batteryId || "").trim();

  try {
    const params = [];
    const where = [
      `not exists (select 1 from public.returns ret where ret.rental_id = r.id)`,
    ];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (vehicle) {
      const vehicleNorm = vehicle.replace(/[^a-z0-9]+/gi, "").toLowerCase();
      where.push(
        `regexp_replace(lower(coalesce(vehicle_number,'')),'[^a-z0-9]+','','g') = ${push(vehicleNorm)}`
      );
    }

    if (battery) {
      const batteryNorm = battery.replace(/[^a-z0-9]+/gi, "").toLowerCase();
      where.push(
        `regexp_replace(lower(coalesce(
                (
                  select s.battery_in
                  from public.battery_swaps s
                  where regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g') =
                        regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g')
                    and s.swapped_at >= r.start_time
                  order by s.swapped_at desc, s.created_at desc
                  limit 1
                ),
                r.battery_id
              )),'[^a-z0-9]+','','g') = ${push(batteryNorm)}`
      );
    }
    if (riderName) {
      const namePattern = `%${riderName.toLowerCase()}%`;
      where.push(`lower(coalesce(rd.full_name,'')) like ${push(namePattern)}`);
    }
    if (mobile) {
      where.push(
        `rider_id in (
          select id from public.riders
          where regexp_replace(coalesce(mobile,''),'\\D','','g') = ${push(mobile)}
        )`
      );
    }

    const { rows } = await pool.query(
      `select r.*,
              rd.full_name as rider_full_name,
              rd.mobile as rider_mobile,
              coalesce(r.meta->>'expected_end_time','') as expected_end_time,
              coalesce(r.meta->>'deposit_returned','false')::boolean as deposit_returned,
              coalesce(r.meta->>'deposit_returned_amount','0')::numeric as deposit_returned_amount,
              coalesce(r.meta->>'deposit_returned_at','') as deposit_returned_at,
              coalesce(
                (
                  select s.battery_in
                  from public.battery_swaps s
                  where regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g') =
                        regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g')
                    and s.swapped_at >= r.start_time
                  order by s.swapped_at desc, s.created_at desc
                  limit 1
                ),
                r.battery_id
              ) as current_battery_id
       from public.rentals r
       left join public.riders rd on rd.id = r.rider_id
       where ${where.join(" and ")}
       order by r.start_time desc
       limit 1`,
      params
    );

    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/summary", async (_req, res) => {
  try {
    const [ridersQ, rentalsQ, activeQ, revenueQ] = await Promise.all([
      pool.query(`select count(*)::int as count from public.riders`),
      pool.query(`select count(*)::int as count from public.rentals`),
      pool.query(
        `select count(*)::int as count
         from public.rentals r
         where not exists (select 1 from public.returns ret where ret.rental_id = r.id)`
      ),
      pool.query(`select coalesce(sum(rental_amount),0)::numeric as total from public.rentals`),
    ]);

    res.json({
      totalRiders: ridersQ.rows?.[0]?.count || 0,
      totalRentals: rentalsQ.rows?.[0]?.count || 0,
      activeRides: activeQ.rows?.[0]?.count || 0,
      revenue: Number(revenueQ.rows?.[0]?.total || 0),
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/recent-riders", async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit || 3)));
  try {
    const { rows } = await pool.query(
      `select full_name, mobile from public.riders order by created_at desc limit $1`,
      [limit]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/active-rentals", async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 5)));
  try {
    const { rows } = await pool.query(
      `select r.id, r.start_time, r.vehicle_number, r.rider_id, rd.full_name
       from public.rentals r
       left join public.riders rd on rd.id = r.rider_id
       where not exists (select 1 from public.returns ret where ret.rental_id = r.id)
       order by r.start_time desc
       limit $1`,
      [limit]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});


// New: Multi-metric dashboard analytics (revenue, rentals, deposit, cash/upi split)
app.get("/api/dashboard/analytics-months", async (req, res) => {
  const months = Math.min(12, Math.max(1, Number(req.query.months || 6)));
  try {
    const { rows } = await pool.query(
      `select
        to_char(date_trunc('month', start_time), 'Mon') as month,
        to_char(date_trunc('month', start_time), 'YYYY-MM') as month_id,
        count(*)::int as rentals,
        coalesce(sum(rental_amount),0)::numeric as revenue,
        coalesce(sum(deposit_amount),0)::numeric as deposit,
        coalesce(sum(case when lower(payment_mode) = 'cash' then rental_amount else 0 end),0)::numeric as cash,
        coalesce(sum(case when lower(payment_mode) = 'upi' then rental_amount else 0 end),0)::numeric as upi
      from public.rentals
      where start_time >= (date_trunc('month', now()) - ($1::int - 1) * interval '1 month')
      group by 1,2, date_trunc('month', start_time)
      order by date_trunc('month', start_time) asc`,
      [months]
    );
    res.json(
      (rows || []).map((r) => ({
        month: r.month,
        month_id: r.month_id,
        rentals: Number(r.rentals || 0),
        revenue: Number(r.revenue || 0),
        deposit: Number(r.deposit || 0),
        cash: Number(r.cash || 0),
        upi: Number(r.upi || 0),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/rentals-week", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select to_char(start_time, 'Dy') as day,
              count(*)::int as rentals
       from public.rentals
       where start_time >= (now() - interval '6 days')
       group by 1
       order by min(start_time) asc`
    );
    res.json(
      (rows || []).map((r) => ({ day: String(r.day || "").trim(), rentals: r.rentals }))
    );
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/returns-week", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select to_char(returned_at, 'Dy') as day,
              count(*)::int as returns
       from public.returns
       where returned_at >= (now() - interval '6 days')
       group by 1
       order by min(returned_at) asc`
    );
    res.json(
      (rows || []).map((r) => ({ day: String(r.day || "").trim(), returns: r.returns }))
    );
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/rentals-by-package", async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
  try {
    const { rows } = await pool.query(
      `select coalesce(nullif(trim(rental_package),''),'unknown') as package,
              count(*)::int as rentals
       from public.rentals
       where start_time >= (now() - ($1::int - 1) * interval '1 day')
       group by 1
       order by rentals desc`,
      [days]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/dashboard/rentals-by-zone", async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
  try {
    const { rows } = await pool.query(
      `select coalesce(meta->>'zone','') as zone_raw,
              count(*)::int as rentals
       from public.rentals
       where start_time >= (now() - ($1::int - 1) * interval '1 day')
       group by 1`,
      [days]
    );

    const grouped = {};
    (rows || []).forEach((r) => {
      const z = normalizeZone(r.zone_raw);
      if (!z) return;
      grouped[z] = (grouped[z] || 0) + Number(r.rentals || 0);
    });

    const out = Object.entries(grouped)
      .map(([zone, rentals]) => ({ zone, rentals }))
      .sort((a, b) => b.rentals - a.rentals);

    res.json(out);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Admin - Firebase Auth Users
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
  const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

  try {
    const list = await admin.auth().listUsers(limit, pageToken);
    const users = (list.users || []).map((u) => ({
      uid: u.uid,
      email: u.email || null,
      displayName: u.displayName || null,
      disabled: Boolean(u.disabled),
      role: u.customClaims?.role || "employee",
      creationTime: u.metadata?.creationTime || null,
      lastSignInTime: u.metadata?.lastSignInTime || null,
    }));

    res.json({ users, nextPageToken: list.pageToken || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const displayNameRaw = body.displayName !== undefined ? String(body.displayName).trim() : "";
  const displayName = displayNameRaw ? displayNameRaw : undefined;
  const role = body.role === "admin" ? "admin" : "employee";

  if (!email) return res.status(400).json({ error: "email required" });
  if (!password) return res.status(400).json({ error: "password required" });

  try {
    const created = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || undefined,
    });

    await admin.auth().setCustomUserClaims(created.uid, { role });

    res.status(201).json({
      uid: created.uid,
      email: created.email || null,
      displayName: created.displayName || null,
      disabled: Boolean(created.disabled),
      role,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/admin/users/:uid", requireAdmin, async (req, res) => {
  const uid = String(req.params.uid || "").trim();
  if (!uid) return res.status(400).json({ error: "uid required" });

  const body = req.body || {};
  const update = {};
  if (body.email !== undefined) {
    const nextEmail = String(body.email || "").trim();
    if (!nextEmail) return res.status(400).json({ error: "email cannot be empty" });
    update.email = nextEmail;
  }
  if (body.displayName !== undefined) {
    const nextName = String(body.displayName || "").trim();
    if (!nextName) return res.status(400).json({ error: "displayName cannot be empty" });
    update.displayName = nextName;
  }
  if (body.disabled !== undefined) update.disabled = Boolean(body.disabled);
  if (body.password) update.password = String(body.password);

  const hasUpdate = Object.keys(update).length > 0;
  const role = body.role ? (body.role === "admin" ? "admin" : "employee") : null;

  try {
    if (hasUpdate) await admin.auth().updateUser(uid, update);

    if (role) {
      await admin.auth().setCustomUserClaims(uid, { role });
    }

    const refreshed = await admin.auth().getUser(uid);
    res.json({
      uid: refreshed.uid,
      email: refreshed.email || null,
      displayName: refreshed.displayName || null,
      disabled: Boolean(refreshed.disabled),
      role: refreshed.customClaims?.role || "employee",
      creationTime: refreshed.metadata?.creationTime || null,
      lastSignInTime: refreshed.metadata?.lastSignInTime || null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/admin/users/:uid", requireAdmin, async (req, res) => {
  const uid = String(req.params.uid || "").trim();
  if (!uid) return res.status(400).json({ error: "uid required" });

  const requesterUid = String(req.user?.uid || req.user?.user_id || req.user?.sub || "").trim();
  if (requesterUid && requesterUid === uid) {
    return res.status(400).json({ error: "You cannot delete your own user." });
  }

  try {
    await admin.auth().deleteUser(uid);
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Drafts
app.get("/api/drafts", async (req, res) => {
  const employeeUid = req.query.employeeUid ? String(req.query.employeeUid).trim() : null;

  try {
    const { rows } = await pool.query(
      `select id, created_at, updated_at, employee_uid, employee_email, name, phone, step_label, step_path, meta
       from public.rider_drafts
       ${employeeUid ? 'where employee_uid = $1' : ''}
       order by updated_at desc`,
      employeeUid ? [employeeUid] : []
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/drafts/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const { rows } = await pool.query(
      `select *
       from public.rider_drafts
       where id = $1
       limit 1`,
      [id]
    );

    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/drafts", async (req, res) => {
  const body = req.body || {};

  if (!body.employee_uid) {
    return res.status(400).json({ error: "employee_uid required" });
  }

  try {
    const { rows } = await pool.query(
      `insert into public.rider_drafts
       (employee_uid, employee_email, name, phone, step_label, step_path, meta, data)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
       returning *`,
      [
        body.employee_uid,
        body.employee_email || null,
        body.name || null,
        body.phone || null,
        body.step_label || null,
        body.step_path || "step-1",
        JSON.stringify(body.meta || {}),
        JSON.stringify(body.data || {}),
      ]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.patch("/api/drafts/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};

  try {
    const { rows } = await pool.query(
      `update public.rider_drafts
       set employee_uid = coalesce($1::text, employee_uid),
         employee_email = coalesce($2::text, employee_email),
         name = coalesce($3::text, name),
         phone = coalesce($4::text, phone),
         step_label = coalesce($5::text, step_label),
         step_path = coalesce($6::text, step_path),
           meta = coalesce($7::jsonb, meta),
           data = coalesce($8::jsonb, data)
       where id = $9
       returning *`,
      [
        body.employee_uid ?? null,
        body.employee_email ?? null,
        body.name ?? null,
        body.phone ?? null,
        body.step_label ?? null,
        body.step_path ?? null,
        body.meta ? JSON.stringify(body.meta) : null,
        body.data ? JSON.stringify(body.data) : null,
        id,
      ]
    );

    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.delete("/api/drafts/:id", async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query(`delete from public.rider_drafts where id = $1`, [id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Battery Swaps
app.get("/api/battery-swaps", async (req, res) => {
  const employeeUid = req.query.employeeUid ? String(req.query.employeeUid).trim() : null;

  const where = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (employeeUid) {
    const param = push(employeeUid);
    where.push(`(s.employee_uid = ${param} or (s.employee_uid = 'system' and rr.rental_employee_uid = ${param}))`);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select s.id, s.created_at, s.swapped_at, s.employee_uid, s.employee_email,
              s.vehicle_number, s.battery_out, s.battery_in, s.notes,
              rr.rental_id, rr.rider_id, rr.rider_full_name, rr.rider_mobile
       from public.battery_swaps s
       left join lateral (
         select r.id as rental_id,
                coalesce(r.meta->>'employee_uid','') as rental_employee_uid,
                rd.id as rider_id,
                rd.full_name as rider_full_name,
                rd.mobile as rider_mobile
         from public.rentals r
         left join public.riders rd on rd.id = r.rider_id
         left join public.returns ret on ret.rental_id = r.id
         where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
               regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g')
           and r.start_time <= s.swapped_at
           and (ret.id is null or ret.returned_at > s.swapped_at)
         order by r.start_time desc
         limit 1
       ) rr on true
       ${whereSql}
       order by s.swapped_at desc
       `,
      params
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Battery Swap Endpoint
// Handles battery swap submission with payment verification
// Blocks battery swap if payment is required and not verified
app.post("/api/battery-swaps", async (req, res) => {
  const body = req.body || {};

  if (!body.employee_uid) return res.status(400).json({ error: "employee_uid required" });
  if (!body.vehicle_number) return res.status(400).json({ error: "vehicle_number required" });
  if (!body.battery_out) return res.status(400).json({ error: "battery_out required" });
  if (!body.battery_in) return res.status(400).json({ error: "battery_in required" });

  // Payment verification for battery swap
  // Check if payment is required and verified before allowing battery swap
  const swapAmount = Number(body.swap_amount || body.swapAmount || 0);
  const swapMeta = body.meta && typeof body.meta === "object" ? body.meta : {};
  const merchantTranId = swapMeta.iciciMerchantTranId || swapMeta.merchantTranId || null;
  const iciciEnabled = String(process.env.VITE_ICICI_ENABLED || "false").toLowerCase() === "true";

  if (iciciEnabled && swapAmount > 0 && merchantTranId) {
    try {
      const { rows } = await pool.query(
        `select status, amount, transaction_type, battery_swap_id
         from public.payment_transactions
         where merchant_tran_id = $1
           and transaction_type = 'BATTERY_SWAP'
         limit 1`,
        [merchantTranId]
      );

      if (!rows || rows.length === 0) {
        return res.status(402).json({
          error: "Payment transaction not found for battery swap. Please complete payment before swapping battery.",
          paymentRequired: true,
        });
      }

      const paymentTxn = rows[0];
      if (paymentTxn.status !== "SUCCESS") {
        return res.status(402).json({
          error: `Payment not completed for battery swap. Current status: ${paymentTxn.status}. Please complete payment before swapping battery.`,
          paymentRequired: true,
          paymentStatus: paymentTxn.status,
        });
      }

      // Verify payment amount matches swap amount
      if (paymentTxn.amount !== swapAmount) {
        return res.status(402).json({
          error: `Payment amount mismatch. Expected ₹${swapAmount}, but payment is ₹${paymentTxn.amount}.`,
          paymentRequired: true,
        });
      }
    } catch (error) {
      console.error("Payment verification error during battery swap", String(error?.message || error));
      return res.status(500).json({
        error: "Payment verification failed. Please try again or contact support.",
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows } = await client.query(
      `insert into public.battery_swaps
       (employee_uid, employee_email, vehicle_number, battery_out, battery_in, swapped_at, notes)
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7)
       returning *`,
      [
        body.employee_uid,
        body.employee_email || null,
        String(body.vehicle_number).trim(),
        String(body.battery_out).trim(),
        String(body.battery_in).trim(),
        body.swapped_at || null,
        body.notes || null,
      ]
    );

    const batterySwapId = rows[0]?.id || null;

    // Link payment transaction to battery swap if payment was made
    if (batterySwapId && merchantTranId && iciciEnabled && swapAmount > 0) {
      try {
        await client.query(
          `update public.payment_transactions
           set battery_swap_id = $1,
               updated_at = now()
           where merchant_tran_id = $2
             and transaction_type = 'BATTERY_SWAP'`,
          [batterySwapId, merchantTranId]
        );
      } catch (error) {
        console.warn("Failed to link payment transaction to battery swap", String(error?.message || error));
      }
    }

    await client.query("commit");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("rollback");
    res.status(500).json({ error: String(error?.message || error) });
  } finally {
    client.release();
  }
});

// Usage stats: which battery is used more (based on installs = battery_in count)
app.get("/api/battery-swaps/usage", async (req, res) => {
  const employeeUid = req.query.employeeUid ? String(req.query.employeeUid).trim() : null;
  const params = employeeUid ? [employeeUid] : [];
  const filter = employeeUid ? "where employee_uid = $1" : "";

  try {
    const { rows } = await pool.query(
      `select battery_id,
              sum(installs)::int as installs,
              sum(removals)::int as removals
       from (
         select battery_in as battery_id, count(*)::int as installs, 0::int as removals
         from public.battery_swaps
         ${filter}
         group by battery_in
         union all
        select battery_out as battery_id, 0::int as installs, count(*)::int as removals
        from public.battery_swaps
         ${filter}
         group by battery_out
       ) x
       group by battery_id
       order by (sum(installs)) desc, (sum(removals)) desc`,
      params
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Admin: manage battery swaps (view/edit/delete)
app.get("/api/admin/battery-swaps", requireAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const search = String(req.query.search || "").trim();
  const start = req.query.start ? String(req.query.start) : "";
  const end = req.query.end ? String(req.query.end) : "";

  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (search) {
    const p = push(`%${search}%`);
    where.push(
      `(vehicle_number ilike ${p}
        or battery_out ilike ${p}
        or battery_in ilike ${p}
        or coalesce(employee_email,'') ilike ${p}
        or employee_uid ilike ${p}
        or coalesce(rr.rider_full_name,'') ilike ${p}
        or coalesce(rr.rider_mobile,'') ilike ${p})`
    );
  }
  if (start) where.push(`swapped_at >= ${push(start)}`);
  if (end) where.push(`swapped_at <= ${push(end)}`);

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select s.id, s.created_at, s.swapped_at, s.employee_uid, s.employee_email,
              s.vehicle_number, s.battery_out, s.battery_in, s.notes,
              rr.rental_id, rr.rider_id, rr.rider_full_name, rr.rider_mobile
       from public.battery_swaps s
       left join lateral (
         select r.id as rental_id,
                rd.id as rider_id,
                rd.full_name as rider_full_name,
                rd.mobile as rider_mobile
         from public.rentals r
         left join public.riders rd on rd.id = r.rider_id
         left join public.returns ret on ret.rental_id = r.id
         where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
               regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g')
           and r.start_time <= s.swapped_at
           and (ret.id is null or ret.returned_at > s.swapped_at)
         order by r.start_time desc
         limit 1
       ) rr on true
       ${whereSql}
       order by s.swapped_at desc
       limit ${push(limit)}`,
      params
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.patch("/api/admin/battery-swaps/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id required" });

  const body = req.body || {};
  const fields = {
    vehicle_number: body.vehicle_number,
    battery_out: body.battery_out,
    battery_in: body.battery_in,
    swapped_at: body.swapped_at,
    notes: body.notes,
    employee_email: body.employee_email,
    employee_uid: body.employee_uid,
  };

  const set = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined) return;
    if (k === "swapped_at") {
      set.push(`${k} = ${push(v ? v : null)}::timestamptz`);
      return;
    }
    set.push(`${k} = ${push(v === null ? null : String(v).trim())}`);
  });

  if (set.length === 0) return res.json({ ok: true });
  params.push(id);

  try {
    const { rows } = await pool.query(
      `update public.battery_swaps
       set ${set.join(", ")}
       where id = $${params.length}
       returning *`,
      params
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.delete("/api/admin/battery-swaps/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    await pool.query(`delete from public.battery_swaps where id = $1`, [id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/admin/battery-swaps/bulk-delete", requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids required" });

  try {
    const { rowCount } = await pool.query(
      `delete from public.battery_swaps where id = any($1::uuid[])`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/admin/battery-swaps/daily", requireAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 14)));
  try {
    const { rows } = await pool.query(
      `select to_char(date_trunc('day', swapped_at), 'Mon DD') as day,
              to_char(date_trunc('day', swapped_at), 'YYYY-MM-DD') as date,
              count(*)::int as swaps
       from public.battery_swaps
       where swapped_at >= (date_trunc('day', now()) - ($1::int - 1) * interval '1 day')
       group by 1,2, date_trunc('day', swapped_at)
       order by date_trunc('day', swapped_at) asc`,
      [days]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/admin/battery-swaps/top-batteries", requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
  const limit = Math.min(20, Math.max(1, Number(req.query.limit || 6)));
  try {
    const { rows } = await pool.query(
      `select battery_id,
              sum(installs)::int as installs
       from (
         select battery_in as battery_id, count(*)::int as installs
         from public.battery_swaps
         where swapped_at >= (now() - ($1::int - 1) * interval '1 day')
           and coalesce(nullif(trim(battery_in), ''), null) is not null
         group by battery_in
       ) x
       group by battery_id
       order by installs desc
       limit $2`,
      [days, limit]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Admin: swap frequency per vehicle (with latest battery + matched rider)
app.get("/api/admin/battery-swaps/top-vehicles", requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));

  try {
    const { rows } = await pool.query(
      `with agg as (
         select vehicle_number,
                count(*)::int as swaps,
                max(swapped_at) as last_swapped_at
         from public.battery_swaps
         where swapped_at >= (now() - ($1::int - 1) * interval '1 day')
           and coalesce(nullif(trim(vehicle_number), ''), null) is not null
         group by vehicle_number
       ), latest as (
         select distinct on (vehicle_number)
                vehicle_number,
                swapped_at,
                battery_out,
                battery_in
         from public.battery_swaps
         where swapped_at >= (now() - ($1::int - 1) * interval '1 day')
           and coalesce(nullif(trim(vehicle_number), ''), null) is not null
         order by vehicle_number, swapped_at desc
       )
       select a.vehicle_number,
              a.swaps,
              a.last_swapped_at,
              l.battery_out,
              l.battery_in,
              rr.rental_id,
              rr.rider_id,
              rr.rider_full_name,
              rr.rider_mobile
       from agg a
       join latest l on l.vehicle_number = a.vehicle_number
       left join lateral (
         select r.id as rental_id,
                rd.id as rider_id,
                rd.full_name as rider_full_name,
                rd.mobile as rider_mobile
         from public.rentals r
         left join public.riders rd on rd.id = r.rider_id
         left join public.returns ret on ret.rental_id = r.id
         where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
               regexp_replace(lower(coalesce(a.vehicle_number,'')),'[^a-z0-9]+','','g')
           and r.start_time <= l.swapped_at
           and (ret.id is null or ret.returned_at > l.swapped_at)
         order by r.start_time desc
         limit 1
       ) rr on true
       order by a.swaps desc, a.last_swapped_at desc
       limit $2`,
      [days, limit]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Admin: top riders by battery swap count (identify riders swapping frequently)
app.get("/api/admin/battery-swaps/top-riders", requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));

  try {
    const { rows } = await pool.query(
      `with mapped as (
         select s.id,
                s.swapped_at,
                rr.rider_id,
                rr.rider_full_name,
                rr.rider_mobile
         from public.battery_swaps s
         left join lateral (
           select r.id as rental_id,
                  rd.id as rider_id,
                  rd.full_name as rider_full_name,
                  rd.mobile as rider_mobile
           from public.rentals r
           left join public.riders rd on rd.id = r.rider_id
           left join public.returns ret on ret.rental_id = r.id
           where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
                 regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g')
             and r.start_time <= s.swapped_at
             and (ret.id is null or ret.returned_at > s.swapped_at)
           order by r.start_time desc
           limit 1
         ) rr on true
         where s.swapped_at >= (now() - ($1::int - 1) * interval '1 day')
       )
       select rider_id,
              max(rider_full_name) as rider_full_name,
              max(rider_mobile) as rider_mobile,
              count(*)::int as swaps,
              max(swapped_at) as last_swapped_at
       from mapped
       where rider_id is not null
       group by rider_id
       order by swaps desc, last_swapped_at desc
       limit $2`,
      [days, limit]
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Admin: latest swap per vehicle (treat battery_in as current battery installed)
app.get("/api/admin/battery-swaps/latest-by-vehicle", requireAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 20)));
  const search = String(req.query.search || "").trim();

  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (search) {
    const p = push(`%${search}%`);
    where.push(
      `(vehicle_number ilike ${p}
        or battery_out ilike ${p}
        or battery_in ilike ${p})`
    );
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select s.id, s.created_at, s.swapped_at, s.employee_uid, s.employee_email,
              s.vehicle_number, s.battery_out, s.battery_in, s.notes,
              rr.rental_id, rr.rider_id, rr.rider_full_name, rr.rider_mobile
       from (
         select distinct on (vehicle_number) *
         from public.battery_swaps
         ${whereSql}
         order by vehicle_number, swapped_at desc
       ) s
       left join lateral (
         select r.id as rental_id,
                rd.id as rider_id,
                rd.full_name as rider_full_name,
                rd.mobile as rider_mobile
         from public.rentals r
         left join public.riders rd on rd.id = r.rider_id
         left join public.returns ret on ret.rental_id = r.id
         where regexp_replace(lower(coalesce(r.vehicle_number,'')),'[^a-z0-9]+','','g') =
               regexp_replace(lower(coalesce(s.vehicle_number,'')),'[^a-z0-9]+','','g')
           and r.start_time <= s.swapped_at
           and (ret.id is null or ret.returned_at > s.swapped_at)
         order by r.start_time desc
         limit 1
       ) rr on true
       order by s.swapped_at desc
       limit ${push(limit)}`,
      params
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Payment Dues
app.get("/api/payment-dues", async (req, res) => {
  const employeeUid = req.query.employeeUid ? String(req.query.employeeUid).trim() : null;

  const filters = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (employeeUid) {
    filters.push(`employee_uid = ${push(employeeUid)}`);
  }

  const whereSql = filters.length ? `where ${filters.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select id, created_at, updated_at, employee_uid, employee_email,
              rider_name, rider_phone, amount_due, due_date, status, notes
       from public.payment_dues
       ${whereSql}
       order by (case when due_date is null then 1 else 0 end), due_date asc, updated_at desc
       limit 200`,
      params
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Overdue Rentals (active rentals past expected_end_time)
app.get("/api/rentals/overdue", async (req, res) => {
  const employeeUid = String(req.query.employeeUid || "").trim();

  const where = [
    "not exists (select 1 from public.returns ret where ret.rental_id = r.id)",
    "coalesce(nullif(r.meta->>'expected_end_time',''),'') <> ''",
    // avoid cast errors when expected_end_time is missing/invalid
    "(r.meta->>'expected_end_time') ~ '^\\d{4}-\\d{2}-\\d{2}T'",
    "(r.meta->>'expected_end_time')::timestamptz < now()",
  ];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (employeeUid) {
    where.push(`coalesce(r.meta->>'employee_uid','') = ${push(employeeUid)}`);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select
         r.id as rental_id,
         r.start_time,
         r.total_amount,
         r.payment_mode,
         r.vehicle_number,
         r.bike_id,
         coalesce(r.meta->>'expected_end_time','') as expected_end_time,
         coalesce(r.meta->>'employee_uid','') as employee_uid,
         coalesce(r.meta->>'employee_email','') as employee_email,
         rd.id as rider_id,
         rd.full_name as rider_name,
         rd.mobile as rider_phone
       from public.rentals r
       left join public.riders rd on rd.id = r.rider_id
       ${whereSql}
       order by (r.meta->>'expected_end_time')::timestamptz asc
       limit 200`,
      params
    );
    res.json(rows || []);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/payment-dues/summary", async (req, res) => {
  const employeeUid = req.query.employeeUid ? String(req.query.employeeUid).trim() : null;

  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const filters = ["status = 'due'"];
  if (employeeUid) {
    filters.unshift(`employee_uid = ${push(employeeUid)}`);
  }

  const whereSql = filters.length ? `where ${filters.join(" and ")}` : "";

  try {
    const { rows } = await pool.query(
      `select
         count(*)::int as due_count,
         coalesce(sum(amount_due), 0)::numeric(12,2) as due_total
       from public.payment_dues
       ${whereSql}`,
      params
    );
    res.json(rows[0] || { due_count: 0, due_total: "0.00" });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

async function start() {
  await ensureDbInitialized();

  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const isProduction = nodeEnv === "production";

  const listenOnce = (p) =>
    new Promise((resolve, reject) => {
      const server = app.listen(p, () => resolve({ server, port: p }));
      server.on("error", reject);
    });

  if (isProduction) {
    const result = await listenOnce(port);
    console.log(`API listening on port ${result.port}`);
    return;
  }

  let p = port;
  // Dev convenience: try a few ports in case a dev server is already running.
  for (let i = 0; i < 5; i += 1) {
    try {
      const result = await listenOnce(p);
      console.log(`Local API listening on http://localhost:${result.port}`);
      if (result.port !== port) {
        console.warn(
          `Port ${port} was busy; using ${result.port}. Update VITE_API_URL if your frontend needs a fixed port.`
        );
      }
      return;
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        console.warn(`Port ${p} is in use; trying ${p + 1}...`);
        p += 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Could not bind any port from ${port} to ${port + 4}.`);
}

start().catch((error) => {
  console.error("Failed to start API server:", String(error?.message || error));
  process.exit(1);
});
