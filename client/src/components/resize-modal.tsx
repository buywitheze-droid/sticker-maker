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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">What size sticker?</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-4">
          {SIZES.map((size) => (
            <Button
              key={size.value}
              variant="outline"
              onClick={() => handleSizeSelect(size.value)}
              className="h-16 text-2xl font-bold hover:bg-cyan-50 hover:border-cyan-500 dark:hover:bg-cyan-900/30"
            >
              {size.label}
            </Button>
          ))}
        </div>

        <div className="border-t pt-3">
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="flex items-center justify-center w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Need a different size?
            {showCustom ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
          </button>
          
          {showCustom && (
            <div className="flex items-center gap-2 mt-3">
              <Input
                type="number"
                step="0.5"
                min="1"
                max="12"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                className="text-center text-lg"
                placeholder="Size"
              />
              <span className="text-gray-500">inches</span>
              <Button 
                onClick={handleCustomConfirm}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
