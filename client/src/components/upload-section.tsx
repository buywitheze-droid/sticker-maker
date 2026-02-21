import { useCallback, useState, useEffect } from "react";
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

  const gradientColors = [
    { bg: 'rgb(34, 197, 94)', glow: 'rgba(34, 197, 94, 0.5)' },
    { bg: 'rgb(234, 179, 8)', glow: 'rgba(234, 179, 8, 0.5)' },
    { bg: 'rgb(249, 115, 22)', glow: 'rgba(249, 115, 22, 0.5)' },
    { bg: 'rgb(236, 72, 153)', glow: 'rgba(236, 72, 153, 0.5)' },
  ];

  const [colorIndex, setColorIndex] = useState(0);

  useEffect(() => {
    if (!isEmptyState) return;
    const interval = setInterval(() => {
      setColorIndex(prev => (prev + 1) % gradientColors.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isEmptyState]);

  const currentColor = gradientColors[colorIndex];

  return (
    <div className="w-full">
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className={`
          rounded-2xl text-center cursor-pointer
          ${isEmptyState 
            ? 'p-10 hover:scale-[1.02] transform transition-transform duration-300' 
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 px-4 py-2 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/40'
          }
        `}
        style={isEmptyState ? {
          background: currentColor.bg,
          boxShadow: `0 0 50px ${currentColor.glow}, 0 0 100px ${currentColor.glow}, 0 8px 32px rgba(0,0,0,0.2)`,
          transition: 'background 1.5s ease-in-out, box-shadow 1.5s ease-in-out',
        } : undefined}
      >
        <div className={`flex items-center ${isEmptyState ? 'flex-col' : 'gap-2'}`}>
          {isEmptyState && (
            <>
              <div className="w-20 h-20 rounded-2xl bg-white/30 backdrop-blur-sm shadow-inner flex items-center justify-center mb-5 border border-white/40">
                <Upload className="w-10 h-10 text-white drop-shadow-lg" />
              </div>
              <p className="font-bold text-white text-2xl mb-1 drop-shadow-sm tracking-wide">
                Make a Gangsheet
              </p>
              <p className="text-sm text-white/80 mb-4">
                PNG files only
              </p>
            </>
          )}
          {!isEmptyState && (
            <Upload className="w-4 h-4 text-white" />
          )}
          {!isEmptyState && (
            <p className="font-medium text-white text-sm">
              Add Design
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
