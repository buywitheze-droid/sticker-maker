import ImageEditor from "@/components/image-editor";

export default function StickerMaker() {
  return (
    <div className="h-screen flex flex-col bg-black overflow-hidden">
      <header className="flex-shrink-0 bg-black border-b border-gray-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <h1
            className="text-xl font-black tracking-widest"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              background: 'linear-gradient(90deg, #22c55e, #eab308, #f97316, #ec4899, #22c55e)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'gradientShift 4s linear infinite',
              filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.6)) drop-shadow(0 0 16px rgba(236,72,153,0.4))',
            }}
          >NEON TRANSFERS</h1>
          <span className="text-xs text-gray-400 font-medium">Powered by <span className="text-white font-semibold">DTFMASTERS</span></span>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <ImageEditor />
      </main>
    </div>
  );
}
