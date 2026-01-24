import { useCallback } from "react";
import { Upload } from "lucide-react";
import { parsePDF, isPDFFile, type ParsedPDFData } from "@/lib/pdf-parser";

interface UploadSectionProps {
  onImageUpload: (file: File, image: HTMLImageElement) => void;
  onPDFUpload?: (file: File, pdfData: ParsedPDFData) => void;
  showCutLineInfo?: boolean;
}

export default function UploadSection({ onImageUpload, onPDFUpload, showCutLineInfo = false }: UploadSectionProps) {
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

      {/* Cut Line Info */}
      {showCutLineInfo && (
        <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200 text-center shadow-sm">
          <p className="text-xs text-gray-500">
            <span className="text-red-500 font-medium">Red outline</span> = cut line
          </p>
        </div>
      )}
    </div>
  );
}
