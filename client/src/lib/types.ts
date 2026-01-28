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

/**
 * Calculate effective design dimensions when contour is enabled.
 * The selected size becomes the TOTAL sticker size (design + contour).
 * So the design must be scaled down to leave room for the contour offset.
 * 
 * @param selectedWidthInches - The user-selected total sticker width
 * @param selectedHeightInches - The user-selected total sticker height  
 * @param contourOffsetInches - The contour offset (strokeSettings.width)
 * @param contourEnabled - Whether contour mode is active
 * @returns Effective design dimensions that fit within the contour
 */
export function calculateEffectiveDesignSize(
  selectedWidthInches: number,
  selectedHeightInches: number,
  contourOffsetInches: number,
  contourEnabled: boolean
): { widthInches: number; heightInches: number } {
  if (!contourEnabled || contourOffsetInches <= 0) {
    return { widthInches: selectedWidthInches, heightInches: selectedHeightInches };
  }
  
  // The contour adds offset on all sides
  // Base offset (0.015") is always added by the contour worker, plus the user offset
  const baseOffsetInches = 0.015;
  const totalOffsetPerSide = contourOffsetInches + baseOffsetInches;
  const totalOffsetBothSides = totalOffsetPerSide * 2;
  
  // Calculate effective design size by subtracting the contour from the total
  const effectiveWidth = Math.max(0.5, selectedWidthInches - totalOffsetBothSides);
  const effectiveHeight = Math.max(0.5, selectedHeightInches - totalOffsetBothSides);
  
  return {
    widthInches: parseFloat(effectiveWidth.toFixed(3)),
    heightInches: parseFloat(effectiveHeight.toFixed(3))
  };
}
