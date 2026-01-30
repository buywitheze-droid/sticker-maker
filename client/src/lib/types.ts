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

export type ContourCornerMode = 'rounded' | 'sharp';

export type ContourAlgorithm = 'shapes' | 'complex';

export interface StrokeSettings {
  width: number;
  color: string;
  enabled: boolean;
  alphaThreshold: number;
  closeSmallGaps: boolean;
  closeBigGaps: boolean;
  backgroundColor: string;
  useCustomBackground: boolean; // If true, use backgroundColor; if false, use edge-aware bleed
  cornerMode: ContourCornerMode; // 'rounded' for smooth arcs, 'sharp' for miter corners
  autoBridging: boolean; // If true, close narrow gaps/caves in contour
  autoBridgingThreshold: number; // Gap threshold in inches (default 0.02)
  algorithm?: ContourAlgorithm; // 'shapes' for simple designs, 'complex' for complex/curved designs (default: shapes)
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
