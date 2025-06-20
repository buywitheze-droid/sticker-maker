import { StrokeSettings } from "@/components/image-editor";

export function drawImageWithStroke(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  canvasWidth: number,
  canvasHeight: number
) {
  // Clear canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Calculate scaling to fit image within canvas
  const scale = Math.min(canvasWidth / image.width, canvasHeight / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const x = (canvasWidth - scaledWidth) / 2;
  const y = (canvasHeight - scaledHeight) / 2;

  // Draw stroke/outline if enabled
  if (strokeSettings.enabled && strokeSettings.width > 0) {
    // Save current composite operation
    const originalCompositeOperation = ctx.globalCompositeOperation;
    
    // Draw stroke by creating an outline
    const strokeWidth = strokeSettings.width * scale;
    
    // Create outline by drawing the image multiple times with slight offsets
    ctx.globalCompositeOperation = 'source-over';
    
    // Draw stroke in multiple directions to create outline effect
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const dx = Math.cos(radians) * strokeWidth;
      const dy = Math.sin(radians) * strokeWidth;
      
      // Set stroke color and draw offset image
      ctx.fillStyle = strokeSettings.color;
      ctx.globalCompositeOperation = 'destination-over';
      
      // Create a temporary canvas to color the image
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCanvas.width = scaledWidth;
        tempCanvas.height = scaledHeight;
        
        // Draw image on temp canvas
        tempCtx.drawImage(image, 0, 0, scaledWidth, scaledHeight);
        
        // Apply stroke color by using composite operations
        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.fillStyle = strokeSettings.color;
        tempCtx.fillRect(0, 0, scaledWidth, scaledHeight);
        
        // Draw the colored outline
        ctx.drawImage(tempCanvas, x + dx, y + dy);
      }
    }
    
    // Restore composite operation
    ctx.globalCompositeOperation = originalCompositeOperation;
  }

  // Draw the main image on top
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
}

export function createCheckerboardPattern(ctx: CanvasRenderingContext2D, size: number = 20) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  
  canvas.width = size * 2;
  canvas.height = size * 2;
  
  context.fillStyle = '#f3f4f6';
  context.fillRect(0, 0, size, size);
  context.fillRect(size, size, size, size);
  
  context.fillStyle = '#ffffff';
  context.fillRect(size, 0, size, size);
  context.fillRect(0, size, size, size);
  
  return ctx.createPattern(canvas, 'repeat');
}
