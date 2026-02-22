import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import UploadSection from "./upload-section";
import PreviewSection from "./preview-section";
import ControlsSection, { SpotPreviewData } from "./controls-section";
import { calculateImageDimensions, downloadCanvas } from "@/lib/image-utils";
import { cropImageToContent, cropImageToContentAsync } from "@/lib/image-crop";
import { checkCadCutBounds, type CadCutBounds } from "@/lib/cadcut-bounds";
import type { CachedContourData, SpotColorInput } from "@/lib/contour-outline";
import { getContourWorkerManager, type DetectedAlgorithm, type DetectedShapeInfo } from "@/lib/contour-worker-manager";
import { calculateShapeDimensions, generateShapePathPointsInches } from "@/lib/shape-outline";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { removeBackgroundFromImage } from "@/lib/background-removal";
import { parsePDF, type ParsedPDFData } from "@/lib/pdf-parser";
import { detectShape, mapDetectedShapeToType } from "@/lib/shape-detection";
import { useToast } from "@/hooks/use-toast";
import { useHistory, type HistorySnapshot } from "@/hooks/use-history";
import { Trash2, Copy, ChevronDown, ChevronUp, Info, Undo2, Redo2, RotateCw, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, LayoutGrid, Layers, Loader2, Plus, Droplets, Link, Unlink } from "lucide-react";

export type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize, LockedContour, ImageTransform, DesignItem } from "@/lib/types";
import type { ImageInfo, StrokeSettings, StrokeMode, ResizeSettings, ShapeSettings, StickerSize, LockedContour, ImageTransform, DesignItem } from "@/lib/types";

function SizeInput({ value, onCommit, title }: { value: number; onCommit: (v: number) => void; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = value.toFixed(2);

  if (editing) {
    return (
      <input
        type="text"
        inputMode="decimal"
        className="w-14 h-5 bg-gray-800 border border-cyan-500 rounded text-[11px] font-semibold text-gray-200 text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft);
          if (!isNaN(v) && v > 0) onCommit(v);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = parseFloat(draft);
            if (!isNaN(v) && v > 0) onCommit(v);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        title={title}
      />
    );
  }

  return (
    <input
      type="text"
      readOnly
      className="w-14 h-5 bg-gray-800 border border-gray-700 rounded text-[11px] font-semibold text-gray-200 text-center outline-none cursor-pointer hover:border-gray-500 transition-colors"
      value={display}
      onFocus={() => { setDraft(display); setEditing(true); }}
      title={title}
    />
  );
}

function clampDesignToArtboard(
  d: { widthInches: number; heightInches: number; transform: ImageTransform },
  abW: number, abH: number,
): { nx: number; ny: number } {
  const t = d.transform;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (d.widthInches * t.s * cos + d.heightInches * t.s * sin) / 2;
  const halfH = (d.widthInches * t.s * sin + d.heightInches * t.s * cos) / 2;
  const minNx = halfW / abW;
  const maxNx = 1 - halfW / abW;
  const minNy = halfH / abH;
  const maxNy = 1 - halfH / abH;
  let nx = t.nx;
  let ny = t.ny;
  if (minNx <= maxNx) {
    nx = Math.max(minNx, Math.min(maxNx, nx));
  }
  if (minNy <= maxNy) {
    ny = Math.max(minNy, Math.min(maxNy, ny));
  }
  return { nx, ny };
}

export default function ImageEditor({ onDesignUploaded }: { onDesignUploaded?: () => void } = {}) {
  const { toast } = useToast();
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [cadCutBounds, setCadCutBounds] = useState<CadCutBounds | null>(null);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>({
    width: 0.14, // Default large offset
    color: "#ffffff",
    enabled: false,
    alphaThreshold: 128, // Auto-detected from alpha channel
    backgroundColor: "#ffffff", // Default white background for contour
    useCustomBackground: true, // Default to solid background color
    cornerMode: 'rounded',
    autoBridging: true, // Auto-bridge narrow gaps in contour
    autoBridgingThreshold: 0.02, // Gap threshold in inches
    contourMode: undefined,
  });
  const [resizeSettings, setResizeSettings] = useState<ResizeSettings>({
    widthInches: 5.0,
    heightInches: 3.8,
    maintainAspectRatio: true,
    outputDPI: 300,
  });
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>({
    enabled: false,
    type: 'square',
    offset: 0.25, // Default "Big" offset around design
    fillColor: '#FFFFFF',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    cornerRadius: 0.25, // Default corner radius for rounded shapes (in inches)
    bleedEnabled: false, // Color bleed outside the shape
    bleedColor: '#FFFFFF', // Default bleed color
  });
  const [strokeMode, setStrokeMode] = useState<StrokeMode>('none');
  const [stickerSize, setStickerSize] = useState<StickerSize>(4); // Default 4 inch max dimension
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [spotPreviewData, setSpotPreviewData] = useState<SpotPreviewData>({ enabled: false, colors: [] });
  const [detectedAlgorithm, setDetectedAlgorithm] = useState<DetectedAlgorithm | undefined>(undefined);
  const [detectedShapeType, setDetectedShapeType] = useState<'circle' | 'oval' | 'square' | 'rectangle' | null>(null);
  const [detectedShapeInfo, setDetectedShapeInfo] = useState<DetectedShapeInfo | null>(null);
  const [cutContourLabel, setCutContourLabel] = useState<'CutContour' | 'PerfCutContour' | 'KissCut'>('CutContour');
  const [showCutLabelDropdown, setShowCutLabelDropdown] = useState(false);
  const cutLabelRef = useRef<HTMLDivElement>(null);
  const [lockedContour, setLockedContour] = useState<LockedContour | null>(null);
  const [artboardWidth, setArtboardWidth] = useState(24.5);
  const [artboardHeight, setArtboardHeight] = useState(12);
  const [designTransform, setDesignTransform] = useState<ImageTransform>({ nx: 0.5, ny: 0.5, s: 1, rotation: 0 });
  const [showApplyAddDropdown, setShowApplyAddDropdown] = useState(false);
  const applyAddRef = useRef<HTMLDivElement>(null);
  const [designs, setDesigns] = useState<DesignItem[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [selectedDesignIds, setSelectedDesignIds] = useState<Set<string>>(new Set());
  const [showDesignInfo, setShowDesignInfo] = useState(false);
  const clipboardRef = useRef<DesignItem[]>([]);
  const copySpotSelectionsRef = useRef<((fromId: string, toIds: string[]) => void) | null>(null);
  const [proportionalLock, setProportionalLock] = useState(true);
  const designInfoRef = useRef<HTMLDivElement>(null);
  const sidebarFileRef = useRef<HTMLInputElement>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fluorPanelContainer, setFluorPanelContainer] = useState<HTMLDivElement | null>(null);
  const [downloadContainer, setDownloadContainer] = useState<HTMLDivElement | null>(null);

  // Debounced settings for heavy processing
  const debouncedStrokeSettings = useDebouncedValue(strokeSettings, 100);
  const debouncedResizeSettings = useDebouncedValue(resizeSettings, 250);
  const debouncedShapeSettings = useDebouncedValue(shapeSettings, 100);

  // Undo/Redo history
  const { pushSnapshot, undo, redo, clearIsUndoRedo, canUndo, canRedo } = useHistory();
  const designsRef = useRef(designs);
  designsRef.current = designs;
  const nudgeSnapshotSavedRef = useRef(false);
  const nudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailCacheRef = useRef<Map<string, string>>(new Map());

  const snapshotCacheRef = useRef<{designs: DesignItem[]; json: string; infoMap: Map<string, ImageInfo>} | null>(null);
  const getSnapshot = useCallback((): HistorySnapshot => {
    let json: string;
    let infoMap: Map<string, ImageInfo>;
    const cache = snapshotCacheRef.current;
    if (cache && cache.designs === designs) {
      json = cache.json;
      infoMap = cache.infoMap;
    } else {
      json = JSON.stringify(designs.map(d => ({ id: d.id, transform: d.transform, widthInches: d.widthInches, heightInches: d.heightInches, name: d.name })));
      infoMap = new Map(designs.map(d => [d.id, d.imageInfo]));
      snapshotCacheRef.current = { designs, json, infoMap };
    }
    return { designsJson: json, selectedDesignId, imageInfoMap: infoMap };
  }, [designs, selectedDesignId]);

  const saveSnapshot = useCallback(() => {
    pushSnapshot(getSnapshot());
  }, [pushSnapshot, getSnapshot]);

  const applySnapshot = useCallback((snap: HistorySnapshot) => {
    let parsed: Array<{ id: string; transform: ImageTransform; widthInches: number; heightInches: number; name: string }>;
    try {
      parsed = JSON.parse(snap.designsJson);
    } catch {
      clearIsUndoRedo();
      return;
    }
    const infoMap = snap.imageInfoMap ?? new Map<string, unknown>();
    setDesigns(prev => {
      const lookup = new Map(prev.map(d => [d.id, d]));
      const restored = parsed.map(p => {
        const existing = lookup.get(p.id);
        if (existing) return { ...existing, transform: p.transform, widthInches: p.widthInches, heightInches: p.heightInches, name: p.name };
        const savedInfo = infoMap.get(p.id) as ImageInfo | undefined;
        if (savedInfo) {
          return { id: p.id, imageInfo: savedInfo, transform: p.transform, widthInches: p.widthInches, heightInches: p.heightInches, name: p.name, originalDPI: savedInfo.dpi } as DesignItem;
        }
        return null;
      }).filter(Boolean) as DesignItem[];
      return restored;
    });
    setSelectedDesignId(snap.selectedDesignId);
    if (snap.selectedDesignId) {
      const sel = parsed.find(p => p.id === snap.selectedDesignId);
      if (sel) setDesignTransform(sel.transform);
    }
    clearIsUndoRedo();
  }, [clearIsUndoRedo]);

  const handleUndo = useCallback(() => {
    const snap = undo(getSnapshot());
    if (snap) applySnapshot(snap);
  }, [undo, getSnapshot, applySnapshot]);

  const handleRedo = useCallback(() => {
    const snap = redo(getSnapshot());
    if (snap) applySnapshot(snap);
  }, [redo, getSnapshot, applySnapshot]);

  // Called when a drag/resize/rotate interaction ends on the canvas
  const handleInteractionEnd = useCallback(() => {
    saveSnapshot();
  }, [saveSnapshot]);

  // Function to update CadCut bounds checking - accepts shape settings to avoid stale closure
  const updateCadCutBounds = useCallback((
    shapeWidthInches: number, 
    shapeHeightInches: number,
    currentShapeSettings: ShapeSettings
  ) => {
    if (!imageInfo) {
      setCadCutBounds(null);
      return;
    }

    // Convert inches to pixels for bounds checking
    const shapeWidthPixels = shapeWidthInches * imageInfo.dpi;
    const shapeHeightPixels = shapeHeightInches * imageInfo.dpi;

    const bounds = checkCadCutBounds(
      imageInfo.image,
      currentShapeSettings,
      shapeWidthPixels,
      shapeHeightPixels
    );

    setCadCutBounds(bounds);
  }, [imageInfo]);

  const selectedDesign = useMemo(() => designs.find(d => d.id === selectedDesignId) || null, [designs, selectedDesignId]);
  const activeImageInfo = useMemo(() => selectedDesign?.imageInfo ?? imageInfo, [selectedDesign, imageInfo]);
  const activeDesignTransform = useMemo(() => selectedDesign?.transform ?? designTransform, [selectedDesign, designTransform]);
  const activeWidthInches = useMemo(() => selectedDesign?.widthInches ?? resizeSettings.widthInches, [selectedDesign, resizeSettings.widthInches]);
  const activeHeightInches = useMemo(() => selectedDesign?.heightInches ?? resizeSettings.heightInches, [selectedDesign, resizeSettings.heightInches]);
  const activeResizeSettings = useMemo(() => ({
    ...resizeSettings,
    widthInches: activeWidthInches,
    heightInches: activeHeightInches,
  }), [resizeSettings, activeWidthInches, activeHeightInches]);

  useEffect(() => {
    if (activeImageInfo && onDesignUploaded) {
      onDesignUploaded();
    }
  }, [activeImageInfo, onDesignUploaded]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cutLabelRef.current && !cutLabelRef.current.contains(e.target as Node)) {
        setShowCutLabelDropdown(false);
      }
      if (applyAddRef.current && !applyAddRef.current.contains(e.target as Node)) {
        setShowApplyAddDropdown(false);
      }
      if (designInfoRef.current && !designInfoRef.current.contains(e.target as Node)) {
        setShowDesignInfo(false);
      }
    };
    if (showCutLabelDropdown || showApplyAddDropdown || showDesignInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCutLabelDropdown, showApplyAddDropdown, showDesignInfo]);

  const handleSelectDesign = useCallback((id: string | null) => {
    setSelectedDesignId(id);
    setSelectedDesignIds(id ? new Set([id]) : new Set());
  }, []);

  const handleMultiSelect = useCallback((ids: string[]) => {
    setSelectedDesignIds(new Set(ids));
    if (ids.length === 1) {
      setSelectedDesignId(ids[0]);
    } else if (ids.length === 0) {
      setSelectedDesignId(null);
    } else {
      setSelectedDesignId(ids[ids.length - 1]);
    }
  }, []);

  const getLayerThumbnail = useCallback((design: DesignItem): string => {
    const cache = thumbnailCacheRef.current;
    const key = design.imageInfo.image.src;
    if (cache.has(key)) return cache.get(key)!;
    const THUMB_SIZE = 48;
    const img = design.imageInfo.image;
    const aspect = img.width / img.height;
    const tw = aspect >= 1 ? THUMB_SIZE : Math.round(THUMB_SIZE * aspect);
    const th = aspect >= 1 ? Math.round(THUMB_SIZE / aspect) : THUMB_SIZE;
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, tw, th);
      const dataUrl = c.toDataURL('image/png');
      cache.set(key, dataUrl);
      return dataUrl;
    }
    return key;
  }, []);

  const handleDesignTransformChange = useCallback((transform: ImageTransform) => {
    setDesignTransform(transform);
    if (selectedDesignId) {
      setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, transform } : d));
    }
  }, [selectedDesignId]);

  const handleMultiDragDelta = useCallback((dnx: number, dny: number) => {
    setDesigns(prev => prev.map(d => {
      if (!selectedDesignIds.has(d.id)) return d;
      const tentative = { ...d.transform, nx: d.transform.nx + dnx, ny: d.transform.ny + dny };
      const { nx, ny } = clampDesignToArtboard({ ...d, transform: tentative }, artboardWidth, artboardHeight);
      return { ...d, transform: { ...tentative, nx, ny } };
    }));
  }, [selectedDesignIds, artboardWidth, artboardHeight]);

  const handleEffectiveSizeChange = useCallback((axis: 'width' | 'height', value: number) => {
    if (!selectedDesignId || value <= 0) return;
    const design = designs.find(d => d.id === selectedDesignId);
    if (!design) return;
    saveSnapshot();
    const currentS = design.transform.s;
    const currentW = design.widthInches;
    const currentH = design.heightInches;

    if (proportionalLock) {
      const newS = axis === 'width' ? value / currentW : value / currentH;
      const newTransform = { ...design.transform, s: newS };
      setDesignTransform(newTransform);
      setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, transform: newTransform } : d));
    } else {
      if (axis === 'width') {
        const newW = value / currentS;
        setResizeSettings(prev => ({ ...prev, widthInches: newW }));
        setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, widthInches: newW } : d));
      } else {
        const newH = value / currentS;
        setResizeSettings(prev => ({ ...prev, heightInches: newH }));
        setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, heightInches: newH } : d));
      }
    }
  }, [selectedDesignId, designs, proportionalLock, saveSnapshot]);

  const handleDuplicateDesign = useCallback(() => {
    if (!selectedDesignId) return;
    const design = designs.find(d => d.id === selectedDesignId);
    if (!design) return;
    saveSnapshot();
    const newId = crypto.randomUUID();
    const baseName = design.name.replace(/ copy \d+$/, '');
    const copyCount = designs.filter(d => d.name === baseName || d.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} copy \\d+$`))).length;
    const newDesign: DesignItem = {
      ...design,
      id: newId,
      name: `${baseName} copy ${copyCount}`,
      transform: { ...design.transform, nx: Math.min(design.transform.nx + 0.05, 0.95), ny: Math.min(design.transform.ny + 0.05, 0.95) },
    };
    copySpotSelectionsRef.current?.(selectedDesignId, [newId]);
    setDesigns(prev => [...prev, newDesign]);
    setSelectedDesignId(newId);
    setSelectedDesignIds(new Set([newId]));
  }, [selectedDesignId, designs, saveSnapshot]);

  const handleDuplicateSelected = useCallback((): string[] => {
    const toDup = designs.filter(d => selectedDesignIds.has(d.id));
    if (toDup.length === 0) return [];
    saveSnapshot();
    const newIds: string[] = [];
    const newDesigns: DesignItem[] = toDup.map(d => {
      const newId = crypto.randomUUID();
      newIds.push(newId);
      copySpotSelectionsRef.current?.(d.id, [newId]);
      return { ...d, id: newId, name: d.name + ' copy', transform: { ...d.transform } };
    });
    setDesigns(prev => [...prev, ...newDesigns]);
    setSelectedDesignIds(new Set(newIds));
    if (newIds.length === 1) setSelectedDesignId(newIds[0]);
    else setSelectedDesignId(newIds[newIds.length - 1]);
    return newIds;
  }, [designs, selectedDesignIds, saveSnapshot]);

  const handleCopySelected = useCallback(() => {
    const toCopy = designs.filter(d => selectedDesignIds.has(d.id));
    if (toCopy.length === 0) return;
    clipboardRef.current = toCopy.map(d => ({ ...d }));
    toast({ title: `Copied ${toCopy.length} design${toCopy.length > 1 ? 's' : ''}` });
  }, [designs, selectedDesignIds, toast]);

  const handlePaste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    saveSnapshot();
    const newIds: string[] = [];
    const pasted: DesignItem[] = clipboardRef.current.map(d => {
      const newId = crypto.randomUUID();
      newIds.push(newId);
      copySpotSelectionsRef.current?.(d.id, [newId]);
      return {
        ...d,
        id: newId,
        name: d.name.replace(/ copy$/, '') + ' copy',
        transform: { ...d.transform, nx: Math.min(d.transform.nx + 0.03, 0.95), ny: Math.min(d.transform.ny + 0.03, 0.95) },
      };
    });
    setDesigns(prev => [...prev, ...pasted]);
    setSelectedDesignIds(new Set(newIds));
    setSelectedDesignId(newIds[newIds.length - 1]);
  }, [saveSnapshot]);

  const handleDeleteDesign = useCallback((id: string) => {
    saveSnapshot();
    const remaining = designsRef.current.filter(d => d.id !== id);
    setDesigns(remaining);
    if (selectedDesignId === id) {
      if (remaining.length > 0) {
        setSelectedDesignId(remaining[remaining.length - 1].id);
      } else {
        setSelectedDesignId(null);
        setImageInfo(null);
      }
    }
  }, [selectedDesignId, saveSnapshot]);

  const handleDeleteMulti = useCallback((ids: Set<string>) => {
    saveSnapshot();
    const remaining = designsRef.current.filter(d => !ids.has(d.id));
    setDesigns(remaining);
    setSelectedDesignIds(new Set());
    if (remaining.length > 0) {
      setSelectedDesignId(remaining[remaining.length - 1].id);
    } else {
      setSelectedDesignId(null);
      setImageInfo(null);
    }
  }, [saveSnapshot]);

  const handleRotate90 = useCallback(() => {
    if (!selectedDesignId) return;
    saveSnapshot();
    setDesigns(prev => prev.map(d => {
      if (d.id !== selectedDesignId) return d;
      const newRot = ((d.transform.rotation + 90) % 360);
      const rotated = { ...d, transform: { ...d.transform, rotation: newRot } };
      const { nx, ny } = clampDesignToArtboard(rotated, artboardWidth, artboardHeight);
      return { ...rotated, transform: { ...rotated.transform, nx, ny } };
    }));
    setDesignTransform(prev => {
      const newRot = ((prev.rotation + 90) % 360);
      return { ...prev, rotation: newRot };
    });
  }, [selectedDesignId, saveSnapshot, artboardWidth, artboardHeight]);

  const getAlignNxNy = useCallback((corner: 'tl' | 'tr' | 'bl' | 'br') => {
    const design = designsRef.current.find(d => d.id === selectedDesignId);
    if (!design) return null;
    const t = design.transform;
    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const halfW = (design.widthInches * t.s * cos + design.heightInches * t.s * sin) / 2;
    const halfH = (design.widthInches * t.s * sin + design.heightInches * t.s * cos) / 2;
    const left = halfW / artboardWidth;
    const right = 1 - halfW / artboardWidth;
    const top = halfH / artboardHeight;
    const bottom = 1 - halfH / artboardHeight;
    switch (corner) {
      case 'tl': return { nx: left, ny: top };
      case 'tr': return { nx: right, ny: top };
      case 'bl': return { nx: left, ny: bottom };
      case 'br': return { nx: right, ny: bottom };
    }
  }, [selectedDesignId, artboardWidth, artboardHeight]);

  const handleAlignCorner = useCallback((corner: 'tl' | 'tr' | 'bl' | 'br') => {
    if (!selectedDesignId) return;
    const pos = getAlignNxNy(corner);
    if (!pos) return;
    saveSnapshot();
    setDesigns(prev => prev.map(d => d.id === selectedDesignId
      ? { ...d, transform: { ...d.transform, nx: pos.nx, ny: pos.ny } }
      : d
    ));
    setDesignTransform(prev => ({ ...prev, nx: pos.nx, ny: pos.ny }));
  }, [selectedDesignId, saveSnapshot, getAlignNxNy]);

  const handleAutoArrange = useCallback(() => {
    if (designs.length === 0) return;
    saveSnapshot();

    const GAP = 0.25;
    const marginX = 0.2;
    const marginY = 0.2;
    const usableW = artboardWidth - marginX * 2;
    const usableH = artboardHeight - marginY * 2;

    const rotatedBBox = (d: DesignItem) => {
      const rad = (d.transform.rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rw = d.widthInches * d.transform.s;
      const rh = d.heightInches * d.transform.s;
      return { w: rw * cos + rh * sin, h: rw * sin + rh * cos };
    };
    const sorted = [...designs].sort((a, b) => {
      const bboxA = rotatedBBox(a);
      const bboxB = rotatedBBox(b);
      if (Math.abs(bboxB.h - bboxA.h) > 0.01) return bboxB.h - bboxA.h;
      return (bboxB.w * bboxB.h) - (bboxA.w * bboxA.h);
    });

    // Skyline packing: track top-edge profile as segments [{x, y, w}]
    let skyline: Array<{x: number; y: number; w: number}> = [{ x: 0, y: 0, w: usableW }];

    const findBestPosition = (itemW: number, itemH: number): {x: number; y: number} | null => {
      let bestX = -1, bestY = Infinity, bestIdx = -1;

      for (let i = 0; i < skyline.length; i++) {
        // Check if item fits starting at skyline[i]
        let spanW = 0;
        let maxY = 0;
        let j = i;
        while (j < skyline.length && spanW < itemW) {
          maxY = Math.max(maxY, skyline[j].y);
          spanW += skyline[j].w;
          j++;
        }
        if (spanW < itemW - 0.001) continue; // doesn't fit horizontally
        if (maxY + itemH > usableH + 0.001) continue; // doesn't fit vertically

        if (maxY < bestY || (Math.abs(maxY - bestY) < 0.001 && skyline[i].x < bestX)) {
          bestY = maxY;
          bestX = skyline[i].x;
          bestIdx = i;
        }
      }

      if (bestIdx < 0) return null;
      return { x: bestX, y: bestY };
    };

    const placeSkyline = (px: number, itemW: number, itemH: number) => {
      const newSeg: typeof skyline[0] = { x: px, y: 0, w: itemW };
      // Compute new top for this segment
      let topY = 0;
      for (const s of skyline) {
        const sRight = s.x + s.w;
        const iRight = px + itemW;
        if (s.x < iRight && sRight > px) {
          topY = Math.max(topY, s.y);
        }
      }
      newSeg.y = topY + itemH;

      // Rebuild skyline: trim/split segments overlapping with placed item
      const next: typeof skyline = [];
      for (const s of skyline) {
        const sRight = s.x + s.w;
        const iRight = px + itemW;
        if (sRight <= px || s.x >= iRight) {
          next.push(s); // no overlap
        } else {
          if (s.x < px) next.push({ x: s.x, y: s.y, w: px - s.x });
          if (sRight > iRight) next.push({ x: iRight, y: s.y, w: sRight - iRight });
        }
      }
      next.push(newSeg);
      next.sort((a, b) => a.x - b.x);

      // Merge adjacent segments at the same height
      const merged: typeof skyline = [next[0]];
      for (let k = 1; k < next.length; k++) {
        const prev = merged[merged.length - 1];
        if (Math.abs(prev.y - next[k].y) < 0.001 && Math.abs((prev.x + prev.w) - next[k].x) < 0.001) {
          prev.w += next[k].w;
        } else {
          merged.push(next[k]);
        }
      }
      skyline = merged;
    };

    const placed: Array<{id: string; nx: number; ny: number; overflows: boolean}> = [];

    for (const d of sorted) {
      const rad = (d.transform.rotation * Math.PI) / 180;
      const cosR = Math.abs(Math.cos(rad));
      const sinR = Math.abs(Math.sin(rad));
      const rawW = d.widthInches * d.transform.s;
      const rawH = d.heightInches * d.transform.s;
      const w = rawW * cosR + rawH * sinR;
      const h = rawW * sinR + rawH * cosR;
      const paddedW = w + GAP;
      const paddedH = h + GAP;

      const pos = findBestPosition(paddedW, paddedH) ?? findBestPosition(w, h);

      if (pos) {
        placeSkyline(pos.x, paddedW, paddedH);
        const absX = marginX + pos.x + w / 2;
        const absY = marginY + pos.y + h / 2;
        const nx = Math.max(w / 2 / artboardWidth, Math.min((artboardWidth - w / 2) / artboardWidth, absX / artboardWidth));
        const ny = Math.max(h / 2 / artboardHeight, Math.min((artboardHeight - h / 2) / artboardHeight, absY / artboardHeight));
        placed.push({ id: d.id, nx, ny, overflows: false });
      } else {
        const absX = marginX + w / 2;
        const skylineMax = skyline.length > 0 ? Math.max(...skyline.map(s => s.y)) : 0;
        const absY = skylineMax + marginY + h / 2;
        const nx = Math.max(w / 2 / artboardWidth, Math.min((artboardWidth - w / 2) / artboardWidth, absX / artboardWidth));
        const ny = Math.max(h / 2 / artboardHeight, Math.min((artboardHeight - h / 2) / artboardHeight, absY / artboardHeight));
        placed.push({ id: d.id, nx, ny, overflows: true });
      }
    }

    const hasOverflow = placed.some(p => p.overflows);
    if (hasOverflow) {
      toast({ title: "Artboard overflow", description: "Some designs don't fit. Consider using a larger gangsheet size.", variant: "destructive" });
    }

    setDesigns(prev => prev.map(d => {
      const p = placed.find(p => p.id === d.id);
      if (!p) return d;
      return { ...d, transform: { ...d.transform, nx: p.nx, ny: p.ny, rotation: 0 } };
    }));
    setSelectedDesignId(null);
  }, [designs, artboardWidth, artboardHeight, saveSnapshot, toast]);

  const handleArtboardResize = useCallback((newWidth: number, newHeight: number) => {
    if (designs.length === 0) {
      setArtboardWidth(newWidth);
      setArtboardHeight(newHeight);
      return;
    }

    saveSnapshot();
    const oldW = artboardWidth;
    const oldH = artboardHeight;

    // Preserve absolute positions — never clamp or shift.
    // Designs that end up outside the new bounds will be highlighted red.
    setDesigns(prev => prev.map(d => {
      const absCx = d.transform.nx * oldW;
      const absCy = d.transform.ny * oldH;
      return {
        ...d,
        transform: { ...d.transform, nx: absCx / newWidth, ny: absCy / newHeight },
      };
    }));

    setArtboardWidth(newWidth);
    setArtboardHeight(newHeight);
  }, [designs, artboardWidth, artboardHeight, saveSnapshot]);

  const MAX_ARTBOARD_HEIGHT = 24;
  const handleExpandArtboard = useCallback(() => {
    if (artboardHeight >= MAX_ARTBOARD_HEIGHT) return;
    const nextHeight = Math.min(artboardHeight + 1, MAX_ARTBOARD_HEIGHT);
    handleArtboardResize(artboardWidth, nextHeight);
  }, [artboardHeight, artboardWidth, handleArtboardResize]);

  // Stable refs for keyboard handler to avoid frequent re-registration
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleRedoRef = useRef(handleRedo);
  handleRedoRef.current = handleRedo;
  const handleDuplicateDesignRef = useRef(handleDuplicateDesign);
  handleDuplicateDesignRef.current = handleDuplicateDesign;
  const handleDeleteDesignRef = useRef(handleDeleteDesign);
  handleDeleteDesignRef.current = handleDeleteDesign;
  const handleDeleteMultiRef = useRef(handleDeleteMulti);
  handleDeleteMultiRef.current = handleDeleteMulti;
  const handleCopySelectedRef = useRef(handleCopySelected);
  handleCopySelectedRef.current = handleCopySelected;
  const handlePasteRef = useRef(handlePaste);
  handlePasteRef.current = handlePaste;
  const handleRotate90Ref = useRef(handleRotate90);
  handleRotate90Ref.current = handleRotate90;
  const selectedDesignIdRef = useRef(selectedDesignId);
  selectedDesignIdRef.current = selectedDesignId;
  const showDesignInfoRef = useRef(showDesignInfo);
  showDesignInfoRef.current = showDesignInfo;
  const saveSnapshotRef = useRef(saveSnapshot);
  saveSnapshotRef.current = saveSnapshot;
  const artboardWidthRef = useRef(artboardWidth);
  artboardWidthRef.current = artboardWidth;
  const artboardHeightRef = useRef(artboardHeight);
  artboardHeightRef.current = artboardHeight;
  const selectedDesignIdsRef = useRef(selectedDesignIds);
  selectedDesignIdsRef.current = selectedDesignIds;

  // Keyboard shortcuts — registered once, uses refs for latest handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const selId = selectedDesignIdRef.current;

      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current();
        return;
      }
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        handleCopySelectedRef.current();
        return;
      }
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        handlePasteRef.current();
        return;
      }
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        handleDuplicateDesignRef.current();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) {
        e.preventDefault();
        const idsToDelete = selectedDesignIdsRef.current;
        if (idsToDelete.size > 1) {
          handleDeleteMultiRef.current(idsToDelete);
        } else {
          handleDeleteDesignRef.current(selId);
        }
        return;
      }

      if (selId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (!nudgeSnapshotSavedRef.current) {
          saveSnapshotRef.current();
          nudgeSnapshotSavedRef.current = true;
        }
        if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
        nudgeTimeoutRef.current = setTimeout(() => { nudgeSnapshotSavedRef.current = false; }, 500);
        const step = e.shiftKey ? 0.02 : 0.005;
        const current = designsRef.current.find(d => d.id === selId);
        if (!current) return;
        let { nx, ny } = current.transform;
        if (e.key === 'ArrowUp') ny -= step;
        if (e.key === 'ArrowDown') ny += step;
        if (e.key === 'ArrowLeft') nx -= step;
        if (e.key === 'ArrowRight') nx += step;
        const tentative = { ...current.transform, nx, ny };
        const { nx: clNx, ny: clNy } = clampDesignToArtboard(
          { ...current, transform: tentative },
          artboardWidthRef.current, artboardHeightRef.current,
        );
        const newTransform = { ...tentative, nx: clNx, ny: clNy };
        setDesignTransform(newTransform);
        setDesigns(prev => prev.map(d => d.id === selId ? { ...d, transform: newTransform } : d));
      }

      if (e.key === 'Escape') {
        if (showDesignInfoRef.current) setShowDesignInfo(false);
        setSelectedDesignId(null);
        setSelectedDesignIds(new Set());
      }
      if (selId && !ctrl && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRotate90Ref.current();
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
    };
  }, []);

  const handleApplyAndAdd = useCallback((newLabel: 'CutContour' | 'PerfCutContour' | 'KissCut') => {
    const workerManager = getContourWorkerManager();
    const contourData = workerManager.getCachedContourData();

    if (contourData && contourData.pathPoints && contourData.pathPoints.length >= 3) {
      const previewCanvas = canvasRef.current as any;
      const contourCanvasInfo = previewCanvas?.getContourCanvasInfo?.();
      const cw = contourCanvasInfo?.width ?? 1;
      const ch = contourCanvasInfo?.height ?? 1;
      const icx = contourCanvasInfo?.imageCanvasX ?? 0;
      const icy = contourCanvasInfo?.imageCanvasY ?? 0;
      const ds = contourCanvasInfo?.downsampleScale ?? 1;
      const currentImg = selectedDesign?.imageInfo || imageInfo;
      const icw = currentImg ? Math.round(currentImg.image.width * ds) : cw;
      const ich = currentImg ? Math.round(currentImg.image.height * ds) : ch;

      setLockedContour({
        label: cutContourLabel,
        pathPoints: [...contourData.pathPoints],
        previewPathPoints: [...contourData.previewPathPoints],
        widthInches: contourData.widthInches,
        heightInches: contourData.heightInches,
        imageOffsetX: contourData.imageOffsetX,
        imageOffsetY: contourData.imageOffsetY,
        backgroundColor: contourData.backgroundColor,
        effectiveDPI: contourData.effectiveDPI,
        minPathX: contourData.minPathX,
        minPathY: contourData.minPathY,
        bleedInches: contourData.bleedInches,
        contourCanvasWidth: cw,
        contourCanvasHeight: ch,
        imageCanvasX: icx,
        imageCanvasY: icy,
        imageCanvasWidth: icw,
        imageCanvasHeight: ich,
      });
    } else if (shapeSettings.enabled) {
      const shapeData = generateShapePathPointsInches(shapeSettings, resizeSettings);
      setLockedContour({
        label: cutContourLabel,
        pathPoints: shapeData.pathPoints,
        previewPathPoints: shapeData.pathPoints,
        widthInches: shapeData.widthInches,
        heightInches: shapeData.heightInches,
        imageOffsetX: shapeData.imageOffsetX,
        imageOffsetY: shapeData.imageOffsetY,
        backgroundColor: '#ffffff',
        effectiveDPI: 300,
        minPathX: 0,
        minPathY: 0,
        bleedInches: shapeData.bleedInches,
        contourCanvasWidth: 1,
        contourCanvasHeight: 1,
        imageCanvasX: 0,
        imageCanvasY: 0,
        imageCanvasWidth: 1,
        imageCanvasHeight: 1,
      });
    } else {
      console.warn('[AddContour] No contour data available');
      toast({
        title: "No contour available",
        description: "Please wait for the contour to finish generating before adding another.",
        variant: "destructive",
      });
      setShowApplyAddDropdown(false);
      return;
    }

    setCutContourLabel(newLabel);
    setShowApplyAddDropdown(false);
  }, [cutContourLabel, toast, imageInfo, selectedDesign, shapeSettings, resizeSettings]);

  const applyImageDirectly = useCallback((newImageInfo: ImageInfo, widthInches: number, heightInches: number) => {
    saveSnapshot();
    const isFirstDesign = designs.length === 0;
    const offset = designs.length * 0.05;
    const maxSx = artboardWidth / widthInches;
    const maxSy = artboardHeight / heightInches;
    const initialS = Math.min(1, maxSx, maxSy);
    const newTransform = { nx: Math.min(0.5 + offset, 0.85), ny: Math.min(0.5 + offset, 0.85), s: initialS, rotation: 0 };

    if (isFirstDesign) {
      setImageInfo(newImageInfo);

      const SHAPE_CONFIDENCE_THRESHOLD = 0.88;
      const detectionResult = detectShape(newImageInfo.image);
      const detectedShapeType = mapDetectedShapeToType(detectionResult.shape);
      const shouldAutoApplyShape = detectedShapeType !== null && detectionResult.confidence >= SHAPE_CONFIDENCE_THRESHOLD;

      setStrokeSettings({
        width: 0.14,
        color: "#ffffff",
        enabled: !shouldAutoApplyShape,
        alphaThreshold: 128,
        backgroundColor: "#ffffff",
        useCustomBackground: true,
        cornerMode: 'rounded',
        autoBridging: true,
        autoBridgingThreshold: 0.02,
        contourMode: undefined,
      });
      setDetectedAlgorithm(undefined);

      const autoType = detectedShapeType || 'square';
      const isCircularType = autoType === 'circle' || autoType === 'oval';
      const newShapeSettings: ShapeSettings = {
        enabled: shouldAutoApplyShape,
        type: autoType,
        offset: isCircularType ? 0.05 : 0.25,
        fillColor: '#FFFFFF',
        strokeEnabled: false,
        strokeWidth: 2,
        strokeColor: '#000000',
        cornerRadius: 0.25,
      };
      setShapeSettings(newShapeSettings);

      setDetectedShapeType(detectedShapeType);
      setDetectedShapeInfo(detectedShapeType ? {
        type: detectedShapeType,
        boundingBox: detectionResult.boundingBox
      } : null);

      if (shouldAutoApplyShape) {
        setStrokeMode('shape');
      } else {
        setStrokeMode('contour');
      }
      setCadCutBounds(null);
      setLockedContour(null);
      setDesignTransform(newTransform);

      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));

      const maxDim = Math.max(widthInches, heightInches);
      const validSizes: StickerSize[] = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
      const fittingSize = validSizes.find(size => size >= maxDim) || 5.5;
      setStickerSize(fittingSize as StickerSize);

      const shapeDims = calculateShapeDimensions(
        widthInches,
        heightInches,
        newShapeSettings.type,
        newShapeSettings.offset
      );
      updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, newShapeSettings);
    } else {
      setImageInfo(newImageInfo);
      setDesignTransform(newTransform);
      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
    }

    const newDesignId = crypto.randomUUID();
    const newDesignItem: DesignItem = {
      id: newDesignId,
      imageInfo: newImageInfo,
      transform: newTransform,
      widthInches,
      heightInches,
      name: newImageInfo.file.name,
      originalDPI: newImageInfo.dpi,
    };
    setDesigns(prev => [...prev, newDesignItem]);
    setSelectedDesignId(newDesignId);
  }, [updateCadCutBounds, designs.length, saveSnapshot, artboardWidth, artboardHeight]);

  const handleFallbackImage = useCallback((file: File, image: HTMLImageElement) => {
    const dpi = 300;
    
    const croppedCanvas = cropImageToContent(image);

    const processImage = (finalImage: HTMLImageElement) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setIsUploading(false);
      
      const widthInches = parseFloat((finalImage.width / dpi).toFixed(2));
      const heightInches = parseFloat((finalImage.height / dpi).toFixed(2));

      const newImageInfo: ImageInfo = {
        file,
        image: finalImage,
        originalWidth: finalImage.width,
        originalHeight: finalImage.height,
        dpi,
      };

      applyImageDirectly(newImageInfo, widthInches, heightInches);

      const effectiveDPI = Math.min(finalImage.width / widthInches, finalImage.height / heightInches);
      if (effectiveDPI < 278) {
        toast({
          title: "Low Resolution Warning",
          description: `This image is approximately ${Math.round(effectiveDPI)} DPI at the current size. For best print quality, we recommend at least 300 DPI. The image might come out low resolution.`,
          variant: "destructive",
        });
      }
    };

    if (croppedCanvas) {
      const img = new Image();
      img.onload = () => processImage(img);
      img.onerror = () => { setIsUploading(false); processImage(image); };
      img.src = croppedCanvas.toDataURL();
    } else {
      processImage(image);
    }
  }, [applyImageDirectly, toast]);

  const handleImageUpload = useCallback(async (file: File, image: HTMLImageElement) => {
    try {
      if (image.width * image.height > 1000000000) {
        toast({ title: "Image too large", description: "Please upload an image smaller than 1000 megapixels.", variant: "destructive" });
        return;
      }
      
      if (image.width <= 0 || image.height <= 0) {
        toast({ title: "Invalid image", description: "The image has invalid dimensions.", variant: "destructive" });
        return;
      }
      
      setIsUploading(true);
      
      const croppedCanvas = await cropImageToContentAsync(image);
      if (!croppedCanvas) {
        console.error('Failed to crop image, using original');
        handleFallbackImage(file, image);
        return;
      }
      
      const dpi = 300;
      const MAX_STORED_DIMENSION = 4000;

      const processCropped = (croppedImg: HTMLImageElement) => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        let finalWidth = croppedImg.width;
        let finalHeight = croppedImg.height;
        const maxDim = Math.max(croppedImg.width, croppedImg.height);

        const finalize = (img: HTMLImageElement, w: number, h: number) => {
          const newImageInfo: ImageInfo = { file, image: img, originalWidth: w, originalHeight: h, dpi };
          const widthInches = parseFloat((w / dpi).toFixed(2));
          const heightInches = parseFloat((h / dpi).toFixed(2));
          applyImageDirectly(newImageInfo, widthInches, heightInches);
          setIsUploading(false);
          const effectiveDPI = Math.min(w / widthInches, h / heightInches);
          if (effectiveDPI < 278) {
            toast({
              title: "Low Resolution Warning",
              description: `This image is approximately ${Math.round(effectiveDPI)} DPI at the current size. For best print quality, we recommend at least 300 DPI. The image might come out low resolution.`,
              variant: "destructive",
            });
          }
        };

        if (maxDim > MAX_STORED_DIMENSION) {
          const scale = MAX_STORED_DIMENSION / maxDim;
          finalWidth = Math.round(croppedImg.width * scale);
          finalHeight = Math.round(croppedImg.height * scale);
          const downsampleCanvas = document.createElement('canvas');
          downsampleCanvas.width = finalWidth;
          downsampleCanvas.height = finalHeight;
          const dsCtx = downsampleCanvas.getContext('2d')!;
          dsCtx.imageSmoothingEnabled = true;
          dsCtx.imageSmoothingQuality = 'high';
          dsCtx.drawImage(croppedImg, 0, 0, finalWidth, finalHeight);
          const fw = finalWidth, fh = finalHeight;
          downsampleCanvas.toBlob((blob) => {
            if (!blob) { finalize(croppedImg, fw, fh); return; }
            const url = URL.createObjectURL(blob);
            const dsImg = new Image();
            dsImg.onload = () => { URL.revokeObjectURL(url); finalize(dsImg, fw, fh); };
            dsImg.onerror = () => { URL.revokeObjectURL(url); finalize(croppedImg, fw, fh); };
            dsImg.src = url;
          }, 'image/png');
        } else {
          finalize(croppedImg, finalWidth, finalHeight);
        }
      };

      croppedCanvas.toBlob((blob) => {
        if (!blob) { handleFallbackImage(file, image); return; }
        const url = URL.createObjectURL(blob);
        const croppedImage = new Image();
        croppedImage.onerror = () => {
          URL.revokeObjectURL(url);
          handleFallbackImage(file, image);
        };
        croppedImage.onload = () => { URL.revokeObjectURL(url); processCropped(croppedImage); };
        croppedImage.src = url;
      }, 'image/png');
    } catch (error) {
      console.error('Error processing uploaded image:', error);
      setIsUploading(false);
      handleFallbackImage(file, image);
    }
  }, [applyImageDirectly, toast, handleFallbackImage]);

  const handlePDFUpload = useCallback((file: File, pdfData: ParsedPDFData) => {
    // Close any open dropdowns
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    const { image, cutContourInfo, originalPdfData, dpi } = pdfData;
    
    // Create image info with PDF-specific data
    const newImageInfo: ImageInfo = {
      file,
      image,
      originalWidth: image.width,
      originalHeight: image.height,
      dpi,
      isPDF: true,
      pdfCutContourInfo: cutContourInfo,
      originalPdfData,
    };
    
    setImageInfo(newImageInfo);
    
    setStrokeSettings({
      width: 0.14,
      color: "#ffffff",
      enabled: false,
      alphaThreshold: 128,
      backgroundColor: "#ffffff",
      useCustomBackground: true,
      cornerMode: 'rounded',
      autoBridging: true,
      autoBridgingThreshold: 0.02,
      contourMode: undefined,
    });
    setDetectedAlgorithm(undefined);
    setShapeSettings({
      enabled: false,
      type: 'square',
      offset: 0.25,
      fillColor: '#FFFFFF',
      strokeEnabled: false,
      strokeWidth: 2,
      strokeColor: '#000000',
      cornerRadius: 0.25,
    });
    
    setStrokeMode('none');
    
    setCadCutBounds(null);
    setStickerSize(4);
    
    // Calculate dimensions
    let { widthInches, heightInches } = calculateImageDimensions(image.width, image.height, dpi);
    const maxDimension = Math.max(widthInches, heightInches);
    if (maxDimension > 4) {
      const scale = 4 / maxDimension;
      widthInches = parseFloat((widthInches * scale).toFixed(2));
      heightInches = parseFloat((heightInches * scale).toFixed(2));
    }
    
    setResizeSettings(prev => ({
      ...prev,
      widthInches,
      heightInches,
    }));

    const newTransform = { nx: 0.5, ny: 0.5, s: 1, rotation: 0 };
    setDesignTransform(newTransform);
    setLockedContour(null);

    const newDesignId = crypto.randomUUID();
    const newDesignItem: DesignItem = {
      id: newDesignId,
      imageInfo: newImageInfo,
      transform: newTransform,
      widthInches,
      heightInches,
      name: file.name,
      originalDPI: dpi,
    };
    saveSnapshot();
    setDesigns(prev => [...prev, newDesignItem]);
    setSelectedDesignId(newDesignId);
  }, [saveSnapshot]);

  const handleFileUploadUnified = useCallback(async (file: File, image: HTMLImageElement | null) => {
    const ext = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || ext.endsWith('.pdf');
    if (isPdf) {
      try {
        setIsUploading(true);
        const pdfData = await parsePDF(file);
        handlePDFUpload(file, pdfData);
      } catch (err) {
        console.error('PDF parse error:', err);
        toast({ title: "Failed to parse PDF", description: "The file could not be read. Please try a different PDF.", variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
      return;
    }
    if (image) handleImageUpload(file, image);
  }, [handleImageUpload, handlePDFUpload, toast]);

  const handleSidebarFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || ext.endsWith('.pdf');
    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || ['.png', '.jpg', '.jpeg', '.webp'].some(x => ext.endsWith(x));
    if (!isImage && !isPdf) {
      toast({ title: "Unsupported format", description: "PNG, JPEG, WebP, or PDF only.", variant: "destructive" });
      return;
    }
    if (isPdf) {
      try {
        setIsUploading(true);
        const pdfData = await parsePDF(file);
        handlePDFUpload(file, pdfData);
      } catch (err) {
        console.error('PDF parse error:', err);
        toast({ title: "Failed to parse PDF", description: "Could not read this file.", variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const isPng = file.type === 'image/png' || ext.endsWith('.png');
      if (!isPng) {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) { handleImageUpload(file, img); return; }
        ctx.drawImage(img, 0, 0);
        c.toBlob(blob => {
          if (!blob) { handleImageUpload(file, img); return; }
          const pf = new File([blob], file.name.replace(/\.\w+$/, '.png'), { type: 'image/png' });
          const pi = new Image();
          const u2 = URL.createObjectURL(blob);
          pi.onload = () => { URL.revokeObjectURL(u2); handleImageUpload(pf, pi); };
          pi.onerror = () => { URL.revokeObjectURL(u2); handleImageUpload(file, img); };
          pi.src = u2;
        }, 'image/png');
      } else {
        handleImageUpload(file, img);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [handleImageUpload, handlePDFUpload, toast]);

  const handleResizeChange = useCallback((newSettings: Partial<ResizeSettings>) => {
    setResizeSettings(prev => {
      const updated = { ...prev, ...newSettings };
      const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
      
      if (updated.maintainAspectRatio && currentImageInfo && newSettings.widthInches !== undefined) {
        const aspectRatio = currentImageInfo.originalHeight / currentImageInfo.originalWidth;
        updated.heightInches = parseFloat((newSettings.widthInches * aspectRatio).toFixed(1));
      } else if (updated.maintainAspectRatio && currentImageInfo && newSettings.heightInches !== undefined) {
        const aspectRatio = currentImageInfo.originalWidth / currentImageInfo.originalHeight;
        updated.widthInches = parseFloat((newSettings.heightInches * aspectRatio).toFixed(1));
      }
      
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          updated.widthInches,
          updated.heightInches,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }

      if (selectedDesignId) {
        setDesigns(prevDesigns => prevDesigns.map(d => d.id === selectedDesignId ? { ...d, widthInches: updated.widthInches, heightInches: updated.heightInches } : d));
      }
      
      return updated;
    });
  }, [imageInfo, selectedDesign, selectedDesignId, shapeSettings, updateCadCutBounds]);

  const handleStickerSizeChange = useCallback((newSize: StickerSize) => {
    setStickerSize(newSize);
    
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (currentImageInfo) {
      const aspectRatio = currentImageInfo.originalWidth / currentImageInfo.originalHeight;
      let newWidth: number;
      let newHeight: number;
      
      if (aspectRatio >= 1) {
        // Wider than tall - width is the constraining dimension
        newWidth = newSize;
        newHeight = parseFloat((newSize / aspectRatio).toFixed(2));
      } else {
        // Taller than wide - height is the constraining dimension
        newHeight = newSize;
        newWidth = parseFloat((newSize * aspectRatio).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches: newWidth,
        heightInches: newHeight,
      }));
      
      if (selectedDesignId) {
        setDesigns(prevDesigns => prevDesigns.map(d => d.id === selectedDesignId ? { ...d, widthInches: newWidth, heightInches: newHeight } : d));
      }
      
      if (shapeSettings.enabled) {
        const shapeDims = calculateShapeDimensions(
          newWidth,
          newHeight,
          shapeSettings.type,
          shapeSettings.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, shapeSettings);
      }
    }
  }, [imageInfo, selectedDesign, selectedDesignId, shapeSettings, updateCadCutBounds]);

  const handleRemoveBackground = useCallback(async (threshold: number) => {
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (!currentImageInfo) return;
    
    setIsRemovingBackground(true);
    try {
      const bgRemovedImage = await removeBackgroundFromImage(currentImageInfo.image, threshold);
      
      const croppedCanvas = await cropImageToContentAsync(bgRemovedImage);
      if (!croppedCanvas) {
        console.error('Failed to crop image after background removal');
        setIsRemovingBackground(false);
        return;
      }
      
      const finalImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        croppedCanvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
          img.src = url;
        }, 'image/png');
      });
      
      const newWidth = finalImage.naturalWidth || finalImage.width;
      const newHeight = finalImage.naturalHeight || finalImage.height;
      
      const newImageInfo: ImageInfo = {
        ...currentImageInfo,
        image: finalImage,
        originalWidth: newWidth,
        originalHeight: newHeight,
      };
      
      const dpi = currentImageInfo.dpi || 300;
      let { widthInches, heightInches } = calculateImageDimensions(newWidth, newHeight, dpi);
      
      const maxDimension = Math.max(widthInches, heightInches);
      if (maxDimension > stickerSize) {
        const scale = stickerSize / maxDimension;
        widthInches = parseFloat((widthInches * scale).toFixed(2));
        heightInches = parseFloat((heightInches * scale).toFixed(2));
      }
      
      setResizeSettings(prev => ({
        ...prev,
        widthInches,
        heightInches,
      }));
      
      const workerManager = getContourWorkerManager();
      workerManager.clearCache();
      setCadCutBounds(null);
      
      console.log(`[BackgroundRemoval] Complete! Original: ${currentImageInfo.originalWidth}x${currentImageInfo.originalHeight}, New: ${newWidth}x${newHeight}`);
      
      setImageInfo(newImageInfo);
      
      if (selectedDesignId) {
        setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, imageInfo: newImageInfo, widthInches, heightInches } : d));
      }
      
      toast({
        title: "Background Removed",
        description: "White background removed from edges. Select Contour to see the new outline.",
      });
    } catch (error) {
      console.error('Error removing background:', error);
      toast({
        title: "Error",
        description: "Failed to remove background. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRemovingBackground(false);
    }
  }, [imageInfo, selectedDesign, selectedDesignId, stickerSize, toast]);

  const handleThresholdAlpha = useCallback(() => {
    const currentImageInfo = selectedDesign?.imageInfo || imageInfo;
    if (!currentImageInfo) return;
    const src = currentImageInfo.image;
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(src, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = data[i] >= 128 ? 255 : 0;
    }
    ctx.putImageData(imgData, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const newInfo: ImageInfo = { ...currentImageInfo, image: img };
        saveSnapshot();
        setImageInfo(newInfo);
        if (selectedDesignId) {
          setDesigns(prev => prev.map(d => d.id === selectedDesignId ? { ...d, imageInfo: newInfo } : d));
        }
        toast({ title: "Alpha threshold applied", description: "Semi-transparent pixels removed." });
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }, 'image/png');
  }, [imageInfo, selectedDesign, selectedDesignId, saveSnapshot, toast]);

  const handleStrokeChange = useCallback((newSettings: Partial<StrokeSettings>) => {
    if (newSettings.enabled === true) {
      setShapeSettings(prev => ({ ...prev, enabled: false }));
    }
    setStrokeSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const handleShapeChange = useCallback((newSettings: Partial<ShapeSettings>) => {
    if (newSettings.enabled === true) {
      setStrokeSettings(prev => ({ ...prev, enabled: false }));
    }
    setShapeSettings(prev => {
      let updated = { ...prev, ...newSettings };
      if (newSettings.type !== undefined && newSettings.type !== prev.type) {
        const wasCircular = prev.type === 'circle' || prev.type === 'oval';
        const isCircular = newSettings.type === 'circle' || newSettings.type === 'oval';
        if (wasCircular !== isCircular) {
          updated.offset = isCircular ? 0.05 : 0.125;
        }
      }
      if (updated.enabled && imageInfo) {
        const shapeDims = calculateShapeDimensions(
          resizeSettings.widthInches,
          resizeSettings.heightInches,
          updated.type,
          updated.offset
        );
        updateCadCutBounds(shapeDims.widthInches, shapeDims.heightInches, updated);
      }
      return updated;
    });
  }, [imageInfo, resizeSettings, updateCadCutBounds]);



  const handleDownload = useCallback(async (downloadType: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package' = 'standard', format: string = 'pdf', spotColorsByDesign?: Record<string, SpotColorInput[]>) => {
    if (designs.length === 0) {
      toast({ title: "No designs on artboard", description: "Upload an image first.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);

    try {
      const firstName = (designs[0]?.name || imageInfo?.file.name || 'gangsheet').replace(/\.[^/.]+$/, '');
      const filename = `${firstName}.pdf`;
      const pdfLib = await import('pdf-lib');
      const { PDFDocument } = pdfLib;
      const degrees = pdfLib.degrees;

      await new Promise(r => setTimeout(r, 50));

      const pdfDoc = await PDFDocument.create();
      const widthPts = artboardWidth * 72;
      const heightPts = artboardHeight * 72;
      const page = pdfDoc.addPage([widthPts, heightPts]);

      const MAX = 4000;
      for (const design of designs) {
        const img = design.imageInfo.image;
        const dw = design.widthInches * design.transform.s;
        const dh = design.heightInches * design.transform.s;
        const cx = design.transform.nx * artboardWidth;
        const cy = design.transform.ny * artboardHeight;

        let cw = img.width, ch = img.height;
        if (Math.max(cw, ch) > MAX) {
          const sc = MAX / Math.max(cw, ch);
          cw = Math.round(cw * sc); ch = Math.round(ch * sc);
        }
        const tc = document.createElement('canvas');
        tc.width = cw; tc.height = ch;
        const tctx = tc.getContext('2d')!;
        tctx.drawImage(img, 0, 0, cw, ch);
        const blob: Blob = await new Promise((res, rej) =>
          tc.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
        const pngBytes = new Uint8Array(await blob.arrayBuffer());
        const pngImage = await pdfDoc.embedPng(pngBytes);

        const wPts = dw * 72;
        const hPts = dh * 72;
        const cxPts = cx * 72;
        const cyPts = (artboardHeight - cy) * 72;

        if (design.transform.rotation) {
          // pdf-lib rotates around the draw origin (bottom-left of image).
          // To rotate around center, solve for draw-origin so that after
          // rotation the image center lands at (cxPts, cyPts).
          const rad = (-design.transform.rotation * Math.PI) / 180;
          const cosR = Math.cos(rad);
          const sinR = Math.sin(rad);
          const drawX = cxPts - (wPts / 2) * cosR + (hPts / 2) * sinR;
          const drawY = cyPts - (wPts / 2) * sinR - (hPts / 2) * cosR;
          page.drawImage(pngImage, {
            x: drawX, y: drawY, width: wPts, height: hPts,
            rotate: degrees(-design.transform.rotation),
          });
        } else {
          page.drawImage(pngImage, {
            x: cxPts - wPts / 2, y: cyPts - hPts / 2,
            width: wPts, height: hPts,
          });
        }
      }

      if (spotColorsByDesign && Object.keys(spotColorsByDesign).length > 0) {
        try {
          const { addSpotColorVectorsToPDF } = await import('@/lib/spot-color-vectors');
          for (const design of designs) {
            const designSpotColors = spotColorsByDesign[design.id];
            if (!designSpotColors || designSpotColors.length === 0) continue;
            const hasFluor = designSpotColors.some(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange);
            const hasWhiteGloss = designSpotColors.some(c => c.spotWhite || c.spotGloss);
            if (!hasFluor && !hasWhiteGloss) continue;

            const img = design.imageInfo.image;
            const dw = design.widthInches * design.transform.s;
            const dh = design.heightInches * design.transform.s;
            const cx = design.transform.nx * artboardWidth;
            const cy = design.transform.ny * artboardHeight;
            const offX = cx - dw / 2;
            const offY = cy - dh / 2;

            await addSpotColorVectorsToPDF(
              pdfDoc, page, img, designSpotColors,
              dw, dh, artboardHeight, offX, offY,
              design.transform.rotation || 0,
            );
          }
        } catch (spotErr) {
          console.warn('Spot color layers skipped:', spotErr);
        }
      }

      pdfDoc.setTitle('Gangsheet PDF');
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      console.error("Download failed:", error);
      toast({ title: "Download failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [imageInfo, designs, artboardWidth, artboardHeight, toast]);

  if (!activeImageInfo) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="w-full max-w-xl mx-auto transition-all duration-300 px-4">
          <UploadSection 
            onImageUpload={handleFileUploadUnified}
            showCutLineInfo={false}
            imageInfo={null}
            resizeSettings={resizeSettings}
            stickerSize={stickerSize}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      {/* Left sidebar - Layers + Settings */}
      <div className="flex-shrink-0 w-full lg:w-[320px] xl:w-[340px] border-r border-gray-800 bg-gray-950 overflow-y-auto overflow-x-hidden">
        <div className="p-2.5 space-y-2">
          {/* Layers Panel */}
          {designs.length > 0 && (
            <div ref={designInfoRef} className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
              <div className="flex items-center px-3 py-1.5">
                <button
                  onClick={() => setShowDesignInfo(!showDesignInfo)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-medium text-xs">Layers</span>
                  <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full">{designs.length}</span>
                  {showDesignInfo ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
                </button>
                <button
                  onClick={() => sidebarFileRef.current?.click()}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 text-[11px] font-medium transition-colors"
                  title="Add another image"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </button>
                <input
                  ref={sidebarFileRef}
                  type="file"
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                  onChange={handleSidebarFileChange}
                />
              </div>
              {showDesignInfo && (
                <div className="border-t border-gray-800 max-h-[180px] overflow-y-auto">
                  {designs.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors ${d.id === selectedDesignId ? 'bg-cyan-500/10 border-l-2 border-cyan-400' : 'hover:bg-gray-800/70 border-l-2 border-transparent'}`}
                      onClick={() => handleSelectDesign(d.id)}
                    >
                      <div className="w-7 h-7 rounded bg-gray-800 border border-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        <img
                          src={getLayerThumbnail(d)}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                          loading="lazy"
                          style={{ transform: `${d.transform.flipX ? 'scaleX(-1)' : ''} ${d.transform.flipY ? 'scaleY(-1)' : ''}` }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-gray-200 truncate">{d.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {(d.widthInches * d.transform.s).toFixed(1)}" × {(d.heightInches * d.transform.s).toFixed(1)}"
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDesign(d.id); }}
                        className="p-0.5 rounded hover:bg-gray-700 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <ControlsSection
            strokeSettings={strokeSettings}
            resizeSettings={activeResizeSettings}
            shapeSettings={shapeSettings}
            stickerSize={stickerSize}
            onStrokeChange={handleStrokeChange}
            onResizeChange={handleResizeChange}
            onShapeChange={handleShapeChange}
            onStickerSizeChange={handleStickerSizeChange}
            onDownload={handleDownload}
            isProcessing={isProcessing}
            imageInfo={activeImageInfo}
            canvasRef={canvasRef}
            onStepChange={() => {}}
            onSpotPreviewChange={setSpotPreviewData}
            artboardWidth={artboardWidth}
            artboardHeight={artboardHeight}
            onArtboardHeightChange={(h) => handleArtboardResize(artboardWidth, h)}
            fluorPanelContainer={fluorPanelContainer}
            downloadContainer={downloadContainer}
            designCount={designs.length}
            selectedDesignId={selectedDesignId}
            copySpotSelectionsRef={copySpotSelectionsRef}
          />

          {/* Fluorescent panel portal target - in left sidebar */}
          <div ref={setFluorPanelContainer} />
        </div>
      </div>

      {/* Right area - Canvas workspace */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Top bar: Add Design, Image Info, Auto-Arrange */}
        <div className="flex-shrink-0 flex items-center gap-2 bg-gray-900 border-b border-gray-800 px-3 py-1.5">
          <UploadSection 
            onImageUpload={handleFileUploadUnified}
            showCutLineInfo={false}
            imageInfo={activeImageInfo}
            resizeSettings={activeResizeSettings}
            stickerSize={stickerSize}
          />
          {isUploading && (
            <div className="flex items-center gap-1.5 text-cyan-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[11px]">Processing...</span>
            </div>
          )}
          {activeImageInfo && (
            <>
              <div className="w-px h-5 bg-gray-700 flex-shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-shrink-0">
                {activeImageInfo?.file?.name && (
                  <p className="text-[11px] text-gray-400 truncate max-w-[100px] hidden sm:block" title={activeImageInfo.file.name}>
                    {activeImageInfo.file.name}
                  </p>
                )}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <span className="text-[10px] text-gray-500">W</span>
                  <SizeInput
                    value={activeResizeSettings.widthInches * activeDesignTransform.s}
                    onCommit={(v) => handleEffectiveSizeChange('width', v)}
                    title="Width (inches)"
                  />
                  <span className="text-[10px] text-gray-500">"</span>
                  <button
                    onClick={() => setProportionalLock(prev => !prev)}
                    className={`p-0.5 rounded transition-colors ${proportionalLock ? 'text-cyan-400 hover:text-cyan-300' : 'text-gray-600 hover:text-gray-400'}`}
                    title={proportionalLock ? 'Proportions locked – click to unlock' : 'Proportions unlocked – click to lock'}
                  >
                    {proportionalLock ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                  </button>
                  <span className="text-[10px] text-gray-500">H</span>
                  <SizeInput
                    value={activeResizeSettings.heightInches * activeDesignTransform.s}
                    onCommit={(v) => handleEffectiveSizeChange('height', v)}
                    title="Height (inches)"
                  />
                  <span className="text-[10px] text-gray-500">"</span>
                </div>
                <span className="text-[9px] text-gray-400 bg-gray-800 px-1 py-0.5 rounded flex-shrink-0">{activeResizeSettings.outputDPI} DPI</span>
              </div>
            </>
          )}
          {designs.length >= 2 && (
            <>
              <div className="w-px h-5 bg-gray-700" />
              <button
                onClick={handleAutoArrange}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-cyan-500/50 text-gray-400 hover:text-cyan-400 text-[11px] font-medium transition-colors whitespace-nowrap"
                title="Auto-arrange all designs on gangsheet"
              >
                <LayoutGrid className="w-3 h-3" />
                Auto-Arrange
              </button>
            </>
          )}
          {/* Action buttons */}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={handleUndo}
              disabled={!canUndo()}
              className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo()}
              className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            {selectedDesignId && (
              <>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button
                  onClick={handleRotate90}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Rotate 90° (Shift+R)"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleAlignCorner('tl')}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Align Top Left"
                >
                  <ArrowUpLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleAlignCorner('tr')}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Align Top Right"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleAlignCorner('bl')}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Align Bottom Left"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleAlignCorner('br')}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Align Bottom Right"
                >
                  <ArrowDownRight className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button
                  onClick={handleDuplicateDesign}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Duplicate (Ctrl+D)"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteDesign(selectedDesignId)}
                  className="p-1.5 rounded-md hover:bg-gray-700/80 text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete (Del)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button
                  onClick={handleThresholdAlpha}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 text-white shadow-sm shadow-green-500/20 hover:shadow-green-400/30 transition-all whitespace-nowrap"
                  title="Remove Semi Transparencies (best for Sharp edges)"
                >
                  <Droplets className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">Clean Alpha</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Preview Canvas */}
        <div className="flex-1 min-h-0 relative">
          <PreviewSection
            ref={canvasRef}
            imageInfo={activeImageInfo}
            strokeSettings={debouncedStrokeSettings}
            resizeSettings={activeResizeSettings}
            shapeSettings={debouncedShapeSettings}
            cadCutBounds={cadCutBounds}
            spotPreviewData={spotPreviewData}
            showCutLineInfo={false}
            detectedShapeType={detectedShapeType}
            detectedShapeInfo={detectedShapeInfo}
            onStrokeChange={handleStrokeChange}
            lockedContour={lockedContour}
            artboardWidth={artboardWidth}
            artboardHeight={artboardHeight}
            designTransform={activeDesignTransform}
            onTransformChange={handleDesignTransformChange}
            designs={designs}
            selectedDesignId={selectedDesignId}
            selectedDesignIds={selectedDesignIds}
            onSelectDesign={handleSelectDesign}
            onMultiSelect={handleMultiSelect}
            onMultiDragDelta={handleMultiDragDelta}
            onDuplicateSelected={handleDuplicateSelected}
            onInteractionEnd={handleInteractionEnd}
            onExpandArtboard={handleExpandArtboard}
          />
        </div>
      </div>
      
      </div>
      {/* Download bar at the very bottom of the app */}
      <div ref={setDownloadContainer} className="flex-shrink-0" />

      {/* Processing Modal */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-sm mx-4">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-cyan-500 border-t-transparent"></div>
              <span className="text-white">Processing...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
