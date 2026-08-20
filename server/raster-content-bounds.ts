import sharp from "sharp";

export type SharpReadOpts = {
  failOn: "none";
  sequentialRead: boolean;
  limitInputPixels: number;
};

export type RasterContentBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RasterAlphaAnalysis = RasterContentBounds & {
  hasTransparentPixels: boolean;
  binaryAlpha: boolean;
};

/**
 * Inspect the exact alpha plane of an oriented raster.
 *
 * A former implementation used a reduced alpha probe and then ran Sharp's
 * full-resolution trim twice at once: once from the top-left and again after
 * mirroring to find the opposite edges. A sparse transparent edge could be
 * missed by the probe, while two concurrent full-resolution decodes could push
 * a large transparent PNG over the production memory limit.
 *
 * This one native-depth alpha pass determines all three properties exactly:
 * whether any pixel is transparent, whether every visible pixel is hard-edged,
 * and the visible content box. Sharp exposes raw output as a stream. Its native
 * encoder can emit one or several chunks, but either way there is only one
 * decoded pipeline and one alpha channel of output alive at a time.
 */
export async function inspectRasterAlpha(
  filePath: string,
  sharpOpts: SharpReadOpts,
  srcW: number,
  srcH: number,
  sourceDepth: "uchar" | "ushort",
): Promise<RasterAlphaAnalysis> {
  const full = {
    left: 0,
    top: 0,
    width: srcW,
    height: srcH,
    hasTransparentPixels: false,
    binaryAlpha: false,
  };
  let left = srcW;
  let top = srcH;
  let right = -1;
  let bottom = -1;
  let x = 0;
  let y = 0;
  let samples = 0;
  let hasTransparentPixels = false;
  let hasPartialAlpha = false;
  const bytesPerSample = sourceDepth === "ushort" ? 2 : 1;
  const opaque = sourceDepth === "ushort" ? 0xffff : 0xff;
  let pendingByte: number | null = null;

  const alpha = sharp(filePath, sharpOpts)
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .extractChannel(3)
    // Preserve 16-bit values when present: alpha 1 must remain visible rather
    // than being rounded down to zero by an 8-bit output conversion.
    .raw({ depth: sourceDepth });

  const inspectSample = (value: number) => {
    if (value === 0) {
      hasTransparentPixels = true;
    } else {
      if (value !== opaque) hasPartialAlpha = true;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    samples++;
    x++;
    if (x === srcW) {
      x = 0;
      y++;
    }
  };

  try {
    for await (const chunk of alpha) {
      let i = 0;
      if (bytesPerSample === 2 && pendingByte !== null && chunk.length > 0) {
        inspectSample(pendingByte | (chunk[i++] << 8));
        pendingByte = null;
      }

      for (; i + bytesPerSample <= chunk.length; i += bytesPerSample) {
        inspectSample(
          bytesPerSample === 1
            ? chunk[i]
            : chunk[i] | (chunk[i + 1] << 8),
        );
      }

      if (bytesPerSample === 2 && i < chunk.length) {
        pendingByte = chunk[i];
      } else if (bytesPerSample === 1 && i !== chunk.length) {
        return full;
      }
    }
  } catch {
    // An analysis failure must never turn into an unsafe partial crop—or stop
    // an import that the later preview pipeline can still render.
    return full;
  }

  if (pendingByte !== null || samples !== srcW * srcH) {
    return full;
  }
  if (right < 0 || bottom < 0) {
    return {
      ...full,
      hasTransparentPixels,
      binaryAlpha: hasTransparentPixels && !hasPartialAlpha,
    };
  }

  const width = right - left + 1;
  const height = bottom - top + 1;
  if (!(width > 0) || !(height > 0)) return full;
  if (width >= srcW && height >= srcH) {
    return {
      ...full,
      hasTransparentPixels,
      binaryAlpha: hasTransparentPixels && !hasPartialAlpha,
    };
  }
  return {
    left,
    top,
    width,
    height,
    hasTransparentPixels,
    binaryAlpha: hasTransparentPixels && !hasPartialAlpha,
  };
}