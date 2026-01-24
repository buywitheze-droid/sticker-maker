import { useState } from "react";
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
import { Download, ChevronDown, Sparkles } from "lucide-react";

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  stickerSize: StickerSize;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onShapeChange: (settings: Partial<ShapeSettings>) => void;
  onStickerSizeChange: (size: StickerSize) => void;
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package', format?: 'png' | 'pdf' | 'eps' | 'svg') => void;
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showShapeAdvanced, setShowShapeAdvanced] = useState(false);
  const [exportFormat, setExportFormat] = useState<'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package'>('standard');
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);

  const canDownload = strokeSettings.enabled || shapeSettings.enabled;

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
    <div className="space-y-4 p-4">
      {/* Size Selection */}
      <div>
        <Label className="text-sm font-medium text-gray-300 mb-2 block">Size</Label>
        <Select
          value={stickerSize.toString()}
          onValueChange={(value) => onStickerSizeChange(parseFloat(value) as StickerSize)}
        >
          <SelectTrigger className="w-full bg-gray-800 border-gray-700 text-white">
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
          <div className="mt-2 text-xs text-gray-500">
            {resizeSettings.widthInches.toFixed(2)}" x {resizeSettings.heightInches.toFixed(2)}" @ {resizeSettings.outputDPI} DPI
          </div>
        )}
      </div>

      {/* Remove Background */}
      {imageInfo && onRemoveBackground && (
        <Button
          onClick={() => onRemoveBackground(95)}
          disabled={isRemovingBackground}
          variant="outline"
          size="sm"
          className="w-full border-purple-500/50 text-purple-300 hover:bg-purple-500/20"
        >
          {isRemovingBackground ? (
            <>
              <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-2" />
              Removing...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3 mr-2" />
              Remove White BG
            </>
          )}
        </Button>
      )}

      {/* Outline Type */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-300">Outline Type</Label>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onStrokeChange({ enabled: true })}
            className={`p-3 rounded-lg border-2 text-left transition-all ${
              strokeSettings.enabled 
                ? 'border-cyan-500 bg-cyan-500/10 text-white' 
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
            }`}
          >
            <span className="text-sm font-medium">Contour</span>
          </button>
          
          <button
            onClick={() => onShapeChange({ enabled: true })}
            className={`p-3 rounded-lg border-2 text-left transition-all ${
              shapeSettings.enabled 
                ? 'border-green-500 bg-green-500/10 text-white' 
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
            }`}
          >
            <span className="text-sm font-medium">Shape</span>
          </button>
        </div>
      </div>

      {/* Contour Options */}
      {strokeSettings.enabled && (
        <div className="space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div>
            <Label className="text-xs text-gray-400">Thickness</Label>
            <Select
              value={strokeSettings.width.toString()}
              onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
            >
              <SelectTrigger className="mt-1 bg-gray-900 border-gray-700 text-white text-sm">
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
            <Label className="text-xs text-gray-400">Background</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={strokeSettings.backgroundColor}
                onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-600"
              />
              <span className="text-xs text-gray-500">{strokeSettings.backgroundColor}</span>
            </div>
          </div>
          
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced
          </button>
          
          {showAdvanced && (
            <div className="space-y-2 pt-2 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="close-small-gaps"
                  checked={strokeSettings.closeSmallGaps}
                  onCheckedChange={(checked) => onStrokeChange({ closeSmallGaps: checked as boolean })}
                />
                <Label htmlFor="close-small-gaps" className="text-xs text-gray-400 cursor-pointer">Close small gaps</Label>
              </div>
              
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="close-big-gaps"
                  checked={strokeSettings.closeBigGaps}
                  onCheckedChange={(checked) => onStrokeChange({ closeBigGaps: checked as boolean })}
                />
                <Label htmlFor="close-big-gaps" className="text-xs text-gray-400 cursor-pointer">Close big gaps</Label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shape Options */}
      {shapeSettings.enabled && (
        <div className="space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div>
            <Label className="text-xs text-gray-400">Shape</Label>
            <Select
              value={shapeSettings.type}
              onValueChange={(value) => onShapeChange({ type: value as ShapeSettings['type'] })}
            >
              <SelectTrigger className="mt-1 bg-gray-900 border-gray-700 text-white text-sm">
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
            <Label className="text-xs text-gray-400">Padding</Label>
            <Select
              value={shapeSettings.offset.toString()}
              onValueChange={(value) => onShapeChange({ offset: parseFloat(value) })}
            >
              <SelectTrigger className="mt-1 bg-gray-900 border-gray-700 text-white text-sm">
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
            <Label className="text-xs text-gray-400">Fill Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={shapeSettings.fillColor}
                onChange={(e) => onShapeChange({ fillColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-gray-600"
              />
              <span className="text-xs text-gray-500">{shapeSettings.fillColor}</span>
            </div>
          </div>

          <button 
            onClick={() => setShowShapeAdvanced(!showShapeAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showShapeAdvanced ? 'rotate-180' : ''}`} />
            Advanced
          </button>

          {showShapeAdvanced && (
            <div className="space-y-3 pt-2 border-t border-gray-700">
              {/* Corner Radius for square/rectangle */}
              {(shapeSettings.type === 'square' || shapeSettings.type === 'rectangle') && (
                <div>
                  <Label className="text-xs text-gray-400">Corner Radius</Label>
                  <Select
                    value={shapeSettings.cornerRadius?.toString() || "0"}
                    onValueChange={(value) => onShapeChange({ cornerRadius: parseFloat(value) })}
                  >
                    <SelectTrigger className="mt-1 bg-gray-900 border-gray-700 text-white text-sm">
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
                <Label htmlFor="shape-stroke" className="text-xs text-gray-400 cursor-pointer">Add stroke</Label>
              </div>

              {shapeSettings.strokeEnabled && (
                <div className="space-y-2 pl-4">
                  <div>
                    <Label className="text-xs text-gray-400">Stroke Width (px)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={shapeSettings.strokeWidth}
                      onChange={(e) => onShapeChange({ strokeWidth: parseInt(e.target.value) || 2 })}
                      className="mt-1 bg-gray-900 border-gray-700 text-white text-sm h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Stroke Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={shapeSettings.strokeColor}
                        onChange={(e) => onShapeChange({ strokeColor: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border border-gray-600"
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

      {/* Export Options */}
      {canDownload && imageInfo && (
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">Export</Label>
          <Select
            value={exportFormat}
            onValueChange={(value) => setExportFormat(value as typeof exportFormat)}
          >
            <SelectTrigger className="bg-gray-900 border-gray-700 text-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">PDF (Print Ready)</SelectItem>
              <SelectItem value="highres">High Resolution PNG</SelectItem>
              <SelectItem value="vector">SVG Vector</SelectItem>
              <SelectItem value="cutcontour">Cut Contour Only</SelectItem>
              <SelectItem value="design-only">Design Only</SelectItem>
              <SelectItem value="download-package">Full Package (ZIP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Download Button */}
      <Button
        onClick={() => onDownload(exportFormat, exportFormat === 'vector' ? 'svg' : 'pdf')}
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
              className="w-full border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Send to Print Shop
            </Button>
          ) : (
            <div className="space-y-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <Input
                placeholder="Your Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white text-sm"
              />
              <Input
                placeholder="Email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white text-sm"
              />
              <Input
                placeholder="Notes (optional)"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSendDesign}
                  disabled={isSending}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {isSending ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSendForm(false)}
                  className="text-gray-400"
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
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Confirm Send</DialogTitle>
            <DialogDescription className="text-gray-400">
              Send your design to {customerEmail}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button onClick={confirmAndSend} className="bg-green-600 hover:bg-green-700">Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
