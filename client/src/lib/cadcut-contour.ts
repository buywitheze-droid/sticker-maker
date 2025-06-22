import { StrokeSettings } from "@/components/image-editor";

interface ContourPoint {
  x: number;
  y: number;
}

export function createCadCutContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  canvas.width = image.width;
  canvas.height = image.height;
  
  // Clear canvas to transparent
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Step 1: Extract edge pixels from non-transparent areas
  const edgePixels = extractEdgePixels(image, strokeSettings.alphaThreshold);
  
  if (edgePixels.length === 0) {
    // Fallback: draw around entire image
    drawSimpleContour(ctx, canvas.width, canvas.height, strokeSettings);
    return canvas;
  }

  // Step 2: Create ordered contour path using convex hull
  const contourPath = computeConvexHull(edgePixels);
  
  // Step 3: Apply Ramer-Douglas-Peucker smoothing
  const smoothedPath = douglasPeuckerSmooth(contourPath, 2.0);
  
  // Step 4: Apply offset for cutting margin
  const offsetPath = applyOffsetToPath(smoothedPath, strokeSettings.width * 300);
  
  // Step 5: Draw the smooth contour line
  drawSmoothContour(ctx, offsetPath, strokeSettings);
  
  return canvas;
}

function extractEdgePixels(image: HTMLImageElement, alphaThreshold: number): ContourPoint[] {
  // Create temporary canvas to analyze image
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imageData.data;

  const edgePixels: ContourPoint[] = [];

  // Find edge pixels using 8-connected neighbor analysis
  for (let y = 1; y < tempCanvas.height - 1; y++) {
    for (let x = 1; x < tempCanvas.width - 1; x++) {
      const index = (y * tempCanvas.width + x) * 4;
      const alpha = data[index + 3];
      
      if (alpha >= alphaThreshold) {
        // Check if this solid pixel has any transparent neighbors
        const neighbors = [
          data[((y-1) * tempCanvas.width + (x-1)) * 4 + 3], // top-left
          data[((y-1) * tempCanvas.width + x) * 4 + 3],     // top
          data[((y-1) * tempCanvas.width + (x+1)) * 4 + 3], // top-right
          data[(y * tempCanvas.width + (x-1)) * 4 + 3],     // left
          data[(y * tempCanvas.width + (x+1)) * 4 + 3],     // right
          data[((y+1) * tempCanvas.width + (x-1)) * 4 + 3], // bottom-left
          data[((y+1) * tempCanvas.width + x) * 4 + 3],     // bottom
          data[((y+1) * tempCanvas.width + (x+1)) * 4 + 3]  // bottom-right
        ];
        
        // If any neighbor is transparent, this is an edge pixel
        if (neighbors.some(neighbor => neighbor < alphaThreshold)) {
          edgePixels.push({ x, y });
        }
      }
    }
  }

  return edgePixels;
}

function computeConvexHull(points: ContourPoint[]): ContourPoint[] {
  if (points.length < 3) return points;
  
  // Find bottom-most point (and leftmost if tied)
  let bottom = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y > points[bottom].y || 
        (points[i].y === points[bottom].y && points[i].x < points[bottom].x)) {
      bottom = i;
    }
  }
  
  // Swap to put bottom point first
  [points[0], points[bottom]] = [points[bottom], points[0]];
  
  // Sort by polar angle
  const bottomPoint = points[0];
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - bottomPoint.y, a.x - bottomPoint.x);
    const angleB = Math.atan2(b.y - bottomPoint.y, b.x - bottomPoint.x);
    return angleA - angleB;
  });
  
  // Graham scan
  const hull = [points[0], sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    while (hull.length > 1 && 
           crossProduct(hull[hull.length - 2], hull[hull.length - 1], sorted[i]) <= 0) {
      hull.pop();
    }
    hull.push(sorted[i]);
  }
  
  return hull;
}

function crossProduct(a: ContourPoint, b: ContourPoint, c: ContourPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function douglasPeuckerSmooth(points: ContourPoint[], tolerance: number): ContourPoint[] {
  if (points.length <= 2) return points;
  
  return douglasPeuckerRecursive(points, 0, points.length - 1, tolerance);
}

function douglasPeuckerRecursive(points: ContourPoint[], start: number, end: number, tolerance: number): ContourPoint[] {
  if (end - start <= 1) {
    return [points[start], points[end]];
  }
  
  let maxDistance = 0;
  let maxIndex = start;
  
  // Find point with maximum distance from line segment
  for (let i = start + 1; i < end; i++) {
    const distance = perpendicularDistance(points[i], points[start], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  if (maxDistance > tolerance) {
    // Recursively simplify both segments
    const left = douglasPeuckerRecursive(points, start, maxIndex, tolerance);
    const right = douglasPeuckerRecursive(points, maxIndex, end, tolerance);
    
    // Combine results (remove duplicate point)
    return left.slice(0, -1).concat(right);
  } else {
    // All points between start and end can be removed
    return [points[start], points[end]];
  }
}

function perpendicularDistance(point: ContourPoint, lineStart: ContourPoint, lineEnd: ContourPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

function applyOffsetToPath(path: ContourPoint[], offsetPixels: number): ContourPoint[] {
  if (path.length < 3) return path;
  
  const offsetPath: ContourPoint[] = [];
  
  for (let i = 0; i < path.length; i++) {
    const current = path[i];
    const prev = path[(i - 1 + path.length) % path.length];
    const next = path[(i + 1) % path.length];
    
    // Calculate outward normal
    const v1x = current.x - prev.x;
    const v1y = current.y - prev.y;
    const v2x = next.x - current.x;
    const v2y = next.y - current.y;
    
    // Average the normals
    const normalX = -(v1y + v2y) / 2;
    const normalY = (v1x + v2x) / 2;
    
    // Normalize
    const length = Math.sqrt(normalX * normalX + normalY * normalY);
    if (length > 0) {
      const unitX = normalX / length;
      const unitY = normalY / length;
      
      offsetPath.push({
        x: current.x + unitX * offsetPixels,
        y: current.y + unitY * offsetPixels
      });
    } else {
      offsetPath.push(current);
    }
  }
  
  return offsetPath;
}

function drawSmoothContour(ctx: CanvasRenderingContext2D, path: ContourPoint[], strokeSettings: StrokeSettings): void {
  if (path.length < 2) return;

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(3, strokeSettings.width * 80);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  
  if (path.length > 2) {
    // Draw smooth curves using quadratic Bézier
    ctx.moveTo(path[0].x, path[0].y);
    
    for (let i = 1; i < path.length - 1; i++) {
      const current = path[i];
      const next = path[i + 1];
      const controlX = current.x;
      const controlY = current.y;
      const endX = (current.x + next.x) / 2;
      const endY = (current.y + next.y) / 2;
      
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    }
    
    // Close the path smoothly
    const last = path[path.length - 1];
    const first = path[0];
    ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);
  } else {
    // Simple line for few points
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.closePath();
  }
  
  ctx.stroke();
}

function drawSimpleContour(ctx: CanvasRenderingContext2D, width: number, height: number, strokeSettings: StrokeSettings): void {
  const offsetPixels = strokeSettings.width * 300;
  const padding = Math.max(10, offsetPixels);
  
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(4, strokeSettings.width * 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.strokeRect(padding, padding, width - (padding * 2), height - (padding * 2));
}