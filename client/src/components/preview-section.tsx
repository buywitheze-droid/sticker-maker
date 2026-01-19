import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { createSilhouetteContour } from "@/lib/contour-outline";
import { calculateShapeDimensions } from "@/lib/shape-outline";
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
    const [backgroundColor, setBackgroundColor] = useState("#1f2937");
    
    const getColorName = (color: string) => {
      const colorMap: Record<string, string> = {
        "transparent": "Transparent",
        "#ffffff": "White",
        "#000000": "Black",
        "#f3f4f6": "Light Gray",
        "#1f2937": "Dark Gray",
        "#3b82f6": "Blue",
        "#ef4444": "Red",
        "#10b981": "Green",
      };
      return colorMap[color] || color;
    };

    useImperativeHandle(ref, () => canvasRef.current!, []);

    useEffect(() => {
      if (!canvasRef.current || !imageInfo) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const baseSize = 400;
      canvas.width = baseSize;
      canvas.height = baseSize;

      if (backgroundColor === "transparent") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (shapeSettings.enabled) {
        drawShapePreview(ctx, canvas.width, canvas.height);
      } else {
        drawImageWithResizePreview(ctx, canvas.width, canvas.height);
      }
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, zoom, backgroundColor]);

    const drawShapePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      const shapeDims = calculateShapeDimensions(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        shapeSettings.type,
        shapeSettings.offset
      );

      const padding = 40;
      const availableWidth = canvasWidth - (padding * 2);
      const availableHeight = canvasHeight - (padding * 2);
      const shapeAspect = shapeDims.widthInches / shapeDims.heightInches;
      
      let shapeWidth, shapeHeight;
      if (shapeAspect > (availableWidth / availableHeight)) {
        shapeWidth = availableWidth;
        shapeHeight = availableWidth / shapeAspect;
      } else {
        shapeHeight = availableHeight;
        shapeWidth = availableHeight * shapeAspect;
      }

      const shapeX = (canvasWidth - shapeWidth) / 2;
      const shapeY = (canvasHeight - shapeHeight) / 2;

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
      } else {
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.fill();
      
      // Always draw CutContour outline in magenta (same as contour outline)
      ctx.strokeStyle = '#FF00FF';
      ctx.lineWidth = 2;
      ctx.stroke();

      const croppedCanvas = cropImageToContent(imageInfo.image);
      const sourceImage = croppedCanvas ? croppedCanvas : imageInfo.image;
      
      const shapePixelsPerInch = Math.min(shapeWidth / shapeDims.widthInches, shapeHeight / shapeDims.heightInches);
      const imageWidth = resizeSettings.widthInches * shapePixelsPerInch;
      const imageHeight = resizeSettings.heightInches * shapePixelsPerInch;

      const imageX = shapeX + (shapeWidth - imageWidth) / 2;
      const imageY = shapeY + (shapeHeight - imageHeight) / 2;

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
      } else {
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.clip();
      ctx.drawImage(sourceImage, imageX, imageY, imageWidth, imageHeight);
      ctx.restore();
    };

    const drawImageWithResizePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      const viewPadding = 40;
      const availableWidth = canvasWidth - (viewPadding * 2);
      const availableHeight = canvasHeight - (viewPadding * 2);
      
      if (strokeSettings.enabled) {
        try {
          const previewStrokeSettings = { ...strokeSettings, color: '#FF00FF' };
          const contourCanvas = createSilhouetteContour(imageInfo.image, previewStrokeSettings, resizeSettings);
          
          const contourAspectRatio = contourCanvas.width / contourCanvas.height;
          
          let displayWidth, displayHeight;
          if (contourAspectRatio > (availableWidth / availableHeight)) {
            displayWidth = availableWidth;
            displayHeight = availableWidth / contourAspectRatio;
          } else {
            displayHeight = availableHeight;
            displayWidth = availableHeight * contourAspectRatio;
          }
          
          const displayX = (canvasWidth - displayWidth) / 2;
          const displayY = (canvasHeight - displayHeight) / 2;
          
          ctx.drawImage(contourCanvas, displayX, displayY, displayWidth, displayHeight);
          
        } catch (error) {
          console.error('Contour rendering error:', error);
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
            <div className="mb-4 flex items-center space-x-3">
              <Palette className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-600">Preview Color:</span>
              <Select value={backgroundColor} onValueChange={setBackgroundColor}>
                <SelectTrigger className="w-32">
                  <SelectValue>{getColorName(backgroundColor)}</SelectValue>
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

            <div 
              ref={containerRef}
              className={`relative rounded-lg border flex items-center justify-center ${getBackgroundStyle()}`}
              style={{ 
                height: '400px',
                backgroundColor: getBackgroundColor(),
                overflow: 'hidden'
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
              
              {!imageInfo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Upload an image to see preview</p>
                  </div>
                </div>
              )}
            </div>

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
