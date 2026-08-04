---
name: Vector file import tools
description: Server-side PDF/SVG/EPS → PNG conversion stack and related environment facts for the AnyNest gangsheet editor.
---

## Conversion tools available (NixOS/Replit)

| Format | Tool | Notes |
|--------|------|-------|
| SVG | Sharp (libvips native) | `sharp(buf, { density: 300 }).png()` — respects in/mm/pt/px units perfectly |
| PDF | `pdftocairo -png -r 300 -singlefile -cropbox` | poppler v25.07.0, on PATH, cairo-based = proper transparency |
| EPS | GhostScript `-sDEVICE=pngalpha -r300 -dEPSCrop` | NOT on PATH — use known nix path below |

**GhostScript known nix path:**
`/nix/store/00vaqa30dvhxr9308xldc5hmf3z3m37v-ghostscript-10.04.0/bin/gs`
(version 10.04.0; checked in `KNOWN_GS_PATHS[]` before slow `find` fallback)

**Why:** `gs` is not in $PATH on Replit NixOS. `magick` also requires gs for EPS but fails without it. Only direct nix-store path works.

**How to apply:** Any future EPS/PostScript feature must call gs via the nix store path. Keep `KNOWN_GS_PATHS` array in `server/routes.ts` updated if the nix hash changes.

## Dimension accuracy formula
All three tools: render at 300 DPI → `widthInches = widthPx / 300`.
- SVG with `width="3in"` → 900px at density=300 → 3.0" ✓
- PDF 8.5×11" letter → 2550×3300px ✓
- EPS BoundingBox 216×144pt (= 3×2") → 900×600px ✓

## waifu2x upscale worker
- Model: `deepghs/waifu2x_onnx` cunet art `noise1_scale2x.onnx` (~5MB), stored in `server/models/`
- Downloaded at worker startup via HuggingFace URL; worker is a persistent Python subprocess
- Model needs 18px reflect-padding per side; output = input×2 pixels exactly
- Queue: concurrency=1 (CPU); LRU cache by SHA-256(input+scale), max 20 entries
- Route: `POST /api/upscale-image`, field: `image` (PNG), `scale` (2|4)

## pip install (user-scope, NixOS)
Use `pip3 install --user --break-system-packages <pkg>` — system pip requires `--user` flag.
Packages installed: `onnxruntime`, `numpy`, `pillow` (via `--user --break-system-packages`).
