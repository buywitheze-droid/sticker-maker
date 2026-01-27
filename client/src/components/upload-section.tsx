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
      {/* Drag and Drop Zone */}
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className={`
          border-2 border-dashed rounded-2xl text-center transition-all duration-200 cursor-pointer
          ${isEmptyState 
            ? 'border-gray-300 hover:border-cyan-400 bg-gradient-to-br from-white to-gray-50 p-12 hover:shadow-lg hover:shadow-cyan-500/10' 
            : 'border-gray-200 hover:border-cyan-400 bg-white p-4 hover:bg-gray-50'
          }
        `}
      >
        <div className="flex flex-col items-center">
          <div className={`
            rounded-2xl flex items-center justify-center mb-4 transition-all
            ${isEmptyState 
              ? 'w-20 h-20 bg-gradient-to-br from-cyan-50 to-blue-50 shadow-inner' 
              : 'w-10 h-10 bg-gray-100'
            }
          `}>
            <Upload className={`
              transition-all
              ${isEmptyState ? 'w-10 h-10 text-cyan-500' : 'w-5 h-5 text-gray-400'}
            `} />
          </div>
          <p className={`
            font-medium transition-all
            ${isEmptyState ? 'text-gray-700 text-lg mb-2' : 'text-gray-600 text-sm mb-1'}
          `}>
            {isEmptyState ? 'Drop your image here' : 'Change image'}
          </p>
          {isEmptyState && (
            <p className="text-sm text-gray-400">
              PNG, JPEG, or PDF with CutContour
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

      {/* Image Info */}
      {imageInfo && resizeSettings && (
        <div className="mt-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
          {imageInfo.file?.name && (
            <p className="text-sm font-medium text-gray-700 truncate mb-3" title={imageInfo.file.name}>
              {imageInfo.file.name}
            </p>
          )}
          <div className="flex items-center gap-4 text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold text-gray-800">{resizeSettings.widthInches.toFixed(1)}"</span>
              <span className="text-gray-300">×</span>
              <span className="text-xl font-semibold text-gray-800">{resizeSettings.heightInches.toFixed(1)}"</span>
            </div>
            <div className="ml-auto">
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">{resizeSettings.outputDPI} DPI</span>
            </div>
          </div>
        </div>
      )}

      {/* Cut Line Info */}
      {showCutLineInfo && (
        <div className="mt-3 p-3 bg-fuchsia-50 rounded-xl border border-fuchsia-100 text-center">
          <p className="text-xs text-fuchsia-600 font-medium">
            Pink Outline = CutContour
          </p>
        </div>
      )}
    </div>
  );
}
