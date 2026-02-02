import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import forge from "node-forge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveExistingPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : null;

  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(__dirname, raw),
    path.resolve(__dirname, "..", raw),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
}

function readKeyMaterialFromEnvOrPath({ pemEnv, pathEnv }) {
  const pem = String(process.env[pemEnv] || "").trim();
  if (pem) return pem;

  const p = String(process.env[pathEnv] || "").trim();
  if (!p) return null;

  const resolved = resolveExistingPath(p);
  if (!resolved) {
    throw new Error(`${pathEnv} points to a missing file: ${p}`);
  }

  const buf = fs.readFileSync(resolved);
  // If it looks like PEM, treat as utf8; otherwise keep as Buffer (DER).
  const asText = buf.toString("utf8");
  if (asText.includes("-----BEGIN")) return asText;
  return buf;
}

let cachedPublicKey = null;
let cachedPrivateKey = null;

function getIciciPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;

  const material = readKeyMaterialFromEnvOrPath({
    pemEnv: "ICICI_PUBLIC_KEY_PEM",
    pathEnv: "ICICI_PUBLIC_KEY_PATH",
  });

  if (!material) return null;

  // .cer files are commonly DER or PEM. Let Node auto-detect PEM; use DER/SPKI otherwise.
  const keyObject =
    typeof material === "string"
      ? crypto.createPublicKey(material)
      : crypto.createPublicKey({ key: material, format: "der", type: "spki" });

  cachedPublicKey = keyObject;
  return keyObject;
}

function getClientPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;

  const material = readKeyMaterialFromEnvOrPath({
    pemEnv: "ICICI_CLIENT_PRIVATE_KEY_PEM",
    pathEnv: "ICICI_CLIENT_PRIVATE_KEY_P12_PATH",
  });

  if (!material) return null;

  if (typeof material === "string") {
    cachedPrivateKey = crypto.createPrivateKey({
      key: material,
      format: "pem",
      passphrase: process.env.ICICI_CLIENT_PRIVATE_KEY_PASSPHRASE || undefined,
    });
    return cachedPrivateKey;
  }

  // PKCS#12 (P12) provided as DER buffer.
  cachedPrivateKey = crypto.createPrivateKey({
    key: material,
    format: "der",
    type: "pkcs12",
    passphrase: process.env.ICICI_CLIENT_PRIVATE_KEY_PASSPHRASE || undefined,
  });

  return cachedPrivateKey;
}

function base64Encode(value) {
  return Buffer.isBuffer(value) ? value.toString("base64") : Buffer.from(value).toString("base64");
}

function base64Decode(value) {
  return Buffer.from(String(value || ""), "base64");
}

function looksLikeBase64(text) {
  const s = String(text || "").trim();
  if (!s || s.length < 24) return false;
  // base64 alphabet + optional padding
  return /^[A-Za-z0-9+/=\s]+$/.test(s);
}

function pickAesAlgorithm(sessionKey) {
  const len = sessionKey.length;
  if (len === 16) return "aes-128-cbc";
  if (len === 32) return "aes-256-cbc";
  throw new Error(`Unsupported session key length ${len}. Expected 16 or 32.`);
}

export function encryptIciciPayload(plainObject) {
  const publicKey = getIciciPublicKey();
  if (!publicKey) {
    throw new Error("ICICI public key not configured. Set ICICI_PUBLIC_KEY_PATH or ICICI_PUBLIC_KEY_PEM.");
  }

  const sessionKeyLen = Number(process.env.ICICI_SESSION_KEY_LENGTH || 16);
  const sessionKey = crypto.randomBytes(sessionKeyLen);
  const iv = crypto.randomBytes(16);

  const aesAlgorithm = pickAesAlgorithm(sessionKey);
  const cipher = crypto.createCipheriv(aesAlgorithm, sessionKey, iv);
  const plaintext = JSON.stringify(plainObject ?? {});
  const cipherText = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const encryptedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    sessionKey
  );

  return {
    encryptedKey: base64Encode(encryptedKey),
    iv: base64Encode(iv),
    encryptedData: base64Encode(cipherText),
    oaepHashingAlgorithm: "NONE",
  };
}

// ----------------------------
// ASYMMETRIC (RSA-only) mode
// ----------------------------
// ICICI QR API doc: body is text/plain containing Base64Encode(RSA/ECB/PKCS1Padding(JSON))
export function encryptIciciAsymmetricPayload(plainObject) {
  const publicKey = getIciciPublicKey();
  if (!publicKey) {
    throw new Error("ICICI public key not configured. Set ICICI_PUBLIC_KEY_PATH or ICICI_PUBLIC_KEY_PEM.");
  }

  const plaintext = JSON.stringify(plainObject ?? {});
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(plaintext, "utf8")
  );

  return base64Encode(encrypted);
}

export function decryptIciciAsymmetricPayload(base64CipherText) {
  const privateKey = getClientPrivateKey();
  if (!privateKey) {
    throw new Error(
      "Client private key not configured. Set ICICI_CLIENT_PRIVATE_KEY_P12_PATH (and passphrase) or ICICI_CLIENT_PRIVATE_KEY_PEM."
    );
  }

  // Use node-forge for PKCS1 v1.5 padding (required by ICICI API, removed from Node.js 17+)
  // ICICI API uses RSA/ECB/PKCS1Padding which is PKCS1 v1.5, not OAEP
  let decrypted;
  try {
    // Convert Node.js private key to forge format
    // Try PKCS1 first, then PKCS8 if that fails
    let privateKeyPem;
    try {
      privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" });
    } catch {
      privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
    }
    const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    // Decrypt using forge with PKCS1 v1.5 padding
    const encryptedBuffer = base64Decode(base64CipherText);
    decrypted = Buffer.from(
      forgePrivateKey.decrypt(encryptedBuffer.toString("binary"), "RSAES-PKCS1-V1_5"),
      "binary"
    );
  } catch (forgeError) {
    // Fallback: Try Node.js native (may work in some cases)
    try {
      decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
        },
        base64Decode(base64CipherText)
      );
    } catch (fallbackError) {
      throw new Error(
        `Decryption failed: ${String(forgeError?.message || fallbackError?.message || "Unknown")}`
      );
    }
  }

  const asText = decrypted.toString("utf8").trim();

  // Some environments have been seen returning base64-wrapped JSON (docs are a bit inconsistent).
  if (looksLikeBase64(asText)) {
    try {
      const decoded = base64Decode(asText).toString("utf8").trim();
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch {
      // ignore and fall back
    }
  }

  try {
    return JSON.parse(asText);
  } catch {
    return asText;
  }
}

export function buildIciciEncryptedRequest({ requestId, service, payload }) {
  const encrypted = encryptIciciPayload(payload);
  return {
    requestId: String(requestId || "").trim() || crypto.randomUUID(),
    service: String(service || "").trim() || "",
    encryptedKey: encrypted.encryptedKey,
    oaepHashingAlgorithm: encrypted.oaepHashingAlgorithm,
    iv: encrypted.iv,
    encryptedData: encrypted.encryptedData,
    clientInfo: "",
    optionalParam: "",
  };
}

export function decryptIciciResponse({ encryptedKey, encryptedData, iv }) {
  const privateKey = getClientPrivateKey();
  if (!privateKey) {
    throw new Error(
      "Client private key not configured. Set ICICI_CLIENT_PRIVATE_KEY_P12_PATH (and passphrase) or ICICI_CLIENT_PRIVATE_KEY_PEM."
    );
  }

  // Use node-forge for PKCS1 v1.5 padding (required by ICICI API)
  let sessionKey;
  try {
    // Convert Node.js private key to forge format
    // Try PKCS1 first, then PKCS8 if that fails
    let privateKeyPem;
    try {
      privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" });
    } catch {
      privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
    }
    const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    // Decrypt session key using forge with PKCS1 v1.5 padding
    const encryptedBuffer = base64Decode(encryptedKey);
    sessionKey = Buffer.from(
      forgePrivateKey.decrypt(encryptedBuffer.toString("binary"), "RSAES-PKCS1-V1_5"),
      "binary"
    );
  } catch (forgeError) {
    // Fallback: Try Node.js native
    try {
      sessionKey = crypto.privateDecrypt(
        {
          key: privateKey,
        },
        base64Decode(encryptedKey)
      );
    } catch (fallbackError) {
      throw new Error(
        `Session key decryption failed: ${String(forgeError?.message || fallbackError?.message || "Unknown")}`
      );
    }
  }

  const ivBytes = iv ? base64Decode(iv) : null;
  const encryptedBytes = base64Decode(encryptedData);

  // Some ICICI responses may prepend IV in encryptedData; if iv is not provided use first 16 bytes.
  const actualIv = ivBytes && ivBytes.length === 16 ? ivBytes : encryptedBytes.subarray(0, 16);
  const cipherText = ivBytes && ivBytes.length === 16 ? encryptedBytes : encryptedBytes.subarray(16);

  const aesAlgorithm = pickAesAlgorithm(sessionKey);
  const decipher = crypto.createDecipheriv(aesAlgorithm, sessionKey, actualIv);
  const plainBytes = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  const plainText = plainBytes.toString("utf8");

  try {
    return JSON.parse(plainText);
  } catch {
    return plainText;
  }
}

export function getIciciCryptoStatus() {
  return {
    hasPublicKey: Boolean(getIciciPublicKey()),
    hasPrivateKey: Boolean(getClientPrivateKey()),
    sessionKeyLength: Number(process.env.ICICI_SESSION_KEY_LENGTH || 16),
  };
}
