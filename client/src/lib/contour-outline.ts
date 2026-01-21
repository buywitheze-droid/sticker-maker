import type { StrokeSettings, ResizeSettings } from "@/lib/types";
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

export interface ContourPathResult {
  pathPoints: Array<{ x: number; y: number }>;
  widthInches: number;
  heightInches: number;
  imageOffsetX: number;
  imageOffsetY: number;
  backgroundColor: string;
}

interface Point {
  x: number;
  y: number;
}

export function createSilhouetteContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings?: ResizeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const effectiveDPI = resizeSettings 
    ? image.width / resizeSettings.widthInches
    : image.width / 5;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.19 * effectiveDPI);
  } else if (strokeSettings.closeSmallGaps) {
    gapClosePixels = Math.round(0.07 * effectiveDPI);
  }
  
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  const padding = totalOffsetPixels + 10;
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    let autoBridgedMask = silhouetteMask;
    if (autoBridgePixels > 0) {
      const halfAutoBridge = Math.round(autoBridgePixels / 2);
      const dilatedAuto = dilateSilhouette(silhouetteMask, image.width, image.height, halfAutoBridge);
      const dilatedAutoWidth = image.width + halfAutoBridge * 2;
      const dilatedAutoHeight = image.height + halfAutoBridge * 2;
      const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
      
      autoBridgedMask = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          autoBridgedMask[y * image.width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
        }
      }
    }
    
    let bridgedMask = autoBridgedMask;
    let bridgedWidth = image.width;
    let bridgedHeight = image.height;
    
    if (gapClosePixels > 0) {
      const halfGapPixels = Math.round(gapClosePixels / 2);
      
      const dilatedMask = dilateSilhouette(autoBridgedMask, image.width, image.height, halfGapPixels);
      const dilatedWidth = image.width + halfGapPixels * 2;
      const dilatedHeight = image.height + halfGapPixels * 2;
      
      const filledDilated = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
      
      bridgedMask = new Uint8Array(image.width * image.height);
      bridgedMask.set(autoBridgedMask);
      
      for (let y = 1; y < image.height - 1; y++) {
        for (let x = 1; x < image.width - 1; x++) {
          if (autoBridgedMask[y * image.width + x] === 0) {
            const srcX = x + halfGapPixels;
            const srcY = y + halfGapPixels;
            if (filledDilated[srcY * dilatedWidth + srcX] === 1) {
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              for (let d = 1; d <= halfGapPixels && !hasContentTop; d++) {
                if (y - d >= 0 && autoBridgedMask[(y - d) * image.width + x] === 1) hasContentTop = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentBottom; d++) {
                if (y + d < image.height && autoBridgedMask[(y + d) * image.width + x] === 1) hasContentBottom = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentLeft; d++) {
                if (x - d >= 0 && autoBridgedMask[y * image.width + (x - d)] === 1) hasContentLeft = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentRight; d++) {
                if (x + d < image.width && autoBridgedMask[y * image.width + (x + d)] === 1) hasContentRight = true;
              }
              
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[y * image.width + x] = 1;
              }
            }
          }
        }
      }
      
      const smoothBridgePixels = Math.round(0.03 * effectiveDPI / 2);
      if (smoothBridgePixels > 0) {
        const distanceMap = new Float32Array(image.width * image.height);
        distanceMap.fill(Infinity);
        
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (bridgedMask[y * image.width + x] === 1) {
              distanceMap[y * image.width + x] = 0;
            }
          }
        }
        
        for (let y = 1; y < image.height; y++) {
          for (let x = 1; x < image.width - 1; x++) {
            const idx = y * image.width + x;
            const topLeft = distanceMap[(y - 1) * image.width + (x - 1)] + 1.414;
            const top = distanceMap[(y - 1) * image.width + x] + 1;
            const topRight = distanceMap[(y - 1) * image.width + (x + 1)] + 1.414;
            const left = distanceMap[y * image.width + (x - 1)] + 1;
            distanceMap[idx] = Math.min(distanceMap[idx], topLeft, top, topRight, left);
          }
        }
        
        for (let y = image.height - 2; y >= 0; y--) {
          for (let x = image.width - 2; x >= 1; x--) {
            const idx = y * image.width + x;
            const bottomLeft = distanceMap[(y + 1) * image.width + (x - 1)] + 1.414;
            const bottom = distanceMap[(y + 1) * image.width + x] + 1;
            const bottomRight = distanceMap[(y + 1) * image.width + (x + 1)] + 1.414;
            const right = distanceMap[y * image.width + (x + 1)] + 1;
            distanceMap[idx] = Math.min(distanceMap[idx], bottomLeft, bottom, bottomRight, right);
          }
        }
        
        for (let y = 1; y < image.height - 1; y++) {
          for (let x = 1; x < image.width - 1; x++) {
            const idx = y * image.width + x;
            if (bridgedMask[idx] === 0 && distanceMap[idx] <= smoothBridgePixels) {
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              for (let d = 1; d <= smoothBridgePixels && !hasContentTop; d++) {
                if (y - d >= 0 && bridgedMask[(y - d) * image.width + x] === 1) hasContentTop = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentBottom; d++) {
                if (y + d < image.height && bridgedMask[(y + d) * image.width + x] === 1) hasContentBottom = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentLeft; d++) {
                if (x - d >= 0 && bridgedMask[y * image.width + (x - d)] === 1) hasContentLeft = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentRight; d++) {
                if (x + d < image.width && bridgedMask[y * image.width + (x + d)] === 1) hasContentRight = true;
              }
              
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[idx] = 1;
              }
            }
          }
        }
      }
      
      bridgedWidth = image.width;
      bridgedHeight = image.height;
    }
    
    const baseDilatedMask = dilateSilhouette(bridgedMask, bridgedWidth, bridgedHeight, baseOffsetPixels);
    const baseWidth = bridgedWidth + baseOffsetPixels * 2;
    const baseHeight = bridgedHeight + baseOffsetPixels * 2;
    
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
    const dilatedWidth = baseWidth + userOffsetPixels * 2;
    const dilatedHeight = baseHeight + userOffsetPixels * 2;
    
    const bridgedFinalMask = bridgeTouchingContours(finalDilatedMask, dilatedWidth, dilatedHeight, effectiveDPI);
    
    const boundaryPath = traceBoundary(bridgedFinalMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    let smoothedPath = smoothPath(boundaryPath, 2);
    
    // CRITICAL: Fix crossings that occur at sharp corners after offset/dilation
    smoothedPath = fixOffsetCrossings(smoothedPath);
    
    // Apply gap closing using U/N shapes based on settings
    const gapThresholdPixels = strokeSettings.closeBigGaps 
      ? Math.round(0.19 * effectiveDPI) 
      : strokeSettings.closeSmallGaps 
        ? Math.round(0.07 * effectiveDPI) 
        : 0;
    
    if (gapThresholdPixels > 0) {
      smoothedPath = closeGapsWithShapes(smoothedPath, gapThresholdPixels);
    }
    
    const offsetX = padding - totalOffsetPixels;
    const offsetY = padding - totalOffsetPixels;
    drawSmoothContour(ctx, smoothedPath, strokeSettings.color || '#FFFFFF', offsetX, offsetY);
    
    ctx.drawImage(image, padding, padding);
    
  } catch (error) {
    console.error('Silhouette contour error:', error);
    ctx.drawImage(image, padding, padding);
  }
  
  return canvas;
}

function fillSilhouette(mask: Uint8Array, width: number, height: number): Uint8Array {
  const filled = new Uint8Array(mask.length);
  filled.set(mask);
  
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0) queue.push(x);
    if (mask[(height - 1) * width + x] === 0) queue.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    if (mask[y * width] === 0) queue.push(y * width);
    if (mask[y * width + width - 1] === 0) queue.push(y * width + width - 1);
  }
  
  for (const idx of queue) {
    visited[idx] = 1;
  }
  
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 }
    ];
    
    for (const { nx, ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (!visited[nidx] && mask[nidx] === 0) {
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
  }
  
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] === 0 && !visited[i]) {
      filled[i] = 1;
    }
  }
  
  return filled;
}

function bridgeTouchingContours(mask: Uint8Array, width: number, height: number, effectiveDPI: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  result.set(mask);
  
  const bridgeThresholdPixels = Math.max(2, Math.round(0.03 * effectiveDPI));
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      if (mask[idx] === 0) {
        let contentDirections = 0;
        let hasContentTop = false, hasContentBottom = false;
        let hasContentLeft = false, hasContentRight = false;
        
        for (let d = 1; d <= bridgeThresholdPixels; d++) {
          if (!hasContentTop && y - d >= 0 && mask[(y - d) * width + x] === 1) {
            hasContentTop = true;
          }
          if (!hasContentBottom && y + d < height && mask[(y + d) * width + x] === 1) {
            hasContentBottom = true;
          }
          if (!hasContentLeft && x - d >= 0 && mask[y * width + (x - d)] === 1) {
            hasContentLeft = true;
          }
          if (!hasContentRight && x + d < width && mask[y * width + (x + d)] === 1) {
            hasContentRight = true;
          }
        }
        
        let hasContentTopLeft = false, hasContentTopRight = false;
        let hasContentBottomLeft = false, hasContentBottomRight = false;
        
        for (let d = 1; d <= bridgeThresholdPixels; d++) {
          if (!hasContentTopLeft && y - d >= 0 && x - d >= 0 && mask[(y - d) * width + (x - d)] === 1) {
            hasContentTopLeft = true;
          }
          if (!hasContentTopRight && y - d >= 0 && x + d < width && mask[(y - d) * width + (x + d)] === 1) {
            hasContentTopRight = true;
          }
          if (!hasContentBottomLeft && y + d < height && x - d >= 0 && mask[(y + d) * width + (x - d)] === 1) {
            hasContentBottomLeft = true;
          }
          if (!hasContentBottomRight && y + d < height && x + d < width && mask[(y + d) * width + (x + d)] === 1) {
            hasContentBottomRight = true;
          }
        }
        
        if (hasContentTop) contentDirections++;
        if (hasContentBottom) contentDirections++;
        if (hasContentLeft) contentDirections++;
        if (hasContentRight) contentDirections++;
        
        const hasOpposingSides = (hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight);
        const hasDiagonalTouch = (hasContentTopLeft && hasContentBottomRight) || 
                                  (hasContentTopRight && hasContentBottomLeft);
        const isCorner = contentDirections >= 3;
        
        if (hasOpposingSides || isCorner || hasDiagonalTouch) {
          result[idx] = 1;
        }
      }
    }
  }
  
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  for (let x = 0; x < width; x++) {
    if (result[x] === 0 && !visited[x]) {
      queue.push(x);
      visited[x] = 1;
    }
    const bottomIdx = (height - 1) * width + x;
    if (result[bottomIdx] === 0 && !visited[bottomIdx]) {
      queue.push(bottomIdx);
      visited[bottomIdx] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    const leftIdx = y * width;
    if (result[leftIdx] === 0 && !visited[leftIdx]) {
      queue.push(leftIdx);
      visited[leftIdx] = 1;
    }
    const rightIdx = y * width + width - 1;
    if (result[rightIdx] === 0 && !visited[rightIdx]) {
      queue.push(rightIdx);
      visited[rightIdx] = 1;
    }
  }
  
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 }
    ];
    
    for (const { nx, ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (!visited[nidx] && result[nidx] === 0) {
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
  }
  
  for (let i = 0; i < result.length; i++) {
    if (result[i] === 0 && !visited[i]) {
      result[i] = 1;
    }
  }
  
  return result;
}

function createSilhouetteMask(image: HTMLImageElement): Uint8Array {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return new Uint8Array(0);

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] > 10 ? 1 : 0;
  }
  
  return mask;
}

function dilateSilhouette(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const newWidth = width + radius * 2;
  const newHeight = height + radius * 2;
  const dilated = new Uint8Array(newWidth * newHeight);
  
  if (radius <= 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dilated[y * newWidth + x] = mask[y * width + x];
      }
    }
    return dilated;
  }
  
  const circleOffsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        circleOffsets.push({ dx, dy });
      }
    }
  }
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        const centerX = x + radius;
        const centerY = y + radius;
        
        for (const { dx, dy } of circleOffsets) {
          const nx = centerX + dx;
          const ny = centerY + dy;
          if (nx >= 0 && nx < newWidth && ny >= 0 && ny < newHeight) {
            dilated[ny * newWidth + nx] = 1;
          }
        }
      }
    }
  }
  
  return dilated;
}

function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  // MATCHES WORKER EXACTLY - Simple boundary tracing
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  
  if (startX === -1) return [];
  
  const path: Point[] = [];
  const directions = [
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 }
  ];
  
  let x = startX, y = startY;
  let dir = 0;
  const maxSteps = width * height * 2;
  let steps = 0;
  
  do {
    path.push({ x, y });
    
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8;
      const nx = x + directions[checkDir].dx;
      const ny = y + directions[checkDir].dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        x = nx;
        y = ny;
        dir = checkDir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);
  
  return path;
}

function smoothPath(points: Point[], windowSize: number): Point[] {
  // MATCHES WORKER EXACTLY - simple moving average smoothing
  if (points.length < windowSize * 2 + 1) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    let sumX = 0, sumY = 0;
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + n) % n;
      sumX += points[idx].x;
      sumY += points[idx].y;
    }
    result.push({
      x: sumX / (windowSize * 2 + 1),
      y: sumY / (windowSize * 2 + 1)
    });
  }
  
  return result;
}

// Generate U-shaped merge path (for outward curves)
function generateUShapeMerge(start: Point, end: Point, depth: number): Point[] {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [start, end];
  
  const perpX = -dy / len;
  const perpY = dx / len;
  
  const quarterX = (start.x + midX) / 2;
  const quarterY = (start.y + midY) / 2;
  const threeQuarterX = (midX + end.x) / 2;
  const threeQuarterY = (midY + end.y) / 2;
  
  return [
    start,
    { x: quarterX + perpX * depth * 0.5, y: quarterY + perpY * depth * 0.5 },
    { x: midX + perpX * depth, y: midY + perpY * depth },
    { x: threeQuarterX + perpX * depth * 0.5, y: threeQuarterY + perpY * depth * 0.5 },
    end
  ];
}

// Generate N-shaped merge path (for inward/concave transitions)
function generateNShapeMerge(start: Point, end: Point, depth: number): Point[] {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [start, end];
  
  const perpX = dy / len;
  const perpY = -dx / len;
  
  const quarterX = (start.x + midX) / 2;
  const quarterY = (start.y + midY) / 2;
  const threeQuarterX = (midX + end.x) / 2;
  const threeQuarterY = (midY + end.y) / 2;
  
  return [
    start,
    { x: quarterX + perpX * depth * 0.3, y: quarterY + perpY * depth * 0.3 },
    { x: midX + perpX * depth * 0.5, y: midY + perpY * depth * 0.5 },
    { x: threeQuarterX + perpX * depth * 0.3, y: threeQuarterY + perpY * depth * 0.3 },
    end
  ];
}

// Apply merge curves at ALL direction changes
function applyMergeCurves(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  let i = 0;
  while (i < n) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.5 && len2 > 0.5) {
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const cross = v1x * v2y - v1y * v2x;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      // Apply to ANY direction change (more than 15 degrees)
      if (angle > Math.PI / 12) {
        const sharpness = angle / Math.PI;
        const baseDepth = Math.min(len1, len2) * 0.4;
        const depth = Math.max(1, baseDepth * (0.3 + sharpness * 0.7));
        
        if (cross < 0) {
          // Concave turn (inward) - use N shape
          const mergePoints = generateNShapeMerge(prev, next, depth);
          for (let m = 1; m < mergePoints.length - 1; m++) {
            result.push(mergePoints[m]);
          }
          i++;
          continue;
        } else if (cross > 0) {
          // Convex turn (outward) - use U shape
          const mergePoints = generateUShapeMerge(prev, next, depth);
          for (let m = 1; m < mergePoints.length - 1; m++) {
            result.push(mergePoints[m]);
          }
          i++;
          continue;
        }
      }
    }
    
    result.push(curr);
    i++;
  }
  
  return result.length >= 3 ? result : points;
}

// Remove points that overshoot or stick out beyond the smooth path
function removeOvershootingPoints(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  // First pass: detect and unite crossing junctions
  let result = uniteJunctions(points);
  
  // Second pass: remove remaining spikes
  result = removeSpikesFromPath(result);
  
  return result.length >= 3 ? result : points;
}

// Detect where path segments cross or nearly touch and unite them
function uniteJunctions(points: Point[]): Point[] {
  if (points.length < 8) return points;
  
  // First pass: detect sharp turns that need U/N merge shapes
  let result = detectAndMergeSharpTurns(points);
  
  // Second pass: detect close proximity junctions
  result = detectProximityJunctions(result);
  
  return result;
}

// Detect sharp turns (>45 degrees) and apply U/N merge shapes
function detectAndMergeSharpTurns(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  let i = 0;
  while (i < n) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.1 && len2 > 0.1) {
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const cross = v1x * v2y - v1y * v2x;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      // Sharp turn detected (more than 45 degrees) - ALWAYS apply merge
      if (angle > Math.PI / 4) {
        const sharpness = angle / Math.PI;
        // Use larger depth for sharper turns to ensure proper merge
        const depth = Math.max(3, Math.min(len1, len2) * sharpness * 0.6);
        
        if (cross < 0) {
          // Concave (inward) - N shape merge
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          const perpX = (next.y - curr.y) / len2;
          const perpY = -(next.x - curr.x) / len2;
          
          result.push({ x: midX + perpX * depth * 0.4, y: midY + perpY * depth * 0.4 });
          i++;
          continue;
        } else {
          // Convex (outward) - U shape merge
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          const perpX = -(next.y - curr.y) / len2;
          const perpY = (next.x - curr.x) / len2;
          
          result.push({ x: midX + perpX * depth * 0.4, y: midY + perpY * depth * 0.4 });
          i++;
          continue;
        }
      }
    }
    
    result.push(curr);
    i++;
  }
  
  return result.length >= 3 ? result : points;
}

// Detect points that are close in space but far in path order
function detectProximityJunctions(points: Point[]): Point[] {
  if (points.length < 8) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const skipIndices = new Set<number>();
  
  for (let i = 0; i < n; i++) {
    if (skipIndices.has(i)) continue;
    
    const pi = points[i];
    let foundJunction = false;
    
    // Increased search range and decreased distance threshold for tighter detection
    for (let j = i + 4; j < Math.min(i + 60, n); j++) {
      const pathDist = j - i;
      if (pathDist < 4) continue;
      
      const pj = points[j];
      const dist = Math.sqrt((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2);
      
      // Much tighter detection - within 12 pixels now
      if (dist < 12) {
        // Skip all points in the loop
        for (let k = i + 1; k < j; k++) {
          skipIndices.add(k);
        }
        
        // Create smooth merge at junction center
        const mergePoint = { x: (pi.x + pj.x) / 2, y: (pi.y + pj.y) / 2 };
        result.push(mergePoint);
        foundJunction = true;
        break;
      }
    }
    
    if (!foundJunction) {
      result.push(pi);
    }
  }
  
  return result;
}

// Remove individual spike points
function removeSpikesFromPath(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const lineX = next.x - prev.x;
    const lineY = next.y - prev.y;
    const lineLen = Math.sqrt(lineX * lineX + lineY * lineY);
    
    if (lineLen > 0) {
      const toPointX = curr.x - prev.x;
      const toPointY = curr.y - prev.y;
      const cross = Math.abs(lineX * toPointY - lineY * toPointX) / lineLen;
      
      // Skip if point sticks out too far
      if (cross > 12) {
        continue;
      }
    }
    
    result.push(curr);
  }
  
  return result;
}

// Fix crossings that occur in offset contours at sharp corners
function fixOffsetCrossings(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  let result = [...points];
  
  // Multiple passes to catch all crossings
  for (let pass = 0; pass < 3; pass++) {
    result = detectAndFixLineCrossings(result);
    result = mergeClosePathPoints(result);
  }
  
  return result;
}

// Detect where lines actually cross and fix them
function detectAndFixLineCrossings(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const skipUntil = new Map<number, number>();
  
  // OPTIMIZATION: Use stride for large paths
  const stride = n > 1000 ? 3 : 1;
  
  for (let i = 0; i < n; i += stride) {
    // Check if we should skip this point
    let shouldSkip = false;
    const entries = Array.from(skipUntil.entries());
    for (let e = 0; e < entries.length; e++) {
      const [start, end] = entries[e];
      if (i > start && i < end) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    
    // OPTIMIZATION: Limit search range to nearby segments
    const maxSearch = Math.min(n - 1, i + 300);
    for (let j = i + 3; j < maxSearch; j += stride) {
      const p3 = points[j];
      const p4 = points[(j + 1) % n];
      
      const intersection = lineSegmentIntersect(p1, p2, p3, p4);
      if (intersection) {
        // Found a crossing - skip the loop between them and add merge point
        skipUntil.set(i, j);
        result.push(intersection);
        break;
      }
    }
    
    if (!skipUntil.has(i)) {
      result.push(p1);
    }
  }
  
  return result.length >= 3 ? result : points;
}

// Check if two line segments intersect
function lineSegmentIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
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

// Close gaps by detecting where paths are close and applying U/N shapes
function closeGapsWithShapes(points: Point[], gapThreshold: number): Point[] {
  if (points.length < 20) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const processed = new Set<number>();
  
  // Find all gap locations where path points are within threshold but far apart in path order
  const gaps: Array<{i: number, j: number, dist: number}> = [];
  
  // OPTIMIZATION: Use stride to reduce iterations (check every 5th point for large paths)
  const stride = n > 500 ? 5 : n > 200 ? 3 : 1;
  const thresholdSq = gapThreshold * gapThreshold; // Avoid sqrt in inner loop
  
  for (let i = 0; i < n; i += stride) {
    const pi = points[i];
    
    // Look for points far ahead in path order but close spatially
    // OPTIMIZATION: Limit search range and use stride
    const maxSearch = Math.min(n - 10, i + 500); // Limit how far we search
    for (let j = i + 50; j < maxSearch; j += stride) {
      const pj = points[j];
      const distSq = (pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2;
      
      if (distSq < thresholdSq) {
        // Found a gap - points are close but path travels far between them
        gaps.push({i, j, dist: Math.sqrt(distSq)});
        break; // Only record first gap from this point
      }
    }
  }
  
  if (gaps.length === 0) return points;
  
  // Sort gaps by path position
  gaps.sort((a, b) => a.i - b.i);
  
  // Process path, applying U/N shapes at gap locations
  let currentIdx = 0;
  
  for (const gap of gaps) {
    // Skip overlapping gaps
    if (gap.i < currentIdx) continue;
    
    // Add points before the gap
    for (let k = currentIdx; k <= gap.i; k++) {
      if (!processed.has(k)) {
        result.push(points[k]);
        processed.add(k);
      }
    }
    
    // Create a U or N shape to bridge the gap
    const p1 = points[gap.i];
    const p2 = points[gap.j];
    
    // Determine direction of the bridge
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    
    // Get direction perpendicular to the gap
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const gapDist = Math.sqrt(dx * dx + dy * dy);
    
    if (gapDist > 0.5) {
      // Perpendicular direction (rotate 90 degrees)
      const perpX = -dy / gapDist;
      const perpY = dx / gapDist;
      
      // Determine which direction to bulge based on path direction
      // Check if points before gap.i are to left or right of the gap line
      const checkIdx = Math.max(0, gap.i - 5);
      const checkPt = points[checkIdx];
      const crossProduct = (checkPt.x - p1.x) * perpY - (checkPt.y - p1.y) * perpX;
      
      // Bulge amount - proportional to gap size
      const bulgeAmount = Math.min(gapDist * 0.3, gapThreshold * 0.4);
      const bulgeDir = crossProduct > 0 ? 1 : -1;
      
      // Create U-shape points
      const ctrl1X = p1.x + perpX * bulgeAmount * bulgeDir;
      const ctrl1Y = p1.y + perpY * bulgeAmount * bulgeDir;
      const ctrlMidX = midX + perpX * bulgeAmount * 1.5 * bulgeDir;
      const ctrlMidY = midY + perpY * bulgeAmount * 1.5 * bulgeDir;
      const ctrl2X = p2.x + perpX * bulgeAmount * bulgeDir;
      const ctrl2Y = p2.y + perpY * bulgeAmount * bulgeDir;
      
      // Add the U-shape points
      result.push({x: ctrl1X, y: ctrl1Y});
      result.push({x: ctrlMidX, y: ctrlMidY});
      result.push({x: ctrl2X, y: ctrl2Y});
    }
    
    // Skip all points between i and j (the gap portion of the path)
    for (let k = gap.i + 1; k < gap.j; k++) {
      processed.add(k);
    }
    
    currentIdx = gap.j;
  }
  
  // Add remaining points
  for (let k = currentIdx; k < n; k++) {
    if (!processed.has(k)) {
      result.push(points[k]);
    }
  }
  
  return result.length >= 3 ? result : points;
}

// Merge points that are very close together (indicating a near-crossing)
function mergeClosePathPoints(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const skipIndices = new Set<number>();
  
  // OPTIMIZATION: Use stride for large paths
  const stride = n > 1000 ? 3 : 1;
  
  for (let i = 0; i < n; i += stride) {
    if (skipIndices.has(i)) continue;
    
    const pi = points[i];
    
    // OPTIMIZATION: Limit search range
    const maxSearch = Math.min(n, i + 300);
    for (let j = i + 10; j < maxSearch; j += stride) {
      if (skipIndices.has(j)) continue;
      
      const pj = points[j];
      const distSq = (pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2;
      
      // Increased threshold to catch all near-crossings (10px = 100 squared)
      if (distSq < 100) {
        // Skip all points between i and j
        for (let k = i + 1; k < j; k++) {
          skipIndices.add(k);
        }
        // Add merge point
        result.push({ x: (pi.x + pj.x) / 2, y: (pi.y + pj.y) / 2 });
        skipIndices.add(j);
        break;
      }
    }
    
    if (!skipIndices.has(i)) {
      result.push(pi);
    }
  }
  
  return result.length >= 3 ? result : points;
}

function removeSpikes(points: Point[], neighborDistance: number, threshold: number): Point[] {
  if (points.length < neighborDistance * 2 + 3) return points;
  
  const result: Point[] = [];
  const isSpike = new Array(points.length).fill(false);
  
  for (let i = 0; i < points.length; i++) {
    const prevIdx = (i - neighborDistance + points.length) % points.length;
    const nextIdx = (i + neighborDistance) % points.length;
    
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[nextIdx];
    
    const expectedX = (prev.x + next.x) / 2;
    const expectedY = (prev.y + next.y) / 2;
    
    const deviation = Math.sqrt((curr.x - expectedX) ** 2 + (curr.y - expectedY) ** 2);
    
    const spanDistance = Math.sqrt((next.x - prev.x) ** 2 + (next.y - prev.y) ** 2);
    
    if (spanDistance > 0 && deviation / spanDistance > threshold) {
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (mag1 > 0 && mag2 > 0) {
        const cosAngle = dot / (mag1 * mag2);
        if (cosAngle < 0.3) {
          isSpike[i] = true;
        }
      }
    }
  }
  
  for (let i = 0; i < points.length; i++) {
    if (isSpike[i]) {
      let prevGood = i - 1;
      while (prevGood >= 0 && isSpike[(prevGood + points.length) % points.length]) {
        prevGood--;
      }
      let nextGood = i + 1;
      while (nextGood < points.length * 2 && isSpike[nextGood % points.length]) {
        nextGood++;
      }
      
      const prev = points[(prevGood + points.length) % points.length];
      const next = points[nextGood % points.length];
      
      const t = 0.5;
      result.push({
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t
      });
    } else {
      result.push(points[i]);
    }
  }
  
  return result;
}

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

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
  const nearestX = lineStart.x + t * dx;
  const nearestY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - nearestX) ** 2 + (point.y - nearestY) ** 2);
}

function drawSmoothContour(ctx: CanvasRenderingContext2D, contour: Point[], color: string, offsetX: number, offsetY: number): void {
  if (contour.length < 3) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  
  const start = contour[0];
  ctx.moveTo(start.x + offsetX, start.y + offsetY);
  
  // Use simple lineTo to prevent bezier curves from reintroducing crossings
  for (let i = 1; i < contour.length; i++) {
    const p = contour[i];
    ctx.lineTo(p.x + offsetX, p.y + offsetY);
  }
  
  ctx.closePath();
  ctx.stroke();
  
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

export function getContourPath(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings
): ContourPathResult | null {
  // This function now matches the Web Worker algorithm exactly
  console.log('[getContourPath] Starting with NEW algorithm matching worker');
  console.log('[getContourPath] strokeSettings:', { 
    width: strokeSettings.width, 
    alphaThreshold: strokeSettings.alphaThreshold,
    closeSmallGaps: strokeSettings.closeSmallGaps,
    closeBigGaps: strokeSettings.closeBigGaps
  });
  const effectiveDPI = image.width / resizeSettings.widthInches;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  try {
    // Get image data with alpha threshold (matches worker)
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    
    tempCanvas.width = image.width;
    tempCanvas.height = image.height;
    tempCtx.drawImage(image, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;
    
    // Create silhouette mask with alpha threshold (matches worker)
    const silhouetteMask = new Uint8Array(image.width * image.height);
    const threshold = strokeSettings.alphaThreshold || 128;
    for (let i = 0; i < silhouetteMask.length; i++) {
      silhouetteMask[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
    }
    
    if (silhouetteMask.length === 0) return null;
    
    // Auto bridge step (matches worker)
    let autoBridgedMask = silhouetteMask;
    if (autoBridgePixels > 0) {
      const halfAutoBridge = Math.round(autoBridgePixels / 2);
      const dilatedAuto = dilateSilhouette(silhouetteMask, image.width, image.height, halfAutoBridge);
      const dilatedAutoWidth = image.width + halfAutoBridge * 2;
      const dilatedAutoHeight = image.height + halfAutoBridge * 2;
      const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
      
      autoBridgedMask = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          autoBridgedMask[y * image.width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
        }
      }
    }
    
    // Base dilation (matches worker - NO gap closing through mask dilation)
    const baseDilatedMask = dilateSilhouette(autoBridgedMask, image.width, image.height, baseOffsetPixels);
    const baseWidth = image.width + baseOffsetPixels * 2;
    const baseHeight = image.height + baseOffsetPixels * 2;
    
    // Fill silhouette (matches worker)
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    // User offset dilation (matches worker)
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
    const dilatedWidth = baseWidth + userOffsetPixels * 2;
    const dilatedHeight = baseHeight + userOffsetPixels * 2;
    
    // Trace boundary (matches worker - NO bridgeTouchingContours)
    const boundaryPath = traceBoundary(finalDilatedMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) return null;
    
    // Smooth path (matches worker)
    let smoothedPath = smoothPath(boundaryPath, 2);
    console.log('[getContourPath] After smooth, path points:', smoothedPath.length);
    
    // Fix crossings (matches worker)
    smoothedPath = fixOffsetCrossings(smoothedPath);
    console.log('[getContourPath] After fixOffsetCrossings, path points:', smoothedPath.length);
    
    // Apply gap closing using U/N shapes based on settings (matches worker)
    const gapThresholdPixels = strokeSettings.closeBigGaps 
      ? Math.round(0.19 * effectiveDPI) 
      : strokeSettings.closeSmallGaps 
        ? Math.round(0.07 * effectiveDPI) 
        : 0;
    
    if (gapThresholdPixels > 0) {
      smoothedPath = closeGapsWithShapes(smoothedPath, gapThresholdPixels);
    }
    
    const widthInches = dilatedWidth / effectiveDPI;
    const heightInches = dilatedHeight / effectiveDPI;
    
    const pathInInches = smoothedPath.map(p => ({
      x: p.x / effectiveDPI,
      y: heightInches - (p.y / effectiveDPI)
    }));
    
    const imageOffsetX = totalOffsetPixels / effectiveDPI;
    const imageOffsetY = totalOffsetPixels / effectiveDPI;
    
    return {
      pathPoints: pathInInches,
      widthInches,
      heightInches,
      imageOffsetX,
      imageOffsetY,
      backgroundColor: strokeSettings.backgroundColor
    };
  } catch (error) {
    console.error('Error getting contour path:', error);
    return null;
  }
}

export async function downloadContourPDF(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings,
  filename: string
): Promise<void> {
  const contourResult = getContourPath(image, strokeSettings, resizeSettings);
  if (!contourResult) {
    console.error('Failed to generate contour path');
    return;
  }
  
  const { pathPoints, widthInches, heightInches, imageOffsetX, imageOffsetY } = contourResult;
  
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const blob = await new Promise<Blob>((resolve) => {
    tempCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  const imageXPts = imageOffsetX * 72;
  const imageWidthPts = resizeSettings.widthInches * 72;
  const imageHeightPts = resizeSettings.heightInches * 72;
  const imageYPts = imageOffsetY * 72;
  
  page.drawImage(pngImage, {
    x: imageXPts,
    y: imageYPts,
    width: imageWidthPts,
    height: imageHeightPts,
  });
  
  if (pathPoints.length > 2) {
    const context = pdfDoc.context;
    
    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [0, 1, 0, 0],
      N: 1,
    });
    const tintFunctionRef = context.register(tintFunction);
    
    const separationColorSpace = context.obj([
      PDFName.of('Separation'),
      PDFName.of('CutContour'),
      PDFName.of('DeviceCMYK'),
      tintFunctionRef,
    ]);
    const separationRef = context.register(separationColorSpace);
    
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
    }
    
    let pathOps = '';
    pathOps += '/CutContour CS 1 SCN\n';
    pathOps += '0.5 w\n';
    
    const startX = pathPoints[0].x * 72;
    const startY = pathPoints[0].y * 72;
    pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
    
    for (let i = 0; i < pathPoints.length; i++) {
      const p0 = pathPoints[(i - 1 + pathPoints.length) % pathPoints.length];
      const p1 = pathPoints[i];
      const p2 = pathPoints[(i + 1) % pathPoints.length];
      const p3 = pathPoints[(i + 2) % pathPoints.length];
      
      const tension = 0.5;
      const cp1x = (p1.x + (p2.x - p0.x) * tension / 3) * 72;
      const cp1y = (p1.y + (p2.y - p0.y) * tension / 3) * 72;
      const cp2x = (p2.x - (p3.x - p1.x) * tension / 3) * 72;
      const cp2y = (p2.y - (p3.y - p1.y) * tension / 3) * 72;
      const endX = p2.x * 72;
      const endY = p2.y * 72;
      
      pathOps += `${cp1x.toFixed(4)} ${cp1y.toFixed(4)} ${cp2x.toFixed(4)} ${cp2y.toFixed(4)} ${endX.toFixed(4)} ${endY.toFixed(4)} c\n`;
    }
    
    pathOps += 'h S\n';
    
    const existingContents = page.node.Contents();
    if (existingContents) {
      const contentStream = context.stream(pathOps);
      const contentStreamRef = context.register(contentStream);
      
      if (existingContents instanceof PDFArray) {
        existingContents.push(contentStreamRef);
      } else {
        const newContents = context.obj([existingContents, contentStreamRef]);
        page.node.set(PDFName.of('Contents'), newContents);
      }
    }
  }
  
  pdfDoc.setTitle('Sticker with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector']);
  
  const pdfBytes = await pdfDoc.save();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function generateContourPDFBase64(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings
): Promise<string | null> {
  const contourResult = getContourPath(image, strokeSettings, resizeSettings);
  if (!contourResult) {
    console.error('Failed to generate contour path');
    return null;
  }
  
  const { pathPoints, widthInches, heightInches, imageOffsetX, imageOffsetY, backgroundColor } = contourResult;
  
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  
  // Create background raster image with the contour shape filled
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');
  if (!bgCtx) return null;
  
  const bgDPI = 300;
  bgCanvas.width = Math.round(widthInches * bgDPI);
  bgCanvas.height = Math.round(heightInches * bgDPI);
  
  // Fill the contour path with the background color
  bgCtx.fillStyle = backgroundColor;
  bgCtx.beginPath();
  if (pathPoints.length > 0) {
    bgCtx.moveTo(pathPoints[0].x * bgDPI, (heightInches - pathPoints[0].y) * bgDPI);
    for (let i = 1; i < pathPoints.length; i++) {
      bgCtx.lineTo(pathPoints[i].x * bgDPI, (heightInches - pathPoints[i].y) * bgDPI);
    }
    bgCtx.closePath();
    bgCtx.fill();
  }
  
  const bgBlob = await new Promise<Blob>((resolve) => {
    bgCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const bgPngBytes = new Uint8Array(await bgBlob.arrayBuffer());
  const bgPngImage = await pdfDoc.embedPng(bgPngBytes);
  
  // Draw the background raster image first
  page.drawImage(bgPngImage, {
    x: 0,
    y: 0,
    width: widthPts,
    height: heightPts,
  });
  
  // Now draw the design image on top
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const blob = await new Promise<Blob>((resolve) => {
    tempCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  const imageXPts = imageOffsetX * 72;
  const imageWidthPts = resizeSettings.widthInches * 72;
  const imageHeightPts = resizeSettings.heightInches * 72;
  const imageYPts = imageOffsetY * 72;
  
  page.drawImage(pngImage, {
    x: imageXPts,
    y: imageYPts,
    width: imageWidthPts,
    height: imageHeightPts,
  });
  
  if (pathPoints.length > 2) {
    const context = pdfDoc.context;
    
    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [0, 1, 0, 0],
      N: 1,
    });
    const tintFunctionRef = context.register(tintFunction);
    
    const separationColorSpace = context.obj([
      PDFName.of('Separation'),
      PDFName.of('CutContour'),
      PDFName.of('DeviceCMYK'),
      tintFunctionRef,
    ]);
    const separationRef = context.register(separationColorSpace);
    
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
    }
    
    let pathOps = '';
    pathOps += '/CutContour CS 1 SCN\n';
    pathOps += '0.5 w\n';
    
    const startX = pathPoints[0].x * 72;
    const startY = pathPoints[0].y * 72;
    pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
    
    for (let i = 0; i < pathPoints.length; i++) {
      const p0 = pathPoints[(i - 1 + pathPoints.length) % pathPoints.length];
      const p1 = pathPoints[i];
      const p2 = pathPoints[(i + 1) % pathPoints.length];
      const p3 = pathPoints[(i + 2) % pathPoints.length];
      
      const tension = 0.5;
      const cp1x = (p1.x + (p2.x - p0.x) * tension / 3) * 72;
      const cp1y = (p1.y + (p2.y - p0.y) * tension / 3) * 72;
      const cp2x = (p2.x - (p3.x - p1.x) * tension / 3) * 72;
      const cp2y = (p2.y - (p3.y - p1.y) * tension / 3) * 72;
      const endX = p2.x * 72;
      const endY = p2.y * 72;
      
      pathOps += `${cp1x.toFixed(4)} ${cp1y.toFixed(4)} ${cp2x.toFixed(4)} ${cp2y.toFixed(4)} ${endX.toFixed(4)} ${endY.toFixed(4)} c\n`;
    }
    
    pathOps += 'h S\n';
    
    const existingContents = page.node.Contents();
    if (existingContents) {
      const contentStream = context.stream(pathOps);
      const contentStreamRef = context.register(contentStream);
      
      if (existingContents instanceof PDFArray) {
        existingContents.push(contentStreamRef);
      } else {
        const newContents = context.obj([existingContents, contentStreamRef]);
        page.node.set(PDFName.of('Contents'), newContents);
      }
    }
  }
  
  pdfDoc.setTitle('Sticker with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  
  const pdfBytes = await pdfDoc.save();
  
  let binary = '';
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}
