import { StrokeSettings, ResizeSettings, ShapeSettings } from "@/components/image-editor";
import { PDFDocument, PDFPage, rgb, PDFName, PDFArray, PDFDict, PDFStream, PDFRef } from 'pdf-lib';
import { cropImageToContent } from './image-crop';

export interface ContourPathResult {
  pathPoints: Array<{ x: number; y: number }>; // Points in inches
  widthInches: number;
  heightInches: number;
  imageOffsetX: number; // Image position offset in inches
  imageOffsetY: number;
}

export function createSilhouetteContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings?: ResizeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Calculate effective DPI based on actual image dimensions and target inches
  const effectiveDPI = resizeSettings 
    ? image.width / resizeSettings.widthInches
    : image.width / 5; // Default assumption: image represents ~5 inches
  
  // Base offset (0.015") to create unified silhouette for multi-object images
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  // Auto-bridge offset (0.02") - always applied to bridge outlines within 0.02" of each other
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  // Additional gap closing offsets - small (0.07") or big (0.17")
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.17 * effectiveDPI);
  } else if (strokeSettings.closeSmallGaps) {
    gapClosePixels = Math.round(0.07 * effectiveDPI);
  }
  
  // User-selected offset on top of base
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  
  // Total offset is base + user selection (gap close doesn't add to outline size)
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  // Canvas needs extra space for the total contour offset
  const padding = totalOffsetPixels + 10;
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Step 1: Create binary silhouette mask from alpha channel
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 2: Auto-bridge outlines within 0.02" of each other (always applied)
    // This makes cutting easier by connecting nearby elements
    let autoBridgedMask = silhouetteMask;
    if (autoBridgePixels > 0) {
      const halfAutoBridge = Math.round(autoBridgePixels / 2);
      const dilatedAuto = dilateSilhouette(silhouetteMask, image.width, image.height, halfAutoBridge);
      const dilatedAutoWidth = image.width + halfAutoBridge * 2;
      const dilatedAutoHeight = image.height + halfAutoBridge * 2;
      const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
      
      // Extract center portion
      autoBridgedMask = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          autoBridgedMask[y * image.width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
        }
      }
    }
    
    // Step 3: If gap closing is enabled, only fill interior gaps without changing outer boundary
    let bridgedMask = autoBridgedMask;
    let bridgedWidth = image.width;
    let bridgedHeight = image.height;
    
    if (gapClosePixels > 0) {
      // Use morphological closing: dilate, fill holes, then erode back
      // This closes gaps while preserving the outer boundary shape
      const halfGapPixels = Math.round(gapClosePixels / 2);
      
      // Step 3a: Dilate to connect nearby elements
      const dilatedMask = dilateSilhouette(autoBridgedMask, image.width, image.height, halfGapPixels);
      const dilatedWidth = image.width + halfGapPixels * 2;
      const dilatedHeight = image.height + halfGapPixels * 2;
      
      // Step 3b: Fill interior holes in the dilated mask
      const filledDilated = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
      
      // Step 3c: Find interior gap pixels only (pixels that are gaps surrounded by content)
      bridgedMask = new Uint8Array(image.width * image.height);
      bridgedMask.set(autoBridgedMask); // Start with original
      
      // Only fill pixels that bridge content in opposing directions
      for (let y = 1; y < image.height - 1; y++) {
        for (let x = 1; x < image.width - 1; x++) {
          if (autoBridgedMask[y * image.width + x] === 0) {
            const srcX = x + halfGapPixels;
            const srcY = y + halfGapPixels;
            if (filledDilated[srcY * dilatedWidth + srcX] === 1) {
              // Check for content in opposing directions within halfGapPixels distance
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
              
              // Bridge if content on opposing sides (vertical or horizontal bridge)
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[y * image.width + x] = 1;
              }
            }
          }
        }
      }
      
      // Step 3d: After gap closing, create smooth bridges for any outlines within 0.03" of each other
      const smoothBridgePixels = Math.round(0.03 * effectiveDPI / 2);
      if (smoothBridgePixels > 0) {
        // Create a distance map from the mask - for each empty pixel, find distance to nearest content
        const distanceMap = new Float32Array(image.width * image.height);
        distanceMap.fill(Infinity);
        
        // Initialize with content pixels having distance 0
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (bridgedMask[y * image.width + x] === 1) {
              distanceMap[y * image.width + x] = 0;
            }
          }
        }
        
        // Forward pass for distance transform
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
        
        // Backward pass
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
        
        // Find pixels within smoothBridgePixels distance that bridge two separate content areas
        for (let y = 1; y < image.height - 1; y++) {
          for (let x = 1; x < image.width - 1; x++) {
            const idx = y * image.width + x;
            if (bridgedMask[idx] === 0 && distanceMap[idx] <= smoothBridgePixels) {
              // Check if this pixel bridges content (has content in opposing directions)
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              // Look for content in each direction within smoothBridgePixels
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
              
              // Bridge if content on opposing sides (vertical or horizontal bridge)
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
    
    // Step 3: Dilate by base offset to create unified silhouette
    const baseDilatedMask = dilateSilhouette(bridgedMask, bridgedWidth, bridgedHeight, baseOffsetPixels);
    const baseWidth = bridgedWidth + baseOffsetPixels * 2;
    const baseHeight = bridgedHeight + baseOffsetPixels * 2;
    
    // Step 4: Fill the base silhouette to create solid shape
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    // Step 5: Dilate the filled silhouette by user-selected offset
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
    const dilatedWidth = baseWidth + userOffsetPixels * 2;
    const dilatedHeight = baseHeight + userOffsetPixels * 2;
    
    // Step 5: Trace the boundary of the final dilated silhouette
    const boundaryPath = traceBoundary(finalDilatedMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 6: Smooth and simplify the path
    const smoothedPath = smoothPath(boundaryPath, 2);
    
    // Step 7: Draw the contour
    const offsetX = padding - totalOffsetPixels;
    const offsetY = padding - totalOffsetPixels;
    drawSmoothContour(ctx, smoothedPath, strokeSettings.color || '#FFFFFF', offsetX, offsetY);
    
    // Step 8: Draw the original image on top
    ctx.drawImage(image, padding, padding);
    
  } catch (error) {
    console.error('Silhouette contour error:', error);
    ctx.drawImage(image, padding, padding);
  }
  
  return canvas;
}

// Fill interior of silhouette using flood fill from edges
function fillSilhouette(mask: Uint8Array, width: number, height: number): Uint8Array {
  const filled = new Uint8Array(mask.length);
  filled.set(mask);
  
  // Mark all exterior transparent pixels by flood filling from edges
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  // Add all edge pixels that are transparent to the queue
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0) queue.push(x);
    if (mask[(height - 1) * width + x] === 0) queue.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    if (mask[y * width] === 0) queue.push(y * width);
    if (mask[y * width + width - 1] === 0) queue.push(y * width + width - 1);
  }
  
  // Mark initial queue items as visited
  for (const idx of queue) {
    visited[idx] = 1;
  }
  
  // Flood fill to find all exterior pixels
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    // Check 4-connected neighbors
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
  
  // Fill all non-exterior transparent pixels (interior holes)
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] === 0 && !visited[i]) {
      filled[i] = 1; // Fill interior holes
    }
  }
  
  return filled;
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
  
  // Create binary silhouette: 1 = any visible pixel (alpha > 0), 0 = fully transparent
  // Using a low threshold (10) to catch even semi-transparent edges
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
    // Just copy to center
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dilated[y * newWidth + x] = mask[y * width + x];
      }
    }
    return dilated;
  }
  
  // Precompute circle offsets
  const circleOffsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        circleOffsets.push({ dx, dy });
      }
    }
  }
  
  // Dilate: for each solid pixel, fill a circle around it
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

// Erode silhouette - shrink the mask by removing pixels near edges
function erodeSilhouette(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const newWidth = width - radius * 2;
  const newHeight = height - radius * 2;
  
  if (newWidth <= 0 || newHeight <= 0 || radius <= 0) {
    return new Uint8Array(width * height);
  }
  
  const eroded = new Uint8Array(newWidth * newHeight);
  
  // Precompute circle offsets for checking
  const circleOffsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        circleOffsets.push({ dx, dy });
      }
    }
  }
  
  // Erode: a pixel is solid only if ALL pixels in its radius are solid
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = x + radius;
      const srcY = y + radius;
      
      let allSolid = true;
      for (const { dx, dy } of circleOffsets) {
        const checkX = srcX + dx;
        const checkY = srcY + dy;
        if (checkX >= 0 && checkX < width && checkY >= 0 && checkY < height) {
          if (mask[checkY * width + checkX] === 0) {
            allSolid = false;
            break;
          }
        } else {
          allSolid = false;
          break;
        }
      }
      
      eroded[y * newWidth + x] = allSolid ? 1 : 0;
    }
  }
  
  return eroded;
}

interface Point {
  x: number;
  y: number;
}

function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  // Find all edge pixels first
  const edgePixels: Point[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        // Check if on edge (has at least one transparent neighbor)
        const hasTransparentNeighbor = 
          x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
          mask[y * width + (x - 1)] === 0 ||
          mask[y * width + (x + 1)] === 0 ||
          mask[(y - 1) * width + x] === 0 ||
          mask[(y + 1) * width + x] === 0;
        
        if (hasTransparentNeighbor) {
          edgePixels.push({ x, y });
        }
      }
    }
  }
  
  if (edgePixels.length === 0) return [];
  
  // Create a set for quick lookup
  const edgeSet = new Set(edgePixels.map(p => `${p.x},${p.y}`));
  
  // Start from the topmost-leftmost edge pixel
  let startPixel = edgePixels[0];
  for (const p of edgePixels) {
    if (p.y < startPixel.y || (p.y === startPixel.y && p.x < startPixel.x)) {
      startPixel = p;
    }
  }
  
  // Trace boundary by following connected edge pixels
  const boundary: Point[] = [];
  const visited = new Set<string>();
  
  // 8-directional neighbors (clockwise starting from right)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  
  let current = startPixel;
  let prevDir = 4; // Coming from the left (since we found leftmost pixel)
  
  const maxIterations = edgePixels.length * 2;
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const key = `${current.x},${current.y}`;
    
    if (boundary.length > 0 && current.x === startPixel.x && current.y === startPixel.y) {
      break; // Completed the loop
    }
    
    if (!visited.has(key)) {
      boundary.push({ x: current.x, y: current.y });
      visited.add(key);
    }
    
    // Find next edge pixel, searching clockwise from the direction we came from
    let found = false;
    const searchStart = (prevDir + 5) % 8; // Start searching from 90 degrees left of incoming direction
    
    for (let i = 0; i < 8; i++) {
      const dir = (searchStart + i) % 8;
      const nx = current.x + dx[dir];
      const ny = current.y + dy[dir];
      const nkey = `${nx},${ny}`;
      
      if (edgeSet.has(nkey) && !visited.has(nkey)) {
        current = { x: nx, y: ny };
        prevDir = dir;
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Try to find any unvisited connected edge pixel
      for (let i = 0; i < 8; i++) {
        const nx = current.x + dx[i];
        const ny = current.y + dy[i];
        const nkey = `${nx},${ny}`;
        
        if (edgeSet.has(nkey) && !visited.has(nkey)) {
          current = { x: nx, y: ny };
          prevDir = i;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
  }
  
  return boundary;
}

function smoothPath(points: Point[], windowSize: number): Point[] {
  if (points.length < windowSize * 2 + 1) return points;
  
  const smoothed: Point[] = [];
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + points.length) % points.length;
      sumX += points[idx].x;
      sumY += points[idx].y;
      count++;
    }
    
    smoothed.push({
      x: sumX / count,
      y: sumY / count
    });
  }
  
  // Simplify to reduce point count
  return douglasPeucker(smoothed, 1.0);
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
  
  // Add subtle shadow for visibility
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  
  // Start from the first point
  const start = contour[0];
  ctx.moveTo(start.x + offsetX, start.y + offsetY);
  
  // Draw smooth curves through points using Catmull-Rom to Bezier conversion
  for (let i = 0; i < contour.length; i++) {
    const p0 = contour[(i - 1 + contour.length) % contour.length];
    const p1 = contour[i];
    const p2 = contour[(i + 1) % contour.length];
    const p3 = contour[(i + 2) % contour.length];
    
    // Catmull-Rom to cubic Bezier conversion
    const tension = 0.5;
    const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3;
    
    ctx.bezierCurveTo(
      cp1x + offsetX, cp1y + offsetY,
      cp2x + offsetX, cp2y + offsetY,
      p2.x + offsetX, p2.y + offsetY
    );
  }
  
  ctx.closePath();
  ctx.stroke();
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

// Get contour path points for vector export
export function getContourPath(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings
): ContourPathResult | null {
  const effectiveDPI = image.width / resizeSettings.widthInches;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.17 * effectiveDPI);
  } else if (strokeSettings.closeSmallGaps) {
    gapClosePixels = Math.round(0.07 * effectiveDPI);
  }
  
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  try {
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) return null;
    
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
    }
    
    const baseDilatedMask = dilateSilhouette(bridgedMask, image.width, image.height, baseOffsetPixels);
    const baseWidth = image.width + baseOffsetPixels * 2;
    const baseHeight = image.height + baseOffsetPixels * 2;
    
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
    const dilatedWidth = baseWidth + userOffsetPixels * 2;
    const dilatedHeight = baseHeight + userOffsetPixels * 2;
    
    const boundaryPath = traceBoundary(finalDilatedMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) return null;
    
    const smoothedPath = smoothPath(boundaryPath, 2);
    
    // Convert to inches and flip Y for PDF coordinate system (Y=0 at bottom)
    const widthInches = dilatedWidth / effectiveDPI;
    const heightInches = dilatedHeight / effectiveDPI;
    
    // Flip Y coordinates so (0,0) is bottom-left instead of top-left
    const pathInInches = smoothedPath.map(p => ({
      x: p.x / effectiveDPI,
      y: heightInches - (p.y / effectiveDPI) // Flip Y
    }));
    
    const imageOffsetX = totalOffsetPixels / effectiveDPI;
    const imageOffsetY = totalOffsetPixels / effectiveDPI;
    
    return {
      pathPoints: pathInInches,
      widthInches,
      heightInches,
      imageOffsetX,
      imageOffsetY
    };
  } catch (error) {
    console.error('Error getting contour path:', error);
    return null;
  }
}

// Download PDF with raster image and vector contour using spot color "CutContour"
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
  
  // Convert inches to points (72 points per inch)
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  
  // Create a canvas to get the image as PNG bytes
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  // Get PNG data as blob then array buffer
  const blob = await new Promise<Blob>((resolve) => {
    tempCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  // Embed the PNG image
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  // Draw image on page (convert inches to points)
  // Path points are already flipped to PDF coordinates (Y=0 at bottom)
  // Image Y position: imageOffsetY is from the BOTTOM in this coordinate system
  const imageXPts = imageOffsetX * 72;
  const imageWidthPts = resizeSettings.widthInches * 72;
  const imageHeightPts = resizeSettings.heightInches * 72;
  const imageYPts = imageOffsetY * 72; // Y from bottom
  
  page.drawImage(pngImage, {
    x: imageXPts,
    y: imageYPts,
    width: imageWidthPts,
    height: imageHeightPts,
  });
  
  // Build the contour path as PDF operators with spot color
  if (pathPoints.length > 2) {
    // Create spot color "CutContour" using Separation color space
    // The path will be drawn using raw PDF content stream operators
    const context = pdfDoc.context;
    
    // Create the tint transform function (maps 1.0 tint to magenta in CMYK)
    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],  // 0% tint = no color
      C1: [0, 1, 0, 0],  // 100% tint = magenta (in CMYK)
      N: 1,
    });
    const tintFunctionRef = context.register(tintFunction);
    
    // Create the Separation color space array
    const separationColorSpace = context.obj([
      PDFName.of('Separation'),
      PDFName.of('CutContour'),
      PDFName.of('DeviceCMYK'),
      tintFunctionRef,
    ]);
    const separationRef = context.register(separationColorSpace);
    
    // Add color space to page resources
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
    }
    
    // Build path operators
    let pathOps = '';
    
    // Set spot color for stroking: /CutContour CS 1 SCN
    pathOps += '/CutContour CS 1 SCN\n';
    
    // Set line width (0.5 points = thin line for cutting)
    pathOps += '0.5 w\n';
    
    // Move to first point (convert to points, Y already flipped in path data)
    const startX = pathPoints[0].x * 72;
    const startY = pathPoints[0].y * 72;
    pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
    
    // Draw smooth bezier curves
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
    
    // Close and stroke
    pathOps += 'h S\n';
    
    // Append to page content stream
    const existingContents = page.node.Contents();
    if (existingContents) {
      // Get existing content and append our path
      const contentStream = context.stream(pathOps);
      const contentStreamRef = context.register(contentStream);
      
      // Create array with existing content + new content
      if (existingContents instanceof PDFArray) {
        existingContents.push(contentStreamRef);
      } else {
        const newContents = context.obj([existingContents, contentStreamRef]);
        page.node.set(PDFName.of('Contents'), newContents);
      }
    }
  }
  
  // Set PDF metadata
  pdfDoc.setTitle('Sticker with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector']);
  
  // Save and download
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

// Download PDF with shape background and CutContour spot color outline
export async function downloadShapePDF(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings,
  filename: string
): Promise<void> {
  // Calculate dimensions in points (72 points per inch)
  const widthPts = shapeSettings.widthInches * 72;
  const heightPts = shapeSettings.heightInches * 72;
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  const context = pdfDoc.context;
  
  // Parse fill color from hex
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 1, g: 1, b: 1 };
  };
  
  const fillColor = hexToRgb(shapeSettings.fillColor);
  
  // Draw the shape background
  const centerX = widthPts / 2;
  const centerY = heightPts / 2;
  
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(widthPts, heightPts) / 2;
    page.drawCircle({
      x: centerX,
      y: centerY,
      size: radius,
      color: rgb(fillColor.r, fillColor.g, fillColor.b),
    });
  } else if (shapeSettings.type === 'oval') {
    page.drawEllipse({
      x: centerX,
      y: centerY,
      xScale: widthPts / 2,
      yScale: heightPts / 2,
      color: rgb(fillColor.r, fillColor.g, fillColor.b),
    });
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(widthPts, heightPts);
    const startX = (widthPts - size) / 2;
    const startY = (heightPts - size) / 2;
    page.drawRectangle({
      x: startX,
      y: startY,
      width: size,
      height: size,
      color: rgb(fillColor.r, fillColor.g, fillColor.b),
    });
  } else {
    // Rectangle
    page.drawRectangle({
      x: 0,
      y: 0,
      width: widthPts,
      height: heightPts,
      color: rgb(fillColor.r, fillColor.g, fillColor.b),
    });
  }
  
  // Crop image to remove empty space
  const croppedCanvas = cropImageToContent(image);
  let imageCanvas: HTMLCanvasElement;
  
  if (croppedCanvas) {
    imageCanvas = croppedCanvas;
  } else {
    // Use original image as canvas
    imageCanvas = document.createElement('canvas');
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext('2d');
    if (ctx) ctx.drawImage(image, 0, 0);
  }
  
  // Get PNG bytes from cropped image
  const blob = await new Promise<Blob>((resolve) => {
    imageCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  // Embed image
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  // Calculate image size and position (centered, 80% of shape size)
  const imageAspect = imageCanvas.width / imageCanvas.height;
  const shapeAspect = widthPts / heightPts;
  
  let imageWidth, imageHeight;
  if (imageAspect > shapeAspect) {
    imageWidth = widthPts * 0.8;
    imageHeight = imageWidth / imageAspect;
  } else {
    imageHeight = heightPts * 0.8;
    imageWidth = imageHeight * imageAspect;
  }
  
  const imageX = (widthPts - imageWidth) / 2 + (shapeSettings.offsetX || 0);
  const imageY = (heightPts - imageHeight) / 2 - (shapeSettings.offsetY || 0); // Flip Y offset for PDF
  
  page.drawImage(pngImage, {
    x: imageX,
    y: imageY,
    width: imageWidth,
    height: imageHeight,
  });
  
  // Create CutContour spot color
  const tintFunction = context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: [0, 1, 0, 0], // Magenta in CMYK
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
  
  // Add color space to page resources
  const resources = page.node.Resources();
  if (resources) {
    let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) {
      colorSpaceDict = context.obj({});
      resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
    }
    (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
  }
  
  // Build shape outline path with CutContour spot color
  // Use q/Q to save/restore graphics state and ensure clean coordinate system
  let pathOps = 'q\n'; // Save graphics state
  pathOps += '/CutContour CS 1 SCN\n';
  pathOps += '0.5 w\n'; // Line width
  
  // Pre-calculate all coordinates in PDF space (origin at bottom-left, Y increases upward)
  // These match exactly what pdf-lib uses internally
  const cx = widthPts / 2;
  const cy = heightPts / 2;
  
  if (shapeSettings.type === 'circle') {
    const r = Math.min(widthPts, heightPts) / 2;
    // Approximate circle with bezier curves - same as pdf-lib internally
    const k = 0.5522847498; // Magic number for circle approximation
    const rk = r * k;
    pathOps += `${cx + r} ${cy} m\n`;
    pathOps += `${cx + r} ${cy + rk} ${cx + rk} ${cy + r} ${cx} ${cy + r} c\n`;
    pathOps += `${cx - rk} ${cy + r} ${cx - r} ${cy + rk} ${cx - r} ${cy} c\n`;
    pathOps += `${cx - r} ${cy - rk} ${cx - rk} ${cy - r} ${cx} ${cy - r} c\n`;
    pathOps += `${cx + rk} ${cy - r} ${cx + r} ${cy - rk} ${cx + r} ${cy} c\n`;
  } else if (shapeSettings.type === 'oval') {
    const rx = widthPts / 2;
    const ry = heightPts / 2;
    const k = 0.5522847498;
    const rxk = rx * k;
    const ryk = ry * k;
    pathOps += `${cx + rx} ${cy} m\n`;
    pathOps += `${cx + rx} ${cy + ryk} ${cx + rxk} ${cy + ry} ${cx} ${cy + ry} c\n`;
    pathOps += `${cx - rxk} ${cy + ry} ${cx - rx} ${cy + ryk} ${cx - rx} ${cy} c\n`;
    pathOps += `${cx - rx} ${cy - ryk} ${cx - rxk} ${cy - ry} ${cx} ${cy - ry} c\n`;
    pathOps += `${cx + rxk} ${cy - ry} ${cx + rx} ${cy - ryk} ${cx + rx} ${cy} c\n`;
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(widthPts, heightPts);
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += `${sx} ${sy} m\n`;
    pathOps += `${sx + size} ${sy} l\n`;
    pathOps += `${sx + size} ${sy + size} l\n`;
    pathOps += `${sx} ${sy + size} l\n`;
  } else {
    // Rectangle - full page
    pathOps += `0 0 m\n`;
    pathOps += `${widthPts} 0 l\n`;
    pathOps += `${widthPts} ${heightPts} l\n`;
    pathOps += `0 ${heightPts} l\n`;
  }
  
  pathOps += 'h S\n'; // Close and stroke
  pathOps += 'Q\n'; // Restore graphics state
  
  // Create new content stream for the outline path
  const contentStream = context.stream(pathOps);
  const contentStreamRef = context.register(contentStream);
  
  // Append path to page contents
  const existingContents = page.node.Contents();
  if (existingContents) {
    if (existingContents instanceof PDFArray) {
      existingContents.push(contentStreamRef);
    } else {
      const newContents = context.obj([existingContents, contentStreamRef]);
      page.node.set(PDFName.of('Contents'), newContents);
    }
  } else {
    page.node.set(PDFName.of('Contents'), contentStreamRef);
  }
  
  // Set PDF metadata
  pdfDoc.setTitle('Shape with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector', 'shape']);
  
  // Save and download
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
