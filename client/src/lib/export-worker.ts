interface DesignExportData {
  widthInches: number;
  heightInches: number;
  nx: number;
  ny: number;
  s: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Blob (File) reference — decoded lazily inside the worker per-strip. */
  blob: Blob;
  alphaThresholded?: boolean;
  printFileName?: boolean;
  name?: string;
}

interface ExportInput {
  type: 'export';
  requestId: number;
  designs: DesignExportData[];
  outW: number;
  outH: number;
  exportDpi: number;
}

interface DrawInfo {
  design: DesignExportData;
  drawW: number;
  drawH: number;
  centerX: number;
  centerY: number;
  radius: number;
  aabbW: number;
  aabbH: number;
  stampKey: string;
}

const STRIP_HEIGHT = 4096;
const BATCH_ROWS = 512;
const MAX_IDAT_BYTES = 2 * 1024 * 1024;

// Per-stamp memory cap: skip caching individual stamps that would exceed this
// (huge one-off designs). Small duplicates always fit.
const STAMP_CACHE_MAX_BYTES = 64 * 1024 * 1024; // ~4096x4096 RGBA
// Total stamp cache cap.
const STAMP_CACHE_TOTAL_MAX_BYTES = 256 * 1024 * 1024;

type SourceBitmapCache = Map<Blob, ImageBitmap>;
type StampCache = Map<string, OffscreenCanvas>;

function makeStampKey(d: DesignExportData, drawW: number, drawH: number, blobIndex: number): string {
  const nameKey = d.printFileName && d.name ? `|n${d.name}` : '';
  return [
    `b${blobIndex}`,
    drawW,
    drawH,
    d.rotation | 0,
    d.flipX ? 1 : 0,
    d.flipY ? 1 : 0,
    d.alphaThresholded ? 1 : 0,
    d.printFileName ? 1 : 0,
    nameKey,
  ].join('|');
}

// Assign a stable index to each unique Blob reference in the export payload.
// Duplicate designs share the same Blob (imageInfo.file), so this maps
// "designs referencing the same source" to identical stamp keys.
function buildBlobIndex(designs: DesignExportData[]): Map<Blob, number> {
  const map = new Map<Blob, number>();
  let counter = 0;
  for (const d of designs) {
    if (!map.has(d.blob)) map.set(d.blob, counter++);
  }
  return map;
}

async function getSourceBitmap(blob: Blob, cache: SourceBitmapCache): Promise<ImageBitmap> {
  const cached = cache.get(blob);
  if (cached) return cached;
  const bitmap = await createImageBitmap(blob);
  cache.set(blob, bitmap);
  return bitmap;
}

// Pre-render a design at its AABB size, once per unique (source + render
// parameters) combo. Every subsequent copy is composited by a single 1:1
// drawImage of this pre-baked stamp — orders of magnitude cheaper than
// re-running rotate/scale/drawImage/text for every duplicate.
async function getOrBuildStamp(
  d: DesignExportData,
  info: DrawInfo,
  bitmap: ImageBitmap,
  exportDpi: number,
  cache: StampCache,
  cacheState: { totalBytes: number },
): Promise<OffscreenCanvas | null> {
  const stampBytes = info.aabbW * info.aabbH * 4;
  const canCache = stampBytes <= STAMP_CACHE_MAX_BYTES
    && cacheState.totalBytes + stampBytes <= STAMP_CACHE_TOTAL_MAX_BYTES;

  if (canCache) {
    const existing = cache.get(info.stampKey);
    if (existing) return existing;
  }

  const stamp = new OffscreenCanvas(info.aabbW, info.aabbH);
  const sctx = stamp.getContext('2d', { alpha: true });
  if (!sctx) return null;

  sctx.imageSmoothingEnabled = !d.alphaThresholded;
  sctx.imageSmoothingQuality = 'high';
  sctx.save();
  // Round the internal pivot so it lands on an integer pixel, matching the
  // pre-cache code path that translated to centerX/centerY directly. This
  // keeps the composited output byte-identical whether or not we hit cache.
  sctx.translate(Math.round(info.aabbW / 2), Math.round(info.aabbH / 2));
  sctx.rotate((d.rotation * Math.PI) / 180);
  sctx.scale(d.flipX ? -1 : 1, d.flipY ? -1 : 1);
  sctx.drawImage(bitmap, -info.drawW / 2, -info.drawH / 2, info.drawW, info.drawH);
  if (d.printFileName && d.name) {
    sctx.scale(d.flipX ? -1 : 1, d.flipY ? -1 : 1);
    const marginPx = 0.1 * exportDpi;
    const fontSize = Math.max(8, Math.round(info.drawH * 0.045));
    sctx.font = `bold ${fontSize}px sans-serif`;
    const displayName = d.name.replace(/\.[^/.]+$/, '');
    sctx.fillStyle = '#000000';
    sctx.textAlign = 'right';
    sctx.textBaseline = 'top';
    sctx.fillText(displayName, info.drawW / 2, info.drawH / 2 + marginPx);
  }
  sctx.restore();

  if (canCache) {
    cache.set(info.stampKey, stamp);
    cacheState.totalBytes += stampBytes;
  }
  return stamp;
}

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * Composite pre-baked stamps into a strip. Stamps already have rotation,
 * flip, scale, and text baked in — this only does a 1:1 drawImage.
 */
function drawStampsOnCtx(
  ctx: OffscreenCanvasRenderingContext2D,
  infos: DrawInfo[],
  stamps: Map<DrawInfo, OffscreenCanvas>,
  stripY: number,
) {
  for (const info of infos) {
    const stamp = stamps.get(info);
    if (!stamp) continue;
    // Placement chosen so the design's pivot lands on the same integer pixel
    // the pre-cache path did (translate(centerX, centerY - stripY) at fractional
    // values used to be rounded implicitly by the canvas at composite time —
    // we keep behavior consistent by rounding here).
    const stampCenterInX = Math.round(info.aabbW / 2);
    const stampCenterInY = Math.round(info.aabbH / 2);
    const drawX = Math.round(info.centerX) - stampCenterInX;
    const drawY = Math.round(info.centerY - stripY) - stampCenterInY;
    ctx.drawImage(stamp, drawX, drawY);
  }
}

// Write `stripH` rows of fully transparent PNG rows to the deflate stream.
// Uint8Array is zero-filled by construction, so filter byte 0 + zero payload
// requires no extra work — this replaces allocating an OffscreenCanvas + a
// full getImageData for strips that have no visible designs (common on
// tall sparse sheets).
async function writeEmptyStripRows(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  stripH: number,
  filteredRowLen: number,
) {
  for (let startRow = 0; startRow < stripH; startRow += BATCH_ROWS) {
    const batchCount = Math.min(BATCH_ROWS, stripH - startRow);
    const batch = new Uint8Array(batchCount * filteredRowLen);
    await writer.write(batch);
  }
}

async function buildPngStreaming(input: ExportInput): Promise<Blob> {
  const { designs, outW, outH, exportDpi, requestId } = input;

  const ppm = Math.round(exportDpi / 0.0254);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrDv = new DataView(ihdrData.buffer);
  ihdrDv.setUint32(0, outW);
  ihdrDv.setUint32(4, outH);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  const physData = new Uint8Array(9);
  const physDv = new DataView(physData.buffer);
  physDv.setUint32(0, ppm);
  physDv.setUint32(4, ppm);
  physData[8] = 1;
  const physChunk = makePngChunk('pHYs', physData);

  // Pre-compute geometry for all designs — no bitmaps decoded yet. Stamp key
  // is derived from the shared blob index so duplicates cluster into a single
  // cached stamp regardless of render order.
  const blobIndex = buildBlobIndex(designs);
  const allInfos: DrawInfo[] = designs.map(d => {
    const drawW = Math.max(1, Math.round(d.widthInches * d.s * exportDpi));
    const drawH = Math.max(1, Math.round(d.heightInches * d.s * exportDpi));
    const centerX = d.nx * outW;
    const centerY = d.ny * outH;
    const radius = Math.sqrt(drawW * drawW + drawH * drawH) / 2;
    const rad = (d.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const aabbW = Math.max(1, Math.ceil(drawW * cos + drawH * sin));
    const aabbH = Math.max(1, Math.ceil(drawW * sin + drawH * cos));
    return {
      design: d,
      drawW,
      drawH,
      centerX,
      centerY,
      radius,
      aabbW,
      aabbH,
      stampKey: makeStampKey(d, drawW, drawH, blobIndex.get(d.blob) ?? 0),
    };
  });

  // Whole-export caches: decoded ImageBitmaps by Blob identity, and rendered
  // stamps by (source × render parameters). Freed after all strips are done.
  const bitmapCache: SourceBitmapCache = new Map();
  const stampCache: StampCache = new Map();
  const stampCacheState = { totalBytes: 0 };

  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();

  const compressedParts: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  const readPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedParts.push(new Uint8Array(value));
    }
  })();

  const rowBytes = outW * 4;
  const filteredRowLen = 1 + rowBytes;

  const totalStrips = Math.ceil(outH / STRIP_HEIGHT);
  let stripCanvas: OffscreenCanvas | null = null;
  let stripCtx: OffscreenCanvasRenderingContext2D | null = null;

  for (let si = 0; si < totalStrips; si++) {
    const stripY = si * STRIP_HEIGHT;
    const stripH = Math.min(STRIP_HEIGHT, outH - stripY);

    // Filter to designs whose bounding circle intersects this strip.
    const visible = allInfos.filter(info =>
      info.centerY + info.radius >= stripY && info.centerY - info.radius <= stripY + stripH
    );

    if (visible.length === 0) {
      // Fast path for empty strips: skip canvas allocation and getImageData
      // entirely. Uint8Array is already zero-filled, matching the transparent
      // pixels that would have been generated.
      await writeEmptyStripRows(writer, stripH, filteredRowLen);
      self.postMessage({ type: 'progress', requestId, strip: si + 1, totalStrips });
      continue;
    }

    // Decode + pre-render every visible design. Cache is keyed by shared
    // sources, so duplicates only cost one decode and one stamp render per
    // unique (source × render params) combo across the whole export.
    const stamps = new Map<DrawInfo, OffscreenCanvas>();
    for (const info of visible) {
      const bitmap = await getSourceBitmap(info.design.blob, bitmapCache);
      const stamp = await getOrBuildStamp(
        info.design, info, bitmap, exportDpi, stampCache, stampCacheState,
      );
      if (stamp) stamps.set(info, stamp);
    }

    if (!stripCanvas || stripCanvas.width !== outW || stripCanvas.height !== stripH) {
      stripCanvas = new OffscreenCanvas(outW, stripH);
      stripCtx = stripCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!stripCtx) throw new Error('Failed to get strip canvas context');
    }
    const ctx = stripCtx!;
    ctx.clearRect(0, 0, outW, stripH);
    drawStampsOnCtx(ctx, visible, stamps, stripY);

    const imageData = ctx.getImageData(0, 0, outW, stripH);
    const pixels = imageData.data;

    for (let startRow = 0; startRow < stripH; startRow += BATCH_ROWS) {
      const endRow = Math.min(startRow + BATCH_ROWS, stripH);
      const batchCount = endRow - startRow;
      const batch = new Uint8Array(batchCount * filteredRowLen);
      for (let r = 0; r < batchCount; r++) {
        const off = r * filteredRowLen;
        batch[off] = 0; // PNG filter type None
        batch.set(
          pixels.subarray((startRow + r) * rowBytes, (startRow + r + 1) * rowBytes),
          off + 1,
        );
      }
      await writer.write(batch);
    }

    // Report strip progress to the main thread.
    self.postMessage({ type: 'progress', requestId, strip: si + 1, totalStrips });
  }

  if (stripCanvas) {
    stripCanvas.width = 0;
    stripCanvas.height = 0;
  }

  // Release caches so their pixel storage can be reclaimed before the final
  // IDAT chunks are assembled.
  for (const bitmap of bitmapCache.values()) {
    try { bitmap.close(); } catch {}
  }
  bitmapCache.clear();
  for (const stamp of stampCache.values()) {
    stamp.width = 0;
    stamp.height = 0;
  }
  stampCache.clear();
  stampCacheState.totalBytes = 0;

  await writer.close();
  await readPromise;

  let totalCompressed = 0;
  for (const p of compressedParts) totalCompressed += p.length;
  const compressed = new Uint8Array(totalCompressed);
  let pos = 0;
  for (const p of compressedParts) { compressed.set(p, pos); pos += p.length; }

  const idatChunks: Uint8Array[] = [];
  for (let i = 0; i < compressed.length; i += MAX_IDAT_BYTES) {
    idatChunks.push(makePngChunk('IDAT', compressed.subarray(i, Math.min(i + MAX_IDAT_BYTES, compressed.length))));
  }

  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  return new Blob([signature, ihdrChunk, physChunk, ...idatChunks, iendChunk], { type: 'image/png' });
}

// Legacy single-canvas export for browsers without CompressionStream.
// Decodes each unique source blob only once and reuses the same ImageBitmap
// across duplicate designs.
async function runExportLegacy(input: ExportInput): Promise<Blob> {
  const { designs, outW, outH, exportDpi } = input;

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get OffscreenCanvas context');

  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const bitmapCache: SourceBitmapCache = new Map();
  for (const design of designs) {
    const bitmap = await getSourceBitmap(design.blob, bitmapCache);
    const drawW = Math.max(1, Math.round(design.widthInches * design.s * exportDpi));
    const drawH = Math.max(1, Math.round(design.heightInches * design.s * exportDpi));
    const centerX = design.nx * outW;
    const centerY = design.ny * outH;

    if (design.alphaThresholded) ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((design.rotation * Math.PI) / 180);
    ctx.scale(design.flipX ? -1 : 1, design.flipY ? -1 : 1);
    ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
    if (design.printFileName && design.name) {
      ctx.scale(design.flipX ? -1 : 1, design.flipY ? -1 : 1);
      const marginPx = 0.1 * exportDpi;
      const fontSize = Math.max(8, Math.round(drawH * 0.045));
      ctx.font = `bold ${fontSize}px sans-serif`;
      const displayName = design.name.replace(/\.[^/.]+$/, '');
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(displayName, drawW / 2, drawH / 2 + marginPx);
      ctx.scale(design.flipX ? -1 : 1, design.flipY ? -1 : 1);
    }
    ctx.restore();
    if (design.alphaThresholded) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
  }
  for (const bitmap of bitmapCache.values()) {
    try { bitmap.close(); } catch {}
  }
  bitmapCache.clear();

  const rawBlob = await canvas.convertToBlob({ type: 'image/png' });
  const rawBuf = new Uint8Array(await rawBlob.arrayBuffer());

  const ppm = Math.round(exportDpi / 0.0254);
  const physData = new Uint8Array(9);
  const physDv = new DataView(physData.buffer);
  physDv.setUint32(0, ppm);
  physDv.setUint32(4, ppm);
  physData[8] = 1;
  const physChunk = makePngChunk('pHYs', physData);

  const parts: Uint8Array[] = [];
  parts.push(rawBuf.slice(0, 8));
  const ihdrDataLen = ((rawBuf[8] << 24) | (rawBuf[9] << 16) | (rawBuf[10] << 8) | rawBuf[11]) >>> 0;
  const ihdrTotal = 12 + ihdrDataLen;
  parts.push(rawBuf.slice(8, 8 + ihdrTotal));
  parts.push(physChunk);
  let offset = 8 + ihdrTotal;
  while (offset + 12 <= rawBuf.length) {
    const dataLen = ((rawBuf[offset] << 24) | (rawBuf[offset + 1] << 16) | (rawBuf[offset + 2] << 8) | rawBuf[offset + 3]) >>> 0;
    const chunkTotal = 12 + dataLen;
    const isPHYs = rawBuf[offset + 4] === 0x70 && rawBuf[offset + 5] === 0x48 &&
                   rawBuf[offset + 6] === 0x59 && rawBuf[offset + 7] === 0x73;
    if (!isPHYs) parts.push(rawBuf.slice(offset, offset + chunkTotal));
    offset += chunkTotal;
  }

  canvas.width = 0;
  canvas.height = 0;

  return new Blob(parts, { type: 'image/png' });
}

const hasStreaming = typeof CompressionStream !== 'undefined';

self.onmessage = async function(e: MessageEvent) {
  if (e.data.type === 'export') {
    try {
      const blob = hasStreaming
        ? await buildPngStreaming(e.data)
        : await runExportLegacy(e.data);
      self.postMessage({ type: 'result', requestId: e.data.requestId, blob });
    } catch (err: any) {
      // Blobs don't need explicit cleanup — just report the error.
      self.postMessage({ type: 'error', requestId: e.data.requestId, error: err?.message || 'Export failed' });
    }
  }
};
