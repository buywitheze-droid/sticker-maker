import { useState } from "react";
import ImageEditor from "@/components/image-editor";
import gooseImg from "@assets/goose_animated.png";
import samuraiImg from "@assets/samurai_animated.png";
import samuraiSlashImg from "@assets/samurai_slash.png";
import fireSlashImg from "@assets/fire_slash.png";

export default function StickerMaker() {
  const [gooseClicks, setGooseClicks] = useState(0);
  const [designUploaded, setDesignUploaded] = useState(false);
  const [countdownCompleted, setCountdownCompleted] = useState(false);
  return (
    <div className="min-h-screen bg-black">
      <style>{`
        @keyframes gooseRun {
          0%   { left: -10.5%; }
          85%  { left: 101.5%; }
          85.1% { left: -10.5%; }
          100% { left: -10.5%; }
        }
        @keyframes samuraiRun {
          0%   { left: -15%; }
          85%  { left: 97%; }
          85.1% { left: -15%; }
          100% { left: -15%; }
        }
        @keyframes gooseBounce {
          0%   { transform: translateY(0px) rotate(0deg); }
          3%   { transform: translateY(-3px) rotate(-2deg); }
          6%   { transform: translateY(0px) rotate(2deg); }
          9%   { transform: translateY(-2px) rotate(-1deg); }
          10%  { transform: translateY(-14px) rotate(-8deg); }
          12%  { transform: translateY(-16px) rotate(4deg); }
          14%  { transform: translateY(0px) rotate(0deg); }
          17%  { transform: translateY(-3px) rotate(-2deg); }
          20%  { transform: translateY(0px) rotate(2deg); }
          23%  { transform: translateY(-2px) rotate(-1deg); }
          24%  { transform: translateY(-14px) rotate(-8deg); }
          26%  { transform: translateY(-16px) rotate(4deg); }
          28%  { transform: translateY(0px) rotate(0deg); }
          31%  { transform: translateY(-3px) rotate(-2deg); }
          34%  { transform: translateY(0px) rotate(2deg); }
          37%  { transform: translateY(-2px) rotate(-1deg); }
          38%  { transform: translateY(-14px) rotate(-8deg); }
          40%  { transform: translateY(-16px) rotate(4deg); }
          42%  { transform: translateY(0px) rotate(0deg); }
          45%  { transform: translateY(-3px) rotate(-2deg); }
          48%  { transform: translateY(0px) rotate(2deg); }
          51%  { transform: translateY(-2px) rotate(-1deg); }
          52%  { transform: translateY(-14px) rotate(-8deg); }
          54%  { transform: translateY(-16px) rotate(4deg); }
          56%  { transform: translateY(0px) rotate(0deg); }
          59%  { transform: translateY(-3px) rotate(-2deg); }
          62%  { transform: translateY(0px) rotate(2deg); }
          65%  { transform: translateY(-2px) rotate(-1deg); }
          66%  { transform: translateY(-14px) rotate(-8deg); }
          68%  { transform: translateY(-16px) rotate(4deg); }
          70%  { transform: translateY(0px) rotate(0deg); }
          73%  { transform: translateY(-3px) rotate(-2deg); }
          76%  { transform: translateY(0px) rotate(2deg); }
          79%  { transform: translateY(-2px) rotate(-1deg); }
          80%  { transform: translateY(-14px) rotate(-8deg); }
          82%  { transform: translateY(-16px) rotate(4deg); }
          84%  { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
        @keyframes samuraiBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
        @keyframes samuraiNormal {
          0%, 9% { opacity: 1; }
          10%, 13% { opacity: 0; }
          14%, 23% { opacity: 1; }
          24%, 27% { opacity: 0; }
          28%, 37% { opacity: 1; }
          38%, 41% { opacity: 0; }
          42%, 51% { opacity: 1; }
          52%, 55% { opacity: 0; }
          56%, 65% { opacity: 1; }
          66%, 69% { opacity: 0; }
          70%, 79% { opacity: 1; }
          80%, 83% { opacity: 0; }
          84%, 100% { opacity: 1; }
        }
        @keyframes samuraiAttack {
          0%, 9% { opacity: 0; }
          10%, 13% { opacity: 1; }
          14%, 23% { opacity: 0; }
          24%, 27% { opacity: 1; }
          28%, 37% { opacity: 0; }
          38%, 41% { opacity: 1; }
          42%, 51% { opacity: 0; }
          52%, 55% { opacity: 1; }
          56%, 65% { opacity: 0; }
          66%, 69% { opacity: 1; }
          70%, 79% { opacity: 0; }
          80%, 83% { opacity: 1; }
          84%, 100% { opacity: 0; }
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
          animation: gooseBounce 6s linear infinite;
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
        .samurai-frame {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 36px;
        }
        .samurai-frame img {
          position: absolute;
          top: 0;
          left: 0;
        }
        .samurai-normal {
          animation: samuraiNormal 6s linear infinite;
        }
        .samurai-attack {
          animation: samuraiAttack 6s linear infinite;
        }
        .slash-effect {
          animation: slashFlash 6s linear infinite;
          position: absolute;
          top: -14px;
          left: 8px;
          width: 28px;
          height: 28px;
          object-fit: contain;
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
                <img src={gooseImg} alt="" className="w-8 h-8 object-contain" />
              </span>
            </div>
            <div className="samurai-pos" style={{ position: 'relative' }}>
              <img src={fireSlashImg} alt="" className="slash-effect" />
              <span className="samurai-bob">
                <span className="samurai-frame">
                  <img src={samuraiImg} alt="" className="w-9 h-9 object-contain samurai-normal" />
                  <img src={samuraiSlashImg} alt="" className="w-9 h-9 object-contain samurai-attack" />
                </span>
              </span>
            </div>
          </div>

          <div className="hidden sm:flex items-center space-x-2 text-sm relative z-10">
            {designUploaded ? (
              <span className={`font-semibold ${countdownCompleted ? 'text-green-500' : 'text-amber-500'}`}>
                {countdownCompleted ? 'good boy' : 'Feeding your Sticker Addiction!'}
              </span>
            ) : gooseClicks >= 10 ? (
              <span className="text-red-500 font-semibold">stop being silly and upload your Design</span>
            ) : (
              <button
                onClick={() => setGooseClicks(c => {
                  const next = c + 1;
                  if (next >= 10) setCountdownCompleted(true);
                  return next;
                })}
                className="text-gray-500 hover:text-gray-700 cursor-pointer transition-colors"
              >
                click here to see what happens to the goose ({10 - gooseClicks})
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ImageEditor onDesignUploaded={() => setDesignUploaded(true)} />
      </main>
    </div>
  );
}
