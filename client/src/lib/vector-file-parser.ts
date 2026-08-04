/**
 * vector-file-parser.ts
 *
 * Converts PDF, SVG, and EPS files to PNG on the server and returns a
 * fully-typed result with accurate physical dimensions.
 *
 * All three formats go through the same `/api/convert-file` endpoint which
 * uses the right tool for each format:
 *   PDF → pdftocairo (poppler, proper transparency + exact MediaBox/CropBox dims)
 *   SVG → Sharp/libvips  (native librsvg, respects in/mm/pt/px units)
 *   EPS → GhostScript    (pngalpha device, exact BoundingBox crop)
 */

export interface VectorParseResult {
  /** PNG-encoded image ready to display / draw to canvas. */
  image: HTMLImageElement;
  /** PNG File object (can be stored in ImageInfo.file). */
  pngFile: File;
  /** Width in inches (computed from DPI + pixel dimensions). */
  widthInches: number;
  /** Height in inches (computed from DPI + pixel dimensions). */
  heightInches: number;
  /** DPI used for rasterisation (always 300). */
  dpi: number;
  /** Pixel width of the rendered PNG. */
  widthPx: number;
  /** Pixel height of the rendered PNG. */
  heightPx: number;
  /**
   * Only present for PDF files. Total page count in the source document.
   * When > 1, the server only imported page 1 — callers should warn the user.
   */
  pageCount?: number;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load converted image")); };
    img.src = url;
  });
}

/**
 * Upload a vector file to the server for conversion and return a
 * rasterised PNG with accurate physical dimensions.
 */
export async function parseVectorFile(file: File): Promise<VectorParseResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/convert-file", { method: "POST", body: form });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { detail = await res.text(); }
    throw new Error(`Server conversion failed (${res.status}): ${detail}`);
  }

  const { pngBase64, widthPx, heightPx, dpi, widthInches, heightInches, pageCount } =
    await res.json() as {
      pngBase64: string;
      widthPx: number;
      heightPx: number;
      dpi: number;
      widthInches: number;
      heightInches: number;
      /** Only present for PDFs; total page count in the document. */
      pageCount?: number;
    };

  // Decode the base64 PNG
  const byteChars = atob(pngBase64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/png" });

  const pngFile = new File(
    [blob],
    file.name.replace(/\.[^.]+$/, ".png"),
    { type: "image/png" },
  );

  const image = await loadImageFromBlob(blob);

  return { image, pngFile, widthInches, heightInches, dpi, widthPx, heightPx, pageCount };
}

/** Returns true for the three vector formats we support. */
export function isVectorFile(file: File): boolean {
  const ext = file.name.toLowerCase();
  return (
    ext.endsWith(".pdf") || file.type === "application/pdf" ||
    ext.endsWith(".svg") || file.type === "image/svg+xml" ||
    ext.endsWith(".eps") || file.type === "application/postscript" ||
    file.type === "application/eps" || file.type === "application/x-eps"
  );
}
