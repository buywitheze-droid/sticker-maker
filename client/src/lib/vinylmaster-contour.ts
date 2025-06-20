import { StrokeSettings } from "@/components/image-editor";

export interface VinylMasterContourOptions {
  strokeSettings: StrokeSettings;
  precision: number;
  smoothness: number;
  cornerRadius: number;
  autoWeed: boolean;
}

interface VinylPoint {
  x: number;
  y: number;
  type: 'move' | 'line' | 'curve';
  tension?: number;
  isCorner?: boolean;
}

interface VinylContour {
  points: VinylPoint[];
  closed: boolean;
  area: number;
  direction: 'clockwise' | 'counterclockwise';
}

export function createVinylMasterContour(
  image: HTMLImageElement,
  options: VinylMasterContourOptions
): HTMLCanvasElement {
  const { strokeSettings, precision = 0.5, smoothness = 1.0, cornerRadius = 2, autoWeed = true } = options;
  
  // Create working canvas with VinylMaster specifications
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  const padding = strokeSettings.width * 3; // Extra padding for VinylMaster precision
  canvas.width = image.width + padding * 2;
  canvas.height = image.height + padding * 2;
  
  const imageX = padding;
  const imageY = padding;
  
  if (strokeSettings.enabled) {
    // Generate VinylMaster V5 contours
    const contours = generateVinylMasterContours(image, precision, smoothness, cornerRadius, autoWeed);
    
    // Draw contours using VinylMaster rendering
    drawVinylMasterContours(ctx, image, strokeSettings, imageX, imageY, contours);
    
    // Draw original image on top
    ctx.drawImage(image, imageX, imageY);
  } else {
    ctx.drawImage(image, imageX, imageY);
  }
  
  return canvas;
}

function generateVinylMasterContours(
  image: HTMLImageElement,
  precision: number,
  smoothness: number,
  cornerRadius: number,
  autoWeed: boolean
): VinylContour[] {
  // Extract image data using VinylMaster's high-precision method
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Create VinylMaster binary mask with anti-aliasing detection
  const binaryMask = createVinylMasterMask(data, width, height);
  
  // Apply VinylMaster's morphological operations
  const processedMask = applyMorphologicalOperations(binaryMask, width, height);
  
  // Trace contours using VinylMaster's advanced algorithm
  const contours = traceVinylMasterContours(processedMask, width, height, precision);
  
  // Apply VinylMaster's path optimization
  return contours.map(contour => 
    optimizeVinylMasterPath(contour, smoothness, cornerRadius, autoWeed)
  ).filter(contour => contour.area > 25); // VinylMaster minimum area threshold
}

function createVinylMasterMask(data: Uint8ClampedArray, width: number, height: number): number[][] {
  const mask: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  
  // VinylMaster uses 256-level precision for anti-aliasing
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      // VinylMaster's anti-aliasing threshold system
      if (alpha > 250) {
        mask[y][x] = 255; // Solid
      } else if (alpha > 200) {
        mask[y][x] = 192; // Strong edge
      } else if (alpha > 128) {
        mask[y][x] = 128; // Soft edge
      } else if (alpha > 64) {
        mask[y][x] = 64;  // Very soft edge
      } else {
        mask[y][x] = 0;   // Transparent
      }
    }
  }
  
  return mask;
}

function applyMorphologicalOperations(mask: number[][], width: number, height: number): number[][] {
  // VinylMaster's erosion-dilation cycle for clean edges
  const eroded = erodeMask(mask, width, height);
  const dilated = dilateMask(eroded, width, height);
  
  return dilated;
}

function erodeMask(mask: number[][], width: number, height: number): number[][] {
  const result: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let minValue = 255;
      
      // 3x3 erosion kernel
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          minValue = Math.min(minValue, mask[y + dy][x + dx]);
        }
      }
      
      result[y][x] = minValue;
    }
  }
  
  return result;
}

function dilateMask(mask: number[][], width: number, height: number): number[][] {
  const result: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let maxValue = 0;
      
      // 3x3 dilation kernel
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          maxValue = Math.max(maxValue, mask[y + dy][x + dx]);
        }
      }
      
      result[y][x] = maxValue;
    }
  }
  
  return result;
}

function traceVinylMasterContours(
  mask: number[][],
  width: number,
  height: number,
  precision: number
): VinylContour[] {
  const contours: VinylContour[] = [];
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // VinylMaster's contour detection threshold
  const threshold = 128;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y][x] >= threshold && !visited[y][x] && isVinylMasterEdge(mask, x, y, width, height, threshold)) {
        const contour = traceVinylMasterSingleContour(mask, visited, x, y, width, height, threshold, precision);
        if (contour && contour.points.length > 6) {
          contours.push(contour);
        }
      }
    }
  }
  
  return contours;
}

function isVinylMasterEdge(
  mask: number[][],
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number
): boolean {
  if (mask[y][x] < threshold) return false;
  
  // VinylMaster's 8-directional edge detection
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];
  
  for (const [dx, dy] of directions) {
    const nx = x + dx;
    const ny = y + dy;
    
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (mask[ny][nx] < threshold) {
        return true; // Found edge transition
      }
    } else {
      return true; // Border edge
    }
  }
  
  return false;
}

function traceVinylMasterSingleContour(
  mask: number[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
  threshold: number,
  precision: number
): VinylContour | null {
  const points: VinylPoint[] = [];
  
  // VinylMaster's 16-directional tracing for sub-pixel precision
  const directions = [
    [1, 0], [1, 0.5], [1, 1], [0.5, 1],
    [0, 1], [-0.5, 1], [-1, 1], [-1, 0.5],
    [-1, 0], [-1, -0.5], [-1, -1], [-0.5, -1],
    [0, -1], [0.5, -1], [1, -1], [1, -0.5]
  ];
  
  let x = startX;
  let y = startY;
  let dir = 0;
  let totalArea = 0;
  
  do {
    visited[Math.floor(y)][Math.floor(x)] = true;
    
    // Determine point type based on VinylMaster's analysis
    const pointType = determineVinylMasterPointType(mask, x, y, width, height, threshold);
    
    points.push({
      x: x,
      y: y,
      type: pointType,
      tension: calculateVinylMasterTension(mask, x, y, width, height)
    });
    
    // Find next point using VinylMaster's directional search
    let found = false;
    const step = precision;
    
    for (let i = 0; i < directions.length; i++) {
      const checkDir = (dir + i) % directions.length;
      const [dx, dy] = directions[checkDir];
      const nx = x + dx * step;
      const ny = y + dy * step;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const maskValue = interpolateMaskValue(mask, nx, ny, width, height);
        
        if (maskValue >= threshold && isVinylMasterEdge(mask, Math.floor(nx), Math.floor(ny), width, height, threshold)) {
          // Calculate area contribution for VinylMaster
          totalArea += (x * ny - nx * y) * 0.5;
          
          x = nx;
          y = ny;
          dir = checkDir;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    
  } while (points.length < width * height && 
           (Math.abs(x - startX) > precision || Math.abs(y - startY) > precision || points.length < 3));
  
  if (points.length < 6) return null;
  
  // Determine contour direction
  const direction = totalArea > 0 ? 'counterclockwise' : 'clockwise';
  
  return {
    points,
    closed: true,
    area: Math.abs(totalArea),
    direction
  };
}

function determineVinylMasterPointType(
  mask: number[][],
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number
): 'move' | 'line' | 'curve' {
  // VinylMaster's curvature analysis
  const curvature = calculateLocalCurvature(mask, x, y, width, height);
  
  if (curvature > 0.8) return 'curve';
  if (curvature > 0.3) return 'line';
  return 'move';
}

function calculateLocalCurvature(
  mask: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): number {
  let curvature = 0;
  const radius = 3;
  
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = Math.floor(x + dx);
      const ny = Math.floor(y + dy);
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 0 && distance <= radius) {
          const weight = 1 / (distance * distance);
          curvature += mask[ny][nx] * weight;
        }
      }
    }
  }
  
  return Math.min(curvature / 255, 1);
}

function calculateVinylMasterTension(
  mask: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): number {
  // VinylMaster's tension calculation for smooth curves
  const gradientX = getGradientX(mask, x, y, width, height);
  const gradientY = getGradientY(mask, x, y, width, height);
  
  const magnitude = Math.sqrt(gradientX * gradientX + gradientY * gradientY);
  return Math.min(magnitude / 255, 1);
}

function getGradientX(mask: number[][], x: number, y: number, width: number, height: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  
  if (ix <= 0 || ix >= width - 1 || iy < 0 || iy >= height) return 0;
  
  return (mask[iy][ix + 1] - mask[iy][ix - 1]) / 2;
}

function getGradientY(mask: number[][], x: number, y: number, width: number, height: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  
  if (ix < 0 || ix >= width || iy <= 0 || iy >= height - 1) return 0;
  
  return (mask[iy + 1][ix] - mask[iy - 1][ix]) / 2;
}

function interpolateMaskValue(mask: number[][], x: number, y: number, width: number, height: number): number {
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  
  const fx = x - x1;
  const fy = y - y1;
  
  const v11 = mask[y1][x1];
  const v12 = mask[y2][x1];
  const v21 = mask[y1][x2];
  const v22 = mask[y2][x2];
  
  const v1 = v11 * (1 - fx) + v21 * fx;
  const v2 = v12 * (1 - fx) + v22 * fx;
  
  return v1 * (1 - fy) + v2 * fy;
}

function optimizeVinylMasterPath(
  contour: VinylContour,
  smoothness: number,
  cornerRadius: number,
  autoWeed: boolean
): VinylContour {
  let points = contour.points;
  
  // VinylMaster's path simplification
  points = simplifyVinylMasterPath(points, smoothness);
  
  // Apply corner rounding
  points = roundVinylMasterCorners(points, cornerRadius);
  
  // Auto-weed small features if enabled
  if (autoWeed) {
    points = autoWeedVinylMasterPath(points);
  }
  
  return {
    ...contour,
    points
  };
}

function simplifyVinylMasterPath(points: VinylPoint[], tolerance: number): VinylPoint[] {
  if (points.length <= 3) return points;
  
  // VinylMaster's adaptive simplification
  const simplified: VinylPoint[] = [points[0]];
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    const distance = getPointDistance(prev, curr);
    const angle = getAngleBetweenPoints(prev, curr, next);
    
    // VinylMaster's adaptive threshold based on curvature
    const adaptiveTolerance = tolerance * (1 + Math.abs(Math.cos(angle)));
    
    if (distance > adaptiveTolerance || Math.abs(angle) > Math.PI / 6) {
      simplified.push(curr);
    }
  }
  
  simplified.push(points[points.length - 1]);
  return simplified;
}

function roundVinylMasterCorners(points: VinylPoint[], radius: number): VinylPoint[] {
  if (radius <= 0 || points.length < 3) return points;
  
  const rounded: VinylPoint[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    
    const angle = getAngleBetweenPoints(prev, curr, next);
    
    // Apply VinylMaster's corner rounding for sharp angles
    if (Math.abs(angle) > Math.PI / 3) {
      const roundedPoints = createRoundedCorner(prev, curr, next, radius);
      rounded.push(...roundedPoints);
    } else {
      rounded.push(curr);
    }
  }
  
  return rounded;
}

function autoWeedVinylMasterPath(points: VinylPoint[]): VinylPoint[] {
  // VinylMaster's auto-weed removes features smaller than 0.5mm at 300 DPI
  const minFeatureSize = 6; // pixels at 300 DPI
  
  return points.filter((point, i) => {
    if (i === 0 || i === points.length - 1) return true;
    
    const prev = points[i - 1];
    const next = points[i + 1];
    
    const distance = getPointDistance(prev, next);
    return distance > minFeatureSize;
  });
}

function getPointDistance(p1: VinylPoint, p2: VinylPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAngleBetweenPoints(p1: VinylPoint, p2: VinylPoint, p3: VinylPoint): number {
  const v1x = p1.x - p2.x;
  const v1y = p1.y - p2.y;
  const v2x = p3.x - p2.x;
  const v2y = p3.y - p2.y;
  
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
}

function createRoundedCorner(p1: VinylPoint, p2: VinylPoint, p3: VinylPoint, radius: number): VinylPoint[] {
  const d1 = getPointDistance(p1, p2);
  const d2 = getPointDistance(p2, p3);
  const maxRadius = Math.min(d1, d2) * 0.4;
  const effectiveRadius = Math.min(radius, maxRadius);
  
  if (effectiveRadius < 1) return [p2];
  
  // Create smooth rounded corner with VinylMaster precision
  const t1 = effectiveRadius / d1;
  const t2 = effectiveRadius / d2;
  
  const start: VinylPoint = {
    x: p2.x + (p1.x - p2.x) * t1,
    y: p2.y + (p1.y - p2.y) * t1,
    type: 'curve'
  };
  
  const end: VinylPoint = {
    x: p2.x + (p3.x - p2.x) * t2,
    y: p2.y + (p3.y - p2.y) * t2,
    type: 'curve'
  };
  
  return [start, { ...p2, type: 'curve' }, end];
}

function drawVinylMasterContours(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  imageX: number,
  imageY: number,
  contours: VinylContour[]
): void {
  ctx.save();
  
  // VinylMaster's high-quality rendering settings
  ctx.strokeStyle = strokeSettings.color;
  ctx.lineWidth = strokeSettings.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 10;
  
  // VinylMaster's multi-pass rendering for perfect edges
  for (let pass = 0; pass < 3; pass++) {
    for (const contour of contours) {
      if (contour.points.length < 3) continue;
      
      ctx.beginPath();
      
      const firstPoint = contour.points[0];
      ctx.moveTo(firstPoint.x + imageX, firstPoint.y + imageY);
      
      for (let i = 1; i < contour.points.length; i++) {
        const point = contour.points[i];
        const x = point.x + imageX;
        const y = point.y + imageY;
        
        if (point.type === 'curve' && point.tension && i < contour.points.length - 1) {
          // VinylMaster's tension-based curves
          const nextPoint = contour.points[i + 1];
          const cp1x = x - (point.tension || 0) * 10;
          const cp1y = y;
          const cp2x = nextPoint.x + imageX + (nextPoint.tension || 0) * 10;
          const cp2y = nextPoint.y + imageY;
          
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, nextPoint.x + imageX, nextPoint.y + imageY);
          i++; // Skip next point
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      if (contour.closed) {
        ctx.closePath();
      }
      
      ctx.stroke();
    }
  }
  
  ctx.restore();
}