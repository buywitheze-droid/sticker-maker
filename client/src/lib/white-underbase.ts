/**
 * White underbase generation for fluorescent DTF prints.
 *
 * Pipeline:
 *   1. Rasterise all designs into a binary silhouette mask at EDT_DPI.
 *   2. Apply morphological CLOSING (dilate → erode) to fill inter-dot gaps
 *      left by halftone screening.  This gives a solid filled shape under the
 *      entire design area instead of tracing each halftone dot separately.
 *   3. Compute Euclidean Distance Transform (EDT) on the closed mask.
 *   4. Apply variable choke: pull the white boundary inward by a distance
 *      that adapts to local feature width —
 *        • Thin features / small dots (depth < thinThresh): thinChoke  (default 0.002")
 *        • Solid fills  (depth > thickThresh):             thickChoke (default 0.07")
 *        • Smooth lerp in the transition zone
 *
 * Halftone reference (35 LPI @ 300 DPI):
 *   cell ≈ 8.57 px = 0.0286",  maxR ≈ 6.17 px = 0.0206"
 *   5% dot radius ≈ 1.38 px = 0.0046"
 *   At EDT_DPI=150, halftone cell ≈ 4.3 px.
 *   CLOSING_RADIUS = 6 px fills gaps up to 12 px (0.08") wide — enough to
 *   bridge all standard halftone inter-dot gaps without expanding the outer
 *   design boundary visibly.
 */

/** Processing DPI for EDT, closing, and the output raster.
 *  150 DPI balances choke precision vs memory:
 *  a 22"×48" sheet → Float32Array ~95 MB, which browsers handle. */
export const EDT_DPI = 150;

/**
 * Morphological closing radius in pixels at EDT_DPI.
 * = ceil(EDT_DPI / LPI * 1.4) ≈ 6 px for LPI=35.
 * Fills halftone inter-dot gaps without measurably expanding the outer shape. */
const CLOSING_RADIUS = 6;

// ─── Sliding-window max / min (Lemire O(n)) ──────────────────────────────────

/** 1-D sliding-window maximum over a row array using a monotone deque.  O(n). */
function slidingMaxRow(
  src: Uint8Array,
  dst: Uint8Array,
  base: number,    // row start index in src/dst
  len: number,
  radius: number,
): void {
  // deq holds column indices; src[deq[front]] is always the current window max
  const deq = new Int32Array(len + 1);
  let front = 0, back = -1;
  for (let x = 0; x < len; x++) {
    // evict entries that fell out of the window
    while (front <= back && deq[front] < x - radius) front++;
    // evict back entries smaller than current value
    while (front <= back && src[base + deq[back]] <= src[base + x]) back--;
    deq[++back] = x;
    // The window max is only valid once we have a full window (or at start)
    dst[base + x] = src[base + deq[front]];
  }
}

/** 1-D sliding-window minimum over a row array using a monotone deque.  O(n). */
function slidingMinRow(
  src: Uint8Array,
  dst: Uint8Array,
  base: number,
  len: number,
  radius: number,
): void {
  const deq = new Int32Array(len + 1);
  let front = 0, back = -1;
  for (let x = 0; x < len; x++) {
    while (front <= back && deq[front] < x - radius) front++;
    while (front <= back && src[base + deq[back]] >= src[base + x]) back--;
    deq[++back] = x;
    dst[base + x] = src[base + deq[front]];
  }
}

/** 1-D sliding-window maximum over a column.  O(n). */
function slidingMaxCol(
  src: Uint8Array,
  dst: Uint8Array,
  x: number,
  width: number,
  height: number,
  radius: number,
): void {
  const deq = new Int32Array(height + 1);
  let front = 0, back = -1;
  for (let y = 0; y < height; y++) {
    while (front <= back && deq[front] < y - radius) front++;
    while (front <= back && src[deq[back] * width + x] <= src[y * width + x]) back--;
    deq[++back] = y;
    dst[y * width + x] = src[deq[front] * width + x];
  }
}

/** 1-D sliding-window minimum over a column.  O(n). */
function slidingMinCol(
  src: Uint8Array,
  dst: Uint8Array,
  x: number,
  width: number,
  height: number,
  radius: number,
): void {
  const deq = new Int32Array(height + 1);
  let front = 0, back = -1;
  for (let y = 0; y < height; y++) {
    while (front <= back && deq[front] < y - radius) front++;
    while (front <= back && src[deq[back] * width + x] >= src[y * width + x]) back--;
    deq[++back] = y;
    dst[y * width + x] = src[deq[front] * width + x];
  }
}

/**
 * Morphological closing: dilation by `radius` then erosion by `radius`.
 * Uses separable horizontal + vertical passes (rectangular structuring element).
 * Fills holes smaller than 2×radius pixels wide without expanding the outer edge.
 * All operations are O(n) thanks to the sliding-window deque.
 */
function morphClose(
  mask:   Uint8Array,
  width:  number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask;
  const tmp1 = new Uint8Array(width * height);
  const tmp2 = new Uint8Array(width * height);
  const out  = new Uint8Array(width * height);

  // Dilation: horizontal pass
  for (let y = 0; y < height; y++) slidingMaxRow(mask, tmp1, y * width, width, radius);
  // Dilation: vertical pass
  for (let x = 0; x < width;  x++) slidingMaxCol(tmp1, tmp2, x, width, height, radius);
  // Erosion: horizontal pass
  for (let y = 0; y < height; y++) slidingMinRow(tmp2, tmp1, y * width, width, radius);
  // Erosion: vertical pass
  for (let x = 0; x < width;  x++) slidingMinCol(tmp1, out,  x, width, height, radius);

  return out;
}

// ─── Silhouette rasterisation ─────────────────────────────────────────────────

export interface DesignSlim {
  imageInfo: { image: HTMLImageElement };
  widthInches: number;
  heightInches: number;
  transform: {
    s: number;
    nx: number;
    ny: number;
    rotation?: number | null;
    flipX?: boolean;
    flipY?: boolean;
  };
}

/**
 * Composite all designs onto a full-sheet canvas at EDT_DPI, extract the
 * alpha channel as a binary silhouette, then apply morphological closing to
 * fill halftone inter-dot gaps.
 *
 * Returns a solid-filled Uint8Array mask (1 = ink, 0 = background).
 */
export function buildSheetSilhouetteMask(
  designs: DesignSlim[],
  artboardWidthInches:  number,
  artboardHeightInches: number,
): { mask: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.round(artboardWidthInches  * EDT_DPI));
  const h = Math.max(1, Math.round(artboardHeightInches * EDT_DPI));

  const cvs = document.createElement('canvas');
  cvs.width  = w;
  cvs.height = h;
  const ctx = cvs.getContext('2d')!;

  for (const d of designs) {
    const img    = d.imageInfo.image;
    const dw     = d.widthInches  * d.transform.s * EDT_DPI;
    const dh     = d.heightInches * d.transform.s * EDT_DPI;
    const cx     = d.transform.nx * w;
    const cy     = d.transform.ny * h;
    const rotRad = ((d.transform.rotation ?? 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    if (d.transform.flipX || d.transform.flipY) {
      ctx.scale(d.transform.flipX ? -1 : 1, d.transform.flipY ? -1 : 1);
    }
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  const pixels = ctx.getImageData(0, 0, w, h).data;

  // Raw silhouette: any pixel with alpha ≥ 10 is foreground.
  // Use a lower threshold (1) to capture semi-transparent fringe pixels —
  // the closing step will merge isolated fringe pixels into the solid shape.
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = pixels[i * 4 + 3] >= 1 ? 1 : 0;
  }

  // Release canvas memory
  cvs.width  = 0;
  cvs.height = 0;

  // Morphological closing fills halftone inter-dot gaps.
  // CLOSING_RADIUS = 6 px @ 150 DPI = 0.04" — bridges halftone dot gaps
  // (35 LPI cell ≈ 4.3 px @ 150 DPI) without expanding the outer boundary
  // by more than ~1 px after the closing erosion reverses the dilation.
  const closed = morphClose(raw, w, h, CLOSING_RADIUS);

  return { mask: closed, width: w, height: h };
}

// ─── Euclidean Distance Transform (Meijster 2-pass) ───────────────────────────

/**
 * Compute the Euclidean Distance Transform of a binary mask.
 * Returns a Float32Array where each value is the Euclidean distance (in pixels)
 * from that pixel to the nearest background pixel (mask === 0).
 * Background pixels get 0; foreground pixels get their true EDT distance.
 *
 * Uses the linear-time Meijster 2-pass separable algorithm.
 */
export function computeEDT(
  mask:   Uint8Array,
  width:  number,
  height: number,
): Float32Array {
  const INF = width + height; // safe upper bound for 1-D distances

  // ── Phase 1: horizontal 1-D distance to nearest background in each row ──
  const g = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let d = INF;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] === 0) d = 0; else if (d < INF) d++;
      g[row + x] = d;
    }
    d = INF;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x] === 0) d = 0; else if (d < INF) d++;
      if (d < g[row + x]) g[row + x] = d;
    }
  }

  // ── Phase 2: vertical parabolic lower-envelope (Meijster) ──────────────
  const edt = new Float32Array(width * height);
  const s   = new Int32Array(height);  // parabola center row indices
  const t   = new Int32Array(height);  // start rows of each parabola's dominance

  for (let x = 0; x < width; x++) {
    const getG  = (i: number) => g[i * width + x];
    const fval  = (i: number, u: number, gi: number) => { const d = u - i; return d * d + gi * gi; };
    const sep   = (i: number, u: number, gi: number, gu: number) =>
      Math.floor((u * u - i * i + gu * gu - gi * gi) / (2 * (u - i)));

    // Forward pass — build lower parabolic envelope
    let q = 0;
    s[0] = 0; t[0] = 0;

    for (let u = 1; u < height; u++) {
      const gu = getG(u);
      while (q >= 0 && fval(s[q], t[q], getG(s[q])) > fval(u, t[q], gu)) q--;
      if (q < 0) {
        q = 0; s[0] = u; t[0] = 0;
      } else {
        const w2 = 1 + sep(s[q], u, getG(s[q]), gu);
        if (w2 < height) {
          q++;
          s[q] = u;
          t[q] = w2;
        }
      }
    }

    // Backward pass — assign final distances
    for (let u = height - 1; u >= 0; u--) {
      const gi = getG(s[q]);
      edt[u * width + x] = Math.sqrt(fval(s[q], u, gi));
      if (u === t[q] && q > 0) q--;
    }
  }

  return edt;
}

// ─── Variable choke ───────────────────────────────────────────────────────────

/**
 * Erode a closed silhouette mask with a variable choke that adapts to local
 * feature width (represented by the pixel's EDT depth from the design boundary).
 *
 *   t     = clamp((depth − thinThreshPx) / (thickThreshPx − thinThreshPx), 0, 1)
 *   choke = lerp(thinChokePx, thickChokePx, t)
 *   keep  = depth > choke
 *
 * Result: thin features and halftone dot edges get minimal choke (preserving
 * coverage) while bulk fills get the standard safety margin.
 *
 * Returns a Uint8Array (255 = white ink present, 0 = no ink).
 */
export function applyVariableChoke(
  mask:          Uint8Array,
  width:         number,
  height:        number,
  edtMap:        Float32Array,
  thinChokePx:   number,
  thickChokePx:  number,
  thinThreshPx:  number,
  thickThreshPx: number,
): Uint8Array {
  const out   = new Uint8Array(width * height);
  const range = Math.max(0, thickThreshPx - thinThreshPx);

  for (let i = 0; i < out.length; i++) {
    if (mask[i] === 0) continue;
    const depth = edtMap[i];
    const t     = range > 0
      ? Math.max(0, Math.min(1, (depth - thinThreshPx) / range))
      : (depth >= thinThreshPx ? 1 : 0);
    const choke = thinChokePx + t * (thickChokePx - thinChokePx);
    if (depth > choke) out[i] = 255;
  }

  return out;
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────

export interface WhiteUnderbbaseOptions {
  enabled:    boolean;
  thinChoke:  number;  // inches
  thickChoke: number;  // inches
}

/**
 * Build the white underbase raster mask for an entire sheet.
 * Returns null when underbase is disabled or there are no designs.
 *
 * Steps: silhouette → morphological closing → EDT → variable choke.
 * The returned mask is at EDT_DPI resolution, ready to pass to
 * addSpotColorVectorsFromMasksToPDF as a full-sheet RDG_WHITE channel.
 */
export function buildWhiteUnderbaseMask(
  designs:    DesignSlim[],
  shWidthIn:  number,
  shHeightIn: number,
  opts:       WhiteUnderbbaseOptions,
): { mask: Uint8Array; width: number; height: number } | null {
  if (!opts.enabled || designs.length === 0) return null;

  const { mask: closed, width, height } = buildSheetSilhouetteMask(
    designs, shWidthIn, shHeightIn,
  );

  const hasInk = closed.some(v => v > 0);
  if (!hasInk) return null;

  const edtMap = computeEDT(closed, width, height);

  // Thresholds:
  //   thinThresh  = 0.05" — features narrower than this use thinChoke
  //   thickThresh = 0.15" — features wider than this use thickChoke
  const thinThreshPx  = 0.05  * EDT_DPI;
  const thickThreshPx = 0.15  * EDT_DPI;
  const thinChokePx   = opts.thinChoke  * EDT_DPI;
  const thickChokePx  = opts.thickChoke * EDT_DPI;

  const chorked = applyVariableChoke(
    closed, width, height, edtMap,
    thinChokePx, thickChokePx,
    thinThreshPx, thickThreshPx,
  );

  return { mask: chorked, width, height };
}
