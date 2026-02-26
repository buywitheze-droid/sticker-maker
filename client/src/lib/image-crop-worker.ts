interface CropResult {
  processedBuffer: ArrayBuffer;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  bgRemoved: boolean;
}

function detectEdgeBg(data: Uint8ClampedArray, w: number, h: number): { r: number; g: number; b: number } | null {
  const samples: Array<{ r: number; g: number; b: number }> = [];
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  const addPx = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] > 200) samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  };
  for (let x = 0; x < w; x += step) { addPx(x, 0); addPx(x, h - 1); }
  for (let y = 0; y < h; y += step) { addPx(0, y); addPx(w - 1, y); }
  if (samples.length < 8) return null;

  const TOL = 30;
  const counts = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (const s of samples) {
    const key = `${Math.round(s.r / TOL)},${Math.round(s.g / TOL)},${Math.round(s.b / TOL)}`;
    const e = counts.get(key);
    if (e) { e.r += s.r; e.g += s.g; e.b += s.b; e.n++; }
    else counts.set(key, { r: s.r, g: s.g, b: s.b, n: 1 });
  }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  if (!best || best.n / samples.length < 0.7) return null;
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

function removeBg(data: Uint8ClampedArray, w: number, h: number, bg: { r: number; g: number; b: number }, tol: number = 35): boolean {
  const totalPixels = w * h;
  const visited = new Uint8Array(totalPixels);
  const queue: number[] = [];
  const matches = (idx: number) => {
    const i = idx * 4;
    if (data[i + 3] < 20) return true;
    return Math.abs(data[i] - bg.r) < tol && Math.abs(data[i + 1] - bg.g) < tol && Math.abs(data[i + 2] - bg.b) < tol;
  };
  for (let x = 0; x < w; x++) {
    if (matches(x)) { queue.push(x); visited[x] = 1; }
    const b = (h - 1) * w + x;
    if (matches(b)) { queue.push(b); visited[b] = 1; }
  }
  for (let y = 1; y < h - 1; y++) {
    const l = y * w;
    if (matches(l)) { queue.push(l); visited[l] = 1; }
    const r = y * w + w - 1;
    if (matches(r)) { queue.push(r); visited[r] = 1; }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    data[idx * 4 + 3] = 0;
    const x = idx % w, y = (idx - x) / w;
    if (x > 0 && !visited[idx - 1] && matches(idx - 1)) { visited[idx - 1] = 1; queue.push(idx - 1); }
    if (x < w - 1 && !visited[idx + 1] && matches(idx + 1)) { visited[idx + 1] = 1; queue.push(idx + 1); }
    if (y > 0 && !visited[idx - w] && matches(idx - w)) { visited[idx - w] = 1; queue.push(idx - w); }
    if (y < h - 1 && !visited[idx + w] && matches(idx + w)) { visited[idx + w] = 1; queue.push(idx + w); }
  }

  if (queue.length > totalPixels * 0.95) {
    return false;
  }

  const widerTol = tol + 25;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * 4;
      if (data[i + 3] === 0) continue;
      let adj = false;
      if (x > 0 && data[((y) * w + (x - 1)) * 4 + 3] === 0) adj = true;
      else if (x < w - 1 && data[((y) * w + (x + 1)) * 4 + 3] === 0) adj = true;
      else if (y > 0 && data[((y - 1) * w + x) * 4 + 3] === 0) adj = true;
      else if (y < h - 1 && data[((y + 1) * w + x) * 4 + 3] === 0) adj = true;
      if (!adj) continue;
      const dr = Math.abs(data[i] - bg.r);
      const dg = Math.abs(data[i + 1] - bg.g);
      const db = Math.abs(data[i + 2] - bg.b);
      if (dr < widerTol && dg < widerTol && db < widerTol) {
        const maxDiff = Math.max(dr, dg, db);
        if (maxDiff < tol) {
          data[i + 3] = 0;
        } else {
          data[i + 3] = Math.round(((maxDiff - tol) / (widerTol - tol)) * data[i + 3]);
        }
      }
    }
  }

  return true;
}

function processCrop(pixelBuffer: ArrayBuffer, w: number, h: number): CropResult {
  const data = new Uint8ClampedArray(pixelBuffer);

  let opaqueCount = 0;
  const sampleStep = Math.max(1, Math.floor(data.length / 4 / 10000));
  for (let i = 3; i < data.length; i += sampleStep * 4) {
    if (data[i] > 240) opaqueCount++;
  }
  const totalSampled = Math.ceil(data.length / 4 / sampleStep);
  const opaqueRatio = opaqueCount / totalSampled;

  let bgRemoved = false;
  if (opaqueRatio > 0.9 && w * h <= 25_000_000) {
    const bg = detectEdgeBg(data, w, h);
    if (bg) {
      const backup = new Uint8ClampedArray(data);
      const ok = removeBg(data, w, h, bg);
      if (!ok) {
        data.set(backup);
      } else {
        bgRemoved = true;
      }
    }
  }

  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX || minY > maxY) {
    return {
      processedBuffer: data.buffer,
      width: w, height: h,
      minX: 0, minY: 0, maxX: w - 1, maxY: h - 1,
      bgRemoved: false,
    };
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < w * 0.05 || bh < h * 0.05) {
    return {
      processedBuffer: data.buffer,
      width: w, height: h,
      minX: 0, minY: 0, maxX: w - 1, maxY: h - 1,
      bgRemoved: false,
    };
  }

  return {
    processedBuffer: data.buffer,
    width: w, height: h,
    minX, minY, maxX, maxY,
    bgRemoved,
  };
}

self.onmessage = function (e: MessageEvent) {
  try {
    if (e.data.type === 'crop') {
      const { pixelBuffer, width, height, requestId } = e.data;
      const result = processCrop(pixelBuffer, width, height);
      self.postMessage({ type: 'result', requestId, ...result }, [result.processedBuffer] as any);
    }
  } catch (err) {
    self.postMessage({ type: 'error', requestId: e.data?.requestId, error: String(err) });
  }
};
