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

  try {
    // Auto-detect alpha channel and create vector outline
    const vectorOutline = createVectorOutlineFromAlpha(image);
    
    if (vectorOutline.length === 0) {
      return canvas;
    }

    // Apply CadCut method with inch-based offset
    const offsetPixels = strokeSettings.width * 300; // Convert inches to pixels at 300 DPI
    const cadcutContour = applyCadCutMethod(vectorOutline, offsetPixels);

    // Draw the contour outline
    drawCadCutContour(ctx, cadcutContour);
    
  } catch (error) {
    console.error('CadCut contour error:', error);
  }
  
  return canvas;
}

interface VectorPoint {
  x: number;
  y: number;
}

function createVectorOutlineFromAlpha(image: HTMLImageElement): VectorPoint[] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;

  // Auto-detect alpha channel threshold
  const alphaThreshold = detectOptimalAlphaThreshold(data);
  
  // Find edge pixels based on alpha channel
  const edgePixels: VectorPoint[] = [];
  
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const index = (y * image.width + x) * 4;
      const alpha = data[index + 3];
      
      if (alpha >= alphaThreshold) {
        // Check if this solid pixel has any transparent neighbors
        const neighbors = [
          data[((y-1) * image.width + (x-1)) * 4 + 3], // top-left
          data[((y-1) * image.width + x) * 4 + 3],     // top
          data[((y-1) * image.width + (x+1)) * 4 + 3], // top-right
          data[(y * image.width + (x-1)) * 4 + 3],     // left
          data[(y * image.width + (x+1)) * 4 + 3],     // right
          data[((y+1) * image.width + (x-1)) * 4 + 3], // bottom-left
          data[((y+1) * image.width + x) * 4 + 3],     // bottom
          data[((y+1) * image.width + (x+1)) * 4 + 3]  // bottom-right
        ];
        
        // If any neighbor is transparent, this is an edge pixel
        if (neighbors.some(neighbor => neighbor < alphaThreshold)) {
          edgePixels.push({ x, y });
        }
      }
    }
  }

  // Convert edge pixels to vector outline
  return createVectorPath(edgePixels);
}

function detectOptimalAlphaThreshold(data: Uint8ClampedArray): number {
  const alphaValues: number[] = [];
  
  // Sample alpha values
  for (let i = 3; i < data.length; i += 4) {
    alphaValues.push(data[i]);
  }
  
  // Find the optimal threshold using histogram analysis
  alphaValues.sort((a, b) => a - b);
  
  // Use median value as threshold for best alpha channel detection
  const median = alphaValues[Math.floor(alphaValues.length / 2)];
  return Math.max(128, median); // Ensure minimum threshold of 128
}

function createVectorPath(edgePixels: VectorPoint[]): VectorPoint[] {
  if (edgePixels.length === 0) return [];
  
  // Find bounds of edge pixels
  const bounds = {
    minX: Math.min(...edgePixels.map(p => p.x)),
    maxX: Math.max(...edgePixels.map(p => p.x)),
    minY: Math.min(...edgePixels.map(p => p.y)),
    maxY: Math.max(...edgePixels.map(p => p.y))
  };

  const vectorPath: VectorPoint[] = [];
  const tolerance = 2;

  // Trace vector outline following the outermost edge pixels
  // Top edge
  for (let x = bounds.minX; x <= bounds.maxX; x += 2) {
    let topY = bounds.maxY;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.x - x) <= tolerance && pixel.y < topY) {
        topY = pixel.y;
      }
    }
    if (topY < bounds.maxY) {
      vectorPath.push({ x, y: topY });
    }
  }

  // Right edge
  for (let y = bounds.minY; y <= bounds.maxY; y += 2) {
    let rightX = bounds.minX;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.y - y) <= tolerance && pixel.x > rightX) {
        rightX = pixel.x;
      }
    }
    if (rightX > bounds.minX) {
      vectorPath.push({ x: rightX, y });
    }
  }

  // Bottom edge
  for (let x = bounds.maxX; x >= bounds.minX; x -= 2) {
    let bottomY = bounds.minY;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.x - x) <= tolerance && pixel.y > bottomY) {
        bottomY = pixel.y;
      }
    }
    if (bottomY > bounds.minY) {
      vectorPath.push({ x, y: bottomY });
    }
  }

  // Left edge
  for (let y = bounds.maxY; y >= bounds.minY; y -= 2) {
    let leftX = bounds.maxX;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.y - y) <= tolerance && pixel.x < leftX) {
        leftX = pixel.x;
      }
    }
    if (leftX < bounds.maxX) {
      vectorPath.push({ x: leftX, y });
    }
  }

  return vectorPath;
}

function applyCadCutMethod(vectorPath: VectorPoint[], offsetPixels: number): VectorPoint[] {
  if (vectorPath.length < 3) return vectorPath;
  
  const cadcutContour: VectorPoint[] = [];
  
  for (let i = 0; i < vectorPath.length; i++) {
    const current = vectorPath[i];
    const prev = vectorPath[(i - 1 + vectorPath.length) % vectorPath.length];
    const next = vectorPath[(i + 1) % vectorPath.length];
    
    // Calculate outward normal using CadCut method
    const v1x = current.x - prev.x;
    const v1y = current.y - prev.y;
    const v2x = next.x - current.x;
    const v2y = next.y - current.y;
    
    // Perpendicular vectors (normals)
    const n1x = -v1y;
    const n1y = v1x;
    const n2x = -v2y;
    const n2y = v2x;
    
    // Normalize normals
    const len1 = Math.sqrt(n1x * n1x + n1y * n1y);
    const len2 = Math.sqrt(n2x * n2x + n2y * n2y);
    
    let avgNormalX = 0;
    let avgNormalY = 0;
    
    if (len1 > 0 && len2 > 0) {
      avgNormalX = (n1x / len1 + n2x / len2) / 2;
      avgNormalY = (n1y / len1 + n2y / len2) / 2;
    } else if (len1 > 0) {
      avgNormalX = n1x / len1;
      avgNormalY = n1y / len1;
    } else if (len2 > 0) {
      avgNormalX = n2x / len2;
      avgNormalY = n2y / len2;
    }
    
    // Normalize average normal
    const avgLen = Math.sqrt(avgNormalX * avgNormalX + avgNormalY * avgNormalY);
    if (avgLen > 0) {
      avgNormalX /= avgLen;
      avgNormalY /= avgLen;
      
      // Apply CadCut offset
      cadcutContour.push({
        x: current.x + avgNormalX * offsetPixels,
        y: current.y + avgNormalY * offsetPixels
      });
    } else {
      cadcutContour.push(current);
    }
  }
  
  return cadcutContour;
}

function drawCadCutContour(ctx: CanvasRenderingContext2D, contour: VectorPoint[]): void {
  if (contour.length < 2) return;

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
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

