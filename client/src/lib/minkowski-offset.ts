/**
 * Minkowski Sum-based Polygon Offset Algorithm
 * 
 * Implements proper shape offsetting using:
 * - Parallel edge offset computation
 * - Arc insertion at convex vertices (rounded corners)
 * - Miter/bevel joins at convex vertices (sharp corners)
 * - Self-intersection detection and resolution
 */

export interface Point {
  x: number;
  y: number;
}

export type CornerMode = 'rounded' | 'sharp';

interface OffsetSegment {
  start: Point;
  end: Point;
  originalIndex: number;
}

/**
 * Offset a polygon by a given distance using Minkowski Sum principles
 * @param polygon - Array of points forming a closed polygon (clockwise winding)
 * @param offset - Offset distance in pixels (positive = outward, negative = inward)
 * @param cornerMode - 'rounded' for arc corners, 'sharp' for miter/bevel
 * @param arcSegments - Number of segments per 90° arc (for rounded mode)
 */
export function offsetPolygon(
  polygon: Point[],
  offset: number,
  cornerMode: CornerMode = 'rounded',
  arcSegments: number = 8
): Point[] {
  if (polygon.length < 3) return polygon;
  
  // Ensure polygon is closed and has consistent winding
  const cleanPolygon = ensureClockwise(removeDuplicates(polygon));
  if (cleanPolygon.length < 3) return polygon;
  
  // Step 1: Compute offset edges (parallel to original edges)
  const offsetEdges = computeOffsetEdges(cleanPolygon, offset);
  
  // Step 2: Handle corner connections based on mode
  const result = cornerMode === 'rounded'
    ? connectEdgesWithArcs(offsetEdges, offset, arcSegments)
    : connectEdgesWithMiter(offsetEdges, offset);
  
  // Step 3: Remove self-intersections
  const cleanResult = removeSelfIntersections(result);
  
  return cleanResult;
}

/**
 * Remove duplicate consecutive points
 */
function removeDuplicates(points: Point[]): Point[] {
  if (points.length < 2) return points;
  
  const result: Point[] = [points[0]];
  const epsilon = 0.001;
  
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (Math.abs(curr.x - prev.x) > epsilon || Math.abs(curr.y - prev.y) > epsilon) {
      result.push(curr);
    }
  }
  
  // Check if last point duplicates first
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first.x - last.x) < epsilon && Math.abs(first.y - last.y) < epsilon) {
      result.pop();
    }
  }
  
  return result;
}

/**
 * Ensure polygon has clockwise winding (for outward offset)
 */
function ensureClockwise(polygon: Point[]): Point[] {
  const area = computeSignedArea(polygon);
  // Positive area = counter-clockwise, negative = clockwise
  if (area > 0) {
    return [...polygon].reverse();
  }
  return polygon;
}

/**
 * Compute signed area of polygon (positive = CCW, negative = CW)
 */
function computeSignedArea(polygon: Point[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return area / 2;
}

/**
 * Compute offset edges parallel to each original edge
 */
function computeOffsetEdges(polygon: Point[], offset: number): OffsetSegment[] {
  const edges: OffsetSegment[] = [];
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    
    // Compute edge direction and normal
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len < 0.001) continue; // Skip degenerate edges
    
    // Unit normal pointing outward (perpendicular to edge, clockwise winding)
    const nx = -dy / len;
    const ny = dx / len;
    
    // Offset both endpoints
    edges.push({
      start: { x: p1.x + nx * offset, y: p1.y + ny * offset },
      end: { x: p2.x + nx * offset, y: p2.y + ny * offset },
      originalIndex: i
    });
  }
  
  return edges;
}

/**
 * Connect offset edges using arc segments at corners (rounded mode)
 */
function connectEdgesWithArcs(
  edges: OffsetSegment[],
  offset: number,
  arcSegments: number
): Point[] {
  if (edges.length < 2) return [];
  
  const result: Point[] = [];
  const n = edges.length;
  
  for (let i = 0; i < n; i++) {
    const edge1 = edges[i];
    const edge2 = edges[(i + 1) % n];
    
    // Add the start of the current edge
    result.push(edge1.start);
    
    // Check if edges need an arc connection or intersection
    const intersection = lineIntersection(edge1.start, edge1.end, edge2.start, edge2.end);
    
    if (intersection) {
      // Edges intersect - use intersection point
      result.push(intersection);
    } else {
      // Edges don't intersect - need arc at convex corner
      // Add arc from edge1.end to edge2.start around the original vertex
      const originalVertex = getOriginalVertex(edge1, edge2, edges, offset);
      if (originalVertex) {
        const arcPoints = createArc(originalVertex, edge1.end, edge2.start, offset, arcSegments);
        result.push(...arcPoints);
      } else {
        // Fallback: direct connection
        result.push(edge1.end);
      }
    }
  }
  
  return result;
}

/**
 * Connect offset edges using miter joins at corners (sharp mode)
 */
function connectEdgesWithMiter(
  edges: OffsetSegment[],
  offset: number,
  miterLimit: number = 2.0
): Point[] {
  if (edges.length < 2) return [];
  
  const result: Point[] = [];
  const n = edges.length;
  
  for (let i = 0; i < n; i++) {
    const edge1 = edges[i];
    const edge2 = edges[(i + 1) % n];
    
    result.push(edge1.start);
    
    // Find intersection of extended edge lines
    const intersection = lineIntersectionExtended(
      edge1.start, edge1.end,
      edge2.start, edge2.end
    );
    
    if (intersection) {
      // Check miter limit
      const distFromEnd1 = distance(edge1.end, intersection);
      
      if (distFromEnd1 <= offset * miterLimit) {
        // Miter join
        result.push(intersection);
      } else {
        // Bevel join (miter would be too long)
        result.push(edge1.end);
        result.push(edge2.start);
      }
    } else {
      // Parallel edges - direct connection
      result.push(edge1.end);
    }
  }
  
  return result;
}

/**
 * Get the original vertex between two offset edges
 */
function getOriginalVertex(
  edge1: OffsetSegment,
  edge2: OffsetSegment,
  allEdges: OffsetSegment[],
  offset: number
): Point | null {
  // The original vertex is at edge1.originalIndex + 1 in the original polygon
  // We can approximate it by finding the center of the arc
  const center = {
    x: (edge1.end.x + edge2.start.x) / 2,
    y: (edge1.end.y + edge2.start.y) / 2
  };
  
  // Move toward the interior by offset amount
  const dx = edge2.start.x - edge1.end.x;
  const dy = edge2.start.y - edge1.end.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len < 0.001) return null;
  
  // Perpendicular pointing inward
  const nx = -dy / len;
  const ny = dx / len;
  
  return {
    x: center.x - nx * offset * 0.5,
    y: center.y - ny * offset * 0.5
  };
}

/**
 * Create arc points between two points around a center
 */
function createArc(
  center: Point,
  start: Point,
  end: Point,
  radius: number,
  segments: number
): Point[] {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  
  // Ensure we go the short way around (for outward offset)
  let angleDiff = endAngle - startAngle;
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
  
  // For convex corners (positive offset), we want the outer arc
  if (angleDiff < 0) {
    angleDiff += 2 * Math.PI;
  }
  
  const actualRadius = distance(center, start);
  const numSegments = Math.max(2, Math.ceil(Math.abs(angleDiff) / (Math.PI / 2) * segments));
  
  const points: Point[] = [];
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const angle = startAngle + angleDiff * t;
    points.push({
      x: center.x + Math.cos(angle) * actualRadius,
      y: center.y + Math.sin(angle) * actualRadius
    });
  }
  
  return points;
}

/**
 * Find intersection of two line segments (not extended)
 */
function lineIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) return null; // Parallel
  
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  
  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y
    };
  }
  
  return null;
}

/**
 * Find intersection of two extended lines
 */
function lineIntersectionExtended(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) return null; // Parallel
  
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  
  const t = (dx * d2y - dy * d2x) / cross;
  
  return {
    x: p1.x + t * d1x,
    y: p1.y + t * d1y
  };
}

/**
 * Euclidean distance between two points
 */
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Remove self-intersections from polygon using simplified approach
 */
function removeSelfIntersections(polygon: Point[]): Point[] {
  if (polygon.length < 4) return polygon;
  
  let result = [...polygon];
  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    const n = result.length;
    
    for (let i = 0; i < n && !changed; i++) {
      const p1 = result[i];
      const p2 = result[(i + 1) % n];
      
      // Check against non-adjacent segments
      for (let j = i + 2; j < n; j++) {
        // Skip adjacent segments
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        
        const p3 = result[j];
        const p4 = result[(j + 1) % n];
        
        const intersection = lineIntersection(p1, p2, p3, p4);
        
        if (intersection) {
          // Remove the smaller loop
          const loopSize = j - i;
          const remainingSize = n - loopSize;
          
          if (loopSize <= remainingSize) {
            // Remove loop from i+1 to j
            const newPoints: Point[] = [];
            for (let k = 0; k <= i; k++) {
              newPoints.push(result[k]);
            }
            newPoints.push(intersection);
            for (let k = j + 1; k < n; k++) {
              newPoints.push(result[k]);
            }
            result = newPoints;
          } else {
            // Keep only the loop
            const newPoints: Point[] = [intersection];
            for (let k = i + 1; k <= j; k++) {
              newPoints.push(result[k]);
            }
            result = newPoints;
          }
          
          changed = true;
          break;
        }
      }
    }
  }
  
  return result;
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
  const arcQuality = Math.max(4, Math.min(16, Math.round(offsetPixels / 10)));
  
  return offsetPolygon(contour, offsetPixels, cornerMode, arcQuality);
}

/**
 * Create smooth offset contour from edge pixels using marching squares + offset
 */
export function createMinkowskiContour(
  edgePixels: Point[],
  offsetPixels: number,
  cornerMode: CornerMode = 'rounded'
): Point[] {
  if (edgePixels.length < 10) return edgePixels;
  
  // First, order the edge pixels into a contour
  const orderedContour = orderEdgePixels(edgePixels);
  
  // Simplify to reduce point count
  const simplified = douglasPeucker(orderedContour, 1.0);
  
  // Apply Minkowski offset
  const arcSegments = cornerMode === 'rounded' ? 8 : 1;
  const offset = offsetPolygon(simplified, offsetPixels, cornerMode, arcSegments);
  
  // Final simplification
  return douglasPeucker(offset, 0.5);
}

/**
 * Order edge pixels into a continuous contour path
 */
function orderEdgePixels(pixels: Point[]): Point[] {
  if (pixels.length === 0) return [];
  
  // Calculate center of mass
  let sumX = 0, sumY = 0;
  for (const p of pixels) {
    sumX += p.x;
    sumY += p.y;
  }
  const centerX = sumX / pixels.length;
  const centerY = sumY / pixels.length;
  
  // Sort by angle from center
  return [...pixels].sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });
}

/**
 * Douglas-Peucker line simplification
 */
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [first, last];
  }
}

/**
 * Perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return distance(point, lineStart);
  }
  
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
  const nearestX = lineStart.x + t * dx;
  const nearestY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - nearestX) ** 2 + (point.y - nearestY) ** 2);
}
