interface DesignExportData {
  widthInches: number;
  heightInches: number;
  nx: number;
  ny: number;
  s: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  bitmap: ImageBitmap;
  alphaThresholded?: boolean;
}

interface ExportInput {
  type: 'export';
  requestId: number;
  designs: DesignExportData[];
  outW: number;
  outH: number;
  exportDpi: number;
}

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function injectPngDpi(buf: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  if (buf.length < 8) return buf;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return buf;

  const parts: Uint8Array[] = [];
  parts.push(buf.slice(0, 8));

  const ihdrDataLen = readU32(buf, 8);
  const ihdrTotal = 12 + ihdrDataLen;
  parts.push(buf.slice(8, 8 + ihdrTotal));
  let offset = 8 + ihdrTotal;

  const PHYS_DATA_LEN = 9;
  const physChunk = new Uint8Array(4 + 4 + PHYS_DATA_LEN + 4);
  const pv = new DataView(physChunk.buffer);
  pv.setUint32(0, PHYS_DATA_LEN);
  physChunk[4] = 0x70; physChunk[5] = 0x48; physChunk[6] = 0x59; physChunk[7] = 0x73;
  pv.setUint32(8, ppm);
  pv.setUint32(12, ppm);
  physChunk[16] = 1;
  pv.setUint32(17, crc32(physChunk.slice(4, 4 + 4 + PHYS_DATA_LEN)));
  parts.push(physChunk);

  while (offset + 12 <= buf.length) {
    const dataLen = readU32(buf, offset);
    const chunkTotal = 12 + dataLen;
    const isPHYs = buf[offset + 4] === 0x70 && buf[offset + 5] === 0x48 &&
                   buf[offset + 6] === 0x59 && buf[offset + 7] === 0x73;
    if (!isPHYs) parts.push(buf.slice(offset, offset + chunkTotal));
    offset += chunkTotal;
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let writePos = 0;
  for (const part of parts) { out.set(part, writePos); writePos += part.length; }
  return out;
}

async function runExport(input: ExportInput) {
  const { designs, outW, outH, exportDpi } = input;

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get OffscreenCanvas context');

  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const design of designs) {
    const drawW = Math.max(1, Math.round(design.widthInches * design.s * exportDpi));
    const drawH = Math.max(1, Math.round(design.heightInches * design.s * exportDpi));
    const centerX = design.nx * outW;
    const centerY = design.ny * outH;

    if (design.alphaThresholded) {
      ctx.imageSmoothingEnabled = false;
    }
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((design.rotation * Math.PI) / 180);
    ctx.scale(design.flipX ? -1 : 1, design.flipY ? -1 : 1);
    ctx.drawImage(design.bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    if (design.alphaThresholded) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
  }

  const rawBlob = await canvas.convertToBlob({ type: 'image/png' });
  const rawBuf = new Uint8Array(await rawBlob.arrayBuffer());

  const finalBuf = injectPngDpi(rawBuf, exportDpi);
  const finalBlob = new Blob([finalBuf], { type: 'image/png' });

  canvas.width = 0;
  canvas.height = 0;
  for (const d of designs) d.bitmap.close();

  return finalBlob;
}

self.onmessage = async function(e: MessageEvent) {
  if (e.data.type === 'export') {
    const designs = e.data.designs as ExportInput['designs'] | undefined;
    try {
      const blob = await runExport(e.data);
      self.postMessage({ type: 'result', requestId: e.data.requestId, blob });
    } catch (err: any) {
      if (designs) for (const d of designs) { try { d.bitmap.close(); } catch {} }
      self.postMessage({ type: 'error', requestId: e.data.requestId, error: err?.message || 'Export failed' });
    }
  }
};
