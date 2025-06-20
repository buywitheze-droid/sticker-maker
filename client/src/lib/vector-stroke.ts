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
  const { strokeSettings, exportCutContour = false, vectorQuality = 'medium' } = options;
  
  // Create canvas for vector-quality processing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  // Use more reasonable scaling to prevent crashes
  const scaleFactor = vectorQuality === 'high' ? 2 : vectorQuality === 'medium' ? 1.5 : 1;
  const strokeWidth = Math.ceil(strokeSettings.width * scaleFactor);
  
  canvas.width = Math.ceil((image.width + strokeWidth * 2) * scaleFactor);
  canvas.height = Math.ceil((image.height + strokeWidth * 2) * scaleFactor);
  
  // Limit canvas size to prevent crashes
  const maxSize = 4096;
  if (canvas.width > maxSize || canvas.height > maxSize) {
    const scale = Math.min(maxSize / canvas.width, maxSize / canvas.height);
    canvas.width = Math.ceil(canvas.width * scale);
    canvas.height = Math.ceil(canvas.height * scale);
  }
  
  // Enable high-quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  if (strokeSettings.enabled && strokeWidth > 0) {
    // Use optimized shadow-based approach for better performance
    ctx.save();
    
    // Set up shadow properties for clean outline
    ctx.shadowColor = exportCutContour ? '#FF00FF' : strokeSettings.color; // Magenta for CutContour
    ctx.shadowBlur = 0;
    
    // Draw multiple shadows in a circle pattern for solid outline
    const steps = Math.min(16, Math.max(8, strokeWidth));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.shadowOffsetX = Math.cos(angle) * strokeWidth;
      ctx.shadowOffsetY = Math.sin(angle) * strokeWidth;
      
      ctx.drawImage(
        image,
        strokeWidth,
        strokeWidth,
        canvas.width - strokeWidth * 2,
        canvas.height - strokeWidth * 2
      );
    }
    
    ctx.restore();
    
    // If not CutContour, draw original image on top
    if (!exportCutContour) {
      ctx.drawImage(
        image,
        strokeWidth,
        strokeWidth,
        canvas.width - strokeWidth * 2,
        canvas.height - strokeWidth * 2
      );
    }
  } else {
    // Just draw the image if no stroke
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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