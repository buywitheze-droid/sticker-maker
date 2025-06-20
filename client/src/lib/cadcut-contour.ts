import { StrokeSettings } from "@/components/image-editor";

export interface CadCutContourOptions {
  strokeSettings: StrokeSettings;
  tolerance: number;
  smoothing: number;
  cornerDetection: boolean;
}

export function createCadCutContour(
  image: HTMLImageElement,
  options: CadCutContourOptions
): HTMLCanvasElement {
  const { strokeSettings, tolerance = 10, smoothing = 2, cornerDetection = true } = options;
  
  // Create working canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  canvas.width = image.width;
  canvas.height = image.height;
  
  // Draw image to extract pixel data
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Generate contour path using CadCut-style algorithm
  const contourPath = generateCadCutPath(imageData, tolerance, smoothing, cornerDetection);
  
  // Clear canvas and draw contour
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (strokeSettings.enabled && contourPath.length > 0) {
    // Draw original image
    ctx.drawImage(image, 0, 0);
    
    // Draw CadCut-style contour
    ctx.strokeStyle = strokeSettings.color;
    ctx.lineWidth = strokeSettings.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Apply multiple passes for clean, precise outline
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      
      if (contourPath.length > 0) {
        ctx.moveTo(contourPath[0].x, contourPath[0].y);
        
        for (let i = 1; i < contourPath.length; i++) {
          const point = contourPath[i];
          
          if (smoothing > 0 && i < contourPath.length - 1) {
            // Use quadratic curves for smoother paths like CadCut
            const nextPoint = contourPath[i + 1];
            const cpX = (point.x + nextPoint.x) / 2;
            const cpY = (point.y + nextPoint.y) / 2;
            ctx.quadraticCurveTo(point.x, point.y, cpX, cpY);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        }
        
        ctx.closePath();
      }
      
      ctx.stroke();
    }
  } else {
    // Just draw the original image
    ctx.drawImage(image, 0, 0);
  }
  
  return canvas;
}

interface ContourPoint {
  x: number;
  y: number;
  angle?: number;
  isCorner?: boolean;
}

function generateCadCutPath(
  imageData: ImageData,
  tolerance: number,
  smoothing: number,
  cornerDetection: boolean
): ContourPoint[] {
  const { data, width, height } = imageData;
  const path: ContourPoint[] = [];
  
  // Find edge pixels using Sobel edge detection (CadCut style)
  const edges = detectEdges(data, width, height);
  
  // Trace contour starting from top-left edge pixel
  const startPoint = findStartPoint(edges, width, height);
  if (!startPoint) return path;
  
  // Perform contour tracing using Moore neighborhood
  const contour = traceContour(edges, width, height, startPoint);
  
  // Apply Douglas-Peucker simplification with tolerance
  const simplified = simplifyPath(contour, tolerance);
  
  // Detect corners if enabled
  if (cornerDetection) {
    markCorners(simplified);
  }
  
  return simplified;
}

function detectEdges(data: Uint8ClampedArray, width: number, height: number): boolean[][] {
  const edges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Sobel operators
  const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
      
      // Apply Sobel operators
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const alpha = data[idx + 3];
          
          gx += alpha * sobelX[ky + 1][kx + 1];
          gy += alpha * sobelY[ky + 1][kx + 1];
        }
      }
      
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[y][x] = magnitude > 50; // Threshold for edge detection
    }
  }
  
  return edges;
}

function findStartPoint(edges: boolean[][], width: number, height: number): ContourPoint | null {
  // Find topmost, leftmost edge pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y][x]) {
        return { x, y };
      }
    }
  }
  return null;
}

function traceContour(
  edges: boolean[][],
  width: number,
  height: number,
  startPoint: ContourPoint
): ContourPoint[] {
  const contour: ContourPoint[] = [];
  const visited = new Set<string>();
  
  // Moore neighborhood (8-connected)
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1],
    [-1, 1], [-1, 0]
  ];
  
  let current = startPoint;
  let direction = 0; // Start facing right
  
  do {
    contour.push({ x: current.x, y: current.y });
    visited.add(`${current.x},${current.y}`);
    
    // Look for next edge pixel in Moore neighborhood
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (direction + i) % 8;
      const dx = directions[checkDir][0];
      const dy = directions[checkDir][1];
      const nx = current.x + dx;
      const ny = current.y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
          edges[ny][nx] && !visited.has(`${nx},${ny}`)) {
        current = { x: nx, y: ny };
        direction = checkDir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
    
  } while (contour.length < width * height && 
           (current.x !== startPoint.x || current.y !== startPoint.y || contour.length < 3));
  
  return contour;
}

function simplifyPath(path: ContourPoint[], tolerance: number): ContourPoint[] {
  if (path.length < 3) return path;
  
  // Douglas-Peucker algorithm
  function douglasPeucker(points: ContourPoint[], epsilon: number): ContourPoint[] {
    if (points.length < 3) return points;
    
    // Find the point with maximum distance from line between first and last
    let maxDist = 0;
    let maxIndex = 0;
    
    for (let i = 1; i < points.length - 1; i++) {
      const dist = pointToLineDistance(
        points[i],
        points[0],
        points[points.length - 1]
      );
      
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    
    // If max distance is greater than epsilon, recursively simplify
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

function pointToLineDistance(point: ContourPoint, lineStart: ContourPoint, lineEnd: ContourPoint): number {
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

function markCorners(path: ContourPoint[]): void {
  if (path.length < 3) return;
  
  // Calculate angle at each point to detect corners
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    // Calculate angle between vectors
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (mag1 > 0 && mag2 > 0) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
      curr.angle = angle;
      curr.isCorner = angle < Math.PI * 0.75; // Mark as corner if angle < 135°
    }
  }
}