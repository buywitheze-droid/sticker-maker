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
**Why:** The standard Y-up rotation matrix has the wrong cross-term signs when relY is in Y-down image space.

---

## Worker pipeline (spot-color-worker.ts — traceMaskToInchPaths)

1. **Marching squares** — comparisons MUST use `> 0` not `=== 1` (fluorescent masks use 255, not 1).
2. **collapseCollinear** — merges same-direction pixel steps.
3. **Pre-filter** — outer ≥ 200 px², holes ≥ 25 px² (lower floor preserves small holes like the inside of an "o").
4. **Douglas-Peucker ε=1px** — iterative (explicit stack), never recursive — collapses staircase runs into diagonal segments.
5. **Winding detection** — `signedArea`: positive = CW = outer; negative = CCW = hole.
6. **Chaikin ×2 (outer only)** — **Never apply Chaikin to hole contours** — shrinks holes, floods enclosed white areas with ink.
7. **Post-filter** — outer ≥ 2e-4 sq in, holes ≥ 2.5e-5 sq in.

## Mask building thresholds (createClosestColorMask in the `trace` path)

**Correct values from the reference app (anycontour):**
- `colorTolerance = 60` (not 80 — tighter prevents cross-color bleed)
- `alphaThreshold = 240` (not 128 — excludes semi-transparent edge pixels that create ragged boundaries)
- `directTolerance = 80` (not 100)
- Morphological closing radius = `max(2, round(dpi/75))` pixels — bridges anti-alias gaps that would otherwise produce hundreds of tiny disconnected contours. Applied after `createClosestColorMask`, before tracing.

**Why:** Without morphological closing, anti-aliased pixels at color boundaries fail the color match and leave gaps → marching squares emits dozens of tiny isolated contours per color instead of one solid region.

---

## Preview overlay (controls-section.tsx + preview-section.tsx)

- `spotPreviewDataMap: Map<designId, SpotPreviewData>` in image-editor.tsx — each design stores its own preview state independently. Adding a new design never overwrites another design's preview.
- `pixelMapRef.current` reset to `null` on every design switch to prevent stale masks bleeding through.
- On `spotSelectionsRef` cache-hit (returning to a previously assigned design), `buildPixelMapFromImage` is re-run to rebuild the pixel map for that design's dimensions.
- Color list threshold: **0.1%** minimum pixel share — shows small details like eyes and tongues.

## Auto-assign (controls-section.tsx — autoAssignChannel)

Hue map (HSL):
- 45–80° → FY (yellows)
- 80–165° → FG (greens/lime)
- 15–45° → FO (oranges)
- 0–15° / 285–360° → FM (reds, hot-pinks, magentas)
- 165–285° → null (cyan/blue — no good fluorescent match)

**Saturation gate: s < 0.60 → skip.** Greys and muted tones sit at s=0.0–0.40; threshold at 0.60 ensures only vivid colors qualify. Lower values let warm-grey bleed into FM via its 0°/360° hue wrap.

---

## Known gotchas

- **Mask value 255 vs 1**: marching squares was built for white/gloss masks (value=1). Fluorescent masks use 255. All comparisons must be `> 0`.
- **Chaikin on holes**: collapses thin ink rings into solid fills. Always skip for CCW (negative signed area) contours.
- **Rotation formula**: Y-down→Y-up cross-term sign flip is non-obvious; standard matrix is wrong.
- **Content stream size**: Chaikin ×3 multiplies points 8×. Keep at ×2; use 200px² pre-filter.
- **Auto-assign saturation threshold**: do not lower below 0.50 or warm greys will bleed into FM.
- **softMask arrays** (`sfFY` etc.) still computed in image-editor.tsx but unused — safe to remove in cleanup.
