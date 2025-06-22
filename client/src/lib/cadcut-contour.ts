import { StrokeSettings } from "@/components/image-editor";

export function createCadCutContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Make canvas larger to accommodate offset
  const padding = strokeSettings.width * 300 + 50; // Extra padding
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  // Clear canvas to transparent
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Auto-detect alpha channel and create vector outline (offset for padding)
    const vectorOutline = createVectorOutlineFromAlpha(image, padding);
    
    if (vectorOutline.length === 0) {
      console.log('No vector outline found');
      return canvas;
    }

    // Apply CadCut method with inch-based offset
    const offsetPixels = strokeSettings.width * 300;
    console.log('Offset pixels:', offsetPixels, 'from width:', strokeSettings.width);
    console.log('Canvas size:', canvas.width, 'x', canvas.height);
    
    const cadcutContour = applyCadCutMethod(vectorOutline, offsetPixels);
    console.log('Vector outline:', vectorOutline);
    console.log('CadCut contour:', cadcutContour);

    // Draw the contour outline
    drawCadCutContour(ctx, cadcutContour);
    
  } catch (error) {
    console.error('CadCut contour error:', error);
  }
  
  return canvas;
}

interface VectorPoint {
  x: number;
  y: number;
}

function createVectorOutlineFromAlpha(image: HTMLImageElement, padding: number = 0): VectorPoint[] {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];

  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;

  // Find content bounds first
  let minX = image.width, maxX = 0, minY = image.height, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const alpha = data[index + 3];
      
      if (alpha >= 128) { // Use fixed threshold for simplicity
        hasContent = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!hasContent) return [];

  // Create simple rectangular outline around content bounds (offset by padding)
  const outline: VectorPoint[] = [
    { x: minX + padding, y: minY + padding },     // top-left
    { x: maxX + padding, y: minY + padding },     // top-right
    { x: maxX + padding, y: maxY + padding },     // bottom-right
    { x: minX + padding, y: maxY + padding }      // bottom-left
  ];

  return outline;
}





function applyCadCutMethod(vectorPath: VectorPoint[], offsetPixels: number): VectorPoint[] {
  if (vectorPath.length !== 4) return vectorPath; // Expect rectangular path
  
  // Apply outward offset to rectangle but keep within canvas bounds
  const [topLeft, topRight, bottomRight, bottomLeft] = vectorPath;
  
  // Calculate offset but ensure it stays within visible area
  const offsetContour: VectorPoint[] = [
    { x: Math.max(0, topLeft.x - offsetPixels), y: Math.max(0, topLeft.y - offsetPixels) },         
    { x: topRight.x + offsetPixels, y: Math.max(0, topRight.y - offsetPixels) },       
    { x: bottomRight.x + offsetPixels, y: bottomRight.y + offsetPixels }, 
    { x: Math.max(0, bottomLeft.x - offsetPixels), y: bottomLeft.y + offsetPixels }    
  ];
  
  return offsetContour;
}

function drawCadCutContour(ctx: CanvasRenderingContext2D, contour: VectorPoint[]): void {
  if (contour.length < 2) return;

  // Force maximum visibility
  ctx.strokeStyle = '#FF0000'; // Use red for debugging visibility
  ctx.lineWidth = 5; // Thick line for visibility
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;

  console.log('Drawing contour at coordinates:', contour);
  
  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
  
  // Also draw corner points for debugging
  ctx.fillStyle = '#00FF00';
  for (const point of contour) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}

