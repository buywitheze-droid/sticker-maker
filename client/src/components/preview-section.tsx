import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette, Loader2, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { processContourInWorker } from "@/lib/contour-worker-manager";
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
    const lastImageRef = useRef<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const contourCacheRef = useRef<{key: string; canvas: HTMLCanvasElement} | null>(null);
    const processingIdRef = useRef(0);
    
    // Fit to View: calculate zoom to fit canvas within container
    const fitToView = useCallback(() => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth - 40; // padding
      const containerHeight = containerRef.current.clientHeight - 40;
      const canvasSize = 400; // fixed canvas size
      const scaleX = containerWidth / canvasSize;
      const scaleY = containerHeight / canvasSize;
      const fitZoom = Math.min(scaleX, scaleY, 1); // max at 100%
      setZoom(Math.max(0.2, Math.round(fitZoom * 20) / 20)); // round to 5% steps
    }, []);
    
    // Mouse wheel zoom handler
    const handleWheel = useCallback((e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.max(0.2, Math.min(3, prev + delta)));
    }, []);
    
    // Auto-set zoom to 75% for images with no empty space around them
    useEffect(() => {
      if (!imageInfo) {
        lastImageRef.current = null;
        return;
      }
      
      // Only check when image changes
      const imageKey = `${imageInfo.image.src}-${imageInfo.image.width}-${imageInfo.image.height}`;
      if (lastImageRef.current === imageKey) return;
      lastImageRef.current = imageKey;
      
      // Check if image has minimal empty space around the edges
      const hasMinimalEmptySpace = checkImageHasMinimalEmptySpace(imageInfo.image);
      if (hasMinimalEmptySpace) {
        setZoom(0.75);
      } else {
        setZoom(1);
      }
    }, [imageInfo]);
    
    // Check if image content extends close to the edges (minimal empty space)
    const checkImageHasMinimalEmptySpace = (image: HTMLImageElement): boolean => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Check edges for content - if content is within 5% of any edge, it's "no empty space"
        const margin = Math.max(5, Math.floor(Math.min(canvas.width, canvas.height) * 0.05));
        
        let hasContentNearTop = false;
        let hasContentNearBottom = false;
        let hasContentNearLeft = false;
        let hasContentNearRight = false;
        
        // Sample pixels near edges (every 10th pixel for performance)
        const step = 10;
        
        // Check top edge
        for (let y = 0; y < margin && !hasContentNearTop; y++) {
          for (let x = 0; x < canvas.width; x += step) {
            const idx = (y * canvas.width + x) * 4;
            if (data[idx + 3] > 128) { // Alpha > 128
              hasContentNearTop = true;
              break;
            }
          }
        }
        
        // Check bottom edge
        for (let y = canvas.height - margin; y < canvas.height && !hasContentNearBottom; y++) {
          for (let x = 0; x < canvas.width; x += step) {
            const idx = (y * canvas.width + x) * 4;
            if (data[idx + 3] > 128) {
              hasContentNearBottom = true;
              break;
            }
          }
        }
        
        // Check left edge
        for (let x = 0; x < margin && !hasContentNearLeft; x++) {
          for (let y = 0; y < canvas.height; y += step) {
            const idx = (y * canvas.width + x) * 4;
            if (data[idx + 3] > 128) {
              hasContentNearLeft = true;
              break;
            }
          }
        }
        
        // Check right edge
        for (let x = canvas.width - margin; x < canvas.width && !hasContentNearRight; x++) {
          for (let y = 0; y < canvas.height; y += step) {
            const idx = (y * canvas.width + x) * 4;
            if (data[idx + 3] > 128) {
              hasContentNearRight = true;
              break;
            }
          }
        }
        
        // If content is near 3+ edges, consider it "no empty space"
        const edgesWithContent = [hasContentNearTop, hasContentNearBottom, hasContentNearLeft, hasContentNearRight].filter(Boolean).length;
        return edgesWithContent >= 3;
      } catch {
        return false;
      }
    };
    
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

    const generateContourCacheKey = useCallback(() => {
      if (!imageInfo) return '';
      // Cache key excludes outputDPI (always 100 for preview) and color (always #FF00FF for preview)
      return `${imageInfo.image.src}-${strokeSettings.width}-${strokeSettings.alphaThreshold}-${strokeSettings.closeSmallGaps}-${strokeSettings.closeBigGaps}-${strokeSettings.backgroundColor}-${resizeSettings.widthInches}-${resizeSettings.heightInches}`;
    }, [imageInfo, strokeSettings.width, strokeSettings.alphaThreshold, strokeSettings.closeSmallGaps, strokeSettings.closeBigGaps, strokeSettings.backgroundColor, resizeSettings.widthInches, resizeSettings.heightInches]);

    useEffect(() => {
      if (!imageInfo || !strokeSettings.enabled || shapeSettings.enabled) {
        contourCacheRef.current = null;
        return;
      }

      const cacheKey = generateContourCacheKey();
      if (contourCacheRef.current?.key === cacheKey) return;

      const currentId = ++processingIdRef.current;
      setIsProcessing(true);
      setProcessingProgress(0);

      const previewStrokeSettings = { ...strokeSettings, color: '#FF00FF' };
      // Use lower DPI (100) for preview to improve responsiveness
      const workerResizeSettings = {
        widthInches: resizeSettings.widthInches,
        heightInches: resizeSettings.heightInches,
        maintainAspectRatio: resizeSettings.maintainAspectRatio,
        outputDPI: 100 // Fixed low DPI for preview, full DPI only for export
      };

      processContourInWorker(
        imageInfo.image,
        previewStrokeSettings,
        workerResizeSettings,
        (progress) => {
          if (processingIdRef.current === currentId) {
            setProcessingProgress(progress);
          }
        }
      ).then((contourCanvas) => {
        if (processingIdRef.current === currentId) {
          contourCacheRef.current = { key: cacheKey, canvas: contourCanvas };
          setIsProcessing(false);
        }
      }).catch((error) => {
        console.error('Contour processing error:', error);
        if (processingIdRef.current === currentId) {
          setIsProcessing(false);
        }
      });
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings.enabled, generateContourCacheKey]);

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
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, zoom, backgroundColor, isProcessing]);

    const drawShapePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      const shapeDims = calculateShapeDimensions(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        shapeSettings.type,
        shapeSettings.offset
      );

      const bleedInches = 0.10; // 0.10" bleed around the shape
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
      
      // Calculate bleed in pixels based on shape scale
      const shapePixelsPerInch = Math.min(shapeWidth / shapeDims.widthInches, shapeHeight / shapeDims.heightInches);
      const bleedPixels = bleedInches * shapePixelsPerInch;

      // Draw background with bleed (larger shape for the fill)
      ctx.fillStyle = shapeSettings.fillColor;
      ctx.beginPath();
      
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidth, shapeHeight) / 2 + bleedPixels;
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'oval') {
        const centerX = shapeX + shapeWidth / 2;
        const centerY = shapeY + shapeHeight / 2;
        const radiusX = shapeWidth / 2 + bleedPixels;
        const radiusY = shapeHeight / 2 + bleedPixels;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(shapeWidth, shapeHeight);
        const startX = shapeX + (shapeWidth - size) / 2 - bleedPixels;
        const startY = shapeY + (shapeHeight - size) / 2 - bleedPixels;
        ctx.rect(startX, startY, size + bleedPixels * 2, size + bleedPixels * 2);
      } else {
        ctx.rect(shapeX - bleedPixels, shapeY - bleedPixels, shapeWidth + bleedPixels * 2, shapeHeight + bleedPixels * 2);
      }
      
      ctx.fill();
      
      // Draw CutContour outline at exact cut position (without bleed)
      ctx.strokeStyle = '#FF00FF';
      ctx.lineWidth = 2;
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
      
      ctx.stroke();

      const croppedCanvas = cropImageToContent(imageInfo.image);
      const sourceImage = croppedCanvas ? croppedCanvas : imageInfo.image;
      
      // Reuse shapePixelsPerInch from above for image sizing
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
      
      if (strokeSettings.enabled && contourCacheRef.current?.canvas && !isProcessing) {
        const contourCanvas = contourCacheRef.current.canvas;
        
        const contourAspectRatio = contourCanvas.width / contourCanvas.height;
        
        let contourWidth, contourHeight;
        if (contourAspectRatio > (availableWidth / availableHeight)) {
          contourWidth = availableWidth;
          contourHeight = availableWidth / contourAspectRatio;
        } else {
          contourHeight = availableHeight;
          contourWidth = availableHeight * contourAspectRatio;
        }
        
        const contourX = (canvasWidth - contourWidth) / 2;
        const contourY = (canvasHeight - contourHeight) / 2;
        
        ctx.drawImage(contourCanvas, contourX, contourY, contourWidth, contourHeight);
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
              onWheel={handleWheel}
              className={`relative rounded-lg border flex items-center justify-center ${getBackgroundStyle()} cursor-zoom-in`}
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
              
              {isProcessing && imageInfo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 text-white mx-auto mb-2 animate-spin" />
                    <p className="text-white text-sm">Processing... {processingProgress}%</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.2))}
                className="h-8 w-8 p-0"
                title="Zoom Out (or scroll down)"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              
              <span className="text-sm text-gray-400 min-w-[50px] text-center font-medium">
                {Math.round(zoom * 100)}%
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(prev => Math.min(prev + 0.1, 3))}
                className="h-8 w-8 p-0"
                title="Zoom In (or scroll up)"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-gray-600 mx-2" />
              
              <Button 
                variant="outline"
                size="sm"
                onClick={fitToView}
                className="h-8 px-2"
                title="Fit to View"
              >
                <Maximize2 className="h-3 w-3 mr-1" />
                Fit
              </Button>
              
              <Button 
                variant="outline"
                size="sm"
                onClick={() => setZoom(1)}
                className="h-8 px-2"
                title="Reset to 100%"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                100%
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
