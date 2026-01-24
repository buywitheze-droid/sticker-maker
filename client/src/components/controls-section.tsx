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
import { Download, ChevronDown, Palette } from "lucide-react";

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  stickerSize: StickerSize;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onShapeChange: (settings: Partial<ShapeSettings>) => void;
  onStickerSizeChange: (size: StickerSize) => void;
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package', format?: 'png' | 'pdf' | 'eps' | 'svg', spotColors?: Array<{hex: string; rgb: {r: number; g: number; b: number}; spotWhite: boolean; spotGloss: boolean}>) => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  onStepChange?: (step: number) => void;
  onRemoveBackground?: (threshold: number) => void;
  isRemovingBackground?: boolean;
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
  isRemovingBackground
}: ControlsSectionProps) {
  const { toast } = useToast();
  const [showShapeAdvanced, setShowShapeAdvanced] = useState(false);
  const [showContourOptions, setShowContourOptions] = useState(true);
  const [showSpotColors, setShowSpotColors] = useState(false);
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);

  const canDownload = strokeSettings.enabled || shapeSettings.enabled;

  // Extract colors from original image (not preview canvas) to avoid contour/shape interference
  useEffect(() => {
    if (imageInfo?.image) {
      const colors = extractColorsFromImage(imageInfo.image, 9);
      setExtractedColors(colors);
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
    <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm">
      {/* Size Selection */}
      <div>
        <Label className="text-sm font-medium text-gray-700 mb-2 block">Size</Label>
        <Select
          value={stickerSize.toString()}
          onValueChange={(value) => onStickerSizeChange(parseFloat(value) as StickerSize)}
        >
          <SelectTrigger className="w-full bg-white border-gray-300 text-gray-900">
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
        
        {/* Dimensions display */}
        {imageInfo && (
          <div className="mt-2 text-xs text-gray-400">
            {resizeSettings.widthInches.toFixed(2)}" x {resizeSettings.heightInches.toFixed(2)}" @ {resizeSettings.outputDPI} DPI
          </div>
        )}
      </div>

      {/* Outline Type */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Outline Type</Label>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onStrokeChange({ enabled: true })}
            className={`py-2 px-4 rounded-md text-center transition-all font-medium text-sm ${
              strokeSettings.enabled 
                ? 'bg-cyan-600 text-white shadow-sm' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400'
            }`}
          >
            Contour
          </button>
          
          <button
            onClick={() => onShapeChange({ enabled: true })}
            className={`py-2 px-4 rounded-md text-center transition-all font-medium text-sm ${
              shapeSettings.enabled 
                ? 'bg-green-600 text-white shadow-sm' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400'
            }`}
          >
            Shape
          </button>
        </div>
      </div>

      {/* Contour Options */}
      {strokeSettings.enabled && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <button 
            onClick={handleContourOptionsToggle}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-sm font-medium text-gray-700">Contour Settings</span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showContourOptions ? 'rotate-180' : ''}`} />
          </button>
          
          {showContourOptions && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-gray-600">Thickness</Label>
                <Select
                  value={strokeSettings.width.toString()}
                  onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
                >
                  <SelectTrigger className="mt-1 bg-white border-gray-300 text-gray-900 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.02">Tiny</SelectItem>
                    <SelectItem value="0.04">Small</SelectItem>
                    <SelectItem value="0.07">Medium</SelectItem>
                    <SelectItem value="0.14">Large</SelectItem>
                    <SelectItem value="0.25">Huge</SelectItem>
                    <SelectItem value="0.5">XL</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="use-custom-background"
                    checked={strokeSettings.useCustomBackground}
                    onCheckedChange={(checked) => onStrokeChange({ useCustomBackground: checked as boolean })}
                  />
                  <Label htmlFor="use-custom-background" className="text-xs text-gray-600 cursor-pointer">Background</Label>
                  {strokeSettings.useCustomBackground && (
                    <div className="flex items-center gap-1 ml-auto">
                      <input
                        type="color"
                        value={strokeSettings.backgroundColor}
                        onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer border border-gray-300"
                      />
                      <span className="text-xs text-gray-500">{strokeSettings.backgroundColor}</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="close-small-gaps"
                    checked={strokeSettings.closeSmallGaps}
                    onCheckedChange={(checked) => onStrokeChange({ closeSmallGaps: checked as boolean })}
                  />
                  <Label htmlFor="close-small-gaps" className="text-xs text-gray-600 cursor-pointer">Close small gaps</Label>
                </div>
                
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="close-big-gaps"
                    checked={strokeSettings.closeBigGaps}
                    onCheckedChange={(checked) => onStrokeChange({ closeBigGaps: checked as boolean })}
                  />
                  <Label htmlFor="close-big-gaps" className="text-xs text-gray-600 cursor-pointer">Close big gaps</Label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spot Colors Button & Panel - Only visible in contour mode */}
      {strokeSettings.enabled && imageInfo && (
        <>
          <Button
            variant="outline"
            onClick={handleSpotColorsToggle}
            className={`w-full border-2 ${showSpotColors ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 text-gray-700 hover:border-purple-400'}`}
          >
            <Palette className="w-4 h-4 mr-2" />
            SPOT COLORS
            <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showSpotColors ? 'rotate-180' : ''}`} />
          </Button>

          {showSpotColors && (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-600 font-medium mb-2">Design Colors</div>
              
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

              <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-200">
                White → RDG_WHITE | Gloss → RDG_GLOSS
              </div>
            </div>
          )}
        </>
      )}

      {/* Shape Options */}
      {shapeSettings.enabled && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
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
            <Label className="text-xs text-gray-600">Padding</Label>
            <Select
              value={shapeSettings.offset.toString()}
              onValueChange={(value) => onShapeChange({ offset: parseFloat(value) })}
            >
              <SelectTrigger className="mt-1 bg-white border-gray-300 text-gray-900 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.0625">Tiny</SelectItem>
                <SelectItem value="0.125">Small</SelectItem>
                <SelectItem value="0.25">Medium</SelectItem>
                <SelectItem value="0.40">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-gray-600">Fill Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={shapeSettings.fillColor}
                onChange={(e) => onShapeChange({ fillColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-300"
              />
              <span className="text-xs text-gray-500">{shapeSettings.fillColor}</span>
            </div>
          </div>

          <button 
            onClick={() => setShowShapeAdvanced(!showShapeAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showShapeAdvanced ? 'rotate-180' : ''}`} />
            Advanced
          </button>

          {showShapeAdvanced && (
            <div className="space-y-3 pt-2 border-t border-gray-200">
              {/* Corner Radius for square/rectangle */}
              {(shapeSettings.type === 'square' || shapeSettings.type === 'rectangle') && (
                <div>
                  <Label className="text-xs text-gray-600">Corner Radius</Label>
                  <Select
                    value={shapeSettings.cornerRadius?.toString() || "0"}
                    onValueChange={(value) => onShapeChange({ cornerRadius: parseFloat(value) })}
                  >
                    <SelectTrigger className="mt-1 bg-white border-gray-300 text-gray-900 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">None</SelectItem>
                      <SelectItem value="0.125">Small</SelectItem>
                      <SelectItem value="0.25">Medium</SelectItem>
                      <SelectItem value="0.5">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Stroke Options */}
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="shape-stroke"
                  checked={shapeSettings.strokeEnabled}
                  onCheckedChange={(checked) => onShapeChange({ strokeEnabled: checked as boolean })}
                />
                <Label htmlFor="shape-stroke" className="text-xs text-gray-600 cursor-pointer">Add stroke</Label>
              </div>

              {shapeSettings.strokeEnabled && (
                <div className="space-y-2 pl-4">
                  <div>
                    <Label className="text-xs text-gray-600">Stroke Width (px)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={shapeSettings.strokeWidth}
                      onChange={(e) => onShapeChange({ strokeWidth: parseInt(e.target.value) || 2 })}
                      className="mt-1 bg-white border-gray-300 text-gray-900 text-sm h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Stroke Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={shapeSettings.strokeColor}
                        onChange={(e) => onShapeChange({ strokeColor: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                      />
                      <span className="text-xs text-gray-500">{shapeSettings.strokeColor}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Download Button */}
      <Button
        onClick={() => onDownload('standard', 'pdf', extractedColors.filter(c => c.spotWhite || c.spotGloss))}
        disabled={isProcessing || !canDownload || !imageInfo}
        className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
      >
        {isProcessing ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
            Processing...
          </>
        ) : (
          <>
            <Download className="w-4 h-4 mr-2" />
            Download
          </>
        )}
      </Button>

      {/* Send Form */}
      {canDownload && imageInfo && (
        <>
          {!showSendForm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSendForm(true)}
              className="w-full border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              Send to Print Shop
            </Button>
          ) : (
            <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <Input
                placeholder="Your Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="bg-white border-gray-300 text-gray-900 text-sm"
              />
              <Input
                placeholder="Email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="bg-white border-gray-300 text-gray-900 text-sm"
              />
              <Input
                placeholder="Notes (optional)"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                className="bg-white border-gray-300 text-gray-900 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSendDesign}
                  disabled={isSending}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                >
                  {isSending ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSendForm(false)}
                  className="text-gray-500"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}

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
