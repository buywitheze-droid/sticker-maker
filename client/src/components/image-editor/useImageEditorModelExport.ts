import { useCallback, useRef } from "react";
import JSZip from "jszip";
import { EXPORT_DPI } from "./constants";
import {
  assertPrintSourcesReadable,
  canUseMemoryEfficientPngExport,
  decodePrintSourceAtSize,
  exportPngWithWorker,
  getDesignLabel,
  getExportMemoryWarning,
  injectPngDpi,
  resolveExportDpi,
} from "./utils";
import { drawPrintLabel, labelReadsUpsideDown } from "@/lib/print-label";
import { drawPrintLabelOnPdfPage } from "@/lib/print-label-pdf";
import type { ImageEditorBagAfterUploadCrop } from "./image-editor-hook-bag.types";
import { thresholdImageInfo } from "./useImageEditorModelHalftone";
import { isRecoverableImageInfo } from "@/lib/editor-draft-storage";
import {
  createVectorPrintSourceResolver,
  materialShortfalls,
  type VectorPrintSourceShortfall,
} from "@/lib/vector-print-source";
import type { DesignItem } from "@/lib/types";

/** Sheet names are customer-typed, so they cannot be trusted as filenames. */
function safeSheetFileName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "sheet";
}

/** Names Windows refuses to create a file for, whatever the extension. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Make a filename Windows will actually accept.
 *
 * The base name reaching here is a design name, which is usually an uploaded
 * filename and therefore anything at all: `Logo 3/4" <final>.png`, a pasted
 * path, a 300-character product title, emoji. The browser hands `download`
 * to the OS close to verbatim, so a single `:` or a trailing dot is enough to
 * fail the save after the sheet has already rendered — the expensive half of
 * the operation, thrown away at the last step.
 *
 * Only the illegal characters are replaced: the customer still recognises the
 * file they asked for.
 */
function safeDownloadFileName(filename: string, fallbackBase = "gangsheet"): string {
  const raw = String(filename ?? "");
  const dot = raw.lastIndexOf(".");
  const hasExt = dot > 0 && dot > raw.length - 12;
  const extension = hasExt ? raw.slice(dot + 1).replace(/[^a-z0-9]/gi, "") : "";
  const base = hasExt ? raw.slice(0, dot) : raw;

  const cleaned = base
    // Reserved on Windows, plus control characters, which also break the header.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, " ")
    // A name may not end in a dot or a space; Explorer silently strips them and
    // then cannot find the file it was told to write.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    // Long names are legal until the destination folder makes the whole path
    // exceed MAX_PATH, which is not something this side can measure.
    .slice(0, 120)
    .replace(/[.\s]+$/, "");

  const safeBase = WINDOWS_RESERVED_NAME.test(cleaned) ? `${cleaned}-sheet` : cleaned || fallbackBase;
  return extension ? `${safeBase}.${extension}` : safeBase;
}

/**
 * How long the blob URL behind a download has to stay alive.
 *
 * Revoking it is what ends the download, not the click: the browser reads the
 * blob while it writes the file, so the URL has to outlive the whole save.
 * That includes anything between the click and the first byte — a "Save as"
 * dialog waiting on the customer, SmartScreen, an antivirus hook — and then
 * the write itself, onto whatever disk or synced folder they chose.
 *
 * The old formula was `max(5s, bytes / 100_000)`, which reads as "longer for
 * bigger files" but is not: the division only overtakes the 5 second floor
 * above 500 MB, so every production sheet got exactly 5 seconds. A second per
 * megabyte from a one minute floor is generous in the units that matter, and
 * the cost of being generous is a blob held a little longer.
 */
function revokeDelayMs(bytes: number): number {
  const perMegabyte = Math.round(bytes / 1_000_000) * 1_000;
  return Math.min(20 * 60_000, Math.max(60_000, perMegabyte));
}

/** Structural shape of the parts of the File System Access API used here. */
type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  }>;
};
type ShowSaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

/** The customer dismissed the save dialog. Not a failure, so not a toast. */
class SaveCancelled extends Error {
  constructor() {
    super("The customer cancelled the save dialog.");
    this.name = "SaveCancelled";
  }
}

/**
 * When a sheet is big enough to be worth choosing a destination for up front.
 *
 * Below this the anchor download is quick and silent, and interrupting every
 * small download with a dialog to prevent a failure it will not have is a bad
 * trade. 120 megapixels is about a 22 x 60 inch sheet at 300 DPI.
 */
const PICKER_MIN_SHEET_PIXELS = 120_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  pdf: "application/pdf",
  zip: "application/zip",
};

/**
 * Ask the customer where to put the file *before* the sheet is rendered, and
 * write straight into it when the render finishes.
 *
 * This exists because the anchor-and-blob-URL download has a race no amount of
 * care removes: the object URL has to be revoked eventually, the browser is
 * reading it while it writes the file, and nothing tells the page when that
 * write has finished. Handing the bytes to a file the customer already chose
 * skips the blob URL, the revoke, and the copy the browser takes on the way to
 * disk — the sheet streams from blob storage into the file.
 *
 * It has to be requested on the click. The picker needs transient user
 * activation, and rendering a large gangsheet takes minutes, by which point the
 * activation from the click that started it is long gone. Asking first also
 * means a customer who changes their mind does so before the work, not after.
 *
 * Returns null whenever the API is unavailable or refuses — an unsupported
 * browser, or an embedded builder iframe, where it is blocked — and the caller
 * falls back to the anchor path.
 *
 * Accepting the dialog creates the file immediately, so an export that fails
 * afterwards leaves an empty one behind. That is the API's behaviour and not
 * something this side can defer; a visibly empty file is at least honest about
 * what happened.
 */
async function reserveSaveTarget(suggestedName: string): Promise<SaveFileHandle | null> {
  // Called as a method so `this` is the window; the API rejects a bare call.
  const host = window as unknown as { showSaveFilePicker?: ShowSaveFilePicker };
  if (typeof host.showSaveFilePicker !== "function") return null;
  const safeName = safeDownloadFileName(suggestedName);
  const extension = safeName.slice(safeName.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  try {
    return await host.showSaveFilePicker({
      suggestedName: safeName,
      types: mime ? [{ description: `${extension.toUpperCase()} file`, accept: { [mime]: [`.${extension}`] } }] : undefined,
    });
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") throw new SaveCancelled();
    // SecurityError in an iframe, NotAllowedError without activation, or an
    // implementation that does not have the API at all.
    console.warn("[export] save dialog unavailable; using the standard download", error);
    return null;
  }
}

/** Reserve a destination only for sheets large enough to justify the dialog. */
async function reserveTargetForLargeSheet(
  suggestedName: string,
  outputPixels: number,
): Promise<SaveFileHandle | null> {
  if (outputPixels < PICKER_MIN_SHEET_PIXELS) return null;
  return reserveSaveTarget(suggestedName);
}

/** Output pixels a sheet of this size has at print resolution. */
function sheetPixels(widthInches: number, heightInches: number): number {
  return Math.max(0, widthInches) * Math.max(0, heightInches) * EXPORT_DPI * EXPORT_DPI;
}

/** The name a sheet's file takes from the artwork on it. */
function exportBaseName(designs: Array<{ name?: string }>, fallbackFileName?: string): string {
  return (designs[0]?.name || fallbackFileName || 'gangsheet').replace(/\.[^/.]+$/, '');
}

const EMPTY_EXPORT_MESSAGE = "The export finished without producing any image data. Please try again.";

async function writeToSaveTarget(handle: SaveFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    // Leave no half-written file behind for a customer to send to a printer.
    try { await writable.abort?.(); } catch { /* already broken */ }
    throw error;
  }
}

export function useImageEditorModelExport(bag: ImageEditorBagAfterUploadCrop) {
  // Only the bag fields handleDownload actually uses are destructured here;
  // the full bag is still re-spread into the return so downstream consumers are unaffected.
  const {
    designs,
    imageInfo,
    artboardWidth,
    artboardHeight,
    toast,
    t,
    setIsProcessing,
    setExportProgressLabel,
    ensureDesignImagesAvailable,
  } = bag;

  /**
   * The sheet as it stands, read at the moment Download is pressed rather than captured in
   * the callback's dependency list.
   *
   * Export cares about the current sheet, so listing `designs` here was correct but
   * expensive: it gave `handleDownload` a new identity on every design mutation, and since
   * it is passed to `ControlsSection` as `onDownload` that alone defeated the component's
   * `React.memo` for the whole of every drag.
   */
  const exportLiveRef = useRef({ imageInfo, designs, artboardWidth, artboardHeight });
  exportLiveRef.current = { imageInfo, designs, artboardWidth, artboardHeight };

  /** Every sheet, read at the moment of export, for the same reason as above. */
  const exportSheetsRef = useRef({ sheets: bag.sheets, activeSheetId: bag.activeSheetId, artboardWidth });
  exportSheetsRef.current = { sheets: bag.sheets, activeSheetId: bag.activeSheetId, artboardWidth };

  /** White underbase settings, likewise read at export time rather than depended on. */
  const underbaseRef = useRef({ enabled: bag.whiteUnderbase, choke: bag.underbaseChokeIn });
  underbaseRef.current = { enabled: bag.whiteUnderbase, choke: bag.underbaseChokeIn };

  /**
   * Render one gangsheet to a print file and hand back the bytes.
   *
   * The sheet is passed in rather than read from the live editor, so the
   * all-sheets export can render sheets the customer is not currently looking
   * at. Returning the blob instead of saving it is what lets one caller
   * download a single sheet and another fold several into a ZIP.
   */
  const exportSheetBlob = useCallback(async (opts: {
    designs: DesignItem[];
    artboardWidth: number;
    artboardHeight: number;
    format: string;
    spotColorsByDesign?: Record<string, any[]>;
    /** Suppresses advisories that would otherwise repeat once per sheet in a batch. */
    quiet?: boolean;
  }): Promise<{ blob: Blob; baseName: string; extension: string; softDesigns: VectorPrintSourceShortfall[] }> => {
    const { imageInfo } = exportLiveRef.current;
    const { designs, artboardWidth, artboardHeight, format, spotColorsByDesign, quiet = false } = opts;
    try {
      const exportDesigns = await ensureDesignImagesAvailable(designs);
      if (exportDesigns.some(design => !isRecoverableImageInfo(design.imageInfo))) {
        throw new Error("A design image could not be reloaded. Your progress is saved; recover the draft and try again.");
      }
      const firstName = exportBaseName(exportDesigns, imageInfo?.file.name);

      await new Promise(r => setTimeout(r, 50));

      // Print source selection, matching the add-to-cart path.
      //
      // `imageInfo.image` is only the editor preview: rasters are capped at
      // MAX_STORED_IMAGE_DIMENSION and vectors at a screen-safe canvas size.
      // Drawing the download from it meant a design placed larger than its
      // preview was upscaled — a 12 in raster printed from 2000 px of real
      // detail, and a 20 in vector from 4096 px. `exportBlob` holds the
      // full-resolution source and gets decoded at the placement size instead,
      // with vector artwork re-rasterised from its retained geometry.
      //
      // Halftoned designs are the exception: their thresholded preview *is* the
      // artwork, so they keep drawing from `image`.
      const vectorSources = createVectorPrintSourceResolver();
      const vectorSourceByDesignId = new Map<string, Blob>();
      await Promise.all(
        exportDesigns.map(async d => {
          if (d.halftoned) return;
          const drawW = Math.max(1, Math.round(d.widthInches * d.transform.s * EXPORT_DPI));
          const drawH = Math.max(1, Math.round(d.heightInches * d.transform.s * EXPORT_DPI));
          const blob = await vectorSources.resolve(d.imageInfo, drawW, drawH);
          if (blob) vectorSourceByDesignId.set(d.id, blob);
        }),
      );
      const printSourceFor = (d: typeof exportDesigns[number]): Blob | undefined =>
        d.halftoned ? undefined : (vectorSourceByDesignId.get(d.id) ?? d.imageInfo.exportBlob);
      const printSourceCropFor = (d: typeof exportDesigns[number]) =>
        d.halftoned || vectorSourceByDesignId.has(d.id) ? undefined : d.imageInfo.exportCrop;

      // Check every print source can be read before rendering anything, for all
      // output formats.
      //
      // The PNG worker path asserts this too, but the PDF and non-worker canvas
      // paths reach their sources through `decodePrintSourceAtSize`, which
      // answers *any* failure — unsupported codec, wrong framing, unreadable
      // file — by returning null so the caller draws the preview instead. That
      // is right for a framing mismatch and wrong for a missing file: the
      // preview is capped at MAX_STORED_IMAGE_DIMENSION, so a fluorescent PDF
      // would have gone to the printer soft, with nothing said. Checked here,
      // once, so the answer cannot differ by format.
      await assertPrintSourcesReadable(
        exportDesigns.map(d => ({ source: printSourceFor(d), label: d.name })),
      );

      if (format === 'pdf') {
        const { PDFDocument, degrees } = await import('pdf-lib');
        const { addSpotColorVectorsToPDF, addSpotColorVectorsFromMasksToPDF } = await import('@/lib/spot-color-vectors');

        const exportDpi = EXPORT_DPI;
        const pageWidthPt = artboardWidth * 72;
        const pageHeightPt = artboardHeight * 72;
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

        for (const design of exportDesigns) {
          const drawW = Math.round(design.widthInches * design.transform.s * exportDpi);
          const drawH = Math.round(design.heightInches * design.transform.s * exportDpi);
          const sourceBlob = printSourceFor(design);
          const decoded = sourceBlob
            ? await decodePrintSourceAtSize(
                sourceBlob,
                printSourceCropFor(design),
                drawW,
                drawH,
                design.alphaThresholded,
                design.imageInfo.image,
              )
            : null;
          const img: ImageBitmap | HTMLImageElement = decoded ?? design.imageInfo.image;
          const cvs = document.createElement('canvas');
          cvs.width = drawW;
          cvs.height = drawH;
          const cctx = cvs.getContext('2d', { willReadFrequently: true });
          if (!cctx) { decoded?.close(); continue; }
          cctx.imageSmoothingEnabled = !design.alphaThresholded;
          if (design.transform.flipX || design.transform.flipY) {
            cctx.save();
            cctx.translate(design.transform.flipX ? drawW : 0, design.transform.flipY ? drawH : 0);
            cctx.scale(design.transform.flipX ? -1 : 1, design.transform.flipY ? -1 : 1);
            cctx.drawImage(img, 0, 0, drawW, drawH);
            cctx.restore();
          } else {
            cctx.drawImage(img, 0, 0, drawW, drawH);
          }

          // Full-resolution fluorescent knockout + spot masks. Classify every
          // export-DPI pixel by nearest centroid so CMYK is hard-cleared where
          // spot ink lives, and the same masks feed the PDF spot layers.
          const designSpotColors = spotColorsByDesign?.[design.id];
          const hasFluor = !!(designSpotColors?.some(
            (c: any) => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange,
          ));
          let spotVectorData: {
            masks: Record<string, Uint8Array>;
            channelNames: Record<string, string>;
            maskWidth: number;
            maskHeight: number;
          } | null = null;

          if (hasFluor && designSpotColors && designSpotColors.length > 0) {
            try {
              const colors = designSpotColors as any[];
              const centroids = colors.map((c: any) => c.rgb as { r: number; g: number; b: number });

              const hasRegionLevel = colors.some((c: any) =>
                c.regions && c.regions.length > 1 && c.regionMap &&
                c.regions.some((r: any) => r.spotFluorY || r.spotFluorM || r.spotFluorG || r.spotFluorOrange),
              );

              let lowResMap: { pixelMap: Int16Array; width: number; height: number } | null = null;
              if (hasRegionLevel) {
                const { buildPixelMapFromImage } = await import('@/lib/color-extractor');
                lowResMap = buildPixelMapFromImage(img as any, designSpotColors as any) ?? null;
              }

              const n = drawW * drawH;
              const mFY = new Uint8Array(n);
              const mFM = new Uint8Array(n);
              const mFG = new Uint8Array(n);
              const mFO = new Uint8Array(n);

              const imgDataFull = cctx.getImageData(0, 0, drawW, drawH);
              const pixels = imgDataFull.data;
              const lrW = lowResMap?.width ?? 1;
              const lrH = lowResMap?.height ?? 1;

              for (let py = 0; py < drawH; py++) {
                for (let px = 0; px < drawW; px++) {
                  const pi = py * drawW + px;
                  const alpha = pixels[pi * 4 + 3];
                  if (alpha < 10) continue;
                  const r = pixels[pi * 4];
                  const g = pixels[pi * 4 + 1];
                  const b = pixels[pi * 4 + 2];

                  let bestDist = Infinity;
                  let bestIdx = -1;
                  let secDist = Infinity;
                  let secIdx = -1;
                  for (let ki = 0; ki < centroids.length; ki++) {
                    const c = centroids[ki];
                    const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
                    if (d < bestDist) {
                      secDist = bestDist;
                      secIdx = bestIdx;
                      bestDist = d;
                      bestIdx = ki;
                    } else if (d < secDist) {
                      secDist = d;
                      secIdx = ki;
                    }
                  }
                  if (bestIdx < 0) continue;
                  const color = colors[bestIdx];
                  if (!color) continue;

                  // Projection confidence toward the colour-boundary midpoint
                  // between the two nearest centroids (1 = pure, 0.5 = edge).
                  let confidence = 1.0;
                  if (secIdx >= 0) {
                    const cA = centroids[bestIdx];
                    const cB = centroids[secIdx];
                    const vR = cB.r - cA.r;
                    const vG = cB.g - cA.g;
                    const vBc = cB.b - cA.b;
                    const dotVV = vR * vR + vG * vG + vBc * vBc;
                    if (dotVV > 0) {
                      const t = ((r - cA.r) * vR + (g - cA.g) * vG + (b - cA.b) * vBc) / dotVV;
                      confidence = Math.max(0, Math.min(1, 1 - t));
                    }
                  }

                  const isInk = confidence >= 0.5 && alpha >= 10;
                  if (!isInk) continue;

                  const assignInk = (fy: boolean, fm: boolean, fg: boolean, fo: boolean) => {
                    if (fy) mFY[pi] = 255;
                    if (fm) mFM[pi] = 255;
                    if (fg) mFG[pi] = 255;
                    if (fo) mFO[pi] = 255;
                  };

                  if (color.regions && color.regions.length > 1 && color.regionMap && lowResMap) {
                    const mx = Math.min(Math.floor((px * lrW) / drawW), lrW - 1);
                    const my = Math.min(Math.floor((py * lrH) / drawH), lrH - 1);
                    const ri = (color.regionMap as Int16Array)[my * lrW + mx] ?? -1;
                    if (ri < 0 || !color.regions[ri]) continue;
                    const region = color.regions[ri];
                    assignInk(region.spotFluorY, region.spotFluorM, region.spotFluorG, region.spotFluorOrange);
                  } else {
                    assignInk(color.spotFluorY, color.spotFluorM, color.spotFluorG, color.spotFluorOrange);
                  }
                }
              }

              // Hard binary knockout — clear CMYK alpha wherever spot ink lives.
              for (let pi = 0; pi < n; pi++) {
                if (mFY[pi] || mFM[pi] || mFG[pi] || mFO[pi]) {
                  imgDataFull.data[pi * 4 + 3] = 0;
                }
              }
              cctx.putImageData(imgDataFull, 0, 0);

              const cNames = {
                FY: (colors[0]?.spotFluorYName as string) || 'FY',
                FM: (colors[0]?.spotFluorMName as string) || 'FM',
                FG: (colors[0]?.spotFluorGName as string) || 'FG',
                FO: (colors[0]?.spotFluorOrangeName as string) || 'FO',
              };
              const allChannelMasks: Record<string, Uint8Array> = {
                FY: mFY, FM: mFM, FG: mFG, FO: mFO,
              };
              const activeMasks: Record<string, Uint8Array> = {};
              for (const [ch, m] of Object.entries(allChannelMasks)) {
                if (m.some((v) => v > 0)) activeMasks[ch] = m;
              }
              if (Object.keys(activeMasks).length > 0) {
                spotVectorData = {
                  masks: activeMasks,
                  channelNames: { FY: cNames.FY, FM: cNames.FM, FG: cNames.FG, FO: cNames.FO },
                  maskWidth: drawW,
                  maskHeight: drawH,
                };
              }
            } catch (koErr) {
              console.warn('[Knockout] mask build failed, skipping:', koErr);
            }
          }

          let pngDataUrl: string;
          try {
            pngDataUrl = cvs.toDataURL('image/png');
          } catch (err) {
            console.warn('Canvas toDataURL failed for design', design.id, err);
            decoded?.close();
            continue;
          }
          const base64 = pngDataUrl.split(',')[1];
          if (!base64) {
            console.warn('Invalid PNG data URL for design', design.id);
            decoded?.close();
            continue;
          }
          const pngBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const pdfImage = await pdfDoc.embedPng(pngBytes);

          const designWidthPt = design.widthInches * design.transform.s * 72;
          const designHeightPt = design.heightInches * design.transform.s * 72;
          const centerXPt = design.transform.nx * pageWidthPt;
          const centerYPt = pageHeightPt - design.transform.ny * pageHeightPt;
          const rotDeg = design.transform.rotation ?? 0;
          const rotRad = (-rotDeg * Math.PI) / 180;
          const cosR = Math.cos(rotRad);
          const sinR = Math.sin(rotRad);

          page.drawImage(pdfImage, {
            x: centerXPt - (designWidthPt / 2) * cosR + (designHeightPt / 2) * sinR,
            y: centerYPt - (designWidthPt / 2) * sinR - (designHeightPt / 2) * cosR,
            width: designWidthPt,
            height: designHeightPt,
            rotate: degrees(-rotDeg),
          });

          const pdfLabel = getDesignLabel(design);
          if (pdfLabel) {
            const { StandardFonts } = await import('pdf-lib');
            const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            drawPrintLabelOnPdfPage(page, font, pdfLabel, {
              centerXPt,
              centerYPt,
              rotationDeg: rotDeg,
              artHeightInches: design.heightInches * design.transform.s,
              artHeightPt: designHeightPt,
            }, degrees);
          }

          if (spotVectorData) {
            const designWidthIn = design.widthInches * design.transform.s;
            const designHeightIn = design.heightInches * design.transform.s;
            const centerXIn = design.transform.nx * artboardWidth;
            const centerYIn = design.transform.ny * artboardHeight;
            await addSpotColorVectorsFromMasksToPDF(
              pdfDoc,
              page,
              spotVectorData.masks,
              spotVectorData.maskWidth,
              spotVectorData.maskHeight,
              spotVectorData.channelNames,
              designWidthIn,
              designHeightIn,
              artboardHeight,
              centerXIn - designWidthIn / 2,
              centerYIn - designHeightIn / 2,
              design.transform.rotation ?? 0,
            );
          } else if (spotColorsByDesign) {
            // Non-fluorescent spots (white/gloss) still use the trace path.
            const colors = spotColorsByDesign[design.id];
            if (colors && colors.length > 0) {
              const hasOther = colors.some((c: any) => c.spotWhite || c.spotGloss);
              if (hasOther) {
                const offsetXInches = design.transform.nx * artboardWidth - (design.widthInches * design.transform.s) / 2;
                const offsetYInches = design.transform.ny * artboardHeight - (design.heightInches * design.transform.s) / 2;
                await addSpotColorVectorsToPDF(
                  pdfDoc, page, img, colors,
                  design.widthInches * design.transform.s,
                  design.heightInches * design.transform.s,
                  artboardHeight,
                  offsetXInches,
                  offsetYInches,
                  design.transform.rotation ?? 0,
                );
              }
            }
          }
          cvs.width = 0;
          cvs.height = 0;
          decoded?.close();
        }

        // ── White underbase (RDG_WHITE) ─────────────────────────────────────
        // Added after every design is on the page, because it is built from
        // the silhouette of the finished sheet rather than any one design.
        // Failure here costs the sheet its underbase, never its export: the
        // PDF is already complete and printable at this point.
        const underbase = underbaseRef.current;
        if (underbase.enabled) {
          try {
            const { buildWhiteUnderbaseMask } = await import('@/lib/white-underbase');
            const built = buildWhiteUnderbaseMask(
              exportDesigns.map(d => ({
                imageInfo: d.imageInfo,
                widthInches: d.widthInches,
                heightInches: d.heightInches,
                transform: d.transform,
              })),
              artboardWidth,
              artboardHeight,
              { enabled: true, choke: underbase.choke },
            );
            if (built) {
              const { addSpotColorVectorsFromMasksToPDF } = await import('@/lib/spot-color-vectors');
              await addSpotColorVectorsFromMasksToPDF(
                pdfDoc,
                page,
                { WHITE: built.mask },
                built.width,
                built.height,
                { WHITE: 'RDG_WHITE' },
                // The mask spans the sheet, so it is placed at the origin with
                // no rotation and the page's own dimensions.
                artboardWidth,
                artboardHeight,
                artboardHeight,
                0,
                0,
                0,
              );
            }
          } catch (err) {
            console.warn('[WhiteUnderbase] could not add the RDG_WHITE layer:', err);
          }
        }

        const pdfBytes = await pdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        return {
          blob: pdfBlob,
          baseName: firstName,
          extension: 'pdf',
          softDesigns: materialShortfalls(vectorSources),
        };
      } else {
        const useWorker = canUseMemoryEfficientPngExport();
        const memoryWarning = getExportMemoryWarning();
        if (memoryWarning && !quiet) {
          toast({
            title: t("toast.exportMemoryWarning"),
            description: memoryWarning,
          });
        }

        // A download can be downgraded and still be useful — the customer sees
        // the toast and knows what they got. The cart path makes the opposite
        // call on the same numbers, because nobody inspects a production file
        // before it is printed.
        const resolved = resolveExportDpi(artboardWidth, artboardHeight, useWorker);
        const exportDpi = resolved.dpi;
        if (resolved.clamped && !quiet) {
          toast({
            title: t("toast.largeSheet"),
            description: t("toast.largeSheetDesc", { dpi: Math.floor(exportDpi) }),
          });
        }
        if (!useWorker && !quiet) {
          toast({
            title: t("toast.exportCompatibilityWarning"),
            description: t("toast.exportCompatibilityWarningDesc"),
          });
        }

        const outW = Math.max(1, Math.round(artboardWidth * exportDpi));
        const outH = Math.max(1, Math.round(artboardHeight * exportDpi));

        let pngBlob: Blob;

        // ── Pre-clean halftoned designs ─────────────────────────────────────────
        // Halftoned designs have binary alpha. However, when drawn at a scaled or
        // rotated size on a canvas, bilinear interpolation reintroduces fringe
        // pixels.  We eliminate this by re-thresholding the source image first,
        // then using nearest-neighbour scaling (alphaThresholded flag, already set).
        const halftoneCleanMap = new Map<string, import("@/lib/types").ImageInfo>();
        await Promise.all(
          designs
            .filter(d => d.halftoned)
            .map(async d => {
              const cleaned = await thresholdImageInfo(d.imageInfo);
              if (cleaned) halftoneCleanMap.set(d.id, cleaned);
            })
        );
        const exportSrc = exportDesigns.map(d =>
          halftoneCleanMap.has(d.id)
            ? { ...d, imageInfo: halftoneCleanMap.get(d.id)! }
            : d
        );

        if (useWorker) {
          const result = await exportPngWithWorker({
            designs: exportSrc.map(d => ({
              widthInches: d.widthInches,
              heightInches: d.heightInches,
              nx: d.transform.nx,
              ny: d.transform.ny,
              s: d.transform.s,
              rotation: d.transform.rotation,
              flipX: d.transform.flipX,
              flipY: d.transform.flipY,
              image: d.imageInfo.image,
              sourceBlob: printSourceFor(d),
              sourceCrop: printSourceCropFor(d),
              alphaThresholded: d.alphaThresholded,
              printFileName: d.printFileName,
              name: d.name,
              label: getDesignLabel(d) ?? undefined,
            })),
            outW,
            outH,
            exportDpi,
            onProgress: ({ phase, completed, total }) => {
              if (phase === "preparing") {
                setExportProgressLabel(t("editor.exportPreparing"));
              } else if (phase === "rendering") {
                setExportProgressLabel(t("editor.exportRendering", { completed, total }));
              } else {
                setExportProgressLabel(t("editor.exportFinalizing"));
              }
            },
          });
          setExportProgressLabel(t("editor.exportFinalizing"));
          pngBlob = result.blob;
        } else {
          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = outW;
          exportCanvas.height = outH;
          const ctx = exportCanvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Failed to prepare export canvas');
          ctx.clearRect(0, 0, outW, outH);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          for (const design of exportSrc) {
            const drawW = Math.max(1, Math.round(design.widthInches * design.transform.s * exportDpi));
            const drawH = Math.max(1, Math.round(design.heightInches * design.transform.s * exportDpi));
            const sourceBlob = printSourceFor(design);
            const decoded = sourceBlob
              ? await decodePrintSourceAtSize(
                  sourceBlob,
                  printSourceCropFor(design),
                  drawW,
                  drawH,
                  design.alphaThresholded,
                  design.imageInfo.image,
                )
              : null;
            const img: ImageBitmap | HTMLImageElement = decoded ?? design.imageInfo.image;
            const centerX = design.transform.nx * outW;
            const centerY = design.transform.ny * outH;
            if (design.alphaThresholded) ctx.imageSmoothingEnabled = false;
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate((design.transform.rotation * Math.PI) / 180);
            ctx.scale(design.transform.flipX ? -1 : 1, design.transform.flipY ? -1 : 1);
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            // Same layout the worker path and the preview use. This fallback used to put the
            // label inside the bottom-right corner unconditionally while they put it below,
            // so which of the two a customer got depended on whether the worker was available.
            const fallbackLabel = getDesignLabel(design);
            const fallbackArtH = design.heightInches * design.transform.s;
            if (fallbackLabel && fallbackArtH > 0) {
              ctx.scale(design.transform.flipX ? -1 : 1, design.transform.flipY ? -1 : 1);
              drawPrintLabel(
                ctx, fallbackLabel, drawH / fallbackArtH,
                labelReadsUpsideDown(design.transform.rotation),
              );
              ctx.scale(design.transform.flipX ? -1 : 1, design.transform.flipY ? -1 : 1);
            }
            ctx.restore();
            if (design.alphaThresholded) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
            decoded?.close();
          }
          const rawBlob: Blob = await new Promise((res, rej) =>
            exportCanvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
          exportCanvas.width = 0;
          exportCanvas.height = 0;
          pngBlob = await injectPngDpi(rawBlob, exportDpi);
        }

        // `materialShortfalls` and not `shortfalls()`: the import preview is
        // clamped to 4096 px, which is still 300 DPI up to about 13.6 in, so most
        // failures cost nothing. Warning on all of them would put "your print will
        // be soft" in front of customers whose print is fine, which is how a
        // warning gets ignored for the one design where it matters.
        return {
          blob: pngBlob,
          baseName: firstName,
          extension: 'png',
          softDesigns: materialShortfalls(vectorSources),
        };
      }
    } finally {
      setExportProgressLabel(undefined);
    }
  }, [toast, t, setExportProgressLabel, ensureDesignImagesAvailable]);

  /**
   * Save a blob to the customer's machine.
   *
   * Everything that reaches a customer's disk goes through here, so this is
   * where the filename is made safe and the empty-file case is caught. An
   * export that silently produced nothing used to save a 0-byte file, which
   * looks like a successful download until it is opened.
   */
  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    if (!blob || blob.size === 0) {
      throw new Error(EMPTY_EXPORT_MESSAGE);
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeDownloadFileName(filename);
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    let revoked = false;
    const onPageHide = (event: PageTransitionEvent) => {
      // `pagehide` also fires when the document enters the back/forward cache,
      // and such a page can be restored with the download still being written.
      // Only a real teardown is the moment this URL is certainly finished with;
      // revoking on a bfcache entry would throw away a live download.
      if (!event.persisted) revoke();
    };
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      window.removeEventListener('pagehide', onPageHide);
      URL.revokeObjectURL(url);
    };
    window.addEventListener('pagehide', onPageHide);
    window.setTimeout(revoke, revokeDelayMs(blob.size));
  }, []);

  /**
   * Put a finished sheet where it belongs: into the file the customer chose
   * before the render started, or, when there is no such file, through the
   * anchor download.
   */
  const saveExport = useCallback(async (
    blob: Blob,
    filename: string,
    target: SaveFileHandle | null,
  ) => {
    if (!target) {
      triggerDownload(blob, filename);
      return;
    }
    if (!blob || blob.size === 0) throw new Error(EMPTY_EXPORT_MESSAGE);
    await writeToSaveTarget(target, blob);
  }, [triggerDownload]);

  /**
   * Warn when a sheet that just downloaded is softer than it should be.
   *
   * A vector whose print-resolution re-render failed falls back to the import
   * preview: the file still exports, so nothing else fails and nothing else
   * would ever mention it. Raised after the download rather than before, so a
   * fault in the warning cannot cost someone their export.
   */
  const warnAboutSoftDesigns = useCallback((softDesigns: VectorPrintSourceShortfall[]) => {
    if (softDesigns.length === 0) return;
    console.warn("[export] designs printed below target resolution:", softDesigns);
    toast({
      title: t("toast.exportVectorQualityReduced"),
      description: t("toast.exportVectorQualityReducedDesc", { count: softDesigns.length }),
      variant: "destructive",
    });
  }, [toast, t]);

  const handleDownload = useCallback(async (
    _downloadType: string = 'standard',
    format: string = 'png',
    spotColorsByDesign?: Record<string, any[]>,
  ) => {
    const { designs, imageInfo, artboardWidth, artboardHeight } = exportLiveRef.current;
    if (designs.length === 0) {
      toast({ title: t("toast.noDesigns"), description: t("toast.noDesignsDesc"), variant: "destructive" });
      return;
    }
    try {
      // Before the render, while the click still counts as user activation.
      const target = await reserveTargetForLargeSheet(
        `${exportBaseName(designs, imageInfo?.file.name)}.${format === 'pdf' ? 'pdf' : 'png'}`,
        sheetPixels(artboardWidth, artboardHeight),
      );
      setIsProcessing(true);
      await new Promise(r => setTimeout(r, 50));
      const { blob, baseName, extension, softDesigns } = await exportSheetBlob({
        designs, artboardWidth, artboardHeight, format, spotColorsByDesign,
      });
      await saveExport(blob, `${baseName}.${extension}`, target);
      warnAboutSoftDesigns(softDesigns);
    } catch (error) {
      if (error instanceof SaveCancelled) return;
      console.error("Download failed:", error);
      toast({ title: t("toast.downloadFailed"), description: error instanceof Error ? error.message : t("toast.downloadFailedDesc"), variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [toast, t, setIsProcessing, exportSheetBlob, saveExport, warnAboutSoftDesigns]);

  /**
   * Download every sheet that has artwork on it.
   *
   * One sheet saves as a plain file; several are zipped, because ten separate
   * save prompts is not a download. Sheets are rendered one at a time rather
   * than in parallel: each one holds a full-resolution canvas, and a phone
   * building four at once runs out of memory.
   */
  const handleDownloadAllSheets = useCallback(async (
    format: string = 'png',
    spotColorsByDesign?: Record<string, any[]>,
  ) => {
    const { sheets, artboardWidth } = exportSheetsRef.current;
    const sheetsWithDesigns = sheets.filter(s => s.designs.length > 0);
    if (sheetsWithDesigns.length === 0) {
      toast({ title: t("toast.noDesigns"), description: t("toast.noDesignsDesc"), variant: "destructive" });
      return;
    }
    const extension = format === 'pdf' ? 'pdf' : 'png';
    const multiple = sheetsWithDesigns.length > 1;
    try {
      // One reservation covers the whole batch, whether it ends up as a single
      // sheet or a ZIP, and it has to happen on the click.
      const target = await reserveTargetForLargeSheet(
        multiple
          ? 'gangsheet-export.zip'
          : `${safeSheetFileName(sheetsWithDesigns[0].name)}.${extension}`,
        sheetsWithDesigns.reduce((sum, s) => sum + sheetPixels(artboardWidth, s.artboardHeight), 0),
      );
      setIsProcessing(true);
      await new Promise(r => setTimeout(r, 50));
      const allSoftDesigns: VectorPrintSourceShortfall[] = [];

      if (!multiple) {
        const sheet = sheetsWithDesigns[0];
        const { blob, extension: ext, softDesigns } = await exportSheetBlob({
          designs: sheet.designs,
          artboardWidth,
          artboardHeight: sheet.artboardHeight,
          format,
          // Spot selections accumulate by design id across the session; pass the
          // full map so every sheet can look up its own fluorescent assignments.
          spotColorsByDesign,
        });
        await saveExport(blob, `${safeSheetFileName(sheet.name)}.${ext}`, target);
        warnAboutSoftDesigns(softDesigns);
        return;
      }

      const zip = new JSZip();
      for (let i = 0; i < sheetsWithDesigns.length; i++) {
        const sheet = sheetsWithDesigns[i];
        setExportProgressLabel(t("editor.exportSheetProgress", { current: i + 1, total: sheetsWithDesigns.length }));
        const { blob, extension: ext, softDesigns } = await exportSheetBlob({
          designs: sheet.designs,
          artboardWidth,
          artboardHeight: sheet.artboardHeight,
          format,
          spotColorsByDesign,
          quiet: i > 0,
        });
        zip.file(`sheet-${i + 1}-${safeSheetFileName(sheet.name)}.${ext}`, blob);
        allSoftDesigns.push(...softDesigns);
      }
      setExportProgressLabel(t("editor.exportFinalizing"));
      // Stored, not deflated. Every entry is a PNG or a PDF, so it is already
      // compressed: deflating it again spends minutes of main-thread time and a
      // second copy of the whole archive to save a fraction of a percent, and
      // that second copy is what a large multi-sheet export runs out of.
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      await saveExport(zipBlob, 'gangsheet-export.zip', target);
      toast({
        title: t("toast.exportComplete"),
        description: t("toast.exportCompleteDesc", { n: sheetsWithDesigns.length }),
      });
      warnAboutSoftDesigns(allSoftDesigns);
    } catch (error) {
      if (error instanceof SaveCancelled) return;
      console.error("Multi-sheet download failed:", error);
      toast({ title: t("toast.downloadFailed"), description: error instanceof Error ? error.message : t("toast.downloadFailedDesc"), variant: "destructive" });
    } finally {
      setExportProgressLabel(undefined);
      setIsProcessing(false);
    }
  }, [toast, t, setIsProcessing, setExportProgressLabel, exportSheetBlob, saveExport, warnAboutSoftDesigns]);

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }, []);


  return {
    ...bag,
    handleDownload,
    handleDownloadAllSheets,
    fileToDataUrl,
  };
}
