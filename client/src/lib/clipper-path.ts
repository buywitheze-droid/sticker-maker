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
  
  const clipperPath = pointsToClipperPath(points);
  
  const solution: ClipperLib.Path[] = [];
  
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  
  if (solution.length === 0) return points;
  
  let longestPath = solution[0];
  for (let i = 1; i < solution.length; i++) {
    if (solution[i].length > longestPath.length) {
      longestPath = solution[i];
    }
  }
  
  const cleanedPoints = clipperPathToPoints(longestPath);
  
  return cleanedPoints.length >= 3 ? cleanedPoints : points;
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
  
  const simplified = ClipperLib.Clipper.CleanPolygon(clipperPath, tolerance * CLIPPER_SCALE);
  
  if (!simplified || simplified.length < 3) return points;
  
  return clipperPathToPoints(simplified);
}

export function removeLoopsWithClipper(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  let result = cleanPathWithClipper(points);
  
  result = simplifyPathWithClipper(result, 0.001);
  
  result = removeBacktracking(result);
  
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
    
    if (dot < -0.95) {
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
