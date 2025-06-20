import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings } from "./image-editor";
import { drawImageWithStroke } from "@/lib/canvas-utils";

interface PreviewSectionProps {
  imageInfo: ImageInfo | null;
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings }, ref) => {
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

      drawImageWithStroke(ctx, imageInfo.image, strokeSettings, canvas.width, canvas.height);
    }, [imageInfo, strokeSettings, zoom, backgroundColor]);

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
