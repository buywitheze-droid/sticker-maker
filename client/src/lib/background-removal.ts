/**
 * Fast client-side background removal for solid white backgrounds
 * Uses canvas pixel analysis to detect and remove white/near-white pixels
 */

export interface BackgroundRemovalOptions {
  threshold: number; // 0-100, how close to white a pixel needs to be to be removed (default 95)
  featherEdge: boolean; // Whether to smooth edges
}

const defaultOptions: BackgroundRemovalOptions = {
  threshold: 95,
  featherEdge: true,
};

/**
 * Removes white/light background from an image
 * Returns a new canvas with transparent background
 */
export function removeWhiteBackground(
  image: HTMLImageElement,
  options: Partial<BackgroundRemovalOptions> = {}
): HTMLCanvasElement {
  const opts = { ...defaultOptions, ...options };
  
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to get canvas context');
  
  // Draw original image
  ctx.drawImage(image, 0, 0);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Calculate threshold value (0-255 scale)
  const thresholdValue = (opts.threshold / 100) * 255;
  
  // Process each pixel
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Check if pixel is close to white
    // Use minimum of RGB to detect near-white pixels
    const minChannel = Math.min(r, g, b);
    
    if (minChannel >= thresholdValue) {
      // Pixel is near-white, make it transparent
      if (opts.featherEdge) {
        // Calculate how close to white (for soft edges)
        const whiteness = minChannel / 255;
        const fadeStart = opts.threshold / 100;
        if (whiteness >= fadeStart) {
          // Fade alpha based on whiteness
          const fadeAmount = (whiteness - fadeStart) / (1 - fadeStart);
          data[i + 3] = Math.round(255 * (1 - fadeAmount));
        }
      } else {
        // Hard edge - fully transparent
        data[i + 3] = 0;
      }
    }
  }
  
  // Put processed data back
  ctx.putImageData(imageData, 0, 0);
  
  return canvas;
}

/**
 * Creates a new HTMLImageElement from a canvas
 */
export async function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/png');
  });
}

/**
 * Removes background and returns a new image element
 */
export async function removeBackgroundFromImage(
  image: HTMLImageElement,
  threshold: number = 95
): Promise<HTMLImageElement> {
  const canvas = removeWhiteBackground(image, { threshold, featherEdge: true });
  return canvasToImage(canvas);
}
