import { StrokeSettings } from "@/components/image-editor";

export function createCadCutContour(
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
    // Step 1: Create binary mask from alpha channel
    const mask = createAlphaMask(image);
    if (mask.length === 0) return canvas;
    
    // Step 2: Dilate the mask by offset pixels (morphological dilation)
    const dilatedMask = dilateMask(mask, image.width, image.height, offsetPixels);
    const dilatedWidth = image.width + offsetPixels * 2;
    const dilatedHeight = image.height + offsetPixels * 2;
    
    // Step 3: Find edge pixels of the dilated mask
    const edgePixels = findEdgePixels(dilatedMask, dilatedWidth, dilatedHeight);
    
    if (edgePixels.length < 10) {
      // Just draw the image centered if not enough edge pixels
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 4: Create ordered contour path from edge pixels
    const contourPath = createOrderedContour(edgePixels, dilatedWidth, dilatedHeight);
    
    // Step 5: Draw the contour outline (offset to account for canvas padding difference)
    const offsetX = padding - offsetPixels;
    const offsetY = padding - offsetPixels;
    
    drawContour(ctx, contourPath, strokeSettings.color || '#FFFFFF', offsetX, offsetY);
    
    // Step 6: Draw the original image on top, centered in the canvas
    ctx.drawImage(image, padding, padding);
    
  } catch (error) {
    console.error('CadCut contour error:', error);
    // Fallback: just draw image
    ctx.drawImage(image, padding, padding);
  }
  
  return canvas;
}

function createAlphaMask(image: HTMLImageElement): Uint8Array {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return new Uint8Array(0);

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  
  // Create binary mask: 1 = solid pixel (alpha >= 128), 0 = transparent
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  }
  
  return mask;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  // Create expanded canvas to hold dilated result
  const newWidth = width + radius * 2;
  const newHeight = height + radius * 2;
  const dilated = new Uint8Array(newWidth * newHeight);
  
  if (radius <= 0) {
    // No dilation needed, just copy to center of new canvas
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dilated[(y + radius) * newWidth + (x + radius)] = mask[y * width + x];
      }
    }
    return dilated;
  }
  
  // Precompute circle offsets for the given radius
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push({ dx, dy });
      }
    }
  }
  
  // For each solid pixel in original mask, fill circle in dilated mask
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        const centerX = x + radius;
        const centerY = y + radius;
        
        for (const offset of offsets) {
          const nx = centerX + offset.dx;
          const ny = centerY + offset.dy;
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

function findEdgePixels(mask: Uint8Array, width: number, height: number): Point[] {
  const edges: Point[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1) {
        // Check if this pixel has a transparent neighbor (4-connected)
        const hasTransparentNeighbor = 
          (x === 0 || mask[idx - 1] === 0) ||
          (x === width - 1 || mask[idx + 1] === 0) ||
          (y === 0 || mask[(y - 1) * width + x] === 0) ||
          (y === height - 1 || mask[(y + 1) * width + x] === 0);
        
        if (hasTransparentNeighbor) {
          edges.push({ x, y });
        }
      }
    }
  }
  
  return edges;
}

function createOrderedContour(edgePixels: Point[], width: number, height: number): Point[] {
  if (edgePixels.length === 0) return [];
  
  // Calculate center of mass for angle-based sorting
  let sumX = 0, sumY = 0;
  for (const p of edgePixels) {
    sumX += p.x;
    sumY += p.y;
  }
  const centerX = sumX / edgePixels.length;
  const centerY = sumY / edgePixels.length;
  
  // Sort by angle from center
  const sorted = [...edgePixels].sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });
  
  // Simplify to reduce point count while maintaining shape
  const simplified = douglasPeucker(sorted, 1.5);
  
  return simplified;
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  
  // Find the point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDist(points[i], first, last);
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

function perpendicularDist(point: Point, lineStart: Point, lineEnd: Point): number {
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

function drawContour(ctx: CanvasRenderingContext2D, contour: Point[], color: string, offsetX: number, offsetY: number): void {
  if (contour.length < 3) return;

  // Draw the contour outline
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Add shadow for visibility on any background
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.moveTo(contour[0].x + offsetX, contour[0].y + offsetY);
  
  // Draw smooth curve through points
  for (let i = 1; i < contour.length - 1; i++) {
    const xc = (contour[i].x + contour[i + 1].x) / 2 + offsetX;
    const yc = (contour[i].y + contour[i + 1].y) / 2 + offsetY;
    ctx.quadraticCurveTo(contour[i].x + offsetX, contour[i].y + offsetY, xc, yc);
  }
  
  // Connect to last point and close
  const lastPoint = contour[contour.length - 1];
  ctx.lineTo(lastPoint.x + offsetX, lastPoint.y + offsetY);
  ctx.closePath();
  ctx.stroke();
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}
