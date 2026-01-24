export function getImageBounds(image: HTMLImageElement, excludeWhite: boolean = false): { x: number; y: number; width: number; height: number } {
  // Create a temporary canvas to analyze the image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { x: 0, y: 0, width: image.width, height: image.height };

  canvas.width = image.width;
  canvas.height = image.height;
  
  // Draw the image
  ctx.drawImage(image, 0, 0);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  
  // Threshold for considering a pixel as "white" (0-255 scale)
  const whiteThreshold = 250;
  
  // Find the exact bounding box of visible content
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const alpha = data[idx + 3];
      
      // Check if pixel is visible
      let isContent = alpha > 10;
      
      // If excludeWhite mode, also exclude near-white pixels
      if (isContent && excludeWhite) {
        const isNearWhite = r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold;
        if (isNearWhite) {
          isContent = false;
        }
      }
      
      if (isContent) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  // If no content pixels found, return original dimensions
  if (minX > maxX || minY > maxY) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

export function cropImageToContent(image: HTMLImageElement): HTMLCanvasElement | null {
  try {
    const bounds = getImageBounds(image);
    
    // Validate bounds
    if (bounds.width <= 0 || bounds.height <= 0) {
      console.warn('Invalid crop bounds, returning null');
      return null;
    }
    
    // Always create a cropped canvas to ensure zero empty space
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get canvas context');
      return null;
    }
    
    // Set canvas to exact content dimensions with no padding
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    
    // Draw only the content area with pixel-perfect cropping
    ctx.drawImage(
      image,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, bounds.width, bounds.height
    );
    
    return canvas;
  } catch (error) {
    console.error('Error cropping image:', error);
    return null;
  }
}

export function createEdgeBleedCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  bleedPixels: number
): HTMLCanvasElement {
  const srcWidth = source instanceof HTMLImageElement ? source.width : source.width;
  const srcHeight = source instanceof HTMLImageElement ? source.height : source.height;
  
  const outWidth = srcWidth + bleedPixels * 2;
  const outHeight = srcHeight + bleedPixels * 2;
  
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(source, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);
  const srcPixels = srcData.data;
  
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext('2d')!;
  
  outCtx.drawImage(source, bleedPixels, bleedPixels);
  
  const outData = outCtx.getImageData(0, 0, outWidth, outHeight);
  const outPixels = outData.data;
  
  const isEdgePixel = (x: number, y: number): boolean => {
    if (x < 0 || x >= srcWidth || y < 0 || y >= srcHeight) return false;
    const idx = (y * srcWidth + x) * 4;
    if (srcPixels[idx + 3] < 10) return false;
    
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= srcWidth || ny < 0 || ny >= srcHeight) return true;
        const nIdx = (ny * srcWidth + nx) * 4;
        if (srcPixels[nIdx + 3] < 10) return true;
      }
    }
    return false;
  };
  
  const edgePixels: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++) {
      if (isEdgePixel(x, y)) {
        const idx = (y * srcWidth + x) * 4;
        edgePixels.push({
          x, y,
          r: srcPixels[idx],
          g: srcPixels[idx + 1],
          b: srcPixels[idx + 2],
          a: srcPixels[idx + 3]
        });
      }
    }
  }
  
  if (edgePixels.length === 0) {
    return outCanvas;
  }
  
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const sx = ox - bleedPixels;
      const sy = oy - bleedPixels;
      
      if (sx >= 0 && sx < srcWidth && sy >= 0 && sy < srcHeight) {
        const srcIdx = (sy * srcWidth + sx) * 4;
        if (srcPixels[srcIdx + 3] >= 10) continue;
      }
      
      let minDist = Infinity;
      let nearestEdge = edgePixels[0];
      
      for (const edge of edgePixels) {
        const dx = sx - edge.x;
        const dy = sy - edge.y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          nearestEdge = edge;
        }
      }
      
      if (Math.sqrt(minDist) <= bleedPixels + 2) {
        const outIdx = (oy * outWidth + ox) * 4;
        outPixels[outIdx] = nearestEdge.r;
        outPixels[outIdx + 1] = nearestEdge.g;
        outPixels[outIdx + 2] = nearestEdge.b;
        outPixels[outIdx + 3] = nearestEdge.a;
      }
    }
  }
  
  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}