import { StrokeSettings } from "@/components/image-editor";

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

  // Extract edge pixels that follow the actual shape
  const edgePixels = extractEdgePixels(image, strokeSettings.alphaThreshold);
  
  if (edgePixels.length === 0) {
    return canvas;
  }

  // Create a smooth contour path from edge pixels
  const contourPath = createContourPath(edgePixels);
  
  // Apply offset to the contour
  const offsetPixels = strokeSettings.width * 300;
  const offsetPath = applyOffset(contourPath, offsetPixels);

  // Draw the contour outline
  drawContour(ctx, offsetPath, strokeSettings);
  
  return canvas;
}

interface ContourPoint {
  x: number;
  y: number;
}

function extractEdgePixels(image: HTMLImageElement, alphaThreshold: number): ContourPoint[] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imageData.data;

  const edgePixels: ContourPoint[] = [];

  // Find edge pixels - pixels that are solid but have transparent neighbors
  for (let y = 1; y < tempCanvas.height - 1; y++) {
    for (let x = 1; x < tempCanvas.width - 1; x++) {
      const index = (y * tempCanvas.width + x) * 4;
      const alpha = data[index + 3];
      
      if (alpha >= alphaThreshold) {
        // Check 8 neighbors for transparency
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

function createContourPath(edgePixels: ContourPoint[]): ContourPoint[] {
  if (edgePixels.length === 0) return [];
  
  // Create a simplified boundary following the shape
  const bounds = {
    minX: Math.min(...edgePixels.map(p => p.x)),
    maxX: Math.max(...edgePixels.map(p => p.x)),
    minY: Math.min(...edgePixels.map(p => p.y)),
    maxY: Math.max(...edgePixels.map(p => p.y))
  };

  const contour: ContourPoint[] = [];
  const step = 2; // Sample every 2 pixels for smoother outline

  // Top edge - find topmost pixels
  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    const topPixel = edgePixels.find(p => p.x >= x - step && p.x <= x + step && p.y <= bounds.minY + 5);
    if (topPixel) contour.push(topPixel);
  }

  // Right edge - find rightmost pixels
  for (let y = bounds.minY; y <= bounds.maxY; y += step) {
    const rightPixel = edgePixels.find(p => p.y >= y - step && p.y <= y + step && p.x >= bounds.maxX - 5);
    if (rightPixel) contour.push(rightPixel);
  }

  // Bottom edge - find bottommost pixels (reverse order)
  for (let x = bounds.maxX; x >= bounds.minX; x -= step) {
    const bottomPixel = edgePixels.find(p => p.x >= x - step && p.x <= x + step && p.y >= bounds.maxY - 5);
    if (bottomPixel) contour.push(bottomPixel);
  }

  // Left edge - find leftmost pixels (reverse order)
  for (let y = bounds.maxY; y >= bounds.minY; y -= step) {
    const leftPixel = edgePixels.find(p => p.y >= y - step && p.y <= y + step && p.x <= bounds.minX + 5);
    if (leftPixel) contour.push(leftPixel);
  }

  return contour;
}

function applyOffset(path: ContourPoint[], offsetPixels: number): ContourPoint[] {
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
    
    // Average normal vectors
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

function drawContour(ctx: CanvasRenderingContext2D, path: ContourPoint[], strokeSettings: StrokeSettings): void {
  if (path.length < 2) return;

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(3, strokeSettings.width * 60);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
}