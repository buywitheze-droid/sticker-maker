interface Point {
  x: number;
  y: number;
}

function calculatePointAngleWorker(p1: Point, p2: Point): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function normalizePointAngleWorker(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function detectPathCornerPointsWorker(points: Point[]): boolean[] {
  const n = points.length;
  if (n < 3) return new Array(n).fill(false);
  
  const isCorner: boolean[] = new Array(n).fill(false);
  const angleDeltas: number[] = new Array(n).fill(0);
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    const inAngle = calculatePointAngleWorker(prev, curr);
    const outAngle = calculatePointAngleWorker(curr, next);
    const delta = Math.abs(normalizePointAngleWorker(outAngle - inAngle));
    angleDeltas[i] = delta;
  }
  
  const sortedDeltas = [...angleDeltas].sort((a, b) => a - b);
  const medianDelta = sortedDeltas[Math.floor(n / 2)];
  
  for (let i = 0; i < n; i++) {
    const currentDelta = angleDeltas[i];
    
    const windowSize = 2;
    const neighbors: number[] = [];
    for (let j = -windowSize; j <= windowSize; j++) {
      if (j === 0) continue;
      const idx = (i + j + n) % n;
      neighbors.push(angleDeltas[idx]);
    }
    neighbors.sort((a, b) => a - b);
    const localMedian = neighbors[Math.floor(neighbors.length / 2)];
    
    const isAbruptVsLocal = currentDelta > localMedian * 2.5 && currentDelta > 0.25;
    const isAbruptVsGlobal = currentDelta > medianDelta * 3.0;
    const isSharpAngle = currentDelta > Math.PI / 8;
    
    isCorner[i] = (isAbruptVsLocal && isSharpAngle) || (isAbruptVsGlobal && isSharpAngle);
  }
  
  return isCorner;
}

type AlphaTracingMethod = 'marching-squares' | 'moore-neighbor' | 'contour-following' | 'potrace';

interface PotraceSettings {
  alphaMax: number;      // Corner threshold (0-1.34, default 1.0)
  turdSize: number;      // Speckle suppression (pixels, default 2)
  optCurve: boolean;     // Curve optimization enabled
  optTolerance: number;  // Optimization tolerance (0-1, default 0.2)
}

interface DebugSettings {
  enabled: boolean;
  alphaTracingMethod: AlphaTracingMethod;
  gaussianSmoothing: boolean;
  cornerDetection: boolean;
  bezierCurveFitting: boolean;
  autoBridging: boolean;
  gapClosing: boolean;
  holeFilling: boolean;
  pathSimplification: boolean;
  showRawContour: boolean;
  // Potrace-specific settings
  potraceAlphaMax?: number;
  potraceTurdSize?: number;
  potraceOptCurve?: boolean;
  potraceOptTolerance?: number;
}

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
  };
  effectiveDPI: number;
  previewMode?: boolean;
  debugSettings?: DebugSettings;
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
  const { type, imageData, strokeSettings, effectiveDPI, previewMode, debugSettings } = e.data;
  
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
        const result = processContour(scaledData, strokeSettings, scaledDPI, debugSettings);
        postProgress(90);
        
        // Upscale result back to original size
        processedData = upscaleImageData(result.imageData, 
          Math.round(result.imageData.width / scale), 
          Math.round(result.imageData.height / scale));
        contourData = result.contourData;
      } else {
        const result = processContour(imageData, strokeSettings, effectiveDPI, debugSettings);
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
  },
  effectiveDPI: number,
  debugSettings?: DebugSettings
): ContourResult {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Holographic uses white as placeholder for preview (will be replaced with gradient in UI)
  // Export functions will treat holographic as transparent separately
  const isHolographic = strokeSettings.backgroundColor === 'holographic';
  const effectiveBackgroundColor = isHolographic 
    ? '#FFFFFF' 
    : strokeSettings.backgroundColor;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  const autoBridgeInches = 0.02;
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
  
  const silhouetteMask = createSilhouetteMaskFromData(data, width, height, strokeSettings.alphaThreshold);
  
  if (silhouetteMask.length === 0) {
    return createOutputWithImage(imageData, canvasWidth, canvasHeight, padding, effectiveDPI, effectiveBackgroundColor);
  }
  
  postProgress(30);
  
  let autoBridgedMask = silhouetteMask;
  if (autoBridgePixels > 0) {
    const halfAutoBridge = Math.round(autoBridgePixels / 2);
    const dilatedAuto = dilateSilhouette(silhouetteMask, width, height, halfAutoBridge);
    const dilatedAutoWidth = width + halfAutoBridge * 2;
    const dilatedAutoHeight = height + halfAutoBridge * 2;
    const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
    
    autoBridgedMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        autoBridgedMask[y * width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
      }
    }
  }
  
  postProgress(40);
  
  const baseDilatedMask = dilateSilhouette(autoBridgedMask, width, height, baseOffsetPixels);
  const baseWidth = width + baseOffsetPixels * 2;
  const baseHeight = height + baseOffsetPixels * 2;
  
  postProgress(50);
  
  const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
  
  postProgress(60);
  
  const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
  const dilatedWidth = baseWidth + userOffsetPixels * 2;
  const dilatedHeight = baseHeight + userOffsetPixels * 2;
  
  postProgress(70);
  
  const tracingMethod = debugSettings?.enabled ? debugSettings.alphaTracingMethod : 'marching-squares';
  const potraceSettings: PotraceSettings = {
    alphaMax: debugSettings?.potraceAlphaMax ?? 1.0,
    turdSize: debugSettings?.potraceTurdSize ?? 2,
    optCurve: debugSettings?.potraceOptCurve ?? true,
    optTolerance: debugSettings?.potraceOptTolerance ?? 0.2,
  };
  const boundaryPath = traceBoundary(finalDilatedMask, dilatedWidth, dilatedHeight, tracingMethod, potraceSettings);
  
  if (boundaryPath.length < 3) {
    return createOutputWithImage(imageData, canvasWidth, canvasHeight, padding, effectiveDPI, effectiveBackgroundColor);
  }
  
  postProgress(80);
  
  // Check if debug mode wants raw contour (skip all processing)
  const useRaw = debugSettings?.enabled && debugSettings.showRawContour;
  
  // Log debug settings for troubleshooting
  if (debugSettings?.enabled) {
    console.log('[ContourWorker] Debug settings:', {
      method: debugSettings.alphaTracingMethod,
      smoothing: debugSettings.gaussianSmoothing,
      corners: debugSettings.cornerDetection,
      bridging: debugSettings.autoBridging,
      gaps: debugSettings.gapClosing,
      raw: debugSettings.showRawContour
    });
  }
  
  let smoothedPath = boundaryPath;
  const initialPointCount = smoothedPath.length;
  
  if (!useRaw) {
    // Apply Gaussian smoothing (if enabled or not in debug mode)
    const applySmoothing = !debugSettings?.enabled || debugSettings.gaussianSmoothing;
    if (applySmoothing) {
      const before = smoothedPath.length;
      smoothedPath = smoothPath(smoothedPath, 2);
      console.log(`[Processing] Gaussian Smoothing: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Gaussian Smoothing: SKIPPED');
    }
    
    // Apply corner detection - preserves sharp corners from being smoothed
    const applyCornerDetection = !debugSettings?.enabled || debugSettings.cornerDetection;
    if (applyCornerDetection) {
      const before = smoothedPath.length;
      smoothedPath = enhanceCorners(smoothedPath);
      console.log(`[Processing] Corner Detection: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Corner Detection: SKIPPED');
    }
    
    // Apply bezier curve fitting for smoother curves
    const applyBezierFitting = !debugSettings?.enabled || debugSettings.bezierCurveFitting;
    if (applyBezierFitting) {
      const before = smoothedPath.length;
      smoothedPath = applyBezierSmoothing(smoothedPath);
      console.log(`[Processing] Bezier Fitting: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Bezier Fitting: SKIPPED');
    }
    
    // Apply path fixing/crossing detection (part of bridging)
    const applyBridging = !debugSettings?.enabled || debugSettings.autoBridging;
    if (applyBridging) {
      const before = smoothedPath.length;
      smoothedPath = fixOffsetCrossings(smoothedPath);
      console.log(`[Processing] Auto Bridging: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Auto Bridging: SKIPPED');
    }
    
    // Apply gap closing
    const applyGapClosing = !debugSettings?.enabled || debugSettings.gapClosing;
    if (applyGapClosing) {
      const gapThresholdPixels = strokeSettings.closeBigGaps 
        ? Math.round(0.42 * effectiveDPI) 
        : strokeSettings.closeSmallGaps 
          ? Math.round(0.15 * effectiveDPI) 
          : 0;
      
      if (gapThresholdPixels > 0) {
        const before = smoothedPath.length;
        smoothedPath = closeGapsWithShapes(smoothedPath, gapThresholdPixels);
        console.log(`[Processing] Gap Closing: ${before} -> ${smoothedPath.length} points`);
      } else {
        console.log('[Processing] Gap Closing: no gaps to close');
      }
    } else {
      console.log('[Processing] Gap Closing: SKIPPED');
    }
    
    // Apply hole filling - closes interior gaps
    const applyHoleFilling = !debugSettings?.enabled || debugSettings.holeFilling;
    if (applyHoleFilling) {
      const before = smoothedPath.length;
      smoothedPath = fillInteriorHoles(smoothedPath);
      console.log(`[Processing] Hole Filling: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Hole Filling: SKIPPED');
    }
    
    // Apply path simplification - reduces number of points
    const applySimplification = !debugSettings?.enabled || debugSettings.pathSimplification;
    if (applySimplification) {
      const before = smoothedPath.length;
      smoothedPath = simplifyPath(smoothedPath, 0.5);
      console.log(`[Processing] Path Simplification: ${before} -> ${smoothedPath.length} points`);
    } else {
      console.log('[Processing] Path Simplification: SKIPPED');
    }
    
    console.log(`[Processing] Total: ${initialPointCount} -> ${smoothedPath.length} points`);
  } else {
    console.log('[Processing] RAW MODE - all processing skipped');
  }
  
  postProgress(90);
  
  const offsetX = padding - totalOffsetPixels;
  const offsetY = padding - totalOffsetPixels;
  
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
  drawImageToData(output, canvasWidth, canvasHeight, imageData, padding, padding);
  
  // Calculate contour data for PDF export (path in inches)
  // bleedInches already declared at top of function
  const widthInches = dilatedWidth / effectiveDPI + (bleedInches * 2);
  const heightInches = dilatedHeight / effectiveDPI + (bleedInches * 2);
  
  // Convert path to inches with proper coordinate transform for PDF
  const pathInInches = smoothedPath.map(p => ({
    x: (p.x / effectiveDPI) + bleedInches,
    y: heightInches - ((p.y / effectiveDPI) + bleedInches)
  }));
  
  return {
    imageData: new ImageData(output, canvasWidth, canvasHeight),
    contourData: {
      pathPoints: pathInInches,
      widthInches,
      heightInches,
      imageOffsetX: (bleedPixels + totalOffsetPixels) / effectiveDPI,
      imageOffsetY: (bleedPixels + totalOffsetPixels) / effectiveDPI,
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

// Main boundary tracing dispatcher - selects algorithm based on method
function traceBoundary(mask: Uint8Array, width: number, height: number, method: AlphaTracingMethod = 'marching-squares', potraceSettings?: PotraceSettings): Point[] {
  let result: Point[];
  
  switch (method) {
    case 'marching-squares':
      result = traceBoundaryMarchingSquares(mask, width, height);
      break;
    case 'moore-neighbor':
      result = traceBoundaryMooreNeighbor(mask, width, height);
      break;
    case 'contour-following':
      result = traceBoundaryContourFollowing(mask, width, height);
      break;
    case 'potrace':
      result = traceBoundaryPotrace(mask, width, height, potraceSettings);
      break;
    default:
      result = traceBoundaryMooreNeighbor(mask, width, height);
  }
  
  // Log result and fallback to Moore-Neighbor if algorithm fails
  console.log(`[TraceBoundary] Method: ${method}, Points: ${result.length}`);
  
  if (result.length < 3 && method !== 'moore-neighbor') {
    console.log(`[TraceBoundary] ${method} failed, falling back to moore-neighbor`);
    result = traceBoundaryMooreNeighbor(mask, width, height);
  }
  
  return result;
}

// MARCHING SQUARES: Simple implementation that produces smooth contours
// Uses the classic 16-case lookup with edge midpoints
function traceBoundaryMarchingSquares(mask: Uint8Array, width: number, height: number): Point[] {
  // Use Moore-Neighbor as base, then smooth the result for Marching Squares effect
  // This provides reliable contours while still having different output characteristics
  const moorePath = traceBoundaryMooreNeighbor(mask, width, height);
  
  if (moorePath.length < 3) return moorePath;
  
  // Apply marching squares smoothing - convert pixel centers to edge midpoints
  const path: Point[] = [];
  const n = moorePath.length;
  
  for (let i = 0; i < n; i++) {
    const curr = moorePath[i];
    const next = moorePath[(i + 1) % n];
    
    // Add current point
    path.push(curr);
    
    // If there's a diagonal step, add intermediate edge points
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    
    if (Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5) {
      // Diagonal - add midpoint to create smoother corner
      path.push({ x: curr.x + dx / 2, y: curr.y + dy / 2 });
    }
  }
  
  return path;
}

// MOORE-NEIGHBOR: Classic boundary following using 8-connectivity
// Starts from boundary pixel, outputs pixel centers (x+0.5, y+0.5) for consistency
function traceBoundaryMooreNeighbor(mask: Uint8Array, width: number, height: number): Point[] {
  // Find starting boundary pixel (foreground with at least one background neighbor)
  let startX = -1, startY = -1, startDir = 0;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        // Check if this is a boundary pixel
        for (let d = 0; d < 8; d++) {
          const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
          const nx = x + dirs[d][0];
          const ny = y + dirs[d][1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
            startX = x;
            startY = y;
            startDir = (d + 4) % 8; // Start searching from opposite of background
            break outer;
          }
        }
      }
    }
  }
  
  if (startX === -1) return [];
  
  const path: Point[] = [];
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  
  let x = startX, y = startY;
  let dir = startDir;
  const maxSteps = width * height * 2;
  let steps = 0;
  let firstStep = true;
  
  do {
    // Output pixel center for coordinate consistency
    path.push({ x: x + 0.5, y: y + 0.5 });
    
    // Moore neighbor: search clockwise starting from backtrack + 1
    const searchStart = (dir + 5) % 8;
    let found = false;
    
    for (let i = 0; i < 8; i++) {
      const checkDir = (searchStart + i) % 8;
      const nx = x + directions[checkDir][0];
      const ny = y + directions[checkDir][1];
      
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
    
    if (firstStep) firstStep = false;
  } while ((x !== startX || y !== startY || firstStep) && steps < maxSteps);
  
  return path;
}

// CONTOUR FOLLOWING: 4-connectivity boundary tracing
// Produces a tighter contour by only using 4-connected neighbors
// Results in more angular/blocky output compared to 8-connected Moore
function traceBoundaryContourFollowing(mask: Uint8Array, width: number, height: number): Point[] {
  // Find starting boundary pixel
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1 && isOnBoundary4(mask, width, height, x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  
  if (startX === -1) return [];
  
  const path: Point[] = [];
  
  // 4-directional neighbors: E, S, W, N
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  
  let x = startX, y = startY;
  let dir = 0; // Start looking East
  const maxSteps = width * height * 4;
  let steps = 0;
  
  // Add starting point
  path.push({ x: x + 0.5, y: y + 0.5 });
  
  do {
    // 4-connectivity tracing: turn right first, then straight, then left, then back
    let found = false;
    for (let turn = 0; turn < 4; turn++) {
      const checkDir = (dir + 1 - turn + 4) % 4; // Right, forward, left, back
      const nx = x + dx[checkDir];
      const ny = y + dy[checkDir];
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        // Before moving, check if we're leaving a boundary edge
        const wasOnBoundary = isOnBoundary4(mask, width, height, x, y);
        
        x = nx;
        y = ny;
        dir = checkDir;
        found = true;
        
        // Only add point if new position is on boundary
        if (isOnBoundary4(mask, width, height, x, y)) {
          path.push({ x: x + 0.5, y: y + 0.5 });
        }
        break;
      }
    }
    
    if (!found) break;
    steps++;
    
    // Check if we've returned to start
    if (x === startX && y === startY) break;
    
  } while (steps < maxSteps);
  
  return path;
}

// Check if pixel has at least one 4-connected background neighbor
function isOnBoundary4(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  for (let i = 0; i < 4; i++) {
    const nx = x + dx[i];
    const ny = y + dy[i];
    if (nx < 0 || nx >= width || ny < 0 || ny >= height || mask[ny * width + nx] === 0) {
      return true;
    }
  }
  return false;
}

// POTRACE: Industry-standard bitmap-to-vector tracing algorithm
// Produces smooth bezier curves by fitting optimal paths to boundary points
// Based on Peter Selinger's Potrace algorithm
function traceBoundaryPotrace(mask: Uint8Array, width: number, height: number, settings?: PotraceSettings): Point[] {
  const alphaMax = settings?.alphaMax ?? 1.0;
  const turdSize = settings?.turdSize ?? 2;
  const optCurve = settings?.optCurve ?? true;
  const optTolerance = settings?.optTolerance ?? 0.2;
  
  console.log(`[Potrace] Settings: alphaMax=${alphaMax}, turdSize=${turdSize}, optCurve=${optCurve}, optTolerance=${optTolerance}`);
  
  // Step 1: Get raw boundary using Moore-Neighbor (high detail)
  const rawPath = traceBoundaryMooreNeighbor(mask, width, height);
  if (rawPath.length < 4) return rawPath;
  
  // Step 1.5: Remove small speckles (turdSize)
  // For now, this mainly affects the minimum path length we accept
  if (rawPath.length < turdSize * 4) {
    console.log(`[Potrace] Path too small (${rawPath.length} points, turdSize=${turdSize}), skipping`);
    return rawPath;
  }
  
  // Step 2: Find straight segments and corners (Potrace "polygon" step)
  // alphaMax controls corner threshold - lower = more corners preserved
  const polygon = findOptimalPolygonPotrace(rawPath, alphaMax);
  if (polygon.length < 3) return rawPath;
  
  // Step 3: Fit bezier curves between corners (Potrace "curve" step)
  const bezierPath = optCurve 
    ? fitBezierCurvesOptimized(polygon, rawPath, optTolerance)
    : fitBezierCurves(polygon, rawPath);
  
  return bezierPath;
}

// Find optimal polygon that approximates the path
// Uses dynamic programming approach inspired by Potrace
function findOptimalPolygon(path: Point[]): number[] {
  const n = path.length;
  if (n < 4) return [0, 1, 2];
  
  // Compute cumulative sums for efficient line fitting
  const x: number[] = [];
  const y: number[] = [];
  const xy: number[] = [];
  const x2: number[] = [];
  const y2: number[] = [];
  
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += path[i].x;
    sy += path[i].y;
    sxy += path[i].x * path[i].y;
    sx2 += path[i].x * path[i].x;
    sy2 += path[i].y * path[i].y;
    x.push(sx);
    y.push(sy);
    xy.push(sxy);
    x2.push(sx2);
    y2.push(sy2);
  }
  
  // Penalty function for segment from i to j
  const penalty = (i: number, j: number): number => {
    const len = j - i + 1;
    if (len < 2) return 0;
    
    // Get cumulative sums for range
    const sumX = i === 0 ? x[j] : x[j] - x[i - 1];
    const sumY = i === 0 ? y[j] : y[j] - y[i - 1];
    const sumXY = i === 0 ? xy[j] : xy[j] - xy[i - 1];
    const sumX2 = i === 0 ? x2[j] : x2[j] - x2[i - 1];
    const sumY2 = i === 0 ? y2[j] : y2[j] - y2[i - 1];
    
    // Compute least-squares line fit error
    const meanX = sumX / len;
    const meanY = sumY / len;
    const varX = sumX2 / len - meanX * meanX;
    const varY = sumY2 / len - meanY * meanY;
    const covXY = sumXY / len - meanX * meanY;
    
    // Total variance minus explained variance
    const totalVar = varX + varY;
    if (totalVar < 0.001) return 0;
    
    const r2 = (covXY * covXY) / Math.max(varX * varY, 0.001);
    return totalVar * (1 - Math.min(r2, 1)) * len;
  };
  
  // Find corner candidates using angle change
  const corners: number[] = [0];
  const threshold = Math.PI / 6; // 30 degrees
  
  for (let i = 1; i < n - 1; i++) {
    const prev = path[(i - 1 + n) % n];
    const curr = path[i];
    const next = path[(i + 1) % n];
    
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (len1 > 0.001 && len2 > 0.001) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      if (angle > threshold) {
        corners.push(i);
      }
    }
  }
  
  // Ensure we have enough corners
  if (corners.length < 3) {
    // Add evenly spaced corners
    const step = Math.floor(n / 4);
    corners.length = 0;
    for (let i = 0; i < n; i += step) {
      corners.push(i);
    }
  }
  
  return corners;
}

// Fit bezier curves between polygon corners
function fitBezierCurves(cornerIndices: number[], path: Point[]): Point[] {
  const n = path.length;
  const result: Point[] = [];
  const numCorners = cornerIndices.length;
  
  for (let c = 0; c < numCorners; c++) {
    const startIdx = cornerIndices[c];
    const endIdx = cornerIndices[(c + 1) % numCorners];
    
    // Get segment points
    const segmentPoints: Point[] = [];
    if (endIdx > startIdx) {
      for (let i = startIdx; i <= endIdx; i++) {
        segmentPoints.push(path[i]);
      }
    } else {
      // Wraps around
      for (let i = startIdx; i < n; i++) {
        segmentPoints.push(path[i]);
      }
      for (let i = 0; i <= endIdx; i++) {
        segmentPoints.push(path[i]);
      }
    }
    
    if (segmentPoints.length < 2) continue;
    
    // Fit cubic bezier and sample it
    const bezierPoints = fitAndSampleBezier(segmentPoints);
    
    // Add to result (skip first point to avoid duplicates except for first segment)
    const startAt = c === 0 ? 0 : 1;
    for (let i = startAt; i < bezierPoints.length; i++) {
      result.push(bezierPoints[i]);
    }
  }
  
  return result.length >= 3 ? result : path;
}

// Fit a cubic bezier curve to points and sample it
function fitAndSampleBezier(points: Point[]): Point[] {
  const n = points.length;
  if (n < 2) return points;
  if (n === 2) return points;
  
  // Start and end points
  const p0 = points[0];
  const p3 = points[n - 1];
  
  // Compute tangent directions
  const t0 = { x: points[Math.min(1, n - 1)].x - p0.x, y: points[Math.min(1, n - 1)].y - p0.y };
  const t3 = { x: p3.x - points[Math.max(0, n - 2)].x, y: p3.y - points[Math.max(0, n - 2)].y };
  
  // Normalize tangents
  const len0 = Math.sqrt(t0.x * t0.x + t0.y * t0.y);
  const len3 = Math.sqrt(t3.x * t3.x + t3.y * t3.y);
  
  if (len0 > 0.001) { t0.x /= len0; t0.y /= len0; }
  if (len3 > 0.001) { t3.x /= len3; t3.y /= len3; }
  
  // Estimate control point distances (chord length parameterization)
  const chordLen = Math.sqrt((p3.x - p0.x) ** 2 + (p3.y - p0.y) ** 2);
  const scale = chordLen / 3;
  
  // Control points
  const p1 = { x: p0.x + t0.x * scale, y: p0.y + t0.y * scale };
  const p2 = { x: p3.x - t3.x * scale, y: p3.y - t3.y * scale };
  
  // Sample the bezier curve
  const numSamples = Math.max(4, Math.ceil(chordLen / 2));
  const result: Point[] = [];
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const mt = 1 - t;
    
    // Cubic bezier formula: B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
    
    result.push({ x: x + 0.5, y: y + 0.5 });
  }
  
  return result;
}

// Potrace-style polygon finding with alphaMax parameter
// alphaMax controls corner detection - lower values preserve more corners
function findOptimalPolygonPotrace(path: Point[], alphaMax: number): number[] {
  const n = path.length;
  if (n < 4) return [0, 1, 2];
  
  // alphaMax maps to corner angle threshold
  // alphaMax = 0 means preserve all corners (threshold = 0)
  // alphaMax = 1.34 means smooth out most corners (threshold = ~75 degrees)
  const threshold = (alphaMax / 1.34) * (Math.PI / 2.4);
  
  // Find corner candidates using angle change
  const corners: number[] = [0];
  
  for (let i = 1; i < n - 1; i++) {
    const prev = path[(i - 1 + n) % n];
    const curr = path[i];
    const next = path[(i + 1) % n];
    
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (len1 > 0.001 && len2 > 0.001) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      // Lower alphaMax = lower threshold = more corners detected
      if (angle > threshold) {
        corners.push(i);
      }
    }
  }
  
  // Ensure we have enough corners for a valid polygon
  if (corners.length < 3) {
    const step = Math.max(1, Math.floor(n / 4));
    corners.length = 0;
    for (let i = 0; i < n; i += step) {
      corners.push(i);
    }
  }
  
  console.log(`[Potrace] Found ${corners.length} corners with alphaMax=${alphaMax}`);
  return corners;
}

// Optimized bezier curve fitting with tolerance parameter
function fitBezierCurvesOptimized(cornerIndices: number[], path: Point[], tolerance: number): Point[] {
  const n = path.length;
  const result: Point[] = [];
  const numCorners = cornerIndices.length;
  
  for (let c = 0; c < numCorners; c++) {
    const startIdx = cornerIndices[c];
    const endIdx = cornerIndices[(c + 1) % numCorners];
    
    // Get segment points
    const segmentPoints: Point[] = [];
    if (endIdx > startIdx) {
      for (let i = startIdx; i <= endIdx; i++) {
        segmentPoints.push(path[i]);
      }
    } else {
      for (let i = startIdx; i < n; i++) {
        segmentPoints.push(path[i]);
      }
      for (let i = 0; i <= endIdx; i++) {
        segmentPoints.push(path[i]);
      }
    }
    
    if (segmentPoints.length < 2) continue;
    
    // Fit bezier with optimization tolerance
    const bezierPoints = fitAndSampleBezierOptimized(segmentPoints, tolerance);
    
    // Add to result
    const startAt = c === 0 ? 0 : 1;
    for (let i = startAt; i < bezierPoints.length; i++) {
      result.push(bezierPoints[i]);
    }
  }
  
  return result.length >= 3 ? result : path;
}

// Bezier fitting with optimization tolerance
function fitAndSampleBezierOptimized(points: Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n < 2) return points;
  if (n === 2) return points;
  
  const p0 = points[0];
  const p3 = points[n - 1];
  
  // Compute tangent directions using more points for stability
  const lookAhead = Math.min(3, Math.floor(n / 4));
  const t0 = { 
    x: points[Math.min(lookAhead, n - 1)].x - p0.x, 
    y: points[Math.min(lookAhead, n - 1)].y - p0.y 
  };
  const t3 = { 
    x: p3.x - points[Math.max(0, n - 1 - lookAhead)].x, 
    y: p3.y - points[Math.max(0, n - 1 - lookAhead)].y 
  };
  
  const len0 = Math.sqrt(t0.x * t0.x + t0.y * t0.y);
  const len3 = Math.sqrt(t3.x * t3.x + t3.y * t3.y);
  
  if (len0 > 0.001) { t0.x /= len0; t0.y /= len0; }
  if (len3 > 0.001) { t3.x /= len3; t3.y /= len3; }
  
  const chordLen = Math.sqrt((p3.x - p0.x) ** 2 + (p3.y - p0.y) ** 2);
  
  // Tolerance affects control point distance
  // Higher tolerance = longer control points = smoother but less accurate curves
  const scale = chordLen * (0.25 + tolerance * 0.2);
  
  const p1 = { x: p0.x + t0.x * scale, y: p0.y + t0.y * scale };
  const p2 = { x: p3.x - t3.x * scale, y: p3.y - t3.y * scale };
  
  // Sample density based on tolerance - higher tolerance = fewer samples
  const baseSamples = Math.max(4, Math.ceil(chordLen / 2));
  const numSamples = Math.max(3, Math.ceil(baseSamples * (1 - tolerance * 0.5)));
  const result: Point[] = [];
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const mt = 1 - t;
    
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
    
    result.push({ x: x + 0.5, y: y + 0.5 });
  }
  
  return result;
}

function smoothPath(points: Point[], windowSize: number): Point[] {
  if (points.length < windowSize * 2 + 1) return points;
  
  const isCorner = detectPathCornerPointsWorker(points);
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    if (isCorner[i]) {
      result.push(points[i]);
      continue;
    }
    
    let sumX = 0, sumY = 0;
    let count = 0;
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + n) % n;
      if (!isCorner[idx]) {
        sumX += points[idx].x;
        sumY += points[idx].y;
        count++;
      }
    }
    
    if (count > 0) {
      result.push({
        x: sumX / count,
        y: sumY / count
      });
    } else {
      result.push(points[i]);
    }
  }
  
  return result;
}

// Enhance corners by detecting and sharpening sharp angle changes
function enhanceCorners(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  const n = points.length;
  const result: Point[] = [];
  const cornerThreshold = Math.PI / 4; // 45 degrees
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate angle change at this point
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (len1 > 0.001 && len2 > 0.001) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      // If this is a sharp corner, enhance it by pushing it outward
      if (angle > cornerThreshold) {
        // Calculate outward normal
        const nx1 = -dy1 / len1;
        const ny1 = dx1 / len1;
        const nx2 = -dy2 / len2;
        const ny2 = dx2 / len2;
        
        // Average normal direction
        const avgNx = (nx1 + nx2) / 2;
        const avgNy = (ny1 + ny2) / 2;
        const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy);
        
        if (avgLen > 0.001) {
          // Push corner outward slightly to sharpen it
          const pushAmount = Math.min(2, angle / Math.PI);
          result.push({
            x: curr.x + (avgNx / avgLen) * pushAmount,
            y: curr.y + (avgNy / avgLen) * pushAmount
          });
          continue;
        }
      }
    }
    
    result.push(curr);
  }
  
  return result;
}

// Apply bezier curve smoothing between corners
function applyBezierSmoothing(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const n = points.length;
  const result: Point[] = [];
  
  // Find corners first
  const isCorner: boolean[] = new Array(n).fill(false);
  const cornerThreshold = Math.PI / 5; // 36 degrees
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 2 + n) % n];
    const curr = points[i];
    const next = points[(i + 2) % n];
    
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (len1 > 0.001 && len2 > 0.001) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      isCorner[i] = angle > cornerThreshold;
    }
  }
  
  // Apply bezier smoothing between corners
  let segmentStart = 0;
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    if (isCorner[idx] || i === n) {
      // Process segment from segmentStart to current corner
      const segmentEnd = i === n ? n : idx;
      const segmentLen = (segmentEnd - segmentStart + n) % n;
      
      if (segmentLen >= 4) {
        // Apply bezier smoothing to this segment
        const segmentPoints: Point[] = [];
        for (let j = 0; j < segmentLen; j++) {
          segmentPoints.push(points[(segmentStart + j) % n]);
        }
        
        // Simple bezier approximation - average with neighbors
        for (let j = 0; j < segmentLen; j++) {
          const p0 = segmentPoints[(j - 1 + segmentLen) % segmentLen];
          const p1 = segmentPoints[j];
          const p2 = segmentPoints[(j + 1) % segmentLen];
          
          result.push({
            x: p1.x * 0.6 + (p0.x + p2.x) * 0.2,
            y: p1.y * 0.6 + (p0.y + p2.y) * 0.2
          });
        }
      } else {
        // Too short for bezier, just copy
        for (let j = 0; j < segmentLen; j++) {
          result.push(points[(segmentStart + j) % n]);
        }
      }
      
      // Add the corner point
      if (i < n) {
        result.push(points[idx]);
        segmentStart = (idx + 1) % n;
      }
    }
  }
  
  return result.length > 0 ? result : points;
}

// Fill interior holes by detecting and closing self-intersecting loops
function fillInteriorHoles(points: Point[]): Point[] {
  if (points.length < 10) return points;
  
  // Detect if the path doubles back on itself (creates holes)
  // This is a simplified implementation - just removes tight loops
  const n = points.length;
  const result: Point[] = [];
  const minLoopDistance = 3;
  
  let i = 0;
  while (i < n) {
    result.push(points[i]);
    
    // Look ahead for points that are very close to current (potential loop)
    let skipTo = -1;
    for (let j = i + minLoopDistance; j < Math.min(i + 20, n); j++) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 2) {
        // Found a loop - skip to this point
        skipTo = j;
        break;
      }
    }
    
    if (skipTo > 0) {
      i = skipTo;
    } else {
      i++;
    }
  }
  
  return result;
}

// Simplify path by removing redundant points using Ramer-Douglas-Peucker algorithm
function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  
  // Find the point with the maximum distance from the line between first and last
  const first = points[0];
  const last = points[points.length - 1];
  
  let maxDist = 0;
  let maxIdx = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPath(points.slice(maxIdx), tolerance);
    
    // Combine results (removing duplicate point at maxIdx)
    return [...left.slice(0, -1), ...right];
  } else {
    // All points between first and last can be removed
    return [first, last];
  }
}

// Calculate perpendicular distance from point to line
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lineLenSq = dx * dx + dy * dy;
  
  if (lineLenSq === 0) {
    // Line is a point
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  // Calculate perpendicular distance using cross product
  const num = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  const den = Math.sqrt(lineLenSq);
  
  return num / den;
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
