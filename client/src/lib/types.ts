export interface ImageInfo {
  file: File;
  image: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
}

export interface StrokeSettings {
  width: number;
  color: string;
  enabled: boolean;
  alphaThreshold: number;
  closeSmallGaps: boolean;
  closeBigGaps: boolean;
  backgroundColor: string;
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
  type: 'square' | 'rectangle' | 'circle' | 'oval';
  offset: number; // Margin around design in inches (replaces manual width/height)
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
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
