// HTTP-клієнт до FastAPI. Токен і активний університет підставляються автоматично.
// Терпимо до типових помилок у VITE_API_URL: пробіли, «/» або «/api» у кінці, відсутній https://
function normalizeBase(raw) {
  let url = (raw || "").trim().replace(/^["']|["']$/g, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\/+$/, "").replace(/\/api$/i, "");
}
export const BASE = normalizeBase(import.meta.env.VITE_API_URL);
export const API_ORIGIN = BASE || (typeof location !== "undefined" ? location.origin : "");

let tokenGetter = async () => null;
let universityId = null;
let onUnauthorized = () => {};

export function configureApi({ getToken, onAuthError }) {
  tokenGetter = getToken;
  if (onAuthError) onUnauthorized = onAuthError;
}
export function setActiveUniversity(id) {
  universityId = id;
}
export function getActiveUniversity() {
  return universityId;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function headers(extra = {}) {
  const h = { ...extra };
  const token = await tokenGetter();
  if (token) h.Authorization = `Bearer ${token}`;
  if (universityId) h["X-University-Id"] = universityId;
  return h;
}

async function parseError(res) {
  let msg = `Помилка ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data.detail === "string") msg = data.detail;
    else if (Array.isArray(data.detail)) msg = data.detail.map((d) => d.msg).join("; ");
  } catch {}
  if (res.status === 401) onUnauthorized();
  return new ApiError(res.status, msg);
}

export async function api(path, { method = "GET", body, query, signal } = {}) {
  const qs = query
    ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString()
    : "";
  let res;
  try {
    res = await fetch(`${BASE}/api${path}${qs}`, {
      method,
      signal,
      headers: await headers(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, `Немає з'єднання з сервером ${API_ORIGIN} (перевірте адресу backend і CORS_ORIGINS)`);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return null;
  // Якщо замість API відповів статичний сервер frontend (HTML), VITE_API_URL вказано неправильно
  if (!(res.headers.get("content-type") || "").includes("json")) {
    throw new ApiError(0, `За адресою ${API_ORIGIN}/api відповідає не backend UniPars`);
  }
  return res.json();
}

// Завантаження файлу з прогресом (XHR підтримує upload.onprogress)
export async function uploadFile(path, file, onProgress) {
  const h = await headers();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api${path}`);
    Object.entries(h).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, (data && typeof data.detail === "string" && data.detail) || `Помилка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Немає з'єднання з сервером"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

// Потокова відповідь AI (Server-Sent Events через fetch, щоб передати токен)
export async function streamSSE(path, body, { onEvent, signal }) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    signal,
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const event = part.match(/^event: (.*)$/m)?.[1];
      const data = part.match(/^data: (.*)$/m)?.[1];
      if (event) onEvent(event, data ? JSON.parse(data) : {});
    }
  }
}
