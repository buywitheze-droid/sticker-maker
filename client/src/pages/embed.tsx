import ImageEditor from "@/components/image-editor";

export default function EmbedPage() {
  return (
    <div className="w-screen h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 overflow-auto">
      <div className="w-full h-full p-2 md:p-4">
        <ImageEditor />
      </div>
    </div>
  );
}
