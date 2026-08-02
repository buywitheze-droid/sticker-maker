/**
 * White underbase generation for fluorescent DTF prints.
 *
 * Pipeline:
 *   1. Render all designs at SILHOUETTE_DPI (50 DPI) — below the 35 LPI
 *      halftone frequency so browser bilinear scaling averages halftone dots
 *      into smooth coverage values rather than tracing individual dots.
 *   2. Threshold alpha ≥ 5% coverage → solid binary silhouette.
 *   3. Nearest-neighbour upscale to EDT_DPI (150 DPI) for the distance transform.
 *   4. Compute Euclidean Distance Transform (EDT) — each pixel value = distance
 *      in pixels to the nearest background pixel (nearest design edge).
 *   5. Apply variable choke: pull the white boundary inward by a distance that
 *      adapts to local feature width —
 *        • Thin features (depth < thinThresh  = 0.05"):  thinChoke  (default 0.002")
 *        • Solid fills  (depth > thickThresh  = 0.15"):  thickChoke (default 0.07")
 *        • Smooth lerp in the transition zone
 *
 * Why SILHOUETTE_DPI = 50?
 *   35 LPI halftone cell = 50/35 = 1.43 px at 50 DPI → sub-pixel, so dots
 *   average to their tint value. A 5% dot (radius 0.69 px) disappears into a
 *   ~5% average per cell → included by the ≥5% threshold. A 0% background cell
 *   averages to 0 → excluded. No morphological operations needed.
 *
 * Why EDT_DPI = 150?
 *   0.002" thin choke = 0.3 px — barely sub-pixel but still meaningful as a
 *   float threshold. 0.07" thick choke = 10.5 px — resolves well. Memory for a
 *   22"×48" sheet: Float32Array ~95 MB, acceptable for a browser download.
 */

export const EDT_DPI        = 150;
const SILHOUETTE_DPI        = 50;   // below 35 LPI → halftone averages out
const ALPHA_THRESHOLD       = 13;   // 5 % of 255 — include any meaningful coverage

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

/** Nearest-neighbour upscale of a binary mask. */
function upscaleMask(
  src:  Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * srcH / dstH));
    const srcRow = sy * srcW;
    const dstRow = y  * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * srcW / dstW));
      dst[dstRow + x] = src[srcRow + sx];
    }
  }
  return dst;
}

/**
 * Composite all designs onto a canvas at SILHOUETTE_DPI (halftone averages out),
 * threshold at ≥5% alpha coverage, then upscale to EDT_DPI.
 *
 * Returns a solid-filled Uint8Array mask (1 = ink, 0 = background) at EDT_DPI.
 */
export function buildSheetSilhouetteMask(
  designs:              DesignSlim[],
  artboardWidthInches:  number,
  artboardHeightInches: number,
): { mask: Uint8Array; width: number; height: number } {
  // ── Low-res render (halftone dots average to tint values) ──────────────
  const sw = Math.max(1, Math.round(artboardWidthInches  * SILHOUETTE_DPI));
  const sh = Math.max(1, Math.round(artboardHeightInches * SILHOUETTE_DPI));

  const cvs = document.createElement('canvas');
  cvs.width  = sw;
  cvs.height = sh;
  const ctx  = cvs.getContext('2d')!;

  for (const d of designs) {
    const img    = d.imageInfo.image;
    const dw     = d.widthInches  * d.transform.s * SILHOUETTE_DPI;
    const dh     = d.heightInches * d.transform.s * SILHOUETTE_DPI;
    const cx     = d.transform.nx * sw;
    const cy     = d.transform.ny * sh;
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

  const pixels  = ctx.getImageData(0, 0, sw, sh).data;
  const lowRes  = new Uint8Array(sw * sh);
  for (let i = 0; i < lowRes.length; i++) {
    lowRes[i] = pixels[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }

  cvs.width  = 0;
  cvs.height = 0;

  // ── Upscale to EDT_DPI ─────────────────────────────────────────────────
  const w    = Math.max(1, Math.round(artboardWidthInches  * EDT_DPI));
  const h    = Math.max(1, Math.round(artboardHeightInches * EDT_DPI));
  const mask = upscaleMask(lowRes, sw, sh, w, h);

  return { mask, width: w, height: h };
}

// ─── Euclidean Distance Transform (Meijster 2-pass) ───────────────────────────

/**
 * Compute the Euclidean Distance Transform of a binary mask.
 * Returns a Float32Array where each value is the Euclidean distance (in pixels)
 * from that pixel to the nearest background pixel (mask === 0).
 * Background pixels → 0; foreground pixels → true EDT distance.
 *
 * Uses the linear-time Meijster 2-pass separable algorithm.
 */
export function computeEDT(
  mask:   Uint8Array,
  width:  number,
  height: number,
): Float32Array {
  const INF = width + height;

  // Phase 1: horizontal 1-D distance to nearest background in each row
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

  // Phase 2: vertical parabolic lower-envelope (Meijster)
  const edt = new Float32Array(width * height);
  const s   = new Int32Array(height);
  const t   = new Int32Array(height);

  for (let x = 0; x < width; x++) {
    const getG = (i: number) => g[i * width + x];
    const fval = (i: number, u: number, gi: number) => { const d = u - i; return d * d + gi * gi; };
    const sep  = (i: number, u: number, gi: number, gu: number) =>
      Math.floor((u * u - i * i + gu * gu - gi * gi) / (2 * (u - i)));

    let q = 0;
    s[0] = 0; t[0] = 0;

    for (let u = 1; u < height; u++) {
      const gu = getG(u);
      while (q >= 0 && fval(s[q], t[q], getG(s[q])) > fval(u, t[q], gu)) q--;
      if (q < 0) {
        q = 0; s[0] = u; t[0] = 0;
      } else {
        const w2 = 1 + sep(s[q], u, getG(s[q]), gu);
        if (w2 < height) { q++; s[q] = u; t[q] = w2; }
      }
    }

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
 * Erode the silhouette mask with a variable choke that adapts to local feature
 * width (depth = EDT value from the nearest design boundary).
 *
 *   t     = clamp((depth − thinThreshPx) / (thickThreshPx − thinThreshPx), 0, 1)
 *   choke = lerp(thinChokePx, thickChokePx, t)
 *   keep  = depth > choke
 *
 * Returns a Uint8Array (255 = white ink, 0 = no ink).
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
 * Steps: low-DPI silhouette → upscale → EDT → variable choke.
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

  const { mask, width, height } = buildSheetSilhouetteMask(
    designs, shWidthIn, shHeightIn,
  );

  const hasInk = mask.some(v => v > 0);
  if (!hasInk) return null;

  const edtMap = computeEDT(mask, width, height);

  const thinThreshPx  = 0.05  * EDT_DPI;   // 7.5 px — narrow features
  const thickThreshPx = 0.15  * EDT_DPI;   // 22.5 px — solid fills
  const thinChokePx   = opts.thinChoke  * EDT_DPI;
  const thickChokePx  = opts.thickChoke * EDT_DPI;

  const chorked = applyVariableChoke(
    mask, width, height, edtMap,
    thinChokePx, thickChokePx,
    thinThreshPx, thickThreshPx,
  );

  return { mask: chorked, width, height };
}
