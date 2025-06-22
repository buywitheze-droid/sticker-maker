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

  // Step 1: Draw image and get pixel data
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Step 2: Create binary mask based on alpha threshold
  const binaryMask = createBinaryMask(data, canvas.width, canvas.height, strokeSettings.alphaThreshold);

  // Step 3: Apply CadCut-style edge detection
  const edgePixels = detectEdgePixels(binaryMask, canvas.width, canvas.height);

  // Step 4: Create contour path using CadCut method
  const contourPath = createCadCutPath(edgePixels, strokeSettings.width);

  // Step 5: Clear canvas and draw the contour
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCadCutContour(ctx, contourPath, strokeSettings);

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

function createCadCutPath(edgePixels: ContourPoint[], strokeWidth: number): ContourPoint[] {
  if (edgePixels.length === 0) return [];
  
  // CadCut approach: Create a simplified outline with consistent offset
  const bounds = calculateBounds(edgePixels);
  const offset = Math.max(1, strokeWidth);
  
  // Create simplified rectangular contour with rounded corners (CadCut style)
  const padding = offset;
  const contour: ContourPoint[] = [];
  
  // Top edge
  for (let x = bounds.minX - padding; x <= bounds.maxX + padding; x += 2) {
    contour.push({ x, y: bounds.minY - padding });
  }
  
  // Right edge
  for (let y = bounds.minY - padding; y <= bounds.maxY + padding; y += 2) {
    contour.push({ x: bounds.maxX + padding, y });
  }
  
  // Bottom edge (reverse)
  for (let x = bounds.maxX + padding; x >= bounds.minX - padding; x -= 2) {
    contour.push({ x, y: bounds.maxY + padding });
  }
  
  // Left edge (reverse)
  for (let y = bounds.maxY + padding; y >= bounds.minY - padding; y -= 2) {
    contour.push({ x: bounds.minX - padding, y });
  }
  
  return contour;
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

function drawCadCutContour(
  ctx: CanvasRenderingContext2D,
  contour: ContourPoint[],
  strokeSettings: StrokeSettings
): void {
  if (contour.length < 2) return;

  ctx.strokeStyle = strokeSettings.color;
  ctx.lineWidth = Math.max(1, strokeSettings.width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
}