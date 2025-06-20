import { StrokeSettings } from "@/components/image-editor";

export interface TrueContourOptions {
  strokeSettings: StrokeSettings;
  threshold: number;
  smoothing: number;
  includeHoles: boolean;
  holeMargin: number;
  fillHoles: boolean;
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
    const { strokeSettings, threshold = 128, smoothing = 1, includeHoles = false, holeMargin = 0.5, fillHoles = false } = options;
    
    const padding = strokeSettings.width * 2;
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    
    const imageX = padding;
    const imageY = padding;
    
    // Fill holes with white background if requested
    if (fillHoles) {
      const processedImage = fillTransparentHoles(image, threshold);
      ctx.drawImage(processedImage, imageX, imageY);
    } else {
      ctx.drawImage(image, imageX, imageY);
    }
    
    if (strokeSettings.enabled) {
      // Generate true contour paths following the actual image edges
      const sourceImage = fillHoles ? fillTransparentHoles(image, threshold) : image;
      const contourPaths = generateTrueContourPaths(sourceImage, threshold, smoothing, includeHoles, holeMargin);
      
      // Draw the contour stroke
      drawTrueContourStroke(ctx, contourPaths, strokeSettings, imageX, imageY);
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
  
  // Fill interior holes with white
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const currentAlpha = data[idx + 3];
      
      if (currentAlpha < threshold) {
        // Check if this transparent pixel is surrounded by solid content (interior hole)
        let solidCount = 0;
        const checkRadius = 3;
        let totalChecked = 0;
        
        for (let dy = -checkRadius; dy <= checkRadius; dy++) {
          for (let dx = -checkRadius; dx <= checkRadius; dx++) {
            const checkY = y + dy;
            const checkX = x + dx;
            if (checkY >= 0 && checkY < height && checkX >= 0 && checkX < width) {
              totalChecked++;
              const checkIdx = (checkY * width + checkX) * 4;
              if (data[checkIdx + 3] >= threshold) {
                solidCount++;
              }
            }
          }
        }
        
        // If mostly surrounded by solid content, fill with white
        if (solidCount > totalChecked * 0.5) {
          filledData[idx] = 255;     // R
          filledData[idx + 1] = 255; // G
          filledData[idx + 2] = 255; // B
          filledData[idx + 3] = 255; // A
        }
      }
    }
  }
  
  // Create new image data and draw it
  const filledImageData = new ImageData(filledData, width, height);
  ctx.putImageData(filledImageData, 0, 0);
  
  return canvas;
}

function generateTrueContourPaths(
  image: HTMLImageElement,
  threshold: number,
  smoothing: number,
  includeHoles: boolean,
  holeMargin: number
): ContourPoint[][] {
  try {
    // Extract image data
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return [];
    
    tempCanvas.width = image.width;
    tempCanvas.height = image.height;
    tempCtx.drawImage(image, 0, 0);
    
    const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
    const { data, width, height } = imageData;
    
    // Create edge mask for outer boundaries only
    const outerEdges = createOuterEdgeMask(data, width, height, threshold);
    
    // Trace only the main outer contour
    const outerContours = traceMainContour(outerEdges, width, height);
    
    // Only add hole contours if specifically requested
    let holeContours: ContourPoint[][] = [];
    if (includeHoles) {
      const holeEdges = createHoleEdgeMask(data, width, height, threshold, holeMargin);
      const rawHoleContours = traceImageContours(holeEdges, width, height);
      holeContours = applyFlexiHoleMargins(rawHoleContours, holeMargin);
    }
    
    // Combine contours - outer boundary plus optional holes
    const contours = [...outerContours, ...holeContours];
    
    // Smooth the paths if requested
    return contours.map(contour => 
      smoothing > 0 ? smoothContourPath(contour, smoothing) : contour
    ).filter(path => path.length > 3);
  } catch (error) {
    console.error('Error generating true contour paths:', error);
    return [];
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