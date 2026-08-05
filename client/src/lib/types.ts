export interface ImageInfo {
  file: File;
  image: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
  isPDF?: boolean;
  originalPdfData?: ArrayBuffer;
  /**
   * Optional full-resolution PNG blob captured at upload time.
   *
   * The in-memory `image` field is downsampled to `MAX_STORED_IMAGE_DIMENSION`
   * so we don't hold multi-hundred-MP decoded rasters in RAM for every
   * layer. Export needs the un-degraded pixels — this blob is that
   * source. Decode on demand (`createImageBitmap` / `<img>.src=objectURL`)
   * at print time and free right after.
   */
  exportBlob?: Blob;
}

export interface ResizeSettings {
  widthInches: number;
  heightInches: number;
  maintainAspectRatio: boolean;
  outputDPI: number;
}

export interface StrokeSettings {
  enabled: boolean;
  width: number;
  color: string;
  alphaThreshold: number;
  autoBridging: boolean;
  autoBridgingThreshold: number;
  backgroundColor: string;
}

export interface ShapeSettings {
  enabled?: boolean;
  type: string;
  widthInches: number;
  heightInches: number;
  fillColor: string;
  cornerRadius: number;
  offset: number;
  offsetX: number;
  offsetY: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
}

export interface ImageTransform {
  nx: number;
  ny: number;
  s: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface DesignItem {
  id: string;
  imageInfo: ImageInfo;
  transform: ImageTransform;
  widthInches: number;
  heightInches: number;
  name: string;
  originalDPI: number;
  alphaThresholded?: boolean;
  halftoned?: boolean;
  printFileName?: boolean;
  /**
   * Optional group id. Designs sharing the same `groupId` are treated
   * as a single "super-item" by auto-arrange (their internal layout is
   * preserved and the whole cluster is packed as one bounding box).
   *
   * Reserved forward-compat field — the sticker-maker monolith does
   * not yet consume it, but we accept it in the data model so imported
   * / migrated designs from the Shopify build don't lose their
   * grouping information on round-trip.
   */
  groupId?: string;
}

export function computeLayerRect(
  imageWidthPx: number,
  imageHeightPx: number,
  transform: ImageTransform,
  artboardWidthPx: number,
  artboardHeightPx: number,
  artboardWidthInches: number,
  artboardHeightInches: number,
  imageWidthInches: number,
  imageHeightInches: number,
): { x: number; y: number; width: number; height: number } {
  const designWidthPx = (imageWidthInches / artboardWidthInches) * artboardWidthPx;
  const designHeightPx = (imageHeightInches / artboardHeightInches) * artboardHeightPx;

  const finalWidth = designWidthPx * transform.s;
  const finalHeight = designHeightPx * transform.s;

  const cx = transform.nx * artboardWidthPx;
  const cy = transform.ny * artboardHeightPx;

  return {
    x: cx - finalWidth / 2,
    y: cy - finalHeight / 2,
    width: finalWidth,
    height: finalHeight,
  };
}
