import JSZip from 'jszip';
import { cropImageToContent } from './image-crop';

export async function downloadZipPackage(
  originalImage: HTMLImageElement,
  designCanvas: HTMLCanvasElement,
  originalFilename: string
): Promise<void> {
  try {
    const zip = new JSZip();
    
    // Crop original image to remove empty space
    const croppedCanvas = cropImageToContent(originalImage);
    const imageToSave = croppedCanvas || originalImage;
    
    // Get cropped original image as blob
    const originalBlob = croppedCanvas ? 
      await new Promise<Blob | null>((resolve) => {
        croppedCanvas.toBlob(resolve, 'image/png', 1.0);
      }) : 
      await imageToBlob(originalImage);
      
    if (originalBlob) {
      // Extract original filename without extension and add proper extension
      const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, "");
      zip.file(`${nameWithoutExt}_original.png`, originalBlob);
    }
    
    // Get design with cutlines as blob
    const designBlob = await new Promise<Blob | null>((resolve) => {
      designCanvas.toBlob(resolve, 'image/png', 1.0);
    });
    
    if (designBlob) {
      const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, "");
      zip.file(`${nameWithoutExt}_with_cutlines.png`, designBlob);
    }
    
    // Generate zip file
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // Download the zip file
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${originalFilename.replace(/\.[^/.]+$/, "")}_package.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error creating zip package:', error);
    throw new Error('Failed to create download package');
  }
}

async function imageToBlob(image: HTMLImageElement): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png', 1.0);
  });
}