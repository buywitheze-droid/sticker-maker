/**
 * Persistent waifu2x/lanczos upscale worker — Node.js side.
 *
 * Responsibilities:
 *  - Spawn the Python worker once; keep it alive for the process lifetime.
 *  - Queue requests so only one heavy inference runs at a time (CPU bound).
 *  - Cache results by SHA-256(input + scale) — up to MAX_CACHE_ENTRIES.
 *
 * Public API:
 *   upscale(buffer: Buffer, scale: 2|4): Promise<Buffer>
 */

import { spawn, ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Config ──────────────────────────────────────────────────────────────────
const __filename      = fileURLToPath(import.meta.url);
const __dirname       = path.dirname(__filename);
const PYTHON_BIN      = "python3";

// In dev, __dirname is server/ and the script sits next to this file.
// In production the compiled bundle lands in dist/, but the Python file
// is never copied there — so fall back to <project-root>/server/upscale_worker.py.
const WORKER_SCRIPT = (() => {
  const candidates = [
    path.join(__dirname,          "upscale_worker.py"),           // dev
    path.join(process.cwd(), "server", "upscale_worker.py"),      // prod
    path.join(process.cwd(), "dist",   "upscale_worker.py"),      // future: if copied by build
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
})();
const TMP_DIR         = os.tmpdir();
const MAX_CACHE_ENTRIES = 20;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per request (large 4× on CPU)

// ── LRU cache ────────────────────────────────────────────────────────────────
const cache = new Map<string, Buffer>(); // insertion-order LRU

function cacheGet(key: string): Buffer | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    // Move to end (most-recently-used)
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: Buffer): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest (first inserted)
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, val);
}

function cacheKey(buf: Buffer, scale: number): string {
  return crypto.createHash("sha256").update(buf).update(String(scale)).digest("hex");
}

// ── Worker process ───────────────────────────────────────────────────────────
let worker: ChildProcess | null = null;
let workerReady = false;
let workerBackend: "waifu2x" | "lanczos" | "unknown" = "unknown";
let pendingReady: (() => void)[] = [];
let lineBuffer = "";

// In-flight requests: id → { resolve, reject, timer }
const inFlight = new Map<string, {
  resolve: (buf: Buffer) => void;
  reject:  (err: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
  outPath: string;
}>();

// Simple serial queue — one item at a time (CPU-bound model)
type QueueItem = () => Promise<void>;
const queue: QueueItem[] = [];
let running = false;

async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try { await task(); } catch { /* errors propagate via promise */ }
  }
  running = false;
}

// ── Worker lifecycle ─────────────────────────────────────────────────────────
function spawnWorker(): void {
  if (worker) return;
  console.log("[upscale] Spawning Python worker…");

  worker = spawn(PYTHON_BIN, [WORKER_SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  worker.stdout!.setEncoding("utf8");
  worker.stdout!.on("data", (chunk: string) => {
    lineBuffer += chunk;
    let nl: number;
    while ((nl = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, nl).trim();
      lineBuffer = lineBuffer.slice(nl + 1);
      if (!line) continue;
      try {
        handleWorkerMessage(JSON.parse(line));
      } catch (e) {
        console.error("[upscale] Bad JSON from worker:", line);
      }
    }
  });

  worker.stderr!.setEncoding("utf8");
  worker.stderr!.on("data", (d: string) => process.stderr.write("[upscale-py] " + d));

  worker.on("exit", (code) => {
    console.warn(`[upscale] Worker exited (code ${code}) — will restart on next request.`);
    worker = null;
    workerReady = false;
    lineBuffer = "";
    // Reject everything in flight
    for (const [, entry] of inFlight) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Worker process exited unexpectedly"));
    }
    inFlight.clear();
  });
}

function handleWorkerMessage(msg: Record<string, unknown>): void {
  // Ready handshake
  if (msg.ready === true) {
    workerBackend = (msg.backend as "waifu2x" | "lanczos") ?? "unknown";
    workerReady = true;
    console.log(`[upscale] Worker ready — backend: ${workerBackend}`);
    for (const cb of pendingReady) cb();
    pendingReady = [];
    return;
  }

  const id = msg.id as string;
  const entry = inFlight.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  inFlight.delete(id);

  if (msg.error) {
    entry.reject(new Error(String(msg.error)));
  } else {
    try {
      const buf = fs.readFileSync(entry.outPath);
      entry.resolve(buf);
    } catch (e) {
      entry.reject(e as Error);
    } finally {
      try { fs.unlinkSync(entry.outPath); } catch { /* ignore */ }
    }
  }
}

const WORKER_READY_TIMEOUT_MS = 60_000; // 60 s — covers model download on first boot

function waitForReady(): Promise<void> {
  if (workerReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Remove from pendingReady so it doesn't fire later
      const idx = pendingReady.indexOf(done);
      if (idx !== -1) pendingReady.splice(idx, 1);
      reject(new Error("Upscale worker did not become ready within 60 s"));
    }, WORKER_READY_TIMEOUT_MS);

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    pendingReady.push(done);
    spawnWorker();
  });
}

// ── Send a request to the worker ─────────────────────────────────────────────
function sendToWorker(inputBuf: Buffer, scale: 2 | 4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const id       = crypto.randomUUID();
    const inPath   = path.join(TMP_DIR, `upscale_in_${id}.png`);
    const outPath  = path.join(TMP_DIR, `upscale_out_${id}.png`);

    try {
      fs.writeFileSync(inPath, inputBuf);
    } catch (e) {
      reject(e as Error);
      return;
    }

    const timer = setTimeout(() => {
      inFlight.delete(id);
      try { fs.unlinkSync(inPath);  } catch { /* ignore */ }
      try { fs.unlinkSync(outPath); } catch { /* ignore */ }
      reject(new Error(`Upscale timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);

    inFlight.set(id, { resolve, reject, timer, outPath });

    const msg = JSON.stringify({ id, input_path: inPath, output_path: outPath, scale }) + "\n";
    worker!.stdin!.write(msg, (err) => {
      if (err) {
        clearTimeout(timer);
        inFlight.delete(id);
        try { fs.unlinkSync(inPath); } catch { /* ignore */ }
        reject(err);
      } else {
        // Clean up input file once written — the worker reads it synchronously
        setTimeout(() => { try { fs.unlinkSync(inPath); } catch { /* ignore */ } }, 500);
      }
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
export function getWorkerBackend(): string {
  return workerBackend;
}

export function upscale(inputBuf: Buffer, scale: 2 | 4 = 4): Promise<Buffer> {
  const key = cacheKey(inputBuf, scale);
  const cached = cacheGet(key);
  if (cached) {
    console.log("[upscale] Cache hit");
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        // Ensure worker is alive and ready
        if (!worker) spawnWorker();
        await waitForReady();

        const result = await sendToWorker(inputBuf, scale);
        cacheSet(key, result);
        resolve(result);
      } catch (e) {
        reject(e as Error);
      }
    });
    runQueue();
  });
}

// Pre-warm in the application so the first customer request does not pay startup
// cost. Route-level verification imports this module only to exercise raster
// preparation, where a persistent Python worker would otherwise keep the test
// process alive after its HTTP server closes.
if (process.env.ANYNEST_SKIP_UPSCALE_PREWARM !== "1") {
  spawnWorker();
}
