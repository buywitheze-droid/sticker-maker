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