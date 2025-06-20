import { useState, useRef, useCallback } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";
import { cropImageToContent } from "@/lib/image-crop";
import { createVectorStroke, downloadVectorStroke, createVectorPaths, type VectorFormat } from "@/lib/vector-stroke";
import { createCadCutContour } from "@/lib/cadcut-contour";

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
  type: 'square' | 'rectangle' | 'circle';
  widthInches: number;
  heightInches: number;
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export default function ImageEditor() {
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>({
    width: 5,
    color: "#ffffff",
    enabled: true,
  });
  const [resizeSettings, setResizeSettings] = useState<ResizeSettings>({
    widthInches: 5.0,
    heightInches: 3.8,
    maintainAspectRatio: true,
    outputDPI: 300,
  });
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>({
    enabled: false,
    type: 'square',
    widthInches: 4.0,
    heightInches: 4.0,
    fillColor: '#ffffff',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = useCallback((file: File, image: HTMLImageElement) => {
    // Automatically crop the image to remove empty space
    const croppedCanvas = cropImageToContent(image);
    const croppedImage = new Image();
    
    croppedImage.onload = () => {
      const dpi = 144; // Default assumption
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
    };
    
    croppedImage.src = croppedCanvas.toDataURL();
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
  }, [shapeSettings]);



  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' = 'standard', format: VectorFormat = 'png') => {
    if (!imageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      if (downloadType === 'cutcontour') {
        // Use CadCut-style contour processing
        await new Promise(resolve => setTimeout(resolve, 100)); // UI feedback delay
        
        const cadCutCanvas = createCadCutContour(imageInfo.image, {
          strokeSettings: { ...strokeSettings, color: '#FF00FF', enabled: true }, // Force magenta
          tolerance: 5, // High precision like CadCut
          smoothing: 1, // Minimal smoothing for precision
          cornerDetection: true // Preserve sharp corners
        });
        
        // Download the CadCut contour canvas
        cadCutCanvas.toBlob((blob: Blob | null) => {
          if (!blob) return;
          
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'cadcut_contour.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 'image/png');
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
