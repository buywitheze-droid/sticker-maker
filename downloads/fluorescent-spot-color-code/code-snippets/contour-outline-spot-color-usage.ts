// FROM: client/src/lib/contour-outline.ts
// Shows how SpotColorInput is used in the downloadContourPDF function.
// The spot colors are passed through to addSpotColorVectorsToPDF for PDF export.

// ============================================================
// FUNCTION SIGNATURE (line ~1777)
// ============================================================
/*
export async function downloadContourPDF(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings,
  filename: string,
  cachedContourData?: CachedContourData,
  spotColors?: SpotColorInput[],        // <-- spot colors parameter
  singleArtboard: boolean = false,
  cutContourLabel: string = 'CutContour',
  lockedContour?: { label: string; pathPoints: Array<{x: number; y: number}>; widthInches: number; heightInches: number } | null,
  skipCutContour: boolean = false
): Promise<void> {
*/

// ============================================================
// SPOT COLOR USAGE INSIDE downloadContourPDF (line ~2051)
// ============================================================
/*
  if (spotColors && spotColors.length > 0) {
    const spotLabels = await addSpotColorVectorsToPDF(
      pdfDoc, page, image, spotColors,
      resizeSettings.widthInches, resizeSettings.heightInches,
      pageHeightInches, imageOffsetXInches, imageOffsetYInches
    );
    console.log('[downloadContourPDF] Added spot color vector layers:', spotLabels);
  }

  const whiteName = spotColors?.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE';
  const glossName = spotColors?.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS';
  // ... used in PDF metadata keywords ...
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector', whiteName, glossName]);
*/

// ============================================================
// ALSO USED IN shape-outline.ts (downloadShapePDF) (line ~226)
// ============================================================
/*
export async function downloadShapePDF(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings,
  filename: string,
  spotColors?: SpotColorInput[],        // <-- same pattern
  singleArtboard: boolean = false,
  cutContourLabel: string = 'CutContour',
): Promise<void> {
  // ... similar usage:
  if (spotColors && spotColors.length > 0) {
    const spotLabels = await addSpotColorVectorsToPDF(
      pdfDoc, page, image, spotColors,
      widthInches, heightInches,
      pageHeightInches, imageOffsetXInches, imageOffsetYInches
    );
    console.log('[downloadShapePDF] Added spot color vector layers:', spotLabels);
  }
}
*/
