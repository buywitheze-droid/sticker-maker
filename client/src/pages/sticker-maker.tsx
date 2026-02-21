import ImageEditor from "@/components/image-editor";

export default function StickerMaker() {
  return (
    <div className="min-h-screen bg-black">
      <header className="bg-black border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white tracking-wider">NEON TRANSFERS</h1>
          <span className="text-sm text-gray-400 font-medium">Powered by <span className="text-white font-semibold">DTFMASTERS</span></span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ImageEditor />
      </main>
    </div>
  );
}
