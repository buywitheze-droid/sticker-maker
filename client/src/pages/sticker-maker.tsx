import { useState } from "react";
import { ImageIcon } from "lucide-react";
import ImageEditor from "@/components/image-editor";

export default function StickerMaker() {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Sticker Maker</h1>
          </div>
          <div className="text-sm text-gray-500">
            Create outlined stickers from your images
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <ImageEditor />
      </main>
    </div>
  );
}
