import { useState } from "react";
import ImageEditor from "@/components/image-editor";
import elephantLogo from "@assets/generated_images/black_elephant_silhouette_transparent.png";

export default function StickerMaker() {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);

  return (
    <div className="bg-black min-h-screen">
      {/* Header */}
      <header className="bg-cyan-500 border-b border-cyan-600 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={elephantLogo} alt="Stickeroutline logo" className="w-10 h-10 object-contain" />
            <h1 className="text-xl font-semibold text-black">Stickeroutline</h1>
          </div>
          <div className="text-sm text-black/70">
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
