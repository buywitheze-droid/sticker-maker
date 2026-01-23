import { useCallback } from "react";
import { Upload } from "lucide-react";
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
    if (!file.type.startsWith('image/png')) {
      alert('Please upload a PNG image file.');
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
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center bg-white hover:border-cyan-400 hover:bg-cyan-50/80 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 group"
      >
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-cyan-50 transition-colors duration-300">
            <Upload className="w-8 h-8 text-gray-400 group-hover:text-cyan-500 transition-colors duration-300" />
          </div>
          <p className="text-gray-700 font-medium mb-2">Drop your PNG image here</p>
          <p className="text-sm text-gray-500 mb-4">or click to browse</p>
          <button className="bg-gradient-to-r from-cyan-500 to-teal-500 text-black px-6 py-2.5 rounded-lg hover:from-cyan-600 hover:to-teal-600 transition-all duration-300 font-medium shadow-md hover:shadow-lg">
            Choose File
          </button>
        </div>
        <input 
          type="file" 
          id="imageInput" 
          className="hidden" 
          accept=".png,image/png" 
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
