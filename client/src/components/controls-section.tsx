import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { ChevronLeft, ChevronRight, Upload, Ruler, Shapes, Download, Check, HelpCircle, ChevronDown, Sparkles, PartyPopper } from "lucide-react";

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
}

type WizardStep = 1 | 2 | 3 | 4;

const STEPS = [
  { number: 1, label: "Upload", icon: Upload },
  { number: 2, label: "Size", icon: Ruler },
  { number: 3, label: "Outline", icon: Shapes },
  { number: 4, label: "Finish", icon: Download },
];

const Tooltip = ({ text }: { text: string }) => (
  <div className="group relative inline-block ml-1">
    <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
    </div>
  </div>
);

const ProgressSummary = ({ 
  imageInfo, 
  stickerSize, 
  strokeSettings, 
  shapeSettings,
  currentStep 
}: { 
  imageInfo: ImageInfo | null;
  stickerSize: StickerSize;
  strokeSettings: StrokeSettings;
  shapeSettings: ShapeSettings;
  currentStep: number;
}) => {
  if (currentStep === 1) return null;
  
  const items = [];
  if (imageInfo && currentStep > 1) {
    items.push({ label: "Image", value: imageInfo.file.name.slice(0, 15) + (imageInfo.file.name.length > 15 ? "..." : "") });
  }
  if (currentStep > 2) {
    items.push({ label: "Size", value: `${stickerSize}"` });
  }
  if (currentStep > 3) {
    if (strokeSettings.enabled) {
      items.push({ label: "Outline", value: "Contour" });
    } else if (shapeSettings.enabled) {
      items.push({ label: "Outline", value: shapeSettings.type.charAt(0).toUpperCase() + shapeSettings.type.slice(1) });
    }
  }
  
  if (items.length === 0) return null;
  
  return (
    <div className="bg-gray-100 rounded-lg p-2 mb-4 flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs bg-white px-2 py-1 rounded border flex items-center gap-1">
          <Check className="w-3 h-3 text-green-500" />
          <span className="text-gray-500">{item.label}:</span>
          <span className="font-medium">{item.value}</span>
        </span>
      ))}
    </div>
  );
};

const CelebrationAnimation = () => {
  const [show, setShow] = useState(true);
  
  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(timer);
  }, []);
  
  if (!show) return null;
  
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="absolute animate-bounce"
          style={{
            left: `${10 + (i * 8)}%`,
            top: `${Math.random() * 30}%`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: `${0.5 + Math.random() * 0.5}s`
          }}
        >
          <Sparkles className={`w-4 h-4 ${i % 3 === 0 ? 'text-yellow-400' : i % 3 === 1 ? 'text-cyan-400' : 'text-pink-400'}`} />
        </div>
      ))}
    </div>
  );
};

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
  onStepChange
}: ControlsSectionProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStepInternal] = useState<WizardStep>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  
  const setCurrentStep = (step: WizardStep) => {
    if (step === 4 && currentStep !== 4) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 2500);
    }
    setCurrentStepInternal(step);
    onStepChange?.(step);
  };
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);

  const canProceedToStep2 = !!imageInfo;
  const canProceedToStep3 = canProceedToStep2;
  const canProceedToStep4 = canProceedToStep3 && (strokeSettings.enabled || shapeSettings.enabled);

  // Auto-advance to step 2 after image upload
  useEffect(() => {
    if (imageInfo && currentStep === 1) {
      setCurrentStep(2);
    }
  }, [imageInfo]);

  // Track if user has manually selected a size (to auto-advance only on user action)
  const [hasSelectedSize, setHasSelectedSize] = useState(false);
  
  const handleSizeChange = (value: string) => {
    onStickerSizeChange(parseFloat(value) as StickerSize);
    // Auto-advance to step 3 when user picks a size
    if (currentStep === 2) {
      setTimeout(() => setCurrentStep(3), 150); // Small delay for visual feedback
    }
  };

  const goToStep = (step: WizardStep) => {
    if (step === 2 && !canProceedToStep2) return;
    if (step === 3 && !canProceedToStep3) return;
    if (step === 4 && !canProceedToStep4) return;
    setCurrentStep(step);
  };

  const nextStep = () => {
    if (currentStep < 4) {
      goToStep((currentStep + 1) as WizardStep);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as WizardStep);
    }
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
          const result = await generateContourPDFBase64(imageInfo.image, strokeSettings, resizeSettings);
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

  const StepIndicator = () => (
    <div className="flex items-center justify-between mb-4">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isActive = currentStep === step.number;
        const isCompleted = currentStep > step.number;
        const isClickable = 
          step.number === 1 || 
          (step.number === 2 && canProceedToStep2) ||
          (step.number === 3 && canProceedToStep3) ||
          (step.number === 4 && canProceedToStep4);

        return (
          <div key={step.number} className="flex items-center">
            <button
              onClick={() => isClickable && goToStep(step.number as WizardStep)}
              disabled={!isClickable}
              className={`flex flex-col items-center ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                isActive ? 'bg-cyan-500 text-white scale-110 shadow-lg' :
                isCompleted ? 'bg-green-500 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </div>
              <span className={`text-xs mt-1 ${isActive ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
                {step.label}
              </span>
            </button>
            {index < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 mx-1 transition-colors ${currentStep > step.number ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  const renderStep1 = () => (
    <Card className="border-2 border-cyan-500">
      <CardContent className="p-6 text-center">
        <Upload className="w-12 h-12 mx-auto text-cyan-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Upload Your Image</h3>
        <p className="text-gray-600 mb-4">
          Drag and drop your PNG image into the preview area, or click to browse.
        </p>
        {imageInfo ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <Check className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-green-700 font-medium">Image uploaded!</p>
            <p className="text-sm text-green-600">{imageInfo.file.name}</p>
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-left">
            <p className="text-sm text-blue-700 font-medium mb-1">Tips for best results:</p>
            <ul className="text-xs text-blue-600 space-y-1">
              <li>• Use PNG format with transparent background</li>
              <li>• Higher resolution = better print quality</li>
              <li>• Simple shapes work best for contour cutting</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderStep2 = () => (
    <Card className="border-2 border-cyan-500">
      <CardContent className="p-6">
        <Ruler className="w-10 h-10 text-cyan-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Choose Sticker Size</h3>
        <p className="text-gray-600 mb-4">
          Pick the size that fits your needs.
        </p>
        <Select
          value={stickerSize.toString()}
          onValueChange={handleSizeChange}
        >
          <SelectTrigger className="w-full text-lg py-6">
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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
          <p className="text-xs text-amber-700">
            <strong>Tip:</strong> This is the maximum width or height. Your design keeps its proportions and fits within this size.
          </p>
        </div>
      </CardContent>
    </Card>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold">Choose Outline Type</h3>
        <p className="text-sm text-gray-500">This determines how your sticker will be cut</p>
      </div>
      
      <Card 
        className={`border-2 transition-all cursor-pointer hover:shadow-md ${
          strokeSettings.enabled ? 'border-cyan-500 bg-cyan-50 shadow-md' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => { onStrokeChange({ enabled: true }); setShowAdvanced(false); }}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              strokeSettings.enabled ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300'
            }`}>
              {strokeSettings.enabled && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Label className="text-base font-medium cursor-pointer">Contour Outline</Label>
                <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded">Most Popular</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">Cut follows your design's shape exactly</p>
              
              <div className="flex items-center gap-4 mt-3 p-2 bg-white rounded border">
                <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
                  <div className="w-8 h-6 bg-cyan-400 rounded-sm relative">
                    <div className="absolute -inset-1 border-2 border-dashed border-red-400 rounded-md" />
                  </div>
                </div>
                <p className="text-xs text-gray-500">The cut line traces around your design with a small margin</p>
              </div>
            </div>
          </div>
          
          {strokeSettings.enabled && (
            <div className="mt-4 pt-4 border-t space-y-4">
              <div>
                <div className="flex items-center">
                  <Label className="text-sm">Outline Thickness</Label>
                  <Tooltip text="Controls the margin between your design and the cut line" />
                </div>
                <Select
                  value={strokeSettings.width.toString()}
                  onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.02">Tiny (very close to design)</SelectItem>
                    <SelectItem value="0.04">Small</SelectItem>
                    <SelectItem value="0.07">Medium</SelectItem>
                    <SelectItem value="0.14">Large (recommended)</SelectItem>
                    <SelectItem value="0.25">Huge</SelectItem>
                    <SelectItem value="0.5">Extra Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm">Background Color</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <input
                    type="color"
                    value={strokeSettings.backgroundColor}
                    onChange={(e) => onStrokeChange({ backgroundColor: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-300"
                  />
                  <span className="text-sm text-gray-600">{strokeSettings.backgroundColor}</span>
                </div>
              </div>
              
              <button 
                onClick={(e) => { e.stopPropagation(); setShowAdvanced(!showAdvanced); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                Advanced Options
              </button>
              
              {showAdvanced && (
                <div className="space-y-3 pl-2 border-l-2 border-gray-200">
                  <div className="flex items-center space-x-3">
                    <Checkbox 
                      id="close-small-gaps"
                      checked={strokeSettings.closeSmallGaps}
                      onCheckedChange={(checked) => onStrokeChange({ closeSmallGaps: checked as boolean })}
                    />
                    <div>
                      <Label htmlFor="close-small-gaps" className="text-sm cursor-pointer">Close small gaps</Label>
                      <p className="text-xs text-gray-400">Connects nearby parts of your design</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <Checkbox 
                      id="close-big-gaps"
                      checked={strokeSettings.closeBigGaps}
                      onCheckedChange={(checked) => onStrokeChange({ closeBigGaps: checked as boolean })}
                    />
                    <div>
                      <Label htmlFor="close-big-gaps" className="text-sm cursor-pointer">Close big gaps</Label>
                      <p className="text-xs text-gray-400">Creates bridges between separated elements</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card 
        className={`border-2 transition-all cursor-pointer hover:shadow-md ${
          shapeSettings.enabled ? 'border-green-500 bg-green-50 shadow-md' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => { onShapeChange({ enabled: true }); setShowAdvanced(false); }}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              shapeSettings.enabled ? 'border-green-500 bg-green-500' : 'border-gray-300'
            }`}>
              {shapeSettings.enabled && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="flex-1">
              <Label className="text-base font-medium cursor-pointer">Shape Outline</Label>
              <p className="text-sm text-gray-500 mt-1">Cut in a simple geometric shape</p>
              
              <div className="flex items-center gap-3 mt-3 p-2 bg-white rounded border">
                <div className="flex gap-2">
                  <div className="w-8 h-8 border-2 border-dashed border-red-400 rounded-sm" />
                  <div className="w-8 h-8 border-2 border-dashed border-red-400 rounded-full" />
                </div>
                <p className="text-xs text-gray-500">Choose square, rectangle, circle, or oval</p>
              </div>
            </div>
          </div>
          
          {shapeSettings.enabled && (
            <div className="mt-4 pt-4 border-t space-y-4">
              <div>
                <Label className="text-sm">Shape Type</Label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {(['square', 'rectangle', 'circle', 'oval'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={(e) => { e.stopPropagation(); onShapeChange({ type }); }}
                      className={`p-2 border-2 rounded-lg transition-all ${
                        shapeSettings.type === type 
                          ? 'border-green-500 bg-green-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`mx-auto ${
                        type === 'square' ? 'w-6 h-6 bg-green-300 rounded-sm' :
                        type === 'rectangle' ? 'w-8 h-5 bg-green-300 rounded-sm' :
                        type === 'circle' ? 'w-6 h-6 bg-green-300 rounded-full' :
                        'w-8 h-5 bg-green-300 rounded-full'
                      }`} />
                      <p className="text-xs mt-1 capitalize">{type}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center">
                  <Label className="text-sm">Margin Around Design</Label>
                  <Tooltip text="Space between your design and the edge of the shape" />
                </div>
                <Select
                  value={shapeSettings.offset.toString()}
                  onValueChange={(value) => onShapeChange({ offset: parseFloat(value) })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(shapeSettings.type === 'circle' || shapeSettings.type === 'oval') ? (
                      <>
                        <SelectItem value="0.40">Tiny</SelectItem>
                        <SelectItem value="0.48">Small</SelectItem>
                        <SelectItem value="0.56">Medium</SelectItem>
                        <SelectItem value="0.64">Big (recommended)</SelectItem>
                        <SelectItem value="0.72">Huge</SelectItem>
                        <SelectItem value="1.44">Extra Large</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="0.0625">Tiny</SelectItem>
                        <SelectItem value="0.125">Small</SelectItem>
                        <SelectItem value="0.1875">Medium</SelectItem>
                        <SelectItem value="0.25">Big (recommended)</SelectItem>
                        <SelectItem value="0.375">Huge</SelectItem>
                        <SelectItem value="0.75">Extra Large</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm">Background Color</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <input
                    type="color"
                    value={shapeSettings.fillColor}
                    onChange={(e) => onShapeChange({ fillColor: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-300"
                  />
                  <span className="text-sm text-gray-600">{shapeSettings.fillColor}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4 relative">
      {showCelebration && <CelebrationAnimation />}
      
      <Card className="border-2 border-green-500 bg-gradient-to-br from-green-50 to-cyan-50">
        <CardContent className="p-6 text-center">
          <div className="relative inline-block">
            <PartyPopper className="w-12 h-12 text-green-500 mx-auto mb-2" />
          </div>
          <h3 className="text-xl font-bold text-green-700 mb-2">Your Sticker is Ready!</h3>
          <p className="text-gray-600 mb-4">
            Great job! Download your print-ready PDF below.
          </p>
          
          <Button 
            onClick={() => onDownload('standard')}
            disabled={isProcessing}
            className="w-full bg-green-500 hover:bg-green-600 text-white text-lg py-6 mb-3 shadow-lg"
          >
            <Download className="w-5 h-5 mr-2" />
            Download PDF
          </Button>

          <Button
            variant="outline"
            onClick={() => setShowSendForm(!showSendForm)}
            className="w-full"
          >
            {showSendForm ? 'Hide Send Form' : 'Or Send Design to Us'}
          </Button>
        </CardContent>
      </Card>

      {showSendForm && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <Label htmlFor="customer-name">Full Name</Label>
              <Input
                id="customer-name"
                type="text"
                placeholder="Enter your full name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="customer-email">Email Address</Label>
              <Input
                id="customer-email"
                type="email"
                placeholder="Enter your email address"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="customer-notes">Notes (optional)</Label>
              <textarea
                id="customer-notes"
                placeholder="Add any special instructions..."
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                className="mt-1 w-full min-h-[60px] px-3 py-2 text-sm border rounded-md border-input bg-background resize-y"
              />
            </div>

            <Button 
              onClick={handleSendDesign}
              disabled={isSending || !customerName.trim() || !customerEmail.trim()}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black"
            >
              {isSending ? "Sending..." : "Send Design"}
            </Button>
            
            <p className="text-xs text-gray-500 text-center">
              We'll match your design to your order using the email provided.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );

  return (
    <div className="lg:col-span-1">
      <StepIndicator />
      <ProgressSummary 
        imageInfo={imageInfo}
        stickerSize={stickerSize}
        strokeSettings={strokeSettings}
        shapeSettings={shapeSettings}
        currentStep={currentStep}
      />
      
      <div className="min-h-[300px]">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
      </div>

      <div className="flex justify-between mt-6">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 1}
          className="flex items-center"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        
        {currentStep < 4 && (
          <Button
            onClick={nextStep}
            disabled={
              (currentStep === 1 && !canProceedToStep2) ||
              (currentStep === 2 && !canProceedToStep3) ||
              (currentStep === 3 && !canProceedToStep4)
            }
            className="flex items-center bg-cyan-500 hover:bg-cyan-600 text-black"
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Submission</DialogTitle>
            <DialogDescription>
              You're about to send your design for processing. Please confirm that:
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-gray-600">
              <li>Your design and outline look correct</li>
              <li>Your name and email are correct</li>
              <li>You're ready to submit this design</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAndSend} className="bg-cyan-500 hover:bg-cyan-600 text-black">
              Confirm & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
