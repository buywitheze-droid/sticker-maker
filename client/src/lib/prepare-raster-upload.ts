/**
 * Client helpers for the oversized-raster import path.
 *
 * Large PNGs/JPEGs must not be full-decoded in the browser (iOS Safari
 * OOM / silent black canvas). For those we ask the server (sharp/libvips)
 * for an editor-sized preview only — the user's original file stays in
 * memory as the print source, so import never caps output quality and we
 * never move high-resolution pixels back over the network.
 */

import {
  checkFileSizeBudget,
  checkPixelBudget,
  formatFileSize,
  formatMegapixels,
  MAX_SOURCE_MEGAPIXELS,
  MAX_SOURCE_FILE_BYTES,
} from "./image-budget";

export interface SourceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedRaster {
  /** Editor-sized preview decoded from the server response. */
  previewImage: HTMLImageElement;
  previewFile: File;
  /**
   * Full-resolution print source: the user's original, untouched bytes, copied
   * out of the picked file so the export does not depend on it still being on
   * disk. See `ownUploadedBytes`.
   */
  sourceBlob: Blob;
  /** Content box inside `sourceBlob` that `previewImage` represents. */
  sourceCrop: SourceCrop;
  /** Oriented source dimensions, before cropping. */
  sourceWidth: number;
  sourceHeight: number;
  dpi: number;
  sourceMegapixels: number;
  binaryAlpha: boolean;
  /** Whether the *uncropped* source had transparent pixels, i.e. is cut-out
   *  artwork. Not derivable from the preview, which is cropped to content. */
  hasTransparency: boolean;
}

export type RejectReason = "too_many_pixels" | "file_too_large" | "unreadable_dimensions";

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load prepared preview image"));
    };
    img.src = url;
  });
}

/**
 * Read pixel dimensions straight out of the container header.
 *
 * Costs a few hundred bytes and no decode, which lets us decide between the
 * inline and prepare paths without ever handing a 100 MP file to `Image()`
 * or round-tripping it to the server just to learn its size.
 */
export async function readRasterDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  } catch {
    return null;
  }
  if (bytes.length < 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: IHDR is always the first chunk, width/height at bytes 16..24.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  // JPEG: walk the marker chain to the first SOFn frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = bytes[off + 1];
      if (marker === 0xff) {
        off++;
        continue;
      }
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        off += 2;
        continue;
      }
      const segLen = dv.getUint16(off + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
      }
      if (segLen < 2) return null;
      off += 2 + segLen;
    }
    return null;
  }

  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (tag === "VP8X" && bytes.length >= 30) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (tag === "VP8 " && bytes.length >= 30) {
      return {
        width: dv.getUint16(26, true) & 0x3fff,
        height: dv.getUint16(28, true) & 0x3fff,
      };
    }
    if (tag === "VP8L" && bytes.length >= 25) {
      const bits = dv.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    return null;
  }

  return null;
}

/**
 * Whether the file's container magic is one of the three raster formats the
 * uploader accepts.
 *
 * The dimension read above is allowed to fail on an unusual-but-valid file — a
 * JPEG whose EXIF or ICC payload pushes the frame header past the 64 KB we
 * sniff, for instance — and the caller falls back to letting `Image()` report
 * the size. That fallback decodes the whole file *before* any budget check can
 * run, so it must only ever see a container we know is small enough to be safe
 * to decode. A file picked as `art.png` carries `image/png` from the OS purely
 * because of its extension, and `<img>` sniffs content rather than trusting
 * that, so a renamed AVIF or HEIC would otherwise be fully decoded here: those
 * formats reach 65,535 px per side and compress a flat 30,000 x 30,000 canvas
 * (3.6 GB as RGBA) into a few kilobytes.
 */
export async function isSupportedRasterContainer(file: File): Promise<boolean> {
  let b: Uint8Array;
  try {
    b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return false;
  }
  if (b.length < 12) return false;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isWebp =
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return isPng || isJpeg || isWebp;
}

/**
 * Copy an uploaded file's bytes into a blob the app owns.
 *
 * A `File` from a picker or a drop is a *reference* to a path on disk plus the
 * size and modification time it had when it was chosen. Nothing is read until
 * something reads it, and if the file has moved, been renamed or deleted, been
 * re-saved by the customer, or been turned back into a cloud placeholder by
 * OneDrive or Dropbox in the meantime, that read fails —
 * "A requested file or directory could not be found at the time an operation
 * was processed."
 *
 * That matters because this file is the design's *print source*: the export
 * decodes it at the placement size when Download is pressed, which can be an
 * hour after the upload. Retaining the reference meant a gangsheet quietly
 * depended on the customer's folder staying untouched for the whole session,
 * and it failed at the last possible step, after the sheet had rendered.
 *
 * The read costs one pass over the file here, while it is certainly still
 * there. The bytes then live in browser-managed blob storage, which can page to
 * disk, so this buys independence from the filesystem rather than heap.
 */
export async function ownUploadedBytes(file: File): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  return new Blob([bytes], { type: file.type || "application/octet-stream" });
}

export async function prepareRasterUpload(file: File): Promise<PreparedRaster> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/prepare-raster-upload", { method: "POST", body: form });
      if (!res.ok) {
        let message = `Prepare failed (${res.status})`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (errJson?.error) message = errJson.error;
        } catch {
          /* keep the status-based message */
        }
        // 4xx (except 408/429) is not worth retrying — the file itself was rejected.
        const retryableStatus = res.status >= 500 || res.status === 408 || res.status === 429;
        if (!retryableStatus || attempt === maxAttempts) {
          throw new Error(message);
        }
        lastError = new Error(message);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
        continue;
      }

      const num = (name: string) => Number(res.headers.get(name));
      const sourceWidth = num("X-Anynest-Source-Width");
      const sourceHeight = num("X-Anynest-Source-Height");
      const cropWidth = num("X-Anynest-Crop-Width");
      const cropHeight = num("X-Anynest-Crop-Height");
      if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(cropWidth > 0) || !(cropHeight > 0)) {
        throw new Error("Prepare response was missing dimension headers");
      }

      const previewBlob = await res.blob();
      const previewImage = await loadImageFromBlob(previewBlob);
      const baseName = file.name.replace(/\.\w+$/, "") || "design";

      return {
        previewImage,
        previewFile: new File([previewBlob], `${baseName}.png`, { type: "image/png" }),
        sourceBlob: await ownUploadedBytes(file),
        sourceCrop: {
          x: Math.max(0, num("X-Anynest-Crop-X") || 0),
          y: Math.max(0, num("X-Anynest-Crop-Y") || 0),
          width: cropWidth,
          height: cropHeight,
        },
        sourceWidth,
        sourceHeight,
        dpi: num("X-Anynest-Density") || 72,
        sourceMegapixels: num("X-Anynest-Source-MP") || (sourceWidth * sourceHeight) / 1_000_000,
        binaryAlpha: res.headers.get("X-Anynest-Binary-Alpha") === "1",
        hasTransparency: res.headers.get("X-Anynest-Has-Transparency") === "1",
      };
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      const isNetwork =
        detail === "Failed to fetch" ||
        /network|interrupted|timeout|Failed to load/i.test(detail);
      const isRetryablePrepare = /Prepare failed \(5\d\d\)|Prepare failed \(408\)|Prepare failed \(429\)/.test(detail);
      if ((isNetwork || isRetryablePrepare) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
        continue;
      }
      if (isNetwork) {
        throw new Error(
          "Your connection was interrupted during upload. Please check your internet and try again.",
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Prepare failed after retries");
}

export function describeBudgetRejection(
  reason: RejectReason,
  megapixels: number,
  fileSize?: number,
): { sizeLabel: string; maxLabel: string } {
  if (reason === "file_too_large") {
    return {
      sizeLabel: formatFileSize(fileSize ?? 0),
      maxLabel: formatFileSize(MAX_SOURCE_FILE_BYTES),
    };
  }
  if (reason === "too_many_pixels") {
    return {
      sizeLabel: formatMegapixels(megapixels),
      maxLabel: `${MAX_SOURCE_MEGAPIXELS} MP`,
    };
  }
  return { sizeLabel: "unknown", maxLabel: `${MAX_SOURCE_MEGAPIXELS} MP` };
}

/**
 * Entry point for PNG/JPEG/WebP imports. Decides between an inline browser
 * decode and the server prepare path from the container header alone, so an
 * oversized file is never handed to `Image()` first.
 */
export async function importRasterForEditor(
  file: File,
  handlers: {
    onPrepared: (prepared: PreparedRaster) => void | Promise<void>;
    onInline: (file: File, image: HTMLImageElement) => void | Promise<void>;
    onReject: (reason: RejectReason, megapixels: number) => void;
    onPrepareError?: (error: unknown) => void;
  },
): Promise<void> {
  const sizeBudget = checkFileSizeBudget(file.size);
  if (!sizeBudget.ok) {
    handlers.onReject(sizeBudget.reason, 0);
    return;
  }

  const runPrepare = async () => {
    try {
      const prepared = await prepareRasterUpload(file);
      await handlers.onPrepared(prepared);
    } catch (err) {
      handlers.onPrepareError?.(err);
      throw err;
    }
  };

  const header = await readRasterDimensions(file);
  if (header) {
    const budget = checkPixelBudget(header.width, header.height);
    if (!budget.ok) {
      handlers.onReject(budget.reason, budget.megapixels);
      return;
    }
    if (budget.mode === "prepare") {
      await runPrepare();
      return;
    }
  }

  // Header parsing failed — an unusual but potentially valid file of a format we
  // do support. Probing it with `Image()` decodes it in full, so only do that for
  // a container whose decoded size the budget above could have bounded.
  if (!(await isSupportedRasterContainer(file))) {
    handlers.onReject("unreadable_dimensions", 0);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const budget = checkPixelBudget(img.naturalWidth || img.width, img.naturalHeight || img.height);
      if (!budget.ok) {
        handlers.onReject(budget.reason, budget.megapixels);
        resolve();
        return;
      }
      if (budget.mode === "prepare") {
        void runPrepare().then(resolve, reject);
        return;
      }
      void Promise.resolve(handlers.onInline(file, img)).then(() => resolve(), reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
