import ImageEditor from "@/components/image-editor";
import gooseLogo from "@assets/goose_silhouette.png";
import samuraiIcon from "@assets/samurai_katana.png";
import broLogo from "@assets/bro_logo.png";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Clean Header */}
      <header className="bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={gooseLogo} alt="Sticker Outline Bro" className="w-8 h-8 object-contain" />
            <h1 className="text-xl text-gray-900 font-semibold tracking-tight">Sticker Outline Bro</h1>
          </div>
          <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500">
            <span>Simple sticker design tool</span>
            <img src={samuraiIcon} alt="" className="w-6 h-6 object-contain opacity-60" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ImageEditor />
      </main>
    </div>
  );
}
