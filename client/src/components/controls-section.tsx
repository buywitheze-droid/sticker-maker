import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizeSettings, ImageInfo } from "./image-editor";
import { Download, Layers, FileCheck, Palette, Eye, EyeOff, ChevronDown, ChevronUp, Info } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { formatLength } from "@/lib/format-length";
import { useIsMobile } from "@/hooks/use-mobile";

export interface SpotPreviewData {
  enabled: boolean;
  colors: ExtractedColor[];
  /** Per-channel pixel masks from region-level spot assignments (512 px space). */
  masks?: {
    FY: Uint8Array;
    FM: Uint8Array;
    FG: Uint8Array;
    FO: Uint8Array;
    width: number;
    height: number;
  };
}

type ColorRegion = {
  id: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  pixelCount: number;
  percentage: number;
  pixelIndices: number[];
  thumbnailUrl?: string;
  spotFluorY?: boolean;
  spotFluorM?: boolean;
  spotFluorG?: boolean;
  spotFluorOrange?: boolean;
};

type ExtractedColor = {
  hex: string;
  name?: string;
  rgb: { r: number; g: number; b: number };
  /** Present on colors returned by the extractor; optional here for safety. */
  count?: number;
  percentage: number;
  spotWhite?: boolean;
  spotGloss?: boolean;
  spotFluorY?: boolean;
  spotFluorM?: boolean;
  spotFluorG?: boolean;
  spotFluorOrange?: boolean;
  regions?: ColorRegion[];
  regionMap?: Int32Array;
};

interface ControlsSectionProps {
  resizeSettings: ResizeSettings;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onDownload: (downloadType?: string, format?: string, spotColorsByDesign?: Record<string, any[]>) => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
  artboardWidth?: number;
  artboardHeight?: number;
  onArtboardWidthChange?: (width: number) => void;
  onArtboardHeightChange?: (height: number) => void;
  downloadContainer?: HTMLDivElement | null;
  designCount?: number;
  gangsheetHeights?: number[];
  recommendedArtboardHeight?: number | null;
  downloadFormat?: 'png' | 'pdf';
  enableFluorescent?: boolean;
  selectedDesignId?: string | null;
  onSpotPreviewChange?: (data: SpotPreviewData) => void;
  fluorPanelContainer?: HTMLDivElement | null;
  copySpotSelectionsRef?: React.MutableRefObject<((fromId: string, toIds: string[]) => void) | null>;
  /** Lifted: called whenever the active spot channel changes (or is cleared). */
  onActiveChannelChange?: (channel: string | null) => void;
  /** Ref populated by ControlsSection so the parent can forward normalized preview clicks. */
  wandAssignRef?: React.MutableRefObject<((nx: number, ny: number) => void) | null>;
  /** When true, the preview is in hand/pan mode so the user can drag while zoomed in. */
  panModeActive?: boolean;
  onPanModeChange?: (active: boolean) => void;
}

const DEFAULT_HEIGHTS = [12, 18, 24, 35, 40, 45, 48, 50, 55, 60, 65, 70, 80, 85, 95, 110, 120, 130, 140, 150];

export default function ControlsSection({
  onDownload,
  isProcessing,
  imageInfo,
  artboardWidth = 24.5,
  artboardHeight = 12,
  onArtboardWidthChange,
  onArtboardHeightChange,
  downloadContainer,
  designCount = 0,
  gangsheetHeights = DEFAULT_HEIGHTS,
  recommendedArtboardHeight,
  downloadFormat = 'png',
  enableFluorescent = false,
  selectedDesignId,
  onSpotPreviewChange,
  fluorPanelContainer,
  copySpotSelectionsRef,
  onActiveChannelChange,
  wandAssignRef,
  panModeActive = false,
  onPanModeChange,
}: ControlsSectionProps) {
  const { t, lang } = useLanguage();
  const isMobile = useIsMobile();
  const canDownload = !!imageInfo || designCount > 0;

  const [widthInputValue, setWidthInputValue] = useState(String(artboardWidth));
  const [editingWidth, setEditingWidth] = useState(false);

  useEffect(() => {
    if (!editingWidth) setWidthInputValue(String(artboardWidth));
  }, [artboardWidth, editingWidth]);

  const [showSpotColors, setShowSpotColors] = useState(false);
  const [showFluorInfo, setShowFluorInfo] = useState(false);
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
  const [spotPreviewEnabled, setSpotPreviewEnabled] = useState(true);
  const spotFluorYName = "FY";
  const spotFluorMName = "FM";
  const spotFluorGName = "FG";
  const spotFluorOrangeName = "FO";
  const colorCacheRef = useRef<Map<string, ExtractedColor[]>>(new Map());
  const spotSelectionsRef = useRef<Map<string, ExtractedColor[]>>(new Map());
  const prevDesignIdRef = useRef<string | null | undefined>(null);
  const [expandedColorIndex, setExpandedColorIndex] = useState<number | null>(null);
  const [activeChannel, setActiveChannel] = useState<'spotFluorY' | 'spotFluorM' | 'spotFluorG' | 'spotFluorOrange' | null>(null);
  const colorListRef = useRef<HTMLDivElement>(null);
  /** Most-recent pixelMap for the current image (pixel → colorIndex at ≤512 px). */
  const pixelMapRef = useRef<{ pixelMap: Int16Array; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!enableFluorescent) return;

    let cancelled = false;

    // Reset immediately so the previous design's pixelMap is never used to build
    // masks for the incoming design.  computeChannelMasks will return undefined
    // (no overlay) until runRegionDetection (or the rebuild below) repopulates it.
    pixelMapRef.current = null;

    if (prevDesignIdRef.current && extractedColors.length > 0) {
      spotSelectionsRef.current.set(prevDesignIdRef.current, extractedColors);
    }
    prevDesignIdRef.current = selectedDesignId;

    if (imageInfo?.image) {
      if (selectedDesignId && spotSelectionsRef.current.has(selectedDesignId)) {
        const savedColors = spotSelectionsRef.current.get(selectedDesignId)!;
        setExtractedColors(savedColors);
        // Rebuild pixelMap for this design so channel masks use its own pixel
        // dimensions — not those of the previously-viewed design.
        import("@/lib/color-extractor").then(({ buildPixelMapFromImage }) => {
          if (cancelled) return;
          const mapResult = buildPixelMapFromImage(imageInfo.image, savedColors as any);
          if (!mapResult || cancelled) return;
          pixelMapRef.current = mapResult;
          // Trigger the mask-building effect with the fresh pixelMap.
          if (!cancelled) setExtractedColors(prev => [...prev]);
        }).catch(() => { /* non-critical */ });
      } else {
        const cacheKey = `${imageInfo.image.width}x${imageInfo.image.height}-${imageInfo.file?.name ?? 'unknown'}-${imageInfo.file?.size ?? 0}`;
        const cached = colorCacheRef.current.get(cacheKey);
        // Always import the module — needed for region detection on both cache-hit
        // and fresh-extract paths.
        import("@/lib/color-extractor").then(({ extractColorsFromImageAsync, extractColorsFromImage, buildPixelMapFromImage, detectColorRegionsAsync }) => {
          if (cancelled) return;
          const img = imageInfo.image;

          // Helper: detect regions on a local (mutable) copy of colors, then update state.
          // Cast needed because the local ExtractedColor type has optional spot flags
          // while the exported type has them required; structurally compatible at runtime.
          const runRegionDetection = async (localColors: ExtractedColor[]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mapResult = buildPixelMapFromImage(img, localColors as any);
            if (!mapResult || cancelled) return;
            pixelMapRef.current = mapResult; // store for channel-mask computation
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await detectColorRegionsAsync(mapResult.pixelMap, mapResult.width, mapResult.height, localColors as any, mapResult.imageData);
            if (!cancelled) setExtractedColors([...localColors]);
          };

          // Helper: write to cache, stripping large typed arrays so cache stays lean.
          const writeCache = (cs: ExtractedColor[]) => {
            const slim = cs.map(c => ({ ...c, regions: undefined, regionMap: undefined }));
            colorCacheRef.current.set(cacheKey, slim);
            if (colorCacheRef.current.size > 20) {
              const firstKey = colorCacheRef.current.keys().next().value;
              if (firstKey) colorCacheRef.current.delete(firstKey);
            }
          };

          if (cached) {
            // Show cached colors immediately (no regions yet), then detect async.
            const localColors = cached.map(c => ({ ...c }));
            setExtractedColors(localColors);
            runRegionDetection(localColors);
            return;
          }

          // Fresh extraction
          extractColorsFromImageAsync(img, 999).then(async colors => {
            if (cancelled) return;
            if (colors.length === 0) {
              try {
                const fallback = extractColorsFromImage(img, 999);
                if (fallback.length > 0) {
                  writeCache(fallback);
                  setExtractedColors(fallback);
                  await runRegionDetection(fallback);
                  return;
                }
              } catch { /* sync fallback failed */ }
            }
            // Cache base colors (no regions) before async detection so cache is
            // always populated even if detection is cancelled mid-way.
            writeCache(colors);
            setExtractedColors(colors);
            await runRegionDetection(colors);
          }).catch(() => {
            if (cancelled) return;
            try {
              const fallback = extractColorsFromImage(img, 999);
              writeCache(fallback);
              setExtractedColors(fallback);
            } catch {
              setExtractedColors([]);
            }
          });
        }).catch((err) => {
          if (cancelled) return;
          console.warn('[Fluorescent] color-extractor import failed:', err);
        });
      }
    } else {
      setExtractedColors([]);
    }

    return () => { cancelled = true; };
  }, [imageInfo, selectedDesignId, enableFluorescent]);

  useEffect(() => {
    if (!enableFluorescent || !copySpotSelectionsRef) return;
    copySpotSelectionsRef.current = (fromId: string, toIds: string[]) => {
      if (selectedDesignId && extractedColors.length > 0) {
        spotSelectionsRef.current.set(selectedDesignId, extractedColors);
      }
      const source = spotSelectionsRef.current.get(fromId);
      if (!source) return;
      for (const toId of toIds) {
        spotSelectionsRef.current.set(toId, source.map(c => ({ ...c })));
      }
    };
    return () => { if (copySpotSelectionsRef) copySpotSelectionsRef.current = null; };
  }, [copySpotSelectionsRef, selectedDesignId, extractedColors, enableFluorescent]);

  /** Compute per-channel pixel masks from pixelMap + region assignments.
   *  Returns undefined when no multi-region spot assignments exist. */
  const computeChannelMasks = useCallback((
    colors: ExtractedColor[],
    mapResult: { pixelMap: Int16Array; width: number; height: number }
  ) => {
    // Build masks for ANY fluorescent assignment — color-level OR region-level.
    // Returning undefined here falls back to imprecise hex matching; always use
    // the pixel map when we have it so the preview is pixel-accurate.
    const hasAnyFluorAssignment = colors.some(c =>
      c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange ||
      (c.regions?.some(r => r.spotFluorY || r.spotFluorM || r.spotFluorG || r.spotFluorOrange) ?? false)
    );
    if (!hasAnyFluorAssignment) return undefined;

    const { pixelMap, width, height } = mapResult;
    const n = width * height;
    const mFY = new Uint8Array(n), mFM = new Uint8Array(n);
    const mFG = new Uint8Array(n), mFO = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const ci = pixelMap[i];
      if (ci < 0) continue;
      const color = colors[ci];
      if (!color) continue;

      if (!color.regions || !color.regionMap || color.regions.length <= 1) {
        if (color.spotFluorY) mFY[i] = 1;
        if (color.spotFluorM) mFM[i] = 1;
        if (color.spotFluorG) mFG[i] = 1;
        if (color.spotFluorOrange) mFO[i] = 1;
      } else {
        const ri = color.regionMap[i];
        if (ri < 0) continue;
        const region = color.regions[ri];
        if (!region) continue;
        if (region.spotFluorY) mFY[i] = 1;
        if (region.spotFluorM) mFM[i] = 1;
        if (region.spotFluorG) mFG[i] = 1;
        if (region.spotFluorOrange) mFO[i] = 1;
      }
    }

    return { FY: mFY, FM: mFM, FG: mFG, FO: mFO, width, height };
  }, []);

  useEffect(() => {
    if (!enableFluorescent) return;
    const masks = pixelMapRef.current
      ? computeChannelMasks(extractedColors, pixelMapRef.current)
      : undefined;
    onSpotPreviewChange?.({ enabled: spotPreviewEnabled, colors: extractedColors, masks });
  }, [spotPreviewEnabled, extractedColors, onSpotPreviewChange, enableFluorescent, computeChannelMasks]);

  const updateSpotColor = useCallback((index: number, field: 'spotFluorY' | 'spotFluorM' | 'spotFluorG' | 'spotFluorOrange', value: boolean) => {
    setExtractedColors(prev => {
      const updated = prev.map((color, i) => {
        if (i === index) {
          // propagate assignment to all regions too
          // Formula: if this IS the target field → use new value; otherwise if
          // turning ON → clear competing field; if turning OFF → preserve sibling.
          const updatedRegions = color.regions?.map(r => ({
            ...r,
            spotFluorY:       field === 'spotFluorY'       ? value : (value ? false : r.spotFluorY),
            spotFluorM:       field === 'spotFluorM'       ? value : (value ? false : r.spotFluorM),
            spotFluorG:       field === 'spotFluorG'       ? value : (value ? false : r.spotFluorG),
            spotFluorOrange:  field === 'spotFluorOrange'  ? value : (value ? false : r.spotFluorOrange),
          }));
          if (value) {
            return { ...color, spotFluorY: false, spotFluorM: false, spotFluorG: false, spotFluorOrange: false, [field]: true, regions: updatedRegions };
          }
          return { ...color, [field]: value, regions: updatedRegions };
        }
        return color;
      });
      if (selectedDesignId) spotSelectionsRef.current.set(selectedDesignId, updated);
      return updated;
    });
  }, [selectedDesignId]);

  const toggleRegionFluor = useCallback((colorIndex: number, regionId: number, field: 'spotFluorY' | 'spotFluorM' | 'spotFluorG' | 'spotFluorOrange') => {
    setExtractedColors(prev => {
      const updated = prev.map((color, i) => {
        if (i !== colorIndex || !color.regions) return color;
        const updatedRegions = color.regions.map(r => {
          if (r.id !== regionId) return r;
          const newVal = !r[field];
          // if turning on, clear other fluors on this region; if turning off, just clear
          return {
            ...r,
            spotFluorY: newVal && field === 'spotFluorY' ? true : newVal ? false : (field === 'spotFluorY' ? false : r.spotFluorY),
            spotFluorM: newVal && field === 'spotFluorM' ? true : newVal ? false : (field === 'spotFluorM' ? false : r.spotFluorM),
            spotFluorG: newVal && field === 'spotFluorG' ? true : newVal ? false : (field === 'spotFluorG' ? false : r.spotFluorG),
            spotFluorOrange: newVal && field === 'spotFluorOrange' ? true : newVal ? false : (field === 'spotFluorOrange' ? false : r.spotFluorOrange),
          };
        });
        // derive color-level flags: true if ANY region has the assignment
        const anyY = updatedRegions.some(r => r.spotFluorY);
        const anyM = updatedRegions.some(r => r.spotFluorM);
        const anyG = updatedRegions.some(r => r.spotFluorG);
        const anyOr = updatedRegions.some(r => r.spotFluorOrange);
        return { ...color, regions: updatedRegions, spotFluorY: anyY, spotFluorM: anyM, spotFluorG: anyG, spotFluorOrange: anyOr };
      });
      if (selectedDesignId) spotSelectionsRef.current.set(selectedDesignId, updated);
      return updated;
    });
  }, [selectedDesignId]);

  // Live refs so handleWandAssign never reads a stale closure snapshot.
  const activeChannelLiveRef = useRef(activeChannel);
  activeChannelLiveRef.current = activeChannel;
  const extractedColorsLiveRef = useRef(extractedColors);
  extractedColorsLiveRef.current = extractedColors;

  /** Assign the active channel to the pixel at normalized image coordinates (0..1). Called from the preview canvas.
   *  Always assigns at region-level so only the clicked shape is affected — never the entire color.
   *  Color-level assignment is only available through the color-list buttons, not the wand. */
  const handleWandAssign = useCallback((nx: number, ny: number) => {
    const ac = activeChannelLiveRef.current;
    if (!ac) return;
    const pm = pixelMapRef.current;
    if (!pm) return;
    const colors = extractedColorsLiveRef.current;
    const mx = Math.min(Math.floor(nx * pm.width),  pm.width  - 1);
    const my = Math.min(Math.floor(ny * pm.height), pm.height - 1);
    const mpi = my * pm.width + mx;
    const ci = pm.pixelMap[mpi];
    if (ci < 0 || ci >= colors.length) return;
    const color = colors[ci];
    if (!color) return;

    const regions = color.regions;

    if (regions && regions.length > 1 && color.regionMap) {
      // Multi-region color: assign ONLY the specific disconnected shape the user clicked.
      // This is the bug-fix path — never assign every instance of the color.
      const ri = color.regionMap[mpi] ?? -1;
      if (ri < 0 || !regions[ri]) return;
      toggleRegionFluor(ci, regions[ri].id, ac);
    } else if (regions && regions.length === 1) {
      // Single region detected — one contiguous area, assign it.
      toggleRegionFluor(ci, regions[0].id, ac);
    } else {
      // No region data yet (region worker hasn't finished, or shapes are tiny).
      // Color only has one visual area so color-level == region-level here.
      updateSpotColor(ci, ac, !color[ac as keyof typeof color]);
    }
  }, [toggleRegionFluor, updateSpotColor]);

  // Keep wandAssignRef in sync. No cleanup nulling — old closure still works (idempotent assigns),
  // and a null window between renders would silently drop clicks.
  useEffect(() => {
    if (!wandAssignRef) return;
    wandAssignRef.current = handleWandAssign;
  }, [wandAssignRef, handleWandAssign]);

  // Bubble active-channel changes up so the preview can show a crosshair cursor.
  useEffect(() => {
    onActiveChannelChange?.(activeChannel);
  }, [activeChannel, onActiveChannelChange]);

  const sortedColorIndices = useMemo(() => {
    // Sort by hue group in the order the user cares about for fluorescent printing:
    // Magenta → Red → Orange → Yellow → Green → other → dark/achromatic
    const huePriority = (c: ExtractedColor): number => {
      const r = c.rgb.r / 255, g = c.rgb.g / 255, b = c.rgb.b / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.08 || max < 0.12) return 6; // very dark or near-grey → last
      let h = 0;
      if (max === r)      h = (60 * ((g - b) / d) + 360) % 360;
      else if (max === g) h = 60 * ((b - r) / d) + 120;
      else                h = 60 * ((r - g) / d) + 240;
      if (h >= 285 && h < 345) return 0; // Magenta / pink / hot-pink
      if (h >= 345 || h < 20)  return 1; // Red
      if (h >= 20  && h < 50)  return 2; // Orange
      if (h >= 50  && h < 80)  return 3; // Yellow
      if (h >= 80  && h < 170) return 4; // Green / lime
      return 5;                           // Cyan / blue / purple / other
    };
    return extractedColors
      .map((c, i) => ({ index: i, hue: huePriority(c), pct: c.percentage ?? 0 }))
      .sort((a, b) => a.hue - b.hue || b.pct - a.pct)
      .map(e => e.index);
  }, [extractedColors]);

  const buildSpotColorsForDesign = useCallback((colors: ExtractedColor[]) => colors.map(c => ({
    hex: c.hex,
    rgb: c.rgb,
    spotWhite: false,
    spotGloss: false,
    spotWhiteName: '',
    spotGlossName: '',
    spotFluorY: c.spotFluorY ?? false,
    spotFluorM: c.spotFluorM ?? false,
    spotFluorG: c.spotFluorG ?? false,
    spotFluorOrange: c.spotFluorOrange ?? false,
    spotFluorYName, spotFluorMName, spotFluorGName, spotFluorOrangeName,
    // Carry region data for PDF per-region mask generation
    regions: c.regions,
    regionMap: c.regionMap,
  })), [spotFluorYName, spotFluorMName, spotFluorGName, spotFluorOrangeName]);

  const getAllDesignSpotColors = useCallback(() => {
    if (selectedDesignId && extractedColors.length > 0) {
      spotSelectionsRef.current.set(selectedDesignId, extractedColors);
    }
    const result: Record<string, ReturnType<typeof buildSpotColorsForDesign>> = {};
    for (const [designId, colors] of spotSelectionsRef.current.entries()) {
      result[designId] = buildSpotColorsForDesign(colors);
    }
    if (selectedDesignId && !result[selectedDesignId] && extractedColors.length > 0) {
      result[selectedDesignId] = buildSpotColorsForDesign(extractedColors);
    }
    return result;
  }, [selectedDesignId, extractedColors, buildSpotColorsForDesign]);

  const isPdf = downloadFormat === 'pdf';
  const dlLabel = t("controls.downloadGangsheet");
  const dlTitle = !canDownload ? t("controls.uploadFirst") : isProcessing ? t("editor.processing") : dlLabel;

  const handleDownloadClick = useCallback(() => {
    if (isPdf && enableFluorescent) {
      const spotColors = getAllDesignSpotColors();
      onDownload('standard', 'pdf', spotColors);
    } else {
      onDownload('standard', 'png');
    }
  }, [isPdf, enableFluorescent, getAllDesignSpotColors, onDownload]);

  const assignedCount = extractedColors.filter(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange).length;

  const INK_NAMES: Record<string, string> = {
    Yellow: t("controls.fluorYellow"),
    Magenta: t("controls.fluorMagenta"),
    Orange: t("controls.fluorOrange"),
    Green: t("controls.fluorGreen"),
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="w-6 h-6 rounded-md bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
            <Layers className="w-3.5 h-3.5 text-cyan-600" />
          </div>
          <span className="text-xs font-medium text-gray-900 flex-shrink-0">{t("controls.gangsheetSize")}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <input
              type="number"
              min="1"
              max="120"
              step="0.5"
              value={widthInputValue}
              onChange={(e) => { setEditingWidth(true); setWidthInputValue(e.target.value); }}
              onBlur={(e) => {
                setEditingWidth(false);
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) onArtboardWidthChange?.(v);
                else setWidthInputValue(String(artboardWidth));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditingWidth(false);
                  const v = parseFloat(widthInputValue);
                  if (!isNaN(v) && v > 0) onArtboardWidthChange?.(v);
                  else setWidthInputValue(String(artboardWidth));
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className={`h-7 font-semibold text-gray-900 bg-gray-100 border border-gray-200 rounded px-1 text-center focus:outline-none focus:border-cyan-400 ${lang === 'en' ? 'w-[56px] text-xs' : 'w-[64px] text-[10px]'}`}
            />
            {lang === 'en' && <span className="text-[10px] text-gray-500">"</span>}
            <span className={`text-gray-600 ${lang === 'en' ? 'text-xs' : 'text-[10px]'}`}>×</span>
            <Select value={String(artboardHeight)} onValueChange={(v) => onArtboardHeightChange?.(parseInt(v))}>
              <SelectTrigger className={`h-7 font-semibold text-gray-900 bg-gray-100 border-gray-200 ${lang === 'en' ? 'w-[68px] text-xs' : 'w-[80px] text-[10px]'}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gangsheetHeights.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    <span className="flex items-center justify-between gap-3 w-full">
                      <span className={lang !== 'en' ? 'text-[10px]' : ''}>{formatLength(h, lang)}{lang === "en" ? '"' : ""}</span>
                      {recommendedArtboardHeight === h && (
                        <span className="text-[10px] text-blue-600 font-medium">
                          {t("controls.currentBounds")}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {enableFluorescent && imageInfo && fluorPanelContainer && createPortal(
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Outer element must NOT be <button> — the eye toggle is a <button> inside,
              and nested buttons are invalid HTML (React also warns about it). */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowSpotColors(!showSpotColors)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSpotColors(p => !p); } }}
            className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors cursor-pointer ${showSpotColors ? 'bg-purple-50' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-medium text-gray-900">{t("controls.fluorColors")}</span>
              {assignedCount > 0 && (
                <span className="text-[9px] bg-purple-500/20 text-purple-500 px-1.5 py-0.5 rounded-full">
                  {t("controls.assigned", { count: assignedCount })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setSpotPreviewEnabled(!spotPreviewEnabled); }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  spotPreviewEnabled
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                }`}
                title={spotPreviewEnabled ? t("controls.hideOverlay") : t("controls.showOverlay")}
              >
                {spotPreviewEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-600 transition-transform ${showSpotColors ? 'rotate-180' : ''}`} />
            </div>
          </div>

          {showSpotColors && (
            <div className="px-3 pb-3 space-y-3">
              {extractedColors.length === 0 ? (
                <div className="text-xs text-gray-500 italic py-1">{t("controls.noColors")}</div>
              ) : (
                <>
                  {/* ── Channel selector: tap to activate, then tap image ── */}
                  {(() => {
                    const CHANNELS = [
                      { field: 'spotFluorY'      as const, label: 'FY', name: 'Yellow',  bg: '#DFFF00' },
                      { field: 'spotFluorM'      as const, label: 'FM', name: 'Magenta', bg: '#FF00FF' },
                      { field: 'spotFluorG'      as const, label: 'FG', name: 'Green',   bg: '#39FF14' },
                      { field: 'spotFluorOrange' as const, label: 'FO', name: 'Orange',  bg: '#FF6600' },
                    ];
                    return (
                      <>
                      {/* Label so new users understand these are the selection wand buttons */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <svg className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 2l1.5 1.5-7 7L3 10l7-7z"/>
                          <path d="M13.5 4.5l-2-2"/>
                          <path d="M4.5 13l-1-1 .5-1.5"/>
                        </svg>
                        <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Color Select Wand</span>
                        <span className="text-[9px] text-gray-400 font-normal normal-case tracking-normal">— pick a channel, then tap your design</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {CHANNELS.map(({ field, label, name, bg }) => {
                          const isSelected = activeChannel === field;
                          const hasAssignment = extractedColors.filter(c => (c.percentage ?? 0) >= 0.5).some(c => c[field]);
                          return (
                            <button
                              key={field}
                              onClick={() => {
                                if (isSelected && panModeActive) {
                                  // Reselecting same channel while in pan mode → exit pan mode, keep channel
                                  onPanModeChange?.(false);
                                } else {
                                  setActiveChannel(isSelected ? null : field);
                                  // Switching to or deselecting a channel → always exit pan mode
                                  if (panModeActive) onPanModeChange?.(false);
                                }
                              }}
                              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border-2 transition-all select-none active:scale-95 ${isSelected ? 'shadow-lg scale-[1.04]' : 'hover:brightness-95'}`}
                              style={{
                                borderColor: bg,
                                // Unselected: ~20% tint so background carries the color identity.
                                // Selected: ~45% tint with outline.
                                // Text is always dark — fluorescent colors have terrible contrast on white.
                                backgroundColor: isSelected ? bg + '72' : bg + '38',
                                outline: isSelected ? `2px solid ${bg}` : 'none',
                                outlineOffset: '2px',
                              }}
                              title={`${isSelected ? 'Deselect' : 'Select'} ${name} — then tap the image to assign`}
                            >
                              <span className="text-[15px] font-black leading-none text-gray-900">{label}</span>
                              <span className="text-[9px] leading-none mt-0.5 text-gray-600">{name}</span>
                              {hasAssignment && <div className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ backgroundColor: '#374151' }} />}
                            </button>
                          );
                        })}
                      </div>
                      </>
                    );
                  })()}

                  {/* Hint: tell the user to click the main preview */}
                  <p className="text-[10px] text-center text-gray-500 leading-snug -mt-0.5">
                    {activeChannel
                      ? <>Tap the design in the preview →<br/>to assign <strong>{activeChannel === 'spotFluorY' ? 'FY' : activeChannel === 'spotFluorM' ? 'FM' : activeChannel === 'spotFluorG' ? 'FG' : 'FO'}</strong></>
                      : 'Select a channel above, then tap the design in the preview'
                    }
                  </p>

                  {/* ── Detected color list — always visible, matches reference app ── */}
                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-[10px] text-gray-400 mb-1.5">
                      {extractedColors.filter(c => (c.percentage ?? 0) >= 1).length} colors detected
                    </p>
                    <div ref={colorListRef} className="flex flex-col gap-1.5">
                      {sortedColorIndices
                        .filter(idx => (extractedColors[idx].percentage ?? 0) >= 1)
                        .map(idx => {
                          const color = extractedColors[idx];
                          const hasRegions = (color.regions?.length ?? 0) > 1;
                          const isExpanded = expandedColorIndex === idx;
                          const INK_BTNS = [
                            { field: 'spotFluorY'      as const, label: 'FY', bg: '#DFFF00' },
                            { field: 'spotFluorM'      as const, label: 'FM', bg: '#FF00FF' },
                            { field: 'spotFluorG'      as const, label: 'FG', bg: '#39FF14' },
                            { field: 'spotFluorOrange' as const, label: 'FO', bg: '#FF6600' },
                          ];
                          const someFluor = (f: typeof INK_BTNS[0]['field']) => hasRegions ? color.regions!.some(r => r[f]) : !!color[f];
                          const allFluor  = (f: typeof INK_BTNS[0]['field']) => hasRegions ? color.regions!.every(r => r[f]) : !!color[f];
                          return (
                            <div key={idx} className="bg-white rounded-lg border border-gray-200 overflow-hidden transition-all">
                              <div className="flex items-center gap-2 p-2">
                                {/* Expand toggle + large swatch */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {hasRegions && (
                                    <button onClick={() => setExpandedColorIndex(isExpanded ? null : idx)} className="p-0.5 hover:bg-gray-100 rounded">
                                      {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
                                    </button>
                                  )}
                                  <div
                                    className="w-8 h-8 rounded-lg border border-gray-300 shadow-sm flex-shrink-0"
                                    style={{ backgroundColor: color.hex }}
                                    title={color.hex}
                                  />
                                </div>
                                {/* Hex + percentage */}
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-mono font-medium text-gray-700 truncate">{color.hex}</div>
                                  <div className="text-[9px] text-gray-400">
                                    {(color.percentage ?? 0).toFixed(1)}%{hasRegions ? ` · ${color.regions!.length} shapes` : ''}
                                  </div>
                                </div>
                                {/* FY / FM / FG / FO buttons */}
                                <div className="flex gap-0.5 flex-shrink-0">
                                  {INK_BTNS.map(({ field, label, bg }) => {
                                    const isAll = allFluor(field);
                                    const isSome = someFluor(field) && !isAll;
                                    return (
                                      <button
                                        key={field}
                                        onClick={() => updateSpotColor(idx, field, !color[field])}
                                        className={`w-7 h-7 rounded text-[9px] font-bold flex items-center justify-center transition-all ${isAll ? 'ring-1 ring-offset-1 ring-offset-white scale-105' : isSome ? '' : 'hover:brightness-95'}`}
                                        style={{
                                          // Always dark text — fluorescent colors on white are unreadable.
                                          // Background carries the color; brightness shows activation level.
                                          backgroundColor: isAll ? bg : isSome ? bg + '66' : bg + '30',
                                          color: '#111',
                                          border: `1.5px solid ${isAll ? bg : bg + 'aa'}`,
                                          ['--tw-ring-color' as string]: bg,
                                        }}
                                      >{label}</button>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* Expanded per-region rows */}
                              {isExpanded && hasRegions && (
                                <div className="border-t border-gray-100 bg-gray-50">
                                  {color.regions!.map(region => (
                                    <div key={region.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 last:border-b-0">
                                      {region.thumbnailUrl
                                        ? <img src={region.thumbnailUrl} alt="" className="w-7 h-7 rounded border border-gray-200 object-contain bg-white flex-shrink-0" />
                                        : <div className="w-7 h-7 rounded border border-dashed border-gray-300 flex-shrink-0" />}
                                      <span className="text-[10px] text-gray-500 flex-1">Shape {region.id + 1}</span>
                                      <div className="flex gap-0.5">
                                        {INK_BTNS.map(({ field, label, bg }) => (
                                          <button
                                            key={field}
                                            onClick={() => toggleRegionFluor(idx, region.id, field)}
                                            className={`w-6 h-6 rounded text-[8px] font-bold flex items-center justify-center transition-all ${region[field] ? 'ring-1 ring-offset-1 ring-offset-white scale-105' : 'hover:brightness-95'}`}
                                            style={{
                                              backgroundColor: region[field] ? bg : bg + '30',
                                              color: '#111',
                                              border: `1.5px solid ${region[field] ? bg : bg + 'aa'}`,
                                              ['--tw-ring-color' as string]: bg,
                                            }}
                                          >{label}</button>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>,
        fluorPanelContainer
      )}

      {enableFluorescent && imageInfo && fluorPanelContainer && createPortal(
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mt-2">
          <button
            onClick={() => setShowFluorInfo(prev => !prev)}
            className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-cyan-600" />
              <span className="text-xs font-medium text-gray-700">{t("controls.howFluorWorks")}</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-600 transition-transform ${showFluorInfo ? 'rotate-180' : ''}`} />
          </button>

          {showFluorInfo && (
            <div className="px-3 pb-3">
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">{t("controls.availableInks")}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { name: 'Yellow', color: '#DFFF00' },
                    { name: 'Magenta', color: '#FF00FF' },
                    { name: 'Orange', color: '#FF6600' },
                    { name: 'Green', color: '#39FF14' },
                  ].map(ink => (
                    <div key={ink.name} className="flex items-center gap-1.5 bg-gray-200/60 rounded px-2 py-1">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ink.color }} />
                      <span className="text-[10px] font-medium text-gray-700">{INK_NAMES[ink.name]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">{t("controls.howItWorks")}</p>
                <div className="space-y-1.5 text-[10px] text-gray-600 leading-relaxed">
                  <div className="flex gap-2">
                    <span className="text-cyan-600 font-bold flex-shrink-0">1.</span>
                    <span>{t("controls.fluorStep1")}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-cyan-600 font-bold flex-shrink-0">2.</span>
                    <span>{t("controls.fluorStep2")}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-cyan-600 font-bold flex-shrink-0">3.</span>
                    <span>{t("controls.fluorStep3")}</span>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-gray-600 leading-relaxed mb-2">
                {t("controls.fluorNote")}
              </p>
            </div>
          )}
        </div>,
        fluorPanelContainer
      )}

      {downloadContainer && createPortal(
        <div
          className={`flex items-center gap-3 bg-white border-t border-gray-200 px-4 py-2 ${
            isMobile ? "fixed bottom-0 left-0 right-0 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]" : ""
          }`}
          style={isMobile ? { paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" } : undefined}
        >
          <div className={`flex items-center gap-2 text-xs text-gray-600 flex-shrink-0 ${isMobile ? 'hidden' : ''}`}>
            <FileCheck className="w-3.5 h-3.5 text-gray-600" />
            <span className="tabular-nums">{designCount !== 1 ? t("controls.designsPlural", { count: designCount }) : t("controls.designs", { count: designCount })}</span>
            <span className="text-gray-600">·</span>
            <span className={`tabular-nums ${lang !== 'en' ? 'text-[10px]' : ''}`}>{formatLength(artboardWidth, lang)}{lang === 'en' ? '"' : ''} × {formatLength(artboardHeight, lang)}{lang === 'en' ? '"' : ''}</span>
          </div>
          <Button
            onClick={handleDownloadClick}
            disabled={isProcessing || !canDownload}
            title={dlTitle}
            className="flex-1 h-10 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-lg shadow-lg shadow-cyan-500/25 font-medium disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                {t("editor.processing")}
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                {dlLabel}
              </>
            )}
          </Button>
        </div>,
        downloadContainer
      )}
    </div>
  );
}
