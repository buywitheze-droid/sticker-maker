import ImageEditor from "@/components/image-editor";
import gooseLogo from "@assets/goose_silhouette.png";
import samuraiIcon from "@assets/samurai_katana.png";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <style>{`
        @keyframes gooseRun {
          0%   { left: -10%; }
          85%  { left: 105%; }
          85.1% { left: -10%; }
          100% { left: -10%; }
        }
        @keyframes samuraiRun {
          0%   { left: -22%; }
          85%  { left: 93%; }
          85.1% { left: -22%; }
          100% { left: -22%; }
        }
        @keyframes gooseWobble {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          25% { transform: translateY(-3px) rotate(-3deg); }
          50% { transform: translateY(0px) rotate(2deg); }
          75% { transform: translateY(-2px) rotate(-2deg); }
        }
        @keyframes samuraiBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
        @keyframes katanaSlash {
          0%, 8% { transform: rotate(0deg); }
          10% { transform: rotate(-55deg); }
          12% { transform: rotate(40deg); }
          14%, 22% { transform: rotate(0deg); }
          24% { transform: rotate(-50deg); }
          26% { transform: rotate(35deg); }
          28%, 36% { transform: rotate(0deg); }
          38% { transform: rotate(-55deg); }
          40% { transform: rotate(40deg); }
          42%, 50% { transform: rotate(0deg); }
          52% { transform: rotate(-50deg); }
          54% { transform: rotate(35deg); }
          56%, 64% { transform: rotate(0deg); }
          66% { transform: rotate(-55deg); }
          68% { transform: rotate(40deg); }
          70%, 78% { transform: rotate(0deg); }
          80% { transform: rotate(-50deg); }
          82% { transform: rotate(35deg); }
          84%, 100% { transform: rotate(0deg); }
        }
        @keyframes slashFlash {
          0%, 9% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          10% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          13% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          14%, 23% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          24% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          27% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          28%, 37% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          38% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          41% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          42%, 51% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          52% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          55% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          56%, 65% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          66% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          69% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          70%, 79% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
          80% { opacity: 1; transform: scale(1.2) rotate(15deg); }
          83% { opacity: 0; transform: scale(1.5) rotate(45deg); }
          84%, 100% { opacity: 0; }
        }
        .goose-pos {
          animation: gooseRun 6s linear infinite;
          position: absolute;
          top: 50%;
          margin-top: -16px;
          z-index: 2;
        }
        .goose-wobble {
          animation: gooseWobble 0.5s ease-in-out infinite;
          display: inline-block;
        }
        .samurai-pos {
          animation: samuraiRun 6s linear infinite;
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
          animation: katanaSlash 6s linear infinite;
          transform-origin: bottom center;
          display: inline-block;
        }
        .slash-effect {
          animation: slashFlash 6s linear infinite;
          position: absolute;
          top: -8px;
          left: -6px;
          font-size: 18px;
          pointer-events: none;
          opacity: 0;
          z-index: 3;
        }
      `}</style>

      <header className="bg-white border-b border-gray-200 px-6 py-4 relative overflow-hidden">
        <div className="max-w-7xl mx-auto flex items-center justify-between relative" style={{ minHeight: '32px' }}>
          <div className="flex items-center space-x-3 relative z-10">
            <h1 className="text-xl text-gray-900 font-semibold tracking-tight">Sticker Outline Bro</h1>
          </div>

          <div className="hidden sm:block absolute inset-0 pointer-events-none">
            <div className="goose-pos">
              <span className="goose-wobble">
                <img src={gooseLogo} alt="" className="w-8 h-8 object-contain" />
              </span>
            </div>
            <div className="samurai-pos" style={{ position: 'relative' }}>
              <span className="slash-effect">&#10040;</span>
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
