---
name: GitHub reference repo
description: The sticker app repo this project is based on / compared against for UI parity.
---

**URL:** https://github.com/buywitheze-droid/sticker-maker

**Color detection list UI (reference):**
- Each color card: `w-8 h-8` swatch + hex code + `X.X%` percentage
- Threshold: colors with >= 1% of image pixels
- List always visible (no collapse) when the spot-color panel is open
- Expand chevron per color when it has multiple region "shapes"
- Channel buttons (FY/FM/FG/FO in our app, White/Gloss in theirs) inline per row

**Why:** User explicitly asked to match this reference for color list layout.
