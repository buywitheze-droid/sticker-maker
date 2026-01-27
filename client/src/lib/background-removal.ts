/**
 * Clean white background removal
 * Uses flood-fill from edges to remove only contiguous white/light background
 * White areas inside the design are preserved
 * Produces clean, hard edges with no semi-transparent pixels
 */

export interface BackgroundRemovalOptions {
  threshold: number; // 0-100, how close to white a pixel needs to be to be removed (default 85)
}

const defaultOptions: BackgroundRemovalOptions = {
  threshold: 85,
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
 * Clean up semi-transparent edge pixels adjacent to removed areas
 * Either makes them fully transparent or fully opaque based on threshold
 */
function cleanupEdgePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  removedPixels: Set<number>
): void {
  const getIndex = (x: number, y: number) => (y * width + x) * 4;
  
  // Find all pixels adjacent to removed pixels
  const edgePixels = new Set<number>();
  const removedArray = Array.from(removedPixels);
  
  for (const removedIndex of removedArray) {
    const pixelPos = removedIndex / 4;
    const x = pixelPos % width;
    const y = Math.floor(pixelPos / width);
    
    // Check 8-connected neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        
        const neighborIndex = getIndex(nx, ny);
        if (!removedPixels.has(neighborIndex)) {
          edgePixels.add(neighborIndex);
        }
      }
    }
  }
  
  // For edge pixels: clamp any semi-transparent pixel to fully transparent or fully opaque
  // This eliminates all anti-aliasing artifacts at the edge of the removal
  const edgeArray = Array.from(edgePixels);
  for (const index of edgeArray) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    
    // If pixel is very light (close to white), make it fully transparent
    const brightness = (r + g + b) / 3;
    if (brightness > 220 && a > 0) {
      data[index + 3] = 0;
      continue;
    }
    
    // Clamp any semi-transparent pixels to either fully transparent or fully opaque
    // This removes anti-aliasing artifacts (the "fringe" pixels)
    if (a > 0 && a < 255) {
      // If alpha is low (<128), make it transparent; otherwise make it opaque
      data[index + 3] = a < 128 ? 0 : 255;
    }
  }
}

/**
 * Second pass: Remove any remaining semi-transparent pixels across the entire image
 * that are adjacent to fully transparent pixels. This catches any stray fringe pixels.
 */
function cleanupAllSemiTransparentEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number
): void {
  const getIndex = (x: number, y: number) => (y * width + x) * 4;
  
  // Find all pixels adjacent to transparent pixels and clamp their alpha
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = getIndex(x, y);
      const a = data[index + 3];
      
      // Skip fully transparent or fully opaque pixels
      if (a === 0 || a === 255) continue;
      
      // Check if any neighbor is transparent
      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          
          const neighborIndex = getIndex(nx, ny);
          if (data[neighborIndex + 3] === 0) {
            hasTransparentNeighbor = true;
            break;
          }
        }
        if (hasTransparentNeighbor) break;
      }
      
      // If adjacent to transparent pixel, clamp this semi-transparent pixel
      if (hasTransparentNeighbor) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const brightness = (r + g + b) / 3;
        
        // Light semi-transparent pixels next to transparency -> make transparent
        if (brightness > 180 || a < 128) {
          data[index + 3] = 0;
        } else {
          // Darker semi-transparent pixels -> make opaque
          data[index + 3] = 255;
        }
      }
    }
  }
}

/**
 * Removes white background from edges only
 * Returns a new canvas with transparent background where white was connected to edges
 * Produces clean, hard edges with no semi-transparent artifacts
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
  
  console.log(`[BackgroundRemoval] Starting with threshold ${opts.threshold}% (value: ${thresholdValue.toFixed(1)})`);
  console.log(`[BackgroundRemoval] Image size: ${canvas.width}x${canvas.height}`);
  
  // Find all white pixels connected to edges using flood fill
  const pixelsToRemove = floodFillFromEdges(data, canvas.width, canvas.height, thresholdValue);
  
  console.log(`[BackgroundRemoval] Found ${pixelsToRemove.size} pixels to remove`);
  
  // Make the marked pixels fully transparent (hard edge, no feathering)
  const pixelArray = Array.from(pixelsToRemove);
  for (const index of pixelArray) {
    data[index + 3] = 0; // Set alpha to 0 (fully transparent)
  }
  
  // Clean up any semi-transparent or very light pixels at the edges
  cleanupEdgePixels(data, canvas.width, canvas.height, pixelsToRemove);
  
  // Second pass: catch any remaining semi-transparent pixels adjacent to transparency
  cleanupAllSemiTransparentEdges(data, canvas.width, canvas.height);
  
  // Put processed data back
  ctx.putImageData(imageData, 0, 0);
  
  console.log(`[BackgroundRemoval] Complete - clean edges applied`);
  
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
 * Uses flood-fill style - only removes white connected to edges
 * Produces clean, hard edges with no semi-transparent artifacts
 */
export async function removeBackgroundFromImage(
  image: HTMLImageElement,
  threshold: number = 85
): Promise<HTMLImageElement> {
  const canvas = removeWhiteBackground(image, { threshold });
  return canvasToImage(canvas);
}
