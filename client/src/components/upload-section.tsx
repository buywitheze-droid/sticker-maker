import { useCallback } from "react";
import { Upload } from "lucide-react";
import { parsePDF, isPDFFile, type ParsedPDFData } from "@/lib/pdf-parser";
import type { ImageInfo, ResizeSettings } from "./image-editor";

interface UploadSectionProps {
  onImageUpload: (file: File, image: HTMLImageElement) => void;
  onPDFUpload?: (file: File, pdfData: ParsedPDFData) => void;
  showCutLineInfo?: boolean;
  imageInfo?: ImageInfo | null;
  resizeSettings?: ResizeSettings | null;
  stickerSize?: number;
}

export default function UploadSection({ onImageUpload, onPDFUpload, showCutLineInfo = false, imageInfo, resizeSettings, stickerSize }: UploadSectionProps) {
  const handleFileUpload = useCallback(async (file: File) => {
    if (isPDFFile(file)) {
      if (onPDFUpload) {
        try {
          const pdfData = await parsePDF(file);
          onPDFUpload(file, pdfData);
        } catch (error) {
          console.error('Error parsing PDF:', error);
          alert('Error parsing PDF file. Please try a different file.');
        }
      } else {
        alert('PDF upload not supported.');
      }
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPEG) or PDF.');
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
  }, [onImageUpload, onPDFUpload]);

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
          rounded-xl text-center transition-all duration-200 cursor-pointer
          ${isEmptyState 
            ? 'p-10 hover:shadow-2xl hover:scale-[1.02] transform transition-transform duration-300' 
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 px-4 py-2 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/40'
          }
        `}
        style={isEmptyState ? {
          background: 'linear-gradient(135deg, #FF00FF 0%, #DFFF00 25%, #39FF14 50%, #FF6600 75%, #FF00FF 100%)',
          boxShadow: '0 0 40px rgba(255, 0, 255, 0.3), 0 0 80px rgba(57, 255, 20, 0.2), 0 8px 32px rgba(0,0,0,0.15)',
        } : undefined}
      >
        <div className={`flex items-center ${isEmptyState ? 'flex-col' : 'gap-2'}`}>
          {isEmptyState && (
            <>
              <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm shadow-inner flex items-center justify-center mb-5 border border-white/30">
                <Upload className="w-10 h-10 text-white drop-shadow-lg" />
              </div>
              <p className="font-bold text-white text-2xl mb-1 drop-shadow-lg tracking-wide">
                Make a Gangsheet
              </p>
              <p className="text-sm text-white/80 mb-4">
                PNG, JPEG, or PDF
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
          accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" 
          onChange={handleFileInputChange}
        />
      </div>

      {isEmptyState && (
        <p className="text-center mt-4 text-sm font-medium text-gray-500">
          Fluorescent ink will glow under Black UV light!
        </p>
      )}
    </div>
  );
}
