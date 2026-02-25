FLUORESCENT SPOT COLOR CODE - COMPLETE RECOVERY PACKAGE
========================================================

This package contains all the code needed for the fluorescent spot color system.
The system flow is: Upload image -> Extract colors -> User assigns fluorescent inks 
(Y/M/G/Orange) -> Preview overlay shows effect -> PDF export writes Separation color 
spaces with OCG layers.


COMPLETE FILES (drop-in replacements)
======================================

1. complete-files/spot-color-vectors.ts
   Location: client/src/lib/spot-color-vectors.ts
   Purpose: Main PDF export for spot colors. Contains:
   - traceColorRegionsAsync() - sends image to web worker for color region tracing
   - spotColorPathsToPDFOps() - converts inch paths to PDF drawing operators
   - appendContentStream() - appends content stream to PDF page
   - addSpotColorRegionAsLayer() - creates Separation color space + OCG layer per region
   - addSpotColorVectorsToPDF() - main export function, handles rotation, multi-design,
     OCG catalog management. Called by downloadContourPDF, downloadShapePDF, and
     the artboard download handler.

2. complete-files/spot-color-worker.ts
   Location: client/src/lib/spot-color-worker.ts
   Purpose: Web Worker for heavy spot color computation (runs off main thread). Contains:
   - SpotColorInputWorker interface (worker-side copy of SpotColorInput)
   - createClosestColorMask() - assigns each pixel to its nearest extracted color
     (tolerance 60, alpha threshold 240), creates binary mask
   - marchingSquaresTrace() - traces boundary edges between filled/unfilled pixels,
     chains into closed contours using right-turn priority rule
   - collapseCollinear() - removes redundant points on straight segments
   - traceMaskToInchPaths() - combines tracing + collapse + DPI-to-inch conversion
   - processSpotColors() - orchestrates mask+trace for each spot color type
     (White, Gloss, Fluorescent Y/M/G/Orange)

3. complete-files/color-extractor.ts
   Location: client/src/lib/color-extractor.ts
   Purpose: Extracts dominant colors from uploaded images. Contains:
   - ExtractedColor interface (with spotFluorY/M/G/Orange flags)
   - COLOR_PALETTE - 100+ predefined colors with per-color matching thresholds
   - findClosestPaletteColor() - matches pixel to nearest palette entry
   - detectBackgroundColor() - samples corners/edges to identify background
   - extractDominantColors() - main extraction: palette matching, unmatched bucketing,
     merge similar, sort by percentage
   - groupColorsByShade() - groups extracted colors by hue family
   - extractColorsFromCanvas() / extractColorsFromImageAsync() - entry points

4. complete-files/color-extraction-worker.ts
   Location: client/src/lib/color-extraction-worker.ts
   Purpose: Web Worker version of color extraction for non-blocking UI.
   Same logic as color-extractor.ts but runs in a dedicated worker thread.
   Receives pixel buffer via postMessage, returns extracted colors.


CODE SNIPPETS (from larger files)
==================================

5. code-snippets/SpotColorInput-type.ts
   From: client/src/lib/contour-outline.ts (lines ~1760-1775)
   Purpose: The shared TypeScript interface used across all spot color files.
   Defines hex, rgb, and all spot color flags (white, gloss, fluorY/M/G/Orange)
   plus editable spot color names.

6. code-snippets/SpotPreviewData-type.ts
   From: client/src/components/controls-section.tsx (lines ~16-19)
   Purpose: Interface for the preview data passed from controls to preview section.

7. code-snippets/controls-section-spot-color-logic.tsx
   From: client/src/components/controls-section.tsx
   Purpose: ALL fluorescent color UI logic extracted from the controls component:
   - State declarations (showSpotColors, extractedColors, spotPreviewEnabled, etc.)
   - Color extraction useEffect (with per-design caching via spotSelectionsRef)
   - Copy spot selections for design duplication
   - updateSpotColor() - mutual exclusion logic for fluorescent assignment
   - sortedColorIndices - prioritizes fluorescent-friendly colors in UI
   - buildSpotColorsForDesign() / getAllDesignSpotColors() - prepares data for download
   - Complete JSX for the fluorescent panel (color list with Y/M/G/Or buttons)
   - Complete JSX for the "How Fluorescent Colors Work" info panel

8. code-snippets/preview-section-spot-overlay.tsx
   From: client/src/components/preview-section.tsx (lines ~1630-1780)
   Purpose: Spot color preview overlay rendering:
   - Pulse animation (sine wave, 30fps, opacity range 0.35-1.0)
   - createSpotOverlayCanvas() - pixel-level color matching with tolerance=30,
     paints overlay with fluorescent RGB values, cached by composite key
   - How the overlay is composited in the main render loop

9. code-snippets/image-editor-spot-wiring.tsx
   From: client/src/components/image-editor.tsx
   Purpose: Shows how SpotPreviewData state is created in the editor and
   passed to both ControlsSection (callback) and PreviewSection (data).
   Also shows the download handler's spot color integration.

10. code-snippets/contour-outline-spot-color-usage.ts
    From: client/src/lib/contour-outline.ts and client/src/lib/shape-outline.ts
    Purpose: Shows how SpotColorInput is used in downloadContourPDF() and
    downloadShapePDF() - the spot colors parameter and the call to
    addSpotColorVectorsToPDF().


DATA FLOW SUMMARY
==================

1. Image uploaded -> extractColorsFromImageAsync() extracts dominant colors
   (runs in color-extraction-worker.ts for performance)

2. Colors displayed in Fluorescent Colors panel (controls-section.tsx)
   User clicks Y/M/G/Or buttons to assign fluorescent inks to colors

3. SpotPreviewData flows from controls-section -> image-editor -> preview-section
   Preview overlay shows fluorescent effect with pulsing animation

4. On download, getAllDesignSpotColors() collects all per-design assignments
   into Record<designId, SpotColorInput[]>

5. PDF export calls addSpotColorVectorsToPDF() which:
   a. Sends image + spot colors to spot-color-worker.ts (web worker)
   b. Worker creates closest-color masks per fluorescent type
   c. Worker traces boundaries using marching squares algorithm
   d. Returns vector paths (in inches) for each fluorescent region
   e. Main thread writes PDF Separation color spaces with OCG layers


FLUORESCENT NEON COLORS REFERENCE
===================================

  Yellow (Y):   #DFFF00  RGB(223, 255, 0)    PDF Separation: Fluorescent_Y
  Magenta (M):  #FF00FF  RGB(255, 0, 255)    PDF Separation: Fluorescent_M
  Green (G):    #39FF14  RGB(57, 255, 20)    PDF Separation: Fluorescent_G
  Orange (Or):  #FF6600  RGB(255, 102, 0)    PDF Separation: Fluorescent_Orange

  All use CMYK tint [0, 1, 0, 0] (magenta) in PDF Separation color spaces.
  Spot color names are user-editable via the UI.
