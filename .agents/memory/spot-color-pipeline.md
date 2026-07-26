---
name: Gangsheet spot color pipeline
description: How fluorescent spot color layers are built, vectorized, and embedded in the PDF export.
---

## Architecture

Fluorescent channels (FY/FM/FG/FO) go through two separate pipelines:

### 1. Mask build (image-editor.tsx — handleDownload)
- Binary masks (`mFY` etc.) and soft-alpha masks (`sfFY` etc.) built at export DPI (300) from canvas pixel data.
- Nearest + second-nearest centroid in one pass; `confidence ≥ 0.5` threshold for binary ink.
- CMYK knockout: hard binary — `mF*[pi] > 0 → alpha = 0` on the CMYK canvas.
- Result packed into `spotVectorData: { masks, channelNames, maskWidth, maskHeight, widthInches, heightInches }`.

### 2. Vectorization (addSpotColorVectorsFromMasksToPDF in spot-color-vectors.ts)
- Masks transferred to web worker via `trace_premask` message.
- Worker scales mask to target DPI resolution (usually 1:1 since masks are already at 300 DPI).
- Worker calls `traceMaskToInchPaths` → returns closed polygon contours in design-local inches (Y-down, 0,0 = top-left).
- Contours embedded as PDF vector paths (`m/l/h/f*`) in Separation colorspace OCG layers.

### 3. Coordinate transform (addSpotColorVectorsFromMasksToPDF)
Critical formula — paths are in Y-down image space, output must be PDF Y-up page space:
```
relX = p.x - widthInches/2
relY = p.y - heightInches/2
x_pdf = designCx + relX*cosR + relY*sinR        ← NOTE: +relY*sinR (not minus)
y_pdf = (pageH - designCy) + relX*sinR - relY*cosR  ← NOTE: -relY*cosR (not plus)
```
**Why:** The standard Y-up rotation matrix has the wrong cross-term signs when relY is in Y-down image space. Using the standard matrix causes correct output at 0° but growing mismatch at any non-zero rotation.

**How to apply:** Any time a new vector path coordinate transform is added for spot layers, verify using this formula, not the standard 2D rotation matrix.

---

## Worker pipeline (spot-color-worker.ts — traceMaskToInchPaths)

1. **Marching squares** — traces pixel boundaries. Comparisons MUST use `> 0` not `=== 1` because fluorescent masks use value 255, not 1. White/gloss masks (from createClosestColorMask) use 1 — both work with `> 0`.
2. **collapseCollinear** — merges same-direction pixel steps.
3. **Pre-filter ≥ 200 px²** — drop noise contours before expensive processing. Without this, complex designs produce thousands of tiny fragments.
4. **Douglas-Peucker ε=1px** — collapses staircase runs into diagonal segments.
5. **Winding detection** — `signedArea(simplified)`: positive = CW in Y-down = outer filled contour; negative = CCW = inner hole contour.
6. **Chaikin ×2 (outer only)** — smooth outer edges to quadratic B-spline curves. **Never apply Chaikin to hole contours** — Chaikin shrinks polygons; applied to holes it collapses thin ink rings and floods the enclosed white area with solid ink.
7. **Post-filter ≥ 2e-4 sq in** — sanity check after smoothing.

---

## Known gotchas

- **Mask value 255 vs 1**: marching squares was written for `createClosestColorMask` (value=1). Fluorescent masks use 255. All comparisons must be `> 0`.
- **Chaikin on holes**: causes catastrophic fill flood on ring-shaped regions (e.g. an outline/rim around a character). Detect via signed area; skip Chaikin for negative (hole) contours.
- **Rotation formula**: the Y-down→Y-up cross-term sign flip is non-obvious. The bug is invisible at 0° rotation and grows with rotation angle.
- **Content stream size**: at Chaikin ×3, each contour's point count is multiplied by 8. On complex designs with hundreds of contours this produces 10MB+ streams. Keep at ×2 max; use the pre-filter aggressively.
- **softMask arrays** (`sfFY` etc.) are still computed in image-editor.tsx but are unused since the switch to vectors. They can be safely removed in a future cleanup.
