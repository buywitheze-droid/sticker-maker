import { ShapeSettings } from "@/components/image-editor";

export interface TracedDesign {
  paths: Path2D[];
  bounds: { x: number; y: number; width: number; height: number };
  isWithinBounds: boolean;
  overlapAreas: { x: number; y: number; width: number; height: number }[];
}

export interface VectorPath {
  points: { x: number; y: number }[];
  closed: boolean;
}

export function traceDesignToVector(
  image: HTMLImageElement,
  threshold: number = 128
): VectorPath[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  canvas.width = image.width;
  canvas.height = image.height;
  
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  return findVectorContours(imageData, threshold);
}

function findVectorContours(imageData: ImageData, threshold: number): VectorPath[] {
  const { data, width, height } = imageData;
  const visited = new Array(width * height).fill(false);
  const paths: VectorPath[] = [];
  
  // Find edge pixels using alpha channel
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      // Check if this is an edge pixel (has alpha > threshold and at least one transparent neighbor)
      if (alpha > threshold && !visited[y * width + x]) {
        if (isEdgePixel(data, x, y, width, height, threshold)) {
          const path = traceContourPath(data, x, y, width, height, threshold, visited);
          if (path.points.length > 3) {
            paths.push(path);
          }
        }
      }
    }
  }
  
  return paths;
}

function isEdgePixel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number
): boolean {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  for (const [dx, dy] of directions) {
    const nx = x + dx;
    const ny = y + dy;
    
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const nIdx = (ny * width + nx) * 4;
      if (data[nIdx + 3] <= threshold) {
        return true; // Has at least one transparent neighbor
      }
    }
  }
  
  return false;
}

function traceContourPath(
  data: Uint8ClampedArray,
  startX: number,
  startY: number,
  width: number,
  height: number,
  threshold: number,
  visited: boolean[]
): VectorPath {
  const points: { x: number; y: number }[] = [];
  const directions = [
    [0, -1],  // up
    [1, 0],   // right
    [0, 1],   // down
    [-1, 0]   // left
  ];
  
  let currentX = startX;
  let currentY = startY;
  let currentDir = 0;
  
  do {
    points.push({ x: currentX, y: currentY });
    visited[currentY * width + currentX] = true;
    
    // Find next edge pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dir = (currentDir + i) % 4;
      const [dx, dy] = directions[dir];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        const idx = (nextY * width + nextX) * 4;
        if (data[idx + 3] > threshold && isEdgePixel(data, nextX, nextY, width, height, threshold)) {
          currentX = nextX;
          currentY = nextY;
          currentDir = dir;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    
  } while (currentX !== startX || currentY !== startY);
  
  return {
    points: simplifyPath(points, 2),
    closed: true
  };
}

function simplifyPath(points: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  
  // Douglas-Peucker algorithm
  const simplified = [points[0]];
  simplifyRecursive(points, 0, points.length - 1, tolerance, simplified);
  simplified.push(points[points.length - 1]);
  
  return simplified;
}

function simplifyRecursive(
  points: { x: number; y: number }[],
  start: number,
  end: number,
  tolerance: number,
  result: { x: number; y: number }[]
): void {
  let maxDistance = 0;
  let maxIndex = start;
  
  for (let i = start + 1; i < end; i++) {
    const distance = distanceToLine(points[i], points[start], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  if (maxDistance > tolerance) {
    simplifyRecursive(points, start, maxIndex, tolerance, result);
    result.push(points[maxIndex]);
    simplifyRecursive(points, maxIndex, end, tolerance, result);
  }
}

function distanceToLine(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    return Math.sqrt(A * A + B * B);
  }
  
  const param = dot / lenSq;
  let xx, yy;
  
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }
  
  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function checkDesignBounds(
  vectorPaths: VectorPath[],
  imageWidth: number,
  imageHeight: number,
  shapeSettings: ShapeSettings,
  shapeWidth: number,
  shapeHeight: number
): TracedDesign {
  // Calculate design bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  for (const path of vectorPaths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  
  const designBounds = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
  
  // Check if design fits within shape bounds
  const shapeBounds = getShapeBounds(shapeSettings, shapeWidth, shapeHeight);
  const isWithinBounds = checkBoundsOverlap(designBounds, shapeBounds);
  
  // Find overlap areas if design extends beyond bounds
  const overlapAreas = findOverlapAreas(vectorPaths, shapeBounds, shapeSettings);
  
  // Convert vector paths to Path2D objects
  const paths = vectorPaths.map(vectorPath => {
    const path = new Path2D();
    if (vectorPath.points.length > 0) {
      path.moveTo(vectorPath.points[0].x, vectorPath.points[0].y);
      for (let i = 1; i < vectorPath.points.length; i++) {
        path.lineTo(vectorPath.points[i].x, vectorPath.points[i].y);
      }
      if (vectorPath.closed) {
        path.closePath();
      }
    }
    return path;
  });
  
  return {
    paths,
    bounds: designBounds,
    isWithinBounds,
    overlapAreas
  };
}

function getShapeBounds(
  shapeSettings: ShapeSettings,
  shapeWidth: number,
  shapeHeight: number
): { x: number; y: number; width: number; height: number } {
  const centerX = shapeWidth / 2;
  const centerY = shapeHeight / 2;
  
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(shapeWidth, shapeHeight) / 2;
    return {
      x: centerX - radius,
      y: centerY - radius,
      width: radius * 2,
      height: radius * 2
    };
  } else if (shapeSettings.type === 'oval') {
    return {
      x: 0,
      y: 0,
      width: shapeWidth,
      height: shapeHeight
    };
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(shapeWidth, shapeHeight);
    return {
      x: centerX - size / 2,
      y: centerY - size / 2,
      width: size,
      height: size
    };
  } else { // rectangle
    return {
      x: 0,
      y: 0,
      width: shapeWidth,
      height: shapeHeight
    };
  }
}

function checkBoundsOverlap(
  designBounds: { x: number; y: number; width: number; height: number },
  shapeBounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    designBounds.x >= shapeBounds.x &&
    designBounds.y >= shapeBounds.y &&
    designBounds.x + designBounds.width <= shapeBounds.x + shapeBounds.width &&
    designBounds.y + designBounds.height <= shapeBounds.y + shapeBounds.height
  );
}

function findOverlapAreas(
  vectorPaths: VectorPath[],
  shapeBounds: { x: number; y: number; width: number; height: number },
  shapeSettings: ShapeSettings
): { x: number; y: number; width: number; height: number }[] {
  const overlapAreas: { x: number; y: number; width: number; height: number }[] = [];
  
  for (const path of vectorPaths) {
    for (const point of path.points) {
      if (!isPointInShape(point, shapeBounds, shapeSettings)) {
        // Find the bounding box of the overlapping segment
        const overlapArea = {
          x: Math.max(0, Math.min(point.x - 5, shapeBounds.x + shapeBounds.width)),
          y: Math.max(0, Math.min(point.y - 5, shapeBounds.y + shapeBounds.height)),
          width: 10,
          height: 10
        };
        overlapAreas.push(overlapArea);
      }
    }
  }
  
  return mergeOverlapAreas(overlapAreas);
}

function isPointInShape(
  point: { x: number; y: number },
  shapeBounds: { x: number; y: number; width: number; height: number },
  shapeSettings: ShapeSettings
): boolean {
  const centerX = shapeBounds.x + shapeBounds.width / 2;
  const centerY = shapeBounds.y + shapeBounds.height / 2;
  
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(shapeBounds.width, shapeBounds.height) / 2;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return (dx * dx + dy * dy) <= (radius * radius);
  } else if (shapeSettings.type === 'oval') {
    const radiusX = shapeBounds.width / 2;
    const radiusY = shapeBounds.height / 2;
    const dx = (point.x - centerX) / radiusX;
    const dy = (point.y - centerY) / radiusY;
    return (dx * dx + dy * dy) <= 1;
  } else {
    // Rectangle or square
    return (
      point.x >= shapeBounds.x &&
      point.x <= shapeBounds.x + shapeBounds.width &&
      point.y >= shapeBounds.y &&
      point.y <= shapeBounds.y + shapeBounds.height
    );
  }
}

function mergeOverlapAreas(
  areas: { x: number; y: number; width: number; height: number }[]
): { x: number; y: number; width: number; height: number }[] {
  if (areas.length <= 1) return areas;
  
  const merged: { x: number; y: number; width: number; height: number }[] = [];
  const sorted = areas.sort((a, b) => a.x - b.x || a.y - b.y);
  
  let current = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Check if areas overlap or are adjacent
    if (
      current.x + current.width >= next.x - 5 &&
      current.y + current.height >= next.y - 5
    ) {
      // Merge areas
      const newX = Math.min(current.x, next.x);
      const newY = Math.min(current.y, next.y);
      const newWidth = Math.max(current.x + current.width, next.x + next.width) - newX;
      const newHeight = Math.max(current.y + current.height, next.y + next.height) - newY;
      
      current = { x: newX, y: newY, width: newWidth, height: newHeight };
    } else {
      merged.push(current);
      current = next;
    }
  }
  
  merged.push(current);
  return merged;
}

export function clipDesignToShape(
  ctx: CanvasRenderingContext2D,
  shapeSettings: ShapeSettings,
  shapeWidth: number,
  shapeHeight: number
): void {
  const centerX = shapeWidth / 2;
  const centerY = shapeHeight / 2;
  
  ctx.save();
  ctx.beginPath();
  
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(shapeWidth, shapeHeight) / 2;
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  } else if (shapeSettings.type === 'oval') {
    ctx.ellipse(centerX, centerY, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(shapeWidth, shapeHeight);
    const startX = centerX - size / 2;
    const startY = centerY - size / 2;
    ctx.rect(startX, startY, size, size);
  } else { // rectangle
    ctx.rect(0, 0, shapeWidth, shapeHeight);
  }
  
  ctx.clip();
}