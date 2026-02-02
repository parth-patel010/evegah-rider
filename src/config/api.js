const API_BASE = String(
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || ""
).replace(/\/+$/, "");

import { auth } from "./firebase";
import { getValidAuthSession } from "../utils/authSession";

export async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(options.headers || {});

  const session = getValidAuthSession();
  if (session) {
    let token = session.token;
    if (auth?.currentUser?.getIdToken) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch {
        // ignore, use stored token
      }
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  // Auto JSON unless caller provided FormData
  const body = options.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isFormData && body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
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
      (data && typeof data === "object" && data.error) ? data.error :
        (typeof data === "string" && data) ? data :
          `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function apiFetchBlob(path, options = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(options.headers || {});

  const session = getValidAuthSession();
  if (session) {
    let token = session.token;
    if (auth?.currentUser?.getIdToken) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch {
        // ignore, use stored token
      }
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    const message =
      (data && typeof data === "object" && data.error) ? data.error :
        (typeof data === "string" && data) ? data :
          `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const blob = await res.blob();
  const contentType = res.headers.get("content-type") || "";
  const contentDisposition = res.headers.get("content-disposition") || "";
  return { blob, contentType, contentDisposition };
}

export function apiUrl(path) {
  const p = String(path || "");
  if (/^(https?:)?\/\//i.test(p) || /^data:/i.test(p) || /^blob:/i.test(p)) return p;
  return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

/** Public config (UPI ID, payee name) from backend .env – no auth required. Cached per load. */
let publicConfigCache = null;
export async function getPublicConfig() {
  if (publicConfigCache) return publicConfigCache;
  try {
    const url = apiUrl("/api/config");
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    publicConfigCache = {
      upiId: data?.upiId ?? null,
      payeeName: data?.payeeName ?? "Evegah",
    };
    return publicConfigCache;
  } catch {
    publicConfigCache = { upiId: null, payeeName: "Evegah" };
    return publicConfigCache;
  }
}
