import { StrokeSettings } from "@/components/image-editor";

export interface VectorStrokeOptions {
  strokeSettings: StrokeSettings;
  exportCutContour?: boolean;
  vectorQuality?: 'high' | 'medium' | 'low';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

export function createVectorStroke(
  image: HTMLImageElement,
  options: VectorStrokeOptions
): HTMLCanvasElement {
  const { strokeSettings, exportCutContour = false, vectorQuality = 'high' } = options;
  
  // Create canvas for vector-quality processing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  // Set high resolution for vector quality
  const scaleFactor = vectorQuality === 'high' ? 4 : vectorQuality === 'medium' ? 2 : 1;
  const strokeWidth = strokeSettings.width * scaleFactor;
  
  canvas.width = (image.width + strokeWidth * 2) * scaleFactor;
  canvas.height = (image.height + strokeWidth * 2) * scaleFactor;
  
  // Enable high-quality rendering
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw scaled image
  ctx.drawImage(
    image,
    strokeWidth,
    strokeWidth,
    image.width * scaleFactor,
    image.height * scaleFactor
  );
  
  if (strokeSettings.enabled && strokeWidth > 0) {
    // Get image data for precise vector processing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Create high-precision stroke mask
    const strokeMask = new Uint8ClampedArray(data.length);
    
    // Use distance field approach for vector-quality stroke
    const distanceField = createDistanceField(data, canvas.width, canvas.height, strokeWidth);
    
    // Apply stroke based on distance field
    const strokeColor = hexToRgb(strokeSettings.color);
    const strokeData = ctx.createImageData(canvas.width, canvas.height);
    
    for (let i = 0; i < distanceField.length; i++) {
      const pixelIndex = i * 4;
      const distance = distanceField[i];
      const originalAlpha = data[pixelIndex + 3];
      
      // Create stroke where distance is within stroke width and original is transparent
      if (distance <= strokeWidth && distance > 0 && originalAlpha < 128) {
        // For CutContour, use spot color (usually magenta)
        if (exportCutContour) {
          strokeData.data[pixelIndex] = 255;     // Red
          strokeData.data[pixelIndex + 1] = 0;   // Green
          strokeData.data[pixelIndex + 2] = 255; // Blue (Magenta)
        } else {
          strokeData.data[pixelIndex] = strokeColor.r;
          strokeData.data[pixelIndex + 1] = strokeColor.g;
          strokeData.data[pixelIndex + 2] = strokeColor.b;
        }
        strokeData.data[pixelIndex + 3] = 255;
      }
    }
    
    // Clear canvas and apply stroke
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(strokeData, 0, 0);
    
    // If not CutContour, draw original image on top
    if (!exportCutContour) {
      ctx.drawImage(
        image,
        strokeWidth,
        strokeWidth,
        image.width * scaleFactor,
        image.height * scaleFactor
      );
    }
  }
  
  return canvas;
}

function createDistanceField(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxDistance: number
): Float32Array {
  const distanceField = new Float32Array(width * height);
  
  // Initialize distance field
  for (let i = 0; i < distanceField.length; i++) {
    const pixelIndex = i * 4;
    const alpha = data[pixelIndex + 3];
    distanceField[i] = alpha > 128 ? 0 : Infinity;
  }
  
  // Use Euclidean distance transform for precise vector edges
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      
      if (distanceField[index] === 0) {
        // This is an opaque pixel, calculate distances to nearby pixels
        const minX = Math.max(0, x - maxDistance);
        const maxX = Math.min(width - 1, x + maxDistance);
        const minY = Math.max(0, y - maxDistance);
        const maxY = Math.min(height - 1, y + maxDistance);
        
        for (let ny = minY; ny <= maxY; ny++) {
          for (let nx = minX; nx <= maxX; nx++) {
            const nIndex = ny * width + nx;
            const dx = nx - x;
            const dy = ny - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= maxDistance) {
              distanceField[nIndex] = Math.min(distanceField[nIndex], distance);
            }
          }
        }
      }
    }
  }
  
  return distanceField;
}

export function downloadVectorStroke(
  canvas: HTMLCanvasElement,
  filename: string,
  format: 'png' | 'svg' = 'png'
): void {
  if (format === 'svg') {
    // For true vector export, we'd need to trace the bitmap to SVG paths
    // This is a complex operation that would require a tracing library
    console.warn('SVG export not implemented yet. Downloading as high-quality PNG.');
  }
  
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 'image/png');
}