import { useState, useRef, useCallback } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";
import { cropImageToContent } from "@/lib/image-crop";
import { createVectorStroke, downloadVectorStroke, createVectorPaths, type VectorFormat } from "@/lib/vector-stroke";

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

  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' = 'standard', format: VectorFormat = 'png') => {
    if (!imageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      if (downloadType === 'vector' || downloadType === 'cutcontour') {
        // Use optimized vector processing to prevent crashes
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for UI feedback
        
        const vectorCanvas = createVectorStroke(imageInfo.image, {
          strokeSettings,
          exportCutContour: downloadType === 'cutcontour',
          vectorQuality: 'medium' // Use medium quality to prevent crashes
        });
        
        let filename = downloadType === 'cutcontour' 
          ? 'cutcontour_outline' 
          : 'vector_sticker';
        
        // For true vector formats, create vector paths
        let vectorPaths;
        if (format === 'pdf' || format === 'eps' || format === 'svg') {
          vectorPaths = createVectorPaths(imageInfo.image, strokeSettings, downloadType === 'cutcontour');
        }
        
        // Add another small delay before download
        await new Promise(resolve => setTimeout(resolve, 100));
        downloadVectorStroke(vectorCanvas, filename, format, vectorPaths);
      } else {
        // Standard canvas-based download
        const dpi = downloadType === 'highres' ? 300 : resizeSettings.outputDPI;
        const filename = `sticker${downloadType === 'highres' ? '_300dpi' : ''}.png`;
        
        await downloadCanvas(
          imageInfo.image,
          strokeSettings,
          resizeSettings.widthInches,
          resizeSettings.heightInches,
          dpi,
          filename
        );
      }
    } catch (error) {
      console.error("Download failed:", error);
      alert("Download failed. Please try a different quality setting or reduce the image size.");
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
