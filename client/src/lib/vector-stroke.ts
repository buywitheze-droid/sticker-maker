import { StrokeSettings } from "@/components/image-editor";
import jsPDF from 'jspdf';

export interface VectorStrokeOptions {
  strokeSettings: StrokeSettings;
  exportCutContour?: boolean;
  vectorQuality?: 'high' | 'medium' | 'low';
}

export type VectorFormat = 'png' | 'pdf' | 'eps' | 'svg';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

export function createVectorStroke(
  image: HTMLImageElement,
  options: VectorStrokeOptions
): HTMLCanvasElement {
  const { strokeSettings, exportCutContour = false, vectorQuality = 'medium' } = options;
  
  // Create canvas for vector-quality processing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  // Use more reasonable scaling to prevent crashes
  const scaleFactor = vectorQuality === 'high' ? 2 : vectorQuality === 'medium' ? 1.5 : 1;
  const strokeWidth = Math.ceil(strokeSettings.width * scaleFactor);
  
  canvas.width = Math.ceil((image.width + strokeWidth * 2) * scaleFactor);
  canvas.height = Math.ceil((image.height + strokeWidth * 2) * scaleFactor);
  
  // Limit canvas size to prevent crashes
  const maxSize = 4096;
  if (canvas.width > maxSize || canvas.height > maxSize) {
    const scale = Math.min(maxSize / canvas.width, maxSize / canvas.height);
    canvas.width = Math.ceil(canvas.width * scale);
    canvas.height = Math.ceil(canvas.height * scale);
  }
  
  // Enable high-quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  if (strokeSettings.enabled && strokeWidth > 0) {
    // Use optimized shadow-based approach for better performance
    ctx.save();
    
    // Set up shadow properties for clean outline
    ctx.shadowColor = exportCutContour ? '#FF00FF' : strokeSettings.color; // Magenta for CutContour
    ctx.shadowBlur = 0;
    
    // Draw multiple shadows in a circle pattern for solid outline
    const steps = Math.min(16, Math.max(8, strokeWidth));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.shadowOffsetX = Math.cos(angle) * strokeWidth;
      ctx.shadowOffsetY = Math.sin(angle) * strokeWidth;
      
      ctx.drawImage(
        image,
        strokeWidth,
        strokeWidth,
        canvas.width - strokeWidth * 2,
        canvas.height - strokeWidth * 2
      );
    }
    
    ctx.restore();
    
    // If not CutContour, draw original image on top
    if (!exportCutContour) {
      ctx.drawImage(
        image,
        strokeWidth,
        strokeWidth,
        canvas.width - strokeWidth * 2,
        canvas.height - strokeWidth * 2
      );
    }
  } else {
    // Just draw the image if no stroke
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  
  return canvas;
}

function createDistanceField(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxDistance: number
): Float32Array {
  const distanceField = new Float32Array(width * height);
  
  // Initialize distance field
  for (let i = 0; i < distanceField.length; i++) {
    const pixelIndex = i * 4;
    const alpha = data[pixelIndex + 3];
    distanceField[i] = alpha > 128 ? 0 : Infinity;
  }
  
  // Use Euclidean distance transform for precise vector edges
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      
      if (distanceField[index] === 0) {
        // This is an opaque pixel, calculate distances to nearby pixels
        const minX = Math.max(0, x - maxDistance);
        const maxX = Math.min(width - 1, x + maxDistance);
        const minY = Math.max(0, y - maxDistance);
        const maxY = Math.min(height - 1, y + maxDistance);
        
        for (let ny = minY; ny <= maxY; ny++) {
          for (let nx = minX; nx <= maxX; nx++) {
            const nIndex = ny * width + nx;
            const dx = nx - x;
            const dy = ny - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= maxDistance) {
              distanceField[nIndex] = Math.min(distanceField[nIndex], distance);
            }
          }
        }
      }
    }
  }
  
  return distanceField;
}

export function createVectorPaths(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  exportCutContour: boolean = false
): { paths: string[], bounds: { width: number; height: number } } {
  // Create a high-resolution canvas for path tracing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { paths: [], bounds: { width: 0, height: 0 } };
  
  const strokeWidth = strokeSettings.width;
  canvas.width = image.width + strokeWidth * 2;
  canvas.height = image.height + strokeWidth * 2;
  
  // Draw the stroke outline
  if (strokeSettings.enabled && strokeWidth > 0) {
    ctx.save();
    ctx.shadowColor = exportCutContour ? '#FF00FF' : strokeSettings.color;
    ctx.shadowBlur = 0;
    
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.shadowOffsetX = Math.cos(angle) * strokeWidth;
      ctx.shadowOffsetY = Math.sin(angle) * strokeWidth;
      ctx.drawImage(image, strokeWidth, strokeWidth);
    }
    
    ctx.restore();
    
    if (!exportCutContour) {
      ctx.drawImage(image, strokeWidth, strokeWidth);
    }
  }
  
  // Get image data and trace edges to create vector paths
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const paths = traceImageToPath(imageData);
  
  return {
    paths,
    bounds: { width: canvas.width, height: canvas.height }
  };
}

function traceImageToPath(imageData: ImageData): string[] {
  const { data, width, height } = imageData;
  const paths: string[] = [];
  const visited = new Set<string>();
  
  // Simple edge detection and path tracing
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      
      if (alpha > 128) { // Opaque pixel
        // Check if this is an edge pixel
        const neighbors = [
          data[((y-1) * width + x) * 4 + 3],
          data[((y+1) * width + x) * 4 + 3],
          data[(y * width + (x-1)) * 4 + 3],
          data[(y * width + (x+1)) * 4 + 3]
        ];
        
        const hasTransparentNeighbor = neighbors.some(a => a < 128);
        
        if (hasTransparentNeighbor) {
          // This is an edge pixel, start tracing a path
          const path = tracePath(data, width, height, x, y, visited);
          if (path.length > 10) { // Only include substantial paths
            paths.push(path);
          }
        }
      }
    }
  }
  
  return paths;
}

function tracePath(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<string>
): string {
  const path: Array<{x: number, y: number}> = [];
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  let x = startX, y = startY;
  let steps = 0;
  const maxSteps = 1000; // Prevent infinite loops
  
  while (steps < maxSteps) {
    const key = `${x},${y}`;
    if (visited.has(key)) break;
    
    visited.add(key);
    path.push({ x, y });
    
    // Find next edge pixel
    let found = false;
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = (ny * width + nx) * 4;
        const nAlpha = data[nIdx + 3];
        const nKey = `${nx},${ny}`;
        
        if (nAlpha > 128 && !visited.has(nKey)) {
          // Check if it's still an edge
          const neighbors = [
            ny > 0 ? data[((ny-1) * width + nx) * 4 + 3] : 0,
            ny < height-1 ? data[((ny+1) * width + nx) * 4 + 3] : 0,
            nx > 0 ? data[(ny * width + (nx-1)) * 4 + 3] : 0,
            nx < width-1 ? data[(ny * width + (nx+1)) * 4 + 3] : 0
          ];
          
          const hasTransparentNeighbor = neighbors.some(a => a < 128);
          
          if (hasTransparentNeighbor) {
            x = nx;
            y = ny;
            found = true;
            break;
          }
        }
      }
    }
    
    if (!found) break;
    steps++;
  }
  
  // Convert path to SVG path string
  if (path.length < 3) return '';
  
  let pathString = `M ${path[0].x} ${path[0].y}`;
  for (let i = 1; i < path.length; i++) {
    pathString += ` L ${path[i].x} ${path[i].y}`;
  }
  pathString += ' Z';
  
  return pathString;
}

export function downloadVectorStroke(
  canvas: HTMLCanvasElement,
  filename: string,
  format: VectorFormat = 'png',
  vectorPaths?: { paths: string[], bounds: { width: number; height: number } }
): void {
  const baseFilename = filename.replace(/\.[^/.]+$/, "");
  
  switch (format) {
    case 'pdf':
      downloadAsPDF(canvas, vectorPaths, `${baseFilename}.pdf`);
      break;
    case 'eps':
      downloadAsEPS(vectorPaths, `${baseFilename}.eps`);
      break;
    case 'svg':
      downloadAsSVG(vectorPaths, `${baseFilename}.svg`);
      break;
    default:
      // PNG fallback
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseFilename}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/png');
  }
}

function downloadAsPDF(
  canvas: HTMLCanvasElement,
  vectorPaths?: { paths: string[], bounds: { width: number; height: number } },
  filename: string = 'cutcontour.pdf'
): void {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter'
  });
  
  if (vectorPaths && vectorPaths.paths.length > 0) {
    // Add vector paths as true vectors
    const { paths, bounds } = vectorPaths;
    const scale = Math.min(500 / bounds.width, 700 / bounds.height);
    
    // Set stroke color for CutContour (magenta)
    pdf.setDrawColor(255, 0, 255);
    pdf.setLineWidth(1);
    
    // Add each path as a vector shape
    paths.forEach(pathString => {
      const commands = pathString.match(/[MLZ][^MLZ]*/g) || [];
      let currentX = 0, currentY = 0;
      let pathStarted = false;
      
      commands.forEach(command => {
        const type = command[0];
        const coords = command.slice(1).trim().split(/\s+/).map(Number);
        
        switch (type) {
          case 'M':
            currentX = coords[0] * scale;
            currentY = coords[1] * scale;
            pathStarted = true;
            break;
          case 'L':
            if (pathStarted) {
              const newX = coords[0] * scale;
              const newY = coords[1] * scale;
              pdf.line(currentX, currentY, newX, newY);
              currentX = newX;
              currentY = newY;
            }
            break;
        }
      });
    });
  } else {
    // Fallback: embed canvas as image
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 50, 50, canvas.width / 2, canvas.height / 2);
  }
  
  pdf.save(filename);
}

function downloadAsEPS(
  vectorPaths?: { paths: string[], bounds: { width: number; height: number } },
  filename: string = 'cutcontour.eps'
): void {
  if (!vectorPaths || vectorPaths.paths.length === 0) {
    console.warn('No vector paths available for EPS export');
    return;
  }
  
  const { paths, bounds } = vectorPaths;
  
  // Create EPS content
  let epsContent = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 ${bounds.width} ${bounds.height}
%%Creator: Sticker Maker
%%Title: CutContour Outline
%%CreationDate: ${new Date().toISOString()}
%%EndComments

% Set up for cutting (magenta color)
1 0 1 setrgbcolor
1 setlinewidth

`;
  
  // Add each path as PostScript commands
  paths.forEach(pathString => {
    const commands = pathString.match(/[MLZ][^MLZ]*/g) || [];
    
    commands.forEach(command => {
      const type = command[0];
      const coords = command.slice(1).trim().split(/\s+/).map(Number);
      
      switch (type) {
        case 'M':
          epsContent += `${coords[0]} ${bounds.height - coords[1]} moveto\n`;
          break;
        case 'L':
          epsContent += `${coords[0]} ${bounds.height - coords[1]} lineto\n`;
          break;
        case 'Z':
          epsContent += `closepath\n`;
          break;
      }
    });
    
    epsContent += `stroke\n`;
  });
  
  epsContent += `
%%EOF`;
  
  // Download EPS file
  const blob = new Blob([epsContent], { type: 'application/postscript' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadAsSVG(
  vectorPaths?: { paths: string[], bounds: { width: number; height: number } },
  filename: string = 'cutcontour.svg'
): void {
  if (!vectorPaths || vectorPaths.paths.length === 0) {
    console.warn('No vector paths available for SVG export');
    return;
  }
  
  const { paths, bounds } = vectorPaths;
  
  let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
  <g fill="none" stroke="#FF00FF" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">
`;
  
  paths.forEach(pathString => {
    svgContent += `    <path d="${pathString}" />\n`;
  });
  
  svgContent += `  </g>
</svg>`;
  
  // Download SVG file
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}