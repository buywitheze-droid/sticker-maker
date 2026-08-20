import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import express from "express";
import { upscale, getWorkerBackend } from "./upscale-queue";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { inspectRasterAlpha, type SharpReadOpts } from "./raster-content-bounds";

const execFileAsync = promisify(execFile);

// ── GhostScript discovery (not in PATH on NixOS, lives in /nix/store) ───────
let _gsPath: string | null | undefined = undefined; // undefined = not yet searched

// Known Nix store locations — checked in order before the slow find fallback
const KNOWN_GS_PATHS = [
  "/nix/store/00vaqa30dvhxr9308xldc5hmf3z3m37v-ghostscript-10.04.0/bin/gs",
];

async function findGhostscript(): Promise<string | null> {
  if (_gsPath !== undefined) return _gsPath;
  // 1. Try PATH
  try {
    await execFileAsync("gs", ["--version"]);
    _gsPath = "gs";
    return _gsPath;
  } catch { /* not in PATH */ }
  // 2. Try well-known Nix store paths
  for (const candidate of KNOWN_GS_PATHS) {
    if (fs.existsSync(candidate)) {
      _gsPath = candidate;
      return _gsPath;
    }
  }
  // 3. Walk /nix/store (slow fallback — 10 s cap)
  try {
    const { stdout } = await execFileAsync("find", [
      "/nix/store", "-maxdepth", "3", "-name", "gs", "-type", "f",
      "-path", "*/ghostscript*/bin/gs",
    ], { timeout: 10_000 });
    const found = stdout.trim().split("\n").filter(Boolean)[0];
    if (found) { _gsPath = found; return _gsPath; }
  } catch { /* ignore */ }
  _gsPath = null;
  return null;
}
// Kick off discovery at startup
findGhostscript().catch(() => {});

// ── SVG dimension parser ──────────────────────────────────────────────────────
// Sharp/librsvg renders SVG at "density" DPI using pt (1/72 in) semantics for
// all coordinate values — including px. So a width="900" SVG at density:300
// produces 900×(300/72)=3750 px, not 900 px. The reported inches (px/300)
// would then be wrong for anything not in physical units (in/cm/mm/pt).
//
// Fix: parse the SVG root element's width/height/viewBox and compute inches
// directly from the attribute values, bypassing the pixel count entirely.

/** Parse one SVG length value to inches. Returns null for unresolvable units. */
function parseSvgLengthToInches(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+(?:e[+-]?\d+)?)\s*(in|cm|mm|pt|px|)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n) || n <= 0) return null;
  switch ((m[2] ?? "").toLowerCase()) {
    case "in": return n;
    case "cm": return n / 2.54;
    case "mm": return n / 25.4;
    case "pt": return n / 72;
    case "px": return n / 96;   // CSS spec: 1 CSS px = 1/96 inch
    default:   return n / 96;   // no unit = user units = CSS px
  }
}

/**
 * Extract physical dimensions from an SVG buffer by parsing the root element's
 * width/height attributes and, as a fallback, its viewBox.
 * Returns null if dimensions cannot be determined.
 */
function getSvgDimensions(svgBuffer: Buffer): { widthInches: number; heightInches: number } | null {
  // Only scan the first 8 KB — the root <svg> tag is always at the start
  const src = svgBuffer.slice(0, 8192).toString("utf8");

  // Extract the opening <svg ...> tag (may span multiple lines)
  const svgTagMatch = src.match(/<svg\b([^>]*(?:>[^<]*<(?!\/svg))*?)>/is) ??
                      src.match(/<svg\b([^>]*)/i);
  const attrs = svgTagMatch?.[1] ?? "";

  const wm  = attrs.match(/\bwidth=["']([^"']+)["']/i);
  const hm  = attrs.match(/\bheight=["']([^"']+)["']/i);
  const vbm = attrs.match(/\bviewBox=["']([^"']+)["']/i);

  const w = wm ? parseSvgLengthToInches(wm[1]) : null;
  const h = hm ? parseSvgLengthToInches(hm[1]) : null;

  if (w !== null && h !== null) return { widthInches: w, heightInches: h };

  // Fallback: viewBox user-unit dimensions treated as CSS px (1/96 in)
  if (vbm) {
    const parts = vbm[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.slice(2).every(n => !isNaN(n) && n > 0)) {
      return { widthInches: parts[2] / 96, heightInches: parts[3] / 96 };
    }
  }

  return null; // cannot determine physical size
}

import sgMail from "@sendgrid/mail";

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      // Rejected silently, for the reason spelled out on `rasterUpload` below:
      // cb(error) makes multer v2 abort the multipart stream, which answers with
      // a TCP RST rather than a response and poisons iOS Safari's connection
      // pool. Every route using this instance already handles the flag and
      // returns a 400 saying which type arrived — that handling was unreachable
      // while this threw. The accepted type is unchanged.
      (req as any)._multerRejectedMimetype =
        String(file.mimetype || "").toLowerCase() || file.originalname || "unknown";
      cb(null, false);
    }
  },
});

// Separate multer for the convert-file endpoint — accepts PDF/SVG/EPS + images
const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** Raster import prepare / metadata — PNG, JPEG, WebP up to 100 MB. */
const MAX_PREPARE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_SOURCE_MEGAPIXELS = 150;
const PREPARE_PREVIEW_MAX_EDGE = 4096;
const MAX_INLINE_DECODE_MEGAPIXELS = 40;

/**
 * Limit concurrent raster-prepare jobs to one at a time.
 *
 * libvips/sharp decodes the entire image into memory during analysis. With
 * memoryStorage every byte of the upload PLUS every intermediate pipeline
 * lived in the Node heap simultaneously — on a large gangsheet that pushed the
 * process past the OS memory limit and triggered a SIGKILL (the real cause of
 * the "Prepare failed (500)" reports on iOS). Disk storage means only the
 * sharp pipeline's working set is in RAM, and the semaphore prevents two heavy
 * pipelines from running side-by-side.
 */
const prepareRasterSemaphore = (() => {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      return new Promise((resolve) => {
        const attempt = () => {
          if (active < 1) { active++; resolve(); }
          else queue.push(attempt);
        };
        attempt();
      });
    },
    release() {
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (next) next();
    },
  };
})();

/**
 * Pixel ceiling handed to every `sharp()` construction.
 *
 * libvips defaults to roughly 268 MP when `limitInputPixels` is omitted, which
 * is well above the 150 MP this app actually intends to accept.
 */
const SHARP_PIXEL_LIMIT = Math.ceil(MAX_SOURCE_MEGAPIXELS * 1_000_000);

type RasterFormat = "png" | "jpeg" | "webp" | "heic";

/**
 * Identify a raster container from its leading bytes.
 *
 * The multer filters screen on a client-supplied MIME type or, worse, on the
 * file *name* — neither says anything about the content, so `evil.png` holding
 * SVG markup would otherwise reach `sharp()` and get dispatched to librsvg.
 */
function sniffRasterFormat(buffer: Buffer): RasterFormat | null {
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // HEIC / HEIF: ISOBMFF ftyp box with a heic/heif major brand.
  // Byte layout: [4-byte box size][ftyp][4-byte major brand][…]
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 4, 8) === "ftyp" &&
    /^(heic|heis|heix|hevc|hevx|mif1|msf1|heif)/.test(buffer.toString("latin1", 8, 12))
  ) {
    return "heic";
  }
  return null;
}

class UnsupportedRasterError extends Error {}

/**
 * Confirm a buffer really is one of the accepted raster formats, first from
 * its magic bytes and then from libvips' own verdict, before any pipeline work
 * runs against it.
 */
async function assertAllowedRasterFormat(
  sniffBuf: Buffer,
  filePath: string,
  allowed: readonly RasterFormat[],
): Promise<sharp.Metadata> {
  const sniffed = sniffRasterFormat(sniffBuf);
  if (!sniffed || !allowed.includes(sniffed)) {
    throw new UnsupportedRasterError(
      `Unsupported image format. Only ${allowed.filter(f => f !== "heic").join(", ").toUpperCase()} files are accepted.`,
    );
  }
  const metadata = await sharp(filePath, {
    failOn: "none",
    limitInputPixels: SHARP_PIXEL_LIMIT,
  }).metadata();
  // Sharp reports HEIC/HEIF containers as "heif" regardless of brand.
  const rawFormat = metadata.format as string | undefined;
  const decoded: RasterFormat | undefined =
    rawFormat === "heif" ? "heic" : (rawFormat as RasterFormat | undefined);
  if (!decoded || !allowed.includes(decoded)) {
    const label = (decoded === "heic")
      ? "HEIC/HEIF photos are not supported — please export as JPEG or PNG from your Photos app"
      : `Unsupported image format. Only ${allowed.filter(f => f !== "heic").join(", ").toUpperCase()} files are accepted.`;
    throw new UnsupportedRasterError(label);
  }
  return metadata;
}

const rasterUpload = multer({
  // Disk storage keeps the upload off the Node heap; only the sharp pipeline's
  // working set lives in RAM. The temp file is always deleted in the route's
  // finally block regardless of success or failure.
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `anynest_prepare_${crypto.randomUUID()}`),
  }),
  limits: {
    fileSize: MAX_PREPARE_FILE_BYTES,
    fieldSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Some browsers hand over `application/octet-stream` for a perfectly good
    // PNG, so the extension still has to be tolerated here. It is only a cheap
    // pre-filter: `assertAllowedRasterFormat` is the real gate.
    const declared = String(file.mimetype || "").toLowerCase();
    const ok =
      declared === "image/png" ||
      declared === "image/jpeg" ||
      declared === "image/jpg" ||
      declared === "image/webp" ||
      declared === "image/heic" ||
      declared === "image/heif" ||
      declared === "image/heic-sequence" ||
      declared === "image/heif-sequence" ||
      ((declared === "application/octet-stream" || declared === "") &&
        /\.(png|jpe?g|webp|heic|heif)$/i.test(file.originalname || ""));
    if (ok) {
      cb(null, true);
    } else {
      // IMPORTANT: never call cb(error) here — multer v2 aborts the multipart
      // stream on error, which sends a TCP RST instead of a proper HTTP response
      // and poisons iOS Safari's connection pool (every subsequent fetch() on that
      // connection also fails with "Failed to fetch").  Silently reject the file
      // so multer drains the stream cleanly, then let the route handler return the
      // 400 with a human-readable message.
      (req as any)._multerRejectedMimetype = declared || file.originalname || "unknown";
      cb(null, false);
    }
  },
});

function fitWithinMegapixels(w: number, h: number, maxMP: number, maxEdge: number): number {
  const pixels = Math.max(1, w * h);
  const mpScale = Math.sqrt((maxMP * 1_000_000) / pixels);
  const edgeScale = Math.min(maxEdge / Math.max(w, 1), maxEdge / Math.max(h, 1));
  return Math.min(1, mpScale, edgeScale);
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/downloads", express.static(path.resolve(process.cwd(), "downloads")));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  /**
   * Proxy a public HTTPS image through the server.
   *
   * useRestoreDesignState falls back to this when the direct fetch of a
   * saved layer asset fails (CORS, signed-URL expiry, CDN geo-block).
   * Without this endpoint the fallback always 404s and the layer is silently
   * dropped from the restored design state.
   */
  app.get("/api/fetch-binary", async (req, res) => {
    const urlParam = String(req.query.url || "").trim();
    if (!urlParam.startsWith("https://")) {
      return res.status(400).json({ error: "Only HTTPS URLs are supported" });
    }
    try {
      const upstream = await fetch(urlParam, {
        headers: { "User-Agent": "anynest-builder/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!upstream.ok) return res.status(upstream.status).end();
      const ct = upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "no-store");
      const buf = await upstream.arrayBuffer();
      return res.send(Buffer.from(buf));
    } catch (err) {
      console.warn("[fetch-binary] failed:", err instanceof Error ? err.message : err);
      return res.status(502).json({ error: "Could not fetch remote asset" });
    }
  });

  /**
   * Prepare an oversized raster for import.
   *
   * Returns a downscaled preview PNG only. The client keeps the user's
   * original file as the print source, so nothing here caps print quality and
   * we never ship high-resolution pixels back over the wire. Everything the
   * client needs to line the preview up with the original travels in headers:
   * the content-crop rect (in source pixels), the oriented source size, and
   * whether the source alpha is binary (so halftone-ready art keeps hard
   * edges instead of being resampled soft).
   */
  app.post("/api/prepare-raster-upload", rasterUpload.single("image"), async (req, res) => {
    const tmpPath = (req.file as Express.Multer.File & { path?: string })?.path ?? null;
    try {
      if (!req.file || !tmpPath) {
        // If multer silently rejected the file (unsupported MIME type), say so.
        const rejected = (req as any)._multerRejectedMimetype;
        const error = rejected
          ? `File type "${rejected}" is not supported. Please upload a PNG, JPEG, WebP, or HEIC file.`
          : "No image file provided";
        return res.status(400).json({ error });
      }

      const sharpOpts = {
        failOn: "none" as const,
        sequentialRead: true,
        limitInputPixels: SHARP_PIXEL_LIMIT,
      };

      // Read only the first 16 bytes for magic-byte sniffing — no need to
      // load the entire file into memory just to identify the format.
      const magicBuf = Buffer.allocUnsafe(16);
      const fd = fs.openSync(tmpPath, "r");
      const bytesRead = fs.readSync(fd, magicBuf, 0, 16, 0);
      fs.closeSync(fd);
      const sniffBuf = magicBuf.subarray(0, bytesRead);

      // Wait for a processing slot before doing any heavy pipeline work.
      // This prevents two concurrent 100 MP decodes from exhausting RAM.
      await prepareRasterSemaphore.acquire();
      try {
        const meta = await assertAllowedRasterFormat(sniffBuf, tmpPath, ["png", "jpeg", "webp", "heic"]);
        // `metadata()` reports pre-rotation dimensions; EXIF orientations 5-8
        // swap the axes once `.rotate()` auto-orients the pipeline.
        const swapAxes = (meta.orientation ?? 0) >= 5;
        const srcW = (swapAxes ? meta.height : meta.width) ?? 0;
        const srcH = (swapAxes ? meta.width : meta.height) ?? 0;
        if (!(srcW > 0) || !(srcH > 0)) {
          return res.status(400).json({ error: "Could not read image dimensions" });
        }

        const sourceMegapixels = (srcW * srcH) / 1_000_000;
        if (sourceMegapixels > MAX_SOURCE_MEGAPIXELS) {
          return res.status(400).json({
            error: `Image is ${Math.round(sourceMegapixels)} MP; maximum is ${MAX_SOURCE_MEGAPIXELS} MP`,
          });
        }

        // This one exact alpha scan determines both eligibility and bounds. A
        // PNG that carries alpha but no transparent pixels is treated like a
        // photo, so a deliberate solid border is never trimmed.
        const alpha = meta.hasAlpha
          ? await inspectRasterAlpha(
              tmpPath,
              sharpOpts,
              srcW,
              srcH,
              meta.depth === "ushort" ? "ushort" : "uchar",
            )
          : {
              left: 0,
              top: 0,
              width: srcW,
              height: srcH,
              hasTransparentPixels: false,
              binaryAlpha: false,
            };
        const bounds = alpha;

        const previewScale = fitWithinMegapixels(
          bounds.width,
          bounds.height,
          MAX_INLINE_DECODE_MEGAPIXELS,
          PREPARE_PREVIEW_MAX_EDGE,
        );
        const previewW = Math.max(1, Math.round(bounds.width * previewScale));
        const previewH = Math.max(1, Math.round(bounds.height * previewScale));

        let pipeline = sharp(tmpPath, sharpOpts).rotate();
      if (bounds.width !== srcW || bounds.height !== srcH) {
        pipeline = pipeline.extract({
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        });
      }
      const previewBuf = await pipeline
        .resize(previewW, previewH, {
          fit: "fill",
          // Binary alpha means halftone-ready art: nearest keeps the edges hard
          // instead of introducing a soft fringe the editor would then read as
          // anti-aliased.
          kernel: alpha.binaryAlpha ? "nearest" : "lanczos3",
        })
        .png()
        .toBuffer();

      const exposed = [
        "X-Anynest-Source-Width",
        "X-Anynest-Source-Height",
        "X-Anynest-Crop-X",
        "X-Anynest-Crop-Y",
        "X-Anynest-Crop-Width",
        "X-Anynest-Crop-Height",
        "X-Anynest-Preview-Width",
        "X-Anynest-Preview-Height",
        "X-Anynest-Density",
        "X-Anynest-Source-MP",
        "X-Anynest-Binary-Alpha",
        "X-Anynest-Has-Transparency",
      ];
      res.set({
        "Content-Type": "image/png",
        "X-Anynest-Source-Width": String(srcW),
        "X-Anynest-Source-Height": String(srcH),
        "X-Anynest-Crop-X": String(bounds.left),
        "X-Anynest-Crop-Y": String(bounds.top),
        "X-Anynest-Crop-Width": String(bounds.width),
        "X-Anynest-Crop-Height": String(bounds.height),
        "X-Anynest-Preview-Width": String(previewW),
        "X-Anynest-Preview-Height": String(previewH),
        "X-Anynest-Density": String(meta.density && meta.density > 0 ? meta.density : 72),
        "X-Anynest-Source-MP": String(Math.round(sourceMegapixels * 10) / 10),
        "X-Anynest-Binary-Alpha": alpha.binaryAlpha ? "1" : "0",
        // Measured on the *uncropped* source. The client cannot re-derive this
        // from the preview: cropping to content can remove every transparent
        // pixel, making cut-out artwork look like an opaque photo.
          "X-Anynest-Has-Transparency": alpha.hasTransparentPixels ? "1" : "0",
          "Access-Control-Expose-Headers": exposed.join(", "),
          "Cache-Control": "no-store",
        });
        return res.status(200).send(previewBuf);
      } finally {
        prepareRasterSemaphore.release();
      }
    } catch (error) {
      if (error instanceof UnsupportedRasterError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("[prepare-raster-upload] failed:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      if (/exceeds pixel limit/i.test(message)) {
        return res.status(400).json({
          error: `Image exceeds the ${MAX_SOURCE_MEGAPIXELS} MP limit`,
        });
      }
      return res.status(500).json({
        error: "Failed to prepare image for import",
        details: message,
      });
    } finally {
      // Always remove the temp file — disk storage never self-cleans.
      if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch {} }
    }
  });

  app.post("/api/process-image", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        // If multer silently rejected the file (unsupported MIME type), say so.
        const rejected = (req as any)._multerRejectedMimetype;
        const error = rejected
          ? `File type "${rejected}" is not supported. Please upload a PNG, JPEG, WebP, or HEIC file.`
          : "No image file provided";
        return res.status(400).json({ error });
      }

      const {
        strokeWidth = 5,
        strokeColor = "#ffffff",
        enableStroke = true,
        widthInches = 5,
        heightInches = 4,
        outputDPI = 300,
      } = req.body;

      const parsedWidth = Math.max(0.1, Math.min(100, parseFloat(widthInches) || 5));
      const parsedHeight = Math.max(0.1, Math.min(100, parseFloat(heightInches) || 4));
      const parsedDPI = Math.max(72, Math.min(1200, parseInt(outputDPI) || 300));
      const parsedStrokeWidth = Math.max(0, Math.min(50, parseInt(strokeWidth) || 5));
      const enableStrokeBool = enableStroke === true || enableStroke === 'true';

      const outputWidth = Math.round(parsedWidth * parsedDPI);
      const outputHeight = Math.round(parsedHeight * parsedDPI);

      if (outputWidth * outputHeight > 100_000_000) {
        return res.status(400).json({ error: "Requested output dimensions are too large" });
      }

      let imageBuffer = req.file.buffer;

      const resizedImage = await sharp(imageBuffer)
        .resize(outputWidth, outputHeight, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      if (enableStrokeBool && parsedStrokeWidth > 0) {
        const strokeWidthPx = Math.round(parsedStrokeWidth * (parsedDPI / 72));
        
        const strokeBuffer = await sharp(resizedImage)
          .extend({
            top: strokeWidthPx,
            bottom: strokeWidthPx,
            left: strokeWidthPx,
            right: strokeWidthPx,
            background: strokeColor
          })
          .composite([
            {
              input: resizedImage,
              top: strokeWidthPx,
              left: strokeWidthPx,
            }
          ])
          .png()
          .toBuffer();

        imageBuffer = strokeBuffer;
      } else {
        imageBuffer = resizedImage;
      }

      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="processed-sticker.png"',
        'Content-Length': imageBuffer.length.toString(),
      });

      res.send(imageBuffer);
    } catch (error) {
      console.error("Image processing error:", error);
      res.status(500).json({ 
        error: "Failed to process image", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/image-info", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        // If multer silently rejected the file (unsupported MIME type), say so.
        const rejected = (req as any)._multerRejectedMimetype;
        const error = rejected
          ? `File type "${rejected}" is not supported. Please upload a PNG, JPEG, WebP, or HEIC file.`
          : "No image file provided";
        return res.status(400).json({ error });
      }

      const metadata = await sharp(req.file.buffer).metadata();
      
      res.json({
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        channels: metadata.channels,
        density: metadata.density || 72,
        size: req.file.size,
      });
    } catch (error) {
      console.error("Metadata extraction error:", error);
      res.status(500).json({ 
        error: "Failed to extract image metadata", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/send-design", upload.none(), async (req, res) => {
    try {
      const { customerName, customerEmail, customerNotes, pdfData, fileName } = req.body;

      if (!customerName || !customerEmail) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const sendGridApiKey = process.env.SENDGRID_API_KEY;
      
      if (!sendGridApiKey) {
        console.error("SendGrid API key not configured");
        return res.status(500).json({ error: "Email service not configured" });
      }

      sgMail.setApiKey(sendGridApiKey);

      const safeName = escapeHtml(customerName);
      const safeEmail = escapeHtml(customerEmail);
      const safeFileName = escapeHtml(fileName || "Not provided");
      const safeNotes = customerNotes ? escapeHtml(customerNotes) : "";

      const notesSection = customerNotes ? `\nCustomer Notes:\n${customerNotes}\n` : "";
      const emailContent = `
New Design Submission

Customer Details:
- Full Name: ${customerName}
- Email: ${customerEmail}
- File Name: ${fileName || "Not provided"}
- Submission Time: ${new Date().toLocaleString()}
${notesSection}
The customer has confirmed that the cutline looks good and is ready to proceed with this design.
`;

      const htmlNotesSection = safeNotes 
        ? `<h3>Customer Notes:</h3><p style="background-color: #f3f4f6; padding: 12px; border-radius: 6px; white-space: pre-wrap;">${safeNotes}</p>` 
        : "";
      const htmlContent = `
<h2>New Design Submission</h2>

<h3>Customer Details:</h3>
<ul>
  <li><strong>Full Name:</strong> ${safeName}</li>
  <li><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></li>
  <li><strong>File Name:</strong> ${safeFileName}</li>
  <li><strong>Submission Time:</strong> ${new Date().toLocaleString()}</li>
</ul>

${htmlNotesSection}

<p>The customer has confirmed that the cutline looks good and is ready to proceed with this design.</p>

${pdfData ? '<p><strong>PDF design with CutContour is attached.</strong></p>' : '<p><em>No design file was attached.</em></p>'}
`;

      const msg: sgMail.MailDataRequired = {
        to: "support@anynestapp.com",
        from: "support@anynestapp.com",
        subject: `New Sticker Design Submission from ${safeName}`,
        text: emailContent,
        html: htmlContent,
      };

      if (pdfData) {
        msg.attachments = [
          {
            content: pdfData,
            filename: fileName || "design.pdf",
            type: "application/pdf",
            disposition: "attachment",
          },
        ];
      }

      await sgMail.send(msg);

      res.json({ success: true, message: "Design sent successfully" });
    } catch (error) {
      console.error("Email sending error:", error);
      
      let errorMessage = "Failed to send design";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      res.status(500).json({
        error: "Failed to send design",
        details: errorMessage,
      });
    }
  });

  // ── Vector/PDF → PNG conversion ──────────────────────────────────────────────
  // POST /api/convert-file
  // Body (multipart): file (PDF | SVG | EPS)
  // Returns JSON: { pngBase64, widthPx, heightPx, dpi, widthInches, heightInches }
  app.post("/api/convert-file", uploadAny.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const origName  = file.originalname.toLowerCase();
    const mime      = file.mimetype.toLowerCase();
    const isPdf     = origName.endsWith(".pdf") || mime === "application/pdf";
    const isSvg     = origName.endsWith(".svg") || mime === "image/svg+xml";
    const isEps     = origName.endsWith(".eps") || mime.includes("postscript") || mime.includes("/eps");

    if (!isPdf && !isSvg && !isEps) {
      return res.status(400).json({ error: "Unsupported format. Send PDF, SVG, or EPS." });
    }

    const TARGET_DPI = 300;
    const id         = crypto.randomUUID();
    const tmpIn      = path.join(os.tmpdir(), `cvt_in_${id}${isPdf ? ".pdf" : isSvg ? ".svg" : ".eps"}`);
    const tmpOut     = path.join(os.tmpdir(), `cvt_out_${id}`); // tool appends extension

    try {
      fs.writeFileSync(tmpIn, file.buffer);
      let pngPath: string;

      // ── PDF ─────────────────────────────────────────────────────────────────
      if (isPdf) {
        // Detect page count before rendering so we can warn the client.
        // pdfinfo -l 1 reads only the first page descriptor — very fast.
        let pageCount = 1;
        try {
          const { stdout: infoOut } = await execFileAsync(
            "pdfinfo", [tmpIn], { timeout: 10_000 },
          );
          const m = infoOut.match(/^Pages:\s*(\d+)/m);
          if (m) pageCount = parseInt(m[1], 10);
        } catch { /* pdfinfo failure is non-fatal */ }

        // pdftocairo: uses cairo for high-quality rendering with proper transparency.
        // -cropbox trims to CropBox (= artboard in design tools, excludes bleed marks).
        // -singlefile renders only page 1 and writes <tmpOut>.png (not <tmpOut>-1.png).
        await execFileAsync("pdftocairo", [
          "-png",
          "-r", String(TARGET_DPI),
          "-singlefile",
          "-cropbox",
          tmpIn,
          tmpOut,
        ], { maxBuffer: 200 * 1024 * 1024 });
        pngPath = `${tmpOut}.png`;

        // Attach page count so the client can warn when > 1 page is present.
        (req as { _pdfPageCount?: number })._pdfPageCount = pageCount;
      }

      // ── SVG ─────────────────────────────────────────────────────────────────
      else if (isSvg) {
        // Sharp/libvips uses librsvg natively. density:300 renders at 300 DPI,
        // but librsvg treats *all* coordinate values as pt (1/72 in), including px.
        // Physical-unit SVGs (width="3in") are correct; px-unit SVGs are not —
        // see getSvgDimensions() which parses the true physical size from XML.
        pngPath = `${tmpOut}.png`;
        const pngBuf = await sharp(file.buffer, { density: TARGET_DPI })
          .png()
          .toBuffer();
        fs.writeFileSync(pngPath, pngBuf);
      }

      // ── EPS ─────────────────────────────────────────────────────────────────
      else {
        const gsPath = await findGhostscript();
        if (!gsPath) {
          return res.status(500).json({
            error: "GhostScript not available in this environment. EPS conversion requires gs.",
          });
        }
        pngPath = `${tmpOut}.png`;
        // pngalpha device preserves the EPS background as transparent.
        // -dEPSCrop crops to the %%BoundingBox exactly.
        await execFileAsync(gsPath, [
          "-dNOPAUSE", "-dBATCH", "-dSAFER",
          "-sDEVICE=pngalpha",
          `-r${TARGET_DPI}`,
          "-dEPSCrop",
          `-sOutputFile=${pngPath}`,
          tmpIn,
        ], { maxBuffer: 200 * 1024 * 1024, timeout: 60_000 });
      }

      // ── Read rendered PNG + compute physical dimensions ─────────────────────
      if (!fs.existsSync(pngPath)) {
        return res.status(500).json({ error: "Conversion produced no output" });
      }
      const pngBuf = fs.readFileSync(pngPath);
      const meta   = await sharp(pngBuf).metadata();
      const widthPx  = meta.width  ?? 0;
      const heightPx = meta.height ?? 0;

      // For SVG: librsvg uses pt (1/72 in) semantics for all units, including px.
      // Parse the SVG's own width/height/viewBox to get the true physical size.
      // For PDF/EPS: pdftocairo and GhostScript already produce correct DPI output,
      // so widthPx / TARGET_DPI is exact.
      let widthInches  = widthPx  / TARGET_DPI;
      let heightInches = heightPx / TARGET_DPI;
      if (isSvg) {
        const parsed = getSvgDimensions(file.buffer);
        if (parsed) {
          widthInches  = parsed.widthInches;
          heightInches = parsed.heightInches;
        }
        // If parsing fails (e.g., malformed SVG), widthPx/300 is the best we have.
      }

      res.json({
        pngBase64:    pngBuf.toString("base64"),
        widthPx,
        heightPx,
        dpi:          TARGET_DPI,
        widthInches:  parseFloat(widthInches.toFixed(4)),
        heightInches: parseFloat(heightInches.toFixed(4)),
        // Only present for PDFs; tells the client if additional pages were not imported
        pageCount:    (req as { _pdfPageCount?: number })._pdfPageCount,
      });
    } catch (err) {
      console.error("[convert-file]", err);
      res.status(500).json({
        error:   "Conversion failed",
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      for (const f of [tmpIn, `${tmpOut}.png`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    }
  });

  // ── Upscale image (waifu2x cunet ONNX, CPU) ────────────────────────────────
  // POST /api/upscale-image
  // Body (multipart): image (PNG), scale (2|4, default 4)
  // Returns: PNG binary
  app.post("/api/upscale-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        // If multer silently rejected the file (unsupported MIME type), say so.
        const rejected = (req as any)._multerRejectedMimetype;
        const error = rejected
          ? `File type "${rejected}" is not supported. Please upload a PNG, JPEG, WebP, or HEIC file.`
          : "No image file provided";
        return res.status(400).json({ error });
      }

      const scale = parseInt(req.body?.scale ?? "4") as 2 | 4;
      if (scale !== 2 && scale !== 4) {
        return res.status(400).json({ error: "scale must be 2 or 4" });
      }

      // Guard against enormous inputs (model runs on CPU)
      const meta = await sharp(req.file.buffer).metadata();
      const w = meta.width  ?? 0;
      const h = meta.height ?? 0;
      if (w * h > 16_000_000) {
        return res.status(400).json({ error: "Input image too large (max ~16 MP)" });
      }

      const inputPng = await sharp(req.file.buffer).png().toBuffer();
      const outputPng = await upscale(inputPng, scale);

      res.set({
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="upscaled_${scale}x.png"`,
        "Content-Length": outputPng.length.toString(),
        "X-Upscale-Backend": getWorkerBackend(),
      });
      res.send(outputPng);
    } catch (err) {
      console.error("[upscale route]", err);
      res.status(500).json({
        error: "Upscale failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
