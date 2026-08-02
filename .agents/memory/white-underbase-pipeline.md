---
name: White underbase pipeline
description: How the RDG_WHITE spot color layer is built — silhouette approach, choke algorithm, and key design decisions.
---

## Architecture

Full-sheet silhouette approach (NOT color-tagging like fluorescent channels):
- Automatically covers every design pixel; no user tagging needed.

### Step 1 — Silhouette at 50 DPI (halftone averages out)

Render all designs onto a canvas at **SILHOUETTE_DPI = 50 DPI** (well below 35 LPI halftone frequency). Browser bilinear scaling averages halftone dots into smooth tint values. Threshold at alpha ≥ 13 (5% of 255). Nearest-neighbour upscale to EDT_DPI = 150 DPI.

**Why not 150 DPI?** At 150 DPI, a 35 LPI halftone has a cell of 4.3 px — individual dots appear as isolated blobs with transparent gaps, causing the white layer to trace thousands of individual dot contours instead of one solid shape. Rendering at 50 DPI (cell = 1.43 px → sub-pixel) eliminates this completely.

**Why not morphological closing?** Two attempts failed — first attempt used a right-aligned sliding window instead of a centered one; second attempt's closing radius was too aggressive for sparse designs (fireworks). The 50 DPI render approach is simpler, correct, and needs no morphological operations.

### Step 2 — Detail-safe standard choke

**NOT variable choke.** Single `chokeDistance` parameter (default 0.010"). Two-pass EDT:

1. `edtOrig` = EDT of silhouette (distance to design boundary)
2. `coreMask` = pixels where `edtOrig > chokeRadius` (survived standard erosion)
3. `edtCore` = EDT of ~coreMask (distance to nearest surviving pixel)
4. Keep pixel if: `edtOrig > chokeRadius` **OR** (`edtCore > 2×chokeRadius` AND `edtOrig > 0.002"×150`)

The second condition catches isolated thin features (strokes, fine trails) that would completely vanish under standard erosion — they get a minimal 0.002" choke instead.

### Step 3 — Vector output

Output mask (Uint8Array, 255/0) passed to `addSpotColorVectorsFromMasksToPDF` as `{ WHITE: mask }` with channel name `{ WHITE: 'RDG_WHITE' }`. CMYK tint `[0,0,0,0]` (invisible in PDF viewers; RIP identifies channel by name).

## Key constants

| Constant | Value | Reason |
|---|---|---|
| SILHOUETTE_DPI | 50 | below halftone freq → dots average |
| EDT_DPI | 150 | 0.002" = 0.3 px; 0.010" = 1.5 px |
| ALPHA_THRESHOLD | 13 | ≥5% coverage |
| MIN_CHOKE_IN | 0.002" | fallback for thin features |
| default chokeIn | 0.010" | matches reference agent default |

## UI

Single "Choke (in)" input (max 0.1"), default 0.010". Label notes "thin features auto-protected · min 0.002"". Toggle stored in `underbbaseOptsRef.current.{enabled, choke}`.

**Why:** Previous two-input UI (thin/thick choke) was misleading and inconsistent with the reference pipeline, which uses standard choke with a detail-safe fallback.
