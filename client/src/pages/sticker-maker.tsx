import { useState } from "react";
import ImageEditor from "@/components/image-editor";
import elephantLogo from "@assets/generated_images/mother_and_baby_elephant_silhouette.png";
import devilLogo from "@assets/generated_images/mischievous_devil_face_silhouette.png";

export default function StickerMaker() {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-200 px-6 py-4 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center space-x-3 group">
            <div className="relative">
              <div className="absolute inset-0 bg-cyan-400/20 rounded-full blur-lg group-hover:bg-cyan-400/40 transition-all duration-300"></div>
              <img src={elephantLogo} alt="Sticker Outline logo" className="w-12 h-12 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent" style={{ fontFamily: '"Nabana Shadow", sans-serif' }}>
              Sticker Outline
            </h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-slate-600">
            <span className="hidden sm:inline">We are here to feed your sticker addiction</span>
            <img src={devilLogo} alt="Devil logo" className="w-6 h-6 object-contain hover:rotate-12 transition-transform duration-300" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <ImageEditor />
      </main>
      
      {/* Subtle footer */}
      <footer className="text-center py-6 text-slate-500 text-sm">
        <p>Create beautiful die-cut stickers in seconds</p>
      </footer>
    </div>
  );
}
