import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { StrokeSettings, ResizeSettings, ImageInfo, ShapeSettings } from "./image-editor";

interface ControlsSectionProps {
  strokeSettings: StrokeSettings;
  resizeSettings: ResizeSettings;
  shapeSettings: ShapeSettings;
  onStrokeChange: (settings: Partial<StrokeSettings>) => void;
  onResizeChange: (settings: Partial<ResizeSettings>) => void;
  onShapeChange: (settings: Partial<ShapeSettings>) => void;
  onDownload: (downloadType?: 'standard' | 'highres' | 'vector' | 'cutcontour', format?: 'png' | 'pdf' | 'eps' | 'svg') => void;
  isProcessing: boolean;
  imageInfo: ImageInfo | null;
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
      <h2 className="text-lg font-semibold text-white mb-4">Adjustments</h2>
      <div className="space-y-6">


        {/* Shape Background Card */}
        <Card className={`border-2 transition-colors ${shapeSettings.enabled ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Shape Background</Label>
              <div className="text-sm text-green-600 font-medium">Always Enabled</div>
            </div>

            {true && (
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Shape Type</Label>
                  <Select
                    value={shapeSettings.type}
                    onValueChange={(value: 'square' | 'rectangle' | 'circle') => 
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
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Width (inches)</Label>
                  <Slider
                    value={[shapeSettings.widthInches]}
                    onValueChange={([value]) => onShapeChange({ widthInches: value })}
                    min={1}
                    max={12}
                    step={0.1}
                    className="mt-2"
                  />
                  <div className="text-sm text-gray-500 mt-1">
                    {shapeSettings.widthInches}"
                  </div>
                </div>

                {shapeSettings.type !== 'square' && (
                  <div>
                    <Label>Height (inches)</Label>
                    <Slider
                      value={[shapeSettings.heightInches]}
                      onValueChange={([value]) => onShapeChange({ heightInches: value })}
                      min={1}
                      max={12}
                      step={0.1}
                      className="mt-2"
                    />
                    <div className="text-sm text-gray-500 mt-1">
                      {shapeSettings.heightInches}"
                    </div>
                  </div>
                )}

                <div>
                  <Label>Image Size (inches)</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-xs text-gray-500">Width</Label>
                      <Slider
                        value={[resizeSettings.widthInches]}
                        onValueChange={([value]) => onResizeChange({ widthInches: value })}
                        min={0.5}
                        max={12}
                        step={0.1}
                        className="mt-1"
                      />
                      <div className="text-xs text-gray-500">
                        {resizeSettings.widthInches}"
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500">Height</Label>
                      <Slider
                        value={[resizeSettings.heightInches]}
                        onValueChange={([value]) => onResizeChange({ heightInches: value })}
                        min={0.5}
                        max={12}
                        step={0.1}
                        className="mt-1"
                      />
                      <div className="text-xs text-gray-500">
                        {resizeSettings.heightInches}"
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 mt-2">
                    <Checkbox
                      checked={resizeSettings.maintainAspectRatio}
                      onCheckedChange={(checked) => onResizeChange({ maintainAspectRatio: !!checked })}
                    />
                    <Label className="text-xs">Lock aspect ratio</Label>
                  </div>
                </div>

                <div>
                  <Label>Fill Color</Label>
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

                <div className="flex items-center justify-between">
                  <Label>Shape Stroke</Label>
                  <Checkbox
                    checked={shapeSettings.strokeEnabled}
                    onCheckedChange={(checked) => onShapeChange({ strokeEnabled: !!checked })}
                  />
                </div>

                {shapeSettings.strokeEnabled && (
                  <>
                    <div>
                      <Label>Stroke Width</Label>
                      <Slider
                        value={[shapeSettings.strokeWidth]}
                        onValueChange={([value]) => onShapeChange({ strokeWidth: value })}
                        min={1}
                        max={10}
                        step={1}
                        className="mt-2"
                      />
                      <div className="text-sm text-gray-500 mt-1">
                        {shapeSettings.strokeWidth}px
                      </div>
                    </div>

                    <div>
                      <Label>Stroke Color</Label>
                      <div className="flex items-center space-x-2 mt-2">
                        <input
                          type="color"
                          value={shapeSettings.strokeColor}
                          onChange={(e) => onShapeChange({ strokeColor: e.target.value })}
                          className="w-8 h-8 rounded border"
                        />
                        <span className="text-sm text-gray-600">{shapeSettings.strokeColor}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>





        {/* Download Section */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Download</h3>
            
            <div className="space-y-3">
              <Button 
                onClick={() => onDownload('cutcontour')}
                disabled={!imageInfo || isProcessing}
                className="w-full bg-blue-500 hover:bg-blue-600"
              >
                PNG file with cutlines
              </Button>
              
              <Button 
                onClick={() => onDownload('design-only')}
                disabled={!imageInfo || isProcessing}
                className="w-full"
                variant="outline"
              >
                Design without outlines
              </Button>

              <div className="text-xs text-gray-500 text-center">
                Full resolution PNG with transparent background.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
