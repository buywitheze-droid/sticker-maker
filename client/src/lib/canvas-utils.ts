import { StrokeSettings } from "@/components/image-editor";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

export function drawImageWithStroke(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  canvasWidth: number,
  canvasHeight: number
) {
  // Calculate scaling to fit image within canvas
  const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const x = (canvasWidth - scaledWidth) / 2;
  const y = (canvasHeight - scaledHeight) / 2;

  // Draw stroke/outline if enabled
  if (strokeSettings.enabled && strokeSettings.width > 0) {
    // Calculate stroke width relative to scaling
    const strokeWidth = Math.ceil(strokeSettings.width * scale);
    
    // Create temporary canvas for image processing
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    
    // Set size with padding for stroke
    const padding = strokeWidth * 2;
    tempCanvas.width = scaledWidth + padding;
    tempCanvas.height = scaledHeight + padding;
    
    // Draw image centered in temp canvas
    tempCtx.drawImage(image, strokeWidth, strokeWidth, scaledWidth, scaledHeight);
    
    // Get image data for processing
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;
    
    // Create stroke mask using morphological dilation
    const strokeMask = new Uint8ClampedArray(data.length);
    
    // Optimized dilation using distance transform approach
    // First, identify all opaque pixels
    const opaquePixels = [];
    for (let y = 0; y < tempCanvas.height; y++) {
      for (let x = 0; x < tempCanvas.width; x++) {
        const idx = (y * tempCanvas.width + x) * 4;
        if (data[idx + 3] > 128) {
          opaquePixels.push({ x, y });
        }
      }
    }
    
    // For each opaque pixel, mark stroke area efficiently
    for (const pixel of opaquePixels) {
      const minX = Math.max(0, pixel.x - strokeWidth);
      const maxX = Math.min(tempCanvas.width - 1, pixel.x + strokeWidth);
      const minY = Math.max(0, pixel.y - strokeWidth);
      const maxY = Math.min(tempCanvas.height - 1, pixel.y + strokeWidth);
      
      for (let sy = minY; sy <= maxY; sy++) {
        for (let sx = minX; sx <= maxX; sx++) {
          const dx = sx - pixel.x;
          const dy = sy - pixel.y;
          
          // Use circular brush
          if (dx * dx + dy * dy <= strokeWidth * strokeWidth) {
            const strokeIdx = (sy * tempCanvas.width + sx) * 4;
            strokeMask[strokeIdx + 3] = 255;
          }
        }
      }
    }
    
    // Create stroke image data
    const strokeData = tempCtx.createImageData(tempCanvas.width, tempCanvas.height);
    const strokeColor = hexToRgb(strokeSettings.color);
    
    // Apply stroke color where mask is set and original image is transparent
    for (let i = 0; i < strokeMask.length; i += 4) {
      if (strokeMask[i + 3] > 0 && data[i + 3] < 128) {
        strokeData.data[i] = strokeColor.r;
        strokeData.data[i + 1] = strokeColor.g;
        strokeData.data[i + 2] = strokeColor.b;
        strokeData.data[i + 3] = 255;
      }
    }
    
    // Clear temp canvas and draw stroke
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.putImageData(strokeData, 0, 0);
    
    // Draw original image on top
    tempCtx.drawImage(image, strokeWidth, strokeWidth, scaledWidth, scaledHeight);
    
    // Draw final result to main canvas
    ctx.drawImage(tempCanvas, x - strokeWidth, y - strokeWidth);
  } else {
    // Draw image without stroke
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
  }

  // Draw the main image on top
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
}

export function createCheckerboardPattern(ctx: CanvasRenderingContext2D, size: number = 20) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  
  canvas.width = size * 2;
  canvas.height = size * 2;
  
  context.fillStyle = '#f3f4f6';
  context.fillRect(0, 0, size, size);
  context.fillRect(size, size, size, size);
  
  context.fillStyle = '#ffffff';
  context.fillRect(size, 0, size, size);
  context.fillRect(0, size, size, size);
  
  return ctx.createPattern(canvas, 'repeat');
}
