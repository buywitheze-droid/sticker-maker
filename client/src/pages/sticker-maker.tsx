import ImageEditor from "@/components/image-editor";
import { type ProfileConfig, HOT_PEEL_PROFILE } from "@/lib/profiles";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

interface StickerMakerProps {
  profile?: ProfileConfig;
}

export default function StickerMaker({ profile = HOT_PEEL_PROFILE }: StickerMakerProps) {
  return (
    <div className="h-screen flex flex-col bg-black overflow-hidden">
      <header className="flex-shrink-0 bg-black border-b border-gray-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link href="/">
              <button className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors text-xs">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            </Link>
            <h1
              className="text-lg font-black tracking-widest"
              style={{
                fontFamily: "'Orbitron', sans-serif",
                background: 'linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6, #06b6d4)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'gradientShift 4s linear infinite',
                filter: 'drop-shadow(0 0 8px rgba(6,182,212,0.5))',
              }}
            >{profile.title}</h1>
          </div>
          <span className="text-[11px] text-gray-400 flex-shrink-0">
            Have tips and app improvement suggestions? Send it over! <a href="mailto:Sales@dtfmasters.com" className="text-cyan-400 hover:text-cyan-300 font-semibold">Sales@dtfmasters.com</a>
          </span>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <ImageEditor profile={profile} />
      </main>
    </div>
  );
}
