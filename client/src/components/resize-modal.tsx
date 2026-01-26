import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ResizeModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (widthInches: number, heightInches: number) => void;
  detectedWidth: number;
  detectedHeight: number;
}

const PRESET_SIZES = [
  { label: "2 inch", value: 2 },
  { label: "2.5 inch", value: 2.5 },
  { label: "3 inch", value: 3 },
  { label: "3.5 inch", value: 3.5 },
  { label: "4 inch", value: 4 },
  { label: "4.5 inch", value: 4.5 },
  { label: "5 inch", value: 5 },
];

export default function ResizeModal({
  open,
  onClose,
  onConfirm,
  detectedWidth,
  detectedHeight,
}: ResizeModalProps) {
  const aspectRatio = detectedWidth / detectedHeight;
  
  const [selectedSize, setSelectedSize] = useState<number | null>(null);
  const [customWidth, setCustomWidth] = useState(detectedWidth.toFixed(2));
  const [customHeight, setCustomHeight] = useState(detectedHeight.toFixed(2));
  const [useCustom, setUseCustom] = useState(false);

  const handlePresetSelect = (size: number) => {
    setSelectedSize(size);
    setUseCustom(false);
    
    if (aspectRatio >= 1) {
      const newWidth = size;
      const newHeight = size / aspectRatio;
      setCustomWidth(newWidth.toFixed(2));
      setCustomHeight(newHeight.toFixed(2));
    } else {
      const newHeight = size;
      const newWidth = size * aspectRatio;
      setCustomWidth(newWidth.toFixed(2));
      setCustomHeight(newHeight.toFixed(2));
    }
  };

  const handleCustomWidthChange = (value: string) => {
    setCustomWidth(value);
    setUseCustom(true);
    setSelectedSize(null);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      setCustomHeight((numValue / aspectRatio).toFixed(2));
    }
  };

  const handleCustomHeightChange = (value: string) => {
    setCustomHeight(value);
    setUseCustom(true);
    setSelectedSize(null);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      setCustomWidth((numValue * aspectRatio).toFixed(2));
    }
  };

  const handleConfirm = () => {
    const width = parseFloat(customWidth);
    const height = parseFloat(customHeight);
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      onConfirm(width, height);
    }
  };

  const handleKeepOriginal = () => {
    onConfirm(detectedWidth, detectedHeight);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Your Design Size</DialogTitle>
          <DialogDescription>
            Your image has been uploaded. Choose the size for your sticker.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">Detected image size (empty space removed):</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {detectedWidth.toFixed(2)}" × {detectedHeight.toFixed(2)}"
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Choose a size:</Label>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_SIZES.map((preset) => (
                <Button
                  key={preset.value}
                  variant={selectedSize === preset.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetSelect(preset.value)}
                  className={selectedSize === preset.value ? "bg-cyan-600 hover:bg-cyan-700" : ""}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Or enter custom size:</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label className="text-xs text-gray-500">Width (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="12"
                  value={customWidth}
                  onChange={(e) => handleCustomWidthChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <span className="text-gray-500 mt-5">×</span>
              <div className="flex-1">
                <Label className="text-xs text-gray-500">Height (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="12"
                  value={customHeight}
                  onChange={(e) => handleCustomHeightChange(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Final size: <span className="font-semibold">{customWidth}" × {customHeight}"</span>
            </p>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleKeepOriginal}>
            Keep Original
          </Button>
          <Button onClick={handleConfirm} className="bg-cyan-600 hover:bg-cyan-700">
            Apply Size
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
