interface Point {
  x: number;
  y: number;
}

export interface BezierSegment {
  type: 'curve' | 'line';
  start: Point;
  cp1?: Point;
  cp2?: Point;
  end: Point;
}

export interface CurveFitResult {
  points: Point[];
  segments: BezierSegment[];
}

export function fitCurvesToPath(
  points: Point[],
  cornerThreshold: number = 0.7,
  curveError: number = 2.0
): CurveFitResult {
  if (points.length < 3) {
    return { points, segments: [] };
  }
  
  console.log('[CurveFit] Fitting curves to', points.length, 'points');
  
  const corners = detectCornersImproved(points, cornerThreshold);
  console.log('[CurveFit] Detected', corners.length, 'corners');
  
  const segments: BezierSegment[] = [];
  const outputPoints: Point[] = [];
  
  if (corners.length < 2) {
    const seg = fitBezierToSegment(points, 0, points.length - 1, curveError);
    segments.push(...seg);
    for (const s of seg) {
      outputPoints.push(s.start);
      if (s.type === 'curve') {
        const samples = sampleCubicBezier(s.start, s.cp1!, s.cp2!, s.end, 8);
        outputPoints.push(...samples);
      }
    }
    return { points: outputPoints, segments };
  }
  
  for (let i = 0; i < corners.length; i++) {
    const startIdx = corners[i];
    const endIdx = corners[(i + 1) % corners.length];
    
    const segmentPoints = extractSegmentPoints(points, startIdx, endIdx);
    
    if (segmentPoints.length < 2) continue;
    
    if (segmentPoints.length <= 3) {
      segments.push({
        type: 'line',
        start: segmentPoints[0],
        end: segmentPoints[segmentPoints.length - 1]
      });
      outputPoints.push(segmentPoints[0]);
    } else {
      const seg = fitBezierToSegment(segmentPoints, 0, segmentPoints.length - 1, curveError);
      segments.push(...seg);
      for (const s of seg) {
        outputPoints.push(s.start);
        if (s.type === 'curve') {
          const samples = sampleCubicBezier(s.start, s.cp1!, s.cp2!, s.end, 6);
          outputPoints.push(...samples);
        }
      }
    }
  }
  
  console.log('[CurveFit] Generated', segments.length, 'segments,', outputPoints.length, 'output points');
  return { points: outputPoints, segments };
}

function detectCornersImproved(points: Point[], threshold: number): number[] {
  const n = points.length;
  if (n < 5) return [];
  
  const angles: number[] = new Array(n).fill(0);
  
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
    
    if (len1 < 0.001 || len2 < 0.001) {
      angles[i] = 0;
      continue;
    }
    
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    angles[i] = Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  
  const sortedAngles = [...angles].sort((a, b) => a - b);
  const medianAngle = sortedAngles[Math.floor(n / 2)];
  
  const corners: number[] = [];
  const minSpacing = Math.max(5, Math.floor(n / 20));
  
  for (let i = 0; i < n; i++) {
    const angle = angles[i];
    
    const isAbsolute = angle > threshold;
    const isRelative = angle > medianAngle * 2.5 && angle > 0.3;
    
    if (isAbsolute || isRelative) {
      if (corners.length === 0 || i - corners[corners.length - 1] >= minSpacing) {
        corners.push(i);
      } else if (angle > angles[corners[corners.length - 1]]) {
        corners[corners.length - 1] = i;
      }
    }
  }
  
  return corners;
}

function extractSegmentPoints(points: Point[], startIdx: number, endIdx: number): Point[] {
  const n = points.length;
  const result: Point[] = [];
  
  let i = startIdx;
  while (true) {
    result.push(points[i]);
    if (i === endIdx) break;
    i = (i + 1) % n;
    if (result.length > n) break;
  }
  
  return result;
}

function fitBezierToSegment(
  points: Point[],
  startIdx: number,
  endIdx: number,
  errorThreshold: number
): BezierSegment[] {
  const segmentPoints = points.slice(startIdx, endIdx + 1);
  if (segmentPoints.length < 2) return [];
  
  if (segmentPoints.length === 2) {
    return [{
      type: 'line',
      start: segmentPoints[0],
      end: segmentPoints[1]
    }];
  }
  
  const start = segmentPoints[0];
  const end = segmentPoints[segmentPoints.length - 1];
  
  const t1 = computeTangent(segmentPoints, 0, true);
  const t2 = computeTangent(segmentPoints, segmentPoints.length - 1, false);
  
  const chordLen = distance(start, end);
  const scale = chordLen / 3;
  
  const cp1: Point = {
    x: start.x + t1.x * scale,
    y: start.y + t1.y * scale
  };
  
  const cp2: Point = {
    x: end.x - t2.x * scale,
    y: end.y - t2.y * scale
  };
  
  const maxError = computeMaxError(segmentPoints, start, cp1, cp2, end);
  
  if (maxError <= errorThreshold || segmentPoints.length <= 4) {
    return [{
      type: 'curve',
      start,
      cp1,
      cp2,
      end
    }];
  }
  
  const splitIdx = Math.floor(segmentPoints.length / 2);
  const left = fitBezierToSegment(segmentPoints, 0, splitIdx, errorThreshold);
  const right = fitBezierToSegment(segmentPoints, splitIdx, segmentPoints.length - 1, errorThreshold);
  
  return [...left, ...right];
}

function computeTangent(points: Point[], idx: number, isStart: boolean): Point {
  const lookAhead = Math.min(3, points.length - 1);
  
  let dx = 0, dy = 0;
  if (isStart) {
    const endIdx = Math.min(idx + lookAhead, points.length - 1);
    dx = points[endIdx].x - points[idx].x;
    dy = points[endIdx].y - points[idx].y;
  } else {
    const startIdx = Math.max(idx - lookAhead, 0);
    dx = points[idx].x - points[startIdx].x;
    dy = points[idx].y - points[startIdx].y;
  }
  
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

function computeMaxError(
  points: Point[],
  start: Point,
  cp1: Point,
  cp2: Point,
  end: Point
): number {
  let maxErr = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const t = i / (points.length - 1);
    const bezierPoint = evaluateCubicBezier(start, cp1, cp2, end, t);
    const err = distance(points[i], bezierPoint);
    maxErr = Math.max(maxErr, err);
  }
  
  return maxErr;
}

function evaluateCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  };
}

function sampleCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, numSamples: number): Point[] {
  const result: Point[] = [];
  for (let i = 1; i <= numSamples; i++) {
    const t = i / (numSamples + 1);
    result.push(evaluateCubicBezier(p0, p1, p2, p3, t));
  }
  return result;
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function smoothPathWithCurveFitting(
  points: Point[],
  cornerThreshold: number = 0.5
): Point[] {
  const result = fitCurvesToPath(points, cornerThreshold, 2.0);
  return result.points.length > 0 ? result.points : points;
}
