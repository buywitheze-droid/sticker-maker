export interface PDFCutContourInfo {
  hasCutContour: boolean;
  cutContourPath: Path2D | null;
  cutContourPoints: { x: number; y: number }[][];
  pageWidth: number;
  pageHeight: number;
}

export interface ImageInfo {
  file: File;
  image: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
  isPDF?: boolean;
  pdfCutContourInfo?: PDFCutContourInfo;
  originalPdfData?: ArrayBuffer;
}

export interface StrokeSettings {
  width: number;
  color: string;
  enabled: boolean;
  alphaThreshold: number;
  closeSmallGaps: boolean;
  closeBigGaps: boolean;
  backgroundColor: string;
  useCustomBackground: boolean; // If true, use backgroundColor; if false, use edge-aware bleed
}

export type StrokeMode = 'none' | 'contour' | 'shape';

export interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
}

export interface ShapeSettings {
  enabled: boolean;
  type: 'square' | 'rectangle' | 'circle' | 'oval' | 'rounded-square' | 'rounded-rectangle';
  offset: number; // Margin around design in inches (replaces manual width/height)
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
  cornerRadius?: number; // Corner radius in inches for rounded shapes (default 0.25)
  bleedEnabled?: boolean; // Whether to add color bleed outside the shape
  bleedColor?: string; // Color for the bleed area
}

export type StickerSize = 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5 | 5.5;

export const STICKER_SIZES: { value: StickerSize; label: string }[] = [
  { value: 2, label: '2 inch' },
  { value: 2.5, label: '2.5 inch' },
  { value: 3, label: '3 inch' },
  { value: 3.5, label: '3.5 inch' },
  { value: 4, label: '4 inch' },
  { value: 4.5, label: '4.5 inch' },
  { value: 5, label: '5 inch' },
  { value: 5.5, label: '5.5 inch' },
];

export interface SpotColorData {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite: boolean;
  spotGloss: boolean;
}

export type AlphaTracingMethod = 'marching-squares' | 'moore-neighbor' | 'contour-following' | 'potrace' | 'potrace-style';

export interface ContourDebugSettings {
  enabled: boolean;
  alphaTracingMethod: AlphaTracingMethod;
  gaussianSmoothing: boolean;
  cornerDetection: boolean;
  bezierCurveFitting: boolean;
  autoBridging: boolean;
  gapClosing: boolean;
  holeFilling: boolean;
  pathSimplification: boolean;
  showRawContour: boolean;
  // Potrace-specific settings
  potraceAlphaMax: number; // Corner threshold (0-1.34, default 1.0) - lower = more corners preserved
  potraceTurdSize: number; // Speckle suppression (pixels, default 2) - removes small artifacts
  potraceOptCurve: boolean; // Curve optimization enabled
  potraceOptTolerance: number; // Optimization tolerance (0-1, default 0.2)
}
