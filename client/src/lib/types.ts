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
  widthInches: number;
  heightInches: number;
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
  offsetX: number;
  offsetY: number;
}
