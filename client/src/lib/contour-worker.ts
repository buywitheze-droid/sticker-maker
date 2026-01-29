import ClipperLib from 'js-clipper';

interface Point {
  x: number;
  y: number;
}

// IMPORTANT: Must stay in sync with client/src/lib/clipper-constants.ts
// Web Workers can't import ES modules directly, so we duplicate the constant here
// If you change CLIPPER_SCALE in clipper-constants.ts, update it here too!
const CLIPPER_SCALE = 100000;

interface WorkerMessage {
  type: 'process';
  imageData: ImageData;
  strokeSettings: {
    width: number;
    color: string;
    enabled: boolean;
    alphaThreshold: number;
    closeSmallGaps: boolean;
    closeBigGaps: boolean;
    backgroundColor: string;
    useCustomBackground: boolean;
    autoBridging: boolean;
    autoBridgingThreshold: number;
  };
  effectiveDPI: number;
  previewMode?: boolean;
}

interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  imageData?: ImageData;
  error?: string;
  progress?: number;
  // Cached contour data for fast PDF export
  contourData?: {
    pathPoints: Array<{x: number; y: number}>;
    widthInches: number;
    heightInches: number;
    imageOffsetX: number;
    imageOffsetY: number;
    backgroundColor: string;
    useEdgeBleed: boolean;
  };
}

// Maximum dimension for any processing to prevent browser crashes
// 4000px is safe for most browsers while maintaining quality
const MAX_SAFE_DIMENSION = 4000;

self.onmessage = function(e: MessageEvent<WorkerMessage>) {
  const { type, imageData, strokeSettings, effectiveDPI, previewMode } = e.data;
  
  if (type === 'process') {
    try {
      postProgress(10);
      
      // Determine target dimension based on mode
      // Preview mode: 400px for instant rendering
      // Non-preview: 4000px max to prevent browser crashes
      const maxPreviewDimension = 400;
      const maxDim = Math.max(imageData.width, imageData.height);
      
      let targetMaxDim: number;
      if (previewMode && maxDim > maxPreviewDimension) {
        targetMaxDim = maxPreviewDimension;
      } else if (maxDim > MAX_SAFE_DIMENSION) {
        targetMaxDim = MAX_SAFE_DIMENSION;
      } else {
        targetMaxDim = maxDim; // No scaling needed
      }
      
      const shouldDownscale = maxDim > targetMaxDim;
      
      let processedData: ImageData;
      let contourData: WorkerResponse['contourData'];
      let scale = 1;
      
      if (shouldDownscale) {
        scale = targetMaxDim / maxDim;
        const scaledWidth = Math.round(imageData.width * scale);
        const scaledHeight = Math.round(imageData.height * scale);
        const scaledData = downscaleImageData(imageData, scaledWidth, scaledHeight);
        const scaledDPI = effectiveDPI * scale;
        
        postProgress(15);
        const result = processContour(scaledData, strokeSettings, scaledDPI, previewMode);
        postProgress(90);
        
        // Upscale result back to original size
        processedData = upscaleImageData(result.imageData, 
          Math.round(result.imageData.width / scale), 
          Math.round(result.imageData.height / scale));
        contourData = result.contourData;
      } else {
        const result = processContour(imageData, strokeSettings, effectiveDPI, previewMode);
        processedData = result.imageData;
        contourData = result.contourData;
      }
      
      postProgress(100);
      
      const response: WorkerResponse = {
        type: 'result',
        imageData: processedData,
        contourData: contourData
      };
      (self as unknown as Worker).postMessage(response, [processedData.data.buffer]);
    } catch (error) {
      const response: WorkerResponse = {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      self.postMessage(response);
    }
  }
};

function downscaleImageData(imageData: ImageData, newWidth: number, newHeight: number): ImageData {
  const { width, height, data } = imageData;
  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);
  
  const xRatio = width / newWidth;
  const yRatio = height / newHeight;
  
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      
      newData[dstIdx] = data[srcIdx];
      newData[dstIdx + 1] = data[srcIdx + 1];
      newData[dstIdx + 2] = data[srcIdx + 2];
      newData[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  
  return new ImageData(newData, newWidth, newHeight);
}

function upscaleImageData(imageData: ImageData, newWidth: number, newHeight: number): ImageData {
  const { width, height, data } = imageData;
  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);
  
  const xRatio = width / newWidth;
  const yRatio = height / newHeight;
  
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      // Bilinear interpolation for smoother upscaling
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;
      
      const idx00 = (y0 * width + x0) * 4;
      const idx10 = (y0 * width + x1) * 4;
      const idx01 = (y1 * width + x0) * 4;
      const idx11 = (y1 * width + x1) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      
      for (let c = 0; c < 4; c++) {
        const top = data[idx00 + c] * (1 - xWeight) + data[idx10 + c] * xWeight;
        const bottom = data[idx01 + c] * (1 - xWeight) + data[idx11 + c] * xWeight;
        newData[dstIdx + c] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
    }
  }
  
  return new ImageData(newData, newWidth, newHeight);
}

function postProgress(percent: number) {
  const response: WorkerResponse = { type: 'progress', progress: percent };
  self.postMessage(response);
}

interface ContourResult {
  imageData: ImageData;
  contourData: {
    pathPoints: Array<{x: number; y: number}>;
    widthInches: number;
    heightInches: number;
    imageOffsetX: number;
    imageOffsetY: number;
    backgroundColor: string;
    useEdgeBleed: boolean;
  };
}

function processContour(
  imageData: ImageData,
  strokeSettings: {
    width: number;
    color: string;
    enabled: boolean;
    alphaThreshold: number;
    closeSmallGaps: boolean;
    closeBigGaps: boolean;
    backgroundColor: string;
    useCustomBackground: boolean;
    autoBridging: boolean;
    autoBridgingThreshold: number;
  },
  effectiveDPI: number
, previewMode?: boolean): ContourResult {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Super-sampling factor for sub-pixel precision tracing
  // Preview: 2x for speed, Export: 4x for quality
  const SUPER_SAMPLE = previewMode ? 2 : 4;
  
  // Holographic uses white as placeholder for preview (will be replaced with gradient in UI)
  // Export functions will treat holographic as transparent separately
  const isHolographic = strokeSettings.backgroundColor === 'holographic';
  const effectiveBackgroundColor = isHolographic 
    ? '#FFFFFF' 
    : strokeSettings.backgroundColor;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  // Auto-bridging: close narrow gaps/caves using configurable threshold
  const autoBridgeInches = strokeSettings.autoBridging ? strokeSettings.autoBridgingThreshold : 0;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  // Add bleed to padding so expanded background isn't clipped
  const bleedInches = 0.10;
  const bleedPixels = Math.round(bleedInches * effectiveDPI);
  const padding = totalOffsetPixels + bleedPixels + 10;
  const canvasWidth = width + (padding * 2);
  const canvasHeight = height + (padding * 2);
  
  postProgress(20);
  
  // Create 4x upscaled alpha buffer using bilinear interpolation
  // This converts pixel-locked edges into smooth sub-pixel boundaries
  const hiResWidth = width * SUPER_SAMPLE;
  const hiResHeight = height * SUPER_SAMPLE;
  const hiResAlpha = upscaleAlphaChannel(data, width, height, SUPER_SAMPLE);
  
  // Apply box blur to alpha channel to smooth out anti-aliasing artifacts
  // This makes straight edges with slight transparency variations appear cleaner
  // Radius of 2px at super-sampled resolution (= 0.5px at original resolution)
  const blurRadius = 2;
  const smoothedAlpha = boxBlurAlpha(hiResAlpha, hiResWidth, hiResHeight, blurRadius);
  console.log('[Worker] Applied alpha blur radius:', blurRadius, 'px');
  
  // Create silhouette mask at 4x resolution
  const hiResMask = createSilhouetteMaskFromAlpha(smoothedAlpha, hiResWidth, hiResHeight, strokeSettings.alphaThreshold);
  
  if (hiResMask.length === 0) {
    return createOutputWithImage(imageData, canvasWidth, canvasHeight, padding, effectiveDPI, effectiveBackgroundColor);
  }
  
  postProgress(30);
  
  // =============================================================================
  // VECTOR OFFSETTING APPROACH (PyClipper / Vatti clipping algorithm)
  // =============================================================================
  // 1. Apply morphological closing to unite separate objects (letters, etc.)
  // 2. Fill all interior holes/gaps to create solid silhouette
  // 3. Trace the unified contour
  // 4. Use ClipperOffset with JT_ROUND for perfect vector offsetting
  // =============================================================================
  
  // Step 1: Apply morphological closing to unite separate objects
  // Dilate → Fill → creates a unified shape from all parts of the design
  // Use autoBridging threshold (scaled to 4x hi-res) or minimum 0.02" bridge
  const minBridgeInches = 0.02; // Always bridge objects within 0.02" of each other
  const bridgeInches = Math.max(autoBridgeInches, minBridgeInches);
  const bridgePixelsHiRes = Math.round(bridgeInches * effectiveDPI * SUPER_SAMPLE);
  
  console.log('[Worker] Applying morphological closing to unite objects, bridge radius:', bridgePixelsHiRes, 'px (hi-res)');
  
  // Dilate to bridge nearby objects
  const dilatedMask = dilateSilhouette(hiResMask, hiResWidth, hiResHeight, bridgePixelsHiRes);
  const dilatedWidth = hiResWidth + bridgePixelsHiRes * 2;
  const dilatedHeight = hiResHeight + bridgePixelsHiRes * 2;
  
  // Fill all interior holes in the dilated mask
  const filledDilatedMask = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
  
  // Trace the unified contour from the filled dilated mask
  const originalContour = traceBoundary(filledDilatedMask, dilatedWidth, dilatedHeight);
  
  if (originalContour.length < 3) {
    return createOutputWithImage(imageData, canvasWidth, canvasHeight, padding, effectiveDPI, effectiveBackgroundColor);
  }
  
  postProgress(40);
  
  // Downscale to 1x coordinates for vector processing
  // Account for the dilation offset: subtract bridgePixelsHiRes to get back to original image coordinates
  const bridgePixels1x = bridgePixelsHiRes / SUPER_SAMPLE;
  let tightContour = originalContour.map(p => ({
    x: (p.x - bridgePixelsHiRes) / SUPER_SAMPLE,
    y: (p.y - bridgePixelsHiRes) / SUPER_SAMPLE
  }));
  
  console.log('[Worker] Unified contour after morphological closing:', tightContour.length, 'points');
  
  // Step 2: Skip RDP simplification - it can cut across concave areas
  // Clipper's JT_ROUND already produces clean vector output
  // Only do minimal deduplication to remove exact duplicates
  tightContour = deduplicatePoints(tightContour);
  console.log('[Worker] After deduplication:', tightContour.length, 'points');
  
  // Sanitize to fix any self-intersections
  tightContour = sanitizePolygonForOffset(tightContour);
  
  postProgress(50);
  
  // Step 3: Apply VECTOR OFFSET using Clipper with JT_ROUND
  // This guarantees: straight lines stay straight, corners are perfectly rounded
  const vectorOffsetPath = clipperVectorOffset(tightContour, totalOffsetPixels);
  console.log('[Worker] After Clipper vector offset (+', totalOffsetPixels, 'px):', vectorOffsetPath.length, 'points');
  
  postProgress(60);
  
  // Step 4: Gap closing (if enabled) - uses auto-bridging
  let smoothedPath = vectorOffsetPath;
  
  const gapThresholdPixels = strokeSettings.closeBigGaps 
    ? Math.round(0.42 * effectiveDPI) 
    : strokeSettings.closeSmallGaps 
      ? Math.round(0.15 * effectiveDPI) 
      : 0;
  
  if (gapThresholdPixels > 0) {
    smoothedPath = closeGapsWithShapes(smoothedPath, gapThresholdPixels);
  }
  
  postProgress(70);
  
  // Calculate effective dimensions for page size
  // The offset contour extends beyond original by totalOffsetPixels on each side
  const effectiveDilatedWidth = width + totalOffsetPixels * 2;
  const effectiveDilatedHeight = height + totalOffsetPixels * 2;
  
  console.log('[Worker] Final contour:', smoothedPath.length, 'points');
  
  postProgress(80);
  
  postProgress(90);
  
  // CRITICAL: With Clipper vector offset, the path coordinates may extend to negative values
  // We need to shift the path so its minimum point is at the bleed margin (bleedPixels from canvas edge)
  // First, find the actual minimum bounds of the path
  const previewPathXs = smoothedPath.map(p => p.x);
  const previewPathYs = smoothedPath.map(p => p.y);
  const previewMinX = Math.min(...previewPathXs);
  const previewMinY = Math.min(...previewPathYs);
  
  // Shift so the contour's left/top edge is at bleedPixels from canvas edge
  const offsetX = bleedPixels - previewMinX;
  const offsetY = bleedPixels - previewMinY;
  
  const output = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  
  // Use custom background color if enabled, otherwise use edge-aware bleed
  const useEdgeBleed = !strokeSettings.useCustomBackground;
  
  if (useEdgeBleed) {
    // Edge-aware bleed: extends edge colors outward
    const extendRadius = totalOffsetPixels + bleedPixels;
    const extendedImage = createEdgeExtendedImage(imageData, extendRadius);
    
    // Draw contour with edge-extended background
    const extendedImageOffsetX = padding - extendRadius;
    const extendedImageOffsetY = padding - extendRadius;
    drawContourToDataWithExtendedEdge(output, canvasWidth, canvasHeight, smoothedPath, strokeSettings.color, offsetX, offsetY, effectiveDPI, extendedImage, extendedImageOffsetX, extendedImageOffsetY);
  } else {
    // Custom background: use solid color bleed
    drawContourToData(output, canvasWidth, canvasHeight, smoothedPath, strokeSettings.color, effectiveBackgroundColor, offsetX, offsetY, effectiveDPI);
  }
  
  // Draw original image on top
  // The image should be positioned where the contour's inner edge is
  // Inner edge is at (previewMinX + totalOffsetPixels, previewMinY + totalOffsetPixels) in original coords
  // After shifting by offset, this becomes:
  const imageCanvasX = (previewMinX + totalOffsetPixels) + offsetX;
  const imageCanvasY = (previewMinY + totalOffsetPixels) + offsetY;
  console.log('[Worker] Image canvas position:', imageCanvasX.toFixed(1), imageCanvasY.toFixed(1));
  drawImageToData(output, canvasWidth, canvasHeight, imageData, Math.round(imageCanvasX), Math.round(imageCanvasY));
  
  // Calculate contour data for PDF export
  // Store raw pixel coordinates and let PDF export handle the conversion
  // This ensures preview and PDF use the exact same path data
  
  // Get actual path bounds
  const pathXs = smoothedPath.map(p => p.x);
  const pathYs = smoothedPath.map(p => p.y);
  const minPathX = Math.min(...pathXs);
  const minPathY = Math.min(...pathYs);
  const maxPathX = Math.max(...pathXs);
  const maxPathY = Math.max(...pathYs);
  
  console.log('[Worker] Path bounds (pixels): X:', minPathX.toFixed(1), 'to', maxPathX.toFixed(1),
              'Y:', minPathY.toFixed(1), 'to', maxPathY.toFixed(1));
  console.log('[Worker] Canvas offset used:', offsetX.toFixed(1), offsetY.toFixed(1));
  console.log('[Worker] Image canvas position:', imageCanvasX.toFixed(1), imageCanvasY.toFixed(1));
  
  // Calculate page dimensions based on actual path bounds
  const pathWidthPixels = maxPathX - minPathX;
  const pathHeightPixels = maxPathY - minPathY;
  const pathWidthInches = pathWidthPixels / effectiveDPI;
  const pathHeightInches = pathHeightPixels / effectiveDPI;
  const pageWidthInches = pathWidthInches + (bleedInches * 2);
  const pageHeightInches = pathHeightInches + (bleedInches * 2);
  
  // Convert path to inches for PDF, matching exactly how preview draws it
  // Preview draws at: canvas(px + offsetX, py + offsetY) 
  // For PDF, we map: contour left edge -> bleedInches from page left
  //                  contour top edge -> bleedInches from page top (but Y-flipped)
  const pathInInches = smoothedPath.map(p => ({
    // X: shift so minPathX maps to bleedInches
    x: ((p.x - minPathX) / effectiveDPI) + bleedInches,
    // Y: shift and flip (PDF Y=0 is at bottom)
    y: pageHeightInches - (((p.y - minPathY) / effectiveDPI) + bleedInches)
  }));
  
  // Image offset in the PDF coordinate system
  // The image inner edge in pixel space is at approximately (0, 0) of the original image
  // After Clipper offset, this is at (minPathX + totalOffsetPixels, minPathY + totalOffsetPixels) approximately
  // But more accurately, the original image occupies the center of the contour
  // Image left edge in PDF = ((0 - minPathX) / DPI) + bleedInches (if original image started at x=0)
  // But with Clipper, minPathX ≈ -totalOffsetPixels, so image left ≈ totalOffsetInches + bleedInches
  const imageOffsetXCalc = ((0 - minPathX) / effectiveDPI) + bleedInches;
  const imageOffsetYCalc = ((0 - minPathY) / effectiveDPI) + bleedInches;
  
  console.log('[Worker] Page size (inches):', pageWidthInches.toFixed(4), 'x', pageHeightInches.toFixed(4));
  console.log('[Worker] Image offset (inches):', imageOffsetXCalc.toFixed(4), 'x', imageOffsetYCalc.toFixed(4));
  
  // Debug: verify path bounds in inches
  const pathXsInches = pathInInches.map(p => p.x);
  const pathYsInches = pathInInches.map(p => p.y);
  console.log('[Worker] Path bounds (inches): X:', Math.min(...pathXsInches).toFixed(4), 'to', Math.max(...pathXsInches).toFixed(4),
              'Y:', Math.min(...pathYsInches).toFixed(4), 'to', Math.max(...pathYsInches).toFixed(4));
  
  return {
    imageData: new ImageData(output, canvasWidth, canvasHeight),
    contourData: {
      pathPoints: pathInInches,
      widthInches: pageWidthInches,
      heightInches: pageHeightInches,
      imageOffsetX: imageOffsetXCalc,
      imageOffsetY: imageOffsetYCalc,
      backgroundColor: isHolographic ? 'holographic' : effectiveBackgroundColor,
      useEdgeBleed: useEdgeBleed
    }
  };
}

// Detect if design is "solid" (few internal gaps) or has many gaps
// Returns true if the design is solid enough to use edge-aware bleed
function isSolidDesign(data: Uint8ClampedArray, width: number, height: number, alphaThreshold: number): boolean {
  // Count opaque pixels and edge pixels
  let opaqueCount = 0;
  let edgeCount = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] >= alphaThreshold) {
        opaqueCount++;
        
        // Check if this is an edge pixel (has transparent neighbor)
        let isEdge = false;
        for (let dy = -1; dy <= 1 && !isEdge; dy++) {
          for (let dx = -1; dx <= 1 && !isEdge; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
              isEdge = true;
            } else {
              const nidx = (ny * width + nx) * 4;
              if (data[nidx + 3] < alphaThreshold) isEdge = true;
            }
          }
        }
        if (isEdge) edgeCount++;
      }
    }
  }
  
  if (opaqueCount === 0) return false;
  
  // Calculate edge-to-area ratio
  // Solid shapes have lower ratio (few edges relative to area)
  // Designs with gaps have higher ratio (many internal edges)
  const edgeRatio = edgeCount / opaqueCount;
  
  // Threshold: solid shapes typically have ratio < 0.15
  // Designs with lots of gaps/lines have ratio > 0.3
  return edgeRatio < 0.25;
}

function createSilhouetteMaskFromData(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      mask[y * width + x] = data[idx + 3] >= threshold ? 1 : 0;
    }
  }
  
  return mask;
}

// Upscale alpha channel using bilinear interpolation for 4x super-sampling
// This fills in the gaps between pixels with smooth gradients
function upscaleAlphaChannel(data: Uint8ClampedArray, width: number, height: number, scale: number): Uint8Array {
  const newWidth = width * scale;
  const newHeight = height * scale;
  const result = new Uint8Array(newWidth * newHeight);
  
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      // Map back to source coordinates (with sub-pixel precision)
      const srcX = x / scale;
      const srcY = y / scale;
      
      // Get the four surrounding source pixels
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      
      // Calculate interpolation weights
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;
      
      // Get alpha values from the 4 corners
      const a00 = data[(y0 * width + x0) * 4 + 3];
      const a10 = data[(y0 * width + x1) * 4 + 3];
      const a01 = data[(y1 * width + x0) * 4 + 3];
      const a11 = data[(y1 * width + x1) * 4 + 3];
      
      // Bilinear interpolation
      const top = a00 * (1 - xWeight) + a10 * xWeight;
      const bottom = a01 * (1 - xWeight) + a11 * xWeight;
      const alpha = top * (1 - yWeight) + bottom * yWeight;
      
      result[y * newWidth + x] = Math.round(alpha);
    }
  }
  
  return result;
}

// Separable box blur on alpha channel (horizontal then vertical pass)
// Much faster O(1) per pixel instead of O(r^2)
// This helps straight edges with slight transparency variations appear cleaner
function boxBlurAlpha(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return alpha;
  
  const temp = new Uint8Array(alpha.length);
  const result = new Uint8Array(alpha.length);
  
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      
      for (let i = left; i <= right; i++) {
        sum += alpha[rowOffset + i];
        count++;
      }
      temp[rowOffset + x] = Math.round(sum / count);
    }
  }
  
  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      
      for (let j = top; j <= bottom; j++) {
        sum += temp[j * width + x];
        count++;
      }
      result[y * width + x] = Math.round(sum / count);
    }
  }
  
  return result;
}

// Create silhouette mask from pre-extracted alpha buffer (for super-sampled data)
function createSilhouetteMaskFromAlpha(alpha: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  for (let i = 0; i < alpha.length; i++) {
    mask[i] = alpha[i] >= threshold ? 1 : 0;
  }
  
  return mask;
}

function dilateSilhouette(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const newWidth = width + radius * 2;
  const newHeight = height + radius * 2;
  const result = new Uint8Array(newWidth * newHeight);
  
  // Optimized circular dilation with early-exit and precomputed offsets
  const radiusSq = radius * radius;
  
  // Precompute circle offsets once
  const offsets: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radiusSq) {
        offsets.push(dy * newWidth + dx);
      }
    }
  }
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        const centerIdx = (y + radius) * newWidth + (x + radius);
        for (let i = 0; i < offsets.length; i++) {
          result[centerIdx + offsets[i]] = 1;
        }
      }
    }
  }
  
  return result;
}

function fillSilhouette(mask: Uint8Array, width: number, height: number): Uint8Array {
  const filled = new Uint8Array(mask.length);
  filled.set(mask);
  
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0 && visited[x] === 0) {
      queue.push(x);
      visited[x] = 1;
    }
    const bottomIdx = (height - 1) * width + x;
    if (mask[bottomIdx] === 0 && visited[bottomIdx] === 0) {
      queue.push(bottomIdx);
      visited[bottomIdx] = 1;
    }
  }
  
  for (let y = 0; y < height; y++) {
    const leftIdx = y * width;
    if (mask[leftIdx] === 0 && visited[leftIdx] === 0) {
      queue.push(leftIdx);
      visited[leftIdx] = 1;
    }
    const rightIdx = y * width + (width - 1);
    if (mask[rightIdx] === 0 && visited[rightIdx] === 0) {
      queue.push(rightIdx);
      visited[rightIdx] = 1;
    }
  }
  
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    const neighbors = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1
    ];
    
    for (const nIdx of neighbors) {
      if (nIdx >= 0 && visited[nIdx] === 0 && mask[nIdx] === 0) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }
  
  for (let i = 0; i < filled.length; i++) {
    if (visited[i] === 0) {
      filled[i] = 1;
    }
  }
  
  return filled;
}

/**
 * Marching Squares algorithm for sub-pixel accurate contour tracing
 * Processes the mask in 2x2 cells, producing edge midpoint crossings
 * This gives sharper axis-aligned edges compared to pixel-by-pixel tracing
 * 
 * Standard marching squares with proper edge-following:
 * - Tracks entry edge to determine exit edge
 * - Uses lookup table for consistent traversal
 * - Handles saddle cases based on entry direction
 */
function traceBoundaryMarchingSquares(mask: Uint8Array, width: number, height: number): Point[] {
  // Find starting cell - look for first cell that crosses the boundary
  // Start from top-left, find a cell with code 1-14 (not 0 or 15)
  let startCellX = -1, startCellY = -1;
  let startEdge = -1; // Which edge we start from (0=top, 1=right, 2=bottom, 3=left)
  
  outer: for (let cy = 0; cy < height - 1; cy++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const code = getCellCode(mask, width, height, cx, cy);
      if (code > 0 && code < 15) {
        startCellX = cx;
        startCellY = cy;
        // Determine starting edge based on code
        startEdge = getStartEdge(code);
        break outer;
      }
    }
  }
  
  if (startCellX === -1) {
    return traceBoundarySimple(mask, width, height);
  }
  
  const path: Point[] = [];
  const visited = new Set<string>();
  
  let cx = startCellX;
  let cy = startCellY;
  let entryEdge = startEdge;
  
  const maxSteps = width * height * 2;
  let steps = 0;
  
  do {
    const key = `${cx},${cy},${entryEdge}`;
    if (visited.has(key)) break;
    visited.add(key);
    
    const code = getCellCode(mask, width, height, cx, cy);
    if (code === 0 || code === 15) break; // No boundary
    
    // Get exit edge based on code and entry edge
    const exitEdge = getExitEdge(code, entryEdge);
    if (exitEdge === -1) break;
    
    // Add the crossing point on the exit edge
    const point = getEdgeMidpoint(cx, cy, exitEdge);
    
    // Avoid duplicate consecutive points
    if (path.length === 0 || 
        Math.abs(path[path.length - 1].x - point.x) > 0.001 || 
        Math.abs(path[path.length - 1].y - point.y) > 0.001) {
      path.push(point);
    }
    
    // Move to adjacent cell through the exit edge
    // Exit edge becomes entry edge of the new cell (opposite side)
    switch (exitEdge) {
      case 0: cy--; entryEdge = 2; break; // Exit top -> enter from bottom
      case 1: cx++; entryEdge = 3; break; // Exit right -> enter from left
      case 2: cy++; entryEdge = 0; break; // Exit bottom -> enter from top
      case 3: cx--; entryEdge = 1; break; // Exit left -> enter from right
    }
    
    // Bounds check
    if (cx < 0 || cx >= width - 1 || cy < 0 || cy >= height - 1) break;
    
    steps++;
  } while ((cx !== startCellX || cy !== startCellY || entryEdge !== startEdge) && steps < maxSteps);
  
  console.log('[MarchingSquares] Traced', path.length, 'points in', steps, 'steps');
  
  return path.length >= 3 ? path : traceBoundarySimple(mask, width, height);
}

/**
 * Get 4-bit cell code for marching squares
 * Corner layout (standard):
 *   TL(bit0) --- TR(bit1)
 *      |           |
 *   BL(bit3) --- BR(bit2)
 */
function getCellCode(mask: Uint8Array, width: number, height: number, cx: number, cy: number): number {
  // Bounds check
  if (cx < 0 || cx >= width - 1 || cy < 0 || cy >= height - 1) return 0;
  
  const tl = mask[cy * width + cx] === 1 ? 1 : 0;
  const tr = mask[cy * width + (cx + 1)] === 1 ? 2 : 0;
  const br = mask[(cy + 1) * width + (cx + 1)] === 1 ? 4 : 0;
  const bl = mask[(cy + 1) * width + cx] === 1 ? 8 : 0;
  
  return tl | tr | br | bl;
}

/**
 * Determine initial entry edge for a given cell code
 * Returns which edge to start tracing from (must be one of the valid edges for this code)
 * 
 * Edges: 0=top, 1=right, 2=bottom, 3=left
 */
function getStartEdge(code: number): number {
  // For each code, pick the first valid edge from the edge pair
  // This must match the edge pairs in getExitEdge
  const startEdges: Record<number, number> = {
    1: 3,   // LEFT <-> TOP: start from LEFT
    2: 0,   // TOP <-> RIGHT: start from TOP
    3: 3,   // LEFT <-> RIGHT: start from LEFT
    4: 1,   // RIGHT <-> BOTTOM: start from RIGHT
    5: 3,   // Saddle LEFT<->BOTTOM: start from LEFT
    6: 0,   // TOP <-> BOTTOM: start from TOP
    7: 3,   // LEFT <-> BOTTOM: start from LEFT
    8: 2,   // BOTTOM <-> LEFT: start from BOTTOM
    9: 0,   // TOP <-> BOTTOM: start from TOP
    10: 0,  // Saddle TOP<->LEFT: start from TOP
    11: 1,  // RIGHT <-> BOTTOM: start from RIGHT
    12: 1,  // RIGHT <-> LEFT: start from RIGHT
    13: 0,  // TOP <-> RIGHT: start from TOP
    14: 0,  // TOP <-> LEFT: start from TOP
  };
  return startEdges[code] ?? 0;
}

/**
 * Standard marching squares exit edge lookup
 * Given a cell code and entry edge, returns the exit edge
 * 
 * Edges: 0=top, 1=right, 2=bottom, 3=left
 * 
 * Each code 1-14 has exactly two edges that the boundary crosses.
 * If you enter from edge A, you exit from edge B (and vice versa).
 * 
 * Canonical edge pairs per code:
 * Code 1  (TL):        LEFT <-> TOP
 * Code 2  (TR):        TOP <-> RIGHT
 * Code 3  (TL+TR):     LEFT <-> RIGHT
 * Code 4  (BR):        RIGHT <-> BOTTOM
 * Code 5  (TL+BR):     Saddle - LEFT<->BOTTOM or TOP<->RIGHT
 * Code 6  (TR+BR):     TOP <-> BOTTOM
 * Code 7  (TL+TR+BR):  LEFT <-> BOTTOM
 * Code 8  (BL):        BOTTOM <-> LEFT
 * Code 9  (TL+BL):     TOP <-> BOTTOM
 * Code 10 (TR+BL):     Saddle - TOP<->LEFT or RIGHT<->BOTTOM
 * Code 11 (TL+TR+BL):  RIGHT <-> BOTTOM
 * Code 12 (BR+BL):     RIGHT <-> LEFT
 * Code 13 (TL+BR+BL):  TOP <-> RIGHT
 * Code 14 (TR+BR+BL):  TOP <-> LEFT
 */
function getExitEdge(code: number, entryEdge: number): number {
  // Edge pairs for each code: [edgeA, edgeB]
  // Entering from edgeA exits from edgeB, and vice versa
  const edgePairs: Record<number, [number, number]> = {
    1:  [3, 0],  // LEFT <-> TOP
    2:  [0, 1],  // TOP <-> RIGHT  
    3:  [3, 1],  // LEFT <-> RIGHT
    4:  [1, 2],  // RIGHT <-> BOTTOM
    6:  [0, 2],  // TOP <-> BOTTOM
    7:  [3, 2],  // LEFT <-> BOTTOM
    8:  [2, 3],  // BOTTOM <-> LEFT
    9:  [0, 2],  // TOP <-> BOTTOM
    11: [1, 2],  // RIGHT <-> BOTTOM
    12: [1, 3],  // RIGHT <-> LEFT
    13: [0, 1],  // TOP <-> RIGHT
    14: [0, 3],  // TOP <-> LEFT
  };
  
  // Saddle cases need special handling based on entry direction
  // Code 5: TL+BR - two disjoint boundaries (LEFT-BOTTOM and TOP-RIGHT)
  // Code 10: TR+BL - two disjoint boundaries (TOP-LEFT and RIGHT-BOTTOM)
  if (code === 5) {
    // TL+BR saddle: LEFT<->BOTTOM or TOP<->RIGHT
    if (entryEdge === 3) return 2;  // LEFT -> BOTTOM
    if (entryEdge === 2) return 3;  // BOTTOM -> LEFT
    if (entryEdge === 0) return 1;  // TOP -> RIGHT
    if (entryEdge === 1) return 0;  // RIGHT -> TOP
    return -1;
  }
  
  if (code === 10) {
    // TR+BL saddle: TOP<->LEFT or RIGHT<->BOTTOM
    if (entryEdge === 0) return 3;  // TOP -> LEFT
    if (entryEdge === 3) return 0;  // LEFT -> TOP
    if (entryEdge === 1) return 2;  // RIGHT -> BOTTOM
    if (entryEdge === 2) return 1;  // BOTTOM -> RIGHT
    return -1;
  }
  
  const pair = edgePairs[code];
  if (!pair) return -1;
  
  const [edgeA, edgeB] = pair;
  if (entryEdge === edgeA) return edgeB;
  if (entryEdge === edgeB) return edgeA;
  
  return -1; // Invalid entry edge for this code
}

/**
 * Get the midpoint of a cell edge
 * Edges: 0=top, 1=right, 2=bottom, 3=left
 */
function getEdgeMidpoint(cx: number, cy: number, edge: number): Point {
  switch (edge) {
    case 0: return { x: cx + 0.5, y: cy };       // top edge midpoint
    case 1: return { x: cx + 1, y: cy + 0.5 };   // right edge midpoint
    case 2: return { x: cx + 0.5, y: cy + 1 };   // bottom edge midpoint
    case 3: return { x: cx, y: cy + 0.5 };       // left edge midpoint
    default: return { x: cx + 0.5, y: cy + 0.5 }; // center fallback
  }
}

/**
 * Simple Moore neighbor tracing (fallback)
 */
function traceBoundarySimple(mask: Uint8Array, width: number, height: number): Point[] {
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  
  if (startX === -1) return [];
  
  const path: Point[] = [];
  const directions = [
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 }
  ];
  
  let x = startX, y = startY;
  let dir = 0;
  const maxSteps = width * height * 2;
  let steps = 0;
  
  do {
    path.push({ x, y });
    
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8;
      const nx = x + directions[checkDir].dx;
      const ny = y + directions[checkDir].dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        x = nx;
        y = ny;
        dir = checkDir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);
  
  return path;
}

/**
 * Main boundary tracing function
 * Uses Moore neighbor tracing which works reliably with 4x upscaled masks
 * The upscaling provides sufficient sub-pixel accuracy for smooth contours
 */
function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  // Use simple Moore neighbor tracing - reliable and works well with 4x upscaling
  return traceBoundarySimple(mask, width, height);
}

/**
 * Apply pure vector offset using Clipper's ClipperOffset with JT_ROUND
 * This is the PyClipper equivalent using Vatti clipping algorithm.
 * 
 * Guarantees:
 * - Straight lines stay perfectly straight
 * - Corners are perfectly rounded (arc segments)
 * - Zero pixel aliasing (pure vector math)
 * 
 * @param points - input polygon points (tight contour from image)
 * @param offsetPixels - offset distance in pixels (positive = expand outward)
 * @returns offset polygon with rounded corners
 */
function clipperVectorOffset(points: Point[], offsetPixels: number): Point[] {
  if (points.length < 3 || offsetPixels <= 0) return points;
  
  // Convert to Clipper format with scaling
  const clipperPath: Array<{X: number; Y: number}> = points.map(p => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  }));
  
  const scaledOffset = offsetPixels * CLIPPER_SCALE;
  
  // Create ClipperOffset object
  const co = new ClipperLib.ClipperOffset();
  
  // Set arc tolerance for smooth round corners
  // Lower value = smoother curves (more points), higher = more angular
  // 0.25px tolerance gives smooth arcs without excessive points
  co.ArcTolerance = CLIPPER_SCALE * 0.25;
  
  // MiterLimit only applies to JT_MITER, but set a reasonable default
  co.MiterLimit = 2.0;
  
  // Add path with JT_ROUND for perfectly rounded corners
  // ET_CLOSEDPOLYGON for closed contour
  co.AddPath(clipperPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  
  // Execute the offset
  const offsetPaths: Array<Array<{X: number; Y: number}>> = [];
  co.Execute(offsetPaths, scaledOffset);
  
  if (offsetPaths.length === 0 || offsetPaths[0].length < 3) {
    console.log('[Worker] clipperVectorOffset: offset failed, returning original');
    return points;
  }
  
  // Find the largest polygon if multiple were created
  let resultPath = offsetPaths[0];
  let largestArea = Math.abs(ClipperLib.Clipper.Area(offsetPaths[0]));
  
  for (let i = 1; i < offsetPaths.length; i++) {
    const area = Math.abs(ClipperLib.Clipper.Area(offsetPaths[i]));
    if (area > largestArea) {
      largestArea = area;
      resultPath = offsetPaths[i];
    }
  }
  
  // Convert back to Point format
  const result = resultPath.map(p => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE
  }));
  
  console.log('[Worker] clipperVectorOffset: input', points.length, 'pts, output', result.length, 'pts');
  
  return result;
}

/**
 * Round sharp corners using Clipper's JT_ROUND join type
 * Uses "buffer and shrink" technique:
 * 1. Offset outward by radius with JT_ROUND (rounds outer corners)
 * 2. Offset inward by radius with JT_ROUND (rounds inner corners, returns to original size)
 * 
 * Result: Rounded corners while keeping straight edges perfectly straight
 * 
 * @param points - input polygon points
 * @param radius - corner rounding radius in pixels
 * @returns polygon with rounded corners
 */
function roundCorners(points: Point[], radius: number): Point[] {
  if (points.length < 3 || radius <= 0) return points;
  
  // Convert to Clipper format with scaling
  const clipperPath: Array<{X: number; Y: number}> = points.map(p => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  }));
  
  const scaledRadius = radius * CLIPPER_SCALE;
  
  // Create ClipperOffset object
  const co = new ClipperLib.ClipperOffset();
  
  // Set arc tolerance for smooth round corners
  // Lower value = smoother curves, higher = more angular
  co.ArcTolerance = CLIPPER_SCALE * 0.25; // 0.25px tolerance for smooth arcs
  co.MiterLimit = 2.0;
  
  // Step 1: Offset OUT by radius with JT_ROUND
  co.Clear();
  co.AddPath(clipperPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  
  const expandedPaths: Array<Array<{X: number; Y: number}>> = [];
  co.Execute(expandedPaths, scaledRadius);
  
  if (expandedPaths.length === 0 || expandedPaths[0].length < 3) {
    console.log('[Worker] roundCorners: expand step failed, returning original');
    return points;
  }
  
  // Step 2: Offset IN by radius with JT_ROUND (shrink back)
  co.Clear();
  co.AddPath(expandedPaths[0], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  
  const shrunkPaths: Array<Array<{X: number; Y: number}>> = [];
  co.Execute(shrunkPaths, -scaledRadius);
  
  if (shrunkPaths.length === 0 || shrunkPaths[0].length < 3) {
    console.log('[Worker] roundCorners: shrink step failed, returning expanded');
    // Return expanded result if shrink fails
    return expandedPaths[0].map(p => ({
      x: p.X / CLIPPER_SCALE,
      y: p.Y / CLIPPER_SCALE
    }));
  }
  
  // Find the largest polygon if multiple were created
  let resultPath = shrunkPaths[0];
  let largestArea = Math.abs(ClipperLib.Clipper.Area(shrunkPaths[0]));
  
  for (let i = 1; i < shrunkPaths.length; i++) {
    const area = Math.abs(ClipperLib.Clipper.Area(shrunkPaths[i]));
    if (area > largestArea) {
      largestArea = area;
      resultPath = shrunkPaths[i];
    }
  }
  
  // Convert back to Point format
  const result = resultPath.map(p => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE
  }));
  
  console.log('[Worker] roundCorners: radius =', radius.toFixed(2), 'px, points:', points.length, '->', result.length);
  
  return result;
}

/**
 * Remove exact duplicate consecutive points from a path
 * Keeps the contour shape intact, just removes redundant duplicates
 */
function deduplicatePoints(points: Point[]): Point[] {
  if (points.length < 2) return points;
  
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    // Keep point if it's different from the previous one
    if (Math.abs(curr.x - prev.x) > 0.01 || Math.abs(curr.y - prev.y) > 0.01) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Calculate the perimeter (arc length) of a closed polygon
 */
function calculatePerimeter(points: Point[]): number {
  if (points.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    perimeter += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
  return perimeter;
}

/**
 * cv2.approxPolyDP equivalent - simplify contour using Douglas-Peucker
 * with epsilon automatically scaled by perimeter
 * 
 * @param points - input polygon points
 * @param epsilonFactor - multiplier for perimeter (default 0.001 = "rope tension")
 * @returns simplified polygon
 */
function approxPolyDP(points: Point[], epsilonFactor: number = 0.001): Point[] {
  if (points.length < 3) return points;
  
  const perimeter = calculatePerimeter(points);
  const epsilon = epsilonFactor * perimeter;
  
  console.log('[Worker] approxPolyDP: perimeter =', perimeter.toFixed(2), 'px, epsilon =', epsilon.toFixed(3), 'px (factor:', epsilonFactor, ')');
  
  return rdpSimplifyPolygon(points, epsilon);
}

// Ramer-Douglas-Peucker algorithm for path simplification
// "Pulls the line tight" instead of creating waves like moving average
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceRDP(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [first, last];
  }
}

function perpendicularDistanceRDP(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
  const nearestX = lineStart.x + t * dx;
  const nearestY = lineStart.y + t * dy;
  
  return Math.sqrt((point.x - nearestX) ** 2 + (point.y - nearestY) ** 2);
}

// RDP for closed polygons - handles wrap-around at endpoints
function rdpSimplifyPolygon(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  
  // Find point furthest from centroid as split point
  const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  
  let maxDist = 0;
  let splitIndex = 0;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.sqrt((points[i].x - centroidX) ** 2 + (points[i].y - centroidY) ** 2);
    if (dist > maxDist) {
      maxDist = dist;
      splitIndex = i;
    }
  }
  
  // Rotate array so split point is at start/end
  const rotated = [...points.slice(splitIndex), ...points.slice(0, splitIndex)];
  rotated.push({ ...rotated[0] });
  
  // Simplify the open path using Douglas-Peucker
  const simplified = douglasPeucker(rotated, tolerance);
  
  // Remove the duplicate closing point
  if (simplified.length > 1) {
    simplified.pop();
  }
  
  return simplified;
}

// Prune short segments that create tiny "jogs" on flat edges
// Only removes segments if the angle change is shallow (preserves sharp corners)
function pruneShortSegments(points: Point[], minLength: number = 4, maxAngleDegrees: number = 30): Point[] {
  if (points.length < 4) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = result.length > 0 ? result[result.length - 1] : points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate segment length from prev to curr
    const segmentLength = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
    
    // If segment is short, check if we can skip this point
    if (segmentLength < minLength && result.length > 0) {
      // Vector from prev to curr
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      // Vector from curr to next
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (len1 > 0.001 && len2 > 0.001) {
        // Angle at the current point (between incoming and outgoing vectors)
        const dot = v1x * v2x + v1y * v2y;
        const cosAngle = dot / (len1 * len2);
        const angleDegrees = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
        
        // If the angle is shallow (close to 180 = straight line), skip this point
        if (angleDegrees > (180 - maxAngleDegrees)) {
          continue;
        }
      }
    }
    
    result.push(curr);
  }
  
  return result.length >= 3 ? result : points;
}

// Sanitize polygon to fix self-intersections (bow-ties) before offset
// Uses Clipper's SimplifyPolygon which performs a Boolean Union to untie crossings
// Also ensures correct winding orientation (Counter-Clockwise for outer contours)
function sanitizePolygonForOffset(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  // Convert to Clipper format with scaling
  const clipperPath: Array<{X: number; Y: number}> = points.map(p => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  }));
  
  // Step 1: Use SimplifyPolygon to fix self-intersections
  // This performs a Boolean Union operation which resolves all crossing edges
  const simplified = ClipperLib.Clipper.SimplifyPolygon(clipperPath, ClipperLib.PolyFillType.pftNonZero);
  
  if (!simplified || simplified.length === 0) {
    console.log('[Worker] SimplifyPolygon returned empty, keeping original');
    return points;
  }
  
  // Find the largest polygon (by area) if there are multiple
  let largestPath = simplified[0];
  let largestArea = Math.abs(ClipperLib.Clipper.Area(simplified[0]));
  
  for (let i = 1; i < simplified.length; i++) {
    const area = Math.abs(ClipperLib.Clipper.Area(simplified[i]));
    if (area > largestArea) {
      largestArea = area;
      largestPath = simplified[i];
    }
  }
  
  if (!largestPath || largestPath.length < 3) {
    console.log('[Worker] No valid polygon after simplify, keeping original');
    return points;
  }
  
  // Step 2: Force correct winding orientation (Counter-Clockwise for outer shapes)
  // Use standard shoelace formula: sum of (x_i * y_{i+1} - x_{i+1} * y_i)
  // Positive area = CCW, Negative area = CW (in standard Y-up coordinates)
  // Canvas uses Y-down, so signs are inverted: Positive = CW, Negative = CCW
  let signedArea = 0;
  let wasReversed = false;
  for (let i = 0; i < largestPath.length; i++) {
    const j = (i + 1) % largestPath.length;
    signedArea += largestPath[i].X * largestPath[j].Y - largestPath[j].X * largestPath[i].Y;
  }
  // In Y-down canvas coords: negative area = CCW (what we want), positive = CW (needs reverse)
  if (signedArea > 0) {
    // Path is clockwise, reverse it to make counter-clockwise
    largestPath.reverse();
    wasReversed = true;
    console.log('[Worker] Reversed path to counter-clockwise orientation');
  }
  
  // Step 3: Clean up any tiny artifacts
  ClipperLib.Clipper.CleanPolygon(largestPath, CLIPPER_SCALE * 0.1);
  
  // Convert back to Point format
  const result: Point[] = largestPath.map(p => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE
  }));
  
  if (result.length < 3) {
    console.log('[Worker] Sanitized path too short, keeping original');
    return points;
  }
  
  console.log('[Worker] Sanitized:', points.length, '->', result.length, 'points');
  
  return result;
}

// Chaikin's corner-cutting algorithm to smooth pixel-step jaggies
// Replaces each shallow-angle corner with two points: Q (75% toward next) and R (25% toward next)
// Sharp corners (>sharpAngleThreshold) are preserved to maintain diamond tips
function smoothPolyChaikin(points: Point[], iterations: number = 2, sharpAngleThreshold: number = 60): Point[] {
  if (points.length < 3) return points;
  
  let result = [...points];
  
  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point[] = [];
    const n = result.length;
    
    for (let i = 0; i < n; i++) {
      const prev = result[(i - 1 + n) % n];
      const curr = result[i];
      const next = result[(i + 1) % n];
      
      // Calculate angle at current point
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      // Calculate angle between vectors (0° = same direction, 180° = opposite)
      let angleDegrees = 180; // default to straight line
      if (len1 > 0.0001 && len2 > 0.0001) {
        const dot = v1x * v2x + v1y * v2y;
        const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        angleDegrees = Math.acos(cosAngle) * 180 / Math.PI;
      }
      
      // Deviation from straight line (0° = straight, 180° = U-turn)
      const deviation = 180 - angleDegrees;
      
      // If sharp corner (deviation > threshold), preserve the original point
      if (deviation > sharpAngleThreshold) {
        newPoints.push(curr);
      } else {
        // Apply Chaikin's corner cutting for shallow angles
        // Q = 0.75 * P_i + 0.25 * P_{i+1} (cut 25% from this point toward next)
        const qx = 0.75 * curr.x + 0.25 * next.x;
        const qy = 0.75 * curr.y + 0.25 * next.y;
        
        // R = 0.25 * P_i + 0.75 * P_{i+1} (cut 75% from this point toward next)
        const rx = 0.25 * curr.x + 0.75 * next.x;
        const ry = 0.25 * curr.y + 0.75 * next.y;
        
        newPoints.push({ x: qx, y: qy });
        newPoints.push({ x: rx, y: ry });
      }
    }
    
    result = newPoints;
  }
  
  return result;
}

// Straighten noisy lines: detect sequences of nearly-collinear points and snap them to straight lines
// This fixes rough/noisy pixels that create zigzag patterns instead of clean straight edges
// cornerAngleThreshold: angles greater than this are preserved as corners (degrees)
// maxDeviation: maximum perpendicular distance from line to be considered collinear (pixels)
function straightenNoisyLines(points: Point[], cornerAngleThreshold: number = 25, maxDeviation: number = 1.5): Point[] {
  if (points.length < 4) return points;
  
  const n = points.length;
  
  // First, identify corner points that must be preserved
  const isCorner: boolean[] = new Array(n).fill(false);
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate angle at current point
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.0001 && len2 > 0.0001) {
      const dot = v1x * v2x + v1y * v2y;
      const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
      const angleDegrees = Math.acos(cosAngle) * 180 / Math.PI;
      const deviation = 180 - angleDegrees;
      
      // Mark as corner if angle deviation exceeds threshold
      if (deviation > cornerAngleThreshold) {
        isCorner[i] = true;
      }
    }
  }
  
  // Simple greedy algorithm: process linearly, extending straight segments
  // when points remain collinear
  const result: Point[] = [];
  let segmentStart = 0;
  
  while (segmentStart < n) {
    // Always add the segment start point
    result.push(points[segmentStart]);
    
    // If this is a corner, just move to next point
    if (isCorner[segmentStart]) {
      segmentStart++;
      continue;
    }
    
    // Try to extend the straight line as far as possible
    let segmentEnd = segmentStart + 1;
    
    while (segmentEnd < n) {
      // Stop at corners - they break the segment
      if (isCorner[segmentEnd]) {
        break;
      }
      
      // Check if all points from segmentStart to segmentEnd+1 are collinear
      const nextEnd = segmentEnd + 1;
      if (nextEnd > n) break;
      
      const startPt = points[segmentStart];
      const endPt = points[Math.min(nextEnd, n - 1)];
      const dx = endPt.x - startPt.x;
      const dy = endPt.y - startPt.y;
      const lineLen = Math.sqrt(dx * dx + dy * dy);
      
      if (lineLen < 0.0001) {
        segmentEnd++;
        continue;
      }
      
      // Check if segment is near-axis-aligned (stair-step prone)
      // Use more generous tolerance for horizontal/vertical segments
      const angleRad = Math.atan2(Math.abs(dy), Math.abs(dx));
      const angleDeg = angleRad * 180 / Math.PI;
      const isAxisAligned = angleDeg < 15 || angleDeg > 75; // Within 15° of horizontal or vertical
      const effectiveDeviation = isAxisAligned ? maxDeviation * 1.5 : maxDeviation;
      
      // Check all intermediate points for collinearity
      let allCollinear = true;
      for (let checkIdx = segmentStart + 1; checkIdx <= segmentEnd; checkIdx++) {
        const pt = points[checkIdx];
        // Calculate perpendicular distance from point to line
        const t = Math.max(0, Math.min(1, 
          ((pt.x - startPt.x) * dx + (pt.y - startPt.y) * dy) / (lineLen * lineLen)
        ));
        const projX = startPt.x + t * dx;
        const projY = startPt.y + t * dy;
        const dist = Math.sqrt((pt.x - projX) ** 2 + (pt.y - projY) ** 2);
        
        if (dist > effectiveDeviation) {
          allCollinear = false;
          break;
        }
      }
      
      if (allCollinear) {
        segmentEnd++;
      } else {
        break;
      }
    }
    
    // Move to the end of the collinear segment (skip intermediate points)
    segmentStart = segmentEnd;
  }
  
  // Remove duplicate consecutive points
  const cleaned: Point[] = [];
  for (let i = 0; i < result.length; i++) {
    const prev = i > 0 ? result[i - 1] : result[result.length - 1];
    const curr = result[i];
    const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
    if (dist > 0.5 || cleaned.length === 0) {
      cleaned.push(curr);
    }
  }
  
  console.log('[Worker] Straightened noisy lines:', points.length, '->', cleaned.length, 'points');
  return cleaned.length >= 3 ? cleaned : points;
}

// Moving average smoothing: reduces stair-step pixel noise on all edges
// Applies a weighted moving average to smooth jittery contours
// windowSize: number of neighboring points to average (default 3)
// cornerThreshold: angle change (degrees) that indicates a corner to preserve (default 30)
function movingAverageSmooth(points: Point[], windowSize: number = 3, cornerThreshold: number = 30): Point[] {
  if (points.length < 5) return points;
  
  const n = points.length;
  const halfWindow = Math.floor(windowSize / 2);
  
  // First, identify corners that should not be smoothed
  const isCorner: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.0001 && len2 > 0.0001) {
      const dot = v1x * v2x + v1y * v2y;
      const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
      const angleDegrees = Math.acos(cosAngle) * 180 / Math.PI;
      const deviation = 180 - angleDegrees;
      
      if (deviation > cornerThreshold) {
        isCorner[i] = true;
      }
    }
  }
  
  // Apply weighted moving average, preserving corners
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    // Preserve corners exactly
    if (isCorner[i]) {
      result.push(points[i]);
      continue;
    }
    
    // Calculate weighted average of neighboring points
    let sumX = 0, sumY = 0, weightSum = 0;
    
    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = (i + j + n) % n;
      // Don't average across corners
      if (j !== 0 && isCorner[idx]) continue;
      
      // Weight: center point has highest weight, decreases with distance
      const weight = 1 - Math.abs(j) / (halfWindow + 1);
      sumX += points[idx].x * weight;
      sumY += points[idx].y * weight;
      weightSum += weight;
    }
    
    if (weightSum > 0) {
      result.push({ x: sumX / weightSum, y: sumY / weightSum });
    } else {
      result.push(points[i]);
    }
  }
  
  console.log('[Worker] Moving average smooth:', points.length, '->', result.length, 'points');
  return result;
}

function fixOffsetCrossings(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  let result = [...points];
  
  // Multiple passes to catch all crossings and loops
  for (let pass = 0; pass < 3; pass++) {
    result = detectAndFixLineCrossings(result);
    result = mergeClosePathPoints(result);
  }
  
  // Remove backtracking points (sharp reversals that create tiny loops)
  result = removeBacktrackingPoints(result);
  
  // Ensure consistent winding direction
  result = ensureClockwiseWinding(result);
  
  return result;
}

// Remove points that cause the path to backtrack (sharp >160 degree turns)
function removeBacktrackingPoints(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    // Skip degenerate cases
    if (len1 < 0.0001 || len2 < 0.0001) {
      continue;
    }
    
    // Calculate dot product for angle between vectors
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    
    // If angle is greater than ~160 degrees (dot < -0.94), this is a backtrack/loop
    if (dot < -0.94) {
      continue; // Skip this point
    }
    
    result.push(curr);
  }
  
  return result.length >= 3 ? result : points;
}

// Ensure path goes clockwise (for proper cutting direction)
function ensureClockwiseWinding(points: Point[]): Point[] {
  if (points.length < 3) return points;
  
  // Calculate signed area (shoelace formula)
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const next = points[(i + 1) % n];
    area += (curr.x * next.y) - (next.x * curr.y);
  }
  
  // Positive area = counter-clockwise, reverse to make clockwise
  if (area > 0) {
    return [...points].reverse();
  }
  
  return points;
}

function detectAndFixLineCrossings(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const skipUntil = new Map<number, number>();
  
  const stride = n > 1000 ? 3 : 1;
  
  for (let i = 0; i < n; i += stride) {
    let shouldSkip = false;
    const entries = Array.from(skipUntil.entries());
    for (let e = 0; e < entries.length; e++) {
      const [start, end] = entries[e];
      if (i > start && i < end) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    
    const maxSearch = Math.min(n - 1, i + 300);
    for (let j = i + 3; j < maxSearch; j += stride) {
      const p3 = points[j];
      const p4 = points[(j + 1) % n];
      
      const intersection = lineSegmentIntersect(p1, p2, p3, p4);
      if (intersection) {
        skipUntil.set(i, j);
        result.push(intersection);
        break;
      }
    }
    
    if (!skipUntil.has(i)) {
      result.push(p1);
    }
  }
  
  return result.length >= 3 ? result : points;
}

function lineSegmentIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) return null;
  
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y
    };
  }
  
  return null;
}

function mergeClosePathPoints(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const skipIndices = new Set<number>();
  
  const stride = n > 1000 ? 3 : 1;
  
  for (let i = 0; i < n; i += stride) {
    if (skipIndices.has(i)) continue;
    
    const pi = points[i];
    
    const maxSearch = Math.min(n, i + 300);
    for (let j = i + 10; j < maxSearch; j += stride) {
      if (skipIndices.has(j)) continue;
      
      const pj = points[j];
      const distSq = (pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2;
      
      if (distSq < 100) {
        for (let k = i + 1; k < j; k++) {
          skipIndices.add(k);
        }
        result.push({ x: (pi.x + pj.x) / 2, y: (pi.y + pj.y) / 2 });
        skipIndices.add(j);
        break;
      }
    }
    
    if (!skipIndices.has(i)) {
      result.push(pi);
    }
  }
  
  return result.length >= 3 ? result : points;
}

function closeGapsWithShapes(points: Point[], gapThreshold: number): Point[] {
  if (points.length < 20) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const processed = new Set<number>();
  
  // Calculate centroid and average distance from centroid for the entire shape
  let centroidX = 0, centroidY = 0;
  for (const p of points) {
    centroidX += p.x;
    centroidY += p.y;
  }
  centroidX /= n;
  centroidY /= n;
  
  // Calculate average distance from centroid (the "normal" radius of the shape)
  let totalDist = 0;
  for (const p of points) {
    totalDist += Math.sqrt((p.x - centroidX) ** 2 + (p.y - centroidY) ** 2);
  }
  const avgDistFromCentroid = totalDist / n;
  
  const gaps: Array<{i: number, j: number, dist: number}> = [];
  
  // Limit how much of path we can skip to avoid deleting entire outline
  const maxSkipPoints = Math.floor(n * 0.25); // Max 25% of path per gap
  const minSkipPoints = 15; // Must skip at least 15 points to be a real gap
  
  const stride = n > 1000 ? 3 : n > 500 ? 2 : 1;
  const thresholdSq = gapThreshold * gapThreshold;
  
  for (let i = 0; i < n; i += stride) {
    const pi = points[i];
    
    // Search ahead but limit to maxSkipPoints to avoid false gaps
    const maxSearch = Math.min(n - 5, i + maxSkipPoints);
    for (let j = i + minSkipPoints; j < maxSearch; j += stride) {
      const pj = points[j];
      const distSq = (pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2;
      
      if (distSq < thresholdSq) {
        // Check if this is a narrow passage (close) vs a protrusion (keep)
        const dist = Math.sqrt(distSq);
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const lineLen = dist;
        
        // Check max perpendicular distance of points between i and j
        let maxPerpDist = 0;
        const sampleStride = Math.max(1, Math.floor((j - i) / 20));
        for (let k = i + sampleStride; k < j; k += sampleStride) {
          const pk = points[k];
          const perpDist = Math.abs((pk.x - pi.x) * dy - (pk.y - pi.y) * dx) / (lineLen || 1);
          maxPerpDist = Math.max(maxPerpDist, perpDist);
        }
        
        // If path extends more than 3x the gap distance, it's a protrusion - don't close
        if (maxPerpDist > dist * 3) {
          continue;
        }
        
        gaps.push({i, j, dist});
        break;
      }
    }
  }
  
  if (gaps.length === 0) return points;
  
  // Classify gaps into two categories:
  // 1. Inward gaps (original detection) - these point toward the centroid and get priority
  // 2. Geometry gaps (new detection) - J-shaped, hooks, etc. that don't point inward
  const inwardGaps: Array<{i: number, j: number, dist: number, priority: number}> = [];
  const geometryGaps: Array<{i: number, j: number, dist: number, priority: number}> = [];
  
  for (const gap of gaps) {
    // Calculate average distance of the gap section from centroid
    let gapSectionDist = 0;
    let gapSectionCount = 0;
    const sampleStride = Math.max(1, Math.floor((gap.j - gap.i) / 10));
    for (let k = gap.i; k <= gap.j; k += sampleStride) {
      const pk = points[k];
      gapSectionDist += Math.sqrt((pk.x - centroidX) ** 2 + (pk.y - centroidY) ** 2);
      gapSectionCount++;
    }
    const avgGapDist = gapSectionDist / gapSectionCount;
    
    // Inward gap: section average is LESS than shape average (dips toward center)
    if (avgGapDist < avgDistFromCentroid * 0.95) {
      inwardGaps.push({...gap, priority: 1}); // High priority
    } else {
      geometryGaps.push({...gap, priority: 2}); // Lower priority
    }
  }
  
  // Filter geometry gaps to exclude any that overlap with inward gaps
  // This ensures inward detection behavior stays exactly as before
  const nonOverlappingGeometryGaps = geometryGaps.filter(geoGap => {
    for (const inwardGap of inwardGaps) {
      // Check if ranges overlap: geoGap[i,j] overlaps with inwardGap[i,j]
      const overlapStart = Math.max(geoGap.i, inwardGap.i);
      const overlapEnd = Math.min(geoGap.j, inwardGap.j);
      if (overlapStart < overlapEnd) {
        return false; // Overlaps with an inward gap, exclude it
      }
    }
    return true; // No overlap, keep it
  });
  
  // Combine: inward gaps (original behavior) + non-overlapping geometry gaps
  const exteriorGaps = [...inwardGaps, ...nonOverlappingGeometryGaps];
  
  // Sort by path position for processing
  const sortedGaps = [...exteriorGaps].sort((a, b) => a.i - b.i);
  
  const refinedGaps: Array<{i: number, j: number, dist: number}> = [];
  for (const gap of sortedGaps) {
    let minDist = gap.dist;
    let bestI = gap.i;
    let bestJ = gap.j;
    
    const searchRange = Math.min(20, Math.floor((gap.j - gap.i) / 4));
    for (let di = -searchRange; di <= searchRange; di++) {
      const testI = gap.i + di;
      if (testI < 0 || testI >= n) continue;
      
      for (let dj = -searchRange; dj <= searchRange; dj++) {
        const testJ = gap.j + dj;
        if (testJ < 0 || testJ >= n || testJ <= testI + 10) continue;
        
        const pi = points[testI];
        const pj = points[testJ];
        const dist = Math.sqrt((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2);
        
        if (dist < minDist) {
          minDist = dist;
          bestI = testI;
          bestJ = testJ;
        }
      }
    }
    
    refinedGaps.push({i: bestI, j: bestJ, dist: minDist});
  }
  
  let currentIdx = 0;
  
  for (const gap of refinedGaps) {
    if (gap.i < currentIdx) continue;
    
    for (let k = currentIdx; k <= gap.i; k++) {
      if (!processed.has(k)) {
        result.push(points[k]);
        processed.add(k);
      }
    }
    
    const p1 = points[gap.i];
    const p2 = points[gap.j];
    const gapDist = gap.dist;
    
    if (gapDist > 0.5) {
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      result.push({ x: midX, y: midY });
    }
    
    // For exterior caves, ALWAYS delete the cave interior
    // Skip all points between i and j (the "top of the P" / cave interior)
    for (let k = gap.i + 1; k < gap.j; k++) {
      processed.add(k);
    }
    
    currentIdx = gap.j;
  }
  
  for (let k = currentIdx; k < n; k++) {
    if (!processed.has(k)) {
      result.push(points[k]);
    }
  }
  
  // Apply smoothing pass to eliminate wave artifacts from gap closing
  if (result.length >= 10 && refinedGaps.length > 0) {
    return smoothBridgeAreas(result);
  }
  
  return result.length >= 3 ? result : points;
}

// Smooth the path to eliminate wave artifacts from gap closing
function smoothBridgeAreas(points: Point[]): Point[] {
  if (points.length < 10) return points;
  
  const n = points.length;
  const result: Point[] = [];
  
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      result.push(points[i]);
    } else {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (len1 > 0.1 && len2 > 0.1) {
        const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
        
        if (dot < 0.5) {
          result.push({
            x: prev.x * 0.25 + curr.x * 0.5 + next.x * 0.25,
            y: prev.y * 0.25 + curr.y * 0.5 + next.y * 0.25
          });
        } else {
          result.push(curr);
        }
      } else {
        result.push(curr);
      }
    }
  }
  
  return result;
}

// Close all gaps for solid bleed fill - uses aggressive gap closing
function closeGapsForBleed(points: Point[], gapThreshold: number): Point[] {
  // Apply gap closing multiple times with progressively smaller thresholds
  // to catch all gaps and create a fully merged solid shape
  let result = closeGapsWithShapes(points, gapThreshold);
  result = closeGapsWithShapes(result, gapThreshold * 0.5);
  result = closeGapsWithShapes(result, gapThreshold * 0.25);
  return result;
}

function getPolygonSignedArea(path: Point[]): number {
  let area = 0;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const curr = path[i];
    const next = path[(i + 1) % n];
    area += (curr.x * next.y) - (next.x * curr.y);
  }
  return area / 2;
}

function expandPathOutward(path: Point[], expansionPixels: number): Point[] {
  if (path.length < 3) return path;
  
  // Determine winding direction: positive area = counter-clockwise, negative = clockwise
  // For CCW polygons, the perpendicular normals point INWARD, so we need to negate
  // For CW polygons, the perpendicular normals point OUTWARD, so we keep them
  const signedArea = getPolygonSignedArea(path);
  const windingMultiplier = signedArea >= 0 ? -1 : 1;
  
  const expanded: Point[] = [];
  const n = path.length;
  
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n];
    const curr = path[i];
    const next = path[(i + 1) % n];
    
    // Calculate edge vectors
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    
    // Calculate perpendicular normals
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1;
    
    const n1x = -e1y / len1;
    const n1y = e1x / len1;
    const n2x = -e2y / len2;
    const n2y = e2x / len2;
    
    // Average the normals for smooth expansion
    let nx = (n1x + n2x) / 2;
    let ny = (n1y + n2y) / 2;
    const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nlen;
    ny /= nlen;
    
    // Apply winding multiplier to ensure outward expansion
    expanded.push({
      x: curr.x + nx * expansionPixels * windingMultiplier,
      y: curr.y + ny * expansionPixels * windingMultiplier
    });
  }
  
  return expanded;
}

function fillContourToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  path: Point[],
  offsetX: number,
  offsetY: number
): void {
  if (path.length < 3) return;
  
  // Use scanline fill algorithm
  const edges: Array<{ yMin: number; yMax: number; xAtYMin: number; slope: number }> = [];
  
  for (let i = 0; i < path.length; i++) {
    const p1 = path[i];
    const p2 = path[(i + 1) % path.length];
    
    const x1 = Math.round(p1.x + offsetX);
    const y1 = Math.round(p1.y + offsetY);
    const x2 = Math.round(p2.x + offsetX);
    const y2 = Math.round(p2.y + offsetY);
    
    if (y1 === y2) continue; // Skip horizontal edges
    
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    const xAtYMin = y1 < y2 ? x1 : x2;
    const slope = (x2 - x1) / (y2 - y1);
    
    edges.push({ yMin, yMax, xAtYMin, slope });
  }
  
  // Find y range
  let minY = height, maxY = 0;
  for (const edge of edges) {
    minY = Math.min(minY, edge.yMin);
    maxY = Math.max(maxY, edge.yMax);
  }
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);
  
  // Scanline fill
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    for (const edge of edges) {
      if (y >= edge.yMin && y < edge.yMax) {
        const x = edge.xAtYMin + (y - edge.yMin) * edge.slope;
        intersections.push(x);
      }
    }
    
    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const xStart = Math.max(0, Math.round(intersections[i]));
      const xEnd = Math.min(width - 1, Math.round(intersections[i + 1]));
      
      for (let x = xStart; x <= xEnd; x++) {
        mask[y * width + x] = 1;
      }
    }
  }
}

function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const result = new Uint8Array(width * height);
  
  // Pre-compute circle offsets for the dilation radius
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push({ dx, dy });
      }
    }
  }
  
  // For each pixel in the mask, if it's set, set all pixels within radius
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        for (const { dx, dy } of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            result[ny * width + nx] = 1;
          }
        }
      }
    }
  }
  
  return result;
}

function drawContourToData(
  output: Uint8ClampedArray, 
  width: number, 
  height: number, 
  path: Point[], 
  strokeColorHex: string,
  backgroundColorHex: string, 
  offsetX: number, 
  offsetY: number,
  effectiveDPI: number
): void {
  // Parse background color - default to white if undefined
  const bgColorHex = backgroundColorHex || '#ffffff';
  
  // CRITICAL: Use exact same bleed calculation as PDF export
  // The bleed must be 0.10 inches regardless of preview DPI
  const bleedInches = 0.10;
  
  // The path is in pixel coordinates at effectiveDPI scale
  // bleedPixels must be relative to the same scale
  const bleedPixels = Math.round(bleedInches * effectiveDPI);
  
  // Debug: log values to console
  console.log('[drawContourToData] effectiveDPI:', effectiveDPI, 'bleedPixels:', bleedPixels, 'lineWidth:', bleedPixels * 2, 'canvasSize:', width, 'x', height);
  
  // Use the same path for bleed that PDF uses (no gap closing modification)
  // PDF export uses the smoothed path directly without modification
  const bleedPath = path;
  
  // Use OffscreenCanvas for proper canvas stroke rendering (matches PDF exactly)
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d');
  
  if (ctx) {
    // Draw bleed using exact same approach as PDF export
    // PDF uses: lineWidth = bleedPixels * 2, which extends bleedPixels on each side
    // Since stroke is centered on the path, and we fill the interior,
    // the visible bleed outside is bleedPixels = 0.10 inches
    ctx.fillStyle = bgColorHex;
    ctx.strokeStyle = bgColorHex;
    ctx.lineWidth = bleedPixels * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    if (bleedPath.length > 0) {
      ctx.beginPath();
      ctx.moveTo(bleedPath[0].x + offsetX, bleedPath[0].y + offsetY);
      for (let i = 1; i < bleedPath.length; i++) {
        ctx.lineTo(bleedPath[i].x + offsetX, bleedPath[i].y + offsetY);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }
    
    // Draw cut line (magenta) - make it visible at any DPI
    const cutLineWidth = Math.max(2, Math.round(0.01 * effectiveDPI));
    ctx.strokeStyle = strokeColorHex;
    ctx.lineWidth = cutLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    if (path.length > 0) {
      ctx.beginPath();
      ctx.moveTo(path[0].x + offsetX, path[0].y + offsetY);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x + offsetX, path[i].y + offsetY);
      }
      ctx.closePath();
      ctx.stroke();
    }
    
    // Copy canvas data to output
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i++) {
      output[i] = imageData.data[i];
    }
  } else {
    // Fallback to manual rendering if OffscreenCanvas not available
    const bgR = parseInt(bgColorHex.slice(1, 3), 16);
    const bgG = parseInt(bgColorHex.slice(3, 5), 16);
    const bgB = parseInt(bgColorHex.slice(5, 7), 16);
    const r = parseInt(strokeColorHex.slice(1, 3), 16);
    const g = parseInt(strokeColorHex.slice(3, 5), 16);
    const b = parseInt(strokeColorHex.slice(5, 7), 16);
    
    strokePathThick(output, width, height, bleedPath, offsetX, offsetY, bgR, bgG, bgB, bleedPixels);
    fillContourDirect(output, width, height, bleedPath, offsetX, offsetY, bgR, bgG, bgB);
    
    for (let i = 0; i < path.length; i++) {
      const p1 = path[i];
      const p2 = path[(i + 1) % path.length];
      const x1 = Math.round(p1.x + offsetX);
      const y1 = Math.round(p1.y + offsetY);
      const x2 = Math.round(p2.x + offsetX);
      const y2 = Math.round(p2.y + offsetY);
      drawLine(output, width, height, x1, y1, x2, y2, r, g, b);
      drawLine(output, width, height, x1 + 1, y1, x2 + 1, y2, r, g, b);
      drawLine(output, width, height, x1 - 1, y1, x2 - 1, y2, r, g, b);
      drawLine(output, width, height, x1, y1 + 1, x2, y2 + 1, r, g, b);
      drawLine(output, width, height, x1, y1 - 1, x2, y2 - 1, r, g, b);
    }
  }
}

// Draw contour with edge-extended background (uses nearest edge colors for bleed)
function drawContourToDataWithExtendedEdge(
  output: Uint8ClampedArray, 
  width: number, 
  height: number, 
  path: Point[], 
  strokeColorHex: string,
  offsetX: number, 
  offsetY: number,
  effectiveDPI: number,
  extendedImage: ImageData,
  extendedImageOffsetX: number,
  extendedImageOffsetY: number
): void {
  const bleedInches = 0.10;
  const bleedPixels = Math.round(bleedInches * effectiveDPI);
  
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d');
  
  if (ctx) {
    // Create a clip path from the contour (with bleed)
    if (path.length > 0) {
      ctx.beginPath();
      ctx.moveTo(path[0].x + offsetX, path[0].y + offsetY);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x + offsetX, path[i].y + offsetY);
      }
      ctx.closePath();
      
      // Stroke with bleed width to expand the fill area
      ctx.lineWidth = bleedPixels * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'white';
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.fill();
    }
    
    // Use composite to draw extended image only where we stroked/filled
    ctx.globalCompositeOperation = 'source-in';
    
    // Draw the extended image at the correct position (using separate X and Y offsets)
    const tempCanvas = new OffscreenCanvas(extendedImage.width, extendedImage.height);
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(extendedImage, 0, 0);
      ctx.drawImage(tempCanvas, extendedImageOffsetX, extendedImageOffsetY);
    }
    
    // Reset composite mode and draw cut line
    ctx.globalCompositeOperation = 'source-over';
    const cutLineWidth = Math.max(2, Math.round(0.01 * effectiveDPI));
    ctx.strokeStyle = strokeColorHex;
    ctx.lineWidth = cutLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    if (path.length > 0) {
      ctx.beginPath();
      ctx.moveTo(path[0].x + offsetX, path[0].y + offsetY);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x + offsetX, path[i].y + offsetY);
      }
      ctx.closePath();
      ctx.stroke();
    }
    
    // Copy canvas data to output
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i++) {
      output[i] = imageData.data[i];
    }
  }
}

// Stroke path with a thick line to create bleed effect
// Draws circles at each vertex and thick lines between them (like round-join stroke)
function strokePathThick(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  path: Point[],
  offsetX: number,
  offsetY: number,
  r: number,
  g: number,
  b: number,
  lineWidth: number
): void {
  if (path.length < 2) return;
  
  // Canvas stroke uses lineWidth/2 as the radius from the path center
  // But we want full bleed width to extend outward, so use the full lineWidth
  // This matches PDF export which uses lineWidth * 2 for stroke
  const radius = lineWidth;
  const radiusSq = radius * radius;
  
  // Draw circles at each vertex (round caps/joins)
  for (const p of path) {
    const cx = Math.round(p.x + offsetX);
    const cy = Math.round(p.y + offsetY);
    
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(height - 1, cy + radius);
    
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= radiusSq) {
          const idx = (y * width + x) * 4;
          output[idx] = r;
          output[idx + 1] = g;
          output[idx + 2] = b;
          output[idx + 3] = 255;
        }
      }
    }
  }
  
  // Draw thick lines between vertices
  for (let i = 0; i < path.length; i++) {
    const p1 = path[i];
    const p2 = path[(i + 1) % path.length];
    
    const x1 = p1.x + offsetX;
    const y1 = p1.y + offsetY;
    const x2 = p2.x + offsetX;
    const y2 = p2.y + offsetY;
    
    // Draw thick line by filling rectangle along the line
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;
    
    // Normal perpendicular to line
    const nx = -dy / len;
    const ny = dx / len;
    
    // Sample along the line length
    const steps = Math.ceil(len);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      
      // Fill a circle at this point
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(width - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(height - 1, Math.ceil(cy + radius));
      
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const ddx = px - cx;
          const ddy = py - cy;
          if (ddx * ddx + ddy * ddy <= radiusSq) {
            const idx = (py * width + px) * 4;
            output[idx] = r;
            output[idx + 1] = g;
            output[idx + 2] = b;
            output[idx + 3] = 255;
          }
        }
      }
    }
  }
}

// Offset path outward by a given amount (expands the path)
// Uses miter-join approach for consistent offset at corners
function offsetPathOutward(path: Point[], offsetPixels: number): Point[] {
  if (path.length < 3 || offsetPixels <= 0) return path;
  
  const result: Point[] = [];
  const n = path.length;
  
  // Determine winding direction (positive area = CCW, negative = CW)
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const curr = path[i];
    const next = path[(i + 1) % n];
    signedArea += (curr.x * next.y) - (next.x * curr.y);
  }
  signedArea /= 2;
  
  // For outward offset: CCW paths need positive direction, CW paths need negative
  const direction = signedArea >= 0 ? -1 : 1;
  
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n];
    const curr = path[i];
    const next = path[(i + 1) % n];
    
    // Edge vectors
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    
    // Normalize
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1;
    
    // Perpendicular normals (pointing outward based on winding)
    const n1x = -e1y / len1 * direction;
    const n1y = e1x / len1 * direction;
    const n2x = -e2y / len2 * direction;
    const n2y = e2x / len2 * direction;
    
    // Average normal at corner
    let nx = (n1x + n2x) / 2;
    let ny = (n1y + n2y) / 2;
    const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nlen;
    ny /= nlen;
    
    // Limit offset at sharp corners to avoid extreme spikes
    const dot = n1x * n2x + n1y * n2y;
    const miterLimit = Math.max(1, 1 / Math.sqrt((1 + dot) / 2 + 0.001));
    const limitedOffset = Math.min(offsetPixels * miterLimit, offsetPixels * 3);
    
    result.push({
      x: curr.x + nx * limitedOffset,
      y: curr.y + ny * limitedOffset
    });
  }
  
  return result;
}

// Fill contour directly using scanline algorithm - fills exactly to the path edge
function fillContourDirect(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  path: Point[],
  offsetX: number,
  offsetY: number,
  r: number,
  g: number,
  b: number
): void {
  if (path.length < 3) return;
  
  let minY = Infinity, maxY = -Infinity;
  for (const p of path) {
    const py = Math.round(p.y + offsetY);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);
  
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    for (let i = 0; i < path.length; i++) {
      const p1 = path[i];
      const p2 = path[(i + 1) % path.length];
      
      const y1 = p1.y + offsetY;
      const y2 = p2.y + offsetY;
      
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const x = p1.x + offsetX + (y - y1) / (y2 - y1) * (p2.x - p1.x);
        intersections.push(x);
      }
    }
    
    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const xStart = Math.max(0, Math.round(intersections[i]));
      const xEnd = Math.min(width - 1, Math.round(intersections[i + 1]));
      
      for (let x = xStart; x <= xEnd; x++) {
        const idx = (y * width + x) * 4;
        output[idx] = r;
        output[idx + 1] = g;
        output[idx + 2] = b;
        output[idx + 3] = 255;
      }
    }
  }
}

function drawLine(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number
): void {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  
  let x = x1, y = y1;
  
  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      output[idx] = r;
      output[idx + 1] = g;
      output[idx + 2] = b;
      output[idx + 3] = 255;
    }
    
    if (x === x2 && y === y2) break;
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillContour(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  path: Point[],
  offsetX: number,
  offsetY: number,
  r: number,
  g: number,
  b: number
): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of path) {
    const py = Math.round(p.y + offsetY);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);
  
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    for (let i = 0; i < path.length; i++) {
      const p1 = path[i];
      const p2 = path[(i + 1) % path.length];
      
      const y1 = p1.y + offsetY;
      const y2 = p2.y + offsetY;
      
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const x = p1.x + offsetX + (y - y1) / (y2 - y1) * (p2.x - p1.x);
        intersections.push(x);
      }
    }
    
    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const xStart = Math.max(0, Math.round(intersections[i]));
      const xEnd = Math.min(width - 1, Math.round(intersections[i + 1]));
      
      for (let x = xStart; x <= xEnd; x++) {
        const idx = (y * width + x) * 4;
        output[idx] = r;
        output[idx + 1] = g;
        output[idx + 2] = b;
        output[idx + 3] = 255;
      }
    }
  }
}

// Extend edge colors outward to fill the bleed area using BFS propagation (efficient O(W*H))
// Note: BFS fills all transparent regions including internal holes, which is intentional
// because the original image (with transparency preserved) is drawn on top in the final render
function createEdgeExtendedImage(
  imageData: ImageData,
  extendRadius: number
): ImageData {
  const { width, height, data } = imageData;
  const newWidth = width + extendRadius * 2;
  const newHeight = height + extendRadius * 2;
  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);
  
  // Track which output pixels have been assigned colors
  const assigned = new Uint8Array(newWidth * newHeight);
  
  // BFS queue for propagation: [x, y, sourceR, sourceG, sourceB]
  const queue: Array<[number, number, number, number, number]> = [];
  
  // First pass: copy original opaque pixels and find edge pixels for BFS seeds
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      if (data[srcIdx + 3] > 128) {
        // Copy to output at offset position
        const outX = x + extendRadius;
        const outY = y + extendRadius;
        const outIdx = (outY * newWidth + outX) * 4;
        newData[outIdx] = data[srcIdx];
        newData[outIdx + 1] = data[srcIdx + 1];
        newData[outIdx + 2] = data[srcIdx + 2];
        newData[outIdx + 3] = data[srcIdx + 3];
        assigned[outY * newWidth + outX] = 1;
        
        // Check if this is an edge pixel (has transparent neighbor)
        let isEdge = false;
        for (let dy = -1; dy <= 1 && !isEdge; dy++) {
          for (let dx = -1; dx <= 1 && !isEdge; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
              isEdge = true;
            } else {
              const nidx = (ny * width + nx) * 4;
              if (data[nidx + 3] < 128) isEdge = true;
            }
          }
        }
        
        // Add edge pixels to BFS queue - they will propagate their color outward
        if (isEdge) {
          queue.push([outX, outY, data[srcIdx], data[srcIdx + 1], data[srcIdx + 2]]);
        }
      }
    }
  }
  
  // BFS propagation: spread edge colors outward
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  let queueIdx = 0;
  
  while (queueIdx < queue.length) {
    const [cx, cy, r, g, b] = queue[queueIdx++];
    
    for (const [dx, dy] of directions) {
      const nx = cx + dx;
      const ny = cy + dy;
      
      // Check bounds
      if (nx < 0 || nx >= newWidth || ny < 0 || ny >= newHeight) continue;
      
      // Skip if already assigned
      if (assigned[ny * newWidth + nx]) continue;
      
      // Mark as assigned and set color
      assigned[ny * newWidth + nx] = 1;
      const outIdx = (ny * newWidth + nx) * 4;
      newData[outIdx] = r;
      newData[outIdx + 1] = g;
      newData[outIdx + 2] = b;
      newData[outIdx + 3] = 255;
      
      // Add to queue for further propagation
      queue.push([nx, ny, r, g, b]);
    }
  }
  
  return new ImageData(newData, newWidth, newHeight);
}

function drawImageToData(
  output: Uint8ClampedArray,
  outputWidth: number,
  outputHeight: number,
  imageData: ImageData,
  offsetX: number,
  offsetY: number
): void {
  const srcData = imageData.data;
  const srcWidth = imageData.width;
  const srcHeight = imageData.height;
  
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++) {
      const srcIdx = (y * srcWidth + x) * 4;
      const alpha = srcData[srcIdx + 3];
      
      if (alpha > 0) {
        const destX = x + offsetX;
        const destY = y + offsetY;
        
        if (destX >= 0 && destX < outputWidth && destY >= 0 && destY < outputHeight) {
          const destIdx = (destY * outputWidth + destX) * 4;
          
          if (alpha === 255) {
            output[destIdx] = srcData[srcIdx];
            output[destIdx + 1] = srcData[srcIdx + 1];
            output[destIdx + 2] = srcData[srcIdx + 2];
            output[destIdx + 3] = 255;
          } else {
            const srcAlpha = alpha / 255;
            const destAlpha = output[destIdx + 3] / 255;
            const outAlpha = srcAlpha + destAlpha * (1 - srcAlpha);
            
            if (outAlpha > 0) {
              output[destIdx] = (srcData[srcIdx] * srcAlpha + output[destIdx] * destAlpha * (1 - srcAlpha)) / outAlpha;
              output[destIdx + 1] = (srcData[srcIdx + 1] * srcAlpha + output[destIdx + 1] * destAlpha * (1 - srcAlpha)) / outAlpha;
              output[destIdx + 2] = (srcData[srcIdx + 2] * srcAlpha + output[destIdx + 2] * destAlpha * (1 - srcAlpha)) / outAlpha;
              output[destIdx + 3] = outAlpha * 255;
            }
          }
        }
      }
    }
  }
}

function createOutputWithImage(
  imageData: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
  effectiveDPI: number,
  backgroundColor: string
): ContourResult {
  const output = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  drawImageToData(output, canvasWidth, canvasHeight, imageData, padding, padding);
  
  // Return empty contour data for images with no contour
  const widthInches = canvasWidth / effectiveDPI;
  const heightInches = canvasHeight / effectiveDPI;
  
  return {
    imageData: new ImageData(output, canvasWidth, canvasHeight),
    contourData: {
      pathPoints: [],
      widthInches,
      heightInches,
      imageOffsetX: padding / effectiveDPI,
      imageOffsetY: padding / effectiveDPI,
      backgroundColor,
      useEdgeBleed: false
    }
  };
}

export {};
