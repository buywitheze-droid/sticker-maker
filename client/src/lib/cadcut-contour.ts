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

  // Step 1: Draw image and get pixel data for edge detection
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Step 2: Create binary mask based on alpha threshold
  const binaryMask = createBinaryMask(data, canvas.width, canvas.height, strokeSettings.alphaThreshold);

  // Step 3: Find edge pixels (actual design boundaries)
  const edgePixels = detectEdgePixels(binaryMask, canvas.width, canvas.height);

  // Step 4: Create contour path that follows design edges with offset
  const contourPath = createCadCutPath(edgePixels, strokeSettings.width);

  // Step 5: Clear canvas and draw the traced contour
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (contourPath.length > 0) {
    drawCadCutContour(ctx, contourPath, strokeSettings);
  }
  
  console.log('CadCut contour created:', {
    canvasSize: `${canvas.width}x${canvas.height}`,
    offsetInches: strokeSettings.width,
    edgePixelsFound: edgePixels.length,
    contourPoints: contourPath.length
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
  
  // Convert inches to pixels at 300 DPI
  const offsetPixels = strokeWidthInches * 300;
  
  // Group edge pixels into a coherent outline
  const sortedEdges = organizeEdgePixels(edgePixels);
  
  // Apply offset to create cutting path
  const offsetContour = applyContourOffset(sortedEdges, offsetPixels);
  
  return offsetContour;
}

function organizeEdgePixels(edgePixels: ContourPoint[]): ContourPoint[] {
  if (edgePixels.length === 0) return [];
  
  // Find the bounds to create a simplified hull
  const bounds = calculateBounds(edgePixels);
  
  // Create a simplified contour following the outer boundary
  // This approximates the design shape better than a rectangle
  const hull: ContourPoint[] = [];
  
  // Top edge - find topmost pixels from left to right
  for (let x = bounds.minX; x <= bounds.maxX; x += 2) {
    const topPixel = edgePixels.find(p => p.x === x && p.y >= bounds.minY && p.y <= bounds.minY + 5);
    if (topPixel) hull.push(topPixel);
  }
  
  // Right edge - find rightmost pixels from top to bottom
  for (let y = bounds.minY; y <= bounds.maxY; y += 2) {
    const rightPixel = edgePixels.find(p => p.y === y && p.x >= bounds.maxX - 5 && p.x <= bounds.maxX);
    if (rightPixel) hull.push(rightPixel);
  }
  
  // Bottom edge - find bottommost pixels from right to left
  for (let x = bounds.maxX; x >= bounds.minX; x -= 2) {
    const bottomPixel = edgePixels.find(p => p.x === x && p.y >= bounds.maxY - 5 && p.y <= bounds.maxY);
    if (bottomPixel) hull.push(bottomPixel);
  }
  
  // Left edge - find leftmost pixels from bottom to top
  for (let y = bounds.maxY; y >= bounds.minY; y -= 2) {
    const leftPixel = edgePixels.find(p => p.y === y && p.x >= bounds.minX && p.x <= bounds.minX + 5);
    if (leftPixel) hull.push(leftPixel);
  }
  
  return hull.length > 0 ? hull : [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

function applyContourOffset(contour: ContourPoint[], offsetPixels: number): ContourPoint[] {
  if (contour.length === 0) return [];
  
  // Apply outward offset to each point
  const offsetContour: ContourPoint[] = [];
  
  for (let i = 0; i < contour.length; i++) {
    const point = contour[i];
    const prevPoint = contour[i === 0 ? contour.length - 1 : i - 1];
    const nextPoint = contour[(i + 1) % contour.length];
    
    // Calculate normal vector for offset
    const dx1 = point.x - prevPoint.x;
    const dy1 = point.y - prevPoint.y;
    const dx2 = nextPoint.x - point.x;
    const dy2 = nextPoint.y - point.y;
    
    // Average the normals
    const normalX = -(dy1 + dy2) / 2;
    const normalY = (dx1 + dx2) / 2;
    
    // Normalize
    const length = Math.sqrt(normalX * normalX + normalY * normalY);
    const unitX = length > 0 ? normalX / length : 0;
    const unitY = length > 0 ? normalY / length : 0;
    
    // Apply offset
    offsetContour.push({
      x: point.x + unitX * offsetPixels,
      y: point.y + unitY * offsetPixels
    });
  }
  
  return offsetContour;
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
  
  // Make stroke visible but proportional to offset
  ctx.lineWidth = Math.max(3, strokeSettings.width * 100); // Scale for visibility
  
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