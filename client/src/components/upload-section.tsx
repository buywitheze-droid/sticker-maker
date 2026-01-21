import { useCallback } from "react";
import { Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ImageInfo } from "./image-editor";
import type { ResizeSettings } from "@/lib/types";

interface UploadSectionProps {
  onImageUpload: (file: File, image: HTMLImageElement) => void;
  imageInfo: ImageInfo | null;
  resizeSettings: ResizeSettings;
}

export default function UploadSection({ onImageUpload, imageInfo, resizeSettings }: UploadSectionProps) {
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
      <h2 className="text-lg font-semibold text-white mb-4">Upload Image</h2>
      
      {/* Drag and Drop Zone */}
      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('imageInput')?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
      >
        <div className="flex flex-col items-center">
          <Upload className="w-12 h-12 text-gray-400 mb-4" />
          <p className="text-gray-600 mb-2">Drop your PNG image here</p>
          <p className="text-sm text-gray-500 mb-4">or click to browse</p>
          <button className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors">
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

      {/* Current Image Info */}
      {imageInfo && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Image Information</h3>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Filename:</span>
                <span>{imageInfo.file.name}</span>
              </div>
              <div className="flex justify-between">
                <span>Dimensions:</span>
                <span>{imageInfo.originalWidth} × {imageInfo.originalHeight} px</span>
              </div>
              <div className="flex justify-between">
                <span>Size in inches:</span>
                <span>
                  {resizeSettings.widthInches.toFixed(1)} × {resizeSettings.heightInches.toFixed(1)} in
                </span>
              </div>
              <div className="flex justify-between">
                <span>DPI:</span>
                <span>{imageInfo.dpi}</span>
              </div>
              <div className="flex justify-between">
                <span>File size:</span>
                <span>{(imageInfo.file.size / 1024).toFixed(0)} KB</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
