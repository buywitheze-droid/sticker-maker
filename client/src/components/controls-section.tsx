import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StrokeSettings, ResizeSettings, ImageInfo, ShapeSettings } from "./image-editor";
import { useToast } from "@/hooks/use-toast";
import { generateContourPDFBase64 } from "@/lib/contour-outline";
import { generateShapePDFBase64 } from "@/lib/shape-outline";

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onShapeChange: (settings: Partial<ShapeSettings>) => void;
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour' | 'design-only' | 'download-package', format?: 'png' | 'pdf' | 'eps' | 'svg') => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
}

export default function ControlsSection({
  strokeSettings,
  resizeSettings,
  shapeSettings,
  onStrokeChange,
  onResizeChange,
  onShapeChange,
  onDownload,
  isProcessing,
  imageInfo,
  canvasRef
}: ControlsSectionProps) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleSendDesign = async () => {
    if (!customerName.trim() || !customerEmail.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter your full name and email address.",
        variant: "destructive",
      });
      return;
    }

    if (!strokeSettings.enabled && !shapeSettings.enabled) {
      toast({
        title: "Outline Required",
        description: "Please select either Contour Outline or Shape Outline before sending.",
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
      formData.append('fileName', (imageInfo?.file?.name || "design").replace(/\.[^/.]+$/, '') + ".pdf");

      const response = await fetch("/api/send-design", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || "Failed to send design");
      }

      toast({
        title: "Design Sent!",
        description: "Your design has been sent successfully. We'll be in touch soon!",
      });

      setCustomerName("");
      setCustomerEmail("");
      setCustomerNotes("");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send design. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };
  
  const calculateOutputInfo = () => {
    const pixelWidth = Math.round(resizeSettings.widthInches * resizeSettings.outputDPI);
    const pixelHeight = Math.round(resizeSettings.heightInches * resizeSettings.outputDPI);
    const estimatedSize = (pixelWidth * pixelHeight * 4 / 1024 / 1024).toFixed(1);
    
    return {
      pixels: `${pixelWidth} × ${pixelHeight} px`,
      estimatedSize: `~${estimatedSize} MB`
    };
  };

  const outputInfo = calculateOutputInfo();

  return (
    <div className="lg:col-span-1">
      <h2 className="text-lg font-semibold text-white mb-4">Adjustments</h2>
      <div className="space-y-6">

        {/* Contour Outline Card */}
        <Card className={`border-2 transition-colors ${strokeSettings.enabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center space-x-3">
              <Checkbox 
                id="stroke-enabled"
                checked={strokeSettings.enabled}
                onCheckedChange={(checked) => onStrokeChange({ enabled: checked as boolean })}
              />
              <Label htmlFor="stroke-enabled" className="text-base font-medium">
                Contour Outline
              </Label>
            </div>
            
            {strokeSettings.enabled && (
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Contour Offset</Label>
                  <Select
                    value={strokeSettings.width.toString()}
                    onValueChange={(value) => onStrokeChange({ width: parseFloat(value) })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.02">Tiny (0.02")</SelectItem>
                      <SelectItem value="0.04">Small (0.04")</SelectItem>
                      <SelectItem value="0.07">Medium (0.07")</SelectItem>
                      <SelectItem value="0.14">Large (0.14")</SelectItem>
                      <SelectItem value="0.25">Huge (0.25")</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center space-x-3">
                  <Checkbox 
                    id="close-small-gaps"
                    checked={strokeSettings.closeSmallGaps}
                    onCheckedChange={(checked) => onStrokeChange({ closeSmallGaps: checked as boolean })}
                  />
                  <Label htmlFor="close-small-gaps" className="text-sm">
                    Close small gaps
                  </Label>
                </div>
                
                <div className="flex items-center space-x-3">
                  <Checkbox 
                    id="close-big-gaps"
                    checked={strokeSettings.closeBigGaps}
                    onCheckedChange={(checked) => onStrokeChange({ closeBigGaps: checked as boolean })}
                  />
                  <Label htmlFor="close-big-gaps" className="text-sm">
                    Close big gaps
                  </Label>
                </div>

                <div>
                  <Label>Sticker Background Color</Label>
                  <div className="flex items-center space-x-2 mt-2">
                    <input
                      type="color"
                      value={strokeSettings.fillColor}
                      onChange={(e) => onStrokeChange({ fillColor: e.target.value })}
                      className="w-8 h-8 rounded border"
                    />
                    <span className="text-sm text-gray-600">{strokeSettings.fillColor}</span>
                  </div>
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  This selected color is not a preview it will be printed
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shape Outline Card */}
        <Card className={`border-2 transition-colors ${shapeSettings.enabled ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center space-x-3">
              <Checkbox 
                id="shape-enabled"
                checked={shapeSettings.enabled}
                onCheckedChange={(checked) => onShapeChange({ enabled: checked as boolean })}
              />
              <Label htmlFor="shape-enabled" className="text-base font-medium">
                Shape Outline
              </Label>
            </div>

            {shapeSettings.enabled && (
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Shape Type</Label>
                  <Select
                    value={shapeSettings.type}
                    onValueChange={(value: 'square' | 'rectangle' | 'circle' | 'oval') => 
                      onShapeChange({ type: value })
                    }
                  >
                    <SelectTrigger>
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
                  <Label>Offset (margin around design)</Label>
                  <Select
                    value={shapeSettings.offset.toString()}
                    onValueChange={(value) => onShapeChange({ offset: parseFloat(value) })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(shapeSettings.type === 'circle' || shapeSettings.type === 'oval') ? (
                        <>
                          <SelectItem value="0.40">Tiny (0.40")</SelectItem>
                          <SelectItem value="0.48">Small (0.48")</SelectItem>
                          <SelectItem value="0.56">Medium (0.56")</SelectItem>
                          <SelectItem value="0.64">Big (0.64")</SelectItem>
                          <SelectItem value="0.72">Huge (0.72")</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="0.0625">Tiny (0.0625")</SelectItem>
                          <SelectItem value="0.125">Small (0.125")</SelectItem>
                          <SelectItem value="0.1875">Medium (0.1875")</SelectItem>
                          <SelectItem value="0.25">Big (0.25")</SelectItem>
                          <SelectItem value="0.375">Huge (0.375")</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    Shape size adjusts automatically based on your design
                  </p>
                </div>

                <div>
                  <Label>Sticker Background Color</Label>
                  <div className="flex items-center space-x-2 mt-2">
                    <input
                      type="color"
                      value={shapeSettings.fillColor}
                      onChange={(e) => onShapeChange({ fillColor: e.target.value })}
                      className="w-8 h-8 rounded border"
                    />
                    <span className="text-sm text-gray-600">{shapeSettings.fillColor}</span>
                  </div>
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  This selected color is not a preview it will be printed
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Send Design Section */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Send Design</h3>
            
            <div className="space-y-4">
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
                <Label htmlFor="customer-notes">Notes to add (optional)</Label>
                <textarea
                  id="customer-notes"
                  placeholder="Add any special instructions or notes..."
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  className="mt-1 w-full min-h-[80px] px-3 py-2 text-sm border rounded-md border-input bg-background resize-y"
                />
              </div>

              <Button 
                onClick={handleSendDesign}
                disabled={!imageInfo || isProcessing || isSending || !customerName.trim() || !customerEmail.trim() || (!strokeSettings.enabled && !shapeSettings.enabled)}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white"
              >
                {isSending ? "Sending..." : "Send Design"}
              </Button>
              
              <p className="text-xs text-gray-500 text-center pt-2">
                We'll save this file and match it to your order using the email provided here. You're all set to complete your order on our website! 😊
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Download Section */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Download</h3>
            
            <div className="space-y-3">
              <Button 
                onClick={() => onDownload('standard')}
                disabled={!imageInfo || isProcessing || (!strokeSettings.enabled && !shapeSettings.enabled)}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white"
              >Download PDF</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
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
            <Button onClick={confirmAndSend} className="bg-blue-500 hover:bg-blue-600">
              Confirm & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
