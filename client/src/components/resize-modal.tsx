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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xs bg-white border-gray-200">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-medium text-gray-700">
            Choose size
          </DialogTitle>
          <p className="text-center text-xs text-gray-500 mt-1 italic">longest side in inches</p>
        </DialogHeader>

        {/* Custom size input - always visible */}
        <div className="py-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="24"
              value={customSize}
              onChange={(e) => setCustomSize(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 h-12 text-center text-xl font-medium bg-white border-2 border-gray-300 rounded-lg text-gray-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
              placeholder="Size"
              autoFocus
            />
            <span className="text-lg text-gray-500 font-medium">"</span>
            <Button 
              onClick={handleCustomConfirm}
              className="h-12 px-6 bg-cyan-600 hover:bg-cyan-700 text-white font-medium"
            >
              Go
            </Button>
          </div>
        </div>

        {/* Quick size buttons */}
        <div className="border-t border-gray-200 pt-3">
          <p className="text-xs text-gray-400 text-center mb-2">Quick sizes</p>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_SIZES.map((size) => (
              <button
                key={size.value}
                onClick={() => handleSizeSelect(size.value)}
                className="h-9 text-sm font-medium rounded-md border border-gray-200 text-gray-500 bg-gray-50 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 transition-colors"
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
