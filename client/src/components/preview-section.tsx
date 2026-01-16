import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { CadCutBounds, checkCadCutBounds } from "@/lib/cadcut-bounds";
import { createSilhouetteContour } from "@/lib/silhouette-contour";
import { createTrueContour } from "@/lib/true-contour";
import { createCTContour } from "@/lib/ctcontour";
import { cropImageToContent } from "@/lib/image-crop";

interface PreviewSectionProps {
  imageInfo: ImageInfo | null;
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  cadCutBounds?: CadCutBounds | null;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [backgroundColor, setBackgroundColor] = useState("#374151");

    useImperativeHandle(ref, () => canvasRef.current!, []);

    useEffect(() => {
      if (!canvasRef.current || !imageInfo) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fixed canvas size - content will be centered within
      const baseSize = 400;
      canvas.width = baseSize;
      canvas.height = baseSize;

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
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, zoom, backgroundColor]);

    const drawShapePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      // Calculate shape dimensions to fit the view properly - always fill most of the preview space
      const padding = 40; // Leave some padding around the shape
      const availableWidth = canvasWidth - (padding * 2);
      const availableHeight = canvasHeight - (padding * 2);
      const shapeAspect = shapeSettings.widthInches / shapeSettings.heightInches;
      
      let shapeWidth, shapeHeight;
      if (shapeAspect > (availableWidth / availableHeight)) {
        // Shape is wider relative to available space - fit to width
        shapeWidth = availableWidth;
        shapeHeight = availableWidth / shapeAspect;
      } else {
        // Shape is taller relative to available space - fit to height  
        shapeHeight = availableHeight;
        shapeWidth = availableHeight * shapeAspect;
      }

      // Always center the shape perfectly in the preview window
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
      } else if (shapeSettings.type === 'oval') {
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        const radiusX = shapeWidth / 2;
        const radiusY = shapeHeight / 2;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
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

      // Add visual feedback for bounds violations (only for rectangle and square)
      if (cadCutBounds && !cadCutBounds.isWithinBounds && 
          shapeSettings.type !== 'circle' && shapeSettings.type !== 'oval') {
        ctx.strokeStyle = '#ef4444'; // Red warning color
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]); // Dashed line
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
      }

      // Calculate image dimensions in preview based on resize settings
      const shapePixelsPerInch = Math.min(shapeWidth / shapeSettings.widthInches, shapeHeight / shapeSettings.heightInches);
      let imageWidth = resizeSettings.widthInches * shapePixelsPerInch;
      let imageHeight = resizeSettings.heightInches * shapePixelsPerInch;

      // Create cropped version for accurate centering (after empty space removal)
      const croppedCanvas = cropImageToContent(imageInfo.image);
      const sourceImage = croppedCanvas ? croppedCanvas : imageInfo.image;
      
      // Center the cropped image within the shape and apply manual offset
      const baseImageX = shapeX + (shapeWidth - imageWidth) / 2;
      const baseImageY = shapeY + (shapeHeight - imageHeight) / 2;
      
      // Apply manual position offset (scale offset to preview)
      const offsetScale = shapePixelsPerInch / 300; // Scale offset from 300 DPI to preview scale
      const imageX = baseImageX + ((shapeSettings.offsetX || 0) * offsetScale);
      const imageY = baseImageY + ((shapeSettings.offsetY || 0) * offsetScale);

      // Check for overlap with different tolerances based on shape type
      let imageExtendsBeyondShape = false;
      
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidth, shapeHeight) / 2;
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        
        // Check if any corner of the image extends beyond the circle
        const corners = [
          { x: imageX, y: imageY },
          { x: imageX + imageWidth, y: imageY },
          { x: imageX + imageWidth, y: imageY + imageHeight },
          { x: imageX, y: imageY + imageHeight }
        ];
        
        for (const corner of corners) {
          const dx = corner.x - centerX;
          const dy = corner.y - centerY;
          const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
          
          // Very large tolerance for circles (50 pixels) to avoid false positives
          if (distanceFromCenter > radius + 50) {
            imageExtendsBeyondShape = true;
            break;
          }
        }
      } else {
        // Smaller tolerance for rectangles/squares (5 pixels) since they're more precise
        const tolerance = 5;
        imageExtendsBeyondShape = 
          imageX < shapeX - tolerance || 
          imageY < shapeY - tolerance || 
          imageX + imageWidth > shapeX + shapeWidth + tolerance || 
          imageY + imageHeight > shapeY + shapeHeight + tolerance;
      }

      // Apply clipping for shape bounds
      ctx.save();
      ctx.beginPath();
      
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidth, shapeHeight) / 2;
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'oval') {
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        const radiusX = shapeWidth / 2;
        const radiusY = shapeHeight / 2;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(shapeWidth, shapeHeight);
        const startX = shapeX + (shapeWidth - size) / 2;
        const startY = shapeY + (shapeHeight - size) / 2;
        ctx.rect(startX, startY, size, size);
      } else { // rectangle
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.clip();
      
      // Draw cropped image clipped to shape for accurate centering
      ctx.drawImage(sourceImage, imageX, imageY, imageWidth, imageHeight);
      
      ctx.restore();
      
      // Draw red outline if image extends beyond shape (only for rectangle and square)
      if (imageExtendsBeyondShape && shapeSettings.type !== 'circle' && shapeSettings.type !== 'oval') {
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(shapeX, shapeY, shapeWidth, shapeHeight);
        ctx.setLineDash([]);
      }

      // Draw red warning outline if image overlaps shape bounds (only for rectangle and square)
      if (imageExtendsBeyondShape && shapeSettings.type !== 'circle' && shapeSettings.type !== 'oval') {
        ctx.save();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        
        if (shapeSettings.type === 'square') {
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

      const viewPadding = 40;
      const availableWidth = canvasWidth - (viewPadding * 2);
      const availableHeight = canvasHeight - (viewPadding * 2);
      
      if (strokeSettings.enabled) {
        // When contour is enabled, create the contour canvas (which includes both image and contour)
        // Use magenta for preview to match CutContour output
        try {
          const previewStrokeSettings = { ...strokeSettings, color: '#FF00FF' };
          const contourCanvas = createSilhouetteContour(imageInfo.image, previewStrokeSettings, resizeSettings);
          
          // Calculate the aspect ratio of the contour canvas
          const contourAspectRatio = contourCanvas.width / contourCanvas.height;
          
          // Fit the contour canvas to the available space
          let displayWidth, displayHeight;
          if (contourAspectRatio > (availableWidth / availableHeight)) {
            displayWidth = availableWidth;
            displayHeight = availableWidth / contourAspectRatio;
          } else {
            displayHeight = availableHeight;
            displayWidth = availableHeight * contourAspectRatio;
          }
          
          // Center in the canvas
          const displayX = (canvasWidth - displayWidth) / 2;
          const displayY = (canvasHeight - displayHeight) / 2;
          
          // Draw the combined contour+image canvas
          ctx.drawImage(contourCanvas, displayX, displayY, displayWidth, displayHeight);
          
        } catch (error) {
          console.error('Contour rendering error:', error);
          // Fallback: draw image without contour
          const aspectRatio = imageInfo.image.width / imageInfo.image.height;
          let w, h;
          if (aspectRatio > (availableWidth / availableHeight)) {
            w = availableWidth;
            h = availableWidth / aspectRatio;
          } else {
            h = availableHeight;
            w = availableHeight * aspectRatio;
          }
          const x = (canvasWidth - w) / 2;
          const y = (canvasHeight - h) / 2;
          ctx.drawImage(imageInfo.image, x, y, w, h);
        }
      } else {
        // No contour - just draw the image
        const aspectRatio = imageInfo.image.width / imageInfo.image.height;
        let displayWidth, displayHeight;
        if (aspectRatio > (availableWidth / availableHeight)) {
          displayWidth = availableWidth;
          displayHeight = availableWidth / aspectRatio;
        } else {
          displayHeight = availableHeight;
          displayWidth = availableHeight * aspectRatio;
        }
        
        const displayX = (canvasWidth - displayWidth) / 2;
        const displayY = (canvasHeight - displayHeight) / 2;
        
        ctx.drawImage(imageInfo.image, displayX, displayY, displayWidth, displayHeight);
      }
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
              <span className="text-sm text-gray-600">Preview Color:</span>
              <Select value={backgroundColor} onValueChange={setBackgroundColor}>
                <SelectTrigger className="w-32">
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

            {/* Canvas Container - No scrolling, always centered */}
            <div 
              ref={containerRef}
              className={`relative rounded-lg border flex items-center justify-center ${getBackgroundStyle()}`}
              style={{ 
                height: '400px',
                backgroundColor: getBackgroundColor(),
                overflow: 'hidden'
              }}
              onWheel={(e) => {
                e.preventDefault();
                if (e.deltaY < 0) {
                  // Scroll up = zoom in
                  setZoom(prev => Math.min(prev + 0.2, 3));
                } else {
                  // Scroll down = zoom out
                  setZoom(prev => Math.max(prev - 0.2, 0.2));
                }
              }}
            >
              <canvas 
                ref={canvasRef}
                className="relative z-10 block"
                style={{ 
                  width: '400px',
                  height: '400px',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center'
                }}
              />
              
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

            {/* Overlap warning message */}
            {shapeSettings.enabled && cadCutBounds && !cadCutBounds.isWithinBounds && (
              <div className="mt-2 p-2 bg-white border-2 border-red-500 rounded-lg text-black text-sm text-center">
                Make sure image is within the shape borders. If you see it's safely inside the shape please proceed even if its red!
              </div>
            )}

            {/* Zoom controls */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(prev => Math.max(prev - 0.2, 0.2))}
                className="h-8 w-8 p-0"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              
              <span className="text-sm text-gray-500 min-w-[60px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(prev => Math.min(prev + 0.2, 3))}
                className="h-8 w-8 p-0"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              
              {zoom !== 1 && (
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom(1)}
                  className="h-8 px-2 ml-2"
                  title="Reset Zoom"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);

PreviewSection.displayName = 'PreviewSection';

export default PreviewSection;
