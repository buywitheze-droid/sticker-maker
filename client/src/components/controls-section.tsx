import { useState } from "react";
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
import { ChevronLeft, ChevronRight, Upload, Ruler, Shapes, Download, Check } from "lucide-react";

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
  
  const setCurrentStep = (step: WizardStep) => {
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
    <div className="flex items-center justify-between mb-6">
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
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isActive ? 'bg-cyan-500 text-white' :
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
              <div className={`w-8 h-0.5 mx-1 ${currentStep > step.number ? 'bg-green-500' : 'bg-gray-200'}`} />
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
          Drag and drop your PNG image into the preview area on the left, or click to browse.
        </p>
        {imageInfo ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <Check className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-green-700 font-medium">Image uploaded!</p>
            <p className="text-sm text-green-600">{imageInfo.file.name}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Supported format: PNG with transparency</p>
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
          Select the maximum width or height for your sticker.
        </p>
        <Select
          value={stickerSize.toString()}
          onValueChange={(value) => onStickerSizeChange(parseFloat(value) as StickerSize)}
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
        <p className="text-xs text-gray-500 mt-3 text-center">
          Your design will be resized to fit within this dimension
        </p>
      </CardContent>
    </Card>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-center mb-4">Choose Outline Type</h3>
      
      <Card 
        className={`border-2 transition-all cursor-pointer hover:shadow-md ${
          strokeSettings.enabled ? 'border-cyan-500 bg-cyan-50' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => onStrokeChange({ enabled: true })}
      >
        <CardContent className="p-4">
          <div className="flex items-center space-x-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              strokeSettings.enabled ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300'
            }`}>
              {strokeSettings.enabled && <Check className="w-3 h-3 text-white" />}
            </div>
            <div>
              <Label className="text-base font-medium cursor-pointer">Contour Outline</Label>
              <p className="text-sm text-gray-500">Follows the shape of your design</p>
            </div>
          </div>
          
          {strokeSettings.enabled && (
            <div className="mt-4 pt-4 border-t space-y-4">
              <div>
                <Label className="text-sm">Contour Offset</Label>
                <Select
                  value={strokeSettings.width.toString()}
                  onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.02">Tiny</SelectItem>
                    <SelectItem value="0.04">Small</SelectItem>
                    <SelectItem value="0.07">Medium</SelectItem>
                    <SelectItem value="0.14">Large</SelectItem>
                    <SelectItem value="0.25">Huge</SelectItem>
                    <SelectItem value="0.5">More bigger</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center space-x-3">
                <Checkbox 
                  id="close-small-gaps"
                  checked={strokeSettings.closeSmallGaps}
                  onCheckedChange={(checked) => onStrokeChange({ closeSmallGaps: checked as boolean })}
                />
                <Label htmlFor="close-small-gaps" className="text-sm cursor-pointer">Close small gaps</Label>
              </div>
              
              <div className="flex items-center space-x-3">
                <Checkbox 
                  id="close-big-gaps"
                  checked={strokeSettings.closeBigGaps}
                  onCheckedChange={(checked) => onStrokeChange({ closeBigGaps: checked as boolean })}
                />
                <Label htmlFor="close-big-gaps" className="text-sm cursor-pointer">Close big gaps</Label>
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
            </div>
          )}
        </CardContent>
      </Card>

      <Card 
        className={`border-2 transition-all cursor-pointer hover:shadow-md ${
          shapeSettings.enabled ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => onShapeChange({ enabled: true })}
      >
        <CardContent className="p-4">
          <div className="flex items-center space-x-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              shapeSettings.enabled ? 'border-green-500 bg-green-500' : 'border-gray-300'
            }`}>
              {shapeSettings.enabled && <Check className="w-3 h-3 text-white" />}
            </div>
            <div>
              <Label className="text-base font-medium cursor-pointer">Shape Outline</Label>
              <p className="text-sm text-gray-500">Square, rectangle, circle, or oval</p>
            </div>
          </div>
          
          {shapeSettings.enabled && (
            <div className="mt-4 pt-4 border-t space-y-4">
              <div>
                <Label className="text-sm">Shape Type</Label>
                <Select
                  value={shapeSettings.type}
                  onValueChange={(value: 'square' | 'rectangle' | 'circle' | 'oval') => 
                    onShapeChange({ type: value })
                  }
                >
                  <SelectTrigger className="mt-1">
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
                <Label className="text-sm">Margin Around Design</Label>
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
                        <SelectItem value="0.64">Big</SelectItem>
                        <SelectItem value="0.72">Huge</SelectItem>
                        <SelectItem value="1.44">More bigger</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="0.0625">Tiny</SelectItem>
                        <SelectItem value="0.125">Small</SelectItem>
                        <SelectItem value="0.1875">Medium</SelectItem>
                        <SelectItem value="0.25">Big</SelectItem>
                        <SelectItem value="0.375">Huge</SelectItem>
                        <SelectItem value="0.75">More bigger</SelectItem>
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
    <div className="space-y-4">
      <Card className="border-2 border-cyan-500">
        <CardContent className="p-6 text-center">
          <Download className="w-10 h-10 text-cyan-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Your Sticker is Ready!</h3>
          <p className="text-gray-600 mb-4">
            Download your print-ready PDF or send it directly to us.
          </p>
          
          <Button 
            onClick={() => onDownload('standard')}
            disabled={isProcessing}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-black text-lg py-6 mb-3"
          >
            <Download className="w-5 h-5 mr-2" />
            Download PDF
          </Button>

          <Button
            variant="outline"
            onClick={() => setShowSendForm(!showSendForm)}
            className="w-full"
          >
            {showSendForm ? 'Hide Send Form' : 'Send Design to Us'}
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
