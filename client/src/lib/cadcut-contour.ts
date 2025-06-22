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

  // Step 1: Vectorize the image to get precise contour
  const vectorContour = vectorizeImage(image, strokeSettings);

  // Step 2: Apply professional offset
  const offsetContour = applyProfessionalOffset(vectorContour, strokeSettings.width);

  // Step 3: Optimize contour for cutting
  const optimizedContour = optimizeForCutting(offsetContour);

  // Step 4: Draw the final contour
  if (optimizedContour.length > 0) {
    drawVectorContour(ctx, optimizedContour, strokeSettings);
  }
  
  console.log('Vector contour created:', {
    canvasSize: `${canvas.width}x${canvas.height}`,
    offsetInches: strokeSettings.width,
    contourPoints: optimizedContour.length
  });

  return canvas;
}

function createBinaryMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    mask[i / 4] = alpha >= alphaThreshold ? 1 : 0;
  }
  
  return mask;
}

function detectEdgePixels(
  mask: Uint8Array,
  width: number,
  height: number
): ContourPoint[] {
  const edgePixels: ContourPoint[] = [];
  
  // CadCut method: scan for pixels that are solid but have at least one transparent neighbor
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      
      if (mask[index] === 1) { // Solid pixel
        // Check 8-connected neighbors
        const neighbors = [
          mask[(y-1) * width + (x-1)], // top-left
          mask[(y-1) * width + x],     // top
          mask[(y-1) * width + (x+1)], // top-right
          mask[y * width + (x-1)],     // left
          mask[y * width + (x+1)],     // right
          mask[(y+1) * width + (x-1)], // bottom-left
          mask[(y+1) * width + x],     // bottom
          mask[(y+1) * width + (x+1)]  // bottom-right
        ];
        
        // If any neighbor is transparent, this is an edge pixel
        if (neighbors.some(neighbor => neighbor === 0)) {
          edgePixels.push({ x, y });
        }
      }
    }
  }
  
  return edgePixels;
}

function vectorizeImage(image: HTMLImageElement, strokeSettings: StrokeSettings): ContourPoint[] {
  // Create temporary canvas for processing
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  // Draw image and get pixel data
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imageData.data;

  // Create binary mask with edge detection
  const binaryMask = createHighQualityMask(data, tempCanvas.width, tempCanvas.height, strokeSettings.alphaThreshold);
  
  // Apply morphological operations for clean edges
  const cleanedMask = applyMorphologicalCleaning(binaryMask, tempCanvas.width, tempCanvas.height);
  
  // Trace the outer contour using marching squares algorithm
  const contour = marchingSquares(cleanedMask, tempCanvas.width, tempCanvas.height);
  
  // Apply Douglas-Peucker simplification for smooth curves
  const simplifiedContour = douglasPeuckerSimplify(contour, 1.0);
  
  // Apply Bézier curve fitting for vector-smooth results
  const vectorContour = fitBezierCurves(simplifiedContour);
  
  return vectorContour;
}

function createHighQualityMask(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    mask[i / 4] = alpha >= threshold ? 1 : 0;
  }
  
  return mask;
}

function applyMorphologicalCleaning(mask: Uint8Array, width: number, height: number): Uint8Array {
  // Apply closing operation (dilation followed by erosion) to fill small gaps
  let cleaned = morphologicalDilation(mask, width, height, 1);
  cleaned = morphologicalErosion(cleaned, width, height, 1);
  
  return cleaned;
}

function morphologicalDilation(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let maxVal = 0;
      
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            const nIndex = ny * width + nx;
            maxVal = Math.max(maxVal, mask[nIndex]);
          }
        }
      }
      
      result[index] = maxVal;
    }
  }
  
  return result;
}

function morphologicalErosion(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let minVal = 1;
      
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            const nIndex = ny * width + nx;
            minVal = Math.min(minVal, mask[nIndex]);
          }
        }
      }
      
      result[index] = minVal;
    }
  }
  
  return result;
}

function marchingSquares(mask: Uint8Array, width: number, height: number): ContourPoint[] {
  const contour: ContourPoint[] = [];
  
  // Find starting point (first edge pixel)
  let startX = -1, startY = -1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (mask[index] === 1) {
        // Check if it's an edge pixel
        if (mask[index - 1] === 0 || mask[index + 1] === 0 || 
            mask[index - width] === 0 || mask[index + width] === 0) {
          startX = x;
          startY = y;
          break;
        }
      }
    }
    if (startX !== -1) break;
  }
  
  if (startX === -1) return [];
  
  // Trace contour using Moore neighborhood
  let currentX = startX;
  let currentY = startY;
  let direction = 0; // 0=right, 1=down, 2=left, 3=up
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  
  do {
    contour.push({ x: currentX, y: currentY });
    
    // Find next edge pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (direction + i) % 4;
      const [dx, dy] = directions[checkDir];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        const nextIndex = nextY * width + nextX;
        if (mask[nextIndex] === 1) {
          currentX = nextX;
          currentY = nextY;
          direction = (checkDir + 3) % 4; // Turn left
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    
  } while (currentX !== startX || currentY !== startY || contour.length < 4);
  
  return contour;
}

function douglasPeuckerSimplify(points: ContourPoint[], tolerance: number): ContourPoint[] {
  if (points.length <= 2) return points;
  
  const simplified = douglasPeucker(points, tolerance);
  return simplified;
}

function douglasPeucker(points: ContourPoint[], tolerance: number): ContourPoint[] {
  if (points.length <= 2) return points;
  
  let maxDistance = 0;
  let maxIndex = 0;
  const end = points.length - 1;
  
  for (let i = 1; i < end; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  if (maxDistance > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    
    return left.slice(0, -1).concat(right);
  } else {
    return [points[0], points[end]];
  }
}

function perpendicularDistance(point: ContourPoint, lineStart: ContourPoint, lineEnd: ContourPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

function fitBezierCurves(points: ContourPoint[]): ContourPoint[] {
  if (points.length < 4) return points;
  
  // For now, return smoothed points - full Bézier fitting would be complex
  return smoothContourPoints(points);
}

function smoothContourPoints(points: ContourPoint[]): ContourPoint[] {
  if (points.length < 3) return points;
  
  const smoothed: ContourPoint[] = [];
  const windowSize = 3;
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    for (let j = -Math.floor(windowSize / 2); j <= Math.floor(windowSize / 2); j++) {
      const index = (i + j + points.length) % points.length;
      sumX += points[index].x;
      sumY += points[index].y;
      count++;
    }
    
    smoothed.push({
      x: sumX / count,
      y: sumY / count
    });
  }
  
  return smoothed;
}

function applyProfessionalOffset(contour: ContourPoint[], offsetInches: number): ContourPoint[] {
  if (contour.length === 0) return [];
  
  const offsetPixels = offsetInches * 300; // 300 DPI
  const offsetContour: ContourPoint[] = [];
  
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i];
    const prev = contour[(i - 1 + contour.length) % contour.length];
    const next = contour[(i + 1) % contour.length];
    
    // Calculate averaged normal for smooth offset
    const v1x = current.x - prev.x;
    const v1y = current.y - prev.y;
    const v2x = next.x - current.x;
    const v2y = next.y - current.y;
    
    // Normal vectors
    const n1x = -v1y;
    const n1y = v1x;
    const n2x = -v2y;
    const n2y = v2x;
    
    // Average and normalize
    let nx = (n1x + n2x) / 2;
    let ny = (n1y + n2y) / 2;
    const length = Math.sqrt(nx * nx + ny * ny);
    
    if (length > 0) {
      nx /= length;
      ny /= length;
    }
    
    offsetContour.push({
      x: current.x + nx * offsetPixels,
      y: current.y + ny * offsetPixels
    });
  }
  
  return offsetContour;
}

function optimizeForCutting(contour: ContourPoint[]): ContourPoint[] {
  if (contour.length === 0) return [];
  
  // Remove points that are too close together
  const minDistance = 2;
  const optimized: ContourPoint[] = [contour[0]];
  
  for (let i = 1; i < contour.length; i++) {
    const prev = optimized[optimized.length - 1];
    const current = contour[i];
    const distance = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2);
    
    if (distance >= minDistance) {
      optimized.push(current);
    }
  }
  
  return optimized;
}

function calculateBounds(pixels: ContourPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  for (const pixel of pixels) {
    minX = Math.min(minX, pixel.x);
    maxX = Math.max(maxX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxY = Math.max(maxY, pixel.y);
  }
  
  return { minX, maxX, minY, maxY };
}

function drawVectorContour(
  ctx: CanvasRenderingContext2D,
  contour: ContourPoint[],
  strokeSettings: StrokeSettings
): void {
  if (contour.length < 2) return;

  // Professional white cutting line
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, strokeSettings.width * 50); // Visible but precise
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  // Draw smooth vector path
  ctx.beginPath();
  
  if (contour.length > 2) {
    // Use quadratic curves for smoother lines
    ctx.moveTo(contour[0].x, contour[0].y);
    
    for (let i = 1; i < contour.length - 1; i++) {
      const current = contour[i];
      const next = contour[i + 1];
      const controlX = current.x;
      const controlY = current.y;
      const endX = (current.x + next.x) / 2;
      const endY = (current.y + next.y) / 2;
      
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    }
    
    // Close the path smoothly
    const last = contour[contour.length - 1];
    const first = contour[0];
    ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);
  } else {
    // Fallback for simple paths
    ctx.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) {
      ctx.lineTo(contour[i].x, contour[i].y);
    }
    ctx.closePath();
  }
  
  ctx.stroke();
}