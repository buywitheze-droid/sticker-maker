import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Palette, Loader2, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings, type LockedContour, type ImageTransform, type DesignItem } from "./image-editor";
import { computeLayerRect } from "@/lib/types";

const DPI_SCALE = 2;
const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M4 12a8 8 0 0 1 14.93-4'/%3E%3Cpath d='m19 4 0 4-4 0'/%3E%3Cpath d='M20 12a8 8 0 0 1-14.93 4'/%3E%3Cpath d='m5 20 0-4 4 0'/%3E%3C/svg%3E") 10 10, pointer`;
import { SpotPreviewData } from "./controls-section";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { processContourInWorker, type DetectedAlgorithm, type DetectedShapeInfo } from "@/lib/contour-worker-manager";
import { calculateShapeDimensions } from "@/lib/shape-outline";
import { cropImageToContent, getImageBounds } from "@/lib/image-crop";
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
  detectedShapeType?: 'circle' | 'oval' | 'square' | 'rectangle' | null;
  detectedShapeInfo?: DetectedShapeInfo | null;
  detectedAlgorithm?: DetectedAlgorithm;
  onStrokeChange?: (settings: Partial<StrokeSettings>) => void;
  lockedContour?: LockedContour | null;
  artboardWidth?: number;
  artboardHeight?: number;
  designTransform?: ImageTransform;
  onTransformChange?: (transform: ImageTransform) => void;
  designs?: DesignItem[];
  selectedDesignId?: string | null;
  onSelectDesign?: (id: string | null) => void;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, spotPreviewData, showCutLineInfo, onDetectedAlgorithm, detectedShapeType, detectedShapeInfo, detectedAlgorithm, onStrokeChange, lockedContour, artboardWidth = 24, artboardHeight = 12, designTransform, onTransformChange, designs = [], selectedDesignId, onSelectDesign }, ref) => {
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
    const contourTransformRef = useRef<{x: number; y: number; width: number; height: number; canvasW: number; canvasH: number} | null>(null);
    const lastCanvasDimsRef = useRef<{width: number; height: number}>({width: 0, height: 0});
    
    const [editingRotation, setEditingRotation] = useState(false);
    const [rotationInput, setRotationInput] = useState('0');
    const [overlappingDesigns, setOverlappingDesigns] = useState<Set<string>>(new Set());
    const [previewBgColor, setPreviewBgColor] = useState('#ffffff');
    const [showBgPicker, setShowBgPicker] = useState(false);

    const isDraggingRef = useRef(false);
    const isResizingRef = useRef(false);
    const isRotatingRef = useRef(false);
    const dragStartMouseRef = useRef<{x: number; y: number}>({x: 0, y: 0});
    const dragStartTransformRef = useRef<ImageTransform>({nx: 0.5, ny: 0.5, s: 1, rotation: 0});
    const resizeStartDistRef = useRef(0);
    const resizeStartSRef = useRef(1);
    const rotateStartAngleRef = useRef(0);
    const rotateStartRotationRef = useRef(0);
    const transformRef = useRef<ImageTransform>(designTransform || {nx: 0.5, ny: 0.5, s: 1, rotation: 0});
    const onTransformChangeRef = useRef(onTransformChange);
    onTransformChangeRef.current = onTransformChange;

    useEffect(() => {
      if (designTransform) {
        transformRef.current = designTransform;
      }
    }, [designTransform]);

    const getDesignRect = useCallback(() => {
      if (!imageInfo || !designTransform) return null;
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return computeLayerRect(
        imageInfo.image.width, imageInfo.image.height,
        transformRef.current,
        canvas.width, canvas.height,
        artboardWidth, artboardHeight,
        resizeSettings.widthInches, resizeSettings.heightInches,
      );
    }, [imageInfo, designTransform, artboardWidth, artboardHeight, resizeSettings.widthInches, resizeSettings.heightInches]);

    const hitTestDesign = useCallback((px: number, py: number): boolean => {
      const rect = getDesignRect();
      if (!rect) return false;
      const t = transformRef.current;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const rad = -(t.rotation * Math.PI) / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      return Math.abs(lx) <= rect.width / 2 && Math.abs(ly) <= rect.height / 2;
    }, [getDesignRect]);

    const getHandlePositions = useCallback(() => {
      const rect = getDesignRect();
      if (!rect) return [];
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      const rad = (transformRef.current.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const corners = [
        { lx: -hw, ly: -hh, id: 'tl' },
        { lx: hw, ly: -hh, id: 'tr' },
        { lx: hw, ly: hh, id: 'br' },
        { lx: -hw, ly: hh, id: 'bl' },
      ];
      return corners.map(c => ({
        x: cx + c.lx * cos - c.ly * sin,
        y: cy + c.lx * sin + c.ly * cos,
        id: c.id,
      }));
    }, [getDesignRect]);

    const hitTestHandles = useCallback((px: number, py: number): { type: 'resize' | 'rotate'; id: string } | null => {
      const handles = getHandlePositions();
      if (handles.length === 0) return null;
      const rect = getDesignRect();
      if (!rect) return null;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const hitR = 14 * DPI_SCALE;
      const rotOff = 24 * DPI_SCALE;

      for (const h of handles) {
        const dx = h.x - cx;
        const dy = h.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const rotX = cx + (dx / len) * (len + rotOff);
          const rotY = cy + (dy / len) * (len + rotOff);
          if (Math.abs(px - rotX) < hitR && Math.abs(py - rotY) < hitR) {
            return { type: 'rotate', id: `rot-${h.id}` };
          }
        }
        if (Math.abs(px - h.x) < hitR && Math.abs(py - h.y) < hitR) {
          return { type: 'resize', id: h.id };
        }
      }
      return null;
    }, [getHandlePositions, getDesignRect]);

    const canvasToLocal = useCallback((clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const canvasRect = canvas.getBoundingClientRect();
      const x = ((clientX - canvasRect.left) / canvasRect.width) * canvas.width;
      const y = ((clientY - canvasRect.top) / canvasRect.height) * canvas.height;
      return { x, y };
    }, []);

    const clampTransformToArtboard = useCallback((t: ImageTransform, imgW?: number, imgH?: number, wInches?: number, hInches?: number): ImageTransform => {
      const canvas = canvasRef.current;
      const iw = imgW ?? imageInfo?.image.width;
      const ih = imgH ?? imageInfo?.image.height;
      const wi = wInches ?? resizeSettings.widthInches;
      const hi = hInches ?? resizeSettings.heightInches;
      if (!canvas || !iw || !ih) return t;
      const rect = computeLayerRect(iw, ih, t, canvas.width, canvas.height, artboardWidth, artboardHeight, wi, hi);
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rotW = rect.width * cos + rect.height * sin;
      const rotH = rect.width * sin + rect.height * cos;

      const cx = t.nx * canvas.width;
      const cy = t.ny * canvas.height;
      const halfW = rotW / 2;
      const halfH = rotH / 2;

      let newCx = cx;
      let newCy = cy;
      if (cx - halfW < 0) newCx = halfW;
      if (cx + halfW > canvas.width) newCx = canvas.width - halfW;
      if (cy - halfH < 0) newCy = halfH;
      if (cy + halfH > canvas.height) newCy = canvas.height - halfH;

      return { ...t, nx: newCx / canvas.width, ny: newCy / canvas.height };
    }, [imageInfo, artboardWidth, artboardHeight, resizeSettings.widthInches, resizeSettings.heightInches]);

    const checkPixelOverlap = useCallback(() => {
      if (designs.length < 2) {
        if (overlappingDesigns.size > 0) setOverlappingDesigns(new Set());
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = 0.25;
      const sw = Math.max(60, Math.round(canvas.width * scale));
      const sh = Math.max(30, Math.round(canvas.height * scale));
      const overlapping = new Set<string>();

      const alphaBuffers: { id: string; data: Uint8ClampedArray }[] = [];
      for (const d of designs) {
        const offscreen = document.createElement('canvas');
        offscreen.width = sw;
        offscreen.height = sh;
        const octx = offscreen.getContext('2d');
        if (!octx) continue;
        const rect = computeLayerRect(
          d.imageInfo.image.width, d.imageInfo.image.height,
          d.transform, sw, sh,
          artboardWidth, artboardHeight,
          d.widthInches, d.heightInches,
        );
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        octx.save();
        octx.translate(cx, cy);
        octx.rotate((d.transform.rotation * Math.PI) / 180);
        octx.drawImage(d.imageInfo.image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
        octx.restore();
        const imgData = octx.getImageData(0, 0, sw, sh);
        alphaBuffers.push({ id: d.id, data: imgData.data });
      }

      for (let i = 0; i < alphaBuffers.length; i++) {
        for (let j = i + 1; j < alphaBuffers.length; j++) {
          const a = alphaBuffers[i].data;
          const b = alphaBuffers[j].data;
          let found = false;
          for (let p = 3; p < a.length; p += 4) {
            if (a[p] > 20 && b[p] > 20) {
              found = true;
              break;
            }
          }
          if (found) {
            overlapping.add(alphaBuffers[i].id);
            overlapping.add(alphaBuffers[j].id);
          }
        }
      }

      const prev = overlappingDesigns;
      if (overlapping.size !== prev.size || Array.from(overlapping).some(id => !prev.has(id))) {
        setOverlappingDesigns(overlapping);
      }
    }, [designs, artboardWidth, artboardHeight, overlappingDesigns]);

    const findDesignAtPoint = useCallback((px: number, py: number): string | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      for (let i = designs.length - 1; i >= 0; i--) {
        const d = designs[i];
        const rect = computeLayerRect(
          d.imageInfo.image.width, d.imageInfo.image.height,
          d.transform, canvas.width, canvas.height,
          artboardWidth, artboardHeight,
          d.widthInches, d.heightInches,
        );
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const rad = -(d.transform.rotation * Math.PI) / 180;
        const dx = px - cx;
        const dy = py - cy;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        if (Math.abs(lx) <= rect.width / 2 && Math.abs(ly) <= rect.height / 2) {
          return d.id;
        }
      }
      return null;
    }, [designs, artboardWidth, artboardHeight]);

    const handleInteractionStart = useCallback((clientX: number, clientY: number) => {
      const local = canvasToLocal(clientX, clientY);
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (selectedDesignId && imageInfo && onTransformChange) {
        const handleHit = hitTestHandles(local.x, local.y);
        if (handleHit) {
          if (handleHit.type === 'resize') {
            isResizingRef.current = true;
            if (containerRef.current) containerRef.current.style.cursor = 'nwse-resize';
            const rect = getDesignRect();
            if (rect) {
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              resizeStartDistRef.current = Math.sqrt((local.x - cx) ** 2 + (local.y - cy) ** 2);
              resizeStartSRef.current = transformRef.current.s;
            }
          } else {
            isRotatingRef.current = true;
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
            const rect = getDesignRect();
            if (rect) {
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              rotateStartAngleRef.current = Math.atan2(local.y - cy, local.x - cx);
              rotateStartRotationRef.current = transformRef.current.rotation;
            }
          }
          return;
        }

        if (hitTestDesign(local.x, local.y)) {
          isDraggingRef.current = true;
          if (containerRef.current) containerRef.current.style.cursor = 'move';
          dragStartMouseRef.current = { x: clientX, y: clientY };
          dragStartTransformRef.current = { ...transformRef.current };
          return;
        }
      }

      const hitId = findDesignAtPoint(local.x, local.y);
      if (hitId && hitId !== selectedDesignId) {
        onSelectDesign?.(hitId);
        return;
      }

      if (!hitId) {
        onSelectDesign?.(null);
      }
    }, [imageInfo, onTransformChange, canvasToLocal, hitTestHandles, hitTestDesign, getDesignRect, selectedDesignId, findDesignAtPoint, onSelectDesign]);

    const handleInteractionMove = useCallback((clientX: number, clientY: number) => {
      if (!onTransformChange) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isDraggingRef.current) {
        const canvasRect = canvas.getBoundingClientRect();
        const dx = clientX - dragStartMouseRef.current.x;
        const dy = clientY - dragStartMouseRef.current.y;
        const dnx = dx / canvasRect.width;
        const dny = dy / canvasRect.height;
        const unclamped = {
          ...dragStartTransformRef.current,
          nx: dragStartTransformRef.current.nx + dnx,
          ny: dragStartTransformRef.current.ny + dny,
        };
        const newTransform = clampTransformToArtboard(unclamped);
        transformRef.current = newTransform;
        onTransformChangeRef.current?.(newTransform);
        checkPixelOverlap();
      } else if (isResizingRef.current) {
        const local = canvasToLocal(clientX, clientY);
        const rect = getDesignRect();
        if (rect) {
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const dist = Math.sqrt((local.x - cx) ** 2 + (local.y - cy) ** 2);
          const ratio = dist / Math.max(resizeStartDistRef.current, 1);
          const newS = Math.max(0.1, Math.min(10, resizeStartSRef.current * ratio));
          const unclamped = { ...transformRef.current, s: newS };
          const newTransform = clampTransformToArtboard(unclamped);
          transformRef.current = newTransform;
          onTransformChangeRef.current?.(newTransform);
          checkPixelOverlap();
        }
      } else if (isRotatingRef.current) {
        const local = canvasToLocal(clientX, clientY);
        const rect = getDesignRect();
        if (rect) {
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const angle = Math.atan2(local.y - cy, local.x - cx);
          const delta = ((angle - rotateStartAngleRef.current) * 180) / Math.PI;
          let newRot = rotateStartRotationRef.current + delta;
          newRot = ((newRot % 360) + 360) % 360;
          const newTransform = { ...transformRef.current, rotation: Math.round(newRot) };
          transformRef.current = newTransform;
          onTransformChangeRef.current?.(newTransform);
          checkPixelOverlap();
        }
      }
    }, [onTransformChange, canvasToLocal, getDesignRect, clampTransformToArtboard, checkPixelOverlap]);

    useEffect(() => {
      checkPixelOverlap();
    }, [designs]);

    useEffect(() => {
      if (!showBgPicker) return;
      const close = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-bg-picker]')) setShowBgPicker(false);
      };
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }, [showBgPicker]);

    const handleInteractionEnd = useCallback(() => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      isRotatingRef.current = false;
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      checkPixelOverlap();
    }, [checkPixelOverlap]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      handleInteractionStart(e.clientX, e.clientY);
    }, [handleInteractionStart]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (isDraggingRef.current || isResizingRef.current || isRotatingRef.current) {
        handleInteractionMove(e.clientX, e.clientY);
        return;
      }
      if (!containerRef.current) return;
      const local = canvasToLocal(e.clientX, e.clientY);
      if (imageInfo && selectedDesignId) {
        const handleHit = hitTestHandles(local.x, local.y);
        if (handleHit) {
          containerRef.current.style.cursor = handleHit.type === 'resize' ? 'nwse-resize' : ROTATE_CURSOR;
          return;
        }
        if (hitTestDesign(local.x, local.y)) {
          containerRef.current.style.cursor = 'move';
          return;
        }
      }
      const hitId = findDesignAtPoint(local.x, local.y);
      containerRef.current.style.cursor = hitId ? 'pointer' : 'default';
    }, [handleInteractionMove, canvasToLocal, imageInfo, selectedDesignId, hitTestHandles, hitTestDesign, findDesignAtPoint]);

    const handleMouseUp = useCallback(() => {
      handleInteractionEnd();
    }, [handleInteractionEnd]);

    const handleMouseLeave = useCallback(() => {
      handleInteractionEnd();
    }, [handleInteractionEnd]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      handleInteractionStart(e.touches[0].clientX, e.touches[0].clientY);
    }, [handleInteractionStart]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      handleInteractionMove(e.touches[0].clientX, e.touches[0].clientY);
    }, [handleInteractionMove]);

    const handleTouchEnd = useCallback(() => {
      handleInteractionEnd();
    }, [handleInteractionEnd]);
    
    // Fit to View: calculate zoom to fit canvas within container and reset pan
    const fitToView = useCallback(() => {
      if (!containerRef.current) return;
      const viewPadding = Math.max(4, Math.round(Math.min(previewDims.width, previewDims.height) * 0.03));
      const containerWidth = containerRef.current.clientWidth - viewPadding * 2;
      const containerHeight = containerRef.current.clientHeight - viewPadding * 2;
      const scaleX = containerWidth / previewDims.width;
      const scaleY = containerHeight / previewDims.height;
      const fitZoom = Math.min(scaleX, scaleY, 1); // max at 100%
      setZoom(Math.max(1, Math.round(fitZoom * 20) / 20)); // round to 5% steps
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
      setZoom(prev => Math.max(1, Math.min(3, prev + delta)));
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
      setZoom(1);
    }, [imageInfo]);

    useEffect(() => {
      if (!containerRef.current) return;
      const updateSize = () => {
        const containerWidth = containerRef.current?.clientWidth || 360;
        const safeWidth = Math.max(220, Math.min(720, containerWidth));
        const artboardAspect = artboardWidth / artboardHeight;
        const canvasHeight = Math.round(safeWidth / artboardAspect);
        setPreviewDims({
          width: safeWidth,
          height: canvasHeight
        });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [artboardWidth, artboardHeight]);
    
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

    useImperativeHandle(ref, () => {
      const canvas = canvasRef.current!;
      (canvas as any).getContourCanvasInfo = () => {
        if (contourCacheRef.current?.canvas) {
          return {
            width: contourCacheRef.current.canvas.width,
            height: contourCacheRef.current.canvas.height,
            imageCanvasX: contourCacheRef.current.imageCanvasX,
            imageCanvasY: contourCacheRef.current.imageCanvasY,
            downsampleScale: contourCacheRef.current.downsampleScale,
          };
        }
        return null;
      };
      return canvas;
    }, []);

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
    const CONTOUR_CACHE_VERSION = 18;
    const generateContourCacheKey = useCallback(() => {
      if (!imageInfo) return '';
      const bboxKey = detectedShapeInfo ? `${detectedShapeInfo.boundingBox.x},${detectedShapeInfo.boundingBox.y},${detectedShapeInfo.boundingBox.width},${detectedShapeInfo.boundingBox.height}` : 'none';
      return `v${CONTOUR_CACHE_VERSION}-${imageInfo.image.src}-${strokeSettings.width}-${strokeSettings.alphaThreshold}-${strokeSettings.backgroundColor}-${strokeSettings.useCustomBackground}-${strokeSettings.contourMode}-${strokeSettings.autoBridging}-${strokeSettings.autoBridgingThreshold}-${resizeSettings.widthInches}-${resizeSettings.heightInches}-shape:${detectedShapeType || 'none'}-bbox:${bboxKey}`;
    }, [imageInfo, strokeSettings.width, strokeSettings.alphaThreshold, strokeSettings.backgroundColor, strokeSettings.useCustomBackground, strokeSettings.contourMode, strokeSettings.autoBridging, strokeSettings.autoBridgingThreshold, resizeSettings.widthInches, resizeSettings.heightInches, detectedShapeType, detectedShapeInfo]);

    useEffect(() => {
      // Clear any pending debounce
      if (contourDebounceRef.current) {
        clearTimeout(contourDebounceRef.current);
        contourDebounceRef.current = null;
      }
      
      if (!imageInfo || !strokeSettings.enabled || shapeSettings.enabled) {
        contourCacheRef.current = null;
        contourTransformRef.current = null;
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
          },
          detectedShapeType,
          detectedShapeInfo
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
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings.enabled, generateContourCacheKey, detectedShapeType, detectedShapeInfo]);

    const drawSingleDesign = useCallback((ctx: CanvasRenderingContext2D, design: DesignItem, cw: number, ch: number) => {
      const rect = computeLayerRect(
        design.imageInfo.image.width, design.imageInfo.image.height,
        design.transform, cw, ch,
        artboardWidth, artboardHeight,
        design.widthInches, design.heightInches,
      );
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((design.transform.rotation * Math.PI) / 180);
      ctx.drawImage(design.imageInfo.image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
      ctx.restore();
    }, [artboardWidth, artboardHeight]);

    useEffect(() => {
      if (!canvasRef.current || (!imageInfo && designs.length === 0)) return;

      const doRender = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const canvasWidth = Math.round(previewDims.width * DPI_SCALE);
      const canvasHeight = Math.round(previewDims.height * DPI_SCALE);
      if (lastCanvasDimsRef.current.width !== canvasWidth || lastCanvasDimsRef.current.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        lastCanvasDimsRef.current = { width: canvasWidth, height: canvasHeight };
      } else {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      }

      if (previewBgColor === 'transparent') {
        const checkerSize = 10 * DPI_SCALE;
        for (let y = 0; y < canvasHeight; y += checkerSize) {
          for (let x = 0; x < canvasWidth; x += checkerSize) {
            ctx.fillStyle = ((x / checkerSize + y / checkerSize) % 2 === 0) ? '#e0e0e0' : '#ffffff';
            ctx.fillRect(x, y, checkerSize, checkerSize);
          }
        }
      } else {
        ctx.fillStyle = previewBgColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      for (const design of designs) {
        if (design.id === selectedDesignId) continue;
        drawSingleDesign(ctx, design, canvasWidth, canvasHeight);
        if (overlappingDesigns.has(design.id)) {
          const rect = computeLayerRect(
            design.imageInfo.image.width, design.imageInfo.image.height,
            design.transform, canvasWidth, canvasHeight,
            artboardWidth, artboardHeight,
            design.widthInches, design.heightInches,
          );
          const dcx = rect.x + rect.width / 2;
          const dcy = rect.y + rect.height / 2;
          const drad = (design.transform.rotation * Math.PI) / 180;
          const dcos = Math.cos(drad);
          const dsin = Math.sin(drad);
          const hw = rect.width / 2;
          const hh = rect.height / 2;
          const corners = [
            { x: dcx + (-hw) * dcos - (-hh) * dsin, y: dcy + (-hw) * dsin + (-hh) * dcos },
            { x: dcx + hw * dcos - (-hh) * dsin, y: dcy + hw * dsin + (-hh) * dcos },
            { x: dcx + hw * dcos - hh * dsin, y: dcy + hw * dsin + hh * dcos },
            { x: dcx + (-hw) * dcos - hh * dsin, y: dcy + (-hw) * dsin + hh * dcos },
          ];
          ctx.save();
          ctx.strokeStyle = '#ff0000';
          ctx.lineWidth = 2 * DPI_SCALE;
          ctx.setLineDash([6 * DPI_SCALE, 3 * DPI_SCALE]);
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let ci = 1; ci < corners.length; ci++) ctx.lineTo(corners[ci].x, corners[ci].y);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (!imageInfo) return;

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
        const contentBounds = getImageBounds(imageInfo.image);
        
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
        
        // Bleed disabled - no extra margin around the image
        const bleedInches = 0;
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
        
        /* HIDDEN: CutContour magenta dashed line indicator disabled in preview */
      } else {
        // Regular image rendering (non-PDF or no CutContour)
        
        // Transparent artboard - checkerboard background fills the entire canvas
        const checkerPattern = getCheckerboardPattern(ctx, canvas.width, canvas.height);
        if (checkerPattern) {
          ctx.fillStyle = checkerPattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (shapeSettings.enabled) {
          drawShapePreview(ctx, canvas.width, canvas.height);
        } else {
          drawImageWithResizePreview(ctx, canvas.width, canvas.height);
        }

      }
      
      /* HIDDEN: Locked contour blue dashed line disabled in preview */
      };
      doRender();
      renderRef.current = doRender;
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, backgroundColor, isProcessing, spotPreviewData, previewDims.height, previewDims.width, lockedContour, artboardWidth, artboardHeight, designTransform, designs, selectedDesignId, drawSingleDesign, overlappingDesigns, previewBgColor]);

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
      const fluorYColors = spotPreviewData.colors.filter(c => c.spotFluorY);
      const fluorMColors = spotPreviewData.colors.filter(c => c.spotFluorM);
      const fluorGColors = spotPreviewData.colors.filter(c => c.spotFluorG);
      const fluorOrangeColors = spotPreviewData.colors.filter(c => c.spotFluorOrange);
      
      if (whiteColors.length === 0 && glossColors.length === 0 && fluorYColors.length === 0 && fluorMColors.length === 0 && fluorGColors.length === 0 && fluorOrangeColors.length === 0) {
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
      const fluorYColors = spotPreviewData.colors.filter(c => c.spotFluorY);
      const fluorMColors = spotPreviewData.colors.filter(c => c.spotFluorM);
      const fluorGColors = spotPreviewData.colors.filter(c => c.spotFluorG);
      const fluorOrangeColors = spotPreviewData.colors.filter(c => c.spotFluorOrange);
      
      const hasAny = whiteColors.length > 0 || glossColors.length > 0 || fluorYColors.length > 0 || fluorMColors.length > 0 || fluorGColors.length > 0 || fluorOrangeColors.length > 0;
      if (!hasAny) return null;
      
      const img = source || imageInfo.image;
      const imgIdentity = (img as HTMLImageElement).src || `${img.width}x${img.height}`;
      const cacheKey = `${imgIdentity}-${img.width}x${img.height}-w:${whiteColors.map(c => c.hex).join(',')}-g:${glossColors.map(c => c.hex).join(',')}-fy:${fluorYColors.map(c => c.hex).join(',')}-fm:${fluorMColors.map(c => c.hex).join(',')}-fg:${fluorGColors.map(c => c.hex).join(',')}-fo:${fluorOrangeColors.map(c => c.hex).join(',')}`;
      
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
      
      const parseColors = (colors: typeof whiteColors) => colors.map(c => ({
        r: parseInt(c.hex.slice(1, 3), 16),
        g: parseInt(c.hex.slice(3, 5), 16),
        b: parseInt(c.hex.slice(5, 7), 16),
      }));
      
      const parsedWhite = parseColors(whiteColors);
      const parsedGloss = parseColors(glossColors);
      const parsedFluorY = parseColors(fluorYColors);
      const parsedFluorM = parseColors(fluorMColors);
      const parsedFluorG = parseColors(fluorGColors);
      const parsedFluorOrange = parseColors(fluorOrangeColors);
      
      const colorGroups: { parsed: typeof parsedWhite; overlayR: number; overlayG: number; overlayB: number }[] = [
        ...parsedWhite.length > 0 ? [{ parsed: parsedWhite, overlayR: 255, overlayG: 255, overlayB: 255 }] : [],
        ...parsedGloss.length > 0 ? [{ parsed: parsedGloss, overlayR: 180, overlayG: 180, overlayB: 190 }] : [],
        ...parsedFluorY.length > 0 ? [{ parsed: parsedFluorY, overlayR: 223, overlayG: 255, overlayB: 0 }] : [],
        ...parsedFluorM.length > 0 ? [{ parsed: parsedFluorM, overlayR: 255, overlayG: 0, overlayB: 255 }] : [],
        ...parsedFluorG.length > 0 ? [{ parsed: parsedFluorG, overlayR: 57, overlayG: 255, overlayB: 20 }] : [],
        ...parsedFluorOrange.length > 0 ? [{ parsed: parsedFluorOrange, overlayR: 255, overlayG: 102, overlayB: 0 }] : [],
      ];
      
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
        
        for (const group of colorGroups) {
          let matched = false;
          for (const t of group.parsed) {
            if (Math.abs(r - t.r) <= tolerance && Math.abs(g - t.g) <= tolerance && Math.abs(b - t.b) <= tolerance) {
              out[idx] = group.overlayR; out[idx + 1] = group.overlayG; out[idx + 2] = group.overlayB; out[idx + 3] = 255;
              matched = true;
              break;
            }
          }
          if (matched) break;
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

      const bleedInches = 0; // Bleed disabled
      const padding = 0;
      const availableWidth = canvasWidth;
      const availableHeight = canvasHeight;
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
      
      /* HIDDEN: Shape mode CutContour magenta outline disabled in preview */

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

      const t = designTransform || { nx: 0.5, ny: 0.5, s: 1, rotation: 0 };
      const rect = computeLayerRect(
        imageInfo.image.width, imageInfo.image.height,
        t,
        canvasWidth, canvasHeight,
        artboardWidth, artboardHeight,
        resizeSettings.widthInches, resizeSettings.heightInches,
      );

      ctx.save();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.drawImage(imageInfo.image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);

      const spotOverlay = createSpotOverlayCanvas();
      if (spotOverlay) {
        ctx.globalAlpha = spotPulseRef.current;
        ctx.drawImage(spotOverlay, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      drawSelectionHandles(ctx, rect, t);
    };

    const drawSelectionHandles = (ctx: CanvasRenderingContext2D, rect: {x: number; y: number; width: number; height: number}, t: ImageTransform) => {
      const isOverlap = selectedDesignId ? overlappingDesigns.has(selectedDesignId) : false;
      const accentColor = isOverlap ? '#ff0000' : '#00ffff';
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const corners = [
        { lx: -hw, ly: -hh },
        { lx: hw, ly: -hh },
        { lx: hw, ly: hh },
        { lx: -hw, ly: hh },
      ];
      const pts = corners.map(c => ({
        x: cx + c.lx * cos - c.ly * sin,
        y: cy + c.lx * sin + c.ly * cos,
      }));

      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5 * DPI_SCALE;
      ctx.setLineDash([6 * DPI_SCALE, 4 * DPI_SCALE]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      if (isOverlap) {
        const fontSize = Math.round(12 * DPI_SCALE);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = '#ff0000';
        ctx.textAlign = 'center';
        const topMidX = (pts[0].x + pts[1].x) / 2;
        const topMidY = (pts[0].y + pts[1].y) / 2;
        const offsetUp = 8 * DPI_SCALE;
        const textX = topMidX;
        const textY = topMidY - offsetUp;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 4;
        ctx.fillText('Design OVERLAPPING', textX, textY);
        ctx.restore();
      }

      const handleSize = 10 * DPI_SCALE;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2 * DPI_SCALE;
      for (const p of pts) {
        ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
      }

      const rotOff = 24 * DPI_SCALE;
      ctx.fillStyle = accentColor;
      for (const p of pts) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const rx = cx + (dx / len) * (len + rotOff);
          const ry = cy + (dy / len) * (len + rotOff);

          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1 * DPI_SCALE;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(rx, ry);
          ctx.stroke();
          ctx.restore();

          ctx.beginPath();
          ctx.arc(rx, ry, 5 * DPI_SCALE, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
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
        <Card className="bg-gray-900 border-gray-800 shadow-sm rounded-2xl overflow-hidden" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.3), 0 0 30px rgba(255,255,255,0.15)' }}>
          <CardContent className="p-3 sm:p-4">
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
                  className={`relative w-full max-w-[720px] rounded-xl border border-gray-600 flex items-center justify-center cursor-default transition-all duration-300 ${showHighlight ? 'ring-4 ring-cyan-400 ring-opacity-75' : ''}`}
                  style={{ 
                    width: '100%',
                    height: '100%',
                    aspectRatio: `${artboardWidth} / ${artboardHeight}`,
                    maxHeight: '70vh',
                    backgroundColor: previewBgColor === 'transparent' ? '#e0e0e0' : previewBgColor,
                    overflow: 'hidden',
                    userSelect: 'none',
                    touchAction: 'none'
                  }}
                >
                <canvas 
                  ref={canvasRef}
                  className="relative z-10 block"
                  style={{ 
                    width: previewDims.width,
                    height: previewDims.height,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    transition: 'transform 0.15s ease-out'
                  }}
                />
                
                {!imageInfo && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="text-gray-300 text-sm opacity-50">Upload a design</p>
                  </div>
                )}
                
                {/* Contour mode buttons (Sharp/Smooth) - HIDDEN */}

                {isProcessing && imageInfo && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 text-white mx-auto mb-2 animate-spin" />
                      <p className="text-white text-sm">Processing... {processingProgress}%</p>
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-center gap-1.5 bg-gray-800 rounded-lg p-1.5 border border-gray-700 flex-wrap">
                {selectedDesignId && designTransform && (
                  <>
                    <span className="text-xs text-gray-400 font-medium">
                      {(resizeSettings.widthInches * (designTransform.s || 1)).toFixed(2)}" × {(resizeSettings.heightInches * (designTransform.s || 1)).toFixed(2)}"
                    </span>
                    <div className="w-px h-4 bg-gray-600 mx-0.5" />
                    {editingRotation ? (
                      <input
                        type="number"
                        className="w-14 h-6 bg-gray-700 text-xs text-gray-200 text-center rounded border border-gray-600 outline-none"
                        value={rotationInput}
                        autoFocus
                        onChange={(e) => setRotationInput(e.target.value)}
                        onBlur={() => {
                          setEditingRotation(false);
                          const val = parseFloat(rotationInput);
                          if (!isNaN(val) && onTransformChange) {
                            onTransformChange({ ...designTransform, rotation: ((val % 360) + 360) % 360 });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      <span
                        className="text-xs text-gray-400 font-medium cursor-pointer hover:text-gray-200"
                        title="Click to edit rotation"
                        onClick={() => {
                          setRotationInput(String(Math.round(designTransform.rotation || 0)));
                          setEditingRotation(true);
                        }}
                      >
                        {Math.round(designTransform.rotation || 0)}°
                      </span>
                    )}
                    <div className="w-px h-4 bg-gray-600 mx-0.5" />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(prev => Math.max(prev - 0.1, 1))}
                  className="h-7 w-7 p-0 hover:bg-gray-700 rounded-md"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5 text-gray-400" />
                </Button>
                
                <span className="text-xs text-gray-400 min-w-[42px] text-center font-medium">
                  {Math.round(zoom * 100)}%
                </span>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(prev => Math.min(prev + 0.1, 3))}
                  className="h-7 w-7 p-0 hover:bg-gray-700 rounded-md"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5 text-gray-400" />
                </Button>
                
                <div className="w-px h-4 bg-gray-600 mx-0.5" />
                
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={fitToView}
                  className="h-7 px-2 hover:bg-gray-700 rounded-md text-gray-400 text-xs"
                  title="Fit to View"
                >
                  <Maximize2 className="h-3 w-3 mr-1" />
                  Fit
                </Button>
                
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={resetView}
                  className="h-7 px-2 hover:bg-gray-700 rounded-md text-gray-400 text-xs"
                  title="Reset"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>

                <div className="w-px h-4 bg-gray-600 mx-0.5" />

                <div className="relative" data-bg-picker>
                  <button
                    onClick={() => setShowBgPicker(prev => !prev)}
                    className="h-7 w-7 rounded-md border border-gray-600 hover:border-gray-400 flex items-center justify-center"
                    title="Preview Background"
                    style={{
                      background: previewBgColor === 'transparent'
                        ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 10px 10px'
                        : previewBgColor
                    }}
                  />
                  {showBgPicker && (
                    <div className="absolute bottom-full mb-2 right-0 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-xl z-30 min-w-[140px]">
                      <p className="text-[10px] text-gray-400 mb-1.5 font-medium">Preview Background</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[
                          { color: 'transparent', label: 'None' },
                          { color: '#ffffff', label: 'White' },
                          { color: '#d1d5db', label: 'Light Gray' },
                          { color: '#6b7280', label: 'Gray' },
                          { color: '#1f2937', label: 'Dark' },
                          { color: '#000000', label: 'Black' },
                          { color: '#ff00ff', label: 'Magenta' },
                          { color: '#00ffff', label: 'Cyan' },
                        ].map(({ color, label }) => (
                          <button
                            key={color}
                            onClick={() => { setPreviewBgColor(color); setShowBgPicker(false); }}
                            className={`w-6 h-6 rounded border ${previewBgColor === color ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-gray-500 hover:border-gray-300'}`}
                            title={label}
                            style={{
                              background: color === 'transparent'
                                ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                                : color
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-gray-400">Custom:</label>
                        <input
                          type="color"
                          value={previewBgColor === 'transparent' ? '#ffffff' : previewBgColor}
                          onChange={(e) => setPreviewBgColor(e.target.value)}
                          className="w-6 h-6 rounded border border-gray-500 cursor-pointer bg-transparent p-0"
                        />
                      </div>
                    </div>
                  )}
                </div>
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
