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
      cb(new Error('Only PNG files are allowed'));
    }
  },
});

// Separate multer for the convert-file endpoint — accepts PDF/SVG/EPS + images
const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/downloads", express.static(path.resolve(process.cwd(), "downloads")));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/process-image", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
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
        return res.status(400).json({ error: "No image file provided" });
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
        return res.status(400).json({ error: "No image file provided" });
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
