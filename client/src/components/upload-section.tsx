import { useCallback } from "react";
import { Upload, Sparkles, Zap, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ImageInfo } from "./image-editor";
import type { ResizeSettings } from "@/lib/types";

interface UploadSectionProps {
  onImageUpload: (file: File, image: HTMLImageElement) => void;
  imageInfo: ImageInfo | null;
  resizeSettings: ResizeSettings;
  showCutLineInfo?: boolean;
}

export default function UploadSection({ onImageUpload, imageInfo, resizeSettings, showCutLineInfo = false }: UploadSectionProps) {
  const handleFileUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG or JPEG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        onImageUpload(file, img);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [onImageUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  }, [handleFileUpload]);

  return (
    <div className="lg:col-span-1">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center text-cyan-400 text-sm font-bold">1</span>
        Upload Image
      </h2>
      
      {/* Drag and Drop Zone */}
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center bg-gradient-to-br from-white to-cyan-50/50 hover:border-cyan-400 hover:from-cyan-50 hover:to-teal-50 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-xl hover:shadow-cyan-500/20 group relative overflow-hidden"
      >
        {/* Decorative sparkles */}
        <div className="absolute top-3 right-3 opacity-30 group-hover:opacity-60 transition-opacity">
          <Sparkles className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="absolute bottom-3 left-3 opacity-20 group-hover:opacity-50 transition-opacity">
          <Star className="w-4 h-4 text-teal-400" />
        </div>
        
        <div className="flex flex-col items-center relative z-10">
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-100 to-teal-100 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 shadow-md">
            <Upload className="w-10 h-10 text-cyan-500 group-hover:text-cyan-600 transition-colors duration-300" />
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-1">Let's Make Some Stickers!</h3>
          <p className="text-gray-600 mb-1">Drop your PNG design here</p>
          <p className="text-xs text-gray-400 mb-4">Works best with transparent backgrounds</p>
          <button className="bg-gradient-to-r from-cyan-500 to-teal-500 text-black px-6 py-2.5 rounded-lg hover:from-cyan-600 hover:to-teal-600 transition-all duration-300 font-medium shadow-md hover:shadow-lg hover:scale-105 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Choose Your Design
          </button>
          
          {/* Quick benefits */}
          <div className="flex flex-wrap justify-center gap-3 mt-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
              Instant preview
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
              Print-ready output
            </span>
          </div>
        </div>
        <input 
          type="file" 
          id="imageInput" 
          className="hidden" 
          accept=".png,.jpg,.jpeg,image/png,image/jpeg" 
          onChange={handleFileInputChange}
        />
      </div>

      {/* Cut Line Info - only show from step 2 onwards */}
      {showCutLineInfo && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <p className="font-bold text-center text-lg" style={{ 
              fontFamily: "'Inter', sans-serif",
              color: 'black'
            }}>
              The <span style={{ color: 'red' }}>red</span> outline you see is your <span style={{ color: 'red' }}>CUT LINE</span> - that's exactly where the magic scissors will snip!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
