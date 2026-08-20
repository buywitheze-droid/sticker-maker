---
name: Large raster preparation
description: Safety rules for determining alpha crops on very large uploaded raster artwork.
---

Use one oriented, native-depth alpha scan to determine crop eligibility, binary-alpha status, and visible bounds. If that analysis cannot complete consistently, keep the full source frame and do not classify it as hard-edged.

**Why:** Reduced alpha sampling can miss sparse or faint edges, while concurrent full-resolution trim pipelines can exceed the server memory limit on large transparent PNGs. A conservative full-frame result is safer than a partial crop or failed import.

**How to apply:** Keep alpha-coordinate measurement, soft-edge detection, and transparency eligibility in the same serialized image-preparation pass. Preserve 16-bit alpha values when the source provides them, and retain the endpoint-level large-raster regression when changing Sharp/libvips behavior.