/**
 * Magic Eraser style background removal
 * Uses flood-fill from edges to remove only contiguous white background
 * White areas inside the design are preserved
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
 * Check if a pixel at given index is "white enough" to be considered background
 */
function isWhitePixel(data: Uint8ClampedArray, index: number, thresholdValue: number): boolean {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];
  
  // If pixel is already transparent, it's part of the background path (can traverse through)
  if (a < 128) return true;
  
  // Check if pixel is close to white using minimum channel
  const minChannel = Math.min(r, g, b);
  return minChannel >= thresholdValue;
}

/**
 * Check if a pixel should actually be made transparent (white and opaque)
 */
function shouldRemovePixel(data: Uint8ClampedArray, index: number, thresholdValue: number): boolean {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];
  
  // Only remove pixels that are opaque and white
  if (a < 128) return false;
  
  const minChannel = Math.min(r, g, b);
  return minChannel >= thresholdValue;
}

/**
 * Flood-fill from edges to find all contiguous white background pixels
 * Returns a Set of pixel indices that should be made transparent
 */
function floodFillFromEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  thresholdValue: number
): Set<number> {
  const toRemove = new Set<number>();
  const visited = new Set<number>();
  const queue: number[] = [];
  
  // Helper to get pixel index from x,y coordinates
  const getIndex = (x: number, y: number) => (y * width + x) * 4;
  
  // Add all edge pixels to queue if they are white
  // Top and bottom edges
  for (let x = 0; x < width; x++) {
    // Top edge
    const topIndex = getIndex(x, 0);
    if (isWhitePixel(data, topIndex, thresholdValue) && !visited.has(topIndex)) {
      queue.push(topIndex);
      visited.add(topIndex);
    }
    // Bottom edge
    const bottomIndex = getIndex(x, height - 1);
    if (isWhitePixel(data, bottomIndex, thresholdValue) && !visited.has(bottomIndex)) {
      queue.push(bottomIndex);
      visited.add(bottomIndex);
    }
  }
  
  // Left and right edges
  for (let y = 0; y < height; y++) {
    // Left edge
    const leftIndex = getIndex(0, y);
    if (isWhitePixel(data, leftIndex, thresholdValue) && !visited.has(leftIndex)) {
      queue.push(leftIndex);
      visited.add(leftIndex);
    }
    // Right edge
    const rightIndex = getIndex(width - 1, y);
    if (isWhitePixel(data, rightIndex, thresholdValue) && !visited.has(rightIndex)) {
      queue.push(rightIndex);
      visited.add(rightIndex);
    }
  }
  
  // Flood fill using BFS with index-based processing (O(1) instead of O(n) for shift)
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const currentIndex = queue[queueIndex++];
    
    // Only add to removal set if it's actually a white opaque pixel
    if (shouldRemovePixel(data, currentIndex, thresholdValue)) {
      toRemove.add(currentIndex);
    }
    
    // Get x,y from index
    const pixelPos = currentIndex / 4;
    const x = pixelPos % width;
    const y = Math.floor(pixelPos / width);
    
    // Check 4-connected neighbors (up, down, left, right)
    const neighbors = [
      { nx: x, ny: y - 1 },     // up
      { nx: x, ny: y + 1 },     // down
      { nx: x - 1, ny: y },     // left
      { nx: x + 1, ny: y },     // right
    ];
    
    for (const { nx, ny } of neighbors) {
      // Skip if out of bounds
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const neighborIndex = getIndex(nx, ny);
      
      // Skip if already visited
      if (visited.has(neighborIndex)) continue;
      
      visited.add(neighborIndex);
      
      // If neighbor is white, add to queue
      if (isWhitePixel(data, neighborIndex, thresholdValue)) {
        queue.push(neighborIndex);
      }
    }
  }
  
  return toRemove;
}

/**
 * Removes white background from edges only (Magic Eraser style)
 * Returns a new canvas with transparent background where white was connected to edges
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
  
  // Find all white pixels connected to edges using flood fill
  const pixelsToRemove = floodFillFromEdges(data, canvas.width, canvas.height, thresholdValue);
  
  // Make the marked pixels transparent
  const pixelArray = Array.from(pixelsToRemove);
  for (let i = 0; i < pixelArray.length; i++) {
    const index = pixelArray[i];
    if (opts.featherEdge) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const minChannel = Math.min(r, g, b);
      
      // Calculate how close to white (for soft edges)
      const whiteness = minChannel / 255;
      const fadeStart = opts.threshold / 100;
      if (whiteness >= fadeStart) {
        // Fade alpha based on whiteness
        const fadeAmount = (whiteness - fadeStart) / (1 - fadeStart);
        data[index + 3] = Math.round(255 * (1 - fadeAmount));
      }
    } else {
      // Hard edge - fully transparent
      data[index + 3] = 0;
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
 * Uses Magic Eraser style - only removes white connected to edges
 */
export async function removeBackgroundFromImage(
  image: HTMLImageElement,
  threshold: number = 95
): Promise<HTMLImageElement> {
  const canvas = removeWhiteBackground(image, { threshold, featherEdge: true });
  return canvasToImage(canvas);
}
