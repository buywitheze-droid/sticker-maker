import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { StrokeSettings, ResizeSettings, ImageInfo } from "./image-editor";

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onDownload: (highRes?: boolean) => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
}

export default function ControlsSection({
  strokeSettings,
  resizeSettings,
  onStrokeChange,
  onResizeChange,
  onDownload,
  isProcessing,
  imageInfo
}: ControlsSectionProps) {
  
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
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Adjustments</h2>
      
      <div className="space-y-6">
        {/* Stroke Controls */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">White Outline</h3>
            
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-gray-700 mb-2 block">Stroke Width</Label>
                <div className="flex items-center space-x-3">
                  <Slider
                    value={[strokeSettings.width]}
                    onValueChange={(value) => onStrokeChange({ width: value[0] })}
                    max={50}
                    min={0}
                    step={1}
                    className="flex-1"
                  />
                  <div className="flex items-center space-x-1 min-w-0">
                    <Input
                      type="number"
                      value={strokeSettings.width}
                      onChange={(e) => onStrokeChange({ width: parseInt(e.target.value) || 0 })}
                      min={0}
                      max={50}
                      className="w-16 text-sm"
                    />
                    <span className="text-sm text-gray-500">px</span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm text-gray-700 mb-2 block">Stroke Color</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="color"
                    value={strokeSettings.color}
                    onChange={(e) => onStrokeChange({ color: e.target.value })}
                    className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                  />
                  <span className="text-sm text-gray-600">White</span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="enableStroke"
                  checked={strokeSettings.enabled}
                  onCheckedChange={(checked) => onStrokeChange({ enabled: checked as boolean })}
                />
                <Label htmlFor="enableStroke" className="text-sm text-gray-700">
                  Enable outline
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resize Controls */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Resize</h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-gray-700 mb-1 block">Width (inches)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={resizeSettings.widthInches}
                    onChange={(e) => onResizeChange({ widthInches: parseFloat(e.target.value) || 0.1 })}
                  />
                </div>
                <div>
                  <Label className="text-sm text-gray-700 mb-1 block">Height (inches)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={resizeSettings.heightInches}
                    onChange={(e) => onResizeChange({ heightInches: parseFloat(e.target.value) || 0.1 })}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="maintainAspectRatio"
                  checked={resizeSettings.maintainAspectRatio}
                  onCheckedChange={(checked) => onResizeChange({ maintainAspectRatio: checked as boolean })}
                />
                <Label htmlFor="maintainAspectRatio" className="text-sm text-gray-700">
                  Lock aspect ratio
                </Label>
              </div>

              <div>
                <Label className="text-sm text-gray-700 mb-2 block">Output DPI</Label>
                <Select
                  value={resizeSettings.outputDPI.toString()}
                  onValueChange={(value) => onResizeChange({ outputDPI: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="72">72 DPI (Screen)</SelectItem>
                    <SelectItem value="150">150 DPI (Good Quality)</SelectItem>
                    <SelectItem value="300">300 DPI (Print Quality)</SelectItem>
                    <SelectItem value="600">600 DPI (High Quality)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                <div className="flex justify-between">
                  <span>Output pixels:</span>
                  <span>{outputInfo.pixels}</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated file size:</span>
                  <span>{outputInfo.estimatedSize}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Download Section */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Download</h3>
            
            <div className="space-y-3">
              <Button 
                onClick={() => onDownload(false)}
                disabled={!imageInfo || isProcessing}
                className="w-full bg-blue-500 hover:bg-blue-600"
              >
                Download PNG Sticker
              </Button>
              
              <Button 
                onClick={() => onDownload(true)}
                disabled={!imageInfo || isProcessing}
                className="w-full bg-emerald-500 hover:bg-emerald-600"
              >
                Download 300 DPI (Print Quality)
              </Button>

              <div className="text-xs text-gray-500 text-center">
                Downloads will have transparent background with white outline
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
