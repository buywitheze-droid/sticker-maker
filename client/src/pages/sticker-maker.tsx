import ImageEditor from "@/components/image-editor";
import gooseLogo from "@assets/goose_silhouette.png";
import samuraiIcon from "@assets/samurai_katana.png";
import broLogo from "@assets/bro_logo.png";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <style>{`
        @keyframes gooseMove {
          0%   { left: 55%; }
          10%  { left: 65%; }
          20%  { left: 75%; }
          30%  { left: 85%; }
          35%  { left: 80%; }
          45%  { left: 65%; }
          55%  { left: 55%; }
          65%  { left: 60%; }
          75%  { left: 72%; }
          85%  { left: 80%; }
          95%  { left: 65%; }
          100% { left: 55%; }
        }
        @keyframes gooseWobble {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          25% { transform: translateY(-3px) rotate(-3deg); }
          50% { transform: translateY(0px) rotate(2deg); }
          75% { transform: translateY(-2px) rotate(-2deg); }
        }
        @keyframes gooseFlip {
          0%   { transform: scaleX(1); }
          30%  { transform: scaleX(1); }
          35%  { transform: scaleX(-1); }
          55%  { transform: scaleX(-1); }
          56%  { transform: scaleX(1); }
          100% { transform: scaleX(1); }
        }
        @keyframes samuraiMove {
          0%   { left: 42%; }
          10%  { left: 52%; }
          20%  { left: 62%; }
          30%  { left: 72%; }
          35%  { left: 67%; }
          45%  { left: 52%; }
          55%  { left: 42%; }
          65%  { left: 47%; }
          75%  { left: 59%; }
          85%  { left: 67%; }
          95%  { left: 52%; }
          100% { left: 42%; }
        }
        @keyframes samuraiBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
        @keyframes katanaSlash {
          0%, 26% { transform: rotate(0deg); }
          29% { transform: rotate(-50deg); }
          32% { transform: rotate(35deg); }
          35%, 74% { transform: rotate(0deg); }
          77% { transform: rotate(-45deg); }
          80% { transform: rotate(30deg); }
          83%, 100% { transform: rotate(0deg); }
        }
        .goose-pos {
          animation: gooseMove 8s ease-in-out infinite;
          position: absolute;
          top: 50%;
          margin-top: -16px;
          z-index: 2;
        }
        .goose-flip {
          animation: gooseFlip 8s ease-in-out infinite;
          display: inline-block;
        }
        .goose-wobble {
          animation: gooseWobble 0.5s ease-in-out infinite;
          display: inline-block;
        }
        .samurai-pos {
          animation: samuraiMove 8s ease-in-out infinite;
          position: absolute;
          top: 50%;
          margin-top: -14px;
          z-index: 1;
        }
        .samurai-bob {
          animation: samuraiBob 0.35s ease-in-out infinite;
          display: inline-block;
        }
        .katana-slash {
          animation: katanaSlash 8s ease-in-out infinite;
          transform-origin: bottom center;
          display: inline-block;
        }
      `}</style>

      <header className="bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-4 relative overflow-hidden">
        <div className="max-w-7xl mx-auto flex items-center justify-between relative" style={{ minHeight: '32px' }}>
          <div className="flex items-center space-x-3 relative z-10">
            <img src={broLogo} alt="Sticker Outline Bro" className="w-8 h-8 object-contain" />
            <h1 className="text-xl text-gray-900 font-semibold tracking-tight">Sticker Outline Bro</h1>
          </div>

          <div className="hidden sm:block absolute inset-0 pointer-events-none">
            <div className="goose-pos">
              <span className="goose-flip">
                <span className="goose-wobble">
                  <img src={gooseLogo} alt="" className="w-8 h-8 object-contain" />
                </span>
              </span>
            </div>
            <div className="samurai-pos">
              <span className="samurai-bob">
                <span className="katana-slash">
                  <img src={samuraiIcon} alt="" className="w-7 h-7 object-contain" />
                </span>
              </span>
            </div>
          </div>

          <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500 relative z-10">
            <span>Simple sticker design tool</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ImageEditor />
      </main>
    </div>
  );
}
