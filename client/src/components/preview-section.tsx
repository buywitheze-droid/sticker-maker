import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

    useImperativeHandle(ref, () => canvasRef.current!, []);

    useEffect(() => {
      if (!canvasRef.current || !imageInfo) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size
      canvas.width = 400;
      canvas.height = 400;

      drawImageWithStroke(ctx, imageInfo.image, strokeSettings, canvas.width, canvas.height);
    }, [imageInfo, strokeSettings]);

    const handleZoomIn = () => {
      // TODO: Implement zoom functionality
    };

    const handleZoomOut = () => {
      // TODO: Implement zoom functionality
    };

    const handleResetZoom = () => {
      // TODO: Implement zoom reset
    };

    return (
      <div className="lg:col-span-1">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Preview</h2>
        
        <Card>
          <CardContent className="p-6">
            {/* Canvas Container */}
            <div 
              ref={containerRef}
              className="relative bg-gray-100 rounded-lg overflow-hidden"
              style={{ minHeight: '400px' }}
            >
              {/* Checkerboard background to show transparency */}
              <div className="absolute inset-0 opacity-50 checkerboard"></div>
              
              <canvas 
                ref={canvasRef}
                className="relative z-10 max-w-full max-h-full mx-auto"
                style={{ maxHeight: '400px' }}
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
            <div className="mt-4 flex justify-center space-x-4">
              <Button variant="ghost" size="sm" onClick={handleZoomOut}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetZoom}>
                Reset View
              </Button>
              <Button variant="ghost" size="sm" onClick={handleZoomIn}>
                <ZoomIn className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);

PreviewSection.displayName = 'PreviewSection';

export default PreviewSection;
