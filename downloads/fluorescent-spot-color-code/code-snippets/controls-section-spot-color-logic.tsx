// FROM: client/src/components/controls-section.tsx
// All fluorescent spot color related state, logic, and UI from the controls section component.
// This includes: state declarations, color extraction, spot color assignment, preview data, and the fluorescent panel UI.

// ============================================================
// IMPORTS needed for spot color functionality
// ============================================================
import { extractColorsFromImageAsync, groupColorsByShade, ExtractedColor } from "@/lib/color-extractor";
import { Download, ChevronDown, ChevronUp, Palette, Eye, EyeOff, Pencil, Check, X, Layers, Send, FileCheck, Info } from "lucide-react";

// ============================================================
// EXPORTED TYPE: SpotPreviewData
// Used by preview-section.tsx and image-editor.tsx
// ============================================================
export interface SpotPreviewData {
  enabled: boolean;
  colors: ExtractedColor[];
}

// ============================================================
// PROPS that support spot color functionality (from ControlsSectionProps)
// ============================================================
// onDownload: (downloadType?, format?, spotColorsByDesign?) => void;
//   - spotColorsByDesign is Record<string, SpotColorInput[]> passed to PDF export
// onSpotPreviewChange?: (data: SpotPreviewData) => void;
//   - Notifies parent (image-editor) of preview state changes
// fluorPanelContainer?: HTMLDivElement | null;
//   - Portal target for rendering the fluorescent panel in the left sidebar
// selectedDesignId?: string | null;
//   - Current design ID for per-design spot color tracking
// copySpotSelectionsRef?: React.MutableRefObject<((fromId: string, toIds: string[]) => void) | null>;
//   - Ref for copying spot selections when duplicating designs

// ============================================================
// STATE DECLARATIONS (inside ControlsSection component)
// ============================================================
// const [showSpotColors, setShowSpotColors] = useState(false);
// const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([]);
// const [spotPreviewEnabled, setSpotPreviewEnabled] = useState(true);
// const [spotColorMode, setSpotColorMode] = useState<'whitegloss' | 'fluorescent'>('fluorescent');
// const [spotWhiteName, setSpotWhiteName] = useState("RDG_WHITE");
// const [spotGlossName, setSpotGlossName] = useState("RDG_GLOSS");
// const [spotFluorYName, setSpotFluorYName] = useState("Fluorescent_Y");
// const [spotFluorMName, setSpotFluorMName] = useState("Fluorescent_M");
// const [spotFluorGName, setSpotFluorGName] = useState("Fluorescent_G");
// const [spotFluorOrangeName, setSpotFluorOrangeName] = useState("Fluorescent_Orange");
// const [editingFluorName, setEditingFluorName] = useState<string | null>(null);
// const [tempFluorName, setTempFluorName] = useState("");
// const colorCacheRef = useRef<Map<string, ExtractedColor[]>>(new Map());
// const spotSelectionsRef = useRef<Map<string, ExtractedColor[]>>(new Map());
// const prevDesignIdRef = useRef<string | null | undefined>(null);

// ============================================================
// COLOR EXTRACTION (useEffect - runs when imageInfo or selectedDesignId changes)
// ============================================================
/*
useEffect(() => {
  // Save current design's selections before switching
  if (prevDesignIdRef.current && extractedColors.length > 0) {
    spotSelectionsRef.current.set(prevDesignIdRef.current, extractedColors);
  }
  prevDesignIdRef.current = selectedDesignId;

  if (imageInfo?.image) {
    // Check if this design already has saved spot selections
    if (selectedDesignId && spotSelectionsRef.current.has(selectedDesignId)) {
      setExtractedColors(spotSelectionsRef.current.get(selectedDesignId)!);
    } else {
      // Extract colors from image (with caching)
      const cacheKey = `${imageInfo.image.src}-${imageInfo.image.width}-${imageInfo.image.height}`;
      const cached = colorCacheRef.current.get(cacheKey);
      if (cached) {
        setExtractedColors(cached.map(c => ({ ...c })));
      } else {
        let cancelled = false;
        extractColorsFromImageAsync(imageInfo.image, 999).then(colors => {
          if (cancelled) return;
          colorCacheRef.current.set(cacheKey, colors);
          if (colorCacheRef.current.size > 20) {
            const firstKey = colorCacheRef.current.keys().next().value;
            if (firstKey) colorCacheRef.current.delete(firstKey);
          }
          setExtractedColors(colors);
        });
        return () => { cancelled = true; };
      }
    }
  } else {
    setExtractedColors([]);
  }
}, [imageInfo, selectedDesignId]);
*/

// ============================================================
// COPY SPOT SELECTIONS (for design duplication)
// ============================================================
/*
useEffect(() => {
  if (copySpotSelectionsRef) {
    copySpotSelectionsRef.current = (fromId: string, toIds: string[]) => {
      if (selectedDesignId && extractedColors.length > 0) {
        spotSelectionsRef.current.set(selectedDesignId, extractedColors);
      }
      const source = spotSelectionsRef.current.get(fromId);
      if (!source) return;
      for (const toId of toIds) {
        spotSelectionsRef.current.set(toId, source.map(c => ({ ...c })));
      }
    };
  }
  return () => { if (copySpotSelectionsRef) copySpotSelectionsRef.current = null; };
}, [copySpotSelectionsRef, selectedDesignId, extractedColors]);
*/

// ============================================================
// TOGGLE HANDLERS
// ============================================================
/*
const handleSpotColorsToggle = () => {
  if (!showSpotColors) {
    setShowContourOptions(false);
    setShowSpotColors(true);
  } else {
    setShowSpotColors(false);
  }
};
*/

// ============================================================
// UPDATE SPOT COLOR ASSIGNMENT (mutual exclusion for fluorescent fields)
// ============================================================
/*
const updateSpotColor = (index: number, field: 'spotWhite' | 'spotGloss' | 'spotFluorY' | 'spotFluorM' | 'spotFluorG' | 'spotFluorOrange', value: boolean) => {
  const fluorFields = ['spotFluorY', 'spotFluorM', 'spotFluorG', 'spotFluorOrange'];
  const isFluorField = fluorFields.includes(field);

  setExtractedColors(prev => {
    const updated = prev.map((color, i) => {
      if (i === index) {
        if (isFluorField && value) {
          // Mutual exclusion: only one fluorescent type per color
          return {
            ...color,
            spotFluorY: false,
            spotFluorM: false,
            spotFluorG: false,
            spotFluorOrange: false,
            [field]: true,
          };
        }
        return { ...color, [field]: value };
      }
      return color;
    });
    if (selectedDesignId) {
      spotSelectionsRef.current.set(selectedDesignId, updated);
    }
    return updated;
  });
};
*/

// ============================================================
// SORTED COLOR INDICES (prioritize fluorescent-friendly colors)
// ============================================================
/*
const sortedColorIndices = useMemo(() => {
  const fluorPriority = (c: ExtractedColor) => {
    const r = c.rgb.r, g = c.rgb.g, b = c.rgb.b;
    const max = Math.max(r, g, b);
    const saturation = max === 0 ? 0 : 1 - Math.min(r, g, b) / max;
    const lightness = (r + g + b) / 3;
    if (saturation < 0.15 || lightness < 40 || lightness > 240) return 1;
    const isMagenta = r > 180 && b > 120 && g < 120;
    const isYellow = r > 180 && g > 160 && b < 100;
    const isGreen = g > 150 && r < 150 && b < 150;
    const isOrange = r > 200 && g > 80 && g < 180 && b < 80;
    const isPink = r > 180 && g < 130 && b > 100;
    const isRed = r > 180 && g < 80 && b < 80;
    if (isMagenta || isYellow || isGreen || isOrange || isPink || isRed) return 0;
    return 1;
  };
  return extractedColors
    .map((c, i) => ({ index: i, priority: fluorPriority(c), pct: c.percentage }))
    .sort((a, b) => a.priority - b.priority || b.pct - a.pct)
    .map(e => e.index);
}, [extractedColors]);
*/

// ============================================================
// BUILD SPOT COLORS FOR DOWNLOAD (per-design)
// ============================================================
/*
const buildSpotColorsForDesign = (colors: ExtractedColor[]) => colors.map(c => ({
  ...c,
  spotWhite: spotColorMode === 'whitegloss' ? c.spotWhite : false,
  spotGloss: spotColorMode === 'whitegloss' ? c.spotGloss : false,
  spotWhiteName, spotGlossName,
  spotFluorY: spotColorMode === 'fluorescent' ? c.spotFluorY : false,
  spotFluorM: spotColorMode === 'fluorescent' ? c.spotFluorM : false,
  spotFluorG: spotColorMode === 'fluorescent' ? c.spotFluorG : false,
  spotFluorOrange: spotColorMode === 'fluorescent' ? c.spotFluorOrange : false,
  spotFluorYName, spotFluorMName, spotFluorGName, spotFluorOrangeName
}));

const getAllDesignSpotColors = (): Record<string, ReturnType<typeof buildSpotColorsForDesign>> => {
  if (selectedDesignId && extractedColors.length > 0) {
    spotSelectionsRef.current.set(selectedDesignId, extractedColors);
  }
  const result: Record<string, ReturnType<typeof buildSpotColorsForDesign>> = {};
  for (const [designId, colors] of spotSelectionsRef.current.entries()) {
    result[designId] = buildSpotColorsForDesign(colors);
  }
  if (selectedDesignId && !result[selectedDesignId] && extractedColors.length > 0) {
    result[selectedDesignId] = buildSpotColorsForDesign(extractedColors);
  }
  return result;
};
*/

// ============================================================
// NOTIFY PARENT OF SPOT PREVIEW CHANGES
// ============================================================
/*
useEffect(() => {
  onSpotPreviewChange?.({ enabled: spotPreviewEnabled, colors: extractedColors });
}, [spotPreviewEnabled, extractedColors, onSpotPreviewChange]);
*/

// ============================================================
// DOWNLOAD BUTTON (passes spot colors to download handler)
// ============================================================
// onClick={() => onDownload('standard', 'pdf', getAllDesignSpotColors())}

// ============================================================
// FLUORESCENT PANEL JSX (portaled into left sidebar via fluorPanelContainer)
// ============================================================
/*
{imageInfo && fluorPanelContainer && createPortal(
  <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
    <button
      onClick={handleSpotColorsToggle}
      className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-800/60 transition-colors ${showSpotColors ? 'bg-purple-500/10' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Palette className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-medium text-gray-200">Fluorescent Colors</span>
        {extractedColors.filter(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange).length > 0 && (
          <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
            {extractedColors.filter(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange).length} assigned
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); setSpotPreviewEnabled(!spotPreviewEnabled); }}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
            spotPreviewEnabled
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
              : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
          }`}
          title={spotPreviewEnabled ? 'Hide spot overlay' : 'Show spot overlay'}
        >
          {spotPreviewEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showSpotColors ? 'rotate-180' : ''}`} />
      </div>
    </button>

    {showSpotColors && (
      <div className="px-3 pb-2.5 space-y-2">
        {extractedColors.length === 0 ? (
          <div className="text-xs text-gray-500 italic py-1">No colors detected in image</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto">
            {sortedColorIndices
              .filter((idx) => extractedColors[idx].percentage >= 0.5)
              .map((idx) => {
              const color = extractedColors[idx];
              const isAssigned = color.spotFluorY || color.spotFluorM || color.spotFluorG || color.spotFluorOrange;
              return (
                <div key={idx} className={`flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
                  isAssigned
                    ? 'bg-purple-500/10 border border-purple-500/20'
                    : 'bg-gray-800/40 border border-transparent hover:border-gray-700'
                }`}>
                  <div
                    className="w-3.5 h-3.5 rounded flex-shrink-0 border border-gray-600"
                    style={{ backgroundColor: color.hex }}
                    title={color.hex}
                  />
                  <span className="text-[10px] text-gray-300 truncate min-w-0 flex-1">{color.name || color.hex}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    {([
                      { field: 'spotFluorY' as const, label: 'Y', bg: '#DFFF00' },
                      { field: 'spotFluorM' as const, label: 'M', bg: '#FF00FF' },
                      { field: 'spotFluorG' as const, label: 'G', bg: '#39FF14' },
                      { field: 'spotFluorOrange' as const, label: 'Or', bg: '#FF6600' },
                    ]).map(({ field, label, bg }) => (
                      <button
                        key={field}
                        onClick={() => updateSpotColor(idx, field, !color[field])}
                        className={`w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center transition-all ${
                          color[field]
                            ? 'ring-1 ring-offset-1 ring-offset-gray-900 scale-110'
                            : 'opacity-40 hover:opacity-80'
                        }`}
                        style={{
                          backgroundColor: color[field] ? bg : 'transparent',
                          color: color[field] ? '#000' : bg,
                          border: `1.5px solid ${bg}`,
                          ringColor: bg,
                        }}
                        title={`Fluorescent ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[10px] text-gray-500 pt-1.5 border-t border-gray-700 space-y-0.5">
          {([
            { key: 'Y', name: spotFluorYName, setName: setSpotFluorYName, defaultName: 'Fluorescent_Y', neonColor: '#DFFF00' },
            { key: 'M', name: spotFluorMName, setName: setSpotFluorMName, defaultName: 'Fluorescent_M', neonColor: '#FF00FF' },
            { key: 'G', name: spotFluorGName, setName: setSpotFluorGName, defaultName: 'Fluorescent_G', neonColor: '#39FF14' },
            { key: 'Orange', name: spotFluorOrangeName, setName: setSpotFluorOrangeName, defaultName: 'Fluorescent_Orange', neonColor: '#FF6600' },
          ] as const).map(({ key, name, setName, defaultName, neonColor }) => (
            <div key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: neonColor }} />
              <span className="font-semibold" style={{ color: neonColor, textShadow: '0 0 1px rgba(0,0,0,0.3)' }}>{key}</span>
              <span className="text-gray-600">-></span>
              {editingFluorName === key ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tempFluorName}
                    onChange={(e) => setTempFluorName(e.target.value)}
                    className="w-24 px-1 py-0.5 text-[10px] border border-gray-600 rounded bg-gray-800 text-gray-200"
                    autoFocus
                    onBlur={() => { setName(tempFluorName || defaultName); setEditingFluorName(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { setName(tempFluorName || defaultName); setEditingFluorName(null); }
                      else if (e.key === 'Escape') setEditingFluorName(null);
                    }}
                  />
                  <button onClick={() => { setName(tempFluorName || defaultName); setEditingFluorName(null); }} className="p-0.5 hover:bg-green-500/20 rounded" title="Save">
                    <Check className="w-2.5 h-2.5 text-green-400" />
                  </button>
                  <button onClick={() => setEditingFluorName(null)} className="p-0.5 hover:bg-red-500/20 rounded" title="Cancel">
                    <X className="w-2.5 h-2.5 text-red-400" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="font-medium text-gray-400">{name}</span>
                  <button onClick={() => { setTempFluorName(name); setEditingFluorName(key); }} className="p-0.5 hover:bg-gray-700 rounded" title="Edit name">
                    <Pencil className="w-2.5 h-2.5 text-gray-500" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>,
  fluorPanelContainer
)}
*/

// ============================================================
// FLUORESCENT INFO PANEL JSX (portaled below the fluor panel)
// ============================================================
/*
{imageInfo && fluorPanelContainer && createPortal(
  <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden mt-2">
    <button
      onClick={() => setShowFluorInfo(prev => !prev)}
      className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Info className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs font-medium text-gray-300">How Fluorescent Colors Work</span>
      </div>
      <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showFluorInfo ? 'rotate-180' : ''}`} />
    </button>

    {showFluorInfo && (
      <div className="px-3 pb-3">
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Available Inks</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { name: 'Yellow', color: '#DFFF00' },
              { name: 'Magenta', color: '#FF00FF' },
              { name: 'Orange', color: '#FF6600' },
              { name: 'Green', color: '#39FF14' },
            ].map(ink => (
              <div key={ink.name} className="flex items-center gap-1.5 bg-gray-800/60 rounded px-2 py-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ink.color }} />
                <span className="text-[10px] font-medium text-gray-300">Fluorescent {ink.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">How It Works</p>
          <div className="space-y-1.5 text-[10px] text-gray-400 leading-relaxed">
            <div className="flex gap-2">
              <span className="text-cyan-400 font-bold flex-shrink-0">1.</span>
              <span>Select a design to see all its detected colors above.</span>
            </div>
            <div className="flex gap-2">
              <span className="text-cyan-400 font-bold flex-shrink-0">2.</span>
              <span>Choose which fluorescent ink to assign to each color using the Y, M, G, Or buttons.</span>
            </div>
            <div className="flex gap-2">
              <span className="text-cyan-400 font-bold flex-shrink-0">3.</span>
              <span>The chosen fluorescent ink replaces that color in your printed transfer.</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/40 rounded-md px-2.5 py-2 mb-3 border border-gray-700/50">
          <p className="text-[10px] font-semibold text-gray-400 mb-1">Example</p>
          <p className="text-[10px] text-gray-400 leading-relaxed">
            If your design has green lettering, assign it to Green to print with fluorescent green ink.
            Pick Orange instead and those letters print orange.
          </p>
        </div>

        <p className="text-[10px] text-gray-500 leading-relaxed mb-2">
          These are regular DTF transfers (hot peel) - the fluorescent colors glow under black light.
        </p>

        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span>Questions?</span>
          <a href="mailto:Sales@dtfmasters.com" className="text-purple-400 hover:text-purple-300 underline transition-colors">Sales@dtfmasters.com</a>
        </div>
      </div>
    )}
  </div>,
  fluorPanelContainer
)}
*/
