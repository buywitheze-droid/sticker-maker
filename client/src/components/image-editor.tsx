import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
import { downloadContourPDF, type CachedContourData } from "@/lib/contour-outline";
import { getContourWorkerManager } from "@/lib/contour-worker-manager";
import { downloadShapePDF, calculateShapeDimensions } from "@/lib/shape-outline";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { removeBackgroundFromImage } from "@/lib/background-removal";

export type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize } from "@/lib/types";
import type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize } from "@/lib/types";

export default function ImageEditor() {
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [cadCutBounds, setCadCutBounds] = useState<CadCutBounds | null>(null);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>({
    width: 0.14, // Default large offset
    color: "#ffffff",
    enabled: false,
    alphaThreshold: 128, // Auto-detected from alpha channel
    closeSmallGaps: false, // Close gaps within 0.06" of each other
    closeBigGaps: false, // Close gaps within 0.19" of each other
    backgroundColor: "#ffffff", // Default white background for contour
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
    offset: 0.25, // Default "Big" offset around design
    fillColor: '#FFFFFF',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    cornerRadius: 0.25, // Default corner radius for rounded shapes (in inches)
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [stickerSize, setStickerSize] = useState<StickerSize>(4); // Default 4 inch max dimension
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Debounced settings for heavy processing
  const debouncedStrokeSettings = useDebouncedValue(strokeSettings, 100);
  const debouncedResizeSettings = useDebouncedValue(resizeSettings, 250); // Higher debounce for size changes
  const debouncedShapeSettings = useDebouncedValue(shapeSettings, 100);

  // Function to update CadCut bounds checking - accepts shape settings to avoid stale closure
  const updateCadCutBounds = useCallback((
    shapeWidthInches: number, 
    shapeHeightInches: number,
    currentShapeSettings: ShapeSettings
  ) => {
    if (!imageInfo) {
      setCadCutBounds(null);
      return;
    }

    // Convert inches to pixels for bounds checking
    const shapeWidthPixels = shapeWidthInches * imageInfo.dpi;
    const shapeHeightPixels = shapeHeightInches * imageInfo.dpi;

    const bounds = checkCadCutBounds(
      imageInfo.image,
      currentShapeSettings,
      shapeWidthPixels,
      shapeHeightPixels
    );

    setCadCutBounds(bounds);
  }, [imageInfo]);

  const handleImageUpload = useCallback((file: File, image: HTMLImageElement) => {
    try {
      // Validate image size to prevent crashes
      if (image.width * image.height > 160000000) { // 160MP limit
        alert('Image is too large. Please upload an image smaller than 160 megapixels.');
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
        
        // Reset all settings to defaults when new image is uploaded
        setStrokeSettings({
          width: 0.14,
          color: "#ffffff",
          enabled: false,
          alphaThreshold: 128,
          closeSmallGaps: false,
          closeBigGaps: false,
          backgroundColor: "#ffffff",
        });
        setShapeSettings({
          enabled: false,
          type: 'square',
          offset: 0.25,
          fillColor: '#FFFFFF',
          strokeEnabled: false,
          strokeWidth: 2,
          strokeColor: '#000000',
          cornerRadius: 0.25,
        });
        setStrokeMode('none');
        setCadCutBounds(null);
        
        // Update resize settings based on cropped image
        let { widthInches, heightInches } = calculateImageDimensions(croppedImage.width, croppedImage.height, dpi);
        
        // Always resize to fit within the selected sticker size
        const maxDimension = Math.max(widthInches, heightInches);
        if (maxDimension > stickerSize) {
          const scale = stickerSize / maxDimension;
          widthInches = parseFloat((widthInches * scale).toFixed(2));
          heightInches = parseFloat((heightInches * scale).toFixed(2));
        }
        
        setResizeSettings(prev => ({
          ...prev,
          widthInches,
          heightInches,
        }));
        
        // Initial bounds check using auto-sized shape dimensions
        const shapeDims = calculateShapeDimensions(
          widthInches,
          heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
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
  }, [shapeSettings, stickerSize, updateCadCutBounds]);

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
      let { widthInches, heightInches } = calculateImageDimensions(finalImage.width, finalImage.height, dpi);
      
      // Always resize to fit within the selected sticker size
      const maxDimension = Math.max(widthInches, heightInches);
      if (maxDimension > stickerSize) {
        const scale = stickerSize / maxDimension;
        widthInches = parseFloat((widthInches * scale).toFixed(2));
        heightInches = parseFloat((heightInches * scale).toFixed(2));
      }

      const newImageInfo: ImageInfo = {
        file,
        image: finalImage,
        originalWidth: finalImage.width,
        originalHeight: finalImage.height,
        dpi,
      };

      setImageInfo(newImageInfo);

      // Reset all settings to defaults when new image is uploaded
      setStrokeSettings({
        width: 0.14,
        color: "#ffffff",
        enabled: false,
        alphaThreshold: 128,
        closeSmallGaps: false,
        closeBigGaps: false,
        backgroundColor: "#ffffff",
      });
      setShapeSettings({
        enabled: false,
        type: 'square',
        offset: 0.25,
        fillColor: '#FFFFFF',
        strokeEnabled: false,
        strokeWidth: 2,
        strokeColor: '#000000',
        cornerRadius: 0.25,
      });
      setStrokeMode('none');
      setCadCutBounds(null);

      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
      
      // Initial bounds check using auto-sized shape dimensions
      const shapeDims = calculateShapeDimensions(
        widthInches,
        heightInches,
        shapeSettings.type,
        shapeSettings.offset
      );
      updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
    };

    if (croppedCanvas) {
      finalImage.onload = processImage;
    } else {
      processImage();
    }
  }, [shapeSettings, stickerSize, updateCadCutBounds]);

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
      
      // Recalculate bounds with auto-sized shape dimensions
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          updated.widthInches,
          updated.heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }
      
      return updated;
    });
  }, [imageInfo, shapeSettings, updateCadCutBounds]);

  const handleStickerSizeChange = useCallback((newSize: StickerSize) => {
    setStickerSize(newSize);
    
    // Resize the design to fit within the new sticker size
    if (imageInfo) {
      const aspectRatio = imageInfo.originalWidth / imageInfo.originalHeight;
      let newWidth: number;
      let newHeight: number;
      
      if (aspectRatio >= 1) {
        // Wider than tall - width is the constraining dimension
        newWidth = newSize;
        newHeight = parseFloat((newSize / aspectRatio).toFixed(2));
      } else {
        // Taller than wide - height is the constraining dimension
        newHeight = newSize;
        newWidth = parseFloat((newSize * aspectRatio).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches: newWidth,
        heightInches: newHeight,
      }));
      
      // Recalculate bounds with auto-sized shape dimensions
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          newWidth,
          newHeight,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }
    }
  }, [imageInfo, shapeSettings, updateCadCutBounds]);

  const handleRemoveBackground = useCallback(async (threshold: number) => {
    if (!imageInfo) return;
    
    setIsRemovingBackground(true);
    try {
      const bgRemovedImage = await removeBackgroundFromImage(imageInfo.image, threshold);
      
      // Crop to content bounds after background removal so shape fits actual visible content
      const croppedCanvas = cropImageToContent(bgRemovedImage);
      if (!croppedCanvas) {
        console.error('Failed to crop image after background removal');
        setIsRemovingBackground(false);
        return;
      }
      
      // Convert cropped canvas to image
      const finalImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = croppedCanvas.toDataURL('image/png');
      });
      
      const newWidth = finalImage.naturalWidth || finalImage.width;
      const newHeight = finalImage.naturalHeight || finalImage.height;
      
      // Create new image info with the processed and cropped image
      const newImageInfo: ImageInfo = {
        ...imageInfo,
        image: finalImage,
        originalWidth: newWidth,
        originalHeight: newHeight,
      };
      
      // Recalculate resize settings based on cropped image dimensions
      const dpi = imageInfo.dpi || 300;
      let { widthInches, heightInches } = calculateImageDimensions(newWidth, newHeight, dpi);
      
      // Scale to fit within the selected sticker size if needed
      const maxDimension = Math.max(widthInches, heightInches);
      if (maxDimension > stickerSize) {
        const scale = stickerSize / maxDimension;
        widthInches = parseFloat((widthInches * scale).toFixed(2));
        heightInches = parseFloat((heightInches * scale).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
      
      // Clear contour cache to force recomputation with new image
      const workerManager = getContourWorkerManager();
      workerManager.clearCache();
      
      // Reset CadCut bounds
      setCadCutBounds(null);
      
      setImageInfo(newImageInfo);
    } catch (error) {
      console.error('Error removing background:', error);
    } finally {
      setIsRemovingBackground(false);
    }
  }, [imageInfo, stickerSize]);

  const handleStrokeChange = useCallback((newSettings: Partial<StrokeSettings>) => {
    const updated = { ...strokeSettings, ...newSettings };
    
    // If enabling stroke, disable shape for mutual exclusion
    if (newSettings.enabled === true) {
      setShapeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    setStrokeSettings(updated);
  }, [strokeSettings]);

  const handleShapeChange = useCallback((newSettings: Partial<ShapeSettings>) => {
    let updated = { ...shapeSettings, ...newSettings };
    
    // If enabling shape, disable stroke for mutual exclusion
    if (newSettings.enabled === true) {
      setStrokeSettings(prev => ({ ...prev, enabled: false }));
    }
    
    // Auto-reset offset when switching between shape type categories
    if (newSettings.type !== undefined && newSettings.type !== shapeSettings.type) {
      const wasCircular = shapeSettings.type === 'circle' || shapeSettings.type === 'oval';
      const isCircular = newSettings.type === 'circle' || newSettings.type === 'oval';
      
      if (wasCircular !== isCircular) {
        // Switch to appropriate default offset for new shape category
        updated.offset = isCircular ? 0.40 : 0.125; // Tiny for circular, Small for rectangular
      }
    }
    
    setShapeSettings(updated);
    
    // Recalculate bounds with auto-sized shape dimensions - pass updated settings to avoid stale closure
    if (updated.enabled && imageInfo) {
      const shapeDims = calculateShapeDimensions(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        updated.type,
        updated.offset
      );
      updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, updated);
    }
  }, [shapeSettings, imageInfo, resizeSettings, updateCadCutBounds]);



  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package' = 'standard', format: VectorFormat = 'png', spotColors?: Array<{hex: string; rgb: {r: number; g: number; b: number}; spotWhite: boolean; spotGloss: boolean}>) => {
    if (!imageInfo || !canvasRef.current) return;
    
    setIsProcessing(true);
    
    try {
      if (downloadType === 'download-package') {
        // Create zip package with original and cutlines
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate output dimensions using auto-sizing
        const shapeDims = calculateShapeDimensions(
          resizeSettings.widthInches,
          resizeSettings.heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        const outputWidth = shapeDims.widthInches * 300;
        const outputHeight = shapeDims.heightInches * 300;
        
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
        
        // Center the design in the shape (no manual offset needed)
        const imageX = (outputWidth - imageWidth) / 2;
        const imageY = (outputHeight - imageHeight) / 2;
        
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
        // Standard download - shape background or contour outline
        const nameWithoutExt = imageInfo.file.name.replace(/\.[^/.]+$/, '');
        
        if (strokeSettings.enabled) {
          // Contour mode: Download PDF with raster image + vector contour
          const filename = `${nameWithoutExt}_with_contour.pdf`;
          
          // Get cached contour data from worker manager for fast PDF export
          const workerManager = getContourWorkerManager();
          const cachedData = workerManager.getCachedContourData() as CachedContourData | undefined;
          
          await downloadContourPDF(
            imageInfo.image,
            strokeSettings,
            resizeSettings,
            filename,
            cachedData,
            spotColors
          );
        } else if (shapeSettings.enabled) {
          // Shape background mode: Download PDF with shape + CutContour spot color
          const filename = `${nameWithoutExt}_with_shape.pdf`;
          await downloadShapePDF(
            imageInfo.image,
            shapeSettings,
            resizeSettings,
            filename
          );
        } else {
          // No mode selected - just download the image
          const dpi = 300;
          const filename = `${nameWithoutExt}.png`;
          await downloadCanvas(
            imageInfo.image,
            strokeSettings,
            resizeSettings.widthInches,
            resizeSettings.heightInches,
            dpi,
            filename,
            undefined
          );
        }
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
        showCutLineInfo={strokeSettings.enabled || shapeSettings.enabled}
      />
      
      <div className="relative preview-container">
        <PreviewSection
          ref={canvasRef}
          imageInfo={imageInfo}
          strokeSettings={debouncedStrokeSettings}
          resizeSettings={debouncedResizeSettings}
          shapeSettings={debouncedShapeSettings}
          cadCutBounds={cadCutBounds}
        />
        
      </div>
      
      <ControlsSection
        strokeSettings={strokeSettings}
        resizeSettings={resizeSettings}
        shapeSettings={shapeSettings}
        stickerSize={stickerSize}
        onStrokeChange={handleStrokeChange}
        onResizeChange={handleResizeChange}
        onShapeChange={handleShapeChange}
        onStickerSizeChange={handleStickerSizeChange}
        onDownload={handleDownload}
        isProcessing={isProcessing}
        imageInfo={imageInfo}
        canvasRef={canvasRef}
        onStepChange={() => {}}
        onRemoveBackground={handleRemoveBackground}
        isRemovingBackground={isRemovingBackground}
      />
      
      {/* Processing Modal */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-sm mx-4">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyan-500 border-t-transparent"></div>
              <span className="text-white">Processing...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
