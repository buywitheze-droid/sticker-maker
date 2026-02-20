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

export type ContourMode = 'sharp' | 'smooth' | 'shapes' | 'scattered';

export interface StrokeSettings {
  width: number;
  color: string;
  enabled: boolean;
  alphaThreshold: number;
  backgroundColor: string;
  useCustomBackground: boolean;
  cornerMode: ContourCornerMode;
  autoBridging: boolean;
  autoBridgingThreshold: number;
  algorithm?: ContourAlgorithm;
  contourMode?: ContourMode;
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
  offset: number;
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
  cornerRadius?: number;
  bleedEnabled?: boolean;
  bleedColor?: string;
}

export type CutlineVisibility = 'thin' | 'normal' | 'bold';

export type StickerSize = 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5 | 5.5 | 6;

export const STICKER_SIZES: { value: StickerSize; label: string }[] = [
  { value: 2, label: '2 inch' },
  { value: 2.5, label: '2.5 inch' },
  { value: 3, label: '3 inch' },
  { value: 3.5, label: '3.5 inch' },
  { value: 4, label: '4 inch' },
  { value: 4.5, label: '4.5 inch' },
  { value: 5, label: '5 inch' },
  { value: 5.5, label: '5.5 inch' },
  { value: 6, label: '6 inch' },
];

export interface SpotColorData {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite: boolean;
  spotGloss: boolean;
}
