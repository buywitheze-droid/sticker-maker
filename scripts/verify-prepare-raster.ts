/**
 * Exercises the production raster-preparation route with a 64 MP transparent
 * PNG. The source includes a one-pixel alpha=1 edge outside its opaque artwork
 * so the crop assertion proves the server retains soft alpha exactly.
 *
 *   npx tsx scripts/verify-prepare-raster.ts
 */

import express from "express";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Server } from "node:http";
import sharp from "sharp";

// The test only touches raster preparation. Set this before dynamically loading
// the routes so their unrelated upscale worker is not pre-warmed and left alive
// after the temporary HTTP server closes.
process.env.ANYNEST_SKIP_UPSCALE_PREWARM = "1";

const SOURCE_W = 8_000;
const SOURCE_H = 8_000;
const ART_LEFT = 1_100;
const ART_TOP = 1_200;
const ART_W = 5_800;
const ART_H = 5_000;
const SOFT_X = ART_LEFT - 1;
const SOFT_Y = ART_TOP - 1;

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  PASS  ${label}: ${String(actual)}`);
    return;
  }
  throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function expectedPreview(width: number, height: number): { width: number; height: number } {
  const maxEdge = 4_096;
  const maxPixels = 40_000_000;
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (width * height)),
    maxEdge / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function submitFixture(port: number, filePath: string, fileName: string): Promise<Response> {
  const form = new FormData();
  form.append(
    "image",
    new Blob([await fs.readFile(filePath)], { type: "image/png" }),
    fileName,
  );
  return fetch(`http://127.0.0.1:${port}/api/prepare-raster-upload`, {
    method: "POST",
    body: form,
  });
}

function responseCrop(response: Response) {
  return {
    left: Number(response.headers.get("X-Anynest-Crop-X")),
    top: Number(response.headers.get("X-Anynest-Crop-Y")),
    width: Number(response.headers.get("X-Anynest-Crop-Width")),
    height: Number(response.headers.get("X-Anynest-Crop-Height")),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "anynest-prepare-check-"));
const fixturePath = path.join(tempDir, "large-transparent.png");
const sparseBorderPath = path.join(tempDir, "sparse-border.png");
const rotatedPath = path.join(tempDir, "rotated.png");
let server: Server | null = null;

try {
  console.log("Creating 64 MP transparent fixture...");
  const artwork = await sharp({
    create: {
      width: ART_W,
      height: ART_H,
      channels: 4,
      background: { r: 225, g: 29, b: 72, alpha: 1 },
    },
  }).png().toBuffer();
  const softEdge = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 225, g: 29, b: 72, alpha: 1 / 255 },
    },
  }).png().toBuffer();

  await sharp({
    create: {
      width: SOURCE_W,
      height: SOURCE_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: artwork, left: ART_LEFT, top: ART_TOP },
      { input: softEdge, left: SOFT_X, top: SOFT_Y },
    ])
    .png()
    .toFile(fixturePath);

  // A malformed/inconsistent alpha plane must keep the whole frame instead of
  // producing a partial crop or failing an otherwise renderable import.
  const { inspectRasterAlpha } = await import("../server/raster-content-bounds");
  const fallback = await inspectRasterAlpha(
    fixturePath,
    { failOn: "none", sequentialRead: true, limitInputPixels: 150_000_000 },
    SOURCE_W + 1,
    SOURCE_H,
    "uchar",
  );
  check("inconsistent alpha plane keeps full width", fallback.width, SOURCE_W + 1);
  check("inconsistent alpha plane does not claim transparency", fallback.hasTransparentPixels, false);

  const { registerRoutes } = await import("../server/routes");
  const app = express();
  server = await registerRoutes(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");

  console.log("Submitting fixture to /api/prepare-raster-upload...");
  const response = await submitFixture(address.port, fixturePath, "large-transparent.png");

  check("HTTP status", response.status, 200);
  const crop = responseCrop(response);
  check("source width", Number(response.headers.get("X-Anynest-Source-Width")), SOURCE_W);
  check("source height", Number(response.headers.get("X-Anynest-Source-Height")), SOURCE_H);
  check("soft alpha is not classified as binary", response.headers.get("X-Anynest-Binary-Alpha"), "0");
  check("crop left includes alpha=1 edge", crop.left, SOFT_X);
  check("crop top includes alpha=1 edge", crop.top, SOFT_Y);
  check("crop width", crop.width, ART_W + 1);
  check("crop height", crop.height, ART_H + 1);

  const preview = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  const expected = expectedPreview(crop.width, crop.height);
  check("preview width", preview.width, expected.width);
  check("preview height", preview.height, expected.height);

  // A one-pixel transparent frame is easy for a reduced alpha sample to miss.
  // The exact scan must still see it and crop it away.
  await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: await sharp({
        create: {
          width: 798,
          height: 798,
          channels: 4,
          background: { r: 8, g: 145, b: 178, alpha: 1 },
        },
      }).png().toBuffer(),
      left: 1,
      top: 1,
    }])
    .png()
    .toFile(sparseBorderPath);

  const sparse = await submitFixture(address.port, sparseBorderPath, "sparse-border.png");
  check("sparse-border HTTP status", sparse.status, 200);
  const sparseCrop = responseCrop(sparse);
  check("sparse border crop left", sparseCrop.left, 1);
  check("sparse border crop top", sparseCrop.top, 1);
  check("sparse border crop width", sparseCrop.width, 798);
  check("sparse border crop height", sparseCrop.height, 798);
  check("hard-edge image is classified as binary", sparse.headers.get("X-Anynest-Binary-Alpha"), "1");

  // EXIF orientation must be applied before alpha coordinates are reported.
  const rotatedArtwork = await sharp({
    create: {
      width: 6,
      height: 3,
      channels: 4,
      background: { r: 34, g: 197, b: 94, alpha: 1 },
    },
  }).png().toBuffer();
  await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: rotatedArtwork, left: 3, top: 2 }])
    .withMetadata({ orientation: 6 })
    .png()
    .toFile(rotatedPath);

  const rotated = await submitFixture(address.port, rotatedPath, "rotated.png");
  check("rotated HTTP status", rotated.status, 200);
  const rotatedCrop = responseCrop(rotated);
  check("rotated source width", Number(rotated.headers.get("X-Anynest-Source-Width")), 8);
  check("rotated source height", Number(rotated.headers.get("X-Anynest-Source-Height")), 12);
  check("rotated crop left", rotatedCrop.left, 3);
  check("rotated crop top", rotatedCrop.top, 3);
  check("rotated crop width", rotatedCrop.width, 3);
  check("rotated crop height", rotatedCrop.height, 6);
  console.log("PASS — exact alpha preparation handles large soft edges, sparse borders, and EXIF rotation.");
} finally {
  if (server?.listening) await closeServer(server);
  await fs.rm(tempDir, { recursive: true, force: true });
}