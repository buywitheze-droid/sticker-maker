import { useCallback } from "react";
import { Upload } from "lucide-react";
import type { ImageInfo, ResizeSettings } from "./image-editor";

interface UploadSectionProps {
  onImageUpload: (file: File, image: HTMLImageElement) => void;
  showCutLineInfo?: boolean;
  imageInfo?: ImageInfo | null;
  resizeSettings?: ResizeSettings | null;
  stickerSize?: number;
}

export default function UploadSection({ onImageUpload, showCutLineInfo = false, imageInfo, resizeSettings, stickerSize }: UploadSectionProps) {
  const handleFileUpload = useCallback(async (file: File) => {
    if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
      alert('Please upload a PNG file only.');
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

  const isEmptyState = !imageInfo;

  return (
    <div className="w-full">
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className={`
          rounded-2xl text-center transition-all duration-200 cursor-pointer
          ${isEmptyState 
            ? 'p-10 hover:scale-[1.02] transform transition-transform duration-300' 
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 px-4 py-2 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/40'
          }
        `}
        style={isEmptyState ? {
          background: 'linear-gradient(to top, rgba(217,70,239,0.65) 0%, rgba(190,180,50,0.55) 20%, rgba(45,212,30,0.50) 40%, rgba(220,100,20,0.45) 60%, rgba(255,255,255,0.95) 85%, #ffffff 100%)',
          boxShadow: '0 0 50px rgba(255, 255, 255, 0.6), 0 0 100px rgba(255, 255, 255, 0.3), 0 8px 32px rgba(0,0,0,0.2)',
        } : undefined}
      >
        <div className={`flex items-center ${isEmptyState ? 'flex-col' : 'gap-2'}`}>
          {isEmptyState && (
            <>
              <div className="w-20 h-20 rounded-2xl bg-white/30 backdrop-blur-sm shadow-inner flex items-center justify-center mb-5 border border-white/40">
                <Upload className="w-10 h-10 text-gray-700 drop-shadow-lg" />
              </div>
              <p className="font-bold text-gray-800 text-2xl mb-1 drop-shadow-sm tracking-wide">
                Make a Gangsheet
              </p>
              <p className="text-sm text-gray-600 mb-4">
                PNG files only
              </p>
            </>
          )}
          {!isEmptyState && (
            <Upload className="w-4 h-4 text-white" />
          )}
          {!isEmptyState && (
            <p className="font-medium text-white text-sm">
              Change Image
            </p>
          )}
        </div>
        <input 
          type="file" 
          id="imageInput" 
          className="hidden" 
          accept=".png,image/png" 
          onChange={handleFileInputChange}
        />
      </div>

      {isEmptyState && (
        <p className="text-center mt-4 text-sm font-medium text-gray-400">
          Fluorescent ink will glow under Black UV light!
        </p>
      )}
    </div>
  );
}
