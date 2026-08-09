import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { MAX_SHEETS, type SheetState } from "./types";

interface SheetCanvasChromeProps {
  sheets: SheetState[];
  activeSheetId: string;
  activeSheetIndex: number;
  onNavigate: (sheetId: string) => void;
  onRename: (sheetId: string, name: string) => void;
  onDelete: (sheetId: string) => void;
}

/**
 * The sheet name, position and prev/next arrows that sit over the canvas.
 *
 * Renders nothing at all for a single sheet: a customer who never adds one
 * should not pay for the feature with a permanent badge over their artwork.
 */
export function SheetCanvasChrome({
  sheets,
  activeSheetId,
  activeSheetIndex,
  onNavigate,
  onRename,
  onDelete,
}: SheetCanvasChromeProps) {
  const { t } = useLanguage();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const activeSheet = sheets[activeSheetIndex];

  // A rename left open while the customer navigates away would reappear over
  // the sheet they land on, still holding the previous sheet's name.
  useEffect(() => {
    setRenaming(false);
    setRenameValue("");
  }, [activeSheetId]);

  if (sheets.length <= 1 || !activeSheet) return null;

  const prev = sheets[activeSheetIndex - 1];
  const next = sheets[activeSheetIndex + 1];

  const commitRename = () => {
    onRename(activeSheetId, renameValue);
    setRenaming(false);
  };

  return (
    <>
      {/* Slivers of the neighbouring sheets, so it reads as a stack. */}
      {prev && (
        <div
          className="absolute left-0 top-8 bottom-0 w-2.5 z-10 pointer-events-none rounded-l-sm"
          style={{ background: "rgba(156,163,175,0.5)", boxShadow: "-3px 0 10px rgba(0,0,0,0.07)" }}
        />
      )}
      {next && (
        <div
          className="absolute right-0 top-8 bottom-0 w-2.5 z-10 pointer-events-none rounded-r-sm"
          style={{ background: "rgba(156,163,175,0.5)", boxShadow: "3px 0 10px rgba(0,0,0,0.07)" }}
        />
      )}

      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-gray-900/80 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-full shadow-lg pointer-events-auto">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue("");
              }
            }}
            className="bg-transparent text-white font-semibold outline-none border-b border-white/60 min-w-0 w-28 text-[11px] leading-tight"
            maxLength={40}
          />
        ) : (
          <button
            onClick={() => {
              setRenaming(true);
              setRenameValue(activeSheet.name);
            }}
            className="flex items-center gap-1 font-semibold hover:text-gray-300 transition-colors select-none group"
            title={t("sheets.rename")}
          >
            <span>{activeSheet.name}</span>
            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" />
          </button>
        )}
        <span className="text-gray-400 text-[9px] select-none">
          {activeSheetIndex + 1}/{sheets.length}
        </span>
        <button
          onClick={() => onDelete(activeSheetId)}
          className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-gray-400 hover:text-red-400 hover:bg-red-500/20 transition-colors"
          title={t("sheets.delete")}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      {prev && (
        <button
          onClick={() => onNavigate(prev.id)}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-xl hover:bg-gray-700 active:scale-95 transition-all select-none"
          title={prev.name}
          aria-label={t("sheets.previous")}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {next && (
        <button
          onClick={() => onNavigate(next.id)}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-xl hover:bg-gray-700 active:scale-95 transition-all select-none"
          title={next.name}
          aria-label={t("sheets.next")}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </>
  );
}

interface AddSheetButtonProps {
  sheetCount: number;
  onAdd: (mode: "blank" | "copy-layout" | "copy-layers") => void;
  /** False on an empty sheet, where there is no layout worth copying. */
  canCopy: boolean;
}

/** The "ADD Gangsheet" call to action and its choice of how to seed the new sheet. */
export function AddSheetButton({ sheetCount, onAdd, canCopy }: AddSheetButtonProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  if (sheetCount >= MAX_SHEETS) return null;

  const choose = (mode: "blank" | "copy-layout" | "copy-layers") => {
    setOpen(false);
    onAdd(mode);
  };

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-sm border transition-all duration-200 active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, #39ff14 0%, #22c55e 100%)",
            color: "#000",
            boxShadow: "0 0 18px rgba(57,255,20,0.45), 0 2px 8px rgba(0,0,0,0.18)",
            borderColor: "rgba(57,255,20,0.5)",
            letterSpacing: "0.04em",
          }}
        >
          <Plus className="w-4 h-4 flex-shrink-0" strokeWidth={3} />
          {t("sheets.add")}
          {sheetCount > 1 && (
            <span className="ml-1 text-[10px] font-bold opacity-60 bg-black/10 px-1.5 py-0.5 rounded-full">
              {sheetCount}/{MAX_SHEETS}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl py-1 overflow-hidden">
            <SheetOption
              title={t("sheets.addBlank")}
              detail={t("sheets.addBlankDesc")}
              onClick={() => choose("blank")}
            />
            {canCopy && (
              <>
                <SheetOption
                  title={t("sheets.addCopyLayout")}
                  detail={t("sheets.addCopyLayoutDesc")}
                  onClick={() => choose("copy-layout")}
                />
                <SheetOption
                  title={t("sheets.addCopyLayers")}
                  detail={t("sheets.addCopyLayersDesc")}
                  onClick={() => choose("copy-layers")}
                />
              </>
            )}
          </div>
        )}
      </div>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </>
  );
}

function SheetOption({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
    >
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      <span className="text-xs text-gray-500">{detail}</span>
    </button>
  );
}
