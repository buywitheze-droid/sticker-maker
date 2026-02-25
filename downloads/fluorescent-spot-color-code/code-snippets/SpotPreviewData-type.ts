// FROM: client/src/components/controls-section.tsx (lines ~16-19)
// This interface is exported and used by preview-section.tsx and image-editor.tsx for the spot preview overlay system.

import { ExtractedColor } from "@/lib/color-extractor";

export interface SpotPreviewData {
  enabled: boolean;
  colors: ExtractedColor[];
}
