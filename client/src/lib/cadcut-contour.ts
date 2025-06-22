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

  // Get content bounds using simple alpha channel detection
  const bounds = getContentBounds(image, strokeSettings.alphaThreshold);
  
  if (!bounds) {
    return canvas;
  }

  // Apply offset in pixels (convert inches to pixels at 300 DPI)
  const offsetPixels = strokeSettings.width * 300;
  
  // Create rectangular contour around content with offset
  const contourRect = {
    x: Math.max(0, bounds.x - offsetPixels),
    y: Math.max(0, bounds.y - offsetPixels),
    width: Math.min(canvas.width - (bounds.x - offsetPixels), bounds.width + (offsetPixels * 2)),
    height: Math.min(canvas.height - (bounds.y - offsetPixels), bounds.height + (offsetPixels * 2))
  };

  // Draw clean white rectangular outline
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(3, offsetPixels * 0.02);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  
  // Draw the rectangular contour
  ctx.strokeRect(contourRect.x, contourRect.y, contourRect.width, contourRect.height);
  
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

  // Simple alpha channel detection - find bounds of non-transparent pixels
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