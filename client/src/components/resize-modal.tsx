import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ResizeModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (widthInches: number, heightInches: number) => void;
  detectedWidth: number;
  detectedHeight: number;
}

const SIZES = [
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
  
  const [showCustom, setShowCustom] = useState(false);
  const [customSize, setCustomSize] = useState("3");

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
    if (!isNaN(size) && size > 0) {
      handleSizeSelect(size);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xs bg-slate-800 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-medium text-slate-200">
            Choose size
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 py-2">
          {SIZES.map((size) => (
            <button
              key={size.value}
              onClick={() => handleSizeSelect(size.value)}
              className="h-10 text-sm font-medium rounded-md border border-slate-600 text-slate-300 bg-slate-700/50 hover:bg-slate-600 hover:border-slate-500 hover:text-white transition-colors"
            >
              {size.label}
            </button>
          ))}
        </div>

        <div className="border-t border-slate-700 pt-2">
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="flex items-center justify-center w-full text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Custom
            {showCustom ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
          </button>
          
          {showCustom && (
            <div className="flex items-center gap-2 mt-2">
              <Input
                type="number"
                step="0.5"
                min="1"
                max="12"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                className="text-center text-sm h-8 bg-slate-700 border-slate-600 text-slate-200"
                placeholder="Size"
              />
              <span className="text-xs text-slate-500">in</span>
              <Button 
                onClick={handleCustomConfirm}
                size="sm"
                className="h-8 bg-slate-600 hover:bg-slate-500 text-slate-200"
              >
                Go
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
