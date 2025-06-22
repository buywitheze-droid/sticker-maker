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

  // Convert inches to pixels (300 DPI)
  const offsetPixels = strokeSettings.width * 300;
  
  // ALWAYS draw a visible white rectangle outline for testing
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(6, offsetPixels * 0.1); // Ensure visibility
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw rectangle with offset from edges
  const padding = Math.max(10, offsetPixels);
  ctx.strokeRect(
    padding, 
    padding, 
    canvas.width - (padding * 2), 
    canvas.height - (padding * 2)
  );
  
  console.log('CadCut contour created:', {
    canvasSize: `${canvas.width}x${canvas.height}`,
    offsetInches: strokeSettings.width,
    offsetPixels,
    padding,
    lineWidth: ctx.lineWidth
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

function createCadCutPath(edgePixels: ContourPoint[], strokeWidthInches: number): ContourPoint[] {
  if (edgePixels.length === 0) return [];
  
  // CadCut approach: Create a simplified outline with consistent offset
  const bounds = calculateBounds(edgePixels);
  
  // Convert inches to pixels at 300 DPI (standard for cutting)
  const dpi = 300;
  const offsetPixels = strokeWidthInches * dpi;
  
  // Create simplified rectangular contour (CadCut style)
  const padding = Math.max(0, offsetPixels);
  const contour: ContourPoint[] = [
    { x: bounds.minX - padding, y: bounds.minY - padding }, // top-left
    { x: bounds.maxX + padding, y: bounds.minY - padding }, // top-right
    { x: bounds.maxX + padding, y: bounds.maxY + padding }, // bottom-right
    { x: bounds.minX - padding, y: bounds.maxY + padding }  // bottom-left
  ];
  
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

  // Force solid white color
  ctx.strokeStyle = '#FFFFFF';
  
  // Convert line width from inches to pixels for visibility (always show at least 2px)
  const lineWidthPixels = Math.max(2, strokeSettings.width * 300 * 0.02); // Scale for visibility
  ctx.lineWidth = lineWidthPixels;
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
}