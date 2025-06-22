import { StrokeSettings } from "@/components/image-editor";

export function createCadCutContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Make canvas larger to accommodate offset
  const padding = strokeSettings.width * 300 + 50; // Extra padding
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  // Clear canvas to transparent
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Auto-detect alpha channel and create vector outline (offset for padding)
    const vectorOutline = createVectorOutlineFromAlpha(image, padding);
    
    if (vectorOutline.length === 0) {
      console.log('No vector outline found');
      return canvas;
    }

    // Apply CadCut method with inch-based offset
    const offsetPixels = strokeSettings.width * 300;
    console.log('Offset pixels:', offsetPixels, 'from width:', strokeSettings.width);
    console.log('Canvas size:', canvas.width, 'x', canvas.height);
    
    const cadcutContour = applyCadCutMethod(vectorOutline, offsetPixels);
    console.log('Vector outline:', vectorOutline);
    console.log('CadCut contour:', cadcutContour);

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

function createVectorOutlineFromAlpha(image: HTMLImageElement, padding: number = 0): VectorPoint[] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;

  // Find edge pixels based on alpha channel
  const edgePixels: VectorPoint[] = [];
  
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const index = (y * image.width + x) * 4;
      const alpha = data[index + 3];
      
      if (alpha >= 128) {
        // Check if this solid pixel has any transparent neighbors
        const neighbors = [
          data[((y-1) * image.width + x) * 4 + 3],     // top
          data[(y * image.width + (x+1)) * 4 + 3],     // right
          data[((y+1) * image.width + x) * 4 + 3],     // bottom
          data[(y * image.width + (x-1)) * 4 + 3]      // left
        ];
        
        // If any neighbor is transparent, this is an edge pixel
        if (neighbors.some(neighbor => neighbor < 128)) {
          edgePixels.push({ x: x + padding, y: y + padding });
        }
      }
    }
  }

  if (edgePixels.length === 0) return [];

  // Create actual contour path following the edges
  return traceContourPath(edgePixels);
}

function traceContourPath(edgePixels: VectorPoint[]): VectorPoint[] {
  if (edgePixels.length === 0) return [];
  
  // Sort edge pixels by angle from center to create a proper outline
  const bounds = {
    minX: Math.min(...edgePixels.map(p => p.x)),
    maxX: Math.max(...edgePixels.map(p => p.x)),
    minY: Math.min(...edgePixels.map(p => p.y)),
    maxY: Math.max(...edgePixels.map(p => p.y))
  };
  
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  
  // Sort edge pixels by angle from center to create clockwise path
  const sortedPixels = edgePixels.sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });
  
  // Simplify the path by taking every nth pixel to reduce complexity
  const simplifiedPath: VectorPoint[] = [];
  const step = Math.max(1, Math.floor(sortedPixels.length / 100)); // Limit to ~100 points
  
  for (let i = 0; i < sortedPixels.length; i += step) {
    simplifiedPath.push(sortedPixels[i]);
  }
  
  return simplifiedPath;
}





function applyCadCutMethod(vectorPath: VectorPoint[], offsetPixels: number): VectorPoint[] {
  if (vectorPath.length < 3) return vectorPath;
  
  const offsetContour: VectorPoint[] = [];
  
  for (let i = 0; i < vectorPath.length; i++) {
    const current = vectorPath[i];
    const prev = vectorPath[(i - 1 + vectorPath.length) % vectorPath.length];
    const next = vectorPath[(i + 1) % vectorPath.length];
    
    // Calculate outward normal vector
    const v1x = current.x - prev.x;
    const v1y = current.y - prev.y;
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
      
      // Apply offset in outward direction
      offsetContour.push({
        x: current.x + avgNormalX * offsetPixels,
        y: current.y + avgNormalY * offsetPixels
      });
    } else {
      offsetContour.push(current);
    }
  }
  
  return offsetContour;
}

function drawCadCutContour(ctx: CanvasRenderingContext2D, contour: VectorPoint[]): void {
  if (contour.length < 2) return;

  // Use white outline for final contour
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  
  // Add subtle shadow for visibility
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  console.log('Drawing contour with', contour.length, 'points');
  
  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

