import { useState } from "react";
import ImageEditor from "@/components/image-editor";
import elephantLogo from "@assets/generated_images/mother_and_baby_elephant_silhouette.png";
import tridentLogo from "@assets/generated_images/evil_trident_devil_logo.png";

export default function StickerMaker() {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);

  return (
    <div className="bg-black min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={elephantLogo} alt="Sticker Outline logo" className="w-10 h-10 object-contain" />
            <h1 className="text-xl font-semibold text-black">Sticker Outline</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-black/70">
            <span>We are here to feed your sticker addiction</span>
            <img src={tridentLogo} alt="Trident logo" className="w-6 h-6 object-contain" />
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
