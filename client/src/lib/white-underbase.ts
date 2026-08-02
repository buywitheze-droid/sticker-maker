/**
 * White underbase generation for fluorescent DTF prints.
 *
 * Produces a full-sheet RDG_WHITE silhouette with variable choke applied via
 * Euclidean Distance Transform (EDT).  Variable choke preserves fine details
 * and small halftone dots while applying a standard safety margin to bulk fills:
 *
 *   • Thin features (depth < thinThresh): thinChoke  (default 0.002")
 *   • Solid fills  (depth > thickThresh): thickChoke (default 0.07")
 *   • Blend region: lerp between the two
 *
 * Halftone reference (35 LPI @ 300 DPI):
 *   cell ≈ 8.57 px = 0.0286",  maxR ≈ 6.17 px = 0.0206"
 *   5% dot radius ≈ 1.38 px = 0.0046"
 *   A 0.002" thin choke (0.3 px @ 150 DPI) covers edge-adjacent dots
 *   without erasing them while 0.07" thick choke is the standard white
 *   ink safety margin for solid fills.
 */

/** DPI used internally for EDT and the output raster.
 *  150 DPI balances choke precision (0.002" = 0.3 px) against memory:
 *  a 22"×48" sheet uses ~24M Float32 values ≈ 95 MB — acceptable for a
 *  browser download operation. */
export const EDT_DPI = 150;

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
 * Composite all designs onto a full-sheet canvas at EDT_DPI and extract the
 * alpha channel as a binary silhouette mask (1 = ink, 0 = background).
 */
export function buildSheetSilhouetteMask(
  designs: DesignSlim[],
  artboardWidthInches: number,
  artboardHeightInches: number,
): { mask: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.round(artboardWidthInches  * EDT_DPI));
  const h = Math.max(1, Math.round(artboardHeightInches * EDT_DPI));

  const cvs = document.createElement('canvas');
  cvs.width  = w;
  cvs.height = h;
  const ctx = cvs.getContext('2d')!;

  for (const d of designs) {
    const img = d.imageInfo.image;
    const dw  = d.widthInches  * d.transform.s * EDT_DPI;
    const dh  = d.heightInches * d.transform.s * EDT_DPI;
    const cx  = d.transform.nx * w;
    const cy  = d.transform.ny * h;
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
  const mask   = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = pixels[i * 4 + 3] >= 10 ? 1 : 0;
  }

  // Release canvas memory
  cvs.width  = 0;
  cvs.height = 0;

  return { mask, width: w, height: h };
}

// ─── Euclidean Distance Transform (Meijster 2-pass) ───────────────────────────

/**
 * Compute the Euclidean Distance Transform of a binary mask.
 * Returns a Float32Array where each value is the distance (in pixels) from
 * that pixel to the nearest background pixel (mask === 0).
 * Background pixels get distance 0; foreground pixels get their true EDT.
 *
 * Uses the linear-time Meijster algorithm (2-pass separable approach).
 */
export function computeEDT(
  mask:   Uint8Array,
  width:  number,
  height: number,
): Float32Array {
  const INF = width + height; // safe upper bound for 1-D distances

  // ── Phase 1: horizontal 1-D distance to nearest background in each row ──
  // g[y*width + x] = min horizontal distance to a 0-pixel in that row.
  const g = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    // left → right
    let d = INF;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] === 0) d = 0; else if (d < INF) d++;
      g[row + x] = d;
    }
    // right → left, keep minimum
    d = INF;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x] === 0) d = 0; else if (d < INF) d++;
      if (d < g[row + x]) g[row + x] = d;
    }
  }

  // ── Phase 2: vertical parabolic lower-envelope (Meijster) ─────────────
  // For each column, compute:
  //   EDT[y][x] = sqrt( min_i { (y-i)^2 + g[i][x]^2 } )
  const edt = new Float32Array(width * height);
  const s   = new Int32Array(height);   // parabola center indices
  const t   = new Int32Array(height);   // intersection positions

  for (let x = 0; x < width; x++) {
    const getG  = (i: number) => g[i * width + x];
    // Parabola value at column u, centered at row i with horizontal dist gi
    const fval  = (i: number, u: number, gi: number) => { const d = u - i; return d * d + gi * gi; };
    // Intersection of parabolas centered at i and u
    const sep   = (i: number, u: number, gi: number, gu: number) =>
      Math.floor((u * u - i * i + gu * gu - gi * gi) / (2 * (u - i)));

    // Forward pass — build lower envelope
    let q = 0;
    s[0] = 0; t[0] = 0;

    for (let u = 1; u < height; u++) {
      const gu = getG(u);
      while (q >= 0 && fval(s[q], t[q], getG(s[q])) > fval(u, t[q], gu)) q--;
      if (q < 0) {
        q = 0; s[0] = u; t[0] = 0;
      } else {
        const w = 1 + sep(s[q], u, getG(s[q]), gu);
        if (w < height) {
          q++;
          s[q] = u;
          t[q] = w;
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
 * Erode a silhouette mask with a variable choke that adapts to local feature width.
 *
 * Each pixel's required choke is linearly interpolated between thinChokePx and
 * thickChokePx based on its EDT depth:
 *
 *   t     = clamp((depth - thinThreshPx) / (thickThreshPx - thinThreshPx), 0, 1)
 *   choke = lerp(thinChokePx, thickChokePx, t)
 *
 * A pixel is kept in the white layer only if its depth exceeds its choke:
 *   keep = depth > choke(depth)
 *
 * Returns a new Uint8Array (255 = white ink, 0 = no ink).
 */
export function applyVariableChoke(
  mask:          Uint8Array,
  width:         number,
  height:        number,
  edtMap:        Float32Array,
  thinChokePx:   number,   // choke for thin features (pixels)
  thickChokePx:  number,   // choke for thick/solid areas (pixels)
  thinThreshPx:  number,   // EDT depth at which thin choke applies (pixels)
  thickThreshPx: number,   // EDT depth at which thick choke fully applies (pixels)
): Uint8Array {
  const out   = new Uint8Array(width * height);
  const range = Math.max(0, thickThreshPx - thinThreshPx);

  for (let i = 0; i < out.length; i++) {
    if (mask[i] === 0) continue;
    const depth = edtMap[i];
    // Normalised position within the thin→thick transition [0, 1]
    const t     = range > 0
      ? Math.max(0, Math.min(1, (depth - thinThreshPx) / range))
      : (depth >= thinThreshPx ? 1 : 0);
    const choke = thinChokePx + t * (thickChokePx - thinChokePx);
    if (depth > choke) out[i] = 255;
  }

  return out;
}

// ─── Convenience wrapper ───────────────────────────────────────────────────────

export interface WhiteUnderbbaseOptions {
  enabled:    boolean;
  thinChoke:  number;  // inches
  thickChoke: number;  // inches
}

/**
 * Build the white underbase raster mask for an entire sheet.
 * Returns null when underbase is disabled or there are no designs.
 *
 * The returned mask is at EDT_DPI resolution, ready to pass to
 * addSpotColorRastersToPDF as a full-sheet RDG_WHITE channel.
 */
export function buildWhiteUnderbaseMask(
  designs:    DesignSlim[],
  shWidthIn:  number,
  shHeightIn: number,
  opts:       WhiteUnderbbaseOptions,
): { mask: Uint8Array; width: number; height: number } | null {
  if (!opts.enabled || designs.length === 0) return null;

  const { mask, width, height } = buildSheetSilhouetteMask(designs, shWidthIn, shHeightIn);

  const hasInk = mask.some(v => v > 0);
  if (!hasInk) return null;

  const edtMap  = computeEDT(mask, width, height);

  // Default thresholds:
  //   thinThresh  = 0.05" — features narrower than this use thin choke
  //   thickThresh = 0.15" — features wider than this use thick choke
  const thinThreshPx  = 0.05  * EDT_DPI;
  const thickThreshPx = 0.15  * EDT_DPI;
  const thinChokePx   = opts.thinChoke  * EDT_DPI;
  const thickChokePx  = opts.thickChoke * EDT_DPI;

  const chorked = applyVariableChoke(
    mask, width, height, edtMap,
    thinChokePx, thickChokePx,
    thinThreshPx, thickThreshPx,
  );

  return { mask: chorked, width, height };
}
