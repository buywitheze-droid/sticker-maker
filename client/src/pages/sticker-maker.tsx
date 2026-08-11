import ImageEditor from "@/components/image-editor";
import { type ProfileConfig, HOT_PEEL_PROFILE } from "@/lib/profiles";
import { Link } from "wouter";
import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n";
import LanguageToggle from "@/components/language-toggle";
import { useUiStore } from "@/state/ui-store";

interface StickerMakerProps {
  profile?: ProfileConfig;
}

/** Fires a custom event the editor listens for — bridges the context gap. */
const dispatchEditorHeightChange = (h: number) =>
  document.dispatchEvent(new CustomEvent("editor:height-change", { detail: { height: h } }));

const dispatchEditorAddSheet = (mode: "blank" | "copy-layout" | "copy-layers") =>
  document.dispatchEvent(new CustomEvent("editor:add-sheet", { detail: { mode } }));

export default function StickerMaker({ profile = HOT_PEEL_PROFILE }: StickerMakerProps) {
  const { t } = useLanguage();
  const artboardHeight = useUiStore(s => s.headerArtboardHeight);
  const sheetCount     = useUiStore(s => s.headerSheetCount);
  const canCopy        = useUiStore(s => s.headerCanCopy);
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);

  const MAX_SHEETS = 10; // mirrors the constant in sheet-controls.tsx

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* ── Desktop header ───────────────────────────────────────────── */}
      <header className="hidden sm:flex flex-shrink-0 bg-gray-50 border-b border-gray-200 px-4 py-2 items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <button className="flex items-center gap-1 text-gray-600 hover:text-gray-900 transition-colors text-xs">
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("editor.back")}
            </button>
          </Link>
          <h1
            className="text-lg font-black tracking-widest"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              background: "linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6, #06b6d4)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "gradientShift 4s linear infinite",
              filter: "drop-shadow(0 0 8px rgba(6,182,212,0.5))",
            }}
          >
            {profile.title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-600">
            {t("editor.tips")}{" "}
            <a href="mailto:Support@anynestapp.com" className="text-cyan-600 hover:text-cyan-700 font-semibold">
              Support@anynestapp.com
            </a>
          </span>
          <LanguageToggle />
        </div>
      </header>

      {/* ── Mobile header ────────────────────────────────────────────── */}
      {/*
          Three-zone layout so content doesn't fight for the same row:

            [← Back | Add Designs]   [+ Sheet]   [22.5"× ▾ height]

          The middle zone is `position: absolute` centred so it doesn't
          compress the left/right zones on narrow phones.
      */}
      <header className="sm:hidden relative flex-shrink-0 bg-gray-50 border-b border-gray-200 px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">

          {/* LEFT — back + add designs */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Link href="/">
              <button className="flex items-center gap-0.5 text-gray-600 hover:text-gray-900 transition-colors text-[11px] px-1">
                <ArrowLeft className="w-3 h-3 flex-shrink-0" />
                {t("editor.back")}
              </button>
            </Link>
            <button
              className="flex items-center gap-1 rounded-lg border border-cyan-600 bg-cyan-500 px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm active:scale-[0.97] transition-all"
              onClick={() =>
                (document.getElementById("editor-header-upload-input") as HTMLInputElement | null)?.click()
              }
              title={t("editor.addDesignTitle")}
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.5} />
              {t("editor.addDesigns")}
            </button>
          </div>

          {/* MIDDLE — Add Sheet (small, neon green) */}
          {sheetCount < MAX_SHEETS && (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setSheetMenuOpen(v => !v)}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-black active:scale-[0.97] transition-all"
                style={{
                  background: "linear-gradient(135deg, #39ff14 0%, #22c55e 100%)",
                  color: "#000",
                  boxShadow: "0 0 10px rgba(57,255,20,0.4)",
                  border: "1px solid rgba(57,255,20,0.5)",
                  letterSpacing: "0.03em",
                }}
              >
                <Plus className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
                {t("sheets.add")}
                {sheetCount > 1 && (
                  <span className="ml-0.5 text-[9px] font-bold opacity-60 bg-black/10 px-1 py-0.5 rounded-full">
                    {sheetCount}/{MAX_SHEETS}
                  </span>
                )}
              </button>

              {sheetMenuOpen && (
                <>
                  {/* Backdrop to close the menu */}
                  <div className="fixed inset-0 z-40" onClick={() => setSheetMenuOpen(false)} />
                  <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-2xl py-1 overflow-hidden">
                    <button
                      onClick={() => { setSheetMenuOpen(false); dispatchEditorAddSheet("blank"); }}
                      className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-[12px] font-semibold text-gray-900">{t("sheets.addBlank")}</span>
                      <span className="text-[10px] text-gray-500">{t("sheets.addBlankDesc")}</span>
                    </button>
                    {canCopy && (
                      <>
                        <button
                          onClick={() => { setSheetMenuOpen(false); dispatchEditorAddSheet("copy-layout"); }}
                          className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                        >
                          <span className="text-[12px] font-semibold text-gray-900">{t("sheets.addCopyLayout")}</span>
                          <span className="text-[10px] text-gray-500">{t("sheets.addCopyLayoutDesc")}</span>
                        </button>
                        <button
                          onClick={() => { setSheetMenuOpen(false); dispatchEditorAddSheet("copy-layers"); }}
                          className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                        >
                          <span className="text-[12px] font-semibold text-gray-900">{t("sheets.addCopyLayers")}</span>
                          <span className="text-[10px] text-gray-500">{t("sheets.addCopyLayersDesc")}</span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* RIGHT — gangsheet size: width label + height select */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[12px] font-semibold tabular-nums text-gray-700 whitespace-nowrap">
              {profile.artboardWidth}"×
            </span>
            <select
              value={String(artboardHeight)}
              onChange={e => dispatchEditorHeightChange(parseFloat(e.target.value))}
              className="h-8 w-[4.5rem] cursor-pointer rounded border border-gray-300 bg-white px-1 text-[12px] font-semibold tabular-nums text-gray-900 outline-none transition-colors hover:border-gray-400 focus:border-cyan-500 coarse:h-10 coarse:text-[16px]"
              title={t("controls.gangsheetSize")}
              aria-label={t("controls.gangsheetSize")}
            >
              {profile.gangsheetHeights.map(h => (
                <option key={h} value={String(h)}>
                  {h}"
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <ImageEditor profile={profile} />
      </main>
    </div>
  );
}
