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

  return (
    <div className="lg:col-span-1">
      {/* Drag and Drop Zone */}
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-white hover:border-cyan-500 hover:bg-cyan-50 transition-all cursor-pointer shadow-sm"
      >
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
            <Upload className="w-6 h-6 text-gray-500" />
          </div>
          <p className="text-gray-700 text-sm mb-1">Drop image or PDF to upload</p>
          <p className="text-xs text-gray-400">PNG, JPEG, or PDF with CutContour</p>
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
        <div className="mt-3 p-4 bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl border border-gray-200 shadow-sm">
          {imageInfo.file?.name && (
            <p className="text-sm font-semibold text-gray-700 truncate mb-2" title={imageInfo.file.name}>
              {imageInfo.file.name}
            </p>
          )}
          <div className="flex items-center gap-3 text-gray-600">
            <div className="text-center">
              <p className="text-lg font-bold text-cyan-600">{resizeSettings.widthInches.toFixed(1)}"</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">width</p>
            </div>
            <span className="text-gray-300 text-lg">×</span>
            <div className="text-center">
              <p className="text-lg font-bold text-cyan-600">{resizeSettings.heightInches.toFixed(1)}"</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">height</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm font-medium text-gray-500">{resizeSettings.outputDPI} DPI</p>
            </div>
          </div>
          {stickerSize && (
            <div className="mt-3 pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Sticker: <span className="font-semibold text-gray-700">{stickerSize}"</span> <span className="italic">(longest side)</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Cut Line Info */}
      {showCutLineInfo && (
        <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200 text-center shadow-sm">
          <p className="text-xs text-gray-500">
            <span className="text-pink-500 font-medium">Pink Outline</span> = CutContour
          </p>
        </div>
      )}
    </div>
  );
}
