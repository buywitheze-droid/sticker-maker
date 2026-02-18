import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ResizeModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (widthInches: number, heightInches: number) => void;
  detectedWidth: number;
  detectedHeight: number;
}

const QUICK_SIZES = [
  { label: '2"', value: 2 },
  { label: '3"', value: 3 },
  { label: '4"', value: 4 },
  { label: '5"', value: 5 },
];

export default function ResizeModal({
  open,
  onClose,
  onConfirm,
  detectedWidth,
  detectedHeight,
}: ResizeModalProps) {
  const aspectRatio = detectedWidth / detectedHeight;
  
  const [customSize, setCustomSize] = useState("3");

  useEffect(() => {
    if (open) {
      setCustomSize("3");
    }
  }, [open]);

  const handleSizeSelect = (size: number) => {
    let width: number, height: number;
    if (aspectRatio >= 1) {
      width = size;
      height = size / aspectRatio;
    } else {
      height = size;
      width = size * aspectRatio;
    }
    onConfirm(width, height);
  };

  const handleCustomConfirm = () => {
    const size = parseFloat(customSize);
    if (!isNaN(size) && size >= 0.5) {
      handleSizeSelect(size);
    }
  };

  const handleSkip = () => {
    onConfirm(detectedWidth, detectedHeight);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomConfirm();
    }
  };

  const resultingSize = (() => {
    const size = parseFloat(customSize);
    if (!isNaN(size) && size >= 0.5) {
      const w = aspectRatio >= 1 ? size : size * aspectRatio;
      const h = aspectRatio >= 1 ? size / aspectRatio : size;
      return `${w.toFixed(1)}" × ${h.toFixed(1)}"`;
    }
    return null;
  })();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xs bg-white border-gray-200">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-medium text-gray-700">
            Set sticker size
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-xs text-gray-400 text-center mb-2">longest side in inches</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="24"
              value={customSize}
              onChange={(e) => setCustomSize(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 h-11 text-center text-lg font-medium bg-white border-2 border-gray-300 rounded-lg text-gray-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
              placeholder="Size"
              autoFocus
            />
            <span className="text-lg text-gray-500 font-medium">"</span>
            <Button 
              onClick={handleCustomConfirm}
              className="h-11 px-5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium text-sm"
            >
              Apply size
            </Button>
          </div>
          {resultingSize && (
            <p className="text-xs text-gray-400 text-center mt-1.5">
              Resulting size: {resultingSize}
            </p>
          )}

          <div className="flex gap-1.5 mt-3 justify-center">
            {QUICK_SIZES.map((size) => (
              <button
                key={size.value}
                onClick={() => setCustomSize(String(size.value))}
                className={`h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
                  parseFloat(customSize) === size.value
                    ? "bg-cyan-600 border-cyan-600 text-white"
                    : "border-gray-200 text-gray-500 bg-gray-50 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={handleSkip}
            className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Skip — keep current size
          </button>
          <p className="text-xs text-gray-400 text-center mt-1">
            Current: {detectedWidth.toFixed(1)}" × {detectedHeight.toFixed(1)}"
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
