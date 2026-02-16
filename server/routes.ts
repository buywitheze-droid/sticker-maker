import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";

import sgMail from "@sendgrid/mail";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG files are allowed'));
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Process image with high-quality stroke and resize
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

      // Calculate output dimensions in pixels
      const outputWidth = Math.round(parseFloat(widthInches) * parseInt(outputDPI));
      const outputHeight = Math.round(parseFloat(heightInches) * parseInt(outputDPI));

      let imageBuffer = req.file.buffer;

      // Resize image
      const resizedImage = await sharp(imageBuffer)
        .resize(outputWidth, outputHeight, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent background
        })
        .png()
        .toBuffer();

      // Add stroke if enabled
      if (enableStroke && parseInt(strokeWidth) > 0) {
        const strokeWidthPx = Math.round(parseInt(strokeWidth) * (parseInt(outputDPI) / 72)); // Convert to high-res pixels
        
        // Create stroke effect using Sharp's extend and composite operations
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

      // Set appropriate headers
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

  // Get image metadata
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

  // Send design submission to sales email
  app.post("/api/send-design", upload.none(), async (req, res) => {
    try {
      const { customerName, customerEmail, customerNotes, pdfData, fileName } = req.body;

      if (!customerName || !customerEmail) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Validate email format
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

      // Prepare email content
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

      const htmlNotesSection = customerNotes 
        ? `<h3>Customer Notes:</h3><p style="background-color: #f3f4f6; padding: 12px; border-radius: 6px; white-space: pre-wrap;">${customerNotes}</p>` 
        : "";
      const htmlContent = `
<h2>New Design Submission</h2>

<h3>Customer Details:</h3>
<ul>
  <li><strong>Full Name:</strong> ${customerName}</li>
  <li><strong>Email:</strong> <a href="mailto:${customerEmail}">${customerEmail}</a></li>
  <li><strong>File Name:</strong> ${fileName || "Not provided"}</li>
  <li><strong>Submission Time:</strong> ${new Date().toLocaleString()}</li>
</ul>

${htmlNotesSection}

<p>The customer has confirmed that the cutline looks good and is ready to proceed with this design.</p>

${pdfData ? '<p><strong>PDF design with CutContour is attached.</strong></p>' : '<p><em>No design file was attached.</em></p>'}
`;

      // Build email message
      const msg: sgMail.MailDataRequired = {
        to: "sales@dtfmasters.com",
        from: "sales@dtfmasters.com",
        subject: `New Sticker Design Submission from ${customerName}`,
        text: emailContent,
        html: htmlContent,
      };

      // If there's PDF data, attach it
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
      res.status(500).json({
        error: "Failed to send design",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/download-pipeline", (req, res) => {
    const filePath = "client/src/components/preview-section.tsx";
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "File not found: preview-section.tsx" });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=preview-section.tsx");
    res.sendFile(fullPath);
  });

  app.get("/download", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download Preview Section</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #16213e; border-radius: 12px; padding: 40px; max-width: 500px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    h1 { color: #e94560; margin-bottom: 8px; }
    p { color: #a0a0b0; line-height: 1.6; }
    .files { text-align: left; background: #0f3460; border-radius: 8px; padding: 16px; margin: 20px 0; font-family: monospace; font-size: 14px; }
    .files div { padding: 4px 0; color: #e0e0e0; }
    .btn { display: inline-block; background: #e94560; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; transition: background 0.2s; cursor: pointer; border: none; }
    .btn:hover { background: #c73a52; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Preview Section</h1>
    <p>Download the preview-section.tsx component source file.</p>
    <div class="files">
      <div>preview-section.tsx (1406 lines)</div>
    </div>
    <a href="/api/download-pipeline" class="btn">Download File</a>
  </div>
</body>
</html>`);
  });

  const httpServer = createServer(app);
  return httpServer;
}
