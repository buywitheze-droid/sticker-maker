import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "@/lib/types";
import { SpotPreviewData } from "./controls-section";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { processContourInWorker } from "@/lib/contour-worker-manager";

interface PreviewSectionProps {
  imageInfo: ImageInfo | null;
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  cadCutBounds?: CadCutBounds | null;
  spotPreviewData?: SpotPreviewData;
  showCutLineInfo?: boolean;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, spotPreviewData, showCutLineInfo }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [previewDims, setPreviewDims] = useState({ width: 360, height: 360 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCanvas, setProcessedCanvas] = useState<HTMLCanvasElement | null>(null);
    const processingIdRef = useRef(0);
    const contourCacheRef = useRef<{key: string; canvas: HTMLCanvasElement} | null>(null);

    // Expose canvas ref to parent
    useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);

    // Resize observer to keep preview responsive
    useEffect(() => {
      if (!containerRef.current) return;
      const updateSize = () => {
        const width = containerRef.current?.clientWidth || 0;
        const height = containerRef.current?.clientHeight || 0;
        const safeWidth = Math.max(220, Math.min(720, width));
        const safeHeight = Math.max(220, Math.min(720, height));
        setPreviewDims({ width: safeWidth || 360, height: safeHeight || 360 });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, []);

    // Fit to view
    const fitToView = useCallback(() => {
      if (!containerRef.current) return;
      const viewPadding = Math.max(
        4,
        Math.round(Math.min(previewDims.width, previewDims.height) * 0.03)
      );
      const containerWidth = containerRef.current.clientWidth - viewPadding * 2;
      const containerHeight = containerRef.current.clientHeight - viewPadding * 2;
      const scaleX = containerWidth / previewDims.width;
      const scaleY = containerHeight / previewDims.height;
      const fitZoom = Math.min(scaleX, scaleY, 1);
      setZoom(Math.max(0.2, Math.round(fitZoom * 20) / 20));
      setPanX(0);
      setPanY(0);
    }, [previewDims.height, previewDims.width]);

    // Generate cache key for contour processing
    const getCacheKey = useCallback(() => {
      if (!imageInfo) return '';
      return JSON.stringify({
        imageSrc: imageInfo.image?.src || 'unknown',
        stroke: strokeSettings,
        resize: resizeSettings,
        shape: shapeSettings
      });
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings]);

    // Process contour when settings change
    useEffect(() => {
      if (!imageInfo?.image) {
        setProcessedCanvas(null);
        return;
      }

      const cacheKey = getCacheKey();
      
      // Check cache
      if (contourCacheRef.current?.key === cacheKey) {
        setProcessedCanvas(contourCacheRef.current.canvas);
        return;
      }

      // Process new contour
      const currentId = ++processingIdRef.current;
      setIsProcessing(true);

      processContourInWorker(
        imageInfo.image,
        {
          width: strokeSettings.width,
          color: strokeSettings.color,
          enabled: strokeSettings.enabled,
          alphaThreshold: strokeSettings.alphaThreshold,
          closeSmallGaps: strokeSettings.closeSmallGaps,
          closeBigGaps: strokeSettings.closeBigGaps,
          backgroundColor: strokeSettings.backgroundColor,
          useCustomBackground: strokeSettings.useCustomBackground,
          autoBridging: strokeSettings.autoBridging ?? true,
          autoBridgingThreshold: strokeSettings.autoBridgingThreshold ?? 0.02,
          cornerMode: strokeSettings.cornerMode ?? 'rounded',
        },
        resizeSettings,
        () => {} // Progress callback
      ).then((resultCanvas) => {
        if (currentId !== processingIdRef.current) return;
        
        contourCacheRef.current = { key: cacheKey, canvas: resultCanvas };
        setProcessedCanvas(resultCanvas);
        setIsProcessing(false);
      }).catch((err) => {
        console.error('[PreviewSection] Contour processing error:', err);
        if (currentId === processingIdRef.current) {
          setIsProcessing(false);
        }
      });
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, getCacheKey]);

    // Render to canvas
    useEffect(() => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = previewDims.width;
      canvas.height = previewDims.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const padding = Math.max(
        4,
        Math.round(Math.min(previewDims.width, previewDims.height) * 0.03)
      );
      const availableWidth = previewDims.width - padding * 2;
      const availableHeight = previewDims.height - padding * 2;

      // Draw checkered background for transparency
      const grid = 10;
      for (let y = 0; y < canvas.height; y += grid) {
        for (let x = 0; x < canvas.width; x += grid) {
          const isEven = ((x / grid) + (y / grid)) % 2 === 0;
          ctx.fillStyle = isEven ? "#e8e8e8" : "#d0d0d0";
          ctx.fillRect(x, y, grid, grid);
        }
      }

      // Draw the processed image or original
      const imageToDraw = processedCanvas || imageInfo?.image;
      if (!imageToDraw) return;

      const imgWidth = imageToDraw.width || (imageToDraw as HTMLImageElement).naturalWidth || 300;
      const imgHeight = imageToDraw.height || (imageToDraw as HTMLImageElement).naturalHeight || 300;
      const aspect = imgWidth / imgHeight;
      
      let drawW = availableWidth;
      let drawH = availableHeight;

      if (aspect > availableWidth / availableHeight) {
        drawW = availableWidth;
        drawH = drawW / aspect;
      } else {
        drawH = availableHeight;
        drawW = drawH * aspect;
      }

      const x = (canvas.width - drawW) / 2;
      const y = (canvas.height - drawH) / 2;

      ctx.drawImage(imageToDraw, x, y, drawW, drawH);
    }, [processedCanvas, imageInfo, previewDims]);

    // Determine aspect ratio for container
    const aspectRatio = processedCanvas 
      ? `${processedCanvas.width} / ${processedCanvas.height}`
      : imageInfo?.image 
        ? `${imageInfo.image.naturalWidth || 1} / ${imageInfo.image.naturalHeight || 1}`
        : "1 / 1";

    return (
      <div className="w-full">
        <div
          ref={containerRef}
          className="relative flex items-center justify-center overflow-hidden rounded-2xl border border-gray-200"
          style={{
            width: "100%",
            maxWidth: 720,
            aspectRatio: aspectRatio,
            maxHeight: "70vh",
            background: "#f8f8f8",
          }}
        >
          {isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent"></div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              transform: `translate(${panX}%, ${panY}%) scale(${zoom})`,
              transformOrigin: "center",
              transition: "transform 200ms ease",
            }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={fitToView}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setZoom(1);
              setPanX(0);
              setPanY(0);
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
);

PreviewSection.displayName = 'PreviewSection';

export default PreviewSection;
