---
name: Gangsheet spot color pipeline
description: Architecture of the fluorescent spot color feature — region detection, preview overlay, and PDF generation paths.
---

## Key files
- `client/src/lib/color-extractor.ts` — `buildPixelMapFromImage` (pixel→colorIndex at ≤512px), `detectColorRegionsAsync` (4-connected BFS blob detection)
- `client/src/lib/region-worker.ts` — BFS blob worker
- `client/src/lib/spot-color-worker.ts` — `trace` (color-match path) and `trace_premask` (pre-built mask path) message types
- `client/src/lib/spot-color-vectors.ts` — `addSpotColorVectorsToPDF` (color-match) + `addSpotColorVectorsFromMasksToPDF` (pre-mask)
- `client/src/components/controls-section.tsx` — `computeChannelMasks`, `buildSpotColorsForDesign` (includes `regions`/`regionMap`)
- `client/src/components/preview-section.tsx` — `createSpotOverlayCanvas` with masks fast path

## Data flow for region-level spot colors

### Preview overlay (DL4)
1. After region detection, `computeChannelMasks(colors, pixelMapRef.current)` builds 4×Uint8Array masks at 512px.
2. Stored in `SpotPreviewData.masks` and passed via `onSpotPreviewChange`.
3. `createSpotOverlayCanvas` in preview-section: if `spotPreviewData.masks` present, uses nearest-neighbor scale + direct mask lookup instead of color proximity matching.
4. `cacheKey` includes `maskFP = m${width}x${height}l${FY.length}` to avoid stale cache hits.

### PDF generation (DL2/SC1)
1. `buildSpotColorsForDesign` carries `regions` and `regionMap` through to `spotColorsByDesign`.
2. In `handleDownload`, per-design: detect if any color has `regions.length > 1` with region-level fluor assignments.
3. If yes: dynamically import `buildPixelMapFromImage`, rebuild pixel map, compute per-channel masks (FY/FM/FG/FO Uint8Arrays).
4. Call `addSpotColorVectorsFromMasksToPDF` → sends `trace_premask` message to worker.
5. Worker: `scaleMask` upscales from 512px to 300 DPI, then `traceMaskToInchPaths` traces contours.
6. Fallback to `addSpotColorVectorsToPDF` (color-match) on any error.

## CMYK tints per channel (DL3)
- FY (Yellow): `[0, 0, 1, 0]`
- FM (Magenta): `[0, 1, 0, 0]`
- FG (Green = C+Y): `[1, 0, 1, 0]`
- FO (Orange = M+Y): `[0, 0.5, 1, 0]`

## Hook ordering rule
`computeChannelMasks` useCallback MUST be declared BEFORE the `onSpotPreviewChange` useEffect that references it in its dependency array (temporal dead zone).

**Why:** JavaScript `const` has a temporal dead zone — a `useEffect` dependency array is evaluated at render time, so if the useCallback comes after the useEffect in the component body, it throws `ReferenceError: computeChannelMasks is not defined`.
