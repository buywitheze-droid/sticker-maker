import { useState, useRef, useCallback } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";

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

export interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
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
  const [isProcessing, setIsProcessing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = useCallback((file: File, image: HTMLImageElement) => {
    const dpi = 144; // Default assumption
    const newImageInfo: ImageInfo = {
      file,
      image,
      originalWidth: image.width,
      originalHeight: image.height,
      dpi,
    };
    
    setImageInfo(newImageInfo);
    
    // Update resize settings based on image
    const { widthInches, heightInches } = calculateImageDimensions(image.width, image.height, dpi);
    setResizeSettings(prev => ({
      ...prev,
      widthInches,
      heightInches,
    }));
  }, []);

  const handleStrokeChange = useCallback((newSettings: Partial<StrokeSettings>) => {
    setStrokeSettings(prev => ({ ...prev, ...newSettings }));
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

  const handleDownload = useCallback(async (highRes: boolean = false) => {
    if (!imageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      const dpi = highRes ? 300 : resizeSettings.outputDPI;
      const filename = `sticker${highRes ? '_300dpi' : ''}.png`;
      
      await downloadCanvas(
        imageInfo.image,
        strokeSettings,
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        dpi,
        filename
      );
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [imageInfo, strokeSettings, resizeSettings]);

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
      />
      
      <ControlsSection
        strokeSettings={strokeSettings}
        resizeSettings={resizeSettings}
        onStrokeChange={handleStrokeChange}
        onResizeChange={handleResizeChange}
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
              <span className="text-gray-700">Processing image...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
