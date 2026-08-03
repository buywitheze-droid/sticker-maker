/**
 * White underbase generation for fluorescent DTF prints.
 *
 * Pipeline:
 *   1. Render all designs onto a canvas at EDT_DPI (150 DPI), capturing the
 *      alpha channel as a raw silhouette.  At this resolution halftone dots
 *      (35 LPI) are 4.3 px per cell — individual dots are visible.
 *   2. Apply morphological CLOSING with radius = floor(EDT_DPI/75) = 2 px.
 *      Separable horizontal + vertical dilation then erosion, each pass using
 *      a prefix-sum sliding window for an O(n) centered window [x−r, x+r].
 *      At 35 LPI the maximum inter-dot gap at 5 % coverage is ≈ 3.2 px, so
 *      closing radius 2 (filling gaps up to 4 px) bridges all halftone gaps.
 *   3. Compute Euclidean Distance Transform (EDT) on the closed silhouette.
 *   4. Apply detail-safe standard choke (matches the reference pipeline):
 *        • Keep if EDT > chokeRadius  (standard erosion).
 *        • Otherwise, if the pixel is farther than 2×chokeRadius from the
 *          nearest surviving pixel it is an isolated thin feature — keep it
 *          with a minimal 0.002" choke so strokes/thin trails don't vanish.
 *   5. Output: Uint8Array at EDT_DPI (255 = white ink, 0 = none).
 *      Passed to addSpotColorVectorsFromMasksToPDF, whose worker scales it
 *      exactly 2× to SPOT_COLOR_DPI (300 DPI) — no quality loss.
 *
 * Why EDT_DPI = 150 (not 300)?
 *   A 22"×36" sheet at 300 DPI needs 71 M pixels × 4 temp arrays ≈ 285 MB.
 *   At 150 DPI it is 18 M pixels × 4 ≈ 71 MB — acceptable.  The worker's 2×
 *   upscale produces 2-pixel staircase artefacts that the vector tracer's
 *   DP simplification (ε = 1/300") collapses into clean diagonal segments.
 */

export const EDT_DPI = 150;
const CLOSE_RADIUS   = Math.floor(EDT_DPI / 75);  // 2 px at 150 DPI
const ALPHA_THRESH   = 10;
const MIN_CHOKE_IN   = 0.002;

// ─── Morphological closing (correct centered prefix-sum) ─────────────────────

/**
 * Binary morphological dilation of one row using a prefix-sum sliding window.
 * Window is CENTERED: [x-r, x+r].  O(n) time.
 * dst[base + x] = 1 iff any src pixel within [x−r, x+r] is 1.
 */
function dilateRow(
  src: Uint8Array, dst: Uint8Array,
  base: number, len: number, r: number,
): void {
  // prefix[i] = sum of src[base .. base+i-1]
  let sum = 0;
  const ps = new Int32Array(len + 1);
  for (let i = 0; i < len; i++) { ps[i] = sum; sum += src[base + i]; }
  ps[len] = sum;

  for (let x = 0; x < len; x++) {
    const lo = Math.max(0, x - r);
    const hi = Math.min(len, x + r + 1);
    dst[base + x] = ps[hi] - ps[lo] > 0 ? 1 : 0;
  }
}

/** Binary morphological dilation of one column.  O(n). */
function dilateCol(
  src: Uint8Array, dst: Uint8Array,
  x: number, w: number, h: number, r: number,
): void {
  let sum = 0;
  const ps = new Int32Array(h + 1);
  for (let i = 0; i < h; i++) { ps[i] = sum; sum += src[i * w + x]; }
  ps[h] = sum;

  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r);
    const hi = Math.min(h, y + r + 1);
    dst[y * w + x] = ps[hi] - ps[lo] > 0 ? 1 : 0;
  }
}

/** Binary morphological erosion of one row.  O(n). */
function erodeRow(
  src: Uint8Array, dst: Uint8Array,
  base: number, len: number, r: number,
): void {
  let sum = 0;
  const ps = new Int32Array(len + 1);
  for (let i = 0; i < len; i++) { ps[i] = sum; sum += src[base + i]; }
  ps[len] = sum;

  for (let x = 0; x < len; x++) {
    const lo = Math.max(0, x - r);
    const hi = Math.min(len, x + r + 1);
    dst[base + x] = ps[hi] - ps[lo] === hi - lo ? 1 : 0;
  }
}

/** Binary morphological erosion of one column.  O(n). */
function erodeCol(
  src: Uint8Array, dst: Uint8Array,
  x: number, w: number, h: number, r: number,
): void {
  let sum = 0;
  const ps = new Int32Array(h + 1);
  for (let i = 0; i < h; i++) { ps[i] = sum; sum += src[i * w + x]; }
  ps[h] = sum;

  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r);
    const hi = Math.min(h, y + r + 1);
    dst[y * w + x] = ps[hi] - ps[lo] === hi - lo ? 1 : 0;
  }
}

/**
 * Morphological closing: dilation by `r` then erosion by `r`.
 * Separable rectangular structuring element — four O(n) passes.
 * Fills holes narrower than 2r without expanding the outer boundary.
 */
function morphClose(
  mask: Uint8Array, width: number, height: number, r: number,
): Uint8Array {
  if (r <= 0) return mask.slice();
  const a = new Uint8Array(width * height);  // after H-dilate
  const b = new Uint8Array(width * height);  // after V-dilate  (= dilated mask)
  const c = new Uint8Array(width * height);  // after H-erode
  const d = new Uint8Array(width * height);  // after V-erode   (= closed mask)

  for (let y = 0; y < height; y++) dilateRow(mask, a, y * width, width, r);
  for (let x = 0; x < width;  x++) dilateCol(a,    b, x, width, height, r);
  for (let y = 0; y < height; y++) erodeRow(b,     c, y * width, width, r);
  for (let x = 0; x < width;  x++) erodeCol(c,     d, x, width, height, r);
  return d;
}

// ─── Silhouette rasterisation ─────────────────────────────────────────────────

export interface DesignSlim {
  imageInfo: { image: HTMLImageElement };
  widthInches:  number;
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
 * Composite all designs at EDT_DPI, extract alpha ≥ ALPHA_THRESH as a binary
 * silhouette, apply morphological closing to fill halftone inter-dot gaps,
 * and return the resulting Uint8Array mask.
 */
export function buildSheetSilhouetteMask(
  designs:              DesignSlim[],
  artboardWidthInches:  number,
  artboardHeightInches: number,
): { mask: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.round(artboardWidthInches  * EDT_DPI));
  const h = Math.max(1, Math.round(artboardHeightInches * EDT_DPI));

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
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
  cvs.width = 0; cvs.height = 0;  // release canvas memory

  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = pixels[i * 4 + 3] >= ALPHA_THRESH ? 1 : 0;
  }

  // Close halftone inter-dot gaps: at 35 LPI / 150 DPI the maximum gap between
  // dot edges is ≈ 3.2 px (5 % tint).  Closing radius = 2 fills gaps ≤ 4 px.
  const mask = morphClose(raw, w, h, CLOSE_RADIUS);
  return { mask, width: w, height: h };
}

// ─── Euclidean Distance Transform (Meijster 2-pass) ───────────────────────────

/**
 * Compute the EDT of `mask` (1 = foreground, 0 = background).
 * Returns Float32Array where each value = Euclidean distance in pixels to the
 * nearest mask=0 pixel.  Background pixels → 0.
 */
export function computeEDT(
  mask: Uint8Array, width: number, height: number,
): Float32Array {
  const INF = width + height;
  const g   = new Float32Array(width * height);

  // Phase 1 — horizontal 1-D distance to nearest background pixel per row
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

  // Phase 2 — vertical parabolic lower-envelope (Meijster)
  const edt = new Float32Array(width * height);
  const s   = new Int32Array(height);
  const t   = new Int32Array(height);

  for (let x = 0; x < width; x++) {
    const getG = (i: number) => g[i * width + x];
    const fval = (i: number, u: number, gi: number) => { const dv = u - i; return dv * dv + gi * gi; };
    const sep  = (i: number, u: number, gi: number, gu: number) =>
      Math.floor((u * u - i * i + gu * gu - gi * gi) / (2 * (u - i)));

    let q = 0; s[0] = 0; t[0] = 0;
    for (let u = 1; u < height; u++) {
      const gu = getG(u);
      while (q >= 0 && fval(s[q], t[q], getG(s[q])) > fval(u, t[q], gu)) q--;
      if (q < 0) { q = 0; s[0] = u; t[0] = 0; }
      else {
        const w2 = 1 + sep(s[q], u, getG(s[q]), gu);
        if (w2 < height) { q++; s[q] = u; t[q] = w2; }
      }
    }
    for (let u = height - 1; u >= 0; u--) {
      edt[u * width + x] = Math.sqrt(fval(s[q], u, getG(s[q])));
      if (u === t[q] && q > 0) q--;
    }
  }

  return edt;
}

// ─── Detail-safe standard choke ───────────────────────────────────────────────

/**
 * Apply a detail-safe standard choke (matches reference pipeline behaviour):
 *
 *   • Pixel with EDT > chokeRadius   → keep  (survived standard erosion).
 *   • Pixel with EDT ≤ chokeRadius but whose distance to the nearest surviving
 *     pixel (edtCore) > 2×chokeRadius → isolated thin feature → keep with
 *     minimal 0.002" choke so strokes / fine trails don't vanish entirely.
 *   • Everything else → discard.
 *
 * Two EDT passes: edtOrig on the silhouette; edtCore on the complement of the
 * eroded core, giving distance-to-nearest-surviving-pixel for each discarded px.
 *
 * Returns Uint8Array (255 = white ink, 0 = no ink).
 */
export function applyDetailSafeChoke(
  mask:        Uint8Array,
  width:       number,
  height:      number,
  edtOrig:     Float32Array,
  chokeRadius: number,
  minChokePx:  number,
): Uint8Array {
  const n = width * height;

  // Build core mask (pixels that survive standard erosion)
  const coreMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) coreMask[i] = edtOrig[i] > chokeRadius ? 1 : 0;

  // Invert: computeEDT gives distance to nearest 0 → we want distance to
  // nearest core pixel = nearest 1 in coreMask = nearest 0 in ~coreMask.
  const invCore = new Uint8Array(n);
  for (let i = 0; i < n; i++) invCore[i] = coreMask[i] ^ 1;
  const edtCore = computeEDT(invCore, width, height);

  const out  = new Uint8Array(n);
  const twoR = 2 * chokeRadius;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (edtOrig[i] > chokeRadius) {
      out[i] = 255;                               // survived standard choke
    } else if (edtCore[i] > twoR && edtOrig[i] > minChokePx) {
      out[i] = 255;                               // thin feature: minimal choke
    }
  }
  return out;
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────

export interface WhiteUnderbbaseOptions {
  enabled: boolean;
  choke:   number;  // inches — single standard choke distance
}

/**
 * Build the full-sheet white underbase raster mask.
 * Returns null when disabled or there are no designs.
 *
 * Output is a Uint8Array (255/0) at EDT_DPI resolution, suitable for
 * addSpotColorVectorsFromMasksToPDF as the full-sheet RDG_WHITE channel.
 */
export function buildWhiteUnderbaseMask(
  designs:    DesignSlim[],
  shWidthIn:  number,
  shHeightIn: number,
  opts:       WhiteUnderbbaseOptions,
): { mask: Uint8Array; width: number; height: number } | null {
  if (!opts.enabled || designs.length === 0) return null;

  const { mask, width, height } = buildSheetSilhouetteMask(designs, shWidthIn, shHeightIn);
  if (!mask.some(v => v > 0)) return null;

  const edtOrig    = computeEDT(mask, width, height);
  const chokeRadius = opts.choke  * EDT_DPI;
  const minChokePx  = MIN_CHOKE_IN * EDT_DPI;

  return {
    mask: applyDetailSafeChoke(mask, width, height, edtOrig, chokeRadius, minChokePx),
    width,
    height,
  };
}
