import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { drawImageWithStroke } from "@/lib/canvas-utils";
import { createTrueContour } from "@/lib/true-contour";
import { createCTContour } from "@/lib/ctcontour";

interface PreviewSectionProps {
  imageInfo: ImageInfo | null;
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [backgroundColor, setBackgroundColor] = useState("transparent");

    useImperativeHandle(ref, () => canvasRef.current!, []);

    useEffect(() => {
      if (!canvasRef.current || !imageInfo) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size based on zoom
      const baseSize = 400;
      canvas.width = baseSize * zoom;
      canvas.height = baseSize * zoom;

      // Clear canvas with background color
      if (backgroundColor === "transparent") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (shapeSettings.enabled) {
        drawShapePreview(ctx, canvas.width, canvas.height);
      } else {
        // For contour mode, draw image based on resize settings
        drawImageWithResizePreview(ctx, canvas.width, canvas.height);
      }
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, zoom, backgroundColor]);

    const drawShapePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      // Calculate shape dimensions for preview
      const maxSize = Math.min(canvasWidth, canvasHeight) * 0.8;
      const shapeAspect = shapeSettings.widthInches / shapeSettings.heightInches;
      
      let shapeWidth, shapeHeight;
      if (shapeAspect > 1) {
        shapeWidth = maxSize;
        shapeHeight = maxSize / shapeAspect;
      } else {
        shapeHeight = maxSize;
        shapeWidth = maxSize * shapeAspect;
      }

      // Center the shape
      const shapeX = (canvasWidth - shapeWidth) / 2;
      const shapeY = (canvasHeight - shapeHeight) / 2;

      // Draw shape background
      ctx.fillStyle = shapeSettings.fillColor;
      ctx.beginPath();
      
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidth, shapeHeight) / 2;
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(shapeWidth, shapeHeight);
        const startX = shapeX + (shapeWidth - size) / 2;
        const startY = shapeY + (shapeHeight - size) / 2;
        ctx.rect(startX, startY, size, size);
      } else { // rectangle
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.fill();
      
      // Draw shape stroke if enabled
      if (shapeSettings.strokeEnabled) {
        ctx.strokeStyle = shapeSettings.strokeColor;
        ctx.lineWidth = shapeSettings.strokeWidth;
        ctx.stroke();
      }

      // Calculate image dimensions in preview based on resize settings
      const shapePixelsPerInch = Math.min(shapeWidth / shapeSettings.widthInches, shapeHeight / shapeSettings.heightInches);
      let imageWidth = resizeSettings.widthInches * shapePixelsPerInch;
      let imageHeight = resizeSettings.heightInches * shapePixelsPerInch;

      // Perfect center positioning
      const imageX = shapeX + (shapeWidth - imageWidth) / 2;
      const imageY = shapeY + (shapeHeight - imageHeight) / 2;

      // Overlap detection disabled for now to prevent false positives
      let imageExtendsBeyondShape = false;

      // Draw image without clipping to show full size
      ctx.drawImage(imageInfo.image, imageX, imageY, imageWidth, imageHeight);

      // Draw red warning outline if image overlaps shape bounds
      if (imageExtendsBeyondShape) {
        ctx.save();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(shapeWidth, shapeHeight) / 2;
          const centerX = shapeX + shapeWidth / 2;
          const centerY = shapeY + shapeHeight / 2;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(shapeWidth, shapeHeight);
          const startX = shapeX + (shapeWidth - size) / 2;
          const startY = shapeY + (shapeHeight - size) / 2;
          ctx.strokeRect(startX, startY, size, size);
        } else { // rectangle
          ctx.strokeRect(shapeX, shapeY, shapeWidth, shapeHeight);
        }
        
        ctx.restore();
      }
    };

    const drawImageWithResizePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      // Calculate preview dimensions based on resize settings
      const previewAspectRatio = resizeSettings.widthInches / resizeSettings.heightInches;
      const maxSize = Math.min(canvasWidth, canvasHeight) * 0.8;
      
      let previewWidth, previewHeight;
      if (previewAspectRatio > 1) {
        previewWidth = maxSize;
        previewHeight = maxSize / previewAspectRatio;
      } else {
        previewHeight = maxSize;
        previewWidth = maxSize * previewAspectRatio;
      }
      
      // Center the preview
      const previewX = (canvasWidth - previewWidth) / 2;
      const previewY = (canvasHeight - previewHeight) / 2;
      
      // Draw the main image
      ctx.drawImage(imageInfo.image, previewX, previewY, previewWidth, previewHeight);
    };

    const handleZoomIn = () => {
      if (containerRef.current && imageInfo) {
        const container = containerRef.current;
        const oldScrollLeft = container.scrollLeft;
        const oldScrollTop = container.scrollTop;
        const oldZoom = zoom;
        
        const newZoom = Math.min(oldZoom + 0.5, 3);
        setZoom(newZoom);
        
        // Calculate new scroll position to keep center point consistent
        requestAnimationFrame(() => {
          const zoomRatio = newZoom / oldZoom;
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          
          // Calculate the center point in the old coordinate system
          const centerX = oldScrollLeft + containerWidth / 2;
          const centerY = oldScrollTop + containerHeight / 2;
          
          // Scale the center point and recalculate scroll position
          const newCenterX = centerX * zoomRatio;
          const newCenterY = centerY * zoomRatio;
          
          const newScrollLeft = newCenterX - containerWidth / 2;
          const newScrollTop = newCenterY - containerHeight / 2;
          
          container.scrollLeft = Math.max(0, newScrollLeft);
          container.scrollTop = Math.max(0, newScrollTop);
        });
      } else {
        setZoom(prev => Math.min(prev + 0.5, 3));
      }
    };

    const handleZoomOut = () => {
      if (containerRef.current && imageInfo) {
        const container = containerRef.current;
        const oldScrollLeft = container.scrollLeft;
        const oldScrollTop = container.scrollTop;
        const oldZoom = zoom;
        
        const newZoom = Math.max(oldZoom - 0.5, 0.5);
        setZoom(newZoom);
        
        // Calculate new scroll position to keep center point consistent
        requestAnimationFrame(() => {
          const zoomRatio = newZoom / oldZoom;
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          
          // Calculate the center point in the old coordinate system
          const centerX = oldScrollLeft + containerWidth / 2;
          const centerY = oldScrollTop + containerHeight / 2;
          
          // Scale the center point and recalculate scroll position
          const newCenterX = centerX * zoomRatio;
          const newCenterY = centerY * zoomRatio;
          
          const newScrollLeft = newCenterX - containerWidth / 2;
          const newScrollTop = newCenterY - containerHeight / 2;
          
          container.scrollLeft = Math.max(0, newScrollLeft);
          container.scrollTop = Math.max(0, newScrollTop);
        });
      } else {
        setZoom(prev => Math.max(prev - 0.5, 0.5));
      }
    };

    const handleResetZoom = () => {
      setZoom(1);
      if (containerRef.current) {
        // Center the container when resetting zoom
        requestAnimationFrame(() => {
          const container = containerRef.current!;
          const scrollWidth = container.scrollWidth;
          const scrollHeight = container.scrollHeight;
          const clientWidth = container.clientWidth;
          const clientHeight = container.clientHeight;
          
          container.scrollLeft = Math.max(0, (scrollWidth - clientWidth) / 2);
          container.scrollTop = Math.max(0, (scrollHeight - clientHeight) / 2);
        });
      }
    };

    const handleFitToView = () => {
      setZoom(1);
      if (containerRef.current) {
        // Reset zoom and center the full design in view
        requestAnimationFrame(() => {
          const container = containerRef.current!;
          const scrollWidth = container.scrollWidth;
          const scrollHeight = container.scrollHeight;
          const clientWidth = container.clientWidth;
          const clientHeight = container.clientHeight;
          
          // Center the design to show the full preview
          container.scrollLeft = Math.max(0, (scrollWidth - clientWidth) / 2);
          container.scrollTop = Math.max(0, (scrollHeight - clientHeight) / 2);
        });
      }
    };

    const getBackgroundStyle = () => {
      if (backgroundColor === "transparent") {
        return "checkerboard";
      }
      return "";
    };

    const getBackgroundColor = () => {
      if (backgroundColor === "transparent") {
        return "transparent";
      }
      return backgroundColor;
    };

    return (
      <div className="lg:col-span-1">
        <h2 className="text-lg font-semibold text-white mb-4">Preview</h2>
        
        <Card>
          <CardContent className="p-6">
            {/* Background Color Selector */}
            <div className="mb-4 flex items-center space-x-3">
              <Palette className="w-4 h-4 text-gray-600" />
              <Select value={backgroundColor} onValueChange={setBackgroundColor}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transparent">Transparent</SelectItem>
                  <SelectItem value="#ffffff">White</SelectItem>
                  <SelectItem value="#000000">Black</SelectItem>
                  <SelectItem value="#f3f4f6">Light Gray</SelectItem>
                  <SelectItem value="#1f2937">Dark Gray</SelectItem>
                  <SelectItem value="#3b82f6">Blue</SelectItem>
                  <SelectItem value="#ef4444">Red</SelectItem>
                  <SelectItem value="#10b981">Green</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Canvas Container */}
            <div 
              ref={containerRef}
              className={`relative rounded-lg overflow-auto border ${getBackgroundStyle()}`}
              style={{ 
                minHeight: '400px',
                maxHeight: '500px',
                backgroundColor: getBackgroundColor(),
                scrollBehavior: 'smooth'
              }}
            >
              <div 
                className="flex items-center justify-center"
                style={{
                  minWidth: imageInfo ? `${400 * zoom}px` : '100%',
                  minHeight: imageInfo ? `${400 * zoom}px` : '100%',
                  width: imageInfo ? `${400 * zoom}px` : '100%',
                  height: imageInfo ? `${400 * zoom}px` : '100%'
                }}
              >
                <canvas 
                  ref={canvasRef}
                  className="relative z-10 block"
                  style={{ 
                    width: '400px',
                    height: '400px',
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    imageRendering: zoom > 1 ? 'pixelated' : 'auto'
                  }}
                />
              </div>
              
              {/* Placeholder when no image */}
              {!imageInfo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Upload an image to see preview</p>
                  </div>
                </div>
              )}
            </div>

            {/* Preview Controls */}
            <div className="mt-4 flex justify-between items-center">
              <div className="flex space-x-2">
                <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoom <= 0.5}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleResetZoom}>
                  <RotateCcw className="w-4 h-4 mr-1" />
                  Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={handleFitToView} disabled={!imageInfo}>
                  <ImageIcon className="w-4 h-4 mr-1" />
                  Fit to View
                </Button>
                <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoom >= 3}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-sm text-gray-600">
                Zoom: {Math.round(zoom * 100)}%
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);

PreviewSection.displayName = 'PreviewSection';

export default PreviewSection;
