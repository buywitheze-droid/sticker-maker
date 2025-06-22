import { StrokeSettings } from "@/components/image-editor";

export function createCadCutContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  canvas.width = image.width;
  canvas.height = image.height;
  
  // Clear canvas to transparent
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Auto-detect alpha channel and create vector outline
    const vectorOutline = createVectorOutlineFromAlpha(image);
    
    if (vectorOutline.length === 0) {
      console.log('No vector outline found');
      return canvas;
    }

    // FIXED: Apply CadCut method with inch-based offset
    const offsetPixels = strokeSettings.width * 300; // Convert inches to pixels at 300 DPI
    console.log('Offset pixels:', offsetPixels, 'from width:', strokeSettings.width);
    
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

function createVectorOutlineFromAlpha(image: HTMLImageElement): VectorPoint[] {
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

  // Create simple rectangular outline around content bounds
  const outline: VectorPoint[] = [
    { x: minX, y: minY },     // top-left
    { x: maxX, y: minY },     // top-right
    { x: maxX, y: maxY },     // bottom-right
    { x: minX, y: maxY }      // bottom-left
  ];

  return outline;
}





function applyCadCutMethod(vectorPath: VectorPoint[], offsetPixels: number): VectorPoint[] {
  if (vectorPath.length !== 4) return vectorPath; // Expect rectangular path
  
  // Apply outward offset to rectangle - FIXED: make sure it expands outward
  const [topLeft, topRight, bottomRight, bottomLeft] = vectorPath;
  
  const offsetContour: VectorPoint[] = [
    { x: topLeft.x - offsetPixels, y: topLeft.y - offsetPixels },         // expand top-left outward
    { x: topRight.x + offsetPixels, y: topRight.y - offsetPixels },       // expand top-right outward  
    { x: bottomRight.x + offsetPixels, y: bottomRight.y + offsetPixels }, // expand bottom-right outward
    { x: bottomLeft.x - offsetPixels, y: bottomLeft.y + offsetPixels }    // expand bottom-left outward
  ];
  
  return offsetContour;
}

function drawCadCutContour(ctx: CanvasRenderingContext2D, contour: VectorPoint[]): void {
  if (contour.length < 2) return;

  // FIXED: Make contour more visible and ensure proper rendering
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(3, 2); // Minimum 3px line width for visibility
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  
  // Add shadow for better visibility
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.moveTo(contour[0].x, contour[0].y);
  
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, contour[i].y);
  }
  
  ctx.closePath();
  ctx.stroke();
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

