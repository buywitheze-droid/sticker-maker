import { StrokeSettings } from "@/components/image-editor";

export function calculateImageDimensions(width: number, height: number, dpi: number) {
  return {
    widthInches: parseFloat((width / dpi).toFixed(1)),
    heightInches: parseFloat((height / dpi).toFixed(1)),
  };
}

export function pixelsToInches(pixels: number, dpi: number): number {
  return pixels / dpi;
}

export function inchesToPixels(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

export async function downloadCanvas(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  widthInches: number,
  heightInches: number,
  dpi: number,
  filename: string
) {
  // Create a high-resolution canvas for export
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Calculate output dimensions
  const outputWidth = inchesToPixels(widthInches, dpi);
  const outputHeight = inchesToPixels(heightInches, dpi);

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  // Draw the image with stroke at high resolution
  await drawHighResImage(ctx, image, strokeSettings, outputWidth, outputHeight);

  // Download the canvas as PNG
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

async function drawHighResImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  canvasWidth: number,
  canvasHeight: number
) {
  // Clear canvas with transparent background
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Calculate scaling to fit the image within canvas while maintaining aspect ratio
  const imageAspectRatio = image.width / image.height;
  const canvasAspectRatio = canvasWidth / canvasHeight;

  let drawWidth, drawHeight, offsetX, offsetY;

  if (imageAspectRatio > canvasAspectRatio) {
    // Image is wider than canvas
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / imageAspectRatio;
    offsetX = 0;
    offsetY = (canvasHeight - drawHeight) / 2;
  } else {
    // Image is taller than canvas
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * imageAspectRatio;
    offsetX = (canvasWidth - drawWidth) / 2;
    offsetY = 0;
  }

  // Draw stroke/outline if enabled
  if (strokeSettings.enabled && strokeSettings.width > 0) {
    // Create a temporary canvas to generate the outline
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCanvas.width = drawWidth + strokeSettings.width * 2;
      tempCanvas.height = drawHeight + strokeSettings.width * 2;
      
      // Draw the image on temp canvas
      tempCtx.drawImage(image, strokeSettings.width, strokeSettings.width, drawWidth, drawHeight);
      
      // Create outline by drawing the image multiple times with slight offsets
      ctx.globalCompositeOperation = 'source-over';
      const strokeOffset = strokeSettings.width;
      
      // Draw stroke by creating multiple copies with offsets
      for (let angle = 0; angle < 360; angle += 45) {
        const radians = (angle * Math.PI) / 180;
        const dx = Math.cos(radians) * strokeOffset;
        const dy = Math.sin(radians) * strokeOffset;
        
        ctx.fillStyle = strokeSettings.color;
        ctx.globalCompositeOperation = 'destination-over';
        ctx.drawImage(
          tempCanvas,
          offsetX - strokeOffset + dx,
          offsetY - strokeOffset + dy
        );
      }
    }
  }

  // Draw the main image
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}
