import { useState } from "react";
import ImageEditor from "@/components/image-editor";
import elephantLogo from "@assets/generated_images/mother_and_baby_elephant_silhouette.png";
import devilLogo from "@assets/generated_images/mischievous_devil_face_silhouette.png";

export default function StickerMaker() {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);

  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <header className="bg-black border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={elephantLogo} alt="Sticker Outline logo" className="w-10 h-10 object-contain invert" />
            <h1 className="text-xl font-semibold text-white">Sticker Outline</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-white/70">
            <span>We are here to feed your sticker addiction</span>
            <img src={devilLogo} alt="Devil logo" className="w-6 h-6 object-contain invert" />
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
