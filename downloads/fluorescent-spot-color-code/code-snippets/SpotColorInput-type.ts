// FROM: client/src/lib/contour-outline.ts (lines ~1760-1775)
// This interface is the shared type used across all spot color export files.
// It is exported from contour-outline.ts and imported by spot-color-vectors.ts, shape-outline.ts, etc.

export interface SpotColorInput {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite: boolean;
  spotGloss: boolean;
  spotWhiteName?: string;
  spotGlossName?: string;
  spotFluorY: boolean;
  spotFluorM: boolean;
  spotFluorG: boolean;
  spotFluorOrange: boolean;
  spotFluorYName?: string;
  spotFluorMName?: string;
  spotFluorGName?: string;
  spotFluorOrangeName?: string;
}
