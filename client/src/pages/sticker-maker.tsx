import ImageEditor from "@/components/image-editor";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-black">
      <header className="bg-black border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1
            className="text-2xl font-black tracking-widest"
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
          <span className="text-sm text-gray-400 font-medium">Powered by <span className="text-white font-semibold">DTFMASTERS</span></span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ImageEditor />
      </main>
    </div>
  );
}
