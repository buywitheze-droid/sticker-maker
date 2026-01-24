import ImageEditor from "@/components/image-editor";
import gooseLogo from "@assets/goose_silhouette.png";
import samuraiIcon from "@assets/samurai_katana.png";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Compact Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={gooseLogo} alt="Sticker Outline Bro" className="w-8 h-8 object-contain" />
            <h1 className="text-xl text-black font-medium" style={{ fontFamily: '"Nabana Shadow", sans-serif' }}>STICKER OUTLINE ᗷRO</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>If you can't figure this out better commit seppuku</span>
            <img src={samuraiIcon} alt="" className="w-8 h-8 object-contain" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        <ImageEditor />
      </main>
    </div>
  );
}
