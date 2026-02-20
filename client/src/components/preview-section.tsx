import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette, Loader2, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings } from "./image-editor";
import { SpotPreviewData } from "./controls-section";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { processContourInWorker, type DetectedAlgorithm } from "@/lib/contour-worker-manager";
import { calculateShapeDimensions } from "@/lib/shape-outline";
import { cropImageToContent, getImageBounds, createEdgeBleedCanvas } from "@/lib/image-crop";
import { convertPolygonToCurves, gaussianSmoothContour } from "@/lib/clipper-path";

interface PreviewSectionProps {
  imageInfo: ImageInfo | null;
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  cadCutBounds?: CadCutBounds | null;
  spotPreviewData?: SpotPreviewData;
  showCutLineInfo?: boolean;
  onDetectedAlgorithm?: (algo: DetectedAlgorithm) => void;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, spotPreviewData, showCutLineInfo, onDetectedAlgorithm }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0); // -100 to 100 (percent offset)
    const [panY, setPanY] = useState(0); // -100 to 100 (percent offset)
    const [backgroundColor, setBackgroundColor] = useState("transparent");
    const lastImageRef = useRef<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const contourCacheRef = useRef<{key: string; canvas: HTMLCanvasElement; downsampleScale: number; imageCanvasX: number; imageCanvasY: number} | null>(null);
    const processingIdRef = useRef(0);
    const [showHighlight, setShowHighlight] = useState(false);
    const lastSettingsRef = useRef<string>('');
    const contourDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastImageRenderRef = useRef<{x: number; y: number; width: number; height: number} | null>(null);
    const [previewDims, setPreviewDims] = useState({ width: 360, height: 360 });
    const spotPulseRef = useRef(1);
    const spotAnimFrameRef = useRef<number | null>(null);
    const renderRef = useRef<(() => void) | null>(null);
    
    const spotOverlayCacheRef = useRef<{key: string; canvas: HTMLCanvasElement} | null>(null);
    const checkerboardPatternRef = useRef<{width: number; height: number; pattern: CanvasPattern} | null>(null);
    const croppedImageCacheRef = useRef<{src: string; canvas: HTMLCanvasElement | HTMLImageElement} | null>(null);
    const holographicCacheRef = useRef<{contourKey: string; canvas: HTMLCanvasElement} | null>(null);
    const lastCanvasDimsRef = useRef<{width: number; height: number}>({width: 0, height: 0});
    
    // Drag-to-pan state
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{x: number; y: number; panX: number; panY: number} | null>(null);
    
    const maxPanXY = useCallback(() => {
      const limit = 25 + Math.max(0, (zoom - 1) * 50);
      return { x: limit, y: limit };
    }, [zoom]);
    
    const clampPan = useCallback((px: number, py: number) => {
      const limit = maxPanXY();
      return {
        x: Math.max(-limit.x, Math.min(limit.x, px)),
        y: Math.max(-limit.y, Math.min(limit.y, py)),
      };
    }, [maxPanXY]);
    
    const pxToPanXY = useCallback((dxPx: number, dyPx: number) => {
      const el = canvasRef.current;
      if (!el) return { dx: 0, dy: 0 };
      const w = Math.max(el.clientWidth, 1);
      const h = Math.max(el.clientHeight, 1);
      return { dx: (dxPx / w) * 100, dy: (dyPx / h) * 100 };
    }, []);
    
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
    }, [panX, panY]);
    
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isDragging || !dragStartRef.current) return;
      const d = pxToPanXY(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
      const clamped = clampPan(dragStartRef.current.panX + d.dx, dragStartRef.current.panY + d.dy);
      setPanX(clamped.x);
      setPanY(clamped.y);
    }, [isDragging, pxToPanXY, clampPan]);
    
    const handleMouseUp = useCallback(() => {
      setIsDragging(false);
      dragStartRef.current = null;
    }, []);
    
    const handleMouseLeave = useCallback(() => {
      if (isDragging) {
        setIsDragging(false);
        dragStartRef.current = null;
      }
    }, [isDragging]);
    
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      setIsDragging(true);
      dragStartRef.current = { x: t.clientX, y: t.clientY, panX, panY };
    }, [panX, panY]);
    
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (!isDragging || !dragStartRef.current || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      const d = pxToPanXY(t.clientX - dragStartRef.current.x, t.clientY - dragStartRef.current.y);
      const clamped = clampPan(dragStartRef.current.panX + d.dx, dragStartRef.current.panY + d.dy);
      setPanX(clamped.x);
      setPanY(clamped.y);
    }, [isDragging, pxToPanXY, clampPan]);
    
    const handleTouchEnd = useCallback(() => {
      setIsDragging(false);
      dragStartRef.current = null;
    }, []);
    
    // Fit to View: calculate zoom to fit canvas within container and reset pan
    const fitToView = useCallback(() => {
      if (!containerRef.current) return;
      const viewPadding = Math.max(4, Math.round(Math.min(previewDims.width, previewDims.height) * 0.03));
      const containerWidth = containerRef.current.clientWidth - viewPadding * 2;
      const containerHeight = containerRef.current.clientHeight - viewPadding * 2;
      const scaleX = containerWidth / previewDims.width;
      const scaleY = containerHeight / previewDims.height;
      const fitZoom = Math.min(scaleX, scaleY, 1); // max at 100%
      setZoom(Math.max(0.2, Math.round(fitZoom * 20) / 20)); // round to 5% steps
      setPanX(0);
      setPanY(0);
    }, [previewDims.height, previewDims.width]);
    
    // Reset view to default zoom and pan
    const resetView = useCallback(() => {
      setZoom(1);
      setPanX(0);
      setPanY(0);
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
        spotOverlayCacheRef.current = null;
        croppedImageCacheRef.current = null;
        holographicCacheRef.current = null;
        return;
      }
      
      const imageKey = `${imageInfo.image.src}-${imageInfo.image.width}-${imageInfo.image.height}`;
      if (lastImageRef.current === imageKey) return;
      lastImageRef.current = imageKey;
      spotOverlayCacheRef.current = null;
      croppedImageCacheRef.current = null;
      holographicCacheRef.current = null;
      
      // Check if image has minimal empty space around the edges
      const hasMinimalEmptySpace = checkImageHasMinimalEmptySpace(imageInfo.image);
      if (hasMinimalEmptySpace) {
        setZoom(0.75);
      } else {
        setZoom(1);
      }
    }, [imageInfo]);

    useEffect(() => {
      if (!containerRef.current) return;
      const updateSize = () => {
        const width = containerRef.current?.clientWidth || 0;
        const height = containerRef.current?.clientHeight || 0;
        const safeWidth = Math.max(220, Math.min(720, width));
        const safeHeight = Math.max(220, Math.min(720, height));
        setPreviewDims({
          width: safeWidth || 360,
          height: safeHeight || 360
        });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, []);
    
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

    const getCheckerboardPattern = (ctx: CanvasRenderingContext2D, w: number, h: number): CanvasPattern | null => {
      if (checkerboardPatternRef.current?.width === w && checkerboardPatternRef.current?.height === h) {
        return checkerboardPatternRef.current.pattern;
      }
      const gridSize = 10;
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = gridSize * 2;
      patternCanvas.height = gridSize * 2;
      const pCtx = patternCanvas.getContext('2d');
      if (!pCtx) return null;
      pCtx.fillStyle = '#e8e8e8';
      pCtx.fillRect(0, 0, gridSize * 2, gridSize * 2);
      pCtx.fillStyle = '#d0d0d0';
      pCtx.fillRect(gridSize, 0, gridSize, gridSize);
      pCtx.fillRect(0, gridSize, gridSize, gridSize);
      const pattern = ctx.createPattern(patternCanvas, 'repeat');
      if (pattern) {
        checkerboardPatternRef.current = { width: w, height: h, pattern };
      }
      return pattern;
    };

    const getCachedCroppedImage = (): HTMLCanvasElement | HTMLImageElement => {
      if (!imageInfo) return document.createElement('canvas');
      const src = imageInfo.image.src;
      if (croppedImageCacheRef.current?.src === src) {
        return croppedImageCacheRef.current.canvas;
      }
      const cropped = cropImageToContent(imageInfo.image);
      const result = cropped || imageInfo.image;
      croppedImageCacheRef.current = { src, canvas: result };
      return result;
    };

    // Version bump forces cache invalidation when worker code changes
    const CONTOUR_CACHE_VERSION = 17;
    const generateContourCacheKey = useCallback(() => {
      if (!imageInfo) return '';
      return `v${CONTOUR_CACHE_VERSION}-${imageInfo.image.src}-${strokeSettings.width}-${strokeSettings.alphaThreshold}-${strokeSettings.backgroundColor}-${strokeSettings.useCustomBackground}-${strokeSettings.algorithm}-${strokeSettings.cornerMode}-${strokeSettings.contourMode}-${strokeSettings.autoBridging}-${strokeSettings.autoBridgingThreshold}-${resizeSettings.widthInches}-${resizeSettings.heightInches}`;
    }, [imageInfo, strokeSettings.width, strokeSettings.alphaThreshold, strokeSettings.backgroundColor, strokeSettings.useCustomBackground, strokeSettings.algorithm, strokeSettings.cornerMode, strokeSettings.contourMode, strokeSettings.autoBridging, strokeSettings.autoBridgingThreshold, resizeSettings.widthInches, resizeSettings.heightInches]);

    useEffect(() => {
      // Clear any pending debounce
      if (contourDebounceRef.current) {
        clearTimeout(contourDebounceRef.current);
        contourDebounceRef.current = null;
      }
      
      if (!imageInfo || !strokeSettings.enabled || shapeSettings.enabled) {
        contourCacheRef.current = null;
        return;
      }

      const cacheKey = generateContourCacheKey();
      if (contourCacheRef.current?.key === cacheKey) return;

      // Debounce processing to avoid rapid re-renders during slider drags
      contourDebounceRef.current = setTimeout(() => {
        const currentId = ++processingIdRef.current;
        setIsProcessing(true);
        setProcessingProgress(0);

        const previewStrokeSettings = { ...strokeSettings, color: '#FF00FF' };
        const workerResizeSettings = {
          widthInches: resizeSettings.widthInches,
          heightInches: resizeSettings.heightInches,
          maintainAspectRatio: resizeSettings.maintainAspectRatio,
          outputDPI: 100
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
        ).then((result) => {
          if (processingIdRef.current === currentId) {
            contourCacheRef.current = { key: cacheKey, canvas: result.canvas, downsampleScale: result.downsampleScale, imageCanvasX: result.imageCanvasX, imageCanvasY: result.imageCanvasY };
            setIsProcessing(false);
            if (result.detectedAlgorithm && onDetectedAlgorithm) {
              onDetectedAlgorithm(result.detectedAlgorithm);
            }
          }
        }).catch((error) => {
          console.error('Contour processing error:', error);
          if (processingIdRef.current === currentId) {
            setIsProcessing(false);
          }
        });
      }, 100); // 100ms debounce for smoother slider interaction
      
      return () => {
        if (contourDebounceRef.current) {
          clearTimeout(contourDebounceRef.current);
        }
      };
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings.enabled, generateContourCacheKey]);

    useEffect(() => {
      if (!canvasRef.current || !imageInfo) return;

      const doRender = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const canvasWidth = previewDims.width;
      const canvasHeight = previewDims.height;
      if (lastCanvasDimsRef.current.width !== canvasWidth || lastCanvasDimsRef.current.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        lastCanvasDimsRef.current = { width: canvasWidth, height: canvasHeight };
      } else {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      }

      // Determine which background color to use:
      // - For PDFs with CutContour, use strokeSettings.backgroundColor
      // - For regular images, use local backgroundColor state
      const hasPdfCutContour = imageInfo.isPDF && imageInfo.pdfCutContourInfo?.hasCutContour;
      const effectiveBackgroundColor = hasPdfCutContour 
        ? strokeSettings.backgroundColor 
        : backgroundColor;

      // For PDFs with CutContour, we need special rendering to clip background to the cut path
      if (hasPdfCutContour && imageInfo.pdfCutContourInfo) {
        const cutContourInfo = imageInfo.pdfCutContourInfo;
        const hasExtractedPaths = cutContourInfo.cutContourPoints && cutContourInfo.cutContourPoints.length > 0;
        const viewPadding = Math.max(4, Math.round(Math.min(canvasWidth, canvasHeight) * 0.03));
        const availableWidth = canvas.width - (viewPadding * 2);
        const availableHeight = canvas.height - (viewPadding * 2);
        
        // Get actual content bounds of the rendered PDF (removes empty space and white background)
        const contentBounds = getImageBounds(imageInfo.image, true);
        
        // Use content bounds for sizing, not full PDF page size
        const contentWidth = contentBounds.width;
        const contentHeight = contentBounds.height;
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const scale = Math.min(scaleX, scaleY);
        
        const scaledWidth = contentWidth * scale;
        const scaledHeight = contentHeight * scale;
        const offsetX = viewPadding + (availableWidth - scaledWidth) / 2;
        const offsetY = viewPadding + (availableHeight - scaledHeight) / 2;
        
        // Store content bounds offset for image drawing
        const contentOffsetX = contentBounds.x;
        const contentOffsetY = contentBounds.y;
        
        // Bleed offset based on content scale (0.10 inches at render DPI)
        const bleedInches = 0.10;
        const renderDPI = imageInfo.pdfCutContourInfo.pageWidth ? 
          (imageInfo.image.naturalWidth / (imageInfo.pdfCutContourInfo.pageWidth / 72 * 72)) : 300;
        const bleedPixelsAtRender = bleedInches * renderDPI;
        const bleedPixels = bleedPixelsAtRender * scale;
        
        // Draw checkerboard background using cached pattern
        const checkerPattern = getCheckerboardPattern(ctx, canvas.width, canvas.height);
        if (checkerPattern) {
          ctx.fillStyle = checkerPattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        // Create clipping path - use extracted paths if available, otherwise use image bounds
        ctx.save();
        ctx.beginPath();
        
        if (hasExtractedPaths) {
          // Use extracted CutContour paths with bleed expansion
          for (const path of cutContourInfo.cutContourPoints) {
            if (path.length < 2) continue;
            
            // Calculate centroid of path for offset direction
            let cx = 0, cy = 0;
            for (const pt of path) {
              cx += offsetX + pt.x * scale;
              cy += offsetY + pt.y * scale;
            }
            cx /= path.length;
            cy /= path.length;
            
            // Draw path with bleed expansion (offset away from centroid)
            const firstX = offsetX + path[0].x * scale;
            const firstY = offsetY + path[0].y * scale;
            const firstDist = Math.sqrt((firstX - cx) ** 2 + (firstY - cy) ** 2);
            const firstExpandX = firstDist > 0 ? (firstX - cx) / firstDist * bleedPixels : 0;
            const firstExpandY = firstDist > 0 ? (firstY - cy) / firstDist * bleedPixels : 0;
            
            ctx.moveTo(firstX + firstExpandX, firstY + firstExpandY);
            
            for (let i = 1; i < path.length; i++) {
              const px = offsetX + path[i].x * scale;
              const py = offsetY + path[i].y * scale;
              const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
              const expandX = dist > 0 ? (px - cx) / dist * bleedPixels : 0;
              const expandY = dist > 0 ? (py - cy) / dist * bleedPixels : 0;
              ctx.lineTo(px + expandX, py + expandY);
            }
            ctx.closePath();
          }
        } else {
          // Fallback: use image bounds with bleed for clipping
          const clipX = offsetX - bleedPixels;
          const clipY = offsetY - bleedPixels;
          const clipW = scaledWidth + bleedPixels * 2;
          const clipH = scaledHeight + bleedPixels * 2;
          ctx.rect(clipX, clipY, clipW, clipH);
          ctx.closePath();
          
          // Fill background color for the fallback rect area directly
          if (effectiveBackgroundColor !== "transparent") {
            if (effectiveBackgroundColor === "holographic") {
              const gradient = ctx.createLinearGradient(clipX, clipY, clipX + clipW, clipY + clipH);
              gradient.addColorStop(0, '#C8C8D0');
              gradient.addColorStop(0.17, '#E8B8B8');
              gradient.addColorStop(0.34, '#B8D8E8');
              gradient.addColorStop(0.51, '#E8D0F0');
              gradient.addColorStop(0.68, '#B0C8E0');
              gradient.addColorStop(0.85, '#C0B0D8');
              gradient.addColorStop(1, '#C8C8D0');
              ctx.fillStyle = gradient;
            } else {
              ctx.fillStyle = effectiveBackgroundColor;
            }
            ctx.fillRect(clipX, clipY, clipW, clipH);
          }
          
          // Clip and draw only the content portion of the image
          ctx.clip();
          ctx.drawImage(
            imageInfo.image,
            contentOffsetX, contentOffsetY, contentWidth, contentHeight,
            offsetX, offsetY, scaledWidth, scaledHeight
          );
          ctx.restore();
          
          // Draw image bounds as cut indicator
          ctx.save();
          ctx.strokeStyle = '#FF00FF';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(offsetX, offsetY, scaledWidth, scaledHeight);
          ctx.restore();
          return; // Early return for fallback case
        }
        
        // For extracted paths: fill the path, then clip for the image
        if (effectiveBackgroundColor !== "transparent") {
          if (effectiveBackgroundColor === "holographic") {
            const bounds = ctx.getTransform();
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, '#C8C8D0');
            gradient.addColorStop(0.17, '#E8B8B8');
            gradient.addColorStop(0.34, '#B8D8E8');
            gradient.addColorStop(0.51, '#E8D0F0');
            gradient.addColorStop(0.68, '#B0C8E0');
            gradient.addColorStop(0.85, '#C0B0D8');
            gradient.addColorStop(1, '#C8C8D0');
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = effectiveBackgroundColor;
          }
          ctx.fill();
        }
        
        ctx.clip();
        
        // Draw only the content portion of the image inside the clipped region
        ctx.drawImage(
          imageInfo.image,
          contentOffsetX, contentOffsetY, contentWidth, contentHeight,
          offsetX, offsetY, scaledWidth, scaledHeight
        );
        
        ctx.restore();
        
        // Draw the CutContour path indicator (magenta dashed line) with curve detection
        if (hasExtractedPaths) {
          ctx.save();
          ctx.strokeStyle = '#FF00FF';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          
          for (const path of cutContourInfo.cutContourPoints) {
            if (path.length < 2) continue;
            ctx.beginPath();
            
            // Smooth the contour first to reduce jagged edges from alpha tracing
            const smoothedPath = gaussianSmoothContour(path, 2);
            
            // Convert path to curves for smooth rendering (60+ point curves)
            const segments = convertPolygonToCurves(smoothedPath, 70);
            
            for (const seg of segments) {
              if (seg.type === 'move' && seg.point) {
                ctx.moveTo(offsetX + seg.point.x * scale, offsetY + seg.point.y * scale);
              } else if (seg.type === 'line' && seg.point) {
                ctx.lineTo(offsetX + seg.point.x * scale, offsetY + seg.point.y * scale);
              } else if (seg.type === 'curve' && seg.cp1 && seg.cp2 && seg.end) {
                ctx.bezierCurveTo(
                  offsetX + seg.cp1.x * scale, offsetY + seg.cp1.y * scale,
                  offsetX + seg.cp2.x * scale, offsetY + seg.cp2.y * scale,
                  offsetX + seg.end.x * scale, offsetY + seg.end.y * scale
                );
              }
            }
            
            ctx.closePath();
            ctx.stroke();
          }
          
          ctx.restore();
        } else {
          // Draw image bounds as cut indicator when no paths extracted
          ctx.save();
          ctx.strokeStyle = '#FF00FF';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(offsetX, offsetY, scaledWidth, scaledHeight);
          ctx.restore();
        }
      } else {
        // Regular image rendering (non-PDF or no CutContour)
        
        // For shape mode, always use a solid light background to show cut area
        if (shapeSettings.enabled) {
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          drawShapePreview(ctx, canvas.width, canvas.height);
        } else if (effectiveBackgroundColor === "transparent") {
          const checkerPattern = getCheckerboardPattern(ctx, canvas.width, canvas.height);
          if (checkerPattern) {
            ctx.fillStyle = checkerPattern;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          drawImageWithResizePreview(ctx, canvas.width, canvas.height);
        } else {
          if (effectiveBackgroundColor === "holographic") {
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, '#C8C8D0');
            gradient.addColorStop(0.17, '#E8B8B8');
            gradient.addColorStop(0.34, '#B8D8E8');
            gradient.addColorStop(0.51, '#E8D0F0');
            gradient.addColorStop(0.68, '#B0C8E0');
            gradient.addColorStop(0.85, '#C0B0D8');
            gradient.addColorStop(1, '#C8C8D0');
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = effectiveBackgroundColor;
          }
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          drawImageWithResizePreview(ctx, canvas.width, canvas.height);
        }

      }
      };
      doRender();
      renderRef.current = doRender;
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, backgroundColor, isProcessing, spotPreviewData, previewDims.height, previewDims.width]);

    useEffect(() => {
      if (!spotPreviewData?.enabled) {
        spotPulseRef.current = 1;
        if (spotAnimFrameRef.current !== null) {
          cancelAnimationFrame(spotAnimFrameRef.current);
          spotAnimFrameRef.current = null;
        }
        return;
      }
      
      const whiteColors = spotPreviewData.colors.filter(c => c.spotWhite);
      const glossColors = spotPreviewData.colors.filter(c => c.spotGloss);
      
      if (whiteColors.length === 0 && glossColors.length === 0) {
        spotPulseRef.current = 1;
        if (spotAnimFrameRef.current !== null) {
          cancelAnimationFrame(spotAnimFrameRef.current);
          spotAnimFrameRef.current = null;
        }
        return;
      }
      
      let startTime: number | null = null;
      let lastFrameTime = 0;
      const FRAME_INTERVAL = 1000 / 30;
      
      const animate = (timestamp: number) => {
        if (startTime === null) startTime = timestamp;
        
        if (timestamp - lastFrameTime >= FRAME_INTERVAL) {
          lastFrameTime = timestamp;
          const elapsed = (timestamp - startTime) / 1000;
          spotPulseRef.current = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 1.5));
          
          if (renderRef.current) {
            renderRef.current();
          }
        }
        
        spotAnimFrameRef.current = requestAnimationFrame(animate);
      };
      
      spotAnimFrameRef.current = requestAnimationFrame(animate);
      
      return () => {
        if (spotAnimFrameRef.current !== null) {
          cancelAnimationFrame(spotAnimFrameRef.current);
          spotAnimFrameRef.current = null;
        }
        spotPulseRef.current = 1;
      };
    }, [spotPreviewData]);

    const createSpotOverlayCanvas = (source?: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement | null => {
      if (!imageInfo || !spotPreviewData?.enabled) return null;
      
      const whiteColors = spotPreviewData.colors.filter(c => c.spotWhite);
      const glossColors = spotPreviewData.colors.filter(c => c.spotGloss);
      
      if (whiteColors.length === 0 && glossColors.length === 0) return null;
      
      const img = source || imageInfo.image;
      const imgIdentity = (img as HTMLImageElement).src || `${img.width}x${img.height}`;
      const cacheKey = `${imgIdentity}-${img.width}x${img.height}-${whiteColors.map(c => c.hex).join(',')}-${glossColors.map(c => c.hex).join(',')}`;
      
      if (spotOverlayCacheRef.current?.key === cacheKey) {
        return spotOverlayCacheRef.current.canvas;
      }
      
      const srcCanvas = document.createElement('canvas');
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) return null;
      
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      srcCtx.drawImage(img, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
      
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = srcCanvas.width;
      overlayCanvas.height = srcCanvas.height;
      const overlayCtx = overlayCanvas.getContext('2d');
      if (!overlayCtx) return null;
      
      const overlayData = overlayCtx.createImageData(srcCanvas.width, srcCanvas.height);
      
      const parsedWhite = whiteColors.map(c => ({
        r: parseInt(c.hex.slice(1, 3), 16),
        g: parseInt(c.hex.slice(3, 5), 16),
        b: parseInt(c.hex.slice(5, 7), 16),
      }));
      const parsedGloss = glossColors.map(c => ({
        r: parseInt(c.hex.slice(1, 3), 16),
        g: parseInt(c.hex.slice(3, 5), 16),
        b: parseInt(c.hex.slice(5, 7), 16),
      }));
      const tolerance = 30;
      
      const pixels = srcData.data;
      const out = overlayData.data;
      const len = pixels.length;
      
      for (let idx = 0; idx < len; idx += 4) {
        const a = pixels[idx + 3];
        if (a < 128) continue;
        
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        
        let matched = false;
        for (let j = 0; j < parsedWhite.length; j++) {
          const t = parsedWhite[j];
          if (Math.abs(r - t.r) <= tolerance && Math.abs(g - t.g) <= tolerance && Math.abs(b - t.b) <= tolerance) {
            out[idx] = 255; out[idx + 1] = 255; out[idx + 2] = 255; out[idx + 3] = 255;
            matched = true;
            break;
          }
        }
        
        if (!matched) {
          for (let j = 0; j < parsedGloss.length; j++) {
            const t = parsedGloss[j];
            if (Math.abs(r - t.r) <= tolerance && Math.abs(g - t.g) <= tolerance && Math.abs(b - t.b) <= tolerance) {
              out[idx] = 180; out[idx + 1] = 180; out[idx + 2] = 190; out[idx + 3] = 255;
              break;
            }
          }
        }
      }
      
      overlayCtx.putImageData(overlayData, 0, 0);
      spotOverlayCacheRef.current = { key: cacheKey, canvas: overlayCanvas };
      return overlayCanvas;
    };

    useEffect(() => {
      if (!imageInfo) return;
      const settingsKey = `${strokeSettings.enabled}-${strokeSettings.width}-${shapeSettings.enabled}-${shapeSettings.type}-${resizeSettings.widthInches}`;
      if (lastSettingsRef.current && lastSettingsRef.current !== settingsKey) {
        setShowHighlight(true);
        const timer = setTimeout(() => setShowHighlight(false), 500);
        return () => clearTimeout(timer);
      }
      lastSettingsRef.current = settingsKey;
    }, [imageInfo, strokeSettings.enabled, strokeSettings.width, shapeSettings.enabled, shapeSettings.type, resizeSettings.widthInches]);

    const drawShapePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      const shapeDims = calculateShapeDimensions(
        resizeSettings.widthInches,
        resizeSettings.heightInches,
        shapeSettings.type,
        shapeSettings.offset
      );

      const bleedInches = 0.10; // 0.10" bleed around the shape
      const padding = Math.max(4, Math.round(Math.min(canvasWidth, canvasHeight) * 0.03));
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
      
      // Calculate bleed in pixels based on shape scale (only if bleed is enabled)
      const shapePixelsPerInch = Math.min(shapeWidth / shapeDims.widthInches, shapeHeight / shapeDims.heightInches);
      const bleedPixels = shapeSettings.bleedEnabled ? bleedInches * shapePixelsPerInch : 0;
      
      const cornerRadiusPixels = (shapeSettings.cornerRadius || 0.25) * shapePixelsPerInch;
      
      const sourceImage = getCachedCroppedImage();
      
      // Image dimensions within the shape
      let imageWidth = resizeSettings.widthInches * shapePixelsPerInch;
      let imageHeight = resizeSettings.heightInches * shapePixelsPerInch;
      
      // For circles and ovals, do NOT scale down the image - let it fill naturally
      // The image will be clipped to the shape boundary below, so corners that extend
      // beyond the circle/oval are simply cropped away, giving a tight fit
      
      const imageX = shapeX + (shapeWidth - imageWidth) / 2;
      const imageY = shapeY + (shapeHeight - imageHeight) / 2;
      
      // Draw background with bleed or fill
      if (shapeSettings.bleedEnabled) {
        // Solid color bleed mode - draw bleed area with bleedColor first
        ctx.fillStyle = shapeSettings.bleedColor || '#FFFFFF';
        ctx.beginPath();
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(shapeWidth, shapeHeight) / 2 + bleedPixels;
          ctx.arc(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, radius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          ctx.ellipse(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, shapeWidth / 2 + bleedPixels, shapeHeight / 2 + bleedPixels, 0, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.rect(shapeX + (shapeWidth - size) / 2 - bleedPixels, shapeY + (shapeHeight - size) / 2 - bleedPixels, size + bleedPixels * 2, size + bleedPixels * 2);
        } else if (shapeSettings.type === 'rounded-square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.roundRect(shapeX + (shapeWidth - size) / 2 - bleedPixels, shapeY + (shapeHeight - size) / 2 - bleedPixels, size + bleedPixels * 2, size + bleedPixels * 2, cornerRadiusPixels);
        } else if (shapeSettings.type === 'rounded-rectangle') {
          ctx.roundRect(shapeX - bleedPixels, shapeY - bleedPixels, shapeWidth + bleedPixels * 2, shapeHeight + bleedPixels * 2, cornerRadiusPixels);
        } else {
          ctx.rect(shapeX - bleedPixels, shapeY - bleedPixels, shapeWidth + bleedPixels * 2, shapeHeight + bleedPixels * 2);
        }
        ctx.fill();
        
        // Then draw the fill color on top (within the cut line)
        // Handle holographic fill with animated rainbow gradient for preview
        if (shapeSettings.fillColor === 'holographic') {
          const gradient = ctx.createLinearGradient(shapeX, shapeY, shapeX + shapeWidth, shapeY + shapeHeight);
          gradient.addColorStop(0, '#C8C8D0');
          gradient.addColorStop(0.17, '#E8B8B8');
          gradient.addColorStop(0.34, '#B8D8E8');
          gradient.addColorStop(0.51, '#E8D0F0');
          gradient.addColorStop(0.68, '#B0C8E0');
          gradient.addColorStop(0.85, '#C0B0D8');
          gradient.addColorStop(1, '#C8C8D0');
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = shapeSettings.fillColor;
        }
        ctx.beginPath();
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(shapeWidth, shapeHeight) / 2;
          ctx.arc(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, radius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          ctx.ellipse(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.rect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size);
        } else if (shapeSettings.type === 'rounded-square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.roundRect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size, cornerRadiusPixels);
        } else if (shapeSettings.type === 'rounded-rectangle') {
          ctx.roundRect(shapeX, shapeY, shapeWidth, shapeHeight, cornerRadiusPixels);
        } else {
          ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
        }
        ctx.fill();
      } else {
        // Solid fill mode
        // Handle holographic fill with rainbow gradient for preview
        if (shapeSettings.fillColor === 'holographic') {
          const gradient = ctx.createLinearGradient(shapeX, shapeY, shapeX + shapeWidth, shapeY + shapeHeight);
          gradient.addColorStop(0, '#C8C8D0');
          gradient.addColorStop(0.17, '#E8B8B8');
          gradient.addColorStop(0.34, '#B8D8E8');
          gradient.addColorStop(0.51, '#E8D0F0');
          gradient.addColorStop(0.68, '#B0C8E0');
          gradient.addColorStop(0.85, '#C0B0D8');
          gradient.addColorStop(1, '#C8C8D0');
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = shapeSettings.fillColor;
        }
        ctx.beginPath();
        
        if (shapeSettings.type === 'circle') {
          const radius = Math.min(shapeWidth, shapeHeight) / 2;
          ctx.arc(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, radius, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'oval') {
          ctx.ellipse(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
        } else if (shapeSettings.type === 'square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.rect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size);
        } else if (shapeSettings.type === 'rounded-square') {
          const size = Math.min(shapeWidth, shapeHeight);
          ctx.roundRect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size, cornerRadiusPixels);
        } else if (shapeSettings.type === 'rounded-rectangle') {
          ctx.roundRect(shapeX, shapeY, shapeWidth, shapeHeight, cornerRadiusPixels);
        } else {
          ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
        }
        
        ctx.fill();
      }
      
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
      } else if (shapeSettings.type === 'rounded-square') {
        const size = Math.min(shapeWidth, shapeHeight);
        const startX = shapeX + (shapeWidth - size) / 2;
        const startY = shapeY + (shapeHeight - size) / 2;
        ctx.roundRect(startX, startY, size, size, cornerRadiusPixels);
      } else if (shapeSettings.type === 'rounded-rectangle') {
        ctx.roundRect(shapeX, shapeY, shapeWidth, shapeHeight, cornerRadiusPixels);
      } else {
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.stroke();

      // Draw the original image on top (clipped to cut line)
      ctx.save();
      ctx.beginPath();
      
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidth, shapeHeight) / 2;
        ctx.arc(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, radius, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'oval') {
        ctx.ellipse(shapeX + shapeWidth / 2, shapeY + shapeHeight / 2, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(shapeWidth, shapeHeight);
        ctx.rect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size);
      } else if (shapeSettings.type === 'rounded-square') {
        const size = Math.min(shapeWidth, shapeHeight);
        ctx.roundRect(shapeX + (shapeWidth - size) / 2, shapeY + (shapeHeight - size) / 2, size, size, cornerRadiusPixels);
      } else if (shapeSettings.type === 'rounded-rectangle') {
        ctx.roundRect(shapeX, shapeY, shapeWidth, shapeHeight, cornerRadiusPixels);
      } else {
        ctx.rect(shapeX, shapeY, shapeWidth, shapeHeight);
      }
      
      ctx.clip();
      ctx.drawImage(sourceImage, imageX, imageY, imageWidth, imageHeight);
      
      const spotOverlay = createSpotOverlayCanvas(sourceImage);
      if (spotOverlay) {
        ctx.save();
        ctx.globalAlpha = spotPulseRef.current;
        ctx.drawImage(spotOverlay, imageX, imageY, imageWidth, imageHeight);
        ctx.restore();
      }
      
      ctx.restore();
    };

    const drawImageWithResizePreview = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      if (!imageInfo) return;

      const viewPadding = Math.max(4, Math.round(Math.min(canvasWidth, canvasHeight) * 0.03));
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
        
        if (strokeSettings.backgroundColor === 'holographic') {
          const holoKey = `${contourCacheRef.current?.key || ''}-${contourCanvas.width}x${contourCanvas.height}`;
          let holoCanvas = holographicCacheRef.current?.contourKey === holoKey ? holographicCacheRef.current.canvas : null;
          
          if (!holoCanvas) {
            holoCanvas = document.createElement('canvas');
            holoCanvas.width = contourCanvas.width;
            holoCanvas.height = contourCanvas.height;
            const tempCtx = holoCanvas.getContext('2d')!;
            tempCtx.drawImage(contourCanvas, 0, 0);
            
            const imageData = tempCtx.getImageData(0, 0, holoCanvas.width, holoCanvas.height);
            const pixels = imageData.data;
            
            const gradientCanvas = document.createElement('canvas');
            gradientCanvas.width = holoCanvas.width;
            gradientCanvas.height = holoCanvas.height;
            const gradCtx = gradientCanvas.getContext('2d')!;
            const gradient = gradCtx.createLinearGradient(0, 0, gradientCanvas.width, gradientCanvas.height);
            gradient.addColorStop(0, '#C8C8D0');
            gradient.addColorStop(0.17, '#E8B8B8');
            gradient.addColorStop(0.34, '#B8D8E8');
            gradient.addColorStop(0.51, '#E8D0F0');
            gradient.addColorStop(0.68, '#B0C8E0');
            gradient.addColorStop(0.85, '#C0B0D8');
            gradient.addColorStop(1, '#C8C8D0');
            gradCtx.fillStyle = gradient;
            gradCtx.fillRect(0, 0, gradientCanvas.width, gradientCanvas.height);
            const gradientData = gradCtx.getImageData(0, 0, gradientCanvas.width, gradientCanvas.height);
            const gradPixels = gradientData.data;
            
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 3] > 200 && pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) {
                pixels[i] = gradPixels[i];
                pixels[i + 1] = gradPixels[i + 1];
                pixels[i + 2] = gradPixels[i + 2];
              }
            }
            
            tempCtx.putImageData(imageData, 0, 0);
            holographicCacheRef.current = { contourKey: holoKey, canvas: holoCanvas };
          }
          
          ctx.drawImage(holoCanvas, contourX, contourY, contourWidth, contourHeight);
        } else {
          ctx.drawImage(contourCanvas, contourX, contourY, contourWidth, contourHeight);
        }
        
        const spotOverlay = createSpotOverlayCanvas();
        if (spotOverlay) {
          const dsScale = contourCacheRef.current?.downsampleScale ?? 1;
          const dsWidth = Math.round(imageInfo.image.width * dsScale);
          const dsHeight = Math.round(imageInfo.image.height * dsScale);
          const imgX = contourCacheRef.current?.imageCanvasX ?? 0;
          const imgY = contourCacheRef.current?.imageCanvasY ?? 0;
          
          const scaleX = contourWidth / contourCanvas.width;
          const scaleY = contourHeight / contourCanvas.height;
          
          const spotX = contourX + (imgX * scaleX);
          const spotY = contourY + (imgY * scaleY);
          const spotWidth = dsWidth * scaleX;
          const spotHeight = dsHeight * scaleY;
          
          ctx.save();
          ctx.globalAlpha = spotPulseRef.current;
          ctx.drawImage(spotOverlay, spotX, spotY, spotWidth, spotHeight);
          ctx.restore();
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
        
        const spotOverlay = createSpotOverlayCanvas();
        if (spotOverlay) {
          ctx.save();
          ctx.globalAlpha = spotPulseRef.current;
          ctx.drawImage(spotOverlay, displayX, displayY, displayWidth, displayHeight);
          ctx.restore();
        }
      }
    };

    const getBackgroundStyle = () => {
      // For PDFs with CutContour, use strokeSettings.backgroundColor
      const hasPdfCutContour = imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour;
      const effectiveBg = hasPdfCutContour ? strokeSettings.backgroundColor : backgroundColor;
      if (effectiveBg === "transparent") {
        return "checkerboard";
      }
      return "";
    };

    const getBackgroundColor = () => {
      // For PDFs with CutContour, use strokeSettings.backgroundColor
      const hasPdfCutContour = imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour;
      const effectiveBg = hasPdfCutContour ? strokeSettings.backgroundColor : backgroundColor;
      if (effectiveBg === "transparent") {
        return "transparent";
      }
      return effectiveBg;
    };

    return (
      <div className="w-full">
        <Card className="bg-white border-gray-100 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            {/* Hide preview color selector for PDFs with CutContour - they use PDF Options instead */}
            {!(imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour) && (
              <div className="mb-3 flex items-center gap-3 bg-gray-50/70 p-2 rounded-lg">
                <Palette className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600">Preview</span>
                <Select value={backgroundColor} onValueChange={setBackgroundColor}>
                  <SelectTrigger className="w-28 h-8 text-sm bg-white border-gray-200 rounded-md">
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
            )}

            <div className="flex flex-col items-start">
              <div className="flex w-full">
                <div 
                  ref={containerRef}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`relative w-full max-w-[720px] rounded-xl border border-gray-200 flex items-center justify-center ${getBackgroundStyle()} ${zoom !== 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'} transition-all duration-300 ${showHighlight ? 'ring-4 ring-cyan-400 ring-opacity-75' : ''}`}
                  style={{ 
                    width: '100%',
                    height: '100%',
                    aspectRatio: imageInfo ? `${imageInfo.image.width} / ${imageInfo.image.height}` : '1 / 1',
                    maxHeight: '70vh',
                    backgroundColor: getBackgroundColor(),
                    overflow: 'hidden',
                    userSelect: 'none',
                    touchAction: 'none'
                  }}
                >
                <canvas 
                  ref={canvasRef}
                  className="relative z-10 block"
                  style={{ 
                    maxWidth: '100%',
                    maxHeight: '100%',
                    transform: `translate(${panX}%, ${panY}%) scale(${zoom})`,
                    transformOrigin: 'center',
                    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                    cursor: isDragging ? 'grabbing' : 'grab'
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
                
                {zoom !== 1 && (
                  <div className="hidden md:flex w-2 flex-col ml-1" style={{ height: `${previewDims.height}px` }}>
                    <div 
                      className="flex-1 bg-gray-300/60 rounded relative cursor-pointer"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = (e.clientY - rect.top) / rect.height;
                        const limit = maxPanXY().y;
                        setPanY(limit - (y * limit * 2));
                      }}
                    >
                      <div 
                        className="absolute left-0 right-0 h-12 bg-gray-500 hover:bg-cyan-500 rounded transition-colors"
                        style={{ top: `${maxPanXY().y > 0 ? ((maxPanXY().y - panY) / (maxPanXY().y * 2)) * 100 : 50}%`, transform: 'translateY(-50%)' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const startY = e.clientY;
                          const startPan = panY;
                          const parent = e.currentTarget.parentElement!;
                          const height = parent.getBoundingClientRect().height;
                          const limit = maxPanXY().y;
                          
                          const onMove = (ev: MouseEvent) => {
                            const delta = (ev.clientY - startY) / height * limit * 2;
                            setPanY(Math.max(-limit, Math.min(limit, startPan - delta)));
                          };
                          const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                          };
                          document.addEventListener('mousemove', onMove);
                          document.addEventListener('mouseup', onUp);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex">
                {zoom !== 1 && (
                  <div className="hidden md:flex h-2 mt-1" style={{ width: `${previewDims.width}px` }}>
                    <div 
                      className="flex-1 bg-gray-300/60 rounded relative cursor-pointer"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = (e.clientX - rect.left) / rect.width;
                        const limit = maxPanXY().x;
                        setPanX((x * limit * 2) - limit);
                      }}
                    >
                      <div 
                        className="absolute top-0 bottom-0 w-12 bg-gray-500 hover:bg-cyan-500 rounded transition-colors"
                        style={{ left: `${maxPanXY().x > 0 ? ((panX + maxPanXY().x) / (maxPanXY().x * 2)) * 100 : 50}%`, transform: 'translateX(-50%)' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const startX = e.clientX;
                          const startPan = panX;
                          const parent = e.currentTarget.parentElement!;
                          const width = parent.getBoundingClientRect().width;
                          const limit = maxPanXY().x;
                          
                          const onMove = (ev: MouseEvent) => {
                            const delta = (ev.clientX - startX) / width * limit * 2;
                            setPanX(Math.max(-limit, Math.min(limit, startPan + delta)));
                          };
                          const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                          };
                          document.addEventListener('mousemove', onMove);
                          document.addEventListener('mouseup', onUp);
                        }}
                      />
                    </div>
                  </div>
                )}
                {zoom !== 1 && <div className="hidden md:block w-2 h-2 mt-1 ml-1" />}
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-center gap-1.5 bg-gray-50/50 rounded-lg p-1.5 border border-gray-100">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.2))}
                  className="h-7 w-7 p-0 hover:bg-gray-100 rounded-md"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5 text-gray-500" />
                </Button>
                
                <span className="text-xs text-gray-500 min-w-[42px] text-center font-medium">
                  {Math.round(zoom * 100)}%
                </span>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(prev => Math.min(prev + 0.1, 3))}
                  className="h-7 w-7 p-0 hover:bg-gray-100 rounded-md"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5 text-gray-500" />
                </Button>
                
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={fitToView}
                  className="h-7 px-2 hover:bg-gray-100 rounded-md text-gray-500 text-xs"
                  title="Fit to View"
                >
                  <Maximize2 className="h-3 w-3 mr-1" />
                  Fit
                </Button>
                
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={resetView}
                  className="h-7 px-2 hover:bg-gray-100 rounded-md text-gray-500 text-xs"
                  title="Reset"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
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
