import ImageEditor from "@/components/image-editor";
import elephantLogo from "@assets/generated_images/mother_and_baby_elephant_silhouette.png";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Compact Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center space-x-3">
          <img src={elephantLogo} alt="Sticker Outline" className="w-8 h-8 object-contain" />
          <h1 className="text-xl text-black font-medium" style={{ fontFamily: '"Nabana Shadow", sans-serif' }}>Sticker Outline</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        <ImageEditor />
      </main>
    </div>
  );
}
