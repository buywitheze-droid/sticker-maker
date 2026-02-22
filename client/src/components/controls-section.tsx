import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StrokeSettings, ResizeSettings, ImageInfo, ShapeSettings, StickerSize } from "./image-editor";
import { STICKER_SIZES } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { getContourWorkerManager, type DetectedAlgorithm } from "@/lib/contour-worker-manager";
import { extractColorsFromImageAsync, groupColorsByShade, ExtractedColor } from "@/lib/color-extractor";
import { Download, ChevronDown, ChevronUp, Palette, Eye, EyeOff, Pencil, Check, X, Layers, Send, FileCheck, Info } from "lucide-react";

export interface SpotPreviewData {
  enabled: boolean;
  colors: ExtractedColor[];
}

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  stickerSize: StickerSize;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onShapeChange: (settings: Partial<ShapeSettings>) => void;
  onStickerSizeChange: (size: StickerSize) => void;
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package', format?: string, spotColorsByDesign?: Record<string, Array<{hex: string; rgb: {r: number; g: number; b: number}; spotWhite: boolean; spotGloss: boolean; spotWhiteName?: string; spotGlossName?: string; spotFluorY: boolean; spotFluorM: boolean; spotFluorG: boolean; spotFluorOrange: boolean; spotFluorYName?: string; spotFluorMName?: string; spotFluorGName?: string; spotFluorOrangeName?: string}>>) => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  onStepChange?: (step: number) => void;
  onRemoveBackground?: (threshold: number) => void;
  isRemovingBackground?: boolean;
  onSpotPreviewChange?: (data: SpotPreviewData) => void;
  detectedAlgorithm?: DetectedAlgorithm;
  artboardWidth?: number;
  artboardHeight?: number;
  onArtboardHeightChange?: (height: number) => void;
  fluorPanelContainer?: HTMLDivElement | null;
  downloadContainer?: HTMLDivElement | null;
  designCount?: number;
  selectedDesignId?: string | null;
  copySpotSelectionsRef?: React.MutableRefObject<((fromId: string, toIds: string[]) => void) | null>;
}

export default function ControlsSection({
  strokeSettings,
  resizeSettings,
  shapeSettings,
  stickerSize,
  onStrokeChange,
  onResizeChange,
  onShapeChange,
  onStickerSizeChange,
  onDownload,
  isProcessing,
  imageInfo,
  canvasRef,
  onStepChange,
  onRemoveBackground,
  isRemovingBackground,
  onSpotPreviewChange,
  detectedAlgorithm,
  artboardWidth = 24.5,
  artboardHeight = 12,
  onArtboardHeightChange,
  fluorPanelContainer,
  downloadContainer,
  designCount = 0,
  selectedDesignId,
  copySpotSelectionsRef,
}: ControlsSectionProps) {
  const { toast } = useToast();
  const [showContourOptions, setShowContourOptions] = useState(true);
  const [showSpotColors, setShowSpotColors] = useState(false);
  const [showFluorInfo, setShowFluorInfo] = useState(false);
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
  const [spotPreviewEnabled, setSpotPreviewEnabled] = useState(true);
  const [groupColorsEnabled, setGroupColorsEnabled] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [showSizeSection, setShowSizeSection] = useState(false);
  const [spotWhiteName, setSpotWhiteName] = useState("RDG_WHITE");
  const [spotGlossName, setSpotGlossName] = useState("RDG_GLOSS");
  const [editingWhiteName, setEditingWhiteName] = useState(false);
  const [editingGlossName, setEditingGlossName] = useState(false);
  const [tempWhiteName, setTempWhiteName] = useState("");
  const [tempGlossName, setTempGlossName] = useState("");
  const [spotColorMode, setSpotColorMode] = useState<'whitegloss' | 'fluorescent'>('fluorescent');
  const [spotFluorYName, setSpotFluorYName] = useState("Fluorescent_Y");
  const [spotFluorMName, setSpotFluorMName] = useState("Fluorescent_M");
  const [spotFluorGName, setSpotFluorGName] = useState("Fluorescent_G");
  const [spotFluorOrangeName, setSpotFluorOrangeName] = useState("Fluorescent_Orange");
  const [editingFluorName, setEditingFluorName] = useState<string | null>(null);
  const [tempFluorName, setTempFluorName] = useState("");

  const canDownload = !!imageInfo;

  const colorCacheRef = useRef<Map<string, ExtractedColor[]>>(new Map());
  // Per-design spot color selections: designId → ExtractedColor[] with user assignments
  const spotSelectionsRef = useRef<Map<string, ExtractedColor[]>>(new Map());
  const prevDesignIdRef = useRef<string | null | undefined>(null);

  useEffect(() => {
    if (prevDesignIdRef.current && extractedColors.length > 0) {
      spotSelectionsRef.current.set(prevDesignIdRef.current, extractedColors);
    }
    prevDesignIdRef.current = selectedDesignId;

    if (imageInfo?.image) {
      if (selectedDesignId && spotSelectionsRef.current.has(selectedDesignId)) {
        setExtractedColors(spotSelectionsRef.current.get(selectedDesignId)!);
      } else {
        const cacheKey = `${imageInfo.image.src}-${imageInfo.image.width}-${imageInfo.image.height}`;
        const cached = colorCacheRef.current.get(cacheKey);
        if (cached) {
          setExtractedColors(cached.map(c => ({ ...c })));
        } else {
          let cancelled = false;
          extractColorsFromImageAsync(imageInfo.image, 999).then(colors => {
            if (cancelled) return;
            colorCacheRef.current.set(cacheKey, colors);
            if (colorCacheRef.current.size > 20) {
              const firstKey = colorCacheRef.current.keys().next().value;
              if (firstKey) colorCacheRef.current.delete(firstKey);
            }
            setExtractedColors(colors);
          });
          return () => { cancelled = true; };
        }
      }
    } else {
      setExtractedColors([]);
    }
  }, [imageInfo, selectedDesignId]);

  // Expose a function that copies spot selections from one design to new duplicates
  useEffect(() => {
    if (copySpotSelectionsRef) {
      copySpotSelectionsRef.current = (fromId: string, toIds: string[]) => {
        // Ensure the current design's selections are saved first
        if (selectedDesignId && extractedColors.length > 0) {
          spotSelectionsRef.current.set(selectedDesignId, extractedColors);
        }
        const source = spotSelectionsRef.current.get(fromId);
        if (!source) return;
        for (const toId of toIds) {
          spotSelectionsRef.current.set(toId, source.map(c => ({ ...c })));
        }
      };
    }
    return () => { if (copySpotSelectionsRef) copySpotSelectionsRef.current = null; };
  }, [copySpotSelectionsRef, selectedDesignId, extractedColors]);

  const handleSpotColorsToggle = () => {
    if (!showSpotColors) {
      // Opening spot colors - close contour options
      setShowContourOptions(false);
      setShowSpotColors(true);
    } else {
      setShowSpotColors(false);
    }
  };

  const handleContourOptionsToggle = () => {
    if (!showContourOptions) {
      // Opening contour options - close spot colors
      setShowSpotColors(false);
      setShowContourOptions(true);
    }
  };

  const updateSpotColor = (index: number, field: 'spotWhite' | 'spotGloss' | 'spotFluorY' | 'spotFluorM' | 'spotFluorG' | 'spotFluorOrange', value: boolean) => {
    const fluorFields = ['spotFluorY', 'spotFluorM', 'spotFluorG', 'spotFluorOrange'];
    const isFluorField = fluorFields.includes(field);

    setExtractedColors(prev => {
      const updated = prev.map((color, i) => {
        if (i === index) {
          if (isFluorField && value) {
            return {
              ...color,
              spotFluorY: false,
              spotFluorM: false,
              spotFluorG: false,
              spotFluorOrange: false,
              [field]: true,
            };
          }
          return { ...color, [field]: value };
        }
        return color;
      });
      if (selectedDesignId) {
        spotSelectionsRef.current.set(selectedDesignId, updated);
      }
      return updated;
    });
  };

  const sortedColorIndices = useMemo(() => {
    const fluorPriority = (c: ExtractedColor) => {
      const r = c.rgb.r, g = c.rgb.g, b = c.rgb.b;
      const max = Math.max(r, g, b);
      const saturation = max === 0 ? 0 : 1 - Math.min(r, g, b) / max;
      const lightness = (r + g + b) / 3;
      if (saturation < 0.15 || lightness < 40 || lightness > 240) return 1;
      const isMagenta = r > 180 && b > 120 && g < 120;
      const isYellow = r > 180 && g > 160 && b < 100;
      const isGreen = g > 150 && r < 150 && b < 150;
      const isOrange = r > 200 && g > 80 && g < 180 && b < 80;
      const isPink = r > 180 && g < 130 && b > 100;
      const isRed = r > 180 && g < 80 && b < 80;
      if (isMagenta || isYellow || isGreen || isOrange || isPink || isRed) return 0;
      return 1;
    };
    return extractedColors
      .map((c, i) => ({ index: i, priority: fluorPriority(c), pct: c.percentage }))
      .sort((a, b) => a.priority - b.priority || b.pct - a.pct)
      .map(e => e.index);
  }, [extractedColors]);

  const buildSpotColorsForDesign = (colors: ExtractedColor[]) => colors.map(c => ({
    ...c,
    spotWhite: spotColorMode === 'whitegloss' ? c.spotWhite : false,
    spotGloss: spotColorMode === 'whitegloss' ? c.spotGloss : false,
    spotWhiteName, spotGlossName,
    spotFluorY: spotColorMode === 'fluorescent' ? c.spotFluorY : false,
    spotFluorM: spotColorMode === 'fluorescent' ? c.spotFluorM : false,
    spotFluorG: spotColorMode === 'fluorescent' ? c.spotFluorG : false,
    spotFluorOrange: spotColorMode === 'fluorescent' ? c.spotFluorOrange : false,
    spotFluorYName, spotFluorMName, spotFluorGName, spotFluorOrangeName
  }));

  const getAllDesignSpotColors = (): Record<string, ReturnType<typeof buildSpotColorsForDesign>> => {
    // Save current design's selections before collecting
    if (selectedDesignId && extractedColors.length > 0) {
      spotSelectionsRef.current.set(selectedDesignId, extractedColors);
    }
    const result: Record<string, ReturnType<typeof buildSpotColorsForDesign>> = {};
    for (const [designId, colors] of spotSelectionsRef.current.entries()) {
      result[designId] = buildSpotColorsForDesign(colors);
    }
    // Include current design if not yet in the map
    if (selectedDesignId && !result[selectedDesignId] && extractedColors.length > 0) {
      result[selectedDesignId] = buildSpotColorsForDesign(extractedColors);
    }
    return result;
  };

  // Notify parent of spot preview changes
  useEffect(() => {
    onSpotPreviewChange?.({ enabled: spotPreviewEnabled, colors: extractedColors });
  }, [spotPreviewEnabled, extractedColors, onSpotPreviewChange]);

  const handleSendDesign = async () => {
    if (!customerName.trim() || !customerEmail.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter your full name and email address.",
        variant: "destructive",
      });
      return;
    }
    setShowConfirmDialog(true);
  };

  const confirmAndSend = async () => {
    setShowConfirmDialog(false);
    setIsSending(true);

    try {
      let pdfBase64 = "";
      
      if (imageInfo?.image) {
        if (strokeSettings.enabled) {
          const { generateContourPDFBase64 } = await import("@/lib/contour-outline");
          const { getContourWorkerManager } = await import("@/lib/contour-worker-manager");
          const workerManager = getContourWorkerManager();
          const cachedData = workerManager.getCachedContourData();
          const result = await generateContourPDFBase64(imageInfo.image, strokeSettings, resizeSettings, cachedData || undefined);
          pdfBase64 = result || "";
        } else if (shapeSettings.enabled) {
          const { generateShapePDFBase64 } = await import("@/lib/shape-outline");
          const result = await generateShapePDFBase64(imageInfo.image, shapeSettings, resizeSettings);
          pdfBase64 = result || "";
        }
      }

      if (!pdfBase64) {
        throw new Error("Failed to generate PDF. Please try again.");
      }

      const formData = new FormData();
      formData.append('customerName', customerName.trim());
      formData.append('customerEmail', customerEmail.trim());
      formData.append('customerNotes', customerNotes.trim());
      formData.append('pdfData', pdfBase64);
      formData.append('stickerSize', stickerSize.toString());
      formData.append('outlineType', strokeSettings.enabled ? 'contour' : 'shape');

      const response = await fetch('/api/send-design', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Failed to send design';
        try { const errorData = await response.json(); errorMessage = errorData.message || errorMessage; } catch {}
        throw new Error(errorMessage);
      }

      toast({
        title: "Design Sent Successfully!",
        description: "We've received your design. Check your email for confirmation.",
      });

      setCustomerName("");
      setCustomerEmail("");
      setCustomerNotes("");
      setShowSendForm(false);
    } catch (error) {
      console.error('Error sending design:', error);
      toast({
        title: "Error Sending Design",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Gangsheet Size */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Layers className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-sm font-medium text-gray-200">Gangsheet Size</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">{artboardWidth}"</span>
            <span className="text-gray-500">×</span>
            <Select value={String(artboardHeight)} onValueChange={(v) => onArtboardHeightChange?.(parseInt(v))}>
              <SelectTrigger className="w-[72px] h-8 text-sm font-semibold text-gray-200 bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 13 }, (_, i) => 12 + i).map((h) => (
                  <SelectItem key={h} value={String(h)}>{h}"</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* All Design Options Card */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* Sticker Size Section - HIDDEN */}
        {false && (
        <div className="border-b border-gray-100">
          <button
            onClick={() => setShowSizeSection(!showSizeSection)}
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center">
                <span className="text-cyan-600 font-bold text-xs">{stickerSize}"</span>
              </div>
              <span>Sticker Size</span>
            </div>
            {showSizeSection ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          
          {showSizeSection && (
            <div className="px-4 pb-3 space-y-3">
              <Select
                value={stickerSize.toString()}
                onValueChange={(value) => onStickerSizeChange(parseFloat(value) as StickerSize)}
              >
                <SelectTrigger className="w-full bg-gray-50 border-gray-200 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STICKER_SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value.toString()}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Compact Width/Height Resize Controls */}
              <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Width</label>
                    <div className="flex items-center mt-0.5">
                      <input
                        type="number"
                        value={Math.round(resizeSettings.widthInches * 100) / 100}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || val === '.') return;
                          const newWidth = Math.max(0.5, Math.min(24, parseFloat(val) || 0.5));
                          if (resizeSettings.maintainAspectRatio && imageInfo) {
                            const aspectRatio = resizeSettings.heightInches / resizeSettings.widthInches;
                            onResizeChange({ widthInches: newWidth, heightInches: newWidth * aspectRatio });
                          } else {
                            onResizeChange({ widthInches: newWidth });
                          }
                        }}
                        min="0.5"
                        max="24"
                        step="0.25"
                        className="w-full h-7 px-2 text-sm bg-white border border-gray-300 rounded text-gray-900 focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                      />
                      <span className="ml-1 text-xs text-gray-500">"</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => onResizeChange({ maintainAspectRatio: !resizeSettings.maintainAspectRatio })}
                    className={`mt-4 p-1.5 rounded transition-colors ${resizeSettings.maintainAspectRatio ? 'bg-cyan-100 text-cyan-600' : 'bg-gray-200 text-gray-400'}`}
                    title={resizeSettings.maintainAspectRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {resizeSettings.maintainAspectRatio ? (
                        <>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </>
                      ) : (
                        <>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </>
                      )}
                    </svg>
                  </button>
                  
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Height</label>
                    <div className="flex items-center mt-0.5">
                      <input
                        type="number"
                        value={Math.round(resizeSettings.heightInches * 100) / 100}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || val === '.') return;
                          const newHeight = Math.max(0.5, Math.min(24, parseFloat(val) || 0.5));
                          if (resizeSettings.maintainAspectRatio && imageInfo) {
                            const aspectRatio = resizeSettings.widthInches / resizeSettings.heightInches;
                            onResizeChange({ heightInches: newHeight, widthInches: newHeight * aspectRatio });
                          } else {
                            onResizeChange({ heightInches: newHeight });
                          }
                        }}
                        min="0.5"
                        max="24"
                        step="0.25"
                        className="w-full h-7 px-2 text-sm bg-white border border-gray-300 rounded text-gray-900 focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                      />
                      <span className="ml-1 text-xs text-gray-500">"</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Remove White Background - HIDDEN */}

        {/* Outline Type Section - HIDDEN */}

        {/* Contour Options - HIDDEN */}
        {false && strokeSettings.enabled && !(imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour) && (
          <div className="border-b border-gray-100">
            <button 
              onClick={handleContourOptionsToggle}
              className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-700">Contour Settings</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showContourOptions ? 'rotate-180' : ''}`} />
            </button>
            
            {showContourOptions && (
              <div className="space-y-3 px-4 pb-3">
              <div>
                <Label className="text-xs text-gray-500 font-medium">Contour Margin</Label>
                <Select
                  value={strokeSettings.width.toString()}
                  onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
                >
                  <SelectTrigger className="mt-2 bg-gray-50 border-gray-200 text-gray-900 text-sm rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Zero Hero</SelectItem>
                    <SelectItem value="0.02">Small</SelectItem>
                    <SelectItem value="0.04">Medium</SelectItem>
                    <SelectItem value="0.07">Large</SelectItem>
                    <SelectItem value="0.14">Extra Large</SelectItem>
                    <SelectItem value="0.25">Huge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Fill Color - HIDDEN */}
              
              {/* Holographic Preview - HIDDEN */}
              
              </div>
            )}
          </div>
        )}

        {/* PDF CutContour Options - Fill and Download */}
        {imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour && (
          <div className="px-4 py-3 border-b border-gray-800 space-y-3">
          <div className="text-sm font-medium text-gray-200">PDF Options</div>
          
          <div>
            <Label className="text-xs text-gray-400">Fill Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={strokeSettings.backgroundColor === 'transparent' || strokeSettings.backgroundColor === 'holographic' ? '#FFFFFF' : strokeSettings.backgroundColor}
                onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-600"
                disabled={strokeSettings.backgroundColor === 'holographic'}
              />
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => onStrokeChange({ backgroundColor: 'transparent' })}
                  className={`w-5 h-5 rounded border relative overflow-hidden ${strokeSettings.backgroundColor === 'transparent' ? 'ring-2 ring-cyan-500' : 'border-gray-600'}`}
                  style={{ backgroundColor: '#1f2937' }}
                  title="Transparent / None"
                >
                  <div 
                    className="absolute inset-0" 
                    style={{
                      background: 'linear-gradient(to top right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px))'
                    }}
                  />
                </button>
                {['#FFFFFF', '#000000', '#FF0000', '#0000FF', '#FFFF00', '#00FF00'].map((color) => (
                  <button
                    key={color}
                    onClick={() => onStrokeChange({ backgroundColor: color })}
                    className={`w-5 h-5 rounded border ${strokeSettings.backgroundColor === color && strokeSettings.backgroundColor !== 'holographic' ? 'ring-2 ring-cyan-500' : 'border-gray-600'}`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>
          
          {/* Holographic Preview Toggle */}
          <button
            onClick={() => onStrokeChange({ 
              backgroundColor: strokeSettings.backgroundColor === 'holographic' ? 'transparent' : 'holographic' 
            })}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all ${
              strokeSettings.backgroundColor === 'holographic' 
                ? 'border-purple-400 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white' 
                : 'border-gray-700 bg-gray-800 hover:border-gray-600 hover:bg-gray-750'
            }`}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-6 h-6 rounded-md border-2 border-white/40 shadow-sm"
                style={{
                  background: 'linear-gradient(135deg, #C8C8D0 0%, #E8B8B8 17%, #B8D8E8 34%, #E8D0F0 51%, #B0C8E0 68%, #C0B0D8 85%, #C8C8D0 100%)'
                }}
              />
              <span className="text-sm font-semibold">Holographic Preview</span>
            </div>
            {/* Toggle switch style */}
            <div className={`relative w-11 h-6 rounded-full transition-all ${
              strokeSettings.backgroundColor === 'holographic' 
                ? 'bg-white/30' 
                : 'bg-gray-700'
            }`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-md ${
                strokeSettings.backgroundColor === 'holographic' 
                  ? 'right-0.5 bg-white' 
                  : 'left-0.5 bg-gray-500'
              }`} />
            </div>
          </button>
          {strokeSettings.backgroundColor === 'holographic' && (
            <p className="mt-1 text-xs text-gray-500 italic">Rainbow effect in preview only. Downloads as transparent.</p>
          )}
          </div>
        )}

        {/* Shape Options - HIDDEN */}
        {false && shapeSettings.enabled && !(imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour) && (
          <div className="px-4 py-3 border-b border-gray-100 space-y-3">
          <div>
            <Label className="text-xs text-gray-600">Shape</Label>
            <Select
              value={shapeSettings.type}
              onValueChange={(value) => onShapeChange({ type: value as ShapeSettings['type'] })}
            >
              <SelectTrigger className="mt-1 bg-white border-gray-300 text-gray-900 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="rectangle">Rectangle</SelectItem>
                <SelectItem value="circle">Circle</SelectItem>
                <SelectItem value="oval">Oval</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-gray-600">Inner Padding</Label>
            <Select
              value={shapeSettings.offset.toString()}
              onValueChange={(value) => onShapeChange({ offset: parseFloat(value) })}
            >
              <SelectTrigger className="mt-1 bg-white border-gray-300 text-gray-900 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Zero Hero</SelectItem>
                <SelectItem value="0.0625">Small</SelectItem>
                <SelectItem value="0.125">Medium</SelectItem>
                <SelectItem value="0.25">Large</SelectItem>
                <SelectItem value="0.40">Extra Large</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Fill Color - HIDDEN */}
          
          {/* Holographic Preview - HIDDEN */}

          {/* Bleed - HIDDEN */}

          </div>
        )}

      </div>

      {/* Download bar - portaled to bottom of app */}
      {downloadContainer && createPortal(
        <div className="flex items-center gap-3 bg-gray-950 border-t border-gray-800 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
            <FileCheck className="w-3.5 h-3.5 text-gray-500" />
            <span className="tabular-nums">{designCount} design{designCount !== 1 ? 's' : ''}</span>
            <span className="text-gray-600">·</span>
            <span className="tabular-nums">{artboardWidth}" × {artboardHeight}"</span>
          </div>
          <Button
            onClick={() => onDownload('standard', 'pdf', getAllDesignSpotColors())}
            disabled={isProcessing || !canDownload}
            title={!canDownload ? 'Upload an image first' : isProcessing ? 'Processing...' : 'Download PDF'}
            className="flex-1 h-10 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-lg shadow-lg shadow-cyan-500/25 font-medium disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                Download PDF
              </>
            )}
          </Button>
        </div>,
        downloadContainer
      )}

      {/* Fluorescent panel - portaled into left sidebar */}
      {imageInfo && fluorPanelContainer && createPortal(
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <button
            onClick={handleSpotColorsToggle}
            className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-800/60 transition-colors ${showSpotColors ? 'bg-purple-500/10' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-medium text-gray-200">Fluorescent Colors</span>
              {extractedColors.filter(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange).length > 0 && (
                <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                  {extractedColors.filter(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange).length} assigned
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setSpotPreviewEnabled(!spotPreviewEnabled); }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  spotPreviewEnabled
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
                }`}
                title={spotPreviewEnabled ? 'Hide spot overlay' : 'Show spot overlay'}
              >
                {spotPreviewEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showSpotColors ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {showSpotColors && (
            <div className="px-3 pb-2.5 space-y-2">
              {extractedColors.length === 0 ? (
                <div className="text-xs text-gray-500 italic py-1">No colors detected in image</div>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto">
                  {sortedColorIndices
                    .filter((idx) => extractedColors[idx].percentage >= 0.5)
                    .map((idx) => {
                    const color = extractedColors[idx];
                    const isAssigned = color.spotFluorY || color.spotFluorM || color.spotFluorG || color.spotFluorOrange;
                    return (
                      <div key={idx} className={`flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
                        isAssigned
                          ? 'bg-purple-500/10 border border-purple-500/20'
                          : 'bg-gray-800/40 border border-transparent hover:border-gray-700'
                      }`}>
                        <div
                          className="w-3.5 h-3.5 rounded flex-shrink-0 border border-gray-600"
                          style={{ backgroundColor: color.hex }}
                          title={color.hex}
                        />
                        <span className="text-[10px] text-gray-300 truncate min-w-0 flex-1">{color.name || color.hex}</span>
                        <div className="flex gap-1 flex-shrink-0">
                          {([
                            { field: 'spotFluorY' as const, label: 'Y', bg: '#DFFF00' },
                            { field: 'spotFluorM' as const, label: 'M', bg: '#FF00FF' },
                            { field: 'spotFluorG' as const, label: 'G', bg: '#39FF14' },
                            { field: 'spotFluorOrange' as const, label: 'Or', bg: '#FF6600' },
                          ]).map(({ field, label, bg }) => (
                            <button
                              key={field}
                              onClick={() => updateSpotColor(idx, field, !color[field])}
                              className={`w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center transition-all ${
                                color[field]
                                  ? 'ring-1 ring-offset-1 ring-offset-gray-900 scale-110'
                                  : 'opacity-40 hover:opacity-80'
                              }`}
                              style={{
                                backgroundColor: color[field] ? bg : 'transparent',
                                color: color[field] ? '#000' : bg,
                                border: `1.5px solid ${bg}`,
                                ringColor: bg,
                              }}
                              title={`Fluorescent ${label}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="text-[10px] text-gray-500 pt-1.5 border-t border-gray-700 space-y-0.5">
                {([
                  { key: 'Y', name: spotFluorYName, setName: setSpotFluorYName, defaultName: 'Fluorescent_Y', neonColor: '#DFFF00' },
                  { key: 'M', name: spotFluorMName, setName: setSpotFluorMName, defaultName: 'Fluorescent_M', neonColor: '#FF00FF' },
                  { key: 'G', name: spotFluorGName, setName: setSpotFluorGName, defaultName: 'Fluorescent_G', neonColor: '#39FF14' },
                  { key: 'Orange', name: spotFluorOrangeName, setName: setSpotFluorOrangeName, defaultName: 'Fluorescent_Orange', neonColor: '#FF6600' },
                ] as const).map(({ key, name, setName, defaultName, neonColor }) => (
                  <div key={key} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: neonColor }} />
                    <span className="font-semibold" style={{ color: neonColor, textShadow: '0 0 1px rgba(0,0,0,0.3)' }}>{key}</span>
                    <span className="text-gray-600">→</span>
                    {editingFluorName === key ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={tempFluorName}
                          onChange={(e) => setTempFluorName(e.target.value)}
                          className="w-24 px-1 py-0.5 text-[10px] border border-gray-600 rounded bg-gray-800 text-gray-200"
                          autoFocus
                          onBlur={() => { setName(tempFluorName || defaultName); setEditingFluorName(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { setName(tempFluorName || defaultName); setEditingFluorName(null); }
                            else if (e.key === 'Escape') setEditingFluorName(null);
                          }}
                        />
                        <button onClick={() => { setName(tempFluorName || defaultName); setEditingFluorName(null); }} className="p-0.5 hover:bg-green-500/20 rounded" title="Save">
                          <Check className="w-2.5 h-2.5 text-green-400" />
                        </button>
                        <button onClick={() => setEditingFluorName(null)} className="p-0.5 hover:bg-red-500/20 rounded" title="Cancel">
                          <X className="w-2.5 h-2.5 text-red-400" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-gray-400">{name}</span>
                        <button onClick={() => { setTempFluorName(name); setEditingFluorName(key); }} className="p-0.5 hover:bg-gray-700 rounded" title="Edit name">
                          <Pencil className="w-2.5 h-2.5 text-gray-500" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

            </div>
          )}
        </div>,
        fluorPanelContainer
      )}

      {/* Info panel - separate collapsible section below fluorescent colors */}
      {imageInfo && fluorPanelContainer && createPortal(
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden mt-2">
          <button
            onClick={() => setShowFluorInfo(prev => !prev)}
            className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-800/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-medium text-gray-300">How Fluorescent Colors Work</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showFluorInfo ? 'rotate-180' : ''}`} />
          </button>

          {showFluorInfo && (
            <div className="px-3 pb-3">
              {/* Ink types */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Available Inks</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { name: 'Yellow', color: '#DFFF00' },
                    { name: 'Magenta', color: '#FF00FF' },
                    { name: 'Orange', color: '#FF6600' },
                    { name: 'Green', color: '#39FF14' },
                  ].map(ink => (
                    <div key={ink.name} className="flex items-center gap-1.5 bg-gray-800/60 rounded px-2 py-1">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ink.color }} />
                      <span className="text-[10px] font-medium text-gray-300">Fluorescent {ink.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* How it works */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">How It Works</p>
                <div className="space-y-1.5 text-[10px] text-gray-400 leading-relaxed">
                  <div className="flex gap-2">
                    <span className="text-cyan-400 font-bold flex-shrink-0">1.</span>
                    <span>Select a design to see all its detected colors above.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-cyan-400 font-bold flex-shrink-0">2.</span>
                    <span>Choose which fluorescent ink to assign to each color using the <strong className="text-gray-300">Y</strong>, <strong className="text-gray-300">M</strong>, <strong className="text-gray-300">G</strong>, <strong className="text-gray-300">Or</strong> buttons.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-cyan-400 font-bold flex-shrink-0">3.</span>
                    <span>The chosen fluorescent ink replaces that color in your printed transfer.</span>
                  </div>
                </div>
              </div>

              {/* Example */}
              <div className="bg-gray-800/40 rounded-md px-2.5 py-2 mb-3 border border-gray-700/50">
                <p className="text-[10px] font-semibold text-gray-400 mb-1">Example</p>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  If your design has <span className="font-semibold" style={{ color: '#39FF14' }}>green</span> lettering, assign it to <strong className="text-gray-200">Green</strong> to print with fluorescent green ink. Pick <strong className="text-gray-200">Orange</strong> instead and those letters print <span className="font-semibold" style={{ color: '#FF6600' }}>orange</span>.
                </p>
              </div>

              {/* Glow note */}
              <p className="text-[10px] text-gray-500 leading-relaxed mb-2">
                These are regular DTF transfers (hot peel) — the fluorescent colors <strong className="text-gray-400">glow under black light</strong>.
              </p>

              {/* Contact */}
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span>Questions?</span>
                <a href="mailto:Sales@dtfmasters.com" className="text-purple-400 hover:text-purple-300 underline transition-colors">Sales@dtfmasters.com</a>
              </div>
            </div>
          )}
        </div>,
        fluorPanelContainer
      )}

      {/* Confirm Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-gray-100">Confirm Send</DialogTitle>
            <DialogDescription className="text-gray-400">
              Send your design to {customerEmail}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="text-gray-300 hover:bg-gray-800" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button onClick={confirmAndSend} disabled={isSending} className="bg-green-600 hover:bg-green-700 text-white">{isSending ? 'Sending...' : 'Send'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
