import { StrokeSettings } from "@/components/image-editor";

export interface TrueContourOptions {
  strokeSettings: StrokeSettings;
  threshold: number;
  smoothing: number;
  includeHoles: boolean;
  holeMargin: number;
  fillHoles: boolean;
  autoTextBackground: boolean;
}

interface ContourPoint {
  x: number;
  y: number;
}

export function createTrueContour(
  image: HTMLImageElement,
  options: TrueContourOptions
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  try {
    const { strokeSettings, threshold = 128, smoothing = 1, includeHoles = false, holeMargin = 0.5, fillHoles = false, autoTextBackground = false } = options;
    
    const padding = (strokeSettings.width / 100) * 2; // Convert back from 100x scale
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    
    const imageX = padding;
    const imageY = padding;
    
    // Process image based on options
    let processedImage = image;
    
    if (fillHoles) {
      // Fill holes with white background if requested
      processedImage = fillTransparentHoles(image, threshold);
    }
    
    if (strokeSettings.enabled) {
      // Generate cutting contour paths
      const contourPaths = generateTrueContourPaths(processedImage, threshold, smoothing, includeHoles, holeMargin);
      
      // First draw white-filled contour as background
      drawWhiteFilledContour(ctx, contourPaths, imageX, imageY);
      
      // Then draw the processed image on top
      ctx.drawImage(processedImage, imageX, imageY);
      
      // Finally draw outline stroke
      drawTrueContourStroke(ctx, contourPaths, strokeSettings, imageX, imageY);
    } else {
      // No outline - just draw the processed image
      ctx.drawImage(processedImage, imageX, imageY);
    }
    
    return canvas;
  } catch (error) {
    console.error('True contour error:', error);
    // Fallback to simple rendering
    return createSimpleContour(image, strokeSettings);
  }
}

function createSimpleContour(image: HTMLImageElement, strokeSettings: StrokeSettings): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  const padding = strokeSettings.width * 2;
  canvas.width = image.width + padding * 2;
  canvas.height = image.height + padding * 2;
  
  ctx.drawImage(image, padding, padding);
  return canvas;
}

function fillTransparentHoles(image: HTMLImageElement, threshold: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  canvas.width = image.width;
  canvas.height = image.height;
  
  // Draw white background first
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Extract image data to identify holes
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return canvas;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Create filled image data
  const filledData = new Uint8ClampedArray(data.length);
  filledData.set(data);
  
  // Use flood fill algorithm to identify and fill interior gaps
  const visited = new Uint8Array(width * height);
  const isInteriorGap = new Uint8Array(width * height);
  
  // First pass: identify all transparent regions and classify them
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const pixelIdx = y * width + x;
      const currentAlpha = data[idx + 3];
      
      if (currentAlpha < threshold && !visited[pixelIdx]) {
        // Found an unvisited transparent region - flood fill to analyze it
        const region = floodFillRegion(data, width, height, x, y, threshold, visited);
        
        // Check if this region is an interior gap (surrounded by solid content)
        const isSurrounded = isRegionSurrounded(region, data, width, height, threshold);
        
        if (isSurrounded) {
          // Mark all pixels in this region as interior gaps
          for (const pixel of region) {
            isInteriorGap[pixel.y * width + pixel.x] = 1;
          }
        }
      }
    }
  }
  
  // Second pass: fill all identified interior gaps with white
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (isInteriorGap[pixelIdx]) {
        const idx = (y * width + x) * 4;
        filledData[idx] = 255;     // R
        filledData[idx + 1] = 255; // G
        filledData[idx + 2] = 255; // B
        filledData[idx + 3] = 255; // A
      }
    }
  }
  
  // Create new image data and draw it
  const filledImageData = new ImageData(filledData, width, height);
  ctx.putImageData(filledImageData, 0, 0);
  
  return canvas;
}

function addTextBackground(image: HTMLImageElement, threshold: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  canvas.width = image.width;
  canvas.height = image.height;
  
  // Extract image data to analyze text structure
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return canvas;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Find the bounding box of all visible content
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasContent = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      if (alpha >= threshold) {
        hasContent = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasContent) {
    // If no content, return original image
    ctx.drawImage(image, 0, 0);
    return canvas;
  }
  
  // Add padding around the content bounding box
  const padding = Math.max(8, Math.min(width, height) * 0.02); // 2% of smallest dimension, minimum 8px
  const bgMinX = Math.max(0, minX - padding);
  const bgMaxX = Math.min(width - 1, maxX + padding);
  const bgMinY = Math.max(0, minY - padding);
  const bgMaxY = Math.min(height - 1, maxY + padding);
  
  // Create new image data with white background
  const newData = new Uint8ClampedArray(data.length);
  
  // Copy original data
  newData.set(data);
  
  // Add white background in the bounding box area
  for (let y = bgMinY; y <= bgMaxY; y++) {
    for (let x = bgMinX; x <= bgMaxX; x++) {
      const idx = (y * width + x) * 4;
      
      // If pixel is transparent, make it white
      if (data[idx + 3] < threshold) {
        newData[idx] = 255;     // R
        newData[idx + 1] = 255; // G
        newData[idx + 2] = 255; // B
        newData[idx + 3] = 255; // A
      }
    }
  }
  
  // Create new image data and draw it
  const newImageData = new ImageData(newData, width, height);
  ctx.putImageData(newImageData, 0, 0);
  
  return canvas;
}

function floodFillRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  threshold: number,
  visited: Uint8Array
): Array<{x: number, y: number}> {
  const region: Array<{x: number, y: number}> = [];
  const stack: Array<{x: number, y: number}> = [{x: startX, y: startY}];
  
  while (stack.length > 0) {
    const {x, y} = stack.pop()!;
    const pixelIdx = y * width + x;
    
    if (x < 0 || x >= width || y < 0 || y >= height || visited[pixelIdx]) {
      continue;
    }
    
    const idx = (y * width + x) * 4;
    const alpha = data[idx + 3];
    
    if (alpha >= threshold) {
      continue; // This is a solid pixel, not part of the transparent region
    }
    
    visited[pixelIdx] = 1;
    region.push({x, y});
    
    // Add neighboring pixels to stack
    stack.push({x: x + 1, y});
    stack.push({x: x - 1, y});
    stack.push({x, y: y + 1});
    stack.push({x, y: y - 1});
  }
  
  return region;
}

function isRegionSurrounded(
  region: Array<{x: number, y: number}>,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean {
  // Check if any pixel in the region touches the image boundary
  for (const {x, y} of region) {
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      return false; // Region touches boundary, so it's not an interior gap
    }
  }
  
  // Check if the region is surrounded by solid content
  // We'll sample points around the region's perimeter
  const perimeter = new Set<string>();
  
  for (const {x, y} of region) {
    // Check 8-directional neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = (ny * width + nx) * 4;
          const nAlpha = data[nIdx + 3];
          
          if (nAlpha >= threshold) {
            perimeter.add(`${nx},${ny}`);
          }
        }
      }
    }
  }
  
  // If we found solid pixels around the region and the region doesn't touch boundaries,
  // and the perimeter has sufficient solid content, consider it surrounded
  const regionSize = region.length;
  const perimeterSize = perimeter.size;
  
  // Require a minimum ratio of perimeter to region size for robust detection
  return perimeterSize > 0 && (perimeterSize >= Math.min(regionSize * 0.3, 50));
}

function generateTrueContourPaths(
  image: HTMLImageElement,
  threshold: number,
  smoothing: number,
  includeHoles: boolean,
  holeMargin: number
): ContourPoint[][] {
  try {
    // Simple CadCut-style outline generation
    return generateCadCutOutline(image, threshold, smoothing);
  } catch (error) {
    console.error('Error generating cadcut outline:', error);
    return [];
  }
}

function generateCadCutOutline(
  image: HTMLImageElement,
  threshold: number,
  outlineWidth: number
): ContourPoint[][] {
  // Simple CadCut-style outline generation
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Step 1: Create simple binary mask
  const binaryMask = createSimpleBinaryMask(data, width, height, threshold);
  
  // Step 2: Find edge pixels
  const edgePixels = findEdgePixels(binaryMask, width, height);
  
  // Step 3: Apply simple offset
  const offsetPixels = applySimpleOffset(edgePixels, outlineWidth / 20);
  
  // Step 4: Connect pixels into contour
  const contour = connectPixelsToContour(offsetPixels);
  
  return contour.length > 0 ? [contour] : [];
}

function createSimpleBinaryMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean[][] {
  const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      mask[y][x] = alpha >= threshold;
    }
  }
  
  return mask;
}

function findEdgePixels(
  mask: boolean[][],
  width: number,
  height: number
): ContourPoint[] {
  const edgePixels: ContourPoint[] = [];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y][x]) {
        // Check if this pixel is on the edge
        const neighbors = [
          mask[y-1][x], mask[y+1][x], // top, bottom
          mask[y][x-1], mask[y][x+1], // left, right
        ];
        
        if (neighbors.some(n => !n)) {
          edgePixels.push({ x, y });
        }
      }
    }
  }
  
  return edgePixels;
}

function applySimpleOffset(
  edgePixels: ContourPoint[],
  offsetDistance: number
): ContourPoint[] {
  const offsetPixels: ContourPoint[] = [];
  
  for (const pixel of edgePixels) {
    // Calculate outward normal (simplified)
    const offsetX = pixel.x + offsetDistance;
    const offsetY = pixel.y + offsetDistance;
    
    offsetPixels.push({
      x: Math.round(offsetX),
      y: Math.round(offsetY)
    });
  }
  
  return offsetPixels;
}

function connectPixelsToContour(pixels: ContourPoint[]): ContourPoint[] {
  if (pixels.length === 0) return [];
  
  // Simple contour connection - sort by angle from center
  const centerX = pixels.reduce((sum, p) => sum + p.x, 0) / pixels.length;
  const centerY = pixels.reduce((sum, p) => sum + p.y, 0) / pixels.length;
  
  const sortedPixels = pixels.slice().sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });
  
  return sortedPixels;
}

function createBordifyBinaryMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean[][] {
  const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Bordify uses adaptive thresholding with local statistics
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      // Apply local adaptive threshold (Bordify's method)
      let localThreshold = threshold;
      if (alpha > 0 && alpha < 255) {
        // Check local neighborhood for better edge detection
        let neighborSum = 0;
        let neighborCount = 0;
        
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const nIdx = (ny * width + nx) * 4;
              neighborSum += data[nIdx + 3];
              neighborCount++;
            }
          }
        }
        
        const localMean = neighborSum / neighborCount;
        localThreshold = Math.max(threshold * 0.5, localMean * 0.8);
      }
      
      mask[y][x] = alpha >= localThreshold;
    }
  }
  
  return mask;
}

function morphologicalClosing(
  mask: boolean[][],
  width: number,
  height: number,
  kernelSize: number
): boolean[][] {
  // Bordify uses closing (dilation followed by erosion) to fill gaps
  const dilated = morphologicalDilation(mask, width, height, kernelSize);
  return morphologicalErosion(dilated, width, height, kernelSize);
}

function morphologicalDilation(
  mask: boolean[][],
  width: number,
  height: number,
  kernelSize: number
): boolean[][] {
  const result: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  const radius = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hasTrue = false;
      
      for (let dy = -radius; dy <= radius && !hasTrue; dy++) {
        for (let dx = -radius; dx <= radius && !hasTrue; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny][nx]) {
              hasTrue = true;
            }
          }
        }
      }
      
      result[y][x] = hasTrue;
    }
  }
  
  return result;
}

function morphologicalErosion(
  mask: boolean[][],
  width: number,
  height: number,
  kernelSize: number
): boolean[][] {
  const result: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  const radius = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allTrue = true;
      
      for (let dy = -radius; dy <= radius && allTrue; dy++) {
        for (let dx = -radius; dx <= radius && allTrue; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (!mask[ny][nx]) {
              allTrue = false;
            }
          } else {
            allTrue = false; // Treat boundary as false
          }
        }
      }
      
      result[y][x] = allTrue;
    }
  }
  
  return result;
}

function calculateDistanceTransform(
  mask: boolean[][],
  width: number,
  height: number
): number[][] {
  // Bordify uses Euclidean distance transform for precise offsetting
  const distances: number[][] = Array(height).fill(null).map(() => Array(width).fill(Infinity));
  
  // Initialize distances for foreground pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x]) {
        distances[y][x] = 0;
      }
    }
  }
  
  // Forward pass
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      if (!mask[y][x]) {
        distances[y][x] = Math.min(
          distances[y][x],
          distances[y-1][x] + 1,
          distances[y][x-1] + 1,
          distances[y-1][x-1] + Math.sqrt(2)
        );
      }
    }
  }
  
  // Backward pass
  for (let y = height - 2; y >= 0; y--) {
    for (let x = width - 2; x >= 0; x--) {
      if (!mask[y][x]) {
        distances[y][x] = Math.min(
          distances[y][x],
          distances[y+1][x] + 1,
          distances[y][x+1] + 1,
          distances[y+1][x+1] + Math.sqrt(2)
        );
      }
    }
  }
  
  return distances;
}

function extractLevelSet(
  distanceField: number[][],
  width: number,
  height: number,
  targetDistance: number
): boolean[][] {
  // Extract pixels at specific distance (Bordify's level set method)
  const levelSet: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = distanceField[y][x];
      
      // Check if this pixel is at the target distance (with tolerance)
      if (Math.abs(distance - targetDistance) <= 0.5) {
        levelSet[y][x] = true;
      }
    }
  }
  
  return levelSet;
}

function traceBordifyContours(
  mask: boolean[][],
  width: number,
  height: number
): ContourPoint[][] {
  // Bordify's chain code contour tracing
  const contours: ContourPoint[][] = [];
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // 8-directional chain code (Bordify standard)
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x] && !visited[y][x]) {
        const contour = traceSingleBordifyContour(mask, visited, x, y, width, height, directions);
        if (contour.length > 8) { // Minimum contour size
          contours.push(contour);
        }
      }
    }
  }
  
  return contours;
}

function traceSingleBordifyContour(
  mask: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
  directions: number[][]
): ContourPoint[] {
  const contour: ContourPoint[] = [];
  let currentX = startX;
  let currentY = startY;
  let directionIndex = 0;
  
  do {
    visited[currentY][currentX] = true;
    contour.push({ x: currentX, y: currentY });
    
    // Find next boundary pixel using Bordify's chain code method
    let found = false;
    for (let i = 0; i < 8; i++) {
      const searchDir = (directionIndex + i) % 8;
      const [dx, dy] = directions[searchDir];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height && 
          mask[nextY][nextX] && !visited[nextY][nextX]) {
        currentX = nextX;
        currentY = nextY;
        directionIndex = (searchDir + 6) % 8; // Turn left (Bordify method)
        found = true;
        break;
      }
    }
    
    if (!found) break;
    
  } while (contour.length < 5000 && (currentX !== startX || currentY !== startY || contour.length < 3));
  
  return contour;
}

function applyBordifySmoothing(contour: ContourPoint[]): ContourPoint[] {
  if (contour.length < 4) return contour;
  
  // Bordify uses B-spline approximation for smooth curves
  const smoothed: ContourPoint[] = [];
  
  for (let i = 0; i < contour.length; i++) {
    const p0 = contour[(i - 1 + contour.length) % contour.length];
    const p1 = contour[i];
    const p2 = contour[(i + 1) % contour.length];
    const p3 = contour[(i + 2) % contour.length];
    
    // Cubic B-spline interpolation (Bordify's smoothing method)
    const t = 0.5; // Interpolation parameter
    const smoothedPoint = {
      x: Math.round(
        (1-t)**3 * p0.x + 
        3*(1-t)**2*t * p1.x + 
        3*(1-t)*t**2 * p2.x + 
        t**3 * p3.x
      ),
      y: Math.round(
        (1-t)**3 * p0.y + 
        3*(1-t)**2*t * p1.y + 
        3*(1-t)*t**2 * p2.y + 
        t**3 * p3.y
      )
    };
    
    smoothed.push(smoothedPoint);
  }
  
  return smoothed;
}

function createVisibilityMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean[][] {
  const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      mask[y][x] = alpha >= threshold;
    }
  }
  
  return mask;
}

function findTightBoundary(
  mask: boolean[][],
  width: number,
  height: number
): ContourPoint[] {
  // Find all edge pixels that border visible content
  const edgePixels: ContourPoint[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x]) {
        // Check if this visible pixel is on the edge
        let isEdge = false;
        
        // Check 8-directional neighbors
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny][nx]) {
              isEdge = true;
              break;
            }
          }
          if (isEdge) break;
        }
        
        if (isEdge) {
          edgePixels.push({ x, y });
        }
      }
    }
  }
  
  // Sort edge pixels to form connected boundary
  return createConnectedBoundary(edgePixels);
}

function createConnectedBoundary(edgePixels: ContourPoint[]): ContourPoint[] {
  if (edgePixels.length === 0) return [];
  
  // Start with leftmost pixel
  let startPixel = edgePixels[0];
  for (const pixel of edgePixels) {
    if (pixel.x < startPixel.x || (pixel.x === startPixel.x && pixel.y < startPixel.y)) {
      startPixel = pixel;
    }
  }
  
  const boundary: ContourPoint[] = [startPixel];
  const remaining = new Set(edgePixels.filter(p => p !== startPixel));
  
  while (remaining.size > 0 && boundary.length < edgePixels.length) {
    const current = boundary[boundary.length - 1];
    let closest: ContourPoint | null = null;
    let minDistance = Infinity;
    
    // Find nearest unvisited edge pixel
    for (const pixel of remaining) {
      const distance = Math.sqrt((pixel.x - current.x) ** 2 + (pixel.y - current.y) ** 2);
      if (distance < minDistance) {
        minDistance = distance;
        closest = pixel;
      }
    }
    
    if (closest && minDistance <= 3) { // Connect nearby pixels
      boundary.push(closest);
      remaining.delete(closest);
    } else {
      break; // No more connected pixels
    }
  }
  
  return boundary;
}

function createSmoothOutline(
  boundary: ContourPoint[],
  offsetPixels: number
): ContourPoint[] {
  if (boundary.length < 3) return boundary;
  
  // Step 1: Apply smoothing to reduce jagged edges
  const smoothed = applySmoothingFilter(boundary);
  
  // Step 2: Apply outward offset
  const offset = applyOutwardOffset(smoothed, offsetPixels);
  
  // Step 3: Final smoothing for cutting machine compatibility
  return applyFinalSmoothing(offset);
}

function applySmoothingFilter(points: ContourPoint[]): ContourPoint[] {
  const smoothed: ContourPoint[] = [];
  const windowSize = 2;
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + points.length) % points.length;
      sumX += points[idx].x;
      sumY += points[idx].y;
      count++;
    }
    
    smoothed.push({
      x: sumX / count,
      y: sumY / count
    });
  }
  
  return smoothed;
}

function applyOutwardOffset(
  points: ContourPoint[],
  offsetPixels: number
): ContourPoint[] {
  const offset: ContourPoint[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    
    // Calculate outward normal vector
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    
    // Normalize vectors
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y) || 1;
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y) || 1;
    
    v1.x /= len1; v1.y /= len1;
    v2.x /= len2; v2.y /= len2;
    
    // Calculate perpendicular vectors (outward normals)
    const n1 = { x: -v1.y, y: v1.x };
    const n2 = { x: -v2.y, y: v2.x };
    
    // Average normal for smooth offset
    const avgNormal = {
      x: (n1.x + n2.x) / 2,
      y: (n1.y + n2.y) / 2
    };
    
    // Normalize average normal
    const avgLen = Math.sqrt(avgNormal.x * avgNormal.x + avgNormal.y * avgNormal.y) || 1;
    avgNormal.x /= avgLen;
    avgNormal.y /= avgLen;
    
    // Apply offset outward
    offset.push({
      x: curr.x + avgNormal.x * offsetPixels,
      y: curr.y + avgNormal.y * offsetPixels
    });
  }
  
  return offset;
}

function applyFinalSmoothing(points: ContourPoint[]): ContourPoint[] {
  // Apply Bezier-like smoothing for cutting machine optimization
  const finalSmoothed: ContourPoint[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    
    // Catmull-Rom spline interpolation for smooth curves
    const smoothed = {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * 0.5 + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * 0.25),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * 0.5 + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * 0.25)
    };
    
    finalSmoothed.push({
      x: Math.round(smoothed.x),
      y: Math.round(smoothed.y)
    });
  }
  
  return finalSmoothed;
}

function ensureClosedPath(points: ContourPoint[]): ContourPoint[] {
  if (points.length < 3) return points;
  
  // Ensure path is closed by connecting last point to first
  const first = points[0];
  const last = points[points.length - 1];
  
  if (Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2) > 2) {
    // Add closing point if needed
    return [...points, first];
  }
  
  return points;
}

function rasterToVectorConversion(image: HTMLImageElement, threshold: number): ContourPoint[][] {
  // Convert raster to vector using Potrace-like algorithm
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Step 1: Create binary bitmap
  const bitmap = createBinaryBitmap(data, width, height, threshold);
  
  // Step 2: Find connected components (like Flexi does)
  const components = findConnectedComponents(bitmap, width, height);
  
  // Step 3: Convert each component to smooth vector paths
  return components.map(component => componentToVectorPath(component, width, height));
}

function createBinaryBitmap(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean[][] {
  const bitmap: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      bitmap[y][x] = alpha >= threshold;
    }
  }
  
  return bitmap;
}

function findConnectedComponents(
  bitmap: boolean[][],
  width: number,
  height: number
): Array<Array<{x: number, y: number}>> {
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  const components: Array<Array<{x: number, y: number}>> = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[y][x] && !visited[y][x]) {
        const component = floodFillComponent(bitmap, visited, x, y, width, height);
        if (component.length > 50) { // Minimum component size
          components.push(component);
        }
      }
    }
  }
  
  return components;
}

function floodFillComponent(
  bitmap: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number
): Array<{x: number, y: number}> {
  const component: Array<{x: number, y: number}> = [];
  const stack: Array<{x: number, y: number}> = [{x: startX, y: startY}];
  
  while (stack.length > 0) {
    const {x, y} = stack.pop()!;
    
    if (x < 0 || x >= width || y < 0 || y >= height || visited[y][x] || !bitmap[y][x]) {
      continue;
    }
    
    visited[y][x] = true;
    component.push({x, y});
    
    // 4-connected neighbors
    stack.push({x: x + 1, y});
    stack.push({x: x - 1, y});
    stack.push({x, y: y + 1});
    stack.push({x, y: y - 1});
  }
  
  return component;
}

function componentToVectorPath(
  component: Array<{x: number, y: number}>,
  width: number,
  height: number
): ContourPoint[] {
  if (component.length === 0) return [];
  
  // Find boundary pixels of the component
  const boundaryPixels = findComponentBoundary(component, width, height);
  
  // Convert boundary to smooth vector path using Bezier approximation
  return boundaryToSmoothPath(boundaryPixels);
}

function findComponentBoundary(
  component: Array<{x: number, y: number}>,
  width: number,
  height: number
): ContourPoint[] {
  const componentSet = new Set(component.map(p => `${p.x},${p.y}`));
  const boundary: ContourPoint[] = [];
  
  for (const pixel of component) {
    const {x, y} = pixel;
    
    // Check if this pixel is on the boundary (has at least one non-component neighbor)
    let isBoundary = false;
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || 
          !componentSet.has(`${nx},${ny}`)) {
        isBoundary = true;
        break;
      }
    }
    
    if (isBoundary) {
      boundary.push({x, y});
    }
  }
  
  // Sort boundary pixels to form a connected path
  return sortBoundaryPixels(boundary);
}

function sortBoundaryPixels(boundary: ContourPoint[]): ContourPoint[] {
  if (boundary.length === 0) return [];
  
  const sorted: ContourPoint[] = [boundary[0]];
  const remaining = new Set(boundary.slice(1));
  
  while (remaining.size > 0) {
    const current = sorted[sorted.length - 1];
    let closest: ContourPoint | null = null;
    let minDistance = Infinity;
    
    for (const pixel of remaining) {
      const distance = Math.sqrt((pixel.x - current.x) ** 2 + (pixel.y - current.y) ** 2);
      if (distance < minDistance) {
        minDistance = distance;
        closest = pixel;
      }
    }
    
    if (closest && minDistance <= 2) { // Only connect nearby pixels
      sorted.push(closest);
      remaining.delete(closest);
    } else {
      break; // No more connected pixels
    }
  }
  
  return sorted;
}

function boundaryToSmoothPath(boundary: ContourPoint[]): ContourPoint[] {
  if (boundary.length < 3) return boundary;
  
  // Apply smoothing using moving average
  const smoothed: ContourPoint[] = [];
  const windowSize = 3;
  
  for (let i = 0; i < boundary.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + boundary.length) % boundary.length;
      sumX += boundary[idx].x;
      sumY += boundary[idx].y;
      count++;
    }
    
    smoothed.push({
      x: Math.round(sumX / count),
      y: Math.round(sumY / count)
    });
  }
  
  return smoothed;
}

function applyVectorOutlineOffset(path: ContourPoint[], offset: number): ContourPoint[] {
  if (path.length < 3) return path;
  
  const offsetPath: ContourPoint[] = [];
  
  for (let i = 0; i < path.length; i++) {
    const prev = path[(i - 1 + path.length) % path.length];
    const curr = path[i];
    const next = path[(i + 1) % path.length];
    
    // Calculate outward normal vector
    const v1 = {x: curr.x - prev.x, y: curr.y - prev.y};
    const v2 = {x: next.x - curr.x, y: next.y - curr.y};
    
    // Normalize vectors
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y) || 1;
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y) || 1;
    
    v1.x /= len1; v1.y /= len1;
    v2.x /= len2; v2.y /= len2;
    
    // Calculate perpendicular (outward normal)
    const n1 = {x: -v1.y, y: v1.x};
    const n2 = {x: -v2.y, y: v2.x};
    
    // Average normal
    const avgNormal = {
      x: (n1.x + n2.x) / 2,
      y: (n1.y + n2.y) / 2
    };
    
    // Normalize
    const avgLen = Math.sqrt(avgNormal.x * avgNormal.x + avgNormal.y * avgNormal.y) || 1;
    avgNormal.x /= avgLen;
    avgNormal.y /= avgLen;
    
    // Apply offset
    offsetPath.push({
      x: Math.round(curr.x + avgNormal.x * offset),
      y: Math.round(curr.y + avgNormal.y * offset)
    });
  }
  
  return offsetPath;
}

function extractVectorHoles(
  image: HTMLImageElement,
  threshold: number,
  holeMargin: number
): ContourPoint[][] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;
  
  // Find holes (transparent regions surrounded by solid content)
  const holes = findVectorHoles(data, width, height, threshold);
  
  // Convert holes to vector paths with inward margin
  return holes.map(hole => applyVectorOutlineOffset(hole, -holeMargin));
}

function findVectorHoles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): ContourPoint[][] {
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  const holes: ContourPoint[][] = [];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      if (alpha < threshold && !visited[y][x]) {
        const region = floodFillTransparentRegion(data, visited, x, y, width, height, threshold);
        
        if (isInteriorHole(region, data, width, height, threshold)) {
          const holeBoundary = findHoleBoundary(region, data, width, height, threshold);
          if (holeBoundary.length > 6) {
            holes.push(holeBoundary);
          }
        }
      }
    }
  }
  
  return holes;
}

function floodFillTransparentRegion(
  data: Uint8ClampedArray,
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
  threshold: number
): Array<{x: number, y: number}> {
  const region: Array<{x: number, y: number}> = [];
  const stack: Array<{x: number, y: number}> = [{x: startX, y: startY}];
  
  while (stack.length > 0) {
    const {x, y} = stack.pop()!;
    
    if (x < 0 || x >= width || y < 0 || y >= height || visited[y][x]) {
      continue;
    }
    
    const idx = (y * width + x) * 4;
    const alpha = data[idx + 3];
    
    if (alpha >= threshold) {
      continue; // Hit solid pixel
    }
    
    visited[y][x] = true;
    region.push({x, y});
    
    // Continue flood fill
    stack.push({x: x + 1, y});
    stack.push({x: x - 1, y});
    stack.push({x, y: y + 1});
    stack.push({x, y: y - 1});
  }
  
  return region;
}

function isInteriorHole(
  region: Array<{x: number, y: number}>,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): boolean {
  // Check if region touches image boundaries
  for (const {x, y} of region) {
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      return false;
    }
  }
  
  // Check if region is surrounded by solid content
  let perimeterSolidCount = 0;
  let perimeterTotal = 0;
  
  for (const {x, y} of region) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = (ny * width + nx) * 4;
          const nAlpha = data[nIdx + 3];
          perimeterTotal++;
          if (nAlpha >= threshold) perimeterSolidCount++;
        }
      }
    }
  }
  
  return perimeterSolidCount / perimeterTotal > 0.7; // 70% solid perimeter
}

function findHoleBoundary(
  region: Array<{x: number, y: number}>,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): ContourPoint[] {
  const regionSet = new Set(region.map(p => `${p.x},${p.y}`));
  const boundary: ContourPoint[] = [];
  
  for (const {x, y} of region) {
    let isBoundary = false;
    
    // Check 4-connected neighbors
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = (ny * width + nx) * 4;
        const nAlpha = data[nIdx + 3];
        
        if (nAlpha >= threshold || !regionSet.has(`${nx},${ny}`)) {
          isBoundary = true;
          break;
        }
      }
    }
    
    if (isBoundary) {
      boundary.push({x, y});
    }
  }
  
  return sortBoundaryPixels(boundary);
}

function optimizeVectorPath(path: ContourPoint[]): ContourPoint[] {
  if (path.length <= 2) return path;
  
  // Apply Douglas-Peucker simplification with higher tolerance
  let simplified = douglasPeuckerSimplify(path, 2.0);
  
  // Ensure minimum point count for smooth curves
  if (simplified.length < 8 && path.length >= 8) {
    simplified = douglasPeuckerSimplify(path, 1.0);
  }
  
  return simplified;
}

function drawWhiteFilledContour(
  ctx: CanvasRenderingContext2D,
  contourPaths: ContourPoint[][],
  offsetX: number,
  offsetY: number
): void {
  if (!contourPaths || contourPaths.length === 0) return;
  
  ctx.fillStyle = '#FFFFFF';
  
  for (const path of contourPaths) {
    if (!path || path.length < 3) continue;
    
    ctx.beginPath();
    ctx.moveTo(path[0].x + offsetX, path[0].y + offsetY);
    
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x + offsetX, path[i].y + offsetY);
    }
    
    ctx.closePath();
    ctx.fill();
  }
}

function createOuterEdgeMask(
  data: Uint8ClampedArray, 
  width: number, 
  height: number, 
  threshold: number
): boolean[][] {
  const edgeMask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Create alpha mask
  const alphaMask: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      alphaMask[y][x] = data[idx + 3];
    }
  }
  
  // Find only the outermost edges - pixels that are solid and border transparency or image boundary
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const currentAlpha = alphaMask[y][x];
      
      if (currentAlpha >= threshold) {
        let isOuterEdge = false;
        
        // Check if this pixel is on the image boundary
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          isOuterEdge = true;
        } else {
          // Check 8-directional neighbors for transparency
          for (let dy = -1; dy <= 1 && !isOuterEdge; dy++) {
            for (let dx = -1; dx <= 1 && !isOuterEdge; dx++) {
              if (dx === 0 && dy === 0) continue;
              const neighborAlpha = alphaMask[y + dy][x + dx];
              if (neighborAlpha < threshold) {
                isOuterEdge = true;
              }
            }
          }
        }
        
        edgeMask[y][x] = isOuterEdge;
      }
    }
  }
  
  return edgeMask;
}

function createHoleEdgeMask(
  data: Uint8ClampedArray, 
  width: number, 
  height: number, 
  threshold: number,
  holeMargin: number
): boolean[][] {
  const holeEdges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Create alpha mask
  const alphaMask: number[][] = Array(height).fill(null).map(() => Array(width).fill(0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      alphaMask[y][x] = data[idx + 3];
    }
  }
  
  // Find interior holes only - transparent pixels completely surrounded by solid content
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const currentAlpha = alphaMask[y][x];
      
      if (currentAlpha < threshold) {
        // Check if this transparent pixel is truly inside the design (surrounded by solid content)
        let solidCount = 0;
        const checkRadius = Math.max(3, Math.floor(holeMargin * 3));
        let totalChecked = 0;
        
        for (let dy = -checkRadius; dy <= checkRadius; dy++) {
          for (let dx = -checkRadius; dx <= checkRadius; dx++) {
            const checkY = y + dy;
            const checkX = x + dx;
            if (checkY >= 0 && checkY < height && checkX >= 0 && checkX < width) {
              totalChecked++;
              if (alphaMask[checkY][checkX] >= threshold) {
                solidCount++;
              }
            }
          }
        }
        
        // Only mark as hole edge if mostly surrounded by solid content
        if (solidCount > totalChecked * 0.6) {
          // Check immediate neighbors to confirm this is an edge of the hole
          let hasSolidNeighbor = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (alphaMask[y + dy][x + dx] >= threshold) {
                hasSolidNeighbor = true;
                break;
              }
            }
            if (hasSolidNeighbor) break;
          }
          
          holeEdges[y][x] = hasSolidNeighbor;
        }
      }
    }
  }
  
  return holeEdges;
}

function traceMainContour(edgeMask: boolean[][], width: number, height: number): ContourPoint[][] {
  const contours: ContourPoint[][] = [];
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Find the largest/main contour (outermost boundary)
  let largestContour: ContourPoint[] = [];
  let largestSize = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edgeMask[y][x] && !visited[y][x]) {
        const contour = traceContourFromPoint(edgeMask, visited, x, y, width, height);
        if (contour.length > largestSize) {
          largestSize = contour.length;
          largestContour = contour;
        }
      }
    }
  }
  
  // Only return the main outer contour
  if (largestContour.length > 20) {
    contours.push(largestContour);
  }
  
  return contours;
}

function traceImageContours(edgeMask: boolean[][], width: number, height: number): ContourPoint[][] {
  const contours: ContourPoint[][] = [];
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Find all contour starting points (used for holes)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (edgeMask[y][x] && !visited[y][x]) {
        const contour = traceContourFromPoint(edgeMask, visited, x, y, width, height);
        if (contour.length > 10) { // Minimum contour size
          contours.push(contour);
        }
      }
    }
  }
  
  return contours;
}

function traceContourFromPoint(
  edgeMask: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number
): ContourPoint[] {
  const contour: ContourPoint[] = [];
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  
  let x = startX;
  let y = startY;
  let dirIndex = 0;
  const maxPoints = Math.min(width * height, 2000); // Reduced for performance
  
  try {
    do {
      if (y >= 0 && y < height && x >= 0 && x < width) {
        visited[y][x] = true;
        contour.push({ x, y });
      }
      
      // Find next edge point
      let found = false;
      for (let i = 0; i < 8; i++) {
        const checkDir = (dirIndex + i) % 8;
        const [dx, dy] = directions[checkDir];
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
            edgeMask[ny][nx] && !visited[ny][nx]) {
          x = nx;
          y = ny;
          dirIndex = checkDir;
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Try to find any nearby unvisited edge point
        for (let radius = 1; radius <= 2 && !found; radius++) {
          for (let dy = -radius; dy <= radius && !found; dy++) {
            for (let dx = -radius; dx <= radius && !found; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
                  edgeMask[ny][nx] && !visited[ny][nx]) {
                x = nx;
                y = ny;
                found = true;
              }
            }
          }
        }
      }
      
      if (!found) break;
      
    } while (contour.length < maxPoints && 
             (Math.abs(x - startX) > 1 || Math.abs(y - startY) > 1 || contour.length < 3));
  } catch (error) {
    console.error('Error tracing contour:', error);
  }
  
  return contour;
}

function smoothContourPath(path: ContourPoint[], smoothing: number): ContourPoint[] {
  if (path.length < 3 || smoothing <= 0) return path;
  
  const smoothed: ContourPoint[] = [];
  const windowSize = Math.max(1, Math.floor(smoothing));
  
  for (let i = 0; i < path.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + path.length) % path.length;
      sumX += path[idx].x;
      sumY += path[idx].y;
      count++;
    }
    
    smoothed.push({
      x: Math.round(sumX / count),
      y: Math.round(sumY / count)
    });
  }
  
  return smoothed;
}

function applyFlexiHoleMargins(holeContours: ContourPoint[][], margin: number): ContourPoint[][] {
  // Flexi Auto Contour applies inward offset to holes for proper cutting clearance
  return holeContours.map(contour => {
    if (contour.length < 3) return contour;
    
    const adjustedContour: ContourPoint[] = [];
    const marginPixels = Math.max(1, Math.floor(margin));
    
    for (let i = 0; i < contour.length; i++) {
      const prev = contour[(i - 1 + contour.length) % contour.length];
      const curr = contour[i];
      const next = contour[(i + 1) % contour.length];
      
      // Calculate inward normal vector for hole contour
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (len1 > 0 && len2 > 0) {
        // Normalize and average the edge vectors
        const nx1 = -dy1 / len1; // Perpendicular (inward for holes)
        const ny1 = dx1 / len1;
        
        const nx2 = -dy2 / len2;
        const ny2 = dx2 / len2;
        
        // Average normal direction
        let avgNx = (nx1 + nx2) / 2;
        let avgNy = (ny1 + ny2) / 2;
        const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy);
        
        if (avgLen > 0) {
          avgNx /= avgLen;
          avgNy /= avgLen;
          
          // Apply Flexi Auto Contour style inward margin
          adjustedContour.push({
            x: Math.round(curr.x + avgNx * marginPixels),
            y: Math.round(curr.y + avgNy * marginPixels)
          });
        } else {
          adjustedContour.push(curr);
        }
      } else {
        adjustedContour.push(curr);
      }
    }
    
    return adjustedContour.length > 2 ? adjustedContour : contour;
  }).filter(contour => contour.length > 2);
}

function drawTrueContourStroke(
  ctx: CanvasRenderingContext2D,
  contourPaths: ContourPoint[][],
  strokeSettings: StrokeSettings,
  offsetX: number,
  offsetY: number
): void {
  if (contourPaths.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = strokeSettings.color;
  ctx.lineWidth = strokeSettings.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw multiple passes for solid stroke
  for (let pass = 0; pass < 2; pass++) {
    for (const path of contourPaths) {
      if (path.length < 2) continue;
      
      ctx.beginPath();
      
      const firstPoint = path[0];
      ctx.moveTo(firstPoint.x + offsetX, firstPoint.y + offsetY);
      
      for (let i = 1; i < path.length; i++) {
        const point = path[i];
        ctx.lineTo(point.x + offsetX, point.y + offsetY);
      }
      
      // Close the path if it's a complete contour
      if (path.length > 10) {
        ctx.closePath();
      }
      
      ctx.stroke();
    }
  }
  
  ctx.restore();
}