import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Loader2, Maximize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ImageInfo, StrokeSettings, ResizeSettings, ShapeSettings, type LockedContour, type ImageTransform, type DesignItem } from "./image-editor";
import { computeLayerRect } from "@/lib/types";

const DPI_SCALE = 2;
const ZOOM_MIN_ABSOLUTE = 0.5;
const ZOOM_MAX = 3;
const ZOOM_WHEEL_FACTOR = 1.1;
const ZOOM_BUTTON_FACTOR = 1.2;
const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke-linecap='round'%3E%3Cpath d='M4 12a8 8 0 0 1 14.93-4' stroke='%23000' stroke-width='4'/%3E%3Cpath d='m19 4 0 4-4 0' stroke='%23000' stroke-width='4'/%3E%3Cpath d='M20 12a8 8 0 0 1-14.93 4' stroke='%23000' stroke-width='4'/%3E%3Cpath d='m5 20 0-4 4 0' stroke='%23000' stroke-width='4'/%3E%3Cpath d='M4 12a8 8 0 0 1 14.93-4' stroke='white' stroke-width='2'/%3E%3Cpath d='m19 4 0 4-4 0' stroke='white' stroke-width='2'/%3E%3Cpath d='M20 12a8 8 0 0 1-14.93 4' stroke='white' stroke-width='2'/%3E%3Cpath d='m5 20 0-4 4 0' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 11 11, pointer`;
import { SpotPreviewData } from "./controls-section";
import { CadCutBounds } from "@/lib/cadcut-bounds";
import { type DetectedAlgorithm, type DetectedShapeInfo } from "@/lib/contour-worker-manager";
import { calculateShapeDimensions } from "@/lib/shape-outline";
import { cropImageToContent, getImageBounds } from "@/lib/image-crop";
import { convertPolygonToCurves, gaussianSmoothContour } from "@/lib/clipper-path";

function getResizeCursor(handleId: string, rotationDeg: number): string {
  const baseMap: Record<string, number> = { tl: 315, tr: 45, br: 135, bl: 225 };
  const base = baseMap[handleId] ?? 135;
  const angle = ((base + rotationDeg) % 360 + 360) % 360;
  if (angle >= 337.5 || angle < 22.5) return 'n-resize';
  if (angle >= 22.5 && angle < 67.5) return 'ne-resize';
  if (angle >= 67.5 && angle < 112.5) return 'e-resize';
  if (angle >= 112.5 && angle < 157.5) return 'se-resize';
  if (angle >= 157.5 && angle < 202.5) return 's-resize';
  if (angle >= 202.5 && angle < 247.5) return 'sw-resize';
  if (angle >= 247.5 && angle < 292.5) return 'w-resize';
  return 'nw-resize';
}

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
  selectedDesignIds?: Set<string>;
  onSelectDesign?: (id: string | null) => void;
  onMultiSelect?: (ids: string[]) => void;
  onMultiDragDelta?: (dnx: number, dny: number) => void;
  onDuplicateSelected?: () => string[];
  onInteractionEnd?: () => void;
  onExpandArtboard?: () => void;
}

const PreviewSection = forwardRef<HTMLCanvasElement, PreviewSectionProps>(
  ({ imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, spotPreviewData, showCutLineInfo, onDetectedAlgorithm, detectedShapeType, detectedShapeInfo, detectedAlgorithm, onStrokeChange, lockedContour, artboardWidth = 24.5, artboardHeight = 12, designTransform, onTransformChange, designs = [], selectedDesignId, selectedDesignIds = new Set(), onSelectDesign, onMultiSelect, onMultiDragDelta, onDuplicateSelected, onInteractionEnd, onExpandArtboard }, ref) => {
    const { toast } = useToast();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const resizeLimitToastRef = useRef(0);
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const zoomRef = useRef(zoom);
    const panXRef = useRef(panX);
    const panYRef = useRef(panY);
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
    const [backgroundColor, setBackgroundColor] = useState("transparent");
    const lastImageRef = useRef<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const contourCacheRef = useRef<{key: string; canvas: HTMLCanvasElement; downsampleScale: number; imageCanvasX: number; imageCanvasY: number} | null>(null);
    const contourCacheMapRef = useRef<Map<string, {canvas: HTMLCanvasElement; downsampleScale: number; imageCanvasX: number; imageCanvasY: number}>>(new Map());
    const processingIdRef = useRef(0);
    const [showHighlight, setShowHighlight] = useState(false);
    const lastSettingsRef = useRef<string>('');
    const contourDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastImageRenderRef = useRef<{x: number; y: number; width: number; height: number} | null>(null);
    const [previewDims, setPreviewDims] = useState({ width: 360, height: 360 });
    const previewDimsRef = useRef(previewDims);
    previewDimsRef.current = previewDims;

    const getMinZoom = useCallback(() => {
      const container = containerRef.current;
      if (!container) return ZOOM_MIN_ABSOLUTE;
      const dims = previewDimsRef.current;
      const padFraction = 0.03;
      const padX = Math.max(4, Math.round(dims.width * padFraction));
      const padY = Math.max(4, Math.round(dims.height * padFraction));
      const availW = container.clientWidth - padX * 2;
      const availH = container.clientHeight - padY * 2;
      if (availW <= 0 || availH <= 0 || dims.width <= 0 || dims.height <= 0) return ZOOM_MIN_ABSOLUTE;
      const fitScale = Math.min(availW / dims.width, availH / dims.height);
      return Math.max(ZOOM_MIN_ABSOLUTE, Math.round(fitScale * 20) / 20);
    }, []);
    const minZoomRef = useRef(1);

    const clampPanValue = useCallback((px: number, py: number, z: number) => {
      const dims = previewDimsRef.current;
      const maxPanX = dims.width * 0.5 / z;
      const maxPanY = dims.height * 0.5 / z;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    }, []);

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
    const [previewBgColor, setPreviewBgColor] = useState('#d1d5db');
    const isDraggingRef = useRef(false);
    const isResizingRef = useRef(false);
    const isRotatingRef = useRef(false);
    const activeResizeHandleRef = useRef<string>('br');
    const shiftKeyRef = useRef(false);
    const isPanningRef = useRef(false);
    const panStartRef = useRef<{x: number; y: number; px: number; py: number}>({x: 0, y: 0, px: 0, py: 0});
    const spaceDownRef = useRef(false);
    const isKeyboardScopeActiveRef = useRef(false);
    const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isWheelZoomingRef = useRef(false);
    const snapGuidesRef = useRef<Array<{axis: 'x' | 'y'; pos: number}>>([]);
    const dragStartMouseRef = useRef<{x: number; y: number}>({x: 0, y: 0});
    const dragStartTransformRef = useRef<ImageTransform>({nx: 0.5, ny: 0.5, s: 1, rotation: 0});
    const resizeStartDistRef = useRef(0);
    const resizeStartSRef = useRef(1);
    const resizeCommittedRef = useRef(false);
    const rotateStartAngleRef = useRef(0);
    const rotateStartRotationRef = useRef(0);
    const transformRef = useRef<ImageTransform>(designTransform || {nx: 0.5, ny: 0.5, s: 1, rotation: 0});
    const onTransformChangeRef = useRef(onTransformChange);
    onTransformChangeRef.current = onTransformChange;

    const isMarqueeRef = useRef(false);
    const marqueeStartRef = useRef<{x: number; y: number}>({x: 0, y: 0});
    const marqueeEndRef = useRef<{x: number; y: number}>({x: 0, y: 0});
    const [marqueeRect, setMarqueeRect] = useState<{x: number; y: number; w: number; h: number} | null>(null);

    const isMultiDragRef = useRef(false);
    const multiDragStartRef = useRef<{x: number; y: number}>({x: 0, y: 0});

    const overlapCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [bottomGlow, setBottomGlow] = useState(0);
    const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expandTimerStartRef = useRef<number>(0);
    const glowAnimRef = useRef<number | null>(null);
    const onExpandArtboardRef = useRef(onExpandArtboard);
    onExpandArtboardRef.current = onExpandArtboard;
    const bottomGlowActiveRef = useRef(false);

    const startBottomGlow = useCallback(() => {
      if (bottomGlowActiveRef.current) return;
      bottomGlowActiveRef.current = true;
      expandTimerStartRef.current = Date.now();
      const tick = () => {
        if (!bottomGlowActiveRef.current) return;
        const elapsed = Date.now() - expandTimerStartRef.current;
        setBottomGlow(Math.min(1, elapsed / 1900));
        glowAnimRef.current = requestAnimationFrame(tick);
      };
      glowAnimRef.current = requestAnimationFrame(tick);
      expandTimerRef.current = setTimeout(() => {
        onExpandArtboardRef.current?.();
        stopBottomGlow();
      }, 1900);
    }, []);

    const stopBottomGlow = useCallback(() => {
      bottomGlowActiveRef.current = false;
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
      if (glowAnimRef.current !== null) {
        cancelAnimationFrame(glowAnimRef.current);
        glowAnimRef.current = null;
      }
      setBottomGlow(0);
    }, []);
    useEffect(() => () => stopBottomGlow(), [stopBottomGlow]);

    const altDragDuplicatedRef = useRef(false);
    const altKeyRef = useRef(false);

    useEffect(() => {
      transformRef.current = designTransform || { nx: 0.5, ny: 0.5, s: 1, rotation: 0 };
    }, [designTransform]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!isKeyboardScopeActiveRef.current) return;
        shiftKeyRef.current = e.shiftKey;
        altKeyRef.current = e.altKey;
        if (e.code === 'Space' && !spaceDownRef.current) {
          spaceDownRef.current = true;
          e.preventDefault();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (!isKeyboardScopeActiveRef.current) return;
        shiftKeyRef.current = e.shiftKey;
        altKeyRef.current = e.altKey;
        if (e.code === 'Space') {
          spaceDownRef.current = false;
          isPanningRef.current = false;
        }
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
    }, []);

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

    const isClickInDesignInterior = useCallback((px: number, py: number): boolean => {
      const rect = getDesignRect();
      if (!rect) return false;
      const z = Math.max(0.25, zoomRef.current);
      const inv = DPI_SCALE / z;
      const margin = Math.min(10 * inv, Math.min(rect.width, rect.height) * 0.25);
      const t = transformRef.current;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const rad = -(t.rotation * Math.PI) / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      return Math.abs(lx) <= (rect.width / 2 - margin) && Math.abs(ly) <= (rect.height / 2 - margin);
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
      const z = Math.max(0.25, zoomRef.current);
      const inv = DPI_SCALE / z;
      const resizeR = 7 * inv;
      const rotateOuterR = 18 * inv;

      const tl = handles.find(h => h.id === 'tl');
      const tr = handles.find(h => h.id === 'tr');
      if (tl && tr) {
        const topMidX = (tl.x + tr.x) / 2;
        const topMidY = (tl.y + tr.y) / 2;
        const rad = (transformRef.current.rotation * Math.PI) / 180;
        const rotDist = 24 * inv;
        const rotHandleX = topMidX + (-Math.sin(rad)) * rotDist;
        const rotHandleY = topMidY + (-Math.cos(rad)) * rotDist;
        if (Math.sqrt((px - rotHandleX) ** 2 + (py - rotHandleY) ** 2) < resizeR) {
          return { type: 'rotate', id: 'rot-top' };
        }
      }

      for (const h of handles) {
        const d = Math.sqrt((px - h.x) ** 2 + (py - h.y) ** 2);
        if (d < resizeR) {
          return { type: 'resize', id: h.id };
        }
      }

      for (const h of handles) {
        const d = Math.sqrt((px - h.x) ** 2 + (py - h.y) ** 2);
        if (d >= resizeR && d < rotateOuterR) {
          return { type: 'rotate', id: `rot-${h.id}` };
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

    const getMaxScaleForArtboard = useCallback((t: ImageTransform, wInches?: number, hInches?: number): number => {
      const wi = wInches ?? resizeSettings.widthInches;
      const hi = hInches ?? resizeSettings.heightInches;
      if (!wi || !hi) return 10;
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rotW = wi * cos + hi * sin;
      const rotH = wi * sin + hi * cos;
      const maxSx = artboardWidth / rotW;
      const maxSy = artboardHeight / rotH;
      return Math.min(maxSx, maxSy);
    }, [artboardWidth, artboardHeight, resizeSettings.widthInches, resizeSettings.heightInches]);

    const clampTransformToArtboard = useCallback((t: ImageTransform, opts?: { clampScale?: boolean; imgW?: number; imgH?: number; wInches?: number; hInches?: number }): ImageTransform => {
      const canvas = canvasRef.current;
      const iw = opts?.imgW ?? imageInfo?.image.width;
      const ih = opts?.imgH ?? imageInfo?.image.height;
      const wi = opts?.wInches ?? resizeSettings.widthInches;
      const hi = opts?.hInches ?? resizeSettings.heightInches;
      const shouldClampScale = opts?.clampScale ?? false;
      if (!canvas || !iw || !ih) return t;

      let clamped = t;
      if (shouldClampScale) {
        const maxS = getMaxScaleForArtboard(t, wi, hi);
        const clampedS = Math.min(t.s, maxS);
        if (clampedS !== t.s) clamped = { ...t, s: clampedS };
      }

      const rect = computeLayerRect(iw, ih, clamped, canvas.width, canvas.height, artboardWidth, artboardHeight, wi, hi);
      const rad = (clamped.rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rotW = rect.width * cos + rect.height * sin;
      const rotH = rect.width * sin + rect.height * cos;

      const cx = clamped.nx * canvas.width;
      const cy = clamped.ny * canvas.height;
      const halfW = rotW / 2;
      const halfH = rotH / 2;

      let newCx = cx;
      let newCy = cy;

      // If the design fits within the artboard, clamp normally.
      // If it's too large, allow positioning anywhere within the artboard
      // center range so the user can still drag it.
      if (rotW <= canvas.width) {
        if (cx - halfW < 0) newCx = halfW;
        if (cx + halfW > canvas.width) newCx = canvas.width - halfW;
      } else {
        newCx = Math.max(canvas.width - halfW, Math.min(halfW, cx));
      }
      if (rotH <= canvas.height) {
        if (cy - halfH < 0) newCy = halfH;
        if (cy + halfH > canvas.height) newCy = canvas.height - halfH;
      } else {
        newCy = Math.max(canvas.height - halfH, Math.min(halfH, cy));
      }

      return { ...clamped, nx: newCx / canvas.width, ny: newCy / canvas.height };
    }, [imageInfo, artboardWidth, artboardHeight, resizeSettings.widthInches, resizeSettings.heightInches, getMaxScaleForArtboard]);

    const overlappingDesignsRef = useRef(overlappingDesigns);
    overlappingDesignsRef.current = overlappingDesigns;

    const checkPixelOverlap = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (designs.length === 0) {
        if (overlappingDesignsRef.current.size > 0) {
          setOverlappingDesigns(new Set());
        }
        return;
      }

      const scale = 0.25;
      const sw = Math.max(60, Math.round(canvas.width * scale));
      const sh = Math.max(30, Math.round(canvas.height * scale));

      const designRects: Array<{id: string; left: number; top: number; right: number; bottom: number; design: DesignItem}> = [];
      for (const d of designs) {
        const rect = computeLayerRect(
          d.imageInfo.image.width, d.imageInfo.image.height,
          d.transform, sw, sh,
          artboardWidth, artboardHeight,
          d.widthInches, d.heightInches,
        );
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const rad = Math.abs(d.transform.rotation * Math.PI / 180);
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rotW = rect.width * cos + rect.height * sin;
        const rotH = rect.width * sin + rect.height * cos;
        designRects.push({ id: d.id, left: cx - rotW / 2, top: cy - rotH / 2, right: cx + rotW / 2, bottom: cy + rotH / 2, design: d });
      }

      // Mark any design that extends outside the artboard bounds
      const outOfBounds = new Set<string>();
      for (const dr of designRects) {
        if (dr.left < -1 || dr.top < -1 || dr.right > sw + 1 || dr.bottom > sh + 1) {
          outOfBounds.add(dr.id);
        }
      }

      if (designs.length < 2) {
        const prev = overlappingDesignsRef.current;
        if (outOfBounds.size !== prev.size || Array.from(outOfBounds).some(id => !prev.has(id))) {
          setOverlappingDesigns(outOfBounds);
        }
        return;
      }

      // Find AABB-overlapping pairs
      const aabbPairs: [number, number][] = [];
      for (let i = 0; i < designRects.length; i++) {
        for (let j = i + 1; j < designRects.length; j++) {
          const a = designRects[i], b = designRects[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            aabbPairs.push([i, j]);
          }
        }
      }

      if (aabbPairs.length === 0 && outOfBounds.size === 0) {
        if (overlappingDesignsRef.current.size > 0) setOverlappingDesigns(new Set());
        return;
      }
      if (aabbPairs.length === 0) {
        const prev = overlappingDesignsRef.current;
        if (outOfBounds.size !== prev.size || Array.from(outOfBounds).some(id => !prev.has(id))) {
          setOverlappingDesigns(outOfBounds);
        }
        return;
      }

      // Only rasterize designs involved in AABB overlaps
      const neededSet = new Set<number>();
      for (const [i, j] of aabbPairs) { neededSet.add(i); neededSet.add(j); }
      const needed = Array.from(neededSet);

      const alphaBuffers = new Map<number, Uint8ClampedArray>();
      for (const idx of needed) {
        const d = designRects[idx].design;
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
        alphaBuffers.set(idx, octx.getImageData(0, 0, sw, sh).data);
      }

      const overlapping = new Set<string>(outOfBounds);
      for (const [i, j] of aabbPairs) {
        const a = alphaBuffers.get(i);
        const b = alphaBuffers.get(j);
        if (!a || !b) continue;
        let found = false;
        for (let p = 3; p < a.length; p += 16) {
          if (a[p] > 20 && b[p] > 20) { found = true; break; }
        }
        if (!found) {
          for (let p = 3; p < a.length; p += 4) {
            if (a[p] > 20 && b[p] > 20) { found = true; break; }
          }
        }
        if (found) {
          overlapping.add(designRects[i].id);
          overlapping.add(designRects[j].id);
        }
      }

      const prev = overlappingDesignsRef.current;
      if (overlapping.size !== prev.size || Array.from(overlapping).some(id => !prev.has(id))) {
        setOverlappingDesigns(overlapping);
      }
    }, [designs, artboardWidth, artboardHeight]);

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

        if (handleHit && handleHit.type === 'resize' && isClickInDesignInterior(local.x, local.y)) {
          isDraggingRef.current = true;
          altDragDuplicatedRef.current = false;
          if (containerRef.current) containerRef.current.style.cursor = 'move';
          dragStartMouseRef.current = { x: clientX, y: clientY };
          dragStartTransformRef.current = { ...transformRef.current };
          return;
        }

        if (handleHit) {
          if (handleHit.type === 'resize') {
            isResizingRef.current = true;
            resizeCommittedRef.current = false;
            activeResizeHandleRef.current = handleHit.id;
            if (containerRef.current) containerRef.current.style.cursor = getResizeCursor(handleHit.id, transformRef.current.rotation);
            const rect = getDesignRect();
            if (rect) {
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              resizeStartDistRef.current = Math.sqrt((local.x - cx) ** 2 + (local.y - cy) ** 2);
              resizeStartSRef.current = transformRef.current.s;
            }
          } else {
            isRotatingRef.current = true;
            if (containerRef.current) containerRef.current.style.cursor = ROTATE_CURSOR;
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
          if (selectedDesignIds.size > 1 && selectedDesignIds.has(selectedDesignId)) {
            isMultiDragRef.current = true;
            multiDragStartRef.current = { x: clientX, y: clientY };
            altDragDuplicatedRef.current = false;
            if (containerRef.current) containerRef.current.style.cursor = 'move';
            return;
          }
          isDraggingRef.current = true;
          altDragDuplicatedRef.current = false;
          if (containerRef.current) containerRef.current.style.cursor = 'move';
          dragStartMouseRef.current = { x: clientX, y: clientY };
          dragStartTransformRef.current = { ...transformRef.current };
          return;
        }
      }

      const hitId = findDesignAtPoint(local.x, local.y);

      if (hitId && selectedDesignIds.size > 1 && selectedDesignIds.has(hitId)) {
        isMultiDragRef.current = true;
        multiDragStartRef.current = { x: clientX, y: clientY };
        altDragDuplicatedRef.current = false;
        if (containerRef.current) containerRef.current.style.cursor = 'move';
        return;
      }

      if (hitId) {
        if (hitId !== selectedDesignId) {
          onSelectDesign?.(hitId);
        } else {
          isDraggingRef.current = true;
          altDragDuplicatedRef.current = false;
          if (containerRef.current) containerRef.current.style.cursor = 'move';
          dragStartMouseRef.current = { x: clientX, y: clientY };
          dragStartTransformRef.current = { ...transformRef.current };
        }
        return;
      }

      onSelectDesign?.(null);
      isMarqueeRef.current = true;
      marqueeStartRef.current = { x: local.x, y: local.y };
      marqueeEndRef.current = { x: local.x, y: local.y };
      setMarqueeRect(null);
    }, [imageInfo, onTransformChange, canvasToLocal, hitTestHandles, hitTestDesign, isClickInDesignInterior, getDesignRect, selectedDesignId, selectedDesignIds, findDesignAtPoint, onSelectDesign]);

    const handleInteractionMove = useCallback((clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isMarqueeRef.current) {
        const local = canvasToLocal(clientX, clientY);
        marqueeEndRef.current = { x: local.x, y: local.y };
        const sx = marqueeStartRef.current.x;
        const sy = marqueeStartRef.current.y;
        setMarqueeRect({
          x: Math.min(sx, local.x),
          y: Math.min(sy, local.y),
          w: Math.abs(local.x - sx),
          h: Math.abs(local.y - sy),
        });
        return;
      }

      if (isMultiDragRef.current) {
        if (altKeyRef.current && !altDragDuplicatedRef.current) {
          altDragDuplicatedRef.current = true;
          onDuplicateSelected?.();
        }
        const canvasRect = canvas.getBoundingClientRect();
        const dx = clientX - multiDragStartRef.current.x;
        const dy = clientY - multiDragStartRef.current.y;
        const dnx = dx / canvasRect.width;
        const dny = dy / canvasRect.height;
        multiDragStartRef.current = { x: clientX, y: clientY };
        onMultiDragDelta?.(dnx, dny);
        return;
      }

      if (!onTransformChange) return;

      if (isDraggingRef.current) {
        if (altKeyRef.current && !altDragDuplicatedRef.current) {
          altDragDuplicatedRef.current = true;
          onDuplicateSelected?.();
        }
        const canvasRect = canvas.getBoundingClientRect();
        const dx = clientX - dragStartMouseRef.current.x;
        const dy = clientY - dragStartMouseRef.current.y;
        const dnx = dx / canvasRect.width;
        const dny = dy / canvasRect.height;
        let unclamped = {
          ...dragStartTransformRef.current,
          nx: dragStartTransformRef.current.nx + dnx,
          ny: dragStartTransformRef.current.ny + dny,
        };

        // Smart guides snapping
        const SNAP_THRESHOLD = 0.008;
        const guides: Array<{axis: 'x' | 'y'; pos: number}> = [];
        const snapTargetsX = [0.5]; // artboard center
        const snapTargetsY = [0.5];

        for (const d of designs) {
          if (d.id === selectedDesignId) continue;
          snapTargetsX.push(d.transform.nx);
          snapTargetsY.push(d.transform.ny);
        }

        let snappedNx = unclamped.nx;
        let snappedNy = unclamped.ny;
        let bestDx = SNAP_THRESHOLD;
        let bestTx: number | null = null;
        for (const tx of snapTargetsX) {
          const dx = Math.abs(unclamped.nx - tx);
          if (dx < bestDx) {
            bestDx = dx;
            bestTx = tx;
          }
        }
        if (bestTx !== null) {
          snappedNx = bestTx;
          guides.push({ axis: 'x', pos: bestTx });
        }
        let bestDy = SNAP_THRESHOLD;
        let bestTy: number | null = null;
        for (const ty of snapTargetsY) {
          const dy = Math.abs(unclamped.ny - ty);
          if (dy < bestDy) {
            bestDy = dy;
            bestTy = ty;
          }
        }
        if (bestTy !== null) {
          snappedNy = bestTy;
          guides.push({ axis: 'y', pos: bestTy });
        }
        unclamped = { ...unclamped, nx: snappedNx, ny: snappedNy };
        snapGuidesRef.current = guides;

        const newTransform = clampTransformToArtboard(unclamped);
        transformRef.current = newTransform;
        onTransformChangeRef.current?.(newTransform);

        // Bottom-edge expand detection
        if (canvas && artboardHeight < 24) {
          const selDesign = designs.find(d => d.id === selectedDesignId);
          if (selDesign) {
            const wi = selDesign.widthInches * newTransform.s;
            const hi = selDesign.heightInches * newTransform.s;
            const rad = (newTransform.rotation * Math.PI) / 180;
            const cosR = Math.abs(Math.cos(rad));
            const sinR = Math.abs(Math.sin(rad));
            const rotH = wi * sinR + hi * cosR;
            const bottomEdge = newTransform.ny + (rotH / 2) / artboardHeight;

            if (bottomEdge >= 0.92) {
              startBottomGlow();
            } else {
              stopBottomGlow();
            }
          }
        } else {
          stopBottomGlow();
        }
      } else if (isResizingRef.current) {
        const local = canvasToLocal(clientX, clientY);
        const rect = getDesignRect();
        if (rect) {
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const dist = Math.sqrt((local.x - cx) ** 2 + (local.y - cy) ** 2);
          const ratio = dist / Math.max(resizeStartDistRef.current, 1);
          if (!resizeCommittedRef.current && Math.abs(ratio - 1) < 0.04) return;
          resizeCommittedRef.current = true;
          const maxS = getMaxScaleForArtboard(transformRef.current);
          const rawS = resizeStartSRef.current * ratio;
          const newS = Math.max(0.1, Math.min(maxS, rawS));
          if (rawS > maxS && Date.now() - resizeLimitToastRef.current > 3000) {
            resizeLimitToastRef.current = Date.now();
            toast({ title: "Design fills the sheet", description: "Try a larger gangsheet size to fit bigger designs." });
          }
          const unclamped = { ...transformRef.current, s: newS };
          const newTransform = clampTransformToArtboard(unclamped, { clampScale: true });
          transformRef.current = newTransform;
          onTransformChangeRef.current?.(newTransform);
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
          if (shiftKeyRef.current) {
            newRot = Math.round(newRot / 15) * 15;
          }
          const rotated = { ...transformRef.current, rotation: Math.round(newRot) };
          const newTransform = clampTransformToArtboard(rotated);
          transformRef.current = newTransform;
          onTransformChangeRef.current?.(newTransform);
        }
      }
    }, [onTransformChange, canvasToLocal, getDesignRect, clampTransformToArtboard, getMaxScaleForArtboard, toast, onMultiDragDelta, onDuplicateSelected, startBottomGlow, stopBottomGlow, designs, selectedDesignId, artboardHeight]);

    useEffect(() => {
      if (overlapCheckTimerRef.current) clearTimeout(overlapCheckTimerRef.current);
      overlapCheckTimerRef.current = setTimeout(() => { checkPixelOverlap(); }, 150);
      return () => { if (overlapCheckTimerRef.current) clearTimeout(overlapCheckTimerRef.current); };
    }, [checkPixelOverlap]);

    const handleInteractionEnd = useCallback(() => {
      if (isMarqueeRef.current) {
        isMarqueeRef.current = false;
        const mr = marqueeRect;
        setMarqueeRect(null);
        const cvs = canvasRef.current;
        if (mr && mr.w > 4 && mr.h > 4 && cvs) {
          const hitIds: string[] = [];
          for (const d of designs) {
            const rect = computeLayerRect(
              d.imageInfo.image.width, d.imageInfo.image.height,
              d.transform, cvs.width, cvs.height,
              artboardWidth, artboardHeight,
              d.widthInches, d.heightInches,
            );
            const dcx = rect.x + rect.width / 2;
            const dcy = rect.y + rect.height / 2;
            const dhw = rect.width / 2;
            const dhh = rect.height / 2;
            if (dcx + dhw > mr.x && dcx - dhw < mr.x + mr.w &&
                dcy + dhh > mr.y && dcy - dhh < mr.y + mr.h) {
              hitIds.push(d.id);
            }
          }
          if (hitIds.length > 0) {
            onMultiSelect?.(hitIds);
          }
        }
        return;
      }

      if (isMultiDragRef.current) {
        isMultiDragRef.current = false;
        altDragDuplicatedRef.current = false;
        stopBottomGlow();
        if (containerRef.current) containerRef.current.style.cursor = 'default';
        onInteractionEnd?.();
        return;
      }

      const wasInteracting = isDraggingRef.current || isResizingRef.current || isRotatingRef.current;
      isDraggingRef.current = false;
      isResizingRef.current = false;
      isRotatingRef.current = false;
      resizeCommittedRef.current = false;
      altDragDuplicatedRef.current = false;
      snapGuidesRef.current = [];
      stopBottomGlow();
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      checkPixelOverlap();
      if (wasInteracting) onInteractionEnd?.();
    }, [checkPixelOverlap, onInteractionEnd, marqueeRect, designs, artboardWidth, artboardHeight, onMultiSelect, stopBottomGlow]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
        if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        return;
      }
      handleInteractionStart(e.clientX, e.clientY);
    }, [handleInteractionStart, panX, panY]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
      if (!selectedDesignId || !onTransformChange) return;
      const local = canvasToLocal(e.clientX, e.clientY);
      const handleHit = hitTestHandles(local.x, local.y);
      if (handleHit?.type === 'rotate') {
        const updated = { ...transformRef.current, rotation: 0 };
        transformRef.current = updated;
        onTransformChange(updated);
      }
    }, [selectedDesignId, onTransformChange, canvasToLocal, hitTestHandles]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        const rawPx = panStartRef.current.px + dx / zoom;
        const rawPy = panStartRef.current.py + dy / zoom;
        const clamped = clampPanValue(rawPx, rawPy, zoom);
        setPanX(clamped.x);
        setPanY(clamped.y);
        return;
      }
      if (isMarqueeRef.current || isMultiDragRef.current || isDraggingRef.current || isResizingRef.current || isRotatingRef.current) {
        handleInteractionMove(e.clientX, e.clientY);
        return;
      }
      if (!containerRef.current) return;
      if (spaceDownRef.current) {
        containerRef.current.style.cursor = 'grab';
        return;
      }
      const local = canvasToLocal(e.clientX, e.clientY);
      if (imageInfo && selectedDesignId) {
        const handleHit = hitTestHandles(local.x, local.y);
        if (handleHit) {
          containerRef.current.style.cursor = handleHit.type === 'resize'
            ? getResizeCursor(handleHit.id, transformRef.current.rotation)
            : ROTATE_CURSOR;
          return;
        }
        if (hitTestDesign(local.x, local.y)) {
          containerRef.current.style.cursor = 'move';
          return;
        }
      }
      const hitId = findDesignAtPoint(local.x, local.y);
      containerRef.current.style.cursor = hitId ? 'pointer' : 'default';
    }, [handleInteractionMove, canvasToLocal, imageInfo, selectedDesignId, hitTestHandles, hitTestDesign, findDesignAtPoint, zoom, clampPanValue]);

    const handleMouseUp = useCallback(() => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (containerRef.current) containerRef.current.style.cursor = spaceDownRef.current ? 'grab' : 'default';
        return;
      }
      handleInteractionEnd();
    }, [handleInteractionEnd]);

    const handleMouseEnter = useCallback(() => {
      isKeyboardScopeActiveRef.current = true;
    }, []);

    const handleMouseLeave = useCallback(() => {
      isKeyboardScopeActiveRef.current = false;
      spaceDownRef.current = false;
      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }
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
      const fitZoom = Math.min(scaleX, scaleY);
      setZoom(Math.max(minZoomRef.current, Math.min(ZOOM_MAX, Math.round(fitZoom * 20) / 20)));
      setPanX(0);
      setPanY(0);
    }, [previewDims.height, previewDims.width]);
    
    // Reset view to default zoom and pan
    const resetView = useCallback(() => {
      setZoom(1);
      setPanX(0);
      setPanY(0);
    }, []);
    
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        isWheelZoomingRef.current = true;
        if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
        wheelTimeoutRef.current = setTimeout(() => { isWheelZoomingRef.current = false; }, 200);

        const oldZoom = zoomRef.current;
        const factor = e.deltaY > 0 ? 1 / ZOOM_WHEEL_FACTOR : ZOOM_WHEEL_FACTOR;
        const effectiveMin = minZoomRef.current;
        const newZoom = Math.max(effectiveMin, Math.min(ZOOM_MAX, oldZoom * factor));
        if (newZoom === oldZoom) return;

        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - (rect.left + rect.width / 2);
        const cursorY = e.clientY - (rect.top + rect.height / 2);

        const ratio = newZoom / oldZoom;
        const oldPx = panXRef.current;
        const oldPy = panYRef.current;
        const rawPanX = oldPx - (cursorX / oldZoom) * (ratio - 1);
        const rawPanY = oldPy - (cursorY / oldZoom) * (ratio - 1);
        const dims = previewDimsRef.current;
        const maxPx = dims.width * 0.5 / newZoom;
        const maxPy = dims.height * 0.5 / newZoom;
        const clampedPanX = Math.max(-maxPx, Math.min(maxPx, rawPanX));
        const clampedPanY = Math.max(-maxPy, Math.min(maxPy, rawPanY));

        setZoom(newZoom);
        setPanX(clampedPanX);
        setPanY(clampedPanY);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', onWheel);
        if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      };
    }, []);
    
    // Reset zoom to 100% and pan to origin when a new image is loaded
    const knownImageKeysRef = useRef<Set<string>>(new Set());
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

      if (!knownImageKeysRef.current.has(imageKey)) {
        knownImageKeysRef.current.add(imageKey);
        setZoom(1);
        setPanX(0);
        setPanY(0);
      }
    }, [imageInfo]);

    useEffect(() => {
      const wrapper = containerRef.current?.parentElement?.parentElement;
      if (!wrapper) return;
      const updateSize = () => {
        const availW = wrapper.clientWidth - 48;
        const availH = wrapper.clientHeight - 48;
        if (availW <= 0 || availH <= 0) return;
        const artboardAspect = artboardWidth / artboardHeight;
        let w: number, h: number;
        if (availW / availH > artboardAspect) {
          h = Math.round(Math.max(200, availH));
          w = Math.round(h * artboardAspect);
        } else {
          w = Math.round(Math.max(200, availW));
          h = Math.round(w / artboardAspect);
        }
        setPreviewDims({ width: w, height: h });
        requestAnimationFrame(() => { minZoomRef.current = getMinZoom(); });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(wrapper);
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
      const canvas = canvasRef.current;
      if (!canvas) return null as any;
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
      if (contourDebounceRef.current) {
        clearTimeout(contourDebounceRef.current);
        contourDebounceRef.current = null;
      }
      contourCacheRef.current = null;
      contourTransformRef.current = null;
    }, [imageInfo]);

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
      ctx.scale(design.transform.flipX ? -1 : 1, design.transform.flipY ? -1 : 1);
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
        const pattern = getCheckerboardPattern(ctx, canvasWidth, canvasHeight);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
      } else {
        ctx.fillStyle = previewBgColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
      ctx.lineWidth = Math.max(1, DPI_SCALE);
      ctx.setLineDash([6 * DPI_SCALE, 4 * DPI_SCALE]);
      ctx.strokeRect(0.5, 0.5, canvasWidth - 1, canvasHeight - 1);
      ctx.setLineDash([]);
      ctx.restore();

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

      if (!imageInfo || !selectedDesignId) return;

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
        if (shapeSettings.enabled) {
          drawShapePreview(ctx, canvas.width, canvas.height);
        } else {
          drawImageWithResizePreview(ctx, canvas.width, canvas.height);
        }

      }

      // Draw smart alignment guides
      if (snapGuidesRef.current.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 1 * DPI_SCALE;
        ctx.setLineDash([4 * DPI_SCALE, 4 * DPI_SCALE]);
        ctx.globalAlpha = 0.8;
        for (const guide of snapGuidesRef.current) {
          ctx.beginPath();
          if (guide.axis === 'x') {
            const px = guide.pos * canvasWidth;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvasHeight);
          } else {
            const py = guide.pos * canvasHeight;
            ctx.moveTo(0, py);
            ctx.lineTo(canvasWidth, py);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
      
      
      
      if (marqueeRect) {
        ctx.save();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1 * DPI_SCALE;
        ctx.setLineDash([4 * DPI_SCALE, 4 * DPI_SCALE]);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
        ctx.fillRect(marqueeRect.x, marqueeRect.y, marqueeRect.w, marqueeRect.h);
        ctx.strokeRect(marqueeRect.x, marqueeRect.y, marqueeRect.w, marqueeRect.h);
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (selectedDesignIds.size > 1) {
        const z = Math.max(0.25, zoomRef.current);
        const inv = DPI_SCALE / z;
        for (const d of designs) {
          if (!selectedDesignIds.has(d.id)) continue;
          const r = computeLayerRect(
            d.imageInfo.image.width, d.imageInfo.image.height,
            d.transform, canvasWidth, canvasHeight,
            artboardWidth, artboardHeight, d.widthInches, d.heightInches,
          );
          const cx2 = r.x + r.width / 2;
          const cy2 = r.y + r.height / 2;
          const hw2 = r.width / 2;
          const hh2 = r.height / 2;
          const rad2 = (d.transform.rotation * Math.PI) / 180;
          const cos2 = Math.cos(rad2);
          const sin2 = Math.sin(rad2);
          const corners2 = [
            { lx: -hw2, ly: -hh2 }, { lx: hw2, ly: -hh2 },
            { lx: hw2, ly: hh2 }, { lx: -hw2, ly: hh2 },
          ];
          const pts2 = corners2.map(c => ({
            x: cx2 + c.lx * cos2 - c.ly * sin2,
            y: cy2 + c.lx * sin2 + c.ly * cos2,
          }));
          ctx.save();
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1.5 * inv;
          ctx.setLineDash([3 * inv, 3 * inv]);
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(pts2[0].x, pts2[0].y);
          for (let i = 1; i < pts2.length; i++) ctx.lineTo(pts2[i].x, pts2[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // Draw bottom-edge glow when user is dragging near the bottom
      if (bottomGlow > 0 && artboardHeight < 24) {
        ctx.save();
        const glowH = canvasHeight * 0.18;
        const grad = ctx.createLinearGradient(0, canvasHeight - glowH, 0, canvasHeight);
        const alpha = 0.15 + bottomGlow * 0.45;
        grad.addColorStop(0, 'rgba(6, 182, 212, 0)');
        grad.addColorStop(0.5, `rgba(6, 182, 212, ${(alpha * 0.5).toFixed(3)})`);
        grad.addColorStop(1, `rgba(6, 182, 212, ${alpha.toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, canvasHeight - glowH, canvasWidth, glowH);

        // Progress bar at the very bottom
        const barH = 4 * DPI_SCALE;
        ctx.fillStyle = `rgba(34, 211, 238, ${(0.6 + bottomGlow * 0.4).toFixed(2)})`;
        ctx.fillRect(0, canvasHeight - barH, canvasWidth * bottomGlow, barH);

        // Text label
        const fontSize = Math.max(11, 13 * DPI_SCALE);
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.5 + bottomGlow * 0.5).toFixed(2)})`;
        const seconds = Math.max(0, 2 - Math.round(bottomGlow * 2));
        ctx.fillText(
          seconds > 0 ? `Expand to ${artboardHeight + 1}" in ${seconds}s…` : 'Expanding…',
          canvasWidth / 2,
          canvasHeight - barH - 6 * DPI_SCALE,
        );
        ctx.restore();
      }

      };
      doRender();
      renderRef.current = doRender;
    }, [imageInfo, strokeSettings, resizeSettings, shapeSettings, cadCutBounds, backgroundColor, isProcessing, spotPreviewData, previewDims.height, previewDims.width, lockedContour, artboardWidth, artboardHeight, designTransform, designs, selectedDesignId, selectedDesignIds, drawSingleDesign, overlappingDesigns, previewBgColor, marqueeRect, bottomGlow]);

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
        lastSettingsRef.current = settingsKey;
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
      ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
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
      const accentColor = isOverlap ? '#ff4444' : '#22d3ee';
      const accentGlow = isOverlap ? 'rgba(255,68,68,0.3)' : 'rgba(34,211,238,0.25)';
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const z = Math.max(0.25, zoomRef.current);
      const inv = DPI_SCALE / z;

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

      ctx.shadowColor = accentGlow;
      ctx.shadowBlur = 8 * inv;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5 * inv;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (isOverlap) {
        const fontSize = Math.round(11 * inv);
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#ff4444';
        ctx.textAlign = 'center';
        const botMidX = (pts[2].x + pts[3].x) / 2;
        const botMidY = (pts[2].y + pts[3].y) / 2;
        const offsetDown = 14 * inv;
        const labelX = botMidX + sin * offsetDown;
        const labelY = botMidY + cos * offsetDown;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText('Overlapping', labelX, labelY);
        ctx.restore();
      }

      const handleSize = 5 * inv;
      const handleR = 1.5 * inv;
      const borderW = 1.5 * inv;
      for (const p of pts) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rad);
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 3 * inv;
        ctx.shadowOffsetY = 1 * inv;
        ctx.beginPath();
        ctx.roundRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2, handleR);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = borderW;
        ctx.stroke();
        ctx.restore();
      }

      const topMidX = (pts[0].x + pts[1].x) / 2;
      const topMidY = (pts[0].y + pts[1].y) / 2;
      const rotDist = 24 * inv;
      const upDirX = -sin;
      const upDirY = -cos;
      const rotHandleX = topMidX + upDirX * rotDist;
      const rotHandleY = topMidY + upDirY * rotDist;

      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1 * inv;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(topMidX, topMidY);
      ctx.lineTo(rotHandleX, rotHandleY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 3 * inv;
      ctx.shadowOffsetY = 1 * inv;
      const rotR = 6 * inv;
      ctx.beginPath();
      ctx.arc(rotHandleX, rotHandleY, rotR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = borderW;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(rotHandleX, rotHandleY);
      ctx.rotate(rad);
      const arrowR = 3.5 * inv;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.2 * inv;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, arrowR, -Math.PI * 0.7, Math.PI * 0.4);
      ctx.stroke();
      const tipAngle = Math.PI * 0.4;
      const tipX = arrowR * Math.cos(tipAngle);
      const tipY = arrowR * Math.sin(tipAngle);
      const aLen = 2.5 * inv;
      ctx.beginPath();
      ctx.moveTo(tipX + aLen * Math.cos(tipAngle - 0.3), tipY + aLen * Math.sin(tipAngle - 0.3));
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX + aLen * Math.cos(tipAngle + Math.PI * 0.5), tipY + aLen * Math.sin(tipAngle + Math.PI * 0.5));
      ctx.stroke();
      ctx.restore();

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
      <div className="h-full flex flex-col">
        {/* Canvas area - fills available height */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-gray-950 p-3 relative">
          <div className="relative" style={{ paddingBottom: 16, paddingRight: 14 }}>
            <div 
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClick}
              onMouseMove={handleMouseMove}
              onMouseEnter={handleMouseEnter}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className={`relative rounded-lg border border-gray-600 flex items-center justify-center cursor-default ${showHighlight ? 'ring-4 ring-cyan-400 ring-opacity-75' : ''}`}
              style={{ 
                width: previewDims.width,
                height: previewDims.height,
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
                  transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
                  transformOrigin: 'center',
                  transition: isWheelZoomingRef.current || isPanningRef.current ? 'none' : 'transform 0.15s ease-out'
                }}
              />
              
              {!imageInfo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-gray-300 text-sm opacity-50">Upload a design</p>
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
            <div className="absolute bottom-0 left-0 right-3.5 flex justify-center pointer-events-none">
              <span className="text-[10px] text-gray-500 font-medium tracking-wide">{artboardWidth}"</span>
            </div>
            <div className="absolute right-0 top-0 bottom-4 flex items-center pointer-events-none">
              <span className="text-[10px] text-gray-500 font-medium tracking-wide" style={{ writingMode: 'vertical-rl' }}>{artboardHeight}"</span>
            </div>
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 bg-gray-900 border-t border-gray-800 px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                {selectedDesignId && designTransform && (
                  <>
                    <span className="text-[11px] text-gray-400 font-medium tabular-nums">
                      {(resizeSettings.widthInches * (designTransform.s || 1)).toFixed(2)}" × {(resizeSettings.heightInches * (designTransform.s || 1)).toFixed(2)}"
                    </span>
                    <div className="w-px h-3.5 bg-gray-600" />
                    {editingRotation ? (
                      <input
                        type="number"
                        className="w-12 h-5 bg-gray-700 text-[11px] text-gray-200 text-center rounded border border-gray-600 outline-none"
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
                        className="text-[11px] text-gray-400 font-medium cursor-pointer hover:text-gray-200 tabular-nums"
                        title="Click to edit rotation"
                        onClick={() => {
                          setRotationInput(String(Math.round(designTransform.rotation || 0)));
                          setEditingRotation(true);
                        }}
                      >
                        {Math.round(designTransform.rotation || 0)}°
                      </span>
                    )}
                    <div className="w-px h-3.5 bg-gray-600" />
                  </>
                )}
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(prev => Math.max(prev / ZOOM_BUTTON_FACTOR, minZoomRef.current))}
                    className="h-6 w-6 p-0 hover:bg-gray-700 rounded"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-3 w-3 text-gray-400" />
                  </Button>
                  <span className="text-[11px] text-gray-400 min-w-[36px] text-center font-medium tabular-nums">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(prev => Math.min(prev * ZOOM_BUTTON_FACTOR, ZOOM_MAX))}
                    className="h-6 w-6 p-0 hover:bg-gray-700 rounded"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-3 w-3 text-gray-400" />
                  </Button>
                </div>
                <div className="w-px h-3.5 bg-gray-600" />
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={fitToView}
                  className="h-6 px-1.5 hover:bg-gray-700 rounded text-gray-400 text-[11px]"
                  title="Fit to View"
                >
                  <Maximize2 className="h-2.5 w-2.5 mr-0.5" />
                  Fit
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={resetView}
                  className="h-6 px-1.5 hover:bg-gray-700 rounded text-gray-400 text-[11px]"
                  title="Reset View"
                >
                  <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
                  Reset
                </Button>
              </div>

              <div className="flex items-center gap-1">
                {[
                  { color: 'transparent', label: 'Transparent' },
                  { color: '#ffffff', label: 'White' },
                  { color: '#d1d5db', label: 'Light Gray' },
                  { color: '#6b7280', label: 'Gray' },
                  { color: '#000000', label: 'Black' },
                ].map(({ color, label }) => (
                  <button
                    key={color}
                    onClick={() => setPreviewBgColor(color)}
                    className={`w-4.5 h-4.5 rounded-full border-2 transition-all ${previewBgColor === color ? 'border-cyan-400 scale-110' : 'border-gray-600 hover:border-gray-400'}`}
                    title={label}
                    style={{
                      width: 18,
                      height: 18,
                      background: color === 'transparent'
                        ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px'
                        : color
                    }}
                  />
                ))}
              </div>
            </div>

        {/* Keyboard shortcut hints */}
        <div className="hidden lg:flex flex-shrink-0 items-center justify-center gap-4 bg-gray-950/80 border-t border-gray-800/50 px-3 py-0.5 text-[9px] text-gray-600">
          {[
            ['Ctrl+Z', 'Undo'], ['Ctrl+C/V', 'Copy/Paste'],
            ['Alt+Drag', 'Duplicate'], ['Drag Empty', 'Select'],
            ['Arrows', 'Nudge'], ['Scroll', 'Zoom'],
          ].map(([key, label]) => (
            <span key={key} className="flex items-center gap-1">
              <kbd className="px-1 py-px rounded bg-gray-800/60 text-gray-500 font-mono">{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }
);

PreviewSection.displayName = 'PreviewSection';

export default PreviewSection;
