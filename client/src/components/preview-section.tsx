import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { drawImageWithStroke } from "@/lib/canvas-utils";

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
        drawImageWithStroke(ctx, imageInfo.image, strokeSettings, canvas.width, canvas.height);
      }
    }, [imageInfo, strokeSettings, shapeSettings, zoom, backgroundColor]);

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

      // Draw image centered in shape
      const availableWidth = shapeWidth * 0.7;
      const availableHeight = shapeHeight * 0.7;
      const imageAspect = imageInfo.originalWidth / imageInfo.originalHeight;
      const availableAspect = availableWidth / availableHeight;
      
      let imageWidth, imageHeight;
      if (imageAspect > availableAspect) {
        imageWidth = availableWidth;
        imageHeight = imageWidth / imageAspect;
      } else {
        imageHeight = availableHeight;
        imageWidth = imageHeight * imageAspect;
      }

      const imageX = shapeX + (shapeWidth - imageWidth) / 2;
      const imageY = shapeY + (shapeHeight - imageHeight) / 2;

      // Draw image with stroke using existing utility
      drawImageWithStroke(ctx, imageInfo.image, strokeSettings, imageX, imageY, imageWidth, imageHeight);
    };

    const handleZoomIn = () => {
      setZoom(prev => Math.min(prev + 0.5, 3));
    };

    const handleZoomOut = () => {
      setZoom(prev => Math.max(prev - 0.5, 0.5));
    };

    const handleResetZoom = () => {
      setZoom(1);
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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Preview</h2>
        
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
                backgroundColor: getBackgroundColor()
              }}
            >
              <canvas 
                ref={canvasRef}
                className="relative z-10 mx-auto block"
                style={{ 
                  maxWidth: `${400 * zoom}px`,
                  maxHeight: `${400 * zoom}px`,
                  imageRendering: zoom > 1 ? 'pixelated' : 'auto'
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
