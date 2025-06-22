import { StrokeSettings } from "@/components/image-editor";

interface ContourPoint {
  x: number;
  y: number;
}

export function createUnifiedContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  canvas.width = image.width;
  canvas.height = image.height;

  // Step 1: Get image data for analysis
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Step 2: Create unified bounding shape that encompasses all objects
  const bounds = findContentBounds(data, canvas.width, canvas.height);
  if (!bounds) {
    return canvas;
  }

  // Step 3: Create a unified contour using convex hull or alpha shape
  const unifiedContour = createSingleContour(data, canvas.width, canvas.height, bounds, strokeSettings);

  // Step 4: Draw the final unified contour
  drawUnifiedContour(ctx, unifiedContour, strokeSettings);

  return canvas;
}

function findContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) { // Consider semi-transparent pixels
        hasContent = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return hasContent ? { minX, maxX, minY, maxY } : null;
}

function createSingleContour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  strokeSettings: StrokeSettings
): ContourPoint[] {
  // Strategy 1: For simple shapes, use convex hull
  const edgePoints = findAllEdgePoints(data, width, height);
  
  if (edgePoints.length < 50) {
    // Simple shape - use convex hull for clean outline
    return calculateConvexHull(edgePoints);
  }

  // Strategy 2: For complex shapes, use alpha shape or concave hull
  const alphaShape = createAlphaShape(edgePoints, strokeSettings.width * 10);
  
  if (alphaShape.length > 0) {
    return alphaShape;
  }

  // Strategy 3: Fallback to morphological closing + boundary tracing
  return createMorphologicalContour(data, width, height, bounds, strokeSettings);
}

function findAllEdgePoints(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ContourPoint[] {
  const edgePoints: ContourPoint[] = [];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const currentAlpha = data[(y * width + x) * 4 + 3];
      
      if (currentAlpha > 10) {
        // Check if this is an edge pixel (has transparent neighbor)
        const neighbors = [
          data[((y-1) * width + x) * 4 + 3], // top
          data[((y+1) * width + x) * 4 + 3], // bottom
          data[(y * width + (x-1)) * 4 + 3], // left
          data[(y * width + (x+1)) * 4 + 3], // right
        ];
        
        const hasTransparentNeighbor = neighbors.some(alpha => alpha <= 10);
        
        if (hasTransparentNeighbor) {
          edgePoints.push({ x, y });
        }
      }
    }
  }
  
  return edgePoints;
}

function calculateConvexHull(points: ContourPoint[]): ContourPoint[] {
  if (points.length < 3) return points;

  // Graham scan algorithm for convex hull
  const center = points.reduce(
    (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
    { x: 0, y: 0 }
  );

  // Sort points by polar angle
  const sortedPoints = points.sort((a, b) => {
    const angleA = Math.atan2(a.y - center.y, a.x - center.x);
    const angleB = Math.atan2(b.y - center.y, b.x - center.x);
    return angleA - angleB;
  });

  const hull: ContourPoint[] = [];
  
  for (const point of sortedPoints) {
    while (hull.length >= 2) {
      const orientation = calculateOrientation(
        hull[hull.length - 2],
        hull[hull.length - 1],
        point
      );
      if (orientation <= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(point);
  }

  return hull;
}

function createAlphaShape(points: ContourPoint[], alpha: number): ContourPoint[] {
  // Simplified alpha shape - create concave hull with maximum edge length
  if (points.length < 3) return points;

  const maxEdgeLength = alpha;
  const result: ContourPoint[] = [];
  
  // Start with convex hull
  const convexHull = calculateConvexHull(points);
  
  // Refine by adding interior points that create concave sections
  for (let i = 0; i < convexHull.length; i++) {
    const current = convexHull[i];
    const next = convexHull[(i + 1) % convexHull.length];
    
    result.push(current);
    
    // Check if we should add intermediate points
    const distance = Math.sqrt(
      Math.pow(next.x - current.x, 2) + Math.pow(next.y - current.y, 2)
    );
    
    if (distance > maxEdgeLength) {
      // Find closest interior points
      const intermediatePoints = points.filter(p => {
        const distToCurrent = Math.sqrt(
          Math.pow(p.x - current.x, 2) + Math.pow(p.y - current.y, 2)
        );
        const distToNext = Math.sqrt(
          Math.pow(p.x - next.x, 2) + Math.pow(p.y - next.y, 2)
        );
        return distToCurrent < maxEdgeLength && distToNext < maxEdgeLength;
      });
      
      // Add the best intermediate point
      if (intermediatePoints.length > 0) {
        const best = intermediatePoints.reduce((closest, p) => {
          const distToCurrent = Math.sqrt(
            Math.pow(p.x - current.x, 2) + Math.pow(p.y - current.y, 2)
          );
          const closestDist = Math.sqrt(
            Math.pow(closest.x - current.x, 2) + Math.pow(closest.y - current.y, 2)
          );
          return distToCurrent < closestDist ? p : closest;
        });
        result.push(best);
      }
    }
  }
  
  return result;
}

function createMorphologicalContour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  strokeSettings: StrokeSettings
): ContourPoint[] {
  // Create binary mask
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    mask[i / 4] = data[i + 3] > 10 ? 1 : 0;
  }

  // Apply morphological closing to connect nearby objects
  const closingRadius = Math.max(3, strokeSettings.width);
  const closedMask = morphologicalClosing(mask, width, height, closingRadius);

  // Find the outer boundary of the closed shape
  return traceBoundary(closedMask, width, height);
}

function morphologicalClosing(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  // Dilation followed by erosion
  const dilated = morphologicalDilation(mask, width, height, radius);
  return morphologicalErosion(dilated, width, height, radius);
}

function morphologicalDilation(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      
      // Check if any pixel in the neighborhood is set
      let hasNeighbor = false;
      for (let dy = -radius; dy <= radius && !hasNeighbor; dy++) {
        for (let dx = -radius; dx <= radius && !hasNeighbor; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] === 1) {
              hasNeighbor = true;
            }
          }
        }
      }
      
      result[index] = hasNeighbor ? 1 : 0;
    }
  }
  
  return result;
}

function morphologicalErosion(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      
      // Check if all pixels in the neighborhood are set
      let allNeighborsSet = true;
      for (let dy = -radius; dy <= radius && allNeighborsSet; dy++) {
        for (let dx = -radius; dx <= radius && allNeighborsSet; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] === 0) {
              allNeighborsSet = false;
            }
          } else {
            allNeighborsSet = false; // Out of bounds treated as 0
          }
        }
      }
      
      result[index] = allNeighborsSet ? 1 : 0;
    }
  }
  
  return result;
}

function traceBoundary(mask: Uint8Array, width: number, height: number): ContourPoint[] {
  // Find starting point (leftmost, topmost filled pixel)
  let startX = -1, startY = -1;
  
  for (let y = 0; y < height && startX === -1; y++) {
    for (let x = 0; x < width && startX === -1; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
      }
    }
  }
  
  if (startX === -1) return [];

  // Moore neighborhood boundary following
  const boundary: ContourPoint[] = [];
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1],
    [-1, 1], [-1, 0]
  ];
  
  let currentX = startX;
  let currentY = startY;
  let direction = 0; // Start facing right
  
  do {
    boundary.push({ x: currentX, y: currentY });
    
    // Look for next boundary pixel
    let found = false;
    for (let i = 0; i < 8 && !found; i++) {
      const checkDir = (direction + i) % 8;
      const dx = directions[checkDir][0];
      const dy = directions[checkDir][1];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        if (mask[nextY * width + nextX] === 1) {
          currentX = nextX;
          currentY = nextY;
          direction = (checkDir + 6) % 8; // Turn left for next search
          found = true;
        }
      }
    }
    
    if (!found) break;
    
  } while (currentX !== startX || currentY !== startY || boundary.length < 8);
  
  // Simplify boundary to reduce points
  return simplifyContour(boundary, 2);
}

function simplifyContour(contour: ContourPoint[], tolerance: number): ContourPoint[] {
  if (contour.length <= 2) return contour;
  
  // Douglas-Peucker simplification
  return douglasPeuckerSimplify(contour, tolerance);
}

function douglasPeuckerSimplify(points: ContourPoint[], tolerance: number): ContourPoint[] {
  if (points.length <= 2) return points;
  
  let maxDistance = 0;
  let maxIndex = 0;
  
  // Find the point with maximum distance from line between first and last
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointToLineDistance(
      points[i],
      points[0],
      points[points.length - 1]
    );
    
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  if (maxDistance > tolerance) {
    // Split and recursively simplify
    const left = douglasPeuckerSimplify(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeuckerSimplify(points.slice(maxIndex), tolerance);
    
    return left.slice(0, -1).concat(right);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

function pointToLineDistance(
  point: ContourPoint,
  lineStart: ContourPoint,
  lineEnd: ContourPoint
): number {
  const A = lineEnd.y - lineStart.y;
  const B = lineStart.x - lineEnd.x;
  const C = lineEnd.x * lineStart.y - lineStart.x * lineEnd.y;
  
  return Math.abs(A * point.x + B * point.y + C) / Math.sqrt(A * A + B * B);
}

function calculateOrientation(p: ContourPoint, q: ContourPoint, r: ContourPoint): number {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (val === 0) return 0; // collinear
  return val > 0 ? 1 : 2; // clockwise or counterclockwise
}

function drawUnifiedContour(
  ctx: CanvasRenderingContext2D,
  contour: ContourPoint[],
  strokeSettings: StrokeSettings
): void {
  if (contour.length < 2) return;

  ctx.strokeStyle = strokeSettings.color;
  ctx.lineWidth = Math.max(1, strokeSettings.width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'transparent';

  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
}