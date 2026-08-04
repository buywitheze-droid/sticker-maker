export interface ImageInfo {
  file: File;
  image: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
  isPDF?: boolean;
  originalPdfData?: ArrayBuffer;
}

export interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
}

export interface StrokeSettings {
  enabled: boolean;
  width: number;
  color: string;
  alphaThreshold: number;
  autoBridging: boolean;
  autoBridgingThreshold: number;
  backgroundColor: string;
}

export interface ShapeSettings {
  enabled?: boolean;
  type: string;
  widthInches: number;
  heightInches: number;
  fillColor: string;
  cornerRadius: number;
  offset: number;
  offsetX: number;
  offsetY: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
}

export interface ImageTransform {
  nx: number;
  ny: number;
  s: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface DesignItem {
  id: string;
  imageInfo: ImageInfo;
  transform: ImageTransform;
  widthInches: number;
  heightInches: number;
  name: string;
  originalDPI: number;
  alphaThresholded?: boolean;
  halftoned?: boolean;
  printFileName?: boolean;
}

export function computeLayerRect(
  imageWidthPx: number,
  imageHeightPx: number,
  transform: ImageTransform,
  artboardWidthPx: number,
  artboardHeightPx: number,
  artboardWidthInches: number,
  artboardHeightInches: number,
  imageWidthInches: number,
  imageHeightInches: number,
): { x: number; y: number; width: number; height: number } {
  const designWidthPx = (imageWidthInches / artboardWidthInches) * artboardWidthPx;
  const designHeightPx = (imageHeightInches / artboardHeightInches) * artboardHeightPx;

  const finalWidth = designWidthPx * transform.s;
  const finalHeight = designHeightPx * transform.s;

  const cx = transform.nx * artboardWidthPx;
  const cy = transform.ny * artboardHeightPx;

  return {
    x: cx - finalWidth / 2,
    y: cy - finalHeight / 2,
    width: finalWidth,
    height: finalHeight,
  };
}
