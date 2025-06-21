import { useState, useRef, useCallback } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";
import { cropImageToContent } from "@/lib/image-crop";
import { createVectorStroke, downloadVectorStroke, createVectorPaths, type VectorFormat } from "@/lib/vector-stroke";
import { createTrueContour } from "@/lib/true-contour";
import { createCTContour } from "@/lib/ctcontour";
import { checkCadCutBounds, type CadCutBounds } from "@/lib/cadcut-bounds";
import { downloadZipPackage } from "@/lib/zip-download";

export interface ImageInfo {
  file: File;
  image: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
}

export interface StrokeSettings {
  width: number;
  color: string;
  enabled: boolean;
  includeHoles: boolean;
  fillHoles: boolean;
  autoTextBackground: boolean;
}

export type StrokeMode = 'none' | 'contour' | 'shape';

export interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
}

export interface ShapeSettings {
  enabled: boolean;
  type: 'square' | 'rectangle' | 'circle' | 'oval';
  widthInches: number;
  heightInches: number;
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export default function ImageEditor() {
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [cadCutBounds, setCadCutBounds] = useState<CadCutBounds | null>(null);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>({
    width: 500, // Increased by 100x (5 * 100)
    color: "#ffffff",
    enabled: true,
    includeHoles: false,
    fillHoles: false,
    autoTextBackground: false,
  });
  const [resizeSettings, setResizeSettings] = useState<ResizeSettings>({
    widthInches: 5.0,
    heightInches: 3.8,
    maintainAspectRatio: true,
    outputDPI: 300,
  });
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>({
    enabled: true,
    type: 'square',
    widthInches: 4.0,
    heightInches: 4.0,
    fillColor: '#FFFFFF',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Function to update CadCut bounds checking
  const updateCadCutBounds = useCallback((shapeWidthInches: number, shapeHeightInches: number) => {
    if (!imageInfo) {
      setCadCutBounds(null);
      return;
    }

    // Convert inches to pixels for bounds checking
    const shapeWidthPixels = shapeWidthInches * imageInfo.dpi;
    const shapeHeightPixels = shapeHeightInches * imageInfo.dpi;

    const bounds = checkCadCutBounds(
      imageInfo.image,
      shapeSettings,
      shapeWidthPixels,
      shapeHeightPixels
    );

    setCadCutBounds(bounds);
  }, [imageInfo, shapeSettings]);

  const handleImageUpload = useCallback((file: File, image: HTMLImageElement) => {
    try {
      // Validate image size to prevent crashes
      if (image.width * image.height > 8000000) { // 8MP limit
        alert('Image is too large. Please upload an image smaller than 8 megapixels.');
        return;
      }
      
      // Validate image dimensions
      if (image.width <= 0 || image.height <= 0) {
        alert('Invalid image dimensions.');
        return;
      }
      
      // Automatically crop the image to remove empty space
      const croppedCanvas = cropImageToContent(image);
      if (!croppedCanvas) {
        console.error('Failed to crop image, using original');
        handleFallbackImage(file, image);
        return;
      }
      
      const croppedImage = new Image();
      
      croppedImage.onload = () => {
        const dpi = 300; // Default DPI for high-quality printing
        const newImageInfo: ImageInfo = {
          file,
          image: croppedImage,
          originalWidth: croppedImage.width,
          originalHeight: croppedImage.height,
          dpi,
        };
        
        setImageInfo(newImageInfo);
        
        // Update resize settings based on cropped image
        const { widthInches, heightInches } = calculateImageDimensions(croppedImage.width, croppedImage.height, dpi);
        setResizeSettings(prev => ({
          ...prev,
          widthInches,
          heightInches,
        }));
        
        // Update shape settings and check bounds
        setShapeSettings(prev => ({
          ...prev,
          widthInches,
          heightInches,
        }));
        
        // Initial bounds check
        updateCadCutBounds(widthInches, heightInches);
      };
      
      croppedImage.onerror = () => {
        console.error('Error loading cropped image, using original');
        handleFallbackImage(file, image);
      };
      
      croppedImage.src = croppedCanvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error processing uploaded image:', error);
      handleFallbackImage(file, image);
    }
  }, []);

  const handleFallbackImage = useCallback((file: File, image: HTMLImageElement) => {
    const dpi = 300;
    const { widthInches, heightInches } = calculateImageDimensions(image.width, image.height, dpi);
    
    const newImageInfo: ImageInfo = {
      file,
      image,
      originalWidth: image.width,
      originalHeight: image.height,
      dpi
    };
    
    setImageInfo(newImageInfo);
    
    setResizeSettings(prev => ({
      ...prev,
      widthInches,
      heightInches
    }));
  }, []);

  const handleResizeChange = useCallback((newSettings: Partial<ResizeSettings>) => {
    setResizeSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Handle aspect ratio maintenance
      if (updated.maintainAspectRatio && imageInfo && newSettings.widthInches !== undefined) {
        const aspectRatio = imageInfo.originalHeight / imageInfo.originalWidth;
        updated.heightInches = parseFloat((newSettings.widthInches * aspectRatio).toFixed(1));
      } else if (updated.maintainAspectRatio && imageInfo && newSettings.heightInches !== undefined) {
        const aspectRatio = imageInfo.originalWidth / imageInfo.originalHeight;
        updated.widthInches = parseFloat((newSettings.heightInches * aspectRatio).toFixed(1));
      }
      
      return updated;
    });
  }, [imageInfo]);

  const handleStrokeChange = useCallback((newSettings: Partial<StrokeSettings>) => {
    const updated = { ...strokeSettings, ...newSettings };
    
    // If enabling stroke, disable shape
    if (newSettings.enabled === true) {
      setShapeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    setStrokeSettings(updated);
  }, [strokeSettings]);

  const handleShapeChange = useCallback((newSettings: Partial<ShapeSettings>) => {
    const updated = { ...shapeSettings, ...newSettings };
    
    // Auto-adjust height for square shapes
    if (updated.type === 'square' && newSettings.widthInches !== undefined) {
      updated.heightInches = newSettings.widthInches;
    } else if (updated.type === 'square' && newSettings.heightInches !== undefined) {
      updated.widthInches = newSettings.heightInches;
    }
    
    // If enabling shape, disable stroke
    if (newSettings.enabled === true) {
      setStrokeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    setShapeSettings(updated);
    
    // Update CadCut bounds when shape settings change
    if (imageInfo && (newSettings.widthInches || newSettings.heightInches || newSettings.type)) {
      updateCadCutBounds(updated.widthInches, updated.heightInches);
    }
  }, [shapeSettings, imageInfo, updateCadCutBounds]);



  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package' = 'standard', format: VectorFormat = 'png') => {
    if (!imageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      if (downloadType === 'download-package') {
        // Create zip package with original and cutlines
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate output dimensions
        const outputWidth = inchesToPixels(shapeSettings.widthInches, 300);
        const outputHeight = inchesToPixels(shapeSettings.heightInches, 300);
        
        canvas.width = outputWidth;
        canvas.height = outputHeight;

        // Draw shape background
        ctx.fillStyle = shapeSettings.fillColor;
        ctx.beginPath();
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(outputWidth, outputHeight) / 2;
          const centerX = outputWidth / 2;
          const centerY = outputHeight / 2;
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          const centerX = outputWidth / 2;
          const centerY = outputHeight / 2;
          ctx.ellipse(centerX, centerY, outputWidth / 2, outputHeight / 2, 0, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(outputWidth, outputHeight);
          const startX = (outputWidth - size) / 2;
          const startY = (outputHeight - size) / 2;
          ctx.rect(startX, startY, size, size);
        } else {
          ctx.rect(0, 0, outputWidth, outputHeight);
        }
        
        ctx.fill();

        // Draw cutlines in magenta
        ctx.strokeStyle = '#FF00FF';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Crop image to remove empty space before processing
        const croppedCanvas = cropImageToContent(imageInfo.image);
        const finalImage = croppedCanvas ? (() => {
          const img = new Image();
          img.src = croppedCanvas.toDataURL();
          return img;
        })() : imageInfo.image;

        // Wait for cropped image to load if created
        if (croppedCanvas) {
          await new Promise((resolve) => {
            finalImage.onload = resolve;
          });
        }

        // Center and draw the cropped image
        const imageAspect = finalImage.width / finalImage.height;
        const shapeAspect = outputWidth / outputHeight;
        
        let imageWidth, imageHeight;
        if (imageAspect > shapeAspect) {
          imageWidth = outputWidth * 0.8;
          imageHeight = imageWidth / imageAspect;
        } else {
          imageHeight = outputHeight * 0.8;
          imageWidth = imageHeight * imageAspect;
        }
        
        const imageX = (outputWidth - imageWidth) / 2;
        const imageY = (outputHeight - imageHeight) / 2;
        
        ctx.drawImage(finalImage, imageX, imageY, imageWidth, imageHeight);

        // Download zip package with cropped original
        await downloadZipPackage(finalImage, canvas, imageInfo.file.name);
        
      } else if (downloadType === 'cutcontour') {
        // Generate magenta vector path along transparent pixel boundaries
        await new Promise(resolve => setTimeout(resolve, 100)); // UI feedback delay
        
        const magentaCutCanvas = createVectorStroke(imageInfo.image, {
          strokeSettings: { ...strokeSettings, color: '#FF00FF', enabled: true }, // Force magenta
          exportCutContour: true, // Enable cut contour mode
          vectorQuality: 'high' // High quality for precise cutting paths
        });
        
        // Download the magenta cut contour
        magentaCutCanvas.toBlob((blob: Blob | null) => {
          if (!blob) return;
          
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'magenta_cut_contour.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 'image/png');
        
        // Also generate vector formats for cutting machines
        const vectorPaths = createVectorPaths(imageInfo.image, {
          ...strokeSettings, 
          color: '#FF00FF', 
          enabled: true
        });
        
        // Download additional vector formats based on requested format
        if (format === 'svg') {
          downloadVectorStroke(magentaCutCanvas, 'cut_contour.svg', 'svg', vectorPaths);
        } else if (format === 'eps') {
          downloadVectorStroke(magentaCutCanvas, 'cut_contour.eps', 'eps', vectorPaths);
        }
      } else {
        // Standard download using existing system
        const dpi = 300;
        const filename = 'sticker_300dpi.png';
        
        await downloadCanvas(
          imageInfo.image,
          strokeSettings,
          resizeSettings.widthInches,
          resizeSettings.heightInches,
          dpi,
          filename,
          shapeSettings
        );
      }
    } catch (error) {
      console.error("Download failed:", error);
      alert("Download failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [imageInfo, strokeSettings, resizeSettings, shapeSettings]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <UploadSection 
        onImageUpload={handleImageUpload}
        imageInfo={imageInfo}
      />
      
      <PreviewSection
        ref={canvasRef}
        imageInfo={imageInfo}
        strokeSettings={strokeSettings}
        resizeSettings={resizeSettings}
        shapeSettings={shapeSettings}
        cadCutBounds={cadCutBounds}
      />
      
      <ControlsSection
        strokeSettings={strokeSettings}
        resizeSettings={resizeSettings}
        shapeSettings={shapeSettings}
        onStrokeChange={handleStrokeChange}
        onResizeChange={handleResizeChange}
        onShapeChange={handleShapeChange}
        onDownload={handleDownload}
        isProcessing={isProcessing}
        imageInfo={imageInfo}
      />
      
      {/* Processing Modal */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <div className="text-gray-700">
                <div className="font-medium">Processing image...</div>
                <div className="text-sm text-gray-500 mt-1">
                  Creating high-quality stroke and preparing download
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
