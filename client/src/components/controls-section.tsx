import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StrokeSettings, ResizeSettings, ImageInfo, ShapeSettings, StickerSize } from "./image-editor";
import { STICKER_SIZES } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { generateContourPDFBase64 } from "@/lib/contour-outline";
import { generateShapePDFBase64 } from "@/lib/shape-outline";
import { getContourWorkerManager } from "@/lib/contour-worker-manager";
import { extractColorsFromImage, ExtractedColor } from "@/lib/color-extractor";
import { Download, ChevronDown, ChevronUp, Palette, Eye, EyeOff, Pencil, Check, X } from "lucide-react";

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
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package', format?: 'png' | 'pdf' | 'eps' | 'svg', spotColors?: Array<{hex: string; rgb: {r: number; g: number; b: number}; spotWhite: boolean; spotGloss: boolean; spotWhiteName?: string; spotGlossName?: string}>, singleArtboard?: boolean) => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  onStepChange?: (step: number) => void;
  onRemoveBackground?: (threshold: number) => void;
  isRemovingBackground?: boolean;
  onSpotPreviewChange?: (data: SpotPreviewData) => void;
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
  onSpotPreviewChange
}: ControlsSectionProps) {
  const { toast } = useToast();
  const [showContourOptions, setShowContourOptions] = useState(true);
  const [showSpotColors, setShowSpotColors] = useState(false);
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
  const [spotPreviewEnabled, setSpotPreviewEnabled] = useState(false);
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

  const canDownload = strokeSettings.enabled || shapeSettings.enabled;

  // Extract colors from original image (not preview canvas) to avoid contour/shape interference
  // Reset extracted colors when image changes to prevent stale colors from showing
  useEffect(() => {
    if (imageInfo?.image) {
      const colors = extractColorsFromImage(imageInfo.image, 18);
      setExtractedColors(colors);
    } else {
      setExtractedColors([]);
    }
  }, [imageInfo]);

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

  const updateSpotColor = (index: number, field: 'spotWhite' | 'spotGloss', value: boolean) => {
    setExtractedColors(prev => prev.map((color, i) => 
      i === index ? { ...color, [field]: value } : color
    ));
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
          const workerManager = getContourWorkerManager();
          const cachedData = workerManager.getCachedContourData();
          const result = await generateContourPDFBase64(imageInfo.image, strokeSettings, resizeSettings, cachedData || undefined);
          pdfBase64 = result || "";
        } else if (shapeSettings.enabled) {
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
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send design');
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
      {/* All Design Options Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Size Selection - Collapsible */}
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

        {/* Remove White Background */}
        {onRemoveBackground && (
          <div className="px-4 py-3 border-b border-gray-100">
            <button
              onClick={() => onRemoveBackground(85)}
              disabled={isRemovingBackground}
              className="w-full py-2.5 text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white rounded-lg shadow-md shadow-cyan-500/30 hover:shadow-cyan-400/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRemovingBackground ? 'Removing...' : 'Remove White Background'}
            </button>
          </div>
        )}

        {/* Outline Type Section */}
        <div className="px-4 py-3 border-b border-gray-100">
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Outline Type</Label>
          
          {imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour ? (
            <div className="p-2.5 bg-green-50 border border-green-100 rounded-lg">
              <p className="text-sm font-medium text-green-700">Cutline already in file</p>
              <p className="text-xs text-green-600 mt-0.5">CutContour detected</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onStrokeChange({ enabled: true })}
                className={`py-2.5 px-3 rounded-lg text-center transition-all font-medium text-sm ${
                  strokeSettings.enabled 
                    ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' 
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                Contour
              </button>
              
              <button
                onClick={() => onShapeChange({ enabled: true })}
                className={`py-2.5 px-3 rounded-lg text-center transition-all font-medium text-sm ${
                  shapeSettings.enabled 
                    ? 'bg-green-500 text-white shadow-md shadow-green-500/20' 
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                Shape
              </button>
            </div>
          )}
        </div>

        {/* Contour Options - Collapsible, Hidden when PDF has CutContour */}
        {strokeSettings.enabled && !(imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour) && (
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
              
              <div>
                <Label className="text-xs text-gray-500 font-medium">Fill Color</Label>
                <div className="flex items-center gap-3 mt-2">
                  <input
                    type="color"
                    value={strokeSettings.backgroundColor === 'transparent' || strokeSettings.backgroundColor === 'holographic' ? '#FFFFFF' : strokeSettings.backgroundColor}
                    onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-gray-200"
                    disabled={strokeSettings.backgroundColor === 'holographic'}
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => onStrokeChange({ backgroundColor: 'transparent' })}
                      className={`w-6 h-6 rounded-lg border relative overflow-hidden transition-all ${strokeSettings.backgroundColor === 'transparent' ? 'ring-2 ring-cyan-500 ring-offset-1' : 'border-gray-200 hover:border-gray-300'}`}
                      style={{ backgroundColor: '#fff' }}
                      title="Transparent"
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
                        className={`w-6 h-6 rounded-lg border transition-all ${strokeSettings.backgroundColor === color && strokeSettings.backgroundColor !== 'holographic' ? 'ring-2 ring-cyan-500 ring-offset-1' : 'border-gray-200 hover:border-gray-300'}`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Holographic Preview Toggle - Separate from fill */}
              <div className="pt-2 border-t border-gray-200">
                <button
                  onClick={() => onStrokeChange({ 
                    backgroundColor: strokeSettings.backgroundColor === 'holographic' ? 'transparent' : 'holographic' 
                  })}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all shadow-sm hover:shadow ${
                    strokeSettings.backgroundColor === 'holographic' 
                      ? 'border-purple-400 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white shadow-purple-200' 
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
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
                      : 'bg-gray-200'
                  }`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-md ${
                      strokeSettings.backgroundColor === 'holographic' 
                        ? 'right-0.5 bg-white' 
                        : 'left-0.5 bg-gray-400'
                    }`} />
                  </div>
                </button>
                {strokeSettings.backgroundColor === 'holographic' && (
                  <p className="mt-1.5 text-xs text-gray-500 italic">Shows rainbow effect in preview. Downloads as transparent.</p>
                )}
              </div>
              
              </div>
            )}
          </div>
        )}

        {/* PDF CutContour Options - Fill and Download */}
        {imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour && (
          <div className="px-4 py-3 border-b border-gray-100 space-y-3">
          <div className="text-sm font-medium text-gray-700">PDF Options</div>
          
          <div>
            <Label className="text-xs text-gray-600">Fill Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={strokeSettings.backgroundColor === 'transparent' || strokeSettings.backgroundColor === 'holographic' ? '#FFFFFF' : strokeSettings.backgroundColor}
                onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                disabled={strokeSettings.backgroundColor === 'holographic'}
              />
              <div className="flex gap-1 flex-wrap">
                {/* Transparent option with red diagonal line (none symbol) */}
                <button
                  onClick={() => onStrokeChange({ backgroundColor: 'transparent' })}
                  className={`w-5 h-5 rounded border relative overflow-hidden ${strokeSettings.backgroundColor === 'transparent' ? 'ring-2 ring-cyan-500' : 'border-gray-300'}`}
                  style={{ backgroundColor: '#fff' }}
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
                    className={`w-5 h-5 rounded border ${strokeSettings.backgroundColor === color && strokeSettings.backgroundColor !== 'holographic' ? 'ring-2 ring-cyan-500' : 'border-gray-300'}`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>
          
          {/* Holographic Preview Toggle - Separate from fill */}
          <button
            onClick={() => onStrokeChange({ 
              backgroundColor: strokeSettings.backgroundColor === 'holographic' ? 'transparent' : 'holographic' 
            })}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all shadow-sm hover:shadow ${
              strokeSettings.backgroundColor === 'holographic' 
                ? 'border-purple-400 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white shadow-purple-200' 
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
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
                : 'bg-gray-200'
            }`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-md ${
                strokeSettings.backgroundColor === 'holographic' 
                  ? 'right-0.5 bg-white' 
                  : 'left-0.5 bg-gray-400'
              }`} />
            </div>
          </button>
          {strokeSettings.backgroundColor === 'holographic' && (
            <p className="mt-1 text-xs text-gray-500 italic">Shows rainbow effect in preview. Downloads as transparent.</p>
          )}
          </div>
        )}

        {/* Shape Options - Hidden when PDF has CutContour */}
        {shapeSettings.enabled && !(imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour) && (
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

          <div>
            <Label className="text-xs text-gray-600">Fill Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={shapeSettings.fillColor === 'transparent' || shapeSettings.fillColor === 'holographic' ? '#FFFFFF' : shapeSettings.fillColor}
                onChange={(e) => onShapeChange({ fillColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                disabled={shapeSettings.fillColor === 'holographic'}
              />
              <div className="flex gap-1 flex-wrap">
                {/* Transparent option with red diagonal line (none symbol) */}
                <button
                  onClick={() => onShapeChange({ fillColor: 'transparent' })}
                  className={`w-5 h-5 rounded border relative overflow-hidden ${shapeSettings.fillColor === 'transparent' ? 'ring-2 ring-cyan-500' : 'border-gray-300'}`}
                  style={{ backgroundColor: '#fff' }}
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
                    onClick={() => onShapeChange({ fillColor: color })}
                    className={`w-5 h-5 rounded border ${shapeSettings.fillColor === color && shapeSettings.fillColor !== 'holographic' ? 'ring-2 ring-cyan-500' : 'border-gray-300'}`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>
          
          {/* Holographic Preview Toggle - Separate from fill */}
          <button
            onClick={() => onShapeChange({ 
              fillColor: shapeSettings.fillColor === 'holographic' ? 'transparent' : 'holographic' 
            })}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all shadow-sm hover:shadow ${
              shapeSettings.fillColor === 'holographic' 
                ? 'border-purple-400 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white shadow-purple-200' 
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
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
              shapeSettings.fillColor === 'holographic' 
                ? 'bg-white/30' 
                : 'bg-gray-200'
            }`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-md ${
                shapeSettings.fillColor === 'holographic' 
                  ? 'right-0.5 bg-white' 
                  : 'left-0.5 bg-gray-400'
              }`} />
            </div>
          </button>
          {shapeSettings.fillColor === 'holographic' && (
            <p className="mt-1.5 text-xs text-gray-500 italic">Shows rainbow effect in preview. Downloads as transparent.</p>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-gray-600">Bleed</Label>
              <input
                type="checkbox"
                checked={shapeSettings.bleedEnabled || false}
                onChange={(e) => onShapeChange({ bleedEnabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
              />
            </div>
            {shapeSettings.bleedEnabled && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={shapeSettings.bleedColor || '#FFFFFF'}
                  onChange={(e) => onShapeChange({ bleedColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                />
                <div className="flex gap-1">
                  {['#FFFFFF', '#000000', '#FF0000', '#0000FF', '#FFFF00', '#00FF00'].map((color) => (
                    <button
                      key={color}
                      onClick={() => onShapeChange({ bleedColor: color })}
                      className={`w-5 h-5 rounded border ${(shapeSettings.bleedColor || '#FFFFFF') === color ? 'ring-2 ring-cyan-500' : 'border-gray-300'}`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          </div>
        )}

        {/* Spot Colors Button & Panel - Visible in contour mode, shape mode, OR when PDF has CutContour */}
        {(strokeSettings.enabled || shapeSettings.enabled || (imageInfo?.isPDF && imageInfo?.pdfCutContourInfo?.hasCutContour)) && imageInfo && (
          <div className="border-b border-gray-100">
            <button
              onClick={handleSpotColorsToggle}
              className={`flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${showSpotColors ? 'bg-purple-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-medium text-gray-700">Spot Colors</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showSpotColors ? 'rotate-180' : ''}`} />
            </button>

            {showSpotColors && (
              <div className="px-4 pb-3 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-600 font-medium">Design Colors</div>
                <button
                  onClick={() => setSpotPreviewEnabled(!spotPreviewEnabled)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    spotPreviewEnabled 
                      ? 'bg-purple-100 text-purple-700 border border-purple-300' 
                      : 'bg-gray-100 text-gray-500 border border-gray-300 hover:bg-gray-200'
                  }`}
                  title={spotPreviewEnabled ? "Hide spot preview" : "Show spot preview"}
                >
                  {spotPreviewEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  Preview
                </button>
              </div>
              
              {extractedColors.length === 0 ? (
                <div className="text-xs text-gray-500 italic">No colors detected</div>
              ) : (
                <div className="space-y-2">
                  {extractedColors.map((color, index) => (
                    <div key={index} className="flex items-center gap-3 p-2 bg-white rounded border border-gray-200">
                      <div 
                        className="w-8 h-8 rounded border border-gray-300 flex-shrink-0"
                        style={{ backgroundColor: color.hex }}
                        title={color.hex}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-gray-700 truncate">{color.hex}</div>
                        <div className="text-[10px] text-gray-400">{color.percentage.toFixed(1)}%</div>
                      </div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <Checkbox
                            checked={color.spotWhite}
                            onCheckedChange={(checked) => updateSpotColor(index, 'spotWhite', checked as boolean)}
                          />
                          <span className="text-xs text-gray-600">White</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <Checkbox
                            checked={color.spotGloss}
                            onCheckedChange={(checked) => updateSpotColor(index, 'spotGloss', checked as boolean)}
                          />
                          <span className="text-xs text-gray-600">Gloss</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-200 space-y-1">
                <div className="flex items-center gap-1">
                  <span>White →</span>
                  {editingWhiteName ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tempWhiteName}
                        onChange={(e) => setTempWhiteName(e.target.value)}
                        className="w-24 px-1 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-700"
                        autoFocus
                        onBlur={() => {
                          setSpotWhiteName(tempWhiteName || "RDG_WHITE");
                          setEditingWhiteName(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSpotWhiteName(tempWhiteName || "RDG_WHITE");
                            setEditingWhiteName(false);
                          } else if (e.key === 'Escape') {
                            setEditingWhiteName(false);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          setSpotWhiteName(tempWhiteName || "RDG_WHITE");
                          setEditingWhiteName(false);
                        }}
                        className="p-0.5 hover:bg-green-100 rounded"
                        title="Save"
                      >
                        <Check className="w-3 h-3 text-green-600" />
                      </button>
                      <button
                        onClick={() => setEditingWhiteName(false)}
                        className="p-0.5 hover:bg-red-100 rounded"
                        title="Cancel"
                      >
                        <X className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-600">{spotWhiteName}</span>
                      <button
                        onClick={() => {
                          setTempWhiteName(spotWhiteName);
                          setEditingWhiteName(true);
                        }}
                        className="p-0.5 hover:bg-gray-200 rounded"
                        title="Edit name"
                      >
                        <Pencil className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span>Gloss →</span>
                  {editingGlossName ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tempGlossName}
                        onChange={(e) => setTempGlossName(e.target.value)}
                        className="w-24 px-1 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-700"
                        autoFocus
                        onBlur={() => {
                          setSpotGlossName(tempGlossName || "RDG_GLOSS");
                          setEditingGlossName(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSpotGlossName(tempGlossName || "RDG_GLOSS");
                            setEditingGlossName(false);
                          } else if (e.key === 'Escape') {
                            setEditingGlossName(false);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          setSpotGlossName(tempGlossName || "RDG_GLOSS");
                          setEditingGlossName(false);
                        }}
                        className="p-0.5 hover:bg-green-100 rounded"
                        title="Save"
                      >
                        <Check className="w-3 h-3 text-green-600" />
                      </button>
                      <button
                        onClick={() => setEditingGlossName(false)}
                        className="p-0.5 hover:bg-red-100 rounded"
                        title="Cancel"
                      >
                        <X className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-600">{spotGlossName}</span>
                      <button
                        onClick={() => {
                          setTempGlossName(spotGlossName);
                          setEditingGlossName(true);
                        }}
                        className="p-0.5 hover:bg-gray-200 rounded"
                        title="Edit name"
                      >
                        <Pencil className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Download Buttons */}
        <div className="px-4 py-3 space-y-2">
          <Button
            onClick={() => onDownload('standard', 'pdf', extractedColors.filter(c => c.spotWhite || c.spotGloss).map(c => ({
              ...c,
              spotWhiteName,
              spotGlossName
            })))}
            disabled={isProcessing || !canDownload || !imageInfo}
            className="w-full h-11 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-lg shadow-lg shadow-cyan-500/25 font-medium"
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

          {canDownload && imageInfo && (
            <Button
              variant="outline"
              onClick={() => onDownload('standard', 'pdf', extractedColors.filter(c => c.spotWhite || c.spotGloss).map(c => ({
                ...c,
                spotWhiteName,
                spotGlossName
              })), true)}
              disabled={isProcessing}
              className="w-full h-9 border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-sm"
            >
              <Download className="w-4 h-4 mr-2" />
              All Layers in 1 PDF
            </Button>
          )}
        </div>
      </div>

      {/* Confirm Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-white border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Confirm Send</DialogTitle>
            <DialogDescription className="text-gray-500">
              Send your design to {customerEmail}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button onClick={confirmAndSend} className="bg-green-600 hover:bg-green-700 text-white">Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
