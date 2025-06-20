import { StrokeSettings } from "@/components/image-editor";

export interface CadCutContourOptions {
  strokeSettings: StrokeSettings;
  tolerance: number;
  smoothing: number;
  cornerDetection: boolean;
}

interface ContourPoint {
  x: number;
  y: number;
  angle?: number;
  isCorner?: boolean;
}

export function createCadCutContour(
  image: HTMLImageElement,
  options: CadCutContourOptions
): HTMLCanvasElement {
  const { strokeSettings, tolerance = 10, smoothing = 2, cornerDetection = true } = options;
  
  // Create working canvas with padding for stroke
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  const padding = strokeSettings.width * 2;
  canvas.width = image.width + padding * 2;
  canvas.height = image.height + padding * 2;
  
  const imageX = padding;
  const imageY = padding;
  
  if (strokeSettings.enabled) {
    // Generate contour paths using advanced CadCut algorithm
    const contourPaths = generateCadCutPaths(image, tolerance, smoothing, cornerDetection);
    
    // Draw stroke using morphological technique
    drawCadCutStroke(ctx, image, strokeSettings, imageX, imageY, contourPaths);
    
    // Draw original image on top
    ctx.drawImage(image, imageX, imageY);
  } else {
    // Just draw the original image
    ctx.drawImage(image, imageX, imageY);
  }
  
  return canvas;
}

function generateCadCutPaths(
  image: HTMLImageElement,
  tolerance: number,
  smoothing: number,
  cornerDetection: boolean
): ContourPoint[][] {
  // Create temporary canvas to extract image data
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Create alpha mask for precise edge detection
  const alphaMask = createAlphaMask(data, width, height);
  
  // Find all contours
  const contours = findAllContours(alphaMask, width, height);
  
  // Process each contour with CadCut algorithms
  return contours.map(contour => {
    // Apply Douglas-Peucker simplification
    const simplified = simplifyContourPath(contour, tolerance);
    
    // Apply corner detection if enabled
    if (cornerDetection) {
      markContourCorners(simplified);
    }
    
    // Apply curve smoothing
    if (smoothing > 0) {
      return applyContourSmoothing(simplified, smoothing);
    }
    
    return simplified;
  }).filter(path => path.length > 3);
}

function createAlphaMask(data: Uint8ClampedArray, width: number, height: number): boolean[][] {
  const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      mask[y][x] = alpha > 128;
    }
  }
  
  return mask;
}

function findAllContours(mask: boolean[][], width: number, height: number): ContourPoint[][] {
  const contours: ContourPoint[][] = [];
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y][x] && !visited[y][x] && isEdgePixel(mask, x, y, width, height)) {
        const contour = traceContour(mask, visited, x, y, width, height);
        if (contour.length > 10) {
          contours.push(contour);
        }
      }
    }
  }
  
  return contours;
}

function isEdgePixel(mask: boolean[][], x: number, y: number, width: number, height: number): boolean {
  if (!mask[y][x]) return false;
  
  // Check 8-neighborhood for edge detection
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny][nx]) {
        return true;
      }
    }
  }
  
  return false;
}

function traceContour(
  mask: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number
): ContourPoint[] {
  const contour: ContourPoint[] = [];
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  
  let x = startX;
  let y = startY;
  let dir = 0;
  
  do {
    visited[y][x] = true;
    contour.push({ x, y });
    
    // Find next contour point
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + i) % 8;
      const [dx, dy] = directions[checkDir];
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
          mask[ny][nx] && isEdgePixel(mask, nx, ny, width, height)) {
        x = nx;
        y = ny;
        dir = checkDir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
    
  } while (!(x === startX && y === startY) && contour.length < width * height);
  
  return contour;
}

function simplifyContourPath(path: ContourPoint[], tolerance: number): ContourPoint[] {
  if (path.length < 3) return path;
  
  function douglasPeucker(points: ContourPoint[], epsilon: number): ContourPoint[] {
    if (points.length < 3) return points;
    
    let maxDist = 0;
    let maxIndex = 0;
    
    for (let i = 1; i < points.length - 1; i++) {
      const dist = getPointToLineDistance(
        points[i],
        points[0],
        points[points.length - 1]
      );
      
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
      return [points[0], points[points.length - 1]];
    }
  }
  
  return douglasPeucker(path, tolerance);
}

function getPointToLineDistance(point: ContourPoint, lineStart: ContourPoint, lineEnd: ContourPoint): number {
  const A = lineEnd.x - lineStart.x;
  const B = lineEnd.y - lineStart.y;
  const C = point.x - lineStart.x;
  const D = point.y - lineStart.y;
  
  const dot = A * C + B * D;
  const lenSq = A * A + B * B;
  
  if (lenSq === 0) return Math.sqrt(C * C + D * D);
  
  const param = dot / lenSq;
  
  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * A;
    yy = lineStart.y + param * B;
  }
  
  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function markContourCorners(path: ContourPoint[]): void {
  if (path.length < 3) return;
  
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (mag1 > 0 && mag2 > 0) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
      curr.angle = angle;
      curr.isCorner = angle < Math.PI * 0.75;
    }
  }
}

function applyContourSmoothing(points: ContourPoint[], smoothing: number): ContourPoint[] {
  if (points.length < 3 || smoothing <= 0) return points;
  
  const smoothed: ContourPoint[] = [];
  const windowSize = Math.max(1, Math.floor(smoothing));
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + points.length) % points.length;
      sumX += points[idx].x;
      sumY += points[idx].y;
      count++;
    }
    
    smoothed.push({
      x: Math.round(sumX / count),
      y: Math.round(sumY / count),
      isCorner: points[i].isCorner
    });
  }
  
  return smoothed;
}

function drawCadCutStroke(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  imageX: number,
  imageY: number,
  contourPaths: ContourPoint[][]
): void {
  ctx.save();
  
  // Set stroke properties
  ctx.strokeStyle = strokeSettings.color;
  ctx.lineWidth = strokeSettings.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw each contour path
  for (const path of contourPaths) {
    if (path.length < 3) continue;
    
    // Draw multiple passes for solid stroke
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      
      const firstPoint = path[0];
      ctx.moveTo(firstPoint.x + imageX, firstPoint.y + imageY);
      
      for (let i = 1; i < path.length; i++) {
        const point = path[i];
        
        if (point.isCorner) {
          // Sharp corners - use lineTo
          ctx.lineTo(point.x + imageX, point.y + imageY);
        } else if (i < path.length - 1) {
          // Smooth curves - use quadratic curves
          const nextPoint = path[i + 1];
          const cpX = point.x + imageX;
          const cpY = point.y + imageY;
          const endX = (point.x + nextPoint.x) / 2 + imageX;
          const endY = (point.y + nextPoint.y) / 2 + imageY;
          
          ctx.quadraticCurveTo(cpX, cpY, endX, endY);
        } else {
          ctx.lineTo(point.x + imageX, point.y + imageY);
        }
      }
      
      ctx.closePath();
      ctx.stroke();
    }
  }
  
  ctx.restore();
}