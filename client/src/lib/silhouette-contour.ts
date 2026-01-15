import { StrokeSettings, ResizeSettings } from "@/components/image-editor";

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
  
  // Additional gap closing offsets - small (0.07") or big (0.12")
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.12 * effectiveDPI);
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
    
    // Step 3: If gap closing is enabled, create smooth bridges for outlines within 0.03" 
    // and fill larger gaps based on selected option
    let bridgedMask = autoBridgedMask;
    let bridgedWidth = image.width;
    let bridgedHeight = image.height;
    
    if (gapClosePixels > 0) {
      // First, create smooth bridges for outlines within 0.03" of each other
      const smoothBridgeInches = 0.03;
      const smoothBridgePixels = Math.round(smoothBridgeInches * effectiveDPI / 2);
      
      // Apply smooth bridging first
      const smoothDilated = dilateSilhouette(autoBridgedMask, image.width, image.height, smoothBridgePixels);
      const smoothDilatedWidth = image.width + smoothBridgePixels * 2;
      const smoothDilatedHeight = image.height + smoothBridgePixels * 2;
      const smoothFilled = fillSilhouette(smoothDilated, smoothDilatedWidth, smoothDilatedHeight);
      
      // Extract smooth bridged mask
      let smoothBridgedMask = new Uint8Array(image.width * image.height);
      smoothBridgedMask.set(autoBridgedMask);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const srcX = x + smoothBridgePixels;
          const srcY = y + smoothBridgePixels;
          if (smoothFilled[srcY * smoothDilatedWidth + srcX] === 1 && autoBridgedMask[y * image.width + x] === 0) {
            smoothBridgedMask[y * image.width + x] = 1;
          }
        }
      }
      
      // Then apply additional gap closing for larger gaps
      const halfGapPixels = Math.round(gapClosePixels / 2);
      const dilatedMask = dilateSilhouette(smoothBridgedMask, image.width, image.height, halfGapPixels);
      const dilatedWidth = image.width + halfGapPixels * 2;
      const dilatedHeight = image.height + halfGapPixels * 2;
      const filledDilated = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
      
      // Start with smooth bridged mask and add larger gap fills
      bridgedMask = new Uint8Array(image.width * image.height);
      bridgedMask.set(smoothBridgedMask);
      
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const srcX = x + halfGapPixels;
          const srcY = y + halfGapPixels;
          if (filledDilated[srcY * dilatedWidth + srcX] === 1 && smoothBridgedMask[y * image.width + x] === 0) {
            bridgedMask[y * image.width + x] = 1;
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
