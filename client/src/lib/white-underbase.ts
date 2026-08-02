/**
 * White underbase generation for fluorescent DTF prints.
 *
 * Pipeline:
 *   1. Render all designs at SILHOUETTE_DPI (50 DPI) — well below the 35 LPI
 *      halftone frequency so browser bilinear scaling averages halftone dots
 *      into smooth coverage values, giving a solid silhouette with no dot holes.
 *   2. Threshold alpha ≥ 5 % coverage (≥ 13/255) → binary silhouette mask.
 *   3. Nearest-neighbour upscale to EDT_DPI (150 DPI) for the distance transform.
 *   4. Compute Euclidean Distance Transform (EDT) — value = distance in pixels
 *      to nearest background (edge of design).
 *   5. Apply detail-safe standard choke (matches the reference agent's approach):
 *        • Standard erosion: keep if EDT > chokeRadius.
 *        • Thin-feature fallback: if a pixel would be erased (EDT ≤ chokeRadius)
 *          but is farther than 2×chokeRadius from the nearest surviving pixel
 *          (isolated thin stroke / fine detail), apply a minimal 0.002" choke
 *          instead of discarding it entirely.
 *      This is NOT variable choke — the choke is one fixed distance everywhere,
 *      with only a safety net so thin features don't vanish.
 */

export const EDT_DPI  = 150;
const SILHOUETTE_DPI  = 50;   // below halftone freq → dots average to tint
const ALPHA_THRESHOLD = 13;   // 5 % of 255
const MIN_CHOKE_IN    = 0.002; // fallback for genuinely thin features (inches)

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

/** Nearest-neighbour upscale of a binary Uint8Array mask. */
function upscaleMask(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy  = Math.min(srcH - 1, Math.floor(y * srcH / dstH));
    const sr  = sy * srcW;
    const dr  = y  * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * srcW / dstW));
      dst[dr + x] = src[sr + sx];
    }
  }
  return dst;
}

/**
 * Composite all designs at SILHOUETTE_DPI (halftone averages out), threshold
 * at ≥ 5 % alpha, then upscale to EDT_DPI.
 */
export function buildSheetSilhouetteMask(
  designs:              DesignSlim[],
  artboardWidthInches:  number,
  artboardHeightInches: number,
): { mask: Uint8Array; width: number; height: number } {
  const sw = Math.max(1, Math.round(artboardWidthInches  * SILHOUETTE_DPI));
  const sh = Math.max(1, Math.round(artboardHeightInches * SILHOUETTE_DPI));

  const cvs = document.createElement('canvas');
  cvs.width = sw; cvs.height = sh;
  const ctx = cvs.getContext('2d')!;

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

  const pixels = ctx.getImageData(0, 0, sw, sh).data;
  const lowRes = new Uint8Array(sw * sh);
  for (let i = 0; i < lowRes.length; i++) {
    lowRes[i] = pixels[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }
  cvs.width = 0; cvs.height = 0;

  const w    = Math.max(1, Math.round(artboardWidthInches  * EDT_DPI));
  const h    = Math.max(1, Math.round(artboardHeightInches * EDT_DPI));
  const mask = upscaleMask(lowRes, sw, sh, w, h);
  return { mask, width: w, height: h };
}

// ─── Euclidean Distance Transform (Meijster 2-pass) ───────────────────────────

/**
 * Compute the EDT of `mask` (1 = foreground, 0 = background).
 * Returns Float32Array where each value = distance in pixels to nearest mask=0
 * pixel.  Background pixels get 0.
 */
export function computeEDT(
  mask:   Uint8Array,
  width:  number,
  height: number,
): Float32Array {
  const INF = width + height;

  // Phase 1: horizontal 1-D distance to nearest background per row
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
 * Apply a detail-safe standard choke to the silhouette:
 *
 *   • Every pixel with EDT > chokeRadius survives (standard erosion).
 *   • Pixels that would be erased but are more than 2×chokeRadius from the
 *     nearest surviving pixel are "isolated thin features" — they fall back
 *     to the minimal 0.002" choke so fine strokes / small text don't vanish.
 *   • Everything else is discarded.
 *
 * Implemented with two EDT passes:
 *   1. edtOrig  — distance from each pixel to the design boundary.
 *   2. edtCore  — distance from each pixel to the nearest pixel that survived
 *                 the standard erosion (EDT > chokeRadius).
 *      Built by inverting the core mask and running a second EDT.
 *
 * Returns Uint8Array (255 = white ink, 0 = no ink).
 */
export function applyDetailSafeChoke(
  mask:        Uint8Array,
  width:       number,
  height:      number,
  edtOrig:     Float32Array,
  chokeRadius: number,        // pixels
  minChokePx:  number,        // pixels (fallback for thin features)
): Uint8Array {
  const n = width * height;

  // Build core mask: pixels that survive the standard erosion
  const coreMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    coreMask[i] = edtOrig[i] > chokeRadius ? 1 : 0;
  }

  // Invert core mask so that computeEDT gives "distance to nearest core pixel"
  // (computeEDT measures distance to nearest 0-valued pixel; we want distance
  // to nearest core pixel = nearest 1 in coreMask = nearest 0 in ~coreMask).
  const invertedCore = new Uint8Array(n);
  for (let i = 0; i < n; i++) invertedCore[i] = coreMask[i] ^ 1;

  const edtCore = computeEDT(invertedCore, width, height);

  // Compose final output
  const out = new Uint8Array(n);
  const twoR = 2 * chokeRadius;
  for (let i = 0; i < n; i++) {
    if (mask[i] === 0) continue;
    if (edtOrig[i] > chokeRadius) {
      // Survived standard erosion
      out[i] = 255;
    } else if (edtCore[i] > twoR && edtOrig[i] > minChokePx) {
      // Isolated thin feature — farther than 2r from any thick area;
      // apply minimal choke so it doesn't disappear entirely
      out[i] = 255;
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
 * Build the full-sheet white underbase mask.
 * Returns null when disabled or there are no designs.
 *
 * Steps: low-DPI silhouette → upscale → EDT → detail-safe standard choke.
 * The returned Uint8Array (255/0) is at EDT_DPI resolution, ready for
 * addSpotColorVectorsFromMasksToPDF as a full-sheet RDG_WHITE channel.
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
  const chokeRadius = opts.choke * EDT_DPI;          // e.g. 0.010" × 150 = 1.5 px
  const minChokePx  = MIN_CHOKE_IN * EDT_DPI;        // 0.002" × 150 = 0.3 px

  const chokedMask = applyDetailSafeChoke(
    mask, width, height, edtOrig, chokeRadius, minChokePx,
  );

  return { mask: chokedMask, width, height };
}
