import { useState, useRef, useCallback, useEffect } from "react";
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
  offsetX: number;
  offsetY: number;
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
    offsetX: 0,
    offsetY: 0,
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [isProcessing, setIsProcessing] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 16, y: 16 }); // Initial position: top-right
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
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
      
      // Automatically crop the image to remove ALL empty space
      const croppedCanvas = cropImageToContent(image);
      if (!croppedCanvas) {
        console.error('Failed to crop image, using original');
        handleFallbackImage(file, image);
        return;
      }
      
      const croppedImage = new Image();
      
      croppedImage.onload = () => {
        const dpi = 300; // Default DPI for high-quality printing
        
        // Create final cropped image info with zero padding
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
    
    // Always try to crop even fallback images to remove empty space
    const croppedCanvas = cropImageToContent(image);
    const finalImage = croppedCanvas ? (() => {
      const img = new Image();
      img.src = croppedCanvas.toDataURL();
      return img;
    })() : image;

    const processImage = () => {
      const { widthInches, heightInches } = calculateImageDimensions(finalImage.width, finalImage.height, dpi);

      const newImageInfo: ImageInfo = {
        file,
        image: finalImage,
        originalWidth: finalImage.width,
        originalHeight: finalImage.height,
        dpi,
      };

      setImageInfo(newImageInfo);

      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
      
      setShapeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));

      updateCadCutBounds(widthInches, heightInches);
    };

    if (croppedCanvas) {
      finalImage.onload = processImage;
    } else {
      processImage();
    }
  }, [updateCadCutBounds]);

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

  const handlePositionChange = useCallback((deltaX: number, deltaY: number) => {
    setShapeSettings(prev => ({
      ...prev,
      offsetX: prev.offsetX + deltaX,
      offsetY: prev.offsetY + deltaY,
    }));
  }, []);

  const handleMenuMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.menu-header')) {
      setIsDragging(true);
      const rect = e.currentTarget.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      e.preventDefault();
    }
  }, []);

  const handleMenuMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const previewContainer = document.querySelector('.preview-container');
    if (!previewContainer) return;
    
    const containerRect = previewContainer.getBoundingClientRect();
    const newX = e.clientX - containerRect.left - dragOffset.x;
    const newY = e.clientY - containerRect.top - dragOffset.y;
    
    // Keep menu within bounds
    const menuWidth = 96; // w-24 = 96px
    const menuHeight = 120; // Approximate height
    const maxX = containerRect.width - menuWidth;
    const maxY = containerRect.height - menuHeight;
    
    setMenuPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  }, [isDragging, dragOffset]);

  const handleMenuMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMenuMouseMove);
      document.addEventListener('mouseup', handleMenuMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMenuMouseMove);
        document.removeEventListener('mouseup', handleMenuMouseUp);
      };
    }
  }, [isDragging, handleMenuMouseMove, handleMenuMouseUp]);

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
        const outputWidth = shapeSettings.widthInches * 300;
        const outputHeight = shapeSettings.heightInches * 300;
        
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

        // Center and draw the cropped image with manual positioning
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
        
        // Apply manual position offset
        const baseImageX = (outputWidth - imageWidth) / 2;
        const baseImageY = (outputHeight - imageHeight) / 2;
        const imageX = baseImageX + (shapeSettings.offsetX || 0);
        const imageY = baseImageY + (shapeSettings.offsetY || 0);
        
        ctx.drawImage(finalImage, imageX, imageY, imageWidth, imageHeight);

        // Download final design only
        const nameWithoutExt = imageInfo.file.name.replace(/\.[^/.]+$/, '');
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${nameWithoutExt}_final_design.png`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }, 'image/png');
        
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
        const nameWithoutExt = imageInfo.file.name.replace(/\.[^/.]+$/, '');
        const filename = `${nameWithoutExt}_sticker_300dpi.png`;
        
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
      console.error("Error details:", {
        hasImage: !!imageInfo,
        hasCanvas: !!canvasRef.current,
        shapeSettings,
        resizeSettings,
        strokeSettings
      });
      alert(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
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
      
      <div className="relative preview-container">
        <PreviewSection
          ref={canvasRef}
          imageInfo={imageInfo}
          strokeSettings={strokeSettings}
          resizeSettings={resizeSettings}
          shapeSettings={shapeSettings}
          cadCutBounds={cadCutBounds}
        />
        
        {/* Draggable Position Control Menu */}
        {imageInfo && shapeSettings.enabled && (
          <div 
            className="absolute bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 border border-gray-200 dark:border-gray-700 cursor-move select-none"
            style={{ 
              left: `${menuPosition.x}px`, 
              top: `${menuPosition.y}px`,
              right: 'auto',
              zIndex: 10
            }}
            onMouseDown={handleMenuMouseDown}
          >
            <div className="text-xs text-gray-600 dark:text-gray-400 text-center mb-2 font-medium menu-header">
              Position
            </div>
            <div className="grid grid-cols-3 gap-1 w-24 h-24">
              {/* Top arrow */}
              <div></div>
              <button
                onClick={() => handlePositionChange(0, -10)}
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-6 h-6 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                title="Move Up"
              >
                <svg className="w-3 h-3 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <div></div>
              
              {/* Left and Right arrows */}
              <button
                onClick={() => handlePositionChange(-10, 0)}
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-6 h-6 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                title="Move Left"
              >
                <svg className="w-3 h-3 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              
              <button
                onClick={() => setShapeSettings(prev => ({ ...prev, offsetX: 0, offsetY: 0 }))}
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-6 h-6 bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 rounded transition-colors"
                title="Reset Position"
              >
                <svg className="w-3 h-3 text-blue-600 dark:text-blue-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v3.586l1.707-1.707a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8 10.586V7z" clipRule="evenodd" />
                </svg>
              </button>
              
              <button
                onClick={() => handlePositionChange(10, 0)}
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-6 h-6 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                title="Move Right"
              >
                <svg className="w-3 h-3 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              
              {/* Bottom arrow */}
              <div></div>
              <button
                onClick={() => handlePositionChange(0, 10)}
                onMouseDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-6 h-6 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                title="Move Down"
              >
                <svg className="w-3 h-3 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <div></div>
            </div>
          </div>
        )}
      </div>
      
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
