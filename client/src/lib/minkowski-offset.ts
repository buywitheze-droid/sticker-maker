/**
 * Polygon Offset using Clipper.js (Angus Johnson's Clipper library)
 * 
 * This provides mathematically correct polygon offsetting using:
 * - Proper Minkowski sum calculation for convex and concave polygons
 * - Robust self-intersection handling
 * - Support for rounded (arc) and sharp (miter) corner styles
 */

// @ts-ignore - clipper-lib has no types
import * as ClipperLib from 'clipper-lib';

export interface Point {
  x: number;
  y: number;
}

export type CornerMode = 'rounded' | 'sharp';

// Clipper uses integer coordinates, so we scale by this factor for precision
const CLIPPER_SCALE = 1000;

/**
 * Offset a polygon by a given distance using Clipper library
 * @param polygon - Array of points forming a closed polygon
 * @param offset - Offset distance in pixels (positive = outward, negative = inward)
 * @param cornerMode - 'rounded' for arc corners, 'sharp' for miter corners
 * @param miterLimit - Maximum miter distance for sharp corners (default 2.0)
 */
export function offsetPolygon(
  polygon: Point[],
  offset: number,
  cornerMode: CornerMode = 'rounded',
  miterLimit: number = 2.0
): Point[] {
  if (polygon.length < 3 || offset === 0) return polygon;
  
  try {
    // Convert to Clipper format (scaled integers)
    const clipperPath: ClipperLib.IntPoint[] = polygon.map(p => ({
      X: Math.round(p.x * CLIPPER_SCALE),
      Y: Math.round(p.y * CLIPPER_SCALE)
    }));
    
    // Create ClipperOffset instance
    const co = new ClipperLib.ClipperOffset(miterLimit, 0.25 * CLIPPER_SCALE);
    
    // Choose join type based on corner mode
    const joinType = cornerMode === 'rounded' 
      ? ClipperLib.JoinType.jtRound 
      : ClipperLib.JoinType.jtMiter;
    
    // Add path with appropriate end type (closed polygon)
    co.AddPath(clipperPath, joinType, ClipperLib.EndType.etClosedPolygon);
    
    // Execute offset
    const solution: ClipperLib.IntPoint[][] = [];
    co.Execute(solution, offset * CLIPPER_SCALE);
    
    // Find the largest path by area (for shapes that produce multiple paths)
    if (solution.length > 0) {
      let bestPath = solution[0];
      let bestArea = 0;
      
      for (const path of solution) {
        if (path.length >= 3) {
          // Calculate absolute area to find the largest contour
          const area = Math.abs(ClipperLib.Clipper.Area(path));
          if (area > bestArea) {
            bestArea = area;
            bestPath = path;
          }
        }
      }
      
      if (bestPath.length >= 3) {
        return bestPath.map(p => ({
          x: p.X / CLIPPER_SCALE,
          y: p.Y / CLIPPER_SCALE
        }));
      }
    }
    
    // Fallback: return original polygon if offset fails
    return polygon;
    
  } catch (error) {
    console.error('[MinkowskiOffset] Error:', error);
    return polygon;
  }
}

/**
 * Offset multiple polygons at once (for shapes with holes)
 */
export function offsetPolygons(
  polygons: Point[][],
  offset: number,
  cornerMode: CornerMode = 'rounded',
  miterLimit: number = 2.0
): Point[][] {
  if (polygons.length === 0 || offset === 0) return polygons;
  
  try {
    const co = new ClipperLib.ClipperOffset(miterLimit, 0.25 * CLIPPER_SCALE);
    
    const joinType = cornerMode === 'rounded' 
      ? ClipperLib.JoinType.jtRound 
      : ClipperLib.JoinType.jtMiter;
    
    // Add all paths
    for (const polygon of polygons) {
      if (polygon.length >= 3) {
        const clipperPath: ClipperLib.IntPoint[] = polygon.map(p => ({
          X: Math.round(p.x * CLIPPER_SCALE),
          Y: Math.round(p.y * CLIPPER_SCALE)
        }));
        co.AddPath(clipperPath, joinType, ClipperLib.EndType.etClosedPolygon);
      }
    }
    
    const solution: ClipperLib.IntPoint[][] = [];
    co.Execute(solution, offset * CLIPPER_SCALE);
    
    return solution.map(path => 
      path.map(p => ({
        x: p.X / CLIPPER_SCALE,
        y: p.Y / CLIPPER_SCALE
      }))
    );
    
  } catch (error) {
    console.error('[MinkowskiOffset] Error offsetting polygons:', error);
    return polygons;
  }
}

/**
 * Simplify a polygon by removing collinear/near-collinear points
 */
export function simplifyPolygon(polygon: Point[], tolerance: number = 1.0): Point[] {
  if (polygon.length < 3) return polygon;
  
  try {
    const clipperPath: ClipperLib.IntPoint[] = polygon.map(p => ({
      X: Math.round(p.x * CLIPPER_SCALE),
      Y: Math.round(p.y * CLIPPER_SCALE)
    }));
    
    const simplified = ClipperLib.Clipper.CleanPolygon(clipperPath, tolerance * CLIPPER_SCALE);
    
    if (simplified && simplified.length >= 3) {
      return simplified.map((p: any) => ({
        x: p.X / CLIPPER_SCALE,
        y: p.Y / CLIPPER_SCALE
      }));
    }
    
    return polygon;
    
  } catch (error) {
    return polygon;
  }
}

/**
 * Union multiple polygons into one (merge overlapping shapes)
 */
export function unionPolygons(polygons: Point[][]): Point[][] {
  if (polygons.length <= 1) return polygons;
  
  try {
    const clipper = new ClipperLib.Clipper();
    
    for (const polygon of polygons) {
      if (polygon.length >= 3) {
        const clipperPath: ClipperLib.IntPoint[] = polygon.map(p => ({
          X: Math.round(p.x * CLIPPER_SCALE),
          Y: Math.round(p.y * CLIPPER_SCALE)
        }));
        clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
      }
    }
    
    const solution: ClipperLib.IntPoint[][] = [];
    clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    
    return solution.map(path => 
      path.map(p => ({
        x: p.X / CLIPPER_SCALE,
        y: p.Y / CLIPPER_SCALE
      }))
    );
    
  } catch (error) {
    console.error('[MinkowskiOffset] Error in union:', error);
    return polygons;
  }
}

/**
 * High-level function to offset a contour with quality settings
 */
export function offsetContour(
  contour: Point[],
  offsetInches: number,
  dpi: number = 300,
  cornerMode: CornerMode = 'rounded'
): Point[] {
  const offsetPixels = offsetInches * dpi;
  return offsetPolygon(contour, offsetPixels, cornerMode);
}

/**
 * Create smooth offset contour from edge pixels
 * First traces boundary properly, then applies Clipper offset
 */
export function createMinkowskiContour(
  edgePixels: Point[],
  offsetPixels: number,
  cornerMode: CornerMode = 'rounded'
): Point[] {
  if (edgePixels.length < 10) return edgePixels;
  
  // Order the edge pixels into a proper contour (using existing chain ordering)
  const orderedContour = orderEdgePixelsByChaining(edgePixels);
  
  // Simplify before offsetting
  const simplified = simplifyPolygon(orderedContour, 0.5);
  
  // Apply Clipper offset
  return offsetPolygon(simplified, offsetPixels, cornerMode);
}

/**
 * Order edge pixels by following the chain of neighbors
 * This produces a proper boundary traversal instead of angle sorting
 */
function orderEdgePixelsByChaining(pixels: Point[]): Point[] {
  if (pixels.length < 3) return pixels;
  
  // Create a lookup set for fast neighbor checking
  const pixelSet = new Set<string>();
  const pixelMap = new Map<string, Point>();
  
  for (const p of pixels) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    pixelSet.add(key);
    pixelMap.set(key, p);
  }
  
  // Start from the topmost-leftmost pixel
  let startPixel = pixels[0];
  for (const p of pixels) {
    if (p.y < startPixel.y || (p.y === startPixel.y && p.x < startPixel.x)) {
      startPixel = p;
    }
  }
  
  const result: Point[] = [startPixel];
  const visited = new Set<string>();
  const startKey = `${Math.round(startPixel.x)},${Math.round(startPixel.y)}`;
  visited.add(startKey);
  
  // 8-connected neighbor directions (clockwise from right)
  const directions = [
    { dx: 1, dy: 0 },   // right
    { dx: 1, dy: 1 },   // bottom-right
    { dx: 0, dy: 1 },   // bottom
    { dx: -1, dy: 1 },  // bottom-left
    { dx: -1, dy: 0 },  // left
    { dx: -1, dy: -1 }, // top-left
    { dx: 0, dy: -1 },  // top
    { dx: 1, dy: -1 },  // top-right
  ];
  
  let current = startPixel;
  let prevDir = 0; // Start looking to the right
  
  // Follow the boundary
  for (let step = 0; step < pixels.length * 2; step++) {
    let found = false;
    
    // Start from the direction opposite to where we came from
    const searchStart = (prevDir + 5) % 8;
    
    for (let i = 0; i < 8; i++) {
      const dir = (searchStart + i) % 8;
      const nx = Math.round(current.x) + directions[dir].dx;
      const ny = Math.round(current.y) + directions[dir].dy;
      const key = `${nx},${ny}`;
      
      if (pixelSet.has(key) && !visited.has(key)) {
        const nextPixel = pixelMap.get(key)!;
        result.push(nextPixel);
        visited.add(key);
        current = nextPixel;
        prevDir = dir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
  }
  
  return result;
}
