import { StrokeSettings } from "@/components/image-editor";

export function createSilhouetteContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Convert inch offset to pixels (at 300 DPI)
  const offsetPixels = Math.round(strokeSettings.width * 300);
  
  // Canvas needs extra space for the contour offset
  const padding = offsetPixels + 10;
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Step 1: Create binary silhouette mask from alpha channel
    // This treats ALL non-transparent pixels as solid black
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 2: Dilate the silhouette by offset pixels
    const dilatedMask = dilateSilhouette(silhouetteMask, image.width, image.height, offsetPixels);
    const dilatedWidth = image.width + offsetPixels * 2;
    const dilatedHeight = image.height + offsetPixels * 2;
    
    // Step 3: Trace the boundary of the dilated silhouette using Moore-Neighbor algorithm
    const boundaryPath = traceBoundary(dilatedMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 4: Smooth and simplify the path
    const smoothedPath = smoothPath(boundaryPath, 2);
    
    // Step 5: Draw the contour
    const offsetX = padding - offsetPixels;
    const offsetY = padding - offsetPixels;
    drawSmoothContour(ctx, smoothedPath, strokeSettings.color || '#FFFFFF', offsetX, offsetY);
    
    // Step 6: Draw the original image on top
    ctx.drawImage(image, padding, padding);
    
  } catch (error) {
    console.error('Silhouette contour error:', error);
    ctx.drawImage(image, padding, padding);
  }
  
  return canvas;
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
