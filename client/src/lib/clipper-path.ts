import ClipperLib from 'js-clipper';

interface Point {
  x: number;
  y: number;
}

const CLIPPER_SCALE = 100000;

function pointsToClipperPath(points: Point[]): ClipperLib.Path {
  return points.map(p => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  }));
}

function clipperPathToPoints(path: ClipperLib.Path): Point[] {
  return path.map((p: { X: number; Y: number }) => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE
  }));
}

export function cleanPathWithClipper(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  console.log('[cleanPathWithClipper] Input points:', points.length);
  
  const clipperPath = pointsToClipperPath(points);
  
  // Use SimplifyPolygon which specifically removes self-intersections
  const simplified = ClipperLib.Clipper.SimplifyPolygon(clipperPath, ClipperLib.PolyFillType.pftNonZero);
  
  console.log('[cleanPathWithClipper] SimplifyPolygon returned', simplified?.length || 0, 'polygons');
  
  if (!simplified || simplified.length === 0) {
    console.log('[cleanPathWithClipper] SimplifyPolygon failed, returning original');
    return points;
  }
  
  // Find the largest polygon by area (main outline, not tiny loop fragments)
  let largestArea = 0;
  let largestPath = simplified[0];
  
  for (const path of simplified) {
    const area = Math.abs(ClipperLib.Clipper.Area(path));
    if (area > largestArea) {
      largestArea = area;
      largestPath = path;
    }
  }
  
  console.log('[cleanPathWithClipper] Largest polygon has', largestPath.length, 'points, area:', largestArea);
  
  // Also clean up any micro-vertices that are very close together
  const cleaned = ClipperLib.Clipper.CleanPolygon(largestPath, 2 * CLIPPER_SCALE / 100000);
  
  if (!cleaned || cleaned.length < 3) {
    console.log('[cleanPathWithClipper] CleanPolygon failed, returning largest');
    return clipperPathToPoints(largestPath);
  }
  
  console.log('[cleanPathWithClipper] Final cleaned points:', cleaned.length);
  return clipperPathToPoints(cleaned);
}

export function offsetPathWithClipper(points: Point[], offsetAmount: number): Point[] {
  if (points.length < 3) return points;
  
  const clipperPath = pointsToClipperPath(points);
  
  const co = new ClipperLib.ClipperOffset();
  co.ArcTolerance = 0.25 * CLIPPER_SCALE;
  co.MiterLimit = 2;
  
  co.AddPath(clipperPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  
  const solution: ClipperLib.Path[] = [];
  co.Execute(solution, offsetAmount * CLIPPER_SCALE);
  
  if (solution.length === 0) return points;
  
  let largestArea = 0;
  let largestPath = solution[0];
  
  for (const path of solution) {
    const area = Math.abs(ClipperLib.Clipper.Area(path));
    if (area > largestArea) {
      largestArea = area;
      largestPath = path;
    }
  }
  
  return clipperPathToPoints(largestPath);
}

export function simplifyPathWithClipper(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  
  const clipperPath = pointsToClipperPath(points);
  
  // CleanPolygon removes vertices closer than tolerance distance
  const simplified = ClipperLib.Clipper.CleanPolygon(clipperPath, tolerance * CLIPPER_SCALE);
  
  if (!simplified || simplified.length < 3) return points;
  
  // Also run SimplifyPolygon to ensure no self-intersections after cleaning
  const noIntersections = ClipperLib.Clipper.SimplifyPolygon(simplified, ClipperLib.PolyFillType.pftNonZero);
  
  if (!noIntersections || noIntersections.length === 0) {
    return clipperPathToPoints(simplified);
  }
  
  // Return the largest polygon
  let largest = noIntersections[0];
  let largestArea = Math.abs(ClipperLib.Clipper.Area(largest));
  
  for (let i = 1; i < noIntersections.length; i++) {
    const area = Math.abs(ClipperLib.Clipper.Area(noIntersections[i]));
    if (area > largestArea) {
      largestArea = area;
      largest = noIntersections[i];
    }
  }
  
  return clipperPathToPoints(largest);
}

export function removeLoopsWithClipper(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  // First pass: Use Clipper to remove self-intersections
  let result = cleanPathWithClipper(points);
  
  // Second pass: Clean up closely spaced vertices
  result = simplifyPathWithClipper(result, 0.5);
  
  // Third pass: Remove any remaining backtracking
  result = removeBacktracking(result);
  
  // Fourth pass: Run SimplifyPolygon again to catch any loops created by backtracking removal
  result = cleanPathWithClipper(result);
  
  // Fifth pass: Final cleanup
  result = removeBacktracking(result);
  
  console.log('[removeLoopsWithClipper] Final path points:', result.length);
  
  return result;
}

function removeBacktracking(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 0.0001 || len2 < 0.0001) {
      continue;
    }
    
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    
    // More aggressive: remove points with turns > 140 degrees (dot < -0.766)
    // This catches smaller loops that might slip through
    if (dot < -0.766) {
      continue;
    }
    
    result.push(curr);
  }
  
  return result.length >= 3 ? result : points;
}

export function ensureClockwise(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const next = points[(i + 1) % n];
    area += (curr.x * next.y) - (next.x * curr.y);
  }
  
  if (area > 0) {
    return [...points].reverse();
  }
  
  return points;
}
