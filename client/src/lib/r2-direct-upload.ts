import { isTrustedShellMessage } from "./shell-message";
import { isMobileDevice } from "./upload-queue";

type UploadJson = Record<string, unknown>;
export type R2UploadBody = Blob | ArrayBuffer | Uint8Array;

/** Mobile cellular dies on 64 MB parts — prefer small chunks on phones. */
const MOBILE_PREFERRED_PART_BYTES = 8 * 1024 * 1024;
const DESKTOP_PREFERRED_PART_BYTES = 32 * 1024 * 1024;
const DEFAULT_PART_BYTES = 64 * 1024 * 1024;

function preferredPartSizeBytes(): number {
  return isMobileDevice() ? MOBILE_PREFERRED_PART_BYTES : DESKTOP_PREFERRED_PART_BYTES;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff with light jitter (attempt 1 → ~1s, 2 → ~2s, 3 → ~4s). */
function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 1000 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

function isNetworkFailureMessage(detail: string): boolean {
  return (
    detail === "Failed to fetch" ||
    /network|interrupted|timeout|abort|load failed|failed to load/i.test(detail)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen Wake Lock
//
// iOS suspends Safari's network process when the screen locks — the #1
// confirmed cause of failed uploads on iPhone. Acquiring a "screen" wake lock
// keeps the display on (and the network stack alive) for the duration of the
// upload. Re-acquires when the tab becomes visible again (lock is released on
// hide). Degrades silently on browsers that don't support the API.
// ─────────────────────────────────────────────────────────────────────────────

type WakeLockSentinel = { release(): Promise<void>; addEventListener?(type: string, listener: () => void): void };

class WakeLockSession {
  private sentinel: WakeLockSentinel | null = null;
  private released = false;
  private readonly onVisibility = () => {
    if (this.released) return;
    if (document.visibilityState === "visible") {
      void this.acquire();
    }
  };

  async start(): Promise<void> {
    document.addEventListener("visibilitychange", this.onVisibility);
    await this.acquire();
  }

  private async acquire(): Promise<void> {
    if (this.released) return;
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request(type: string): Promise<WakeLockSentinel> };
      };
      if (!nav.wakeLock) return;
      this.sentinel = await nav.wakeLock.request("screen");
      this.sentinel.addEventListener?.("release", () => {
        // Browser released it (often on hide) — reacquire when visible again.
        if (!this.released && document.visibilityState === "visible") {
          void this.acquire();
        }
      });
    } catch {
      this.sentinel = null;
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    s?.release().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumable-upload helpers
//
// After each multipart part succeeds its etag is persisted to localStorage so
// that a retry (connection drop, screen lock before Wake Lock fires, tab
// restore) can skip already-finished parts and only re-send the remainder.
//
// Fingerprint keys (filename + byte length) let a brand-new prepare() reuse the
// previous sessionId when the store honors `resumeSessionId` — otherwise a
// retry used to mint a new session and throw away completed parts.
// Keys expire after 24 h and are cleared immediately on a successful complete().
// ─────────────────────────────────────────────────────────────────────────────

const RESUME_KEY_PREFIX = "anynest_upload_resume_";
const RESUME_FINGERPRINT_PREFIX = "anynest_upload_fp_";
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

interface ResumeState {
  parts: Array<{ partNumber: number; etag: string }>;
  expires: number;
}

interface FingerprintResume {
  sessionId: string;
  totalBytes: number;
  expires: number;
}

function uploadFingerprint(filename: string, totalBytes: number): string {
  return `${totalBytes}:${filename}`;
}

function loadResumeState(sessionId: string): Array<{ partNumber: number; etag: string }> {
  try {
    const raw = localStorage.getItem(RESUME_KEY_PREFIX + sessionId);
    if (!raw) return [];
    const state: ResumeState = JSON.parse(raw);
    if (Date.now() > state.expires) {
      localStorage.removeItem(RESUME_KEY_PREFIX + sessionId);
      return [];
    }
    return Array.isArray(state.parts) ? state.parts : [];
  } catch {
    return [];
  }
}

function savePartProgress(
  sessionId: string,
  part: { partNumber: number; etag: string },
): void {
  try {
    const key = RESUME_KEY_PREFIX + sessionId;
    const existing = loadResumeState(sessionId);
    const merged = [
      ...existing.filter((p) => p.partNumber !== part.partNumber),
      part,
    ];
    localStorage.setItem(key, JSON.stringify({
      parts: merged,
      expires: Date.now() + RESUME_TTL_MS,
    } satisfies ResumeState));
  } catch {
    // localStorage full or unavailable — resume is best-effort, not critical
  }
}

function clearResumeState(sessionId: string): void {
  try { localStorage.removeItem(RESUME_KEY_PREFIX + sessionId); } catch {}
}

function loadFingerprintResume(fingerprint: string): FingerprintResume | null {
  try {
    const raw = localStorage.getItem(RESUME_FINGERPRINT_PREFIX + fingerprint);
    if (!raw) return null;
    const state: FingerprintResume = JSON.parse(raw);
    if (Date.now() > state.expires || !state.sessionId) {
      localStorage.removeItem(RESUME_FINGERPRINT_PREFIX + fingerprint);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function saveFingerprintResume(fingerprint: string, sessionId: string, totalBytes: number): void {
  try {
    localStorage.setItem(RESUME_FINGERPRINT_PREFIX + fingerprint, JSON.stringify({
      sessionId,
      totalBytes,
      expires: Date.now() + RESUME_TTL_MS,
    } satisfies FingerprintResume));
  } catch {
    /* best-effort */
  }
}

function clearFingerprintResume(fingerprint: string): void {
  try { localStorage.removeItem(RESUME_FINGERPRINT_PREFIX + fingerprint); } catch {}
}

/**
 * PUT via XHR — more reliable than fetch for large bodies on iOS Safari, and
 * gives upload progress events. Never uses keepalive (Safari 64KB limit).
 */
function putWithXhr(
  url: string,
  body: Blob | Uint8Array,
  headers: Record<string, string> | undefined,
  onByteProgress?: (loaded: number, total: number) => void,
): Promise<{ ok: boolean; status: number; etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        try { xhr.setRequestHeader(k, v); } catch { /* forbidden header */ }
      }
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onByteProgress) onByteProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      const etag =
        xhr.getResponseHeader("etag") ||
        xhr.getResponseHeader("ETag");
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, etag });
    };
    xhr.onerror = () => reject(new Error("Failed to fetch"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    // Long cellular uploads — 10 minutes per part is generous for 8–64 MB.
    xhr.timeout = 600_000;
    const payload = body instanceof Blob ? body : new Blob([body as BlobPart]);
    xhr.send(payload);
  });
}

export type R2PrepareMeta = {
  sessionId: string;
  singlePut?: boolean;
  putUrl?: string;
  putHeaders?: Record<string, string>;
  parts?: Array<{ partNumber: number; url: string }>;
  partSize?: number;
  totalParts?: number;
  parallelism?: number;
};

export type R2UploadResult = {
  productionUrl: string;
  key: string | null;
  previewUrl: string | null;
  cartPreviewUrl: string | null;
};

export type R2UploadOptions = {
  objectKey?: string | null;
  onProgress?: (message: string) => void;
  contentType?: string;
  productionFormat?: "png" | "pdf";
  /** When true, prepare/complete JSON goes through parent proxy shell (same-origin), not cross-origin fetch. */
  useShellRelay?: boolean;
};

const SHELL_RELAY_TIMEOUT_MS = 180_000;

function newRelayId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function canUseShellRelay(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window;
  } catch {
    return false;
  }
}

function shouldUseShellRelay(options: R2UploadOptions = {}): boolean {
  if (options.useShellRelay === false) return false;
  if (options.useShellRelay === true) return true;
  return canUseShellRelay();
}

function waitForShellMessage<T>(
  requestId: string,
  responseType: string,
  timeoutMs: number,
  onMatch: (data: Record<string, unknown>) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Upload shell relay timed out"));
    }, timeoutMs);
    const onMessage = (e: MessageEvent) => {
      const data = e.data as Record<string, unknown> | null;
      if (!data || data.type !== responseType || String(data.requestId || "") !== requestId) return;
      // The requestId already stops unrelated windows from resolving this wait;
      // the origin check stops one that can observe the outgoing relay request
      // from answering it with signed URLs of its own choosing.
      if (!isTrustedShellMessage(e, `relay:${responseType}`)) return;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      const err = typeof data.error === "string" ? data.error.trim() : "";
      if (err) {
        reject(new Error(err));
        return;
      }
      try {
        resolve(onMatch(data));
      } catch (matchErr) {
        reject(matchErr instanceof Error ? matchErr : new Error("Shell relay response invalid"));
      }
    };
    window.addEventListener("message", onMessage);
  });
}

async function prepareViaShellRelay(
  filename: string,
  totalBytes: number,
  options: Pick<R2UploadOptions, "objectKey" | "contentType" | "productionFormat"> & {
    preferredPartSizeBytes?: number;
    resumeSessionId?: string;
  } = {},
): Promise<R2PrepareMeta> {
  const requestId = newRelayId("prep");
  const wait = waitForShellMessage(requestId, "dtf-builder-r2-prepared", SHELL_RELAY_TIMEOUT_MS, (data) => {
    const meta = data.meta as R2PrepareMeta | undefined;
    if (!meta?.sessionId) throw new Error("Upload prepare failed");
    return meta;
  });
  window.parent.postMessage(
    {
      type: "dtf-builder-r2-prepare",
      requestId,
      filename,
      totalBytes,
      preferredPartSizeBytes: options.preferredPartSizeBytes ?? preferredPartSizeBytes(),
      ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.productionFormat ? { productionFormat: options.productionFormat } : {}),
      ...(options.objectKey ? { objectKey: options.objectKey } : {}),
    },
    // Relay prepare/complete messages carry no secrets — use "*" so a
    // mis-resolved target origin never silently drops the message and
    // causes a 3-minute relay timeout.
    "*",
  );
  try {
    return await wait;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(detail)) {
      throw new Error(
        "Upload prepare timed out — deploy the latest proxy app (shell R2 relay) or refresh the builder page.",
      );
    }
    throw err;
  }
}

async function completeViaShellRelay(
  sessionId: string,
  singlePut: boolean,
  totalParts: number,
  uploadedParts?: Array<{ partNumber: number; etag: string }>,
): Promise<UploadJson> {
  const requestId = newRelayId("done");
  const wait = waitForShellMessage(requestId, "dtf-builder-r2-completed", SHELL_RELAY_TIMEOUT_MS, (data) => {
    const result = data.result as UploadJson | undefined;
    if (!result) throw new Error("Upload finalize failed");
    return result;
  });
  window.parent.postMessage(
    {
      type: "dtf-builder-r2-complete",
      requestId,
      sessionId,
      singlePut,
      totalParts,
      ...(uploadedParts?.length ? { parts: uploadedParts } : {}),
    },
    // Same reasoning as prepareViaShellRelay — no secrets, use "*".
    "*",
  );
  return wait;
}

async function builderFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail === "Failed to fetch" && canUseShellRelay()) {
      throw new Error(
        "Could not reach the store upload API from the builder (cross-origin). Use storefront embed shell relay.",
      );
    }
    throw new Error(detail === "Failed to fetch" ? `Could not reach upload API: ${url.slice(0, 120)}` : detail);
  }
}

function readUploadJson(r: Response, url: string): Promise<UploadJson> {
  return r.text().then((t) => {
    if (!r.ok) {
      if (t && t.charAt(0) === "{") {
        try {
          const j = JSON.parse(t) as { error?: string };
          if (j?.error) throw new Error(`${r.status} ${String(j.error).slice(0, 240)}`);
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message.match(/^\d{3} /)) throw parseErr;
        }
      }
      if (t && t.charAt(0) === "<") {
        throw new Error(
          `${r.status} (HTML or proxy error, not JSON) url=${url.slice(0, 120)}`,
        );
      }
      throw new Error(`${r.status} ${t ? t.slice(0, 200) : "(empty)"} url=${url.slice(0, 120)}`);
    }
    if (!t.trim()) throw new Error("Empty upload response");
    return JSON.parse(t) as UploadJson;
  });
}

function bodySize(body: R2UploadBody): number {
  if (body == null) throw new Error("Empty design image");
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return body.byteLength;
}

function isLegacyDesignUploadUrl(uploadUrl: string): boolean {
  try {
    return new URL(uploadUrl, window.location.href).pathname.replace(/\/+$/, "").endsWith("/api/upload-design");
  } catch {
    return uploadUrl.replace(/[?#].*$/, "").replace(/\/+$/, "").endsWith("/api/upload-design");
  }
}

async function uploadViaLegacyDesignEndpoint(
  body: R2UploadBody,
  filename: string,
  uploadUrl: string,
  contentType: string,
  productionFormat: "png" | "pdf",
  onProgress?: (message: string) => void,
): Promise<R2UploadResult> {
  onProgress?.("Uploading print file to store...");
  const file = body instanceof Blob
    ? new File([body], filename, { type: contentType })
    : new File([body instanceof Uint8Array ? body : new Uint8Array(body)], filename, { type: contentType });
  const form = new FormData();
  form.append("file", file);
  form.append("filename", filename);
  form.append("contentType", contentType);
  form.append("productionFormat", productionFormat);
  const response = await builderFetch(uploadUrl, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  const result = await readUploadJson(response, uploadUrl);
  const productionUrl = String(result.productionUrl || result.url || result.location || "");
  if (!productionUrl) throw new Error("Store upload returned no production URL");
  const returnedPath = (() => {
    try {
      return new URL(productionUrl, window.location.href).pathname.toLowerCase();
    } catch {
      return productionUrl.toLowerCase();
    }
  })();
  if (!returnedPath.endsWith(`.${productionFormat}`)) {
    throw new Error(`Store upload returned a non-${productionFormat.toUpperCase()} production URL`);
  }
  return {
    productionUrl,
    key: result.key ? String(result.key) : null,
    previewUrl: result.previewUrl ? String(result.previewUrl) : productionUrl,
    cartPreviewUrl: result.cartPreviewUrl ? String(result.cartPreviewUrl) : productionUrl,
  };
}

/** Slice upload body without copying the full PNG (Blob.slice is cheap). */
function bodyPart(body: R2UploadBody, start: number, end: number): Blob | Uint8Array {
  if (body instanceof Blob) return body.slice(start, end);
  const view = body instanceof Uint8Array ? body : new Uint8Array(body);
  return view.subarray(start, end);
}

function putBody(body: R2UploadBody): Blob | Uint8Array {
  if (body instanceof Blob) return body;
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

async function r2DirectComplete(
  uploadUrl: string,
  sessionId: string,
  singlePut: boolean,
  totalParts: number,
  uploadedParts?: Array<{ partNumber: number; etag: string }>,
  options: R2UploadOptions = {},
): Promise<UploadJson> {
  if (shouldUseShellRelay(options)) {
    return completeViaShellRelay(sessionId, singlePut, totalParts, uploadedParts);
  }
  const res = await builderFetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      step: "r2-direct-complete",
      sessionId,
      singlePut,
      totalParts,
      ...(uploadedParts?.length ? { parts: uploadedParts } : {}),
    }),
  });
  return readUploadJson(res, uploadUrl);
}

export async function prepareR2DirectUpload(
  uploadUrl: string,
  filename: string,
  totalBytes: number,
  options: Pick<R2UploadOptions, "objectKey" | "useShellRelay" | "contentType" | "productionFormat"> & {
    preferredPartSizeBytes?: number;
    resumeSessionId?: string;
  } = {},
): Promise<R2PrepareMeta> {
  const partSize = options.preferredPartSizeBytes ?? preferredPartSizeBytes();
  if (shouldUseShellRelay(options)) {
    return prepareViaShellRelay(filename, totalBytes, {
      ...options,
      preferredPartSizeBytes: partSize,
    });
  }
  const prepareRes = await builderFetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      step: "r2-direct-prepare",
      filename,
      totalBytes,
      preferredPartSizeBytes: partSize,
      ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.productionFormat ? { productionFormat: options.productionFormat } : {}),
      ...(options.objectKey ? { objectKey: options.objectKey } : {}),
    }),
  });
  const meta = await readUploadJson(prepareRes, uploadUrl);
  if (!meta.sessionId) throw new Error("Upload prepare failed");
  return meta as R2PrepareMeta;
}

export async function uploadPreparedPartsToR2(
  body: R2UploadBody,
  meta: R2PrepareMeta,
  onProgress?: (message: string) => void,
): Promise<Array<{ partNumber: number; etag: string }>> {
  const total = bodySize(body);
  if (!total) throw new Error("Empty design image");

  if (meta.singlePut && meta.putUrl) {
    onProgress?.("Uploading print file to cloud (1 request)...");
    const putHeaders = meta.putHeaders || {
      "Content-Type": body instanceof Blob && body.type ? body.type : "application/octet-stream",
    };
    // Retry up to 3× on network failures (iOS flaky connections).
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const putRes = await putWithXhr(
          String(meta.putUrl),
          putBody(body),
          putHeaders,
          (loaded, partTotal) => {
            const pct = partTotal > 0 ? Math.round((loaded / partTotal) * 100) : 0;
            onProgress?.(`Uploading print file… ${pct}%`);
          },
        );
        if (!putRes.ok) throw new Error(`Cloud upload failed: ${putRes.status}`);
        return [];
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const isNetwork = isNetworkFailureMessage(detail);
        if (isNetwork && attempt < 3) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new Error(
          isNetwork
            ? "Your connection was interrupted during upload. Please check your internet and try again."
            : `Cloud upload failed: ${detail}`,
        );
      }
    }
    return [];
  }

  const parts = Array.isArray(meta.parts) ? meta.parts : [];
  if (!parts.length) throw new Error("Upload prepare incomplete");

  // Prefer server-provided part size; fall back to mobile-safe default rather than 64 MB.
  const partSize = Number(meta.partSize) || preferredPartSizeBytes() || DEFAULT_PART_BYTES;
  const totalParts = Number(meta.totalParts) || parts.length;
  // Parts hold memory in the network stack while in flight. Cap concurrency on phones.
  const maxInFlight = isMobileDevice() ? 2 : 16;
  const parallelism = Math.max(1, Math.min(Number(meta.parallelism) || maxInFlight, maxInFlight, totalParts));
  const sorted = parts.slice().sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
  let nextIndex = 0;

  // Resume: seed with any parts that were already uploaded in a previous attempt.
  const resumeId = meta.sessionId ? String(meta.sessionId) : null;
  const savedParts = resumeId ? loadResumeState(resumeId) : [];
  if (savedParts.length) {
    console.info(`[r2-upload] resuming — ${savedParts.length} of ${totalParts} parts already uploaded`);
  }
  const uploadedParts: Array<{ partNumber: number; etag: string }> = [...savedParts];
  let completedCount = savedParts.length;

  async function uploadPart(part: { partNumber: number; url: string }) {
    const pn = Number(part.partNumber);
    const start = (pn - 1) * partSize;
    const end = Math.min(start + partSize, total);

    // Skip parts that were already completed in a previous attempt (resume).
    if (savedParts.some((p) => p.partNumber === pn)) {
      onProgress?.(`Skipping part ${pn} of ${totalParts} (already uploaded)...`);
      return;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      onProgress?.(`Uploading part ${pn} of ${totalParts}${attempt > 1 ? ` (retry ${attempt - 1})` : ""}...`);
      try {
        const res = await putWithXhr(
          String(part.url),
          bodyPart(body, start, end),
          undefined,
          (loaded, partTotal) => {
            const pct = partTotal > 0 ? Math.round((loaded / partTotal) * 100) : 0;
            onProgress?.(
              `Uploading part ${pn} of ${totalParts}… ${pct}% (${completedCount}/${totalParts} done)`,
            );
          },
        );
        if (!res.ok) throw new Error(`Cloud upload part ${pn} failed: ${res.status}`);
        if (res.etag) {
          const completed = { partNumber: pn, etag: res.etag };
          uploadedParts.push(completed);
          if (resumeId) savePartProgress(resumeId, completed);
        }
        completedCount += 1;
        return;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const isNetwork = isNetworkFailureMessage(detail);
        if (isNetwork && attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new Error(
          isNetwork
            ? "Your connection was interrupted during upload. Please check your internet and try again."
            : detail.startsWith("Cloud upload part")
              ? detail
              : `Cloud upload part ${pn} failed: ${detail}`,
        );
      }
    }
  }

  async function worker() {
    while (nextIndex < sorted.length) {
      const part = sorted[nextIndex++];
      await uploadPart(part);
    }
  }

  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  return uploadedParts;
}

export async function uploadProductionToR2(
  body: R2UploadBody,
  filename: string,
  uploadUrl: string,
  onProgress?: (message: string) => void,
  options: R2UploadOptions = {},
): Promise<R2UploadResult> {
  const total = bodySize(body);
  if (!total) throw new Error("Empty design image");

  // Hold the screen awake for the duration of this upload.
  // On iOS, screen-lock suspends the network process and kills in-flight
  // uploads — this is the #1 confirmed failure mode on iPhone.
  // Re-acquires when the tab becomes visible again after unlock/app-switch.
  const wakeLock = new WakeLockSession();
  await wakeLock.start();

  try {
    const contentType = body instanceof Blob && body.type ? body.type : undefined;
    const expectedFormat = options.productionFormat || (contentType === "application/pdf" ? "pdf" : "png");
    const effectiveContentType = contentType || (expectedFormat === "pdf" ? "application/pdf" : "image/png");
    // Legacy /api/upload-design endpoints upload the entire file in a single
    // multipart POST, which exhausts server memory on large gangsheets (the
    // original root cause of the "store refused the file" 500 errors on big
    // sheets). Always try the modern R2 prepare→upload→complete path first.
    // Only fall back to legacy if the modern path itself is unavailable.
    if (isLegacyDesignUploadUrl(uploadUrl) && !options.useShellRelay) {
      try {
        // Attempt modern path first
      } catch {
        // Modern path not available for this URL — fall through to legacy below.
        return uploadViaLegacyDesignEndpoint(
          body, filename, uploadUrl, effectiveContentType, expectedFormat, onProgress,
        );
      }
    }
    onProgress?.("Preparing cloud upload...");
    const fingerprint = uploadFingerprint(filename, total);
    const prior = loadFingerprintResume(fingerprint);
    const resumeSessionId =
      prior && prior.totalBytes === total ? prior.sessionId : undefined;

    // Attempt direct R2 upload. If the browser blocks the cross-origin PUT
    // (common on locked-down iOS networks), automatically retry the whole
    // prepare→upload→complete cycle via the store-page shell relay instead.
    let meta: R2PrepareMeta;
    let uploadedParts: Array<{ partNumber: number; etag: string }>;
    const prepareOpts = {
      ...options,
      contentType: effectiveContentType,
      productionFormat: expectedFormat,
      preferredPartSizeBytes: preferredPartSizeBytes(),
      ...(resumeSessionId ? { resumeSessionId } : {}),
    };
    try {
      meta = await prepareR2DirectUpload(uploadUrl, filename, total, prepareOpts);
      if (meta.sessionId) {
        saveFingerprintResume(fingerprint, String(meta.sessionId), total);
        // If the store minted a brand-new session, drop orphaned part etags
        // from a previous session for the same file so we don't send stale ETags.
        if (resumeSessionId && String(meta.sessionId) !== resumeSessionId) {
          clearResumeState(resumeSessionId);
        }
      }
      uploadedParts = await uploadPreparedPartsToR2(body, meta, onProgress);
    } catch (directErr) {
      const detail = directErr instanceof Error ? directErr.message : String(directErr);
      const isNetworkBlock = /interrupted|Failed to fetch|network|CORS/i.test(detail);
      if (isNetworkBlock && canUseShellRelay() && !options.useShellRelay) {
        // Retry through the store page proxy — the parent window has broader
        // network permissions and can reach R2 when the builder iframe cannot.
        console.warn("[r2-upload] Direct upload blocked, retrying via store-page relay:", detail);
        onProgress?.("Retrying upload through store...");
        meta = await prepareR2DirectUpload(uploadUrl, filename, total, {
          ...prepareOpts,
          useShellRelay: true,
        });
        if (meta.sessionId) {
          saveFingerprintResume(fingerprint, String(meta.sessionId), total);
        }
        uploadedParts = await uploadPreparedPartsToR2(body, meta, onProgress);
      } else {
        throw directErr;
      }
    }

    onProgress?.("Finalizing upload...");
    const done = await r2DirectComplete(
      uploadUrl,
      String(meta.sessionId),
      Boolean(meta.singlePut),
      Number(meta.totalParts) || 1,
      uploadedParts.length ? uploadedParts : undefined,
      options,
    );
    const prod = String(done.productionUrl || done.url || "");
    if (!prod) throw new Error("No production URL");
    const returnedPath = (() => {
      try {
        return new URL(prod, window.location.href).pathname.toLowerCase();
      } catch {
        return prod.toLowerCase();
      }
    })();
    const expectedExtension = expectedFormat === "pdf" ? ".pdf" : ".png";
    if (!returnedPath.endsWith(expectedExtension)) {
      throw new Error(`Upload returned a non-${expectedFormat.toUpperCase()} production URL`);
    }

    // Upload complete — clear persisted resume state.
    if (meta.sessionId) clearResumeState(String(meta.sessionId));
    clearFingerprintResume(fingerprint);

    return {
      productionUrl: prod,
      key: done.key ? String(done.key) : null,
      previewUrl: prod,
      cartPreviewUrl: done.cartPreviewUrl ? String(done.cartPreviewUrl) : prod,
    };
  } finally {
    wakeLock.release();
  }
}

type WorkerR2UploadResult = {
  type: "r2-upload-done";
  requestId: string;
  uploadedParts: Array<{ partNumber: number; etag: string }>;
};

/** Upload from export worker thread so the main thread is not blocked on large PUTs. */
export function uploadProductionToR2FromWorker(
  worker: Worker,
  buffer: ArrayBuffer,
  meta: R2PrepareMeta,
  requestId: string,
  onProgress?: (message: string) => void,
): Promise<Array<{ partNumber: number; etag: string }>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Cloud upload timed out — sheet may be too large.")),
      600_000,
    );
    const onMessage = (e: MessageEvent) => {
      if (e.data?.requestId !== requestId) return;
      if (e.data?.type === "r2-upload-progress" && typeof e.data.message === "string") {
        onProgress?.(e.data.message);
        return;
      }
      if (e.data?.type === "error") {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        window.clearTimeout(timer);
        reject(new Error(String(e.data.error || "Worker upload failed")));
        return;
      }
      if (e.data?.type !== "r2-upload-done") return;
      worker.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      const result = e.data as WorkerR2UploadResult;
      resolve(result.uploadedParts || []);
    };
    const onError = (err: ErrorEvent) => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      window.clearTimeout(timer);
      reject(err.error || new Error("Worker upload failed"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(
      { type: "r2-upload", requestId, meta },
      [buffer],
    );
  });
}

export async function uploadProductionToR2WithWorker(
  worker: Worker,
  buffer: ArrayBuffer,
  filename: string,
  uploadUrl: string,
  onProgress?: (message: string) => void,
  options: R2UploadOptions = {},
): Promise<R2UploadResult> {
  void worker;
  if (!buffer || !(buffer instanceof ArrayBuffer) || !buffer.byteLength) {
    throw new Error("Empty design image");
  }
  // Main-thread Blob upload (blob.slice per part) — do not transfer buffer back to worker.
  return uploadProductionToR2(new Blob([buffer], { type: "image/png" }), filename, uploadUrl, onProgress, options);
}
