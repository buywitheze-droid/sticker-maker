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

  // Get content bounds using alpha channel detection
  const bounds = getContentBounds(image, strokeSettings.alphaThreshold);
  
  if (!bounds) {
    // No content found, return empty canvas
    return canvas;
  }

  // Apply offset in pixels (300 DPI conversion)
  const offsetPixels = strokeSettings.width * 300;
  
  // Create outline rectangle around content with offset
  const outlineRect = {
    x: Math.max(0, bounds.x - offsetPixels),
    y: Math.max(0, bounds.y - offsetPixels),
    width: Math.min(canvas.width, bounds.width + (offsetPixels * 2)),
    height: Math.min(canvas.height, bounds.height + (offsetPixels * 2))
  };

  // Draw white outline
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(4, offsetPixels * 0.015); // Visible line width
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  
  // Draw the outline rectangle
  ctx.strokeRect(outlineRect.x, outlineRect.y, outlineRect.width, outlineRect.height);
  
  return canvas;
}

function getContentBounds(image: HTMLImageElement, alphaThreshold: number): { x: number; y: number; width: number; height: number } | null {
  // Create temporary canvas to analyze alpha channel
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  // Draw image and get pixel data
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imageData.data;

  let minX = tempCanvas.width, maxX = 0, minY = tempCanvas.height, maxY = 0;
  let hasContent = false;

  // Scan all pixels to find content bounds based on alpha
  for (let y = 0; y < tempCanvas.height; y++) {
    for (let x = 0; x < tempCanvas.width; x++) {
      const index = (y * tempCanvas.width + x) * 4;
      const alpha = data[index + 3]; // Alpha channel
      
      // If pixel is not transparent enough, consider it content
      if (alpha >= alphaThreshold) {
        hasContent = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!hasContent) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}