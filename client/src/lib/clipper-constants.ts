// Unified Clipper constants and utility functions
// All Clipper operations should use these shared values for consistency

export const CLIPPER_SCALE = 100000;

export interface ClipperTolerances {
  arcTolerance: number;
  miterLimit: number;
  simplifyTolerance: number;
}

export function calculateClipperTolerances(
  dpi: number,
  offsetPixels: number
): ClipperTolerances {
  const scale = CLIPPER_SCALE;
  
  // ArcTolerance: controls curve smoothness in offset operations
  // Formula: max(0.05 * scale, offset * scale * 0.05)
  // Smaller values = smoother curves but more points
  // Scale based on offset size - larger offsets need more arc precision
  const baseArc = 0.05 * scale;
  const offsetArc = Math.abs(offsetPixels) * scale * 0.05;
  const arcTolerance = Math.max(baseArc, offsetArc);
  
  // MiterLimit: controls sharp corner behavior
  // Higher values = sharper miters allowed before beveling
  // Scale with offset - larger offsets need larger miter limits
  // Range: 2.0 (small offsets) to 4.0 (large offsets)
  const miterLimit = Math.min(4.0, Math.max(2.0, 2.0 + Math.abs(offsetPixels) / 20));
  
  // SimplifyTolerance: for CleanPolygon operations
  // Scale by offset width so small offsets don't get over-simplified
  // Minimum 0.5px equivalent, scales up with offset size (5% of offset)
  const minSimplify = 0.5;
  const offsetBasedSimplify = Math.abs(offsetPixels) * 0.05;
  const simplifyTolerance = Math.max(minSimplify, offsetBasedSimplify);
  
  return {
    arcTolerance,
    miterLimit,
    simplifyTolerance
  };
}

export function toClipperPoint(p: { x: number; y: number }): { X: number; Y: number } {
  return {
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  };
}

export function fromClipperPoint(p: { X: number; Y: number }): { x: number; y: number } {
  return {
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE
  };
}

export function toClipperPath(points: Array<{ x: number; y: number }>): Array<{ X: number; Y: number }> {
  return points.map(toClipperPoint);
}

export function fromClipperPath(path: Array<{ X: number; Y: number }>): Array<{ x: number; y: number }> {
  return path.map(fromClipperPoint);
}
