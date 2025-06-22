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

  try {
    // Create binary mask from alpha channel
    const mask = createBinaryMask(image, strokeSettings.alphaThreshold);
    
    // Find edge pixels around the mask
    const edgePixels = findEdgePixels(mask, image.width, image.height);
    
    if (edgePixels.length === 0) {
      return canvas;
    }

    // Create contour path following the edge
    const contourPath = traceContour(edgePixels, image.width, image.height);
    
    // Apply offset outward
    const offsetPixels = strokeSettings.width * 300; // Convert inches to pixels at 300 DPI
    const offsetPath = applyOutwardOffset(contourPath, offsetPixels);

    // Draw the white contour outline
    drawWhiteContour(ctx, offsetPath, strokeSettings);
    
  } catch (error) {
    console.error('Contour generation error:', error);
  }
  
  return canvas;
}

function createBinaryMask(image: HTMLImageElement, alphaThreshold: number): boolean[][] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;

  const mask: boolean[][] = [];
  
  for (let y = 0; y < image.height; y++) {
    mask[y] = [];
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const alpha = data[index + 3];
      mask[y][x] = alpha >= alphaThreshold;
    }
  }

  return mask;
}

function findEdgePixels(mask: boolean[][], width: number, height: number): ContourPoint[] {
  const edgePixels: ContourPoint[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y][x]) {
        // Check if this solid pixel has any transparent neighbors
        const hasTransparentNeighbor = 
          !mask[y-1][x-1] || !mask[y-1][x] || !mask[y-1][x+1] ||
          !mask[y][x-1]   ||                   !mask[y][x+1]   ||
          !mask[y+1][x-1] || !mask[y+1][x] || !mask[y+1][x+1];
        
        if (hasTransparentNeighbor) {
          edgePixels.push({ x, y });
        }
      }
    }
  }

  return edgePixels;
}

function traceContour(edgePixels: ContourPoint[], width: number, height: number): ContourPoint[] {
  if (edgePixels.length === 0) return [];

  // Find bounds of edge pixels
  const bounds = {
    minX: Math.min(...edgePixels.map(p => p.x)),
    maxX: Math.max(...edgePixels.map(p => p.x)),
    minY: Math.min(...edgePixels.map(p => p.y)),
    maxY: Math.max(...edgePixels.map(p => p.y))
  };

  const contour: ContourPoint[] = [];
  const tolerance = 3; // Pixels tolerance for finding edge points

  // Trace the perimeter by following the outermost edge pixels
  // Top edge (left to right)
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    let topY = bounds.maxY;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.x - x) <= tolerance && pixel.y < topY) {
        topY = pixel.y;
      }
    }
    if (topY < bounds.maxY) {
      contour.push({ x, y: topY });
    }
  }

  // Right edge (top to bottom)
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    let rightX = bounds.minX;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.y - y) <= tolerance && pixel.x > rightX) {
        rightX = pixel.x;
      }
    }
    if (rightX > bounds.minX) {
      contour.push({ x: rightX, y });
    }
  }

  // Bottom edge (right to left)
  for (let x = bounds.maxX; x >= bounds.minX; x--) {
    let bottomY = bounds.minY;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.x - x) <= tolerance && pixel.y > bottomY) {
        bottomY = pixel.y;
      }
    }
    if (bottomY > bounds.minY) {
      contour.push({ x, y: bottomY });
    }
  }

  // Left edge (bottom to top)
  for (let y = bounds.maxY; y >= bounds.minY; y--) {
    let leftX = bounds.maxX;
    for (const pixel of edgePixels) {
      if (Math.abs(pixel.y - y) <= tolerance && pixel.x < leftX) {
        leftX = pixel.x;
      }
    }
    if (leftX < bounds.maxX) {
      contour.push({ x: leftX, y });
    }
  }

  // Remove duplicate points
  const uniqueContour: ContourPoint[] = [];
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i];
    const next = contour[(i + 1) % contour.length];
    if (Math.abs(current.x - next.x) > 1 || Math.abs(current.y - next.y) > 1) {
      uniqueContour.push(current);
    }
  }

  return uniqueContour;
}

function applyOutwardOffset(path: ContourPoint[], offsetPixels: number): ContourPoint[] {
  if (path.length < 3 || offsetPixels <= 0) return path;

  const offsetPath: ContourPoint[] = [];

  for (let i = 0; i < path.length; i++) {
    const current = path[i];
    const prev = path[(i - 1 + path.length) % path.length];
    const next = path[(i + 1) % path.length];

    // Calculate vectors to neighbors
    const v1x = prev.x - current.x;
    const v1y = prev.y - current.y;
    const v2x = next.x - current.x;
    const v2y = next.y - current.y;

    // Calculate perpendicular vectors (normals)
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

      // Apply offset outward
      offsetPath.push({
        x: current.x + avgNormalX * offsetPixels,
        y: current.y + avgNormalY * offsetPixels
      });
    } else {
      offsetPath.push(current);
    }
  }

  return offsetPath;
}

function drawWhiteContour(ctx: CanvasRenderingContext2D, path: ContourPoint[], strokeSettings: StrokeSettings): void {
  if (path.length < 2) return;

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, strokeSettings.width * 40);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  
  if (path.length > 0) {
    ctx.moveTo(path[0].x, path[0].y);
    
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    
    ctx.closePath();
  }
  
  ctx.stroke();
}