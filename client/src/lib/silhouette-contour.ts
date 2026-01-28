import { StrokeSettings, ResizeSettings, ShapeSettings } from "@/components/image-editor";
import { PDFDocument, PDFPage, rgb, PDFName, PDFArray, PDFDict, PDFStream, PDFRef } from 'pdf-lib';
import { cropImageToContent } from './image-crop';

export interface ContourPathResult {
  pathPoints: Array<{ x: number; y: number }>; // Points in inches
  widthInches: number;
  heightInches: number;
  imageOffsetX: number; // Image position offset in inches
  imageOffsetY: number;
}

export function createSilhouetteContour(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings?: ResizeSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Calculate effective DPI based on actual image dimensions and target inches
  const effectiveDPI = resizeSettings 
    ? image.width / resizeSettings.widthInches
    : image.width / 5; // Default assumption: image represents ~5 inches
  
  // Base offset (0.015") to create unified silhouette for multi-object images
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  // Detect if image contains text or small complex shapes that need extra smoothing
  const hasTextOrSmallShapes = detectTextOrSmallShapes(image, strokeSettings.alphaThreshold);
  
  // Extra offset for text/small shapes (0.05") to create smoother contours
  const textExtraOffsetInches = hasTextOrSmallShapes ? 0.05 : 0;
  const textExtraOffsetPixels = Math.round(textExtraOffsetInches * effectiveDPI);
  
  // Auto-bridge offset (0.02") - always applied to bridge outlines within 0.02" of each other
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  // Additional gap closing offsets - small (0.07") or big (0.17")
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.19 * effectiveDPI);
  } else if (strokeSettings.closeSmallGaps) {
    gapClosePixels = Math.round(0.07 * effectiveDPI);
  }
  
  // User-selected offset on top of base
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  
  // Total offset is base + user selection + text extra offset (gap close doesn't add to outline size)
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels + textExtraOffsetPixels;
  
  // Canvas needs extra space for the total contour offset
  const padding = totalOffsetPixels + 10;
  canvas.width = image.width + (padding * 2);
  canvas.height = image.height + (padding * 2);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    // Step 1: Create binary silhouette mask from alpha channel
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 2: Auto-bridge outlines within 0.02" of each other (always applied)
    // This makes cutting easier by connecting nearby elements
    let autoBridgedMask = silhouetteMask;
    if (autoBridgePixels > 0) {
      const halfAutoBridge = Math.round(autoBridgePixels / 2);
      const dilatedAuto = dilateSilhouette(silhouetteMask, image.width, image.height, halfAutoBridge);
      const dilatedAutoWidth = image.width + halfAutoBridge * 2;
      const dilatedAutoHeight = image.height + halfAutoBridge * 2;
      const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
      
      // Extract center portion
      autoBridgedMask = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          autoBridgedMask[y * image.width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
        }
      }
    }
    
    // Step 3: If gap closing is enabled, only fill interior gaps without changing outer boundary
    let bridgedMask = autoBridgedMask;
    let bridgedWidth = image.width;
    let bridgedHeight = image.height;
    
    if (gapClosePixels > 0) {
      // Use morphological closing: dilate, fill holes, then erode back
      // This closes gaps while preserving the outer boundary shape
      const halfGapPixels = Math.round(gapClosePixels / 2);
      
      // Step 3a: Dilate to connect nearby elements
      const dilatedMask = dilateSilhouette(autoBridgedMask, image.width, image.height, halfGapPixels);
      const dilatedWidth = image.width + halfGapPixels * 2;
      const dilatedHeight = image.height + halfGapPixels * 2;
      
      // Step 3b: Fill interior holes in the dilated mask
      const filledDilated = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
      
      // Step 3c: Find interior gap pixels only (pixels that are gaps surrounded by content)
      bridgedMask = new Uint8Array(image.width * image.height);
      bridgedMask.set(autoBridgedMask); // Start with original
      
      // Only fill pixels that bridge content in opposing directions
      for (let y = 1; y < image.height - 1; y++) {
        for (let x = 1; x < image.width - 1; x++) {
          if (autoBridgedMask[y * image.width + x] === 0) {
            const srcX = x + halfGapPixels;
            const srcY = y + halfGapPixels;
            if (filledDilated[srcY * dilatedWidth + srcX] === 1) {
              // Check for content in opposing directions within halfGapPixels distance
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              for (let d = 1; d <= halfGapPixels && !hasContentTop; d++) {
                if (y - d >= 0 && autoBridgedMask[(y - d) * image.width + x] === 1) hasContentTop = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentBottom; d++) {
                if (y + d < image.height && autoBridgedMask[(y + d) * image.width + x] === 1) hasContentBottom = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentLeft; d++) {
                if (x - d >= 0 && autoBridgedMask[y * image.width + (x - d)] === 1) hasContentLeft = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentRight; d++) {
                if (x + d < image.width && autoBridgedMask[y * image.width + (x + d)] === 1) hasContentRight = true;
              }
              
              // Bridge if content on opposing sides (vertical or horizontal bridge)
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[y * image.width + x] = 1;
              }
            }
          }
        }
      }
      
      // Step 3d: After gap closing, create smooth bridges for any outlines within 0.03" of each other
      const smoothBridgePixels = Math.round(0.03 * effectiveDPI / 2);
      if (smoothBridgePixels > 0) {
        // Create a distance map from the mask - for each empty pixel, find distance to nearest content
        const distanceMap = new Float32Array(image.width * image.height);
        distanceMap.fill(Infinity);
        
        // Initialize with content pixels having distance 0
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (bridgedMask[y * image.width + x] === 1) {
              distanceMap[y * image.width + x] = 0;
            }
          }
        }
        
        // Forward pass for distance transform
        for (let y = 1; y < image.height; y++) {
          for (let x = 1; x < image.width - 1; x++) {
            const idx = y * image.width + x;
            const topLeft = distanceMap[(y - 1) * image.width + (x - 1)] + 1.414;
            const top = distanceMap[(y - 1) * image.width + x] + 1;
            const topRight = distanceMap[(y - 1) * image.width + (x + 1)] + 1.414;
            const left = distanceMap[y * image.width + (x - 1)] + 1;
            distanceMap[idx] = Math.min(distanceMap[idx], topLeft, top, topRight, left);
          }
        }
        
        // Backward pass
        for (let y = image.height - 2; y >= 0; y--) {
          for (let x = image.width - 2; x >= 1; x--) {
            const idx = y * image.width + x;
            const bottomLeft = distanceMap[(y + 1) * image.width + (x - 1)] + 1.414;
            const bottom = distanceMap[(y + 1) * image.width + x] + 1;
            const bottomRight = distanceMap[(y + 1) * image.width + (x + 1)] + 1.414;
            const right = distanceMap[y * image.width + (x + 1)] + 1;
            distanceMap[idx] = Math.min(distanceMap[idx], bottomLeft, bottom, bottomRight, right);
          }
        }
        
        // Find pixels within smoothBridgePixels distance that bridge two separate content areas
        for (let y = 1; y < image.height - 1; y++) {
          for (let x = 1; x < image.width - 1; x++) {
            const idx = y * image.width + x;
            if (bridgedMask[idx] === 0 && distanceMap[idx] <= smoothBridgePixels) {
              // Check if this pixel bridges content (has content in opposing directions)
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              // Look for content in each direction within smoothBridgePixels
              for (let d = 1; d <= smoothBridgePixels && !hasContentTop; d++) {
                if (y - d >= 0 && bridgedMask[(y - d) * image.width + x] === 1) hasContentTop = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentBottom; d++) {
                if (y + d < image.height && bridgedMask[(y + d) * image.width + x] === 1) hasContentBottom = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentLeft; d++) {
                if (x - d >= 0 && bridgedMask[y * image.width + (x - d)] === 1) hasContentLeft = true;
              }
              for (let d = 1; d <= smoothBridgePixels && !hasContentRight; d++) {
                if (x + d < image.width && bridgedMask[y * image.width + (x + d)] === 1) hasContentRight = true;
              }
              
              // Bridge if content on opposing sides (vertical or horizontal bridge)
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[idx] = 1;
              }
            }
          }
        }
      }
      
      bridgedWidth = image.width;
      bridgedHeight = image.height;
    }
    
    // Step 3 (UNIFIED): Apply morphological closing to connect all objects into ONE shape
    // This ensures multi-object images produce a single contour (consistent with PDF export)
    const unifyRadius = Math.max(10, Math.round(0.05 * effectiveDPI));
    const unifiedMask = unifyDisconnectedObjects(bridgedMask, bridgedWidth, bridgedHeight, unifyRadius);
    
    // PRE-DILATION: Trace boundary and detect corners BEFORE dilation rounds them
    const preDilationBoundary = traceBoundary(unifiedMask, bridgedWidth, bridgedHeight);
    const preDilationCorners = detectSharpCorners(preDilationBoundary, 150);
    console.log(`[PreDilation] Found ${preDilationCorners.length} corners BEFORE dilation`);
    
    // Step 4: Dilate by base offset to create unified silhouette
    const baseDilatedMask = dilateSilhouette(unifiedMask, bridgedWidth, bridgedHeight, baseOffsetPixels);
    const baseWidth = bridgedWidth + baseOffsetPixels * 2;
    const baseHeight = bridgedHeight + baseOffsetPixels * 2;
    
    // Step 4: Fill the base silhouette to create solid shape
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    // Step 5: Dilate the filled silhouette by user-selected offset + text extra offset
    const combinedUserOffset = userOffsetPixels + textExtraOffsetPixels;
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, combinedUserOffset);
    const dilatedWidth = baseWidth + combinedUserOffset * 2;
    const dilatedHeight = baseHeight + combinedUserOffset * 2;
    
    // Step 5a: Auto-bridge any touching or nearly touching contours after dilation
    // This detects where contour outlines are touching and fills the gaps
    const bridgedFinalMask = bridgeTouchingContours(finalDilatedMask, dilatedWidth, dilatedHeight, effectiveDPI);
    
    // Step 6: Trace the boundary of the final dilated silhouette
    let boundaryPath = traceBoundary(bridgedFinalMask, dilatedWidth, dilatedHeight);
    
    // Calculate total dilation offset for corner projection
    const totalDilationOffset = baseOffsetPixels + combinedUserOffset;
    
    // If we detected corners pre-dilation, restore them in the dilated path
    if (preDilationCorners.length >= 3) {
      console.log(`[CornerRestoration] Restoring ${preDilationCorners.length} sharp corners after dilation`);
      boundaryPath = restoreSharpCornersAfterDilation(
        boundaryPath, 
        preDilationCorners, 
        preDilationBoundary,
        totalDilationOffset,
        baseOffsetPixels  // Offset from pre-dilation coordinate space
      );
    }
    
    if (boundaryPath.length < 3) {
      ctx.drawImage(image, padding, padding);
      return canvas;
    }
    
    // Step 6: Check if this is a geometric polygon (straight-line shape)
    const geometricResult = detectGeometricPolygon(boundaryPath);
    
    let smoothedPath: Point[];
    
    if (geometricResult.isPolygon) {
      // Use sharp-corner geometric contour for polygon shapes
      console.log('[Contour] Using geometric polygon mode with sharp corners');
      smoothedPath = createGeometricContour(geometricResult.vertices);
    } else if (strokeSettings.sharpCorners) {
      // SHARP CORNERS MODE: Force perfect sharp corners at all major turns
      console.log('[Contour] SHARP CORNERS MODE ENABLED - forcing perfect sharp turns');
      smoothedPath = createSharpCornersPath(boundaryPath, effectiveDPI);
    } else {
      // Apply normal smoothing for organic/curved shapes
      const smoothingWindow = hasTextOrSmallShapes ? 4 : 2;
      smoothedPath = smoothPath(boundaryPath, smoothingWindow);
    }
    
    // Apply gap closing using U/N shapes based on settings
    const gapThresholdPixels = strokeSettings.closeBigGaps 
      ? Math.round(0.42 * effectiveDPI) 
      : strokeSettings.closeSmallGaps 
        ? Math.round(0.15 * effectiveDPI) 
        : 0;
    
    if (gapThresholdPixels > 0) {
      smoothedPath = closeGapsWithShapes(smoothedPath, gapThresholdPixels);
    }
    
    // Step 7: Draw the contour
    const offsetX = padding - totalOffsetPixels;
    const offsetY = padding - totalOffsetPixels;
    drawSmoothContour(ctx, smoothedPath, strokeSettings.color || '#FFFFFF', offsetX, offsetY);
    
    // Step 8: Draw the original image on top
    ctx.drawImage(image, padding, padding);
    
  } catch (error) {
    console.error('Silhouette contour error:', error);
    ctx.drawImage(image, padding, padding);
  }
  
  return canvas;
}

// Detect if image contains text or small complex shapes that benefit from extra smoothing
// Looks for high edge-to-area ratio (lots of detail relative to size) and multiple disconnected regions
function detectTextOrSmallShapes(image: HTMLImageElement, alphaThreshold: number): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  let edgeCount = 0;
  let opaqueCount = 0;
  let componentCount = 0;
  
  // Create visited array for component counting
  const visited = new Uint8Array(canvas.width * canvas.height);
  
  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < canvas.width - 1; x++) {
      const idx = y * canvas.width + x;
      const alpha = data[idx * 4 + 3];
      
      if (alpha >= alphaThreshold) {
        opaqueCount++;
        
        // Count as edge if any neighbor is transparent
        const neighbors = [
          data[((y - 1) * canvas.width + x) * 4 + 3],
          data[((y + 1) * canvas.width + x) * 4 + 3],
          data[(y * canvas.width + (x - 1)) * 4 + 3],
          data[(y * canvas.width + (x + 1)) * 4 + 3],
        ];
        
        if (neighbors.some(n => n < alphaThreshold)) {
          edgeCount++;
        }
        
        // Count connected components using simple flood fill
        if (!visited[idx]) {
          componentCount++;
          const queue = [idx];
          visited[idx] = 1;
          
          while (queue.length > 0 && queue.length < 10000) { // Limit to avoid infinite loops
            const current = queue.pop()!;
            const cx = current % canvas.width;
            const cy = Math.floor(current / canvas.width);
            
            // Check 4 neighbors
            const neighborCoords = [
              [cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy]
            ];
            
            for (const [nx, ny] of neighborCoords) {
              if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
                const nidx = ny * canvas.width + nx;
                if (!visited[nidx] && data[nidx * 4 + 3] >= alphaThreshold) {
                  visited[nidx] = 1;
                  queue.push(nidx);
                }
              }
            }
          }
        }
      }
    }
  }
  
  if (opaqueCount === 0) return false;
  
  // Calculate edge-to-area ratio (higher = more detailed/complex shapes)
  const edgeRatio = edgeCount / opaqueCount;
  
  // Text typically has:
  // - High edge ratio (> 0.15) due to thin strokes with lots of edges
  // - Multiple components (individual letters)
  // - Relatively small total area
  
  const hasHighEdgeRatio = edgeRatio > 0.12;
  const hasMultipleComponents = componentCount >= 3;
  const hasSmallTotalArea = opaqueCount < (canvas.width * canvas.height * 0.4);
  
  // Consider it text/small shapes if it has high edge ratio OR multiple small components
  const isTextLike = (hasHighEdgeRatio && hasSmallTotalArea) || 
                     (hasMultipleComponents && hasHighEdgeRatio);
  
  if (isTextLike) {
    console.log('[detectTextOrSmallShapes] Detected text/small shapes:', {
      edgeRatio: edgeRatio.toFixed(3),
      componentCount,
      opaqueRatio: (opaqueCount / (canvas.width * canvas.height)).toFixed(3)
    });
  }
  
  return isTextLike;
}

// Fill interior of silhouette using flood fill from edges
function fillSilhouette(mask: Uint8Array, width: number, height: number): Uint8Array {
  const filled = new Uint8Array(mask.length);
  filled.set(mask);
  
  // Mark all exterior transparent pixels by flood filling from edges
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  // Add all edge pixels that are transparent to the queue
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0) queue.push(x);
    if (mask[(height - 1) * width + x] === 0) queue.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    if (mask[y * width] === 0) queue.push(y * width);
    if (mask[y * width + width - 1] === 0) queue.push(y * width + width - 1);
  }
  
  // Mark initial queue items as visited
  for (const idx of queue) {
    visited[idx] = 1;
  }
  
  // Flood fill to find all exterior pixels
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    // Check 4-connected neighbors
    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 }
    ];
    
    for (const { nx, ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (!visited[nidx] && mask[nidx] === 0) {
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
  }
  
  // Fill all non-exterior transparent pixels (interior holes)
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] === 0 && !visited[i]) {
      filled[i] = 1; // Fill interior holes
    }
  }
  
  return filled;
}

// Bridge touching or nearly touching contours after dilation
// This fills small gaps where two contour outlines meet or nearly meet
function bridgeTouchingContours(mask: Uint8Array, width: number, height: number, effectiveDPI: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  result.set(mask);
  
  // Bridge gaps up to 0.03" (touching threshold)
  const bridgeThresholdPixels = Math.max(2, Math.round(0.03 * effectiveDPI));
  
  // Find gaps that are surrounded by content on multiple sides
  // This indicates where two contour regions are touching
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      if (mask[idx] === 0) {
        // Check if this empty pixel is between content regions
        let contentDirections = 0;
        let hasContentTop = false, hasContentBottom = false;
        let hasContentLeft = false, hasContentRight = false;
        
        // Look for content in each direction within bridgeThreshold
        for (let d = 1; d <= bridgeThresholdPixels; d++) {
          if (!hasContentTop && y - d >= 0 && mask[(y - d) * width + x] === 1) {
            hasContentTop = true;
          }
          if (!hasContentBottom && y + d < height && mask[(y + d) * width + x] === 1) {
            hasContentBottom = true;
          }
          if (!hasContentLeft && x - d >= 0 && mask[y * width + (x - d)] === 1) {
            hasContentLeft = true;
          }
          if (!hasContentRight && x + d < width && mask[y * width + (x + d)] === 1) {
            hasContentRight = true;
          }
        }
        
        // Also check diagonal directions for better corner detection
        let hasContentTopLeft = false, hasContentTopRight = false;
        let hasContentBottomLeft = false, hasContentBottomRight = false;
        
        for (let d = 1; d <= bridgeThresholdPixels; d++) {
          if (!hasContentTopLeft && y - d >= 0 && x - d >= 0 && mask[(y - d) * width + (x - d)] === 1) {
            hasContentTopLeft = true;
          }
          if (!hasContentTopRight && y - d >= 0 && x + d < width && mask[(y - d) * width + (x + d)] === 1) {
            hasContentTopRight = true;
          }
          if (!hasContentBottomLeft && y + d < height && x - d >= 0 && mask[(y + d) * width + (x - d)] === 1) {
            hasContentBottomLeft = true;
          }
          if (!hasContentBottomRight && y + d < height && x + d < width && mask[(y + d) * width + (x + d)] === 1) {
            hasContentBottomRight = true;
          }
        }
        
        // Count content directions
        if (hasContentTop) contentDirections++;
        if (hasContentBottom) contentDirections++;
        if (hasContentLeft) contentDirections++;
        if (hasContentRight) contentDirections++;
        
        // Bridge if:
        // 1. Content on opposing sides (vertical or horizontal)
        // 2. OR content on 3+ directions (corner case)
        // 3. OR diagonal touching (content on diagonal + adjacent)
        const hasOpposingSides = (hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight);
        const hasDiagonalTouch = (hasContentTopLeft && hasContentBottomRight) || 
                                  (hasContentTopRight && hasContentBottomLeft);
        const isCorner = contentDirections >= 3;
        
        if (hasOpposingSides || isCorner || hasDiagonalTouch) {
          result[idx] = 1;
        }
      }
    }
  }
  
  // Second pass: fill any remaining tiny interior holes created by the bridging
  // Use flood fill from edges to identify exterior, then fill non-exterior gaps
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  
  // Add all edge pixels that are still transparent to the queue
  for (let x = 0; x < width; x++) {
    if (result[x] === 0 && !visited[x]) {
      queue.push(x);
      visited[x] = 1;
    }
    const bottomIdx = (height - 1) * width + x;
    if (result[bottomIdx] === 0 && !visited[bottomIdx]) {
      queue.push(bottomIdx);
      visited[bottomIdx] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    const leftIdx = y * width;
    if (result[leftIdx] === 0 && !visited[leftIdx]) {
      queue.push(leftIdx);
      visited[leftIdx] = 1;
    }
    const rightIdx = y * width + width - 1;
    if (result[rightIdx] === 0 && !visited[rightIdx]) {
      queue.push(rightIdx);
      visited[rightIdx] = 1;
    }
  }
  
  // Flood fill to find all exterior pixels
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    
    const neighbors = [
      { nx: x - 1, ny: y },
      { nx: x + 1, ny: y },
      { nx: x, ny: y - 1 },
      { nx: x, ny: y + 1 }
    ];
    
    for (const { nx, ny } of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (!visited[nidx] && result[nidx] === 0) {
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
  }
  
  // Fill all non-exterior transparent pixels (tiny interior holes)
  for (let i = 0; i < result.length; i++) {
    if (result[i] === 0 && !visited[i]) {
      result[i] = 1;
    }
  }
  
  return result;
}

// Performance threshold: images above this pixel count get downsampled for contour detection
const HIGH_DETAIL_THRESHOLD = 400000; // ~632x632 pixels
const MAX_PROCESSING_SIZE = 600; // Max dimension for processing high-detail images

interface MaskResult {
  mask: Uint8Array;
  width: number;
  height: number;
  scale: number; // Scale factor used (1.0 = no downsampling)
}

function createSilhouetteMask(image: HTMLImageElement): Uint8Array {
  const result = createOptimizedSilhouetteMask(image);
  
  // If no downsampling was applied, return the mask directly
  if (result.scale === 1.0) {
    return result.mask;
  }
  
  // Upscale the mask back to original dimensions
  return upscaleMask(result.mask, result.width, result.height, image.width, image.height);
}

function createOptimizedSilhouetteMask(image: HTMLImageElement): MaskResult {
  const totalPixels = image.width * image.height;
  
  // For smaller/simpler images, process at full resolution
  if (totalPixels <= HIGH_DETAIL_THRESHOLD) {
    return {
      mask: createMaskAtResolution(image, image.width, image.height),
      width: image.width,
      height: image.height,
      scale: 1.0
    };
  }
  
  // For high-detail images, downsample for faster processing
  const maxDim = Math.max(image.width, image.height);
  const scale = MAX_PROCESSING_SIZE / maxDim;
  const processWidth = Math.round(image.width * scale);
  const processHeight = Math.round(image.height * scale);
  
  return {
    mask: createMaskAtResolution(image, processWidth, processHeight),
    width: processWidth,
    height: processHeight,
    scale: scale
  };
}

function createMaskAtResolution(image: HTMLImageElement, targetWidth: number, targetHeight: number): Uint8Array {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return new Uint8Array(0);

  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  
  // Draw image scaled to target size - browser handles the resampling
  tempCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
  const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  
  // Create binary silhouette with smart artifact filtering
  // Filters out semi-transparent dark/grey pixels from bad background removal
  const mask = new Uint8Array(targetWidth * targetHeight);
  for (let i = 0; i < mask.length; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const alpha = data[idx + 3];
    
    // Skip fully transparent pixels
    if (alpha <= 10) {
      mask[i] = 0;
      continue;
    }
    
    // For semi-transparent pixels (alpha 11-200), apply artifact filtering
    if (alpha < 200) {
      // Calculate brightness (0-255)
      const brightness = (r + g + b) / 3;
      
      // Dark semi-transparent pixels are likely artifacts from bad background removal
      // The darker and more transparent, the more likely it's an artifact
      // Reject if: low alpha + dark color (common in low DPI / bad cutout edges)
      const isDarkArtifact = brightness < 80 && alpha < 150;
      const isGreyArtifact = brightness < 120 && alpha < 100;
      
      if (isDarkArtifact || isGreyArtifact) {
        mask[i] = 0;
        continue;
      }
    }
    
    // Accept pixel as part of the silhouette
    mask[i] = 1;
  }
  
  return mask;
}

function upscaleMask(mask: Uint8Array, srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Uint8Array {
  const result = new Uint8Array(dstWidth * dstHeight);
  const scaleX = srcWidth / dstWidth;
  const scaleY = srcHeight / dstHeight;
  
  for (let y = 0; y < dstHeight; y++) {
    const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1);
    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1);
      result[y * dstWidth + x] = mask[srcY * srcWidth + srcX];
    }
  }
  
  return result;
}

function dilateSilhouette(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const newWidth = width + radius * 2;
  const newHeight = height + radius * 2;
  const dilated = new Uint8Array(newWidth * newHeight);
  
  if (radius <= 0) {
    // Just copy to center
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dilated[y * newWidth + x] = mask[y * width + x];
      }
    }
    return dilated;
  }
  
  // Precompute circle offsets
  const circleOffsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        circleOffsets.push({ dx, dy });
      }
    }
  }
  
  // Dilate: for each solid pixel, fill a circle around it
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        const centerX = x + radius;
        const centerY = y + radius;
        
        for (const { dx, dy } of circleOffsets) {
          const nx = centerX + dx;
          const ny = centerY + dy;
          if (nx >= 0 && nx < newWidth && ny >= 0 && ny < newHeight) {
            dilated[ny * newWidth + nx] = 1;
          }
        }
      }
    }
  }
  
  return dilated;
}

// Erode silhouette - shrink the mask by removing pixels near edges
function erodeSilhouette(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const newWidth = width - radius * 2;
  const newHeight = height - radius * 2;
  
  if (newWidth <= 0 || newHeight <= 0 || radius <= 0) {
    return new Uint8Array(width * height);
  }
  
  const eroded = new Uint8Array(newWidth * newHeight);
  
  // Precompute circle offsets for checking
  const circleOffsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        circleOffsets.push({ dx, dy });
      }
    }
  }
  
  // Erode: a pixel is solid only if ALL pixels in its radius are solid
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = x + radius;
      const srcY = y + radius;
      
      let allSolid = true;
      for (const { dx, dy } of circleOffsets) {
        const checkX = srcX + dx;
        const checkY = srcY + dy;
        if (checkX >= 0 && checkX < width && checkY >= 0 && checkY < height) {
          if (mask[checkY * width + checkX] === 0) {
            allSolid = false;
            break;
          }
        } else {
          allSolid = false;
          break;
        }
      }
      
      eroded[y * newWidth + x] = allSolid ? 1 : 0;
    }
  }
  
  return eroded;
}

// Unify disconnected objects into a single shape using TRUE morphological closing
// Closing = Dilation followed by Erosion - connects nearby objects while preserving outer boundary
// This ensures multi-object images (cloud + wings + text) become ONE cut contour
function unifyDisconnectedObjects(mask: Uint8Array, width: number, height: number, closingRadius: number): Uint8Array {
  if (closingRadius <= 0) return mask;
  
  // Step 1: Create padded mask so erosion doesn't lose edge content
  const paddedWidth = width + closingRadius * 2;
  const paddedHeight = height + closingRadius * 2;
  const paddedMask = new Uint8Array(paddedWidth * paddedHeight);
  
  // Copy original mask into center of padded mask
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      paddedMask[(y + closingRadius) * paddedWidth + (x + closingRadius)] = mask[y * width + x];
    }
  }
  
  // Step 2: Dilate the padded mask to connect nearby objects
  const dilatedMask = dilateSilhouetteInPlace(paddedMask, paddedWidth, paddedHeight, closingRadius);
  
  // Step 3: Fill interior holes in the dilated mask
  const filledMask = fillInteriorHolesForUnification(dilatedMask, paddedWidth, paddedHeight);
  
  // Step 4: Erode back to restore original boundary (this shrinks connections)
  const erodedMask = erodeSilhouetteInPlace(filledMask, paddedWidth, paddedHeight, closingRadius);
  
  // Step 5: Extract center portion matching original dimensions (properly aligned)
  const unifiedMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      unifiedMask[y * width + x] = erodedMask[(y + closingRadius) * paddedWidth + (x + closingRadius)];
    }
  }
  
  return unifiedMask;
}

// Dilate mask in-place (same dimensions, edge pixels become solid if neighbor is solid)
function dilateSilhouetteInPlace(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hasNeighbor = false;
      
      for (let dy = -radius; dy <= radius && !hasNeighbor; dy++) {
        for (let dx = -radius; dx <= radius && !hasNeighbor; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] === 1) {
              hasNeighbor = true;
            }
          }
        }
      }
      
      result[y * width + x] = hasNeighbor ? 1 : 0;
    }
  }
  
  return result;
}

// Erode mask in-place (same dimensions, pixel only solid if all neighbors are solid)
function erodeSilhouetteInPlace(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allSolid = true;
      
      for (let dy = -radius; dy <= radius && allSolid; dy++) {
        for (let dx = -radius; dx <= radius && allSolid; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] === 0) {
              allSolid = false;
            }
          } else {
            allSolid = false;
          }
        }
      }
      
      result[y * width + x] = allSolid ? 1 : 0;
    }
  }
  
  return result;
}

// Fill interior holes for unification (flood fill from edges)
function fillInteriorHolesForUnification(mask: Uint8Array, width: number, height: number): Uint8Array {
  // Flood fill from edges to find exterior, then invert to get filled shape
  const exterior = new Uint8Array(width * height);
  const stack: Array<{x: number, y: number}> = [];
  
  // Start from all edge pixels that are empty
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0) stack.push({x, y: 0});
    if (mask[(height - 1) * width + x] === 0) stack.push({x, y: height - 1});
  }
  for (let y = 0; y < height; y++) {
    if (mask[y * width] === 0) stack.push({x: 0, y});
    if (mask[y * width + width - 1] === 0) stack.push({x: width - 1, y});
  }
  
  // Flood fill exterior
  while (stack.length > 0) {
    const {x, y} = stack.pop()!;
    
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    
    const idx = y * width + x;
    if (exterior[idx] === 1 || mask[idx] === 1) continue;
    
    exterior[idx] = 1;
    
    stack.push({x: x + 1, y});
    stack.push({x: x - 1, y});
    stack.push({x, y: y + 1});
    stack.push({x, y: y - 1});
  }
  
  // Result: anything not exterior is filled (solid)
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) {
    filled[i] = exterior[i] === 0 ? 1 : 0;
  }
  
  return filled;
}

interface Point {
  x: number;
  y: number;
}

function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  // Find all edge pixels first
  const edgePixels: Point[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        // Check if on edge (has at least one transparent neighbor)
        const hasTransparentNeighbor = 
          x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
          mask[y * width + (x - 1)] === 0 ||
          mask[y * width + (x + 1)] === 0 ||
          mask[(y - 1) * width + x] === 0 ||
          mask[(y + 1) * width + x] === 0;
        
        if (hasTransparentNeighbor) {
          edgePixels.push({ x, y });
        }
      }
    }
  }
  
  if (edgePixels.length === 0) return [];
  
  // Create a set for quick lookup
  const edgeSet = new Set(edgePixels.map(p => `${p.x},${p.y}`));
  
  // Start from the topmost-leftmost edge pixel
  let startPixel = edgePixels[0];
  for (const p of edgePixels) {
    if (p.y < startPixel.y || (p.y === startPixel.y && p.x < startPixel.x)) {
      startPixel = p;
    }
  }
  
  // Trace boundary by following connected edge pixels
  const boundary: Point[] = [];
  const visited = new Set<string>();
  
  // 8-directional neighbors (clockwise starting from right)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  
  let current = startPixel;
  let prevDir = 4; // Coming from the left (since we found leftmost pixel)
  
  const maxIterations = edgePixels.length * 2;
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const key = `${current.x},${current.y}`;
    
    if (boundary.length > 0 && current.x === startPixel.x && current.y === startPixel.y) {
      break; // Completed the loop
    }
    
    if (!visited.has(key)) {
      boundary.push({ x: current.x, y: current.y });
      visited.add(key);
    }
    
    // Find next edge pixel, searching clockwise from the direction we came from
    let found = false;
    const searchStart = (prevDir + 5) % 8; // Start searching from 90 degrees left of incoming direction
    
    for (let i = 0; i < 8; i++) {
      const dir = (searchStart + i) % 8;
      const nx = current.x + dx[dir];
      const ny = current.y + dy[dir];
      const nkey = `${nx},${ny}`;
      
      if (edgeSet.has(nkey) && !visited.has(nkey)) {
        current = { x: nx, y: ny };
        prevDir = dir;
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Try to find any unvisited connected edge pixel
      for (let i = 0; i < 8; i++) {
        const nx = current.x + dx[i];
        const ny = current.y + dy[i];
        const nkey = `${nx},${ny}`;
        
        if (edgeSet.has(nkey) && !visited.has(nkey)) {
          current = { x: nx, y: ny };
          prevDir = i;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
  }
  
  return boundary;
}

// Detect if a contour represents a geometric polygon (straight-line shape with few corners)
// Returns the number of vertices if it's a polygon (3-12), or 0 if it's organic/curved
function detectGeometricPolygon(points: Point[]): { isPolygon: boolean; vertices: Point[] } {
  if (points.length < 10) return { isPolygon: false, vertices: [] };
  
  // Calculate bounding box for scale-aware thresholds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bbox = Math.max(maxX - minX, maxY - minY);
  
  // Scale-aware tolerance: 1.5% of bounding box for Douglas-Peucker
  const dpTolerance = Math.max(bbox * 0.015, 2);
  
  // Step 1: Use Douglas-Peucker to find key vertices
  const simplified = douglasPeucker(points, dpTolerance);
  
  // Step 2: Check if we have a reasonable number of vertices for a polygon (3-12)
  if (simplified.length < 3 || simplified.length > 12) {
    console.log(`[GeometricDetection] Rejected: ${simplified.length} vertices (need 3-12)`);
    return { isPolygon: false, vertices: [] };
  }
  
  // Step 3: Check corner angles - corners must be in sharp range (30-150 degrees)
  // This rejects both rounded shapes (near 180°) and over-acute spikes
  let allCornersSharp = true;
  const cornerAngles: number[] = [];
  
  for (let i = 0; i < simplified.length; i++) {
    const prev = simplified[(i - 1 + simplified.length) % simplified.length];
    const curr = simplified[i];
    const next = simplified[(i + 1) % simplified.length];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 0.001 || len2 < 0.001) continue;
    
    // Calculate angle between vectors (this is the exterior angle / turn angle)
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDegrees = angle * 180 / Math.PI;
    cornerAngles.push(angleDegrees);
    
    // Reject if angle is too close to 180° (nearly straight - not a real corner)
    // or if angle is too acute (< 30°) which suggests a spike, not a polygon
    if (angleDegrees > 165 || angleDegrees < 25) {
      allCornersSharp = false;
      break;
    }
  }
  
  if (!allCornersSharp) {
    console.log(`[GeometricDetection] Rejected: corners not in valid range (30-150°)`);
    return { isPolygon: false, vertices: [] };
  }
  
  // Step 4: Per-edge straightness test using segment projection bounds
  const maxDeviationThreshold = Math.max(bbox * 0.012, 1.5); // 1.2% of bbox
  let allEdgesStraight = true;
  
  for (let i = 0; i < simplified.length; i++) {
    const start = simplified[i];
    const end = simplified[(i + 1) % simplified.length];
    
    // Calculate edge vector and length
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const edgeLen = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    if (edgeLen < 1) continue;
    
    // Check points that project onto this segment (not beyond endpoints)
    let maxDeviation = 0;
    for (const pt of points) {
      // Project point onto edge line
      const ptX = pt.x - start.x;
      const ptY = pt.y - start.y;
      const t = (ptX * edgeX + ptY * edgeY) / (edgeLen * edgeLen);
      
      // Only consider points that project within segment bounds (0 < t < 1)
      if (t > 0.05 && t < 0.95) {
        const dist = perpendicularDistance(pt, start, end);
        maxDeviation = Math.max(maxDeviation, dist);
      }
    }
    
    if (maxDeviation > maxDeviationThreshold) {
      allEdgesStraight = false;
      break;
    }
  }
  
  if (!allEdgesStraight) {
    console.log(`[GeometricDetection] Rejected: has curved edges (max deviation > ${maxDeviationThreshold.toFixed(1)}px)`);
    return { isPolygon: false, vertices: [] };
  }
  
  console.log(`[GeometricDetection] ACCEPTED: ${simplified.length}-vertex polygon with sharp corners (${cornerAngles.map(a => a.toFixed(0)).join('°, ')}°) and straight edges`);
  
  return { isPolygon: true, vertices: simplified };
}

// Create a sharp-corner contour for geometric polygons
// Uses exact vertices with no smoothing - perfect sharp corners, minimal lines
function createGeometricContour(vertices: Point[]): Point[] {
  if (vertices.length < 3) return vertices;
  
  // For geometric shapes, return ONLY the exact vertices for fewest possible lines
  // No interpolation - just the pure polygon vertices
  console.log(`[GeometricContour] Created ${vertices.length}-vertex polygon (sharp corners, minimal lines)`);
  
  return vertices;
}

// Create a path with forced sharp corners at all major direction changes
// This is used when the "Sharp Corners" toggle is enabled
function createSharpCornersPath(points: Point[], effectiveDPI: number): Point[] {
  if (points.length < 20) return points;
  
  console.log(`[SharpCorners] Processing ${points.length} points for sharp corner detection`);
  
  // Step 1: Clean up the raw boundary (remove noise, self-intersections)
  let cleaned = removeSelfIntersections(points);
  cleaned = removeSpikes(cleaned, 6, 0.3);
  
  // Step 2: Detect ALL significant direction changes (corners)
  // Use a more aggressive angle threshold to catch more corners
  const corners = detectMajorTurns(cleaned, 160); // 160° threshold catches more turns
  
  console.log(`[SharpCorners] Found ${corners.length} major turns`);
  
  if (corners.length < 3) {
    // Not enough corners detected, fall back to standard smoothing
    console.log(`[SharpCorners] Too few corners, using standard smoothing`);
    return smoothPath(points, 2);
  }
  
  // Step 3: Create a polygon from just the corner points
  // This gives us perfect sharp corners with straight lines between them
  const cornerPoints = corners.map(c => ({
    x: cleaned[c.index].x,
    y: cleaned[c.index].y
  }));
  
  // Step 4: Add intermediate points on long edges to preserve curved sections
  // Only add points where the original path deviates significantly from the straight edge
  const result: Point[] = [];
  const deviationThreshold = effectiveDPI * 0.03; // 0.03" deviation threshold
  
  for (let i = 0; i < cornerPoints.length; i++) {
    const start = cornerPoints[i];
    const end = cornerPoints[(i + 1) % cornerPoints.length];
    const startIdx = corners[i].index;
    const endIdx = corners[(i + 1) % corners.length].index;
    
    // Add the sharp corner point
    result.push({ x: start.x, y: start.y });
    
    // Check if there's significant curvature between these corners
    // If so, add intermediate points to preserve it
    const segmentPoints: Point[] = [];
    let idx = startIdx;
    while (idx !== endIdx) {
      segmentPoints.push(cleaned[idx]);
      idx = (idx + 1) % cleaned.length;
    }
    
    if (segmentPoints.length > 10) {
      // Calculate edge line
      const edgeX = end.x - start.x;
      const edgeY = end.y - start.y;
      const edgeLen = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
      
      if (edgeLen > 5) {
        // Find points that deviate significantly from the straight line
        let maxDeviation = 0;
        let maxDeviationIdx = -1;
        
        for (let j = Math.floor(segmentPoints.length * 0.1); j < segmentPoints.length * 0.9; j++) {
          const pt = segmentPoints[j];
          const ptX = pt.x - start.x;
          const ptY = pt.y - start.y;
          const t = (ptX * edgeX + ptY * edgeY) / (edgeLen * edgeLen);
          
          if (t > 0.15 && t < 0.85) {
            // Calculate perpendicular distance
            const projX = start.x + t * edgeX;
            const projY = start.y + t * edgeY;
            const dist = Math.sqrt((pt.x - projX) ** 2 + (pt.y - projY) ** 2);
            
            if (dist > maxDeviation) {
              maxDeviation = dist;
              maxDeviationIdx = j;
            }
          }
        }
        
        // Only add intermediate point if deviation is significant
        // This preserves curves but keeps straight edges clean
        if (maxDeviation > deviationThreshold && maxDeviationIdx >= 0) {
          // Add a few intermediate points for curved sections
          const numIntermediates = Math.min(3, Math.floor(maxDeviation / deviationThreshold));
          const step = Math.floor(segmentPoints.length / (numIntermediates + 1));
          
          for (let k = 1; k <= numIntermediates; k++) {
            const interIdx = k * step;
            if (interIdx < segmentPoints.length) {
              result.push(segmentPoints[interIdx]);
            }
          }
        }
      }
    }
  }
  
  console.log(`[SharpCorners] Created path with ${result.length} points (${corners.length} sharp corners)`);
  
  return result;
}

// Detect major direction changes (turns) in a path
// More aggressive than detectSharpCorners - designed for "Sharp Corners" mode
function detectMajorTurns(points: Point[], angleThreshold: number = 160): CornerPoint[] {
  const corners: CornerPoint[] = [];
  if (points.length < 20) return corners;
  
  // Use a larger window to detect major structural turns, not minor wiggles
  const windowSize = Math.max(5, Math.floor(points.length / 50));
  
  for (let i = 0; i < points.length; i++) {
    const prevIdx = (i - windowSize + points.length) % points.length;
    const nextIdx = (i + windowSize) % points.length;
    
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[nextIdx];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 2 || len2 < 2) continue;
    
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDegrees = angle * 180 / Math.PI;
    
    // Deviation from straight (180°) 
    const deviation = 180 - angleDegrees;
    
    // If there's significant deviation (> 20°), this is a turn
    if (deviation > (180 - angleThreshold)) {
      corners.push({
        index: i,
        x: curr.x,
        y: curr.y,
        angle: angleDegrees
      });
    }
  }
  
  // Merge nearby corners, keeping the sharpest
  const merged: CornerPoint[] = [];
  const minSpacing = Math.max(windowSize * 3, points.length / 30);
  
  for (const corner of corners) {
    const existing = merged.find(c => Math.abs(c.index - corner.index) < minSpacing);
    if (existing) {
      if (corner.angle < existing.angle) {
        existing.index = corner.index;
        existing.x = corner.x;
        existing.y = corner.y;
        existing.angle = corner.angle;
      }
    } else {
      merged.push({ ...corner });
    }
  }
  
  // Sort by index for proper path ordering
  merged.sort((a, b) => a.index - b.index);
  
  console.log(`[MajorTurns] Detected ${merged.length} major turns: ${merged.map(c => `${(180 - c.angle).toFixed(0)}° deviation`).join(', ')}`);
  
  return merged;
}

// Detect sharp corners in a contour - returns array of corner points with their coordinates
// Uses adaptive window size based on average point spacing
interface CornerPoint {
  index: number;
  x: number;
  y: number;
  angle: number;
}

function detectSharpCorners(points: Point[], angleThreshold: number = 150): CornerPoint[] {
  const corners: CornerPoint[] = [];
  if (points.length < 10) return corners;
  
  // Calculate average point spacing for adaptive window
  let totalDist = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    const dx = next.x - points[i].x;
    const dy = next.y - points[i].y;
    totalDist += Math.sqrt(dx * dx + dy * dy);
  }
  const avgSpacing = totalDist / points.length;
  
  // Adaptive window: aim for ~15 pixels worth of samples (smaller for tighter corner detection)
  const windowSize = Math.max(2, Math.min(10, Math.round(15 / avgSpacing)));
  
  console.log(`[SharpCornerDetection] Analyzing ${points.length} points, avgSpacing: ${avgSpacing.toFixed(2)}, window: ${windowSize}`);
  
  for (let i = 0; i < points.length; i++) {
    const prevIdx = (i - windowSize + points.length) % points.length;
    const nextIdx = (i + windowSize) % points.length;
    
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[nextIdx];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 1 || len2 < 1) continue;
    
    // Calculate angle between vectors
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDegrees = angle * 180 / Math.PI;
    
    // If angle is sharp (less than threshold), this is a corner
    // Use higher threshold (150) to catch more corners
    if (angleDegrees < angleThreshold) {
      corners.push({
        index: i,
        x: curr.x,
        y: curr.y,
        angle: angleDegrees
      });
    }
  }
  
  // Merge nearby corners (keep the sharpest one in each cluster)
  const mergedCorners: CornerPoint[] = [];
  const minCornerSpacing = Math.max(8, windowSize * 2);
  
  for (const corner of corners) {
    const existing = mergedCorners.find(c => 
      Math.abs(c.index - corner.index) < minCornerSpacing ||
      (Math.abs(c.x - corner.x) < 8 && Math.abs(c.y - corner.y) < 8)
    );
    
    if (existing) {
      // Keep the sharper corner
      if (corner.angle < existing.angle) {
        existing.index = corner.index;
        existing.x = corner.x;
        existing.y = corner.y;
        existing.angle = corner.angle;
      }
    } else {
      mergedCorners.push({ ...corner });
    }
  }
  
  // Log detected corners
  if (mergedCorners.length > 0) {
    console.log(`[SharpCornerDetection] Found ${mergedCorners.length} corners: ${mergedCorners.map(c => `${c.angle.toFixed(0)}° at (${c.x.toFixed(0)},${c.y.toFixed(0)})`).join(', ')}`);
  }
  
  return mergedCorners;
}

// Restore sharp corners that were rounded by dilation
// Projects each corner outward along its bisector direction by the dilation amount
function restoreSharpCornersAfterDilation(
  dilatedPath: Point[],
  originalCorners: CornerPoint[],
  originalBoundary: Point[],
  totalDilationOffset: number,
  coordinateOffset: number  // Offset added to coordinate space by dilation
): Point[] {
  if (originalCorners.length === 0 || dilatedPath.length < 10) return dilatedPath;
  
  console.log(`[CornerRestoration] Processing ${originalCorners.length} corners with offset ${totalDilationOffset}px`);
  
  // For each original corner, calculate where it should be after dilation
  const projectedCorners: { x: number; y: number; originalIdx: number; angle: number }[] = [];
  
  for (const corner of originalCorners) {
    // Get points before and after the corner to calculate edge directions
    const idx = corner.index;
    const windowSize = Math.max(5, Math.min(20, Math.floor(originalBoundary.length / 20)));
    
    const prevIdx = (idx - windowSize + originalBoundary.length) % originalBoundary.length;
    const nextIdx = (idx + windowSize) % originalBoundary.length;
    
    const prev = originalBoundary[prevIdx];
    const curr = originalBoundary[idx];
    const next = originalBoundary[nextIdx];
    
    // Calculate incoming and outgoing edge vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 0.1 || len2 < 0.1) continue;
    
    // Normalize vectors
    const n1x = v1x / len1;
    const n1y = v1y / len1;
    const n2x = v2x / len2;
    const n2y = v2y / len2;
    
    // Calculate outward normal for each edge (perpendicular, pointing outward)
    // For a CCW path, outward is to the left of the edge direction
    const out1x = -n1y;
    const out1y = n1x;
    const out2x = -n2y;
    const out2y = n2x;
    
    // Average the two outward normals to get the corner bisector direction
    let bisectX = out1x + out2x;
    let bisectY = out1y + out2y;
    const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
    
    if (bisectLen < 0.1) {
      // Edges are parallel, use the normal directly
      bisectX = out1x;
      bisectY = out1y;
    } else {
      bisectX /= bisectLen;
      bisectY /= bisectLen;
    }
    
    // For sharp corners (< 90°), project further out to maintain the sharp point
    // The sharper the corner, the further we need to project
    const cornerAngleRad = (corner.angle * Math.PI) / 180;
    const halfAngle = cornerAngleRad / 2;
    const projectionMultiplier = halfAngle > 0.1 ? 1 / Math.sin(halfAngle) : 2;
    
    // Project the corner outward
    const projectedX = curr.x + coordinateOffset + bisectX * totalDilationOffset * projectionMultiplier;
    const projectedY = curr.y + coordinateOffset + bisectY * totalDilationOffset * projectionMultiplier;
    
    projectedCorners.push({
      x: projectedX,
      y: projectedY,
      originalIdx: idx,
      angle: corner.angle
    });
    
    console.log(`[CornerRestoration] Corner ${corner.angle.toFixed(0)}° at (${curr.x.toFixed(0)},${curr.y.toFixed(0)}) -> projected to (${projectedX.toFixed(0)},${projectedY.toFixed(0)})`);
  }
  
  if (projectedCorners.length === 0) return dilatedPath;
  
  // Now find the closest points in the dilated path to each projected corner
  // and replace the rounded region with a sharp corner
  const result: Point[] = [];
  const cornerReplacements: { pathIdx: number; newPoint: Point; radius: number }[] = [];
  
  for (const projected of projectedCorners) {
    // Find the closest point in the dilated path
    let closestIdx = 0;
    let closestDist = Infinity;
    
    for (let i = 0; i < dilatedPath.length; i++) {
      const dx = dilatedPath[i].x - projected.x;
      const dy = dilatedPath[i].y - projected.y;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    
    // The replacement radius depends on the dilation amount and corner sharpness
    const replacementRadius = Math.max(3, Math.min(totalDilationOffset * 1.5, dilatedPath.length / 10));
    
    cornerReplacements.push({
      pathIdx: closestIdx,
      newPoint: { x: projected.x, y: projected.y },
      radius: replacementRadius
    });
  }
  
  // Sort replacements by path index
  cornerReplacements.sort((a, b) => a.pathIdx - b.pathIdx);
  
  // Build the new path, replacing rounded sections with sharp corners
  let currentIdx = 0;
  
  for (const replacement of cornerReplacements) {
    const startSkip = Math.max(0, replacement.pathIdx - Math.floor(replacement.radius));
    const endSkip = Math.min(dilatedPath.length - 1, replacement.pathIdx + Math.floor(replacement.radius));
    
    // Add points from current position up to the start of replacement zone
    while (currentIdx < startSkip && currentIdx < dilatedPath.length) {
      result.push(dilatedPath[currentIdx]);
      currentIdx++;
    }
    
    // Add the sharp corner point
    result.push(replacement.newPoint);
    
    // Skip past the rounded section
    currentIdx = endSkip + 1;
  }
  
  // Add remaining points
  while (currentIdx < dilatedPath.length) {
    result.push(dilatedPath[currentIdx]);
    currentIdx++;
  }
  
  console.log(`[CornerRestoration] Result: ${dilatedPath.length} -> ${result.length} points with ${projectedCorners.length} sharp corners`);
  
  return result;
}

// Find the nearest point in the current path to an original corner position
function findNearestPointToCorner(points: Point[], corner: CornerPoint): number {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - corner.x;
    const dy = points[i].y - corner.y;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  
  return nearestIdx;
}

// True segment-based smoothing: split contour at corners, smooth each segment independently
function smoothBySegments(
  points: Point[], 
  corners: CornerPoint[], 
  windowSize: number
): Point[] {
  if (corners.length === 0) {
    // No corners - smooth everything
    return applyMovingAverage(points, windowSize);
  }
  
  // Map original corners to current path positions
  const mappedCornerIndices: number[] = [];
  for (const corner of corners) {
    const idx = findNearestPointToCorner(points, corner);
    mappedCornerIndices.push(idx);
  }
  
  // Sort corner indices
  mappedCornerIndices.sort((a, b) => a - b);
  
  // Remove duplicates
  const uniqueCornerIndices = mappedCornerIndices.filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
  
  if (uniqueCornerIndices.length === 0) {
    return applyMovingAverage(points, windowSize);
  }
  
  // Split contour into segments between corners
  const segments: { startIdx: number; endIdx: number; points: Point[] }[] = [];
  
  for (let i = 0; i < uniqueCornerIndices.length; i++) {
    const startIdx = uniqueCornerIndices[i];
    const endIdx = uniqueCornerIndices[(i + 1) % uniqueCornerIndices.length];
    
    // Extract segment points (excluding corner endpoints - they'll be added back)
    const segmentPoints: Point[] = [];
    let idx = (startIdx + 1) % points.length;
    
    while (idx !== endIdx) {
      segmentPoints.push(points[idx]);
      idx = (idx + 1) % points.length;
    }
    
    segments.push({ startIdx, endIdx, points: segmentPoints });
  }
  
  // Smooth each segment independently (without touching corners)
  const smoothedSegments: Point[][] = [];
  
  for (const segment of segments) {
    if (segment.points.length <= windowSize * 2) {
      // Segment too short to smooth - keep as is
      smoothedSegments.push(segment.points);
    } else {
      // Smooth this segment independently
      const smoothed: Point[] = [];
      for (let i = 0; i < segment.points.length; i++) {
        let sumX = 0, sumY = 0, count = 0;
        
        for (let j = -windowSize; j <= windowSize; j++) {
          const idx = i + j;
          // Only include points within this segment (no wrapping)
          if (idx >= 0 && idx < segment.points.length) {
            sumX += segment.points[idx].x;
            sumY += segment.points[idx].y;
            count++;
          }
        }
        
        if (count > 0) {
          smoothed.push({ x: sumX / count, y: sumY / count });
        } else {
          smoothed.push({ ...segment.points[i] });
        }
      }
      smoothedSegments.push(smoothed);
    }
  }
  
  // Reconstruct the full contour with corners preserved exactly
  const result: Point[] = [];
  
  for (let i = 0; i < uniqueCornerIndices.length; i++) {
    const cornerIdx = uniqueCornerIndices[i];
    // Add the corner point (preserved exactly)
    result.push({ ...points[cornerIdx] });
    // Add the smoothed segment points
    for (const pt of smoothedSegments[i]) {
      result.push(pt);
    }
  }
  
  return result;
}

// Simple moving average smoothing
function applyMovingAverage(points: Point[], windowSize: number): Point[] {
  const result: Point[] = [];
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + points.length) % points.length;
      sumX += points[idx].x;
      sumY += points[idx].y;
      count++;
    }
    
    result.push({ x: sumX / count, y: sumY / count });
  }
  
  return result;
}

// Update corner positions by finding nearest points in current path
function remapCorners(corners: CornerPoint[], points: Point[]): CornerPoint[] {
  return corners.map(corner => {
    const nearestIdx = findNearestPointToCorner(points, corner);
    return {
      index: nearestIdx,
      x: points[nearestIdx].x,
      y: points[nearestIdx].y,
      angle: corner.angle
    };
  });
}

function smoothPath(points: Point[], windowSize: number): Point[] {
  if (points.length < windowSize * 2 + 1) return points;
  
  // Step 0: Detect sharp corners BEFORE any smoothing - these are anchored by position
  // Use 150 degree threshold to catch more corners
  let corners = detectSharpCorners(points, 150);
  console.log(`[SharpCornerDetection] Total: ${corners.length} sharp corners to preserve`);
  
  // Count very sharp corners (< 120 degrees) - these are critical to preserve
  const verySharpCorners = corners.filter(c => c.angle < 120);
  console.log(`[SharpCornerDetection] Very sharp (< 120°): ${verySharpCorners.length}`);
  
  // If we have corners (like a shield/polygon shape), minimize smoothing
  // Lower threshold: 3+ corners OR 2+ very sharp corners triggers geometric mode
  if (corners.length >= 3 || verySharpCorners.length >= 2) {
    console.log(`[SharpCornerDetection] GEOMETRIC SHAPE DETECTED - using minimal smoothing`);
    
    // Only do essential cleanup, skip aggressive smoothing
    let cleaned = removeSelfIntersections(points);
    
    // Re-detect corners after intersection removal
    corners = detectSharpCorners(cleaned, 150);
    console.log(`[SharpCornerDetection] After intersection removal: ${corners.length} corners`);
    
    cleaned = removeSpikes(cleaned, 6, 0.3);
    
    // Re-detect corners after spike removal
    corners = detectSharpCorners(cleaned, 150);
    console.log(`[SharpCornerDetection] After spike removal: ${corners.length} corners`);
    
    // For shapes with very sharp corners, skip smoothing entirely
    const stillVerySharp = corners.filter(c => c.angle < 100);
    if (stillVerySharp.length >= 3) {
      console.log(`[SharpCornerDetection] ZERO SMOOTHING MODE - ${stillVerySharp.length} very sharp corners`);
      
      // No smoothing at all - just simplify with corner protection
      let simplified = simplifyWithCornerProtection(cleaned, corners, 1.0);
      corners = detectSharpCorners(simplified, 150);
      simplified = removeCollinearWithCornerProtection(simplified, corners, 5.0);
      
      console.log(`[SharpCornerDetection] Zero-smooth output: ${simplified.length} points`);
      return simplified;
    }
    
    // Light smoothing with corner protection for shapes with moderate corners
    let smoothed = smoothBySegments(cleaned, corners, 2);
    smoothed = removeSelfIntersections(smoothed);
    
    // Re-detect after smoothing
    corners = detectSharpCorners(smoothed, 150);
    console.log(`[SharpCornerDetection] After light smoothing: ${corners.length} corners`);
    
    // Simplify with corner protection
    let simplified = simplifyWithCornerProtection(smoothed, corners, 1.0);
    
    // Re-detect after simplification
    corners = detectSharpCorners(simplified, 150);
    simplified = removeCollinearWithCornerProtection(simplified, corners, 5.0);
    
    console.log(`[SharpCornerDetection] Geometric shape output: ${simplified.length} points`);
    return simplified;
  }
  
  // Step 1: Remove self-intersections first
  let cleaned = removeSelfIntersections(points);
  
  // Re-map corners after intersection removal
  if (corners.length > 0) {
    corners = remapCorners(corners, cleaned);
  }
  
  // Step 2: Remove tiny spikes/bumps that deviate sharply from the overall curve
  cleaned = removeSpikes(cleaned, 10, 0.25);
  
  // Re-map corners after spike removal
  if (corners.length > 0) {
    corners = remapCorners(corners, cleaned);
  }
  
  // Step 3: Apply smoothing with corner preservation (using segment-based approach)
  const extraLargeWindow = 8;
  let smoothed = smoothBySegments(cleaned, corners, extraLargeWindow);
  
  // Re-map corners after smoothing
  if (corners.length > 0) {
    corners = remapCorners(corners, smoothed);
  }
  
  // Step 4: Remove intersections after first smoothing pass
  smoothed = removeSelfIntersections(smoothed);
  
  // Step 5: Second smoothing pass with medium window, preserving corners
  const mediumWindow = 6;
  let medSmoothed = smoothBySegments(smoothed, corners, mediumWindow);
  
  // Re-map corners
  if (corners.length > 0) {
    corners = remapCorners(corners, medSmoothed);
  }
  
  // Step 6: Apply Chaikin's corner cutting ONLY if few sharp corners
  let chaikinSmoothed: Point[];
  if (corners.length > 3) {
    // Many sharp corners - skip Chaikin to preserve them
    console.log(`[SharpCornerDetection] Skipping Chaikin smoothing to preserve ${corners.length} corners`);
    chaikinSmoothed = medSmoothed;
  } else {
    chaikinSmoothed = applyChaikinSmoothing(medSmoothed, 1);
  }
  
  // Step 7: Remove any remaining intersections
  chaikinSmoothed = removeSelfIntersections(chaikinSmoothed);
  
  // Re-map corners
  if (corners.length > 0) {
    corners = remapCorners(corners, chaikinSmoothed);
  }
  
  // Step 8: Final smoothing pass with corner preservation
  let fineSmoothed = smoothBySegments(chaikinSmoothed, corners, windowSize);
  
  // Step 9: Remove spikes one more time
  fineSmoothed = removeSpikes(fineSmoothed, 6, 0.35);
  
  // Step 10: Final intersection removal
  fineSmoothed = removeSelfIntersections(fineSmoothed);
  
  // Re-map corners before simplification
  if (corners.length > 0) {
    corners = remapCorners(corners, fineSmoothed);
  }
  
  // Corner-protected simplification: split at corners, simplify each segment, reassemble
  let simplified: Point[];
  if (corners.length > 0) {
    simplified = simplifyWithCornerProtection(fineSmoothed, corners, 2.5);
  } else {
    simplified = douglasPeucker(fineSmoothed, 2.5);
  }
  
  // Remove nearly-collinear points but protect corners
  if (corners.length > 0) {
    corners = remapCorners(corners, simplified);
    simplified = removeCollinearWithCornerProtection(simplified, corners, 2.0);
  } else {
    simplified = removeCollinearPoints(simplified, 2.0);
  }
  
  // Skip large curve smoothing if we have sharp corners to preserve
  if (corners.length < 3) {
    simplified = smoothLargeCurves(simplified, 15, 0.6, 25);
    simplified = smoothLargeCurves(simplified, 8, 0.3, 12);
  } else {
    console.log(`[SharpCornerDetection] Skipping large curve smoothing to preserve ${corners.length} corners`);
  }
  
  return simplified;
}

// Simplify path while protecting corner points
function simplifyWithCornerProtection(
  points: Point[], 
  corners: CornerPoint[], 
  tolerance: number
): Point[] {
  if (corners.length === 0) {
    return douglasPeucker(points, tolerance);
  }
  
  // Map corners to current indices
  const cornerIndices: number[] = [];
  for (const corner of corners) {
    const idx = findNearestPointToCorner(points, corner);
    cornerIndices.push(idx);
  }
  
  // Sort and deduplicate
  const sortedCorners = Array.from(new Set(cornerIndices)).sort((a, b) => a - b);
  
  // Split path at corners, simplify each segment, reassemble
  const result: Point[] = [];
  
  for (let i = 0; i < sortedCorners.length; i++) {
    const startIdx = sortedCorners[i];
    const endIdx = sortedCorners[(i + 1) % sortedCorners.length];
    
    // Add the corner point (always preserved)
    result.push({ ...points[startIdx] });
    
    // Extract segment between corners
    const segment: Point[] = [];
    let idx = (startIdx + 1) % points.length;
    while (idx !== endIdx) {
      segment.push(points[idx]);
      idx = (idx + 1) % points.length;
    }
    
    // Simplify segment if long enough
    if (segment.length > 3) {
      const simplified = douglasPeucker(segment, tolerance);
      for (const pt of simplified) {
        result.push(pt);
      }
    } else {
      for (const pt of segment) {
        result.push(pt);
      }
    }
  }
  
  return result;
}

// Remove collinear points while protecting corners
function removeCollinearWithCornerProtection(
  points: Point[],
  corners: CornerPoint[],
  angleTolerance: number
): Point[] {
  if (corners.length === 0) {
    return removeCollinearPoints(points, angleTolerance);
  }
  
  // Map corners to current indices
  const protectedIndices = new Set<number>();
  for (const corner of corners) {
    const idx = findNearestPointToCorner(points, corner);
    protectedIndices.add(idx);
    // Also protect adjacent points
    protectedIndices.add((idx - 1 + points.length) % points.length);
    protectedIndices.add((idx + 1) % points.length);
  }
  
  const result: Point[] = [];
  
  for (let i = 0; i < points.length; i++) {
    // Always keep protected points
    if (protectedIndices.has(i)) {
      result.push(points[i]);
      continue;
    }
    
    // Check if point is collinear with neighbors
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 0.001 || len2 < 0.001) {
      result.push(curr);
      continue;
    }
    
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDeg = angle * 180 / Math.PI;
    
    // Keep point if angle deviation is significant
    if (angleDeg > angleTolerance) {
      result.push(curr);
    }
  }
  
  return result;

// Chaikin's corner cutting algorithm for smooth curves
function applyChaikinSmoothing(points: Point[], iterations: number): Point[] {
  if (points.length < 3) return points;
  
  let result = [...points];
  
  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point[] = [];
    const n = result.length;
    
    for (let i = 0; i < n; i++) {
      const p0 = result[i];
      const p1 = result[(i + 1) % n];
      
      // Create two new points at 1/4 and 3/4 along the segment
      newPoints.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25
      });
      newPoints.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75
      });
    }
    
    result = newPoints;
  }
  
  return result;
}

// Detect and remove self-intersecting segments (Y-shaped and T-shaped crossings)
function removeSelfIntersections(points: Point[]): Point[] {
  if (points.length < 4) return points;
  
  // First: remove narrow concave regions where path doubles back on itself
  let result = removeNarrowConcaveRegions(points);
  
  let changed = true;
  let iterations = 0;
  const maxIterations = 50;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    const n = result.length;
    
    // Check all segment pairs for intersections
    for (let i = 0; i < n && !changed; i++) {
      const p1 = result[i];
      const p2 = result[(i + 1) % n];
      
      // Check against all non-adjacent segments
      for (let j = i + 2; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        
        const p3 = result[j];
        const p4 = result[(j + 1) % n];
        
        const intersection = lineSegmentIntersection(p1, p2, p3, p4);
        
        if (intersection) {
          const loopSize = j - i;
          const remainingSize = n - loopSize;
          
          if (loopSize <= remainingSize) {
            const newPoints: Point[] = [];
            for (let k = 0; k <= i; k++) {
              newPoints.push(result[k]);
            }
            newPoints.push(intersection);
            for (let k = j + 1; k < n; k++) {
              newPoints.push(result[k]);
            }
            result = newPoints;
          } else {
            const newPoints: Point[] = [];
            newPoints.push(intersection);
            for (let k = i + 1; k <= j; k++) {
              newPoints.push(result[k]);
            }
            result = newPoints;
          }
          
          changed = true;
          break;
        }
      }
    }
  }
  
  // Additional passes
  result = fixNearIntersections(result);
  result = removeNarrowConcaveRegions(result);
  
  return result;
}

// Flatten concave regions by replacing them with straight lines
// This prevents crossings by eliminating indentations in the cut path
function removeNarrowConcaveRegions(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  let result = [...points];
  
  // Pass 1: Detect and flatten concave vertices
  result = flattenConcaveVertices(result);
  
  // Pass 2: Remove any remaining tight loops
  result = removeTightLoops(result);
  
  return result;
}

// Close gaps by detecting where paths are close and applying U/N shapes
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
  
  // Find all gap locations where path points are within threshold but far apart in path order
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
    return smoothBridgeAreasForGaps(result);
  }
  
  return result.length >= 3 ? result : points;
}

// Smooth the path to eliminate wave artifacts from gap closing
function smoothBridgeAreasForGaps(points: Point[]): Point[] {
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

// Generate U-shaped merge path (for outward curves)
function generateUShape(start: Point, end: Point, depth: number): Point[] {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  // Direction perpendicular to the line between start and end
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [start, end];
  
  // Perpendicular direction (outward)
  const perpX = -dy / len;
  const perpY = dx / len;
  
  // Create U shape with 3 control points
  const quarterX = (start.x + midX) / 2;
  const quarterY = (start.y + midY) / 2;
  const threeQuarterX = (midX + end.x) / 2;
  const threeQuarterY = (midY + end.y) / 2;
  
  return [
    start,
    { x: quarterX + perpX * depth * 0.5, y: quarterY + perpY * depth * 0.5 },
    { x: midX + perpX * depth, y: midY + perpY * depth },
    { x: threeQuarterX + perpX * depth * 0.5, y: threeQuarterY + perpY * depth * 0.5 },
    end
  ];
}

// Generate N-shaped merge path (for inward/concave transitions)
function generateNShape(start: Point, end: Point, depth: number): Point[] {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [start, end];
  
  // Perpendicular direction (inward - opposite of U)
  const perpX = dy / len;
  const perpY = -dx / len;
  
  // Create gentle N shape
  const quarterX = (start.x + midX) / 2;
  const quarterY = (start.y + midY) / 2;
  const threeQuarterX = (midX + end.x) / 2;
  const threeQuarterY = (midY + end.y) / 2;
  
  return [
    start,
    { x: quarterX + perpX * depth * 0.3, y: quarterY + perpY * depth * 0.3 },
    { x: midX + perpX * depth * 0.5, y: midY + perpY * depth * 0.5 },
    { x: threeQuarterX + perpX * depth * 0.3, y: threeQuarterY + perpY * depth * 0.3 },
    end
  ];
}

// Detect sharp direction changes and insert appropriate merge shapes
function flattenConcaveVertices(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  let i = 0;
  while (i < n) {
    const prevIdx = (i - 1 + n) % n;
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0 && len2 > 0) {
      // Calculate angle between vectors
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const cross = v1x * v2y - v1y * v2x;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      // Sharp turn detected (more than 60 degrees)
      if (angle > Math.PI / 3) {
        // Calculate merge depth based on how sharp the turn is
        const sharpness = angle / Math.PI; // 0 to 1
        const baseDepth = Math.min(len1, len2) * 0.3;
        const depth = baseDepth * (0.5 + sharpness * 0.5);
        
        // Determine if concave (cross < 0) or convex (cross > 0)
        if (cross < 0) {
          // Concave turn - use N shape to smooth inward
          // Remove any previous points that would overshoot
          trimOvershootingPoints(result, curr, 3);
          
          const mergePoints = generateNShape(prev, next, depth);
          for (let m = 1; m < mergePoints.length - 1; m++) {
            result.push(mergePoints[m]);
          }
          // Skip ahead past any points that would continue the overshoot
          i = skipOvershootingPoints(points, i + 1, next, n);
          continue;
        } else if (cross > 0 && angle > Math.PI / 2) {
          // Very sharp convex turn - use U shape
          trimOvershootingPoints(result, curr, 3);
          
          const mergePoints = generateUShape(prev, next, depth);
          for (let m = 1; m < mergePoints.length - 1; m++) {
            result.push(mergePoints[m]);
          }
          i = skipOvershootingPoints(points, i + 1, next, n);
          continue;
        }
      }
    }
    
    result.push(curr);
    i++;
  }
  
  // Final pass: remove any remaining overshoot artifacts
  return removeOvershootArtifacts(result);
}

// Remove points from result that overshoot past the merge point
function trimOvershootingPoints(result: Point[], mergePoint: Point, lookback: number): void {
  if (result.length < 2) return;
  
  // Check last few points - if they're moving away from where the merge will connect, remove them
  for (let trim = 0; trim < Math.min(lookback, result.length - 1); trim++) {
    const lastIdx = result.length - 1;
    const last = result[lastIdx];
    const secondLast = result[lastIdx - 1];
    
    // Check if last point is further from merge than second last (overshooting)
    const distLast = Math.sqrt((last.x - mergePoint.x) ** 2 + (last.y - mergePoint.y) ** 2);
    const distSecond = Math.sqrt((secondLast.x - mergePoint.x) ** 2 + (secondLast.y - mergePoint.y) ** 2);
    
    if (distLast > distSecond + 2) {
      result.pop(); // Remove the overshooting point
    } else {
      break;
    }
  }
}

// Skip points that would continue past the merge
function skipOvershootingPoints(points: Point[], startIdx: number, targetPoint: Point, n: number): number {
  let idx = startIdx;
  let prevDist = Infinity;
  
  // Skip points that are moving away from the target
  while (idx < n) {
    const p = points[idx];
    const dist = Math.sqrt((p.x - targetPoint.x) ** 2 + (p.y - targetPoint.y) ** 2);
    
    if (dist < prevDist || dist < 5) {
      // Getting closer or close enough - stop skipping
      break;
    }
    
    prevDist = dist;
    idx++;
  }
  
  return idx;
}

// Remove remaining overshoot artifacts (points that stick out)
function removeOvershootArtifacts(points: Point[]): Point[] {
  if (points.length < 5) return points;
  
  const result: Point[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev2 = points[(i - 2 + n) % n];
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const next2 = points[(i + 2) % n];
    
    // Check if this point sticks out (further from the line between neighbors)
    const lineX = next.x - prev.x;
    const lineY = next.y - prev.y;
    const lineLen = Math.sqrt(lineX * lineX + lineY * lineY);
    
    if (lineLen > 0) {
      // Distance from curr to line between prev and next
      const toPointX = curr.x - prev.x;
      const toPointY = curr.y - prev.y;
      const cross = Math.abs(lineX * toPointY - lineY * toPointX) / lineLen;
      
      // If point sticks out significantly compared to its neighbors
      const prevCross = Math.abs(lineX * (prev2.y - prev.y) - lineY * (prev2.x - prev.x)) / lineLen;
      const nextCross = Math.abs(lineX * (next2.y - prev.y) - lineY * (next2.x - prev.x)) / lineLen;
      
      // Skip this point if it's a spike (much further from line than neighbors)
      if (cross > 10 && cross > prevCross * 2 && cross > nextCross * 2) {
        continue; // Skip this overshooting point
      }
    }
    
    result.push(curr);
  }
  
  return result.length >= 3 ? result : points;
}

// Remove tight loops where the path doubles back on itself
function removeTightLoops(points: Point[]): Point[] {
  if (points.length < 8) return points;
  
  const result: Point[] = [];
  const n = points.length;
  const skipUntil = new Set<number>();
  
  for (let i = 0; i < n; i++) {
    if (skipUntil.has(i)) continue;
    
    const pi = points[i];
    let foundLoop = false;
    
    // Check if any point ahead is very close (indicating a loop)
    for (let j = i + 4; j < Math.min(i + 30, n); j++) {
      const pj = points[j];
      const dist = Math.sqrt((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2);
      
      if (dist < 4) {
        // Found a loop - skip all points in between
        for (let k = i + 1; k < j; k++) {
          skipUntil.add(k);
        }
        foundLoop = true;
        break;
      }
    }
    
    result.push(pi);
  }
  
  return result.length >= 3 ? result : points;
}

// Fix near-intersections where lines come very close but don't technically cross
function fixNearIntersections(points: Point[]): Point[] {
  if (points.length < 6) return points;
  
  const result: Point[] = [];
  const minDistance = 2; // Minimum distance threshold in pixels
  
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    let tooClose = false;
    
    // Check if this point is too close to any non-adjacent segment
    for (let j = 0; j < points.length - 1; j++) {
      // Skip adjacent segments
      if (Math.abs(i - j) <= 2 || Math.abs(i - j) >= points.length - 2) continue;
      
      const segStart = points[j];
      const segEnd = points[j + 1];
      
      const dist = pointToSegmentDistance(current, segStart, segEnd);
      
      if (dist < minDistance) {
        tooClose = true;
        break;
      }
    }
    
    if (!tooClose) {
      result.push(current);
    }
  }
  
  return result.length >= 3 ? result : points;
}

// Calculate distance from point to line segment
function pointToSegmentDistance(p: Point, segStart: Point, segEnd: Point): number {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lengthSq = dx * dx + dy * dy;
  
  if (lengthSq === 0) {
    return Math.sqrt((p.x - segStart.x) ** 2 + (p.y - segStart.y) ** 2);
  }
  
  let t = ((p.x - segStart.x) * dx + (p.y - segStart.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  
  const nearestX = segStart.x + t * dx;
  const nearestY = segStart.y + t * dy;
  
  return Math.sqrt((p.x - nearestX) ** 2 + (p.y - nearestY) ** 2);
}

// Check if two line segments intersect and return the intersection point
function lineSegmentIntersection(
  p1: Point, p2: Point, 
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  
  const cross = d1x * d2y - d1y * d2x;
  
  // Lines are parallel or nearly parallel
  if (Math.abs(cross) < 0.0001) return null;
  
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  
  // Check if intersection is within both segments (very small margin for better detection)
  const margin = 0.001;
  if (t > margin && t < 1 - margin && u > margin && u < 1 - margin) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y
    };
  }
  
  return null;
}

// Remove spikes/bumps by detecting points that deviate significantly from the line between neighbors
function removeSpikes(points: Point[], neighborDistance: number, threshold: number): Point[] {
  if (points.length < neighborDistance * 2 + 3) return points;
  
  const result: Point[] = [];
  const isSpike = new Array(points.length).fill(false);
  
  // Detect spikes: points where the angle formed is too sharp or deviation is too large
  for (let i = 0; i < points.length; i++) {
    const prevIdx = (i - neighborDistance + points.length) % points.length;
    const nextIdx = (i + neighborDistance) % points.length;
    
    const prev = points[prevIdx];
    const curr = points[i];
    const next = points[nextIdx];
    
    // Calculate the expected position (midpoint of prev and next)
    const expectedX = (prev.x + next.x) / 2;
    const expectedY = (prev.y + next.y) / 2;
    
    // Calculate distance from expected to actual
    const deviation = Math.sqrt((curr.x - expectedX) ** 2 + (curr.y - expectedY) ** 2);
    
    // Calculate the distance between prev and next
    const spanDistance = Math.sqrt((next.x - prev.x) ** 2 + (next.y - prev.y) ** 2);
    
    // If deviation is large relative to the span, it's likely a spike
    if (spanDistance > 0 && deviation / spanDistance > threshold) {
      // Check if this creates a sharp angle (spike detection)
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (mag1 > 0 && mag2 > 0) {
        const cosAngle = dot / (mag1 * mag2);
        // If angle is sharp (cosine closer to -1), mark as spike
        if (cosAngle < 0.3) {
          isSpike[i] = true;
        }
      }
    }
  }
  
  // Replace spikes with interpolated positions
  for (let i = 0; i < points.length; i++) {
    if (isSpike[i]) {
      // Find non-spike neighbors
      let prevGood = i - 1;
      while (prevGood >= 0 && isSpike[(prevGood + points.length) % points.length]) {
        prevGood--;
      }
      let nextGood = i + 1;
      while (nextGood < points.length * 2 && isSpike[nextGood % points.length]) {
        nextGood++;
      }
      
      const prev = points[(prevGood + points.length) % points.length];
      const next = points[nextGood % points.length];
      
      // Interpolate
      const t = 0.5;
      result.push({
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t
      });
    } else {
      result.push(points[i]);
    }
  }
  
  return result;
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
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

// Remove nearly-collinear points on straight segments
// This cleans up micro-curves that should be straight lines
// Uses angle-based detection: if deviation from straight line is < threshold degrees, remove point
function removeCollinearPoints(points: Point[], angleTolerance: number = 2.0): Point[] {
  if (points.length < 3) return points;
  
  const result: Point[] = [];
  const n = points.length;
  const cosThreshold = Math.cos((angleTolerance * Math.PI) / 180); // Convert degrees to radians
  
  // Always keep first point
  result.push(points[0]);
  
  for (let i = 1; i < n - 1; i++) {
    const prev = result[result.length - 1]; // Use last kept point
    const curr = points[i];
    const next = points[i + 1];
    
    // Calculate vectors
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 < 0.001 || len2 < 0.001) {
      // Skip very short segments
      continue;
    }
    
    // Normalize and calculate dot product (cosine of angle)
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    
    // If vectors are nearly parallel (angle close to 0 or 180 degrees), skip point
    // dot > cosThreshold means angle is small (straight line)
    if (dot > cosThreshold) {
      // Nearly straight - skip this point (don't add to result)
      continue;
    }
    
    // Keep the point - it represents an actual curve
    result.push(curr);
  }
  
  // Always keep last point
  result.push(points[n - 1]);
  
  return result;
}

// Smooth large sweeping curves (like butterfly wings) by reducing wobble points
// Detects sequences of points that form gentle arcs and reduces them to key anchor points
// minSpan: minimum number of consecutive points to consider as a "large curve"
// maxAnglePerPoint: max average angle change per point (radians) for gentle curve detection
// minSpatialExtent: minimum bounding box size in pixels to qualify as a curve worth smoothing
function smoothLargeCurves(points: Point[], minSpan: number = 15, maxAnglePerPoint: number = 0.12, minSpatialExtent: number = 30): Point[] {
  if (points.length < minSpan) return points;
  
  const result: Point[] = [];
  const n = points.length;
  let i = 0;
  
  while (i < n) {
    result.push(points[i]);
    
    // Try to find a large gentle curve starting from this point
    let curveEnd = i + 2; // Need at least 2 points to measure angle
    let prevAngle: number | null = null;
    let curveDirection: number | null = null; // Track sign of curvature (+1 or -1)
    let isGentleCurve = true;
    let totalAngleChange = 0;
    let minX = points[i].x, maxX = points[i].x;
    let minY = points[i].y, maxY = points[i].y;
    
    // Look ahead to find consecutive points forming a gentle monotonic curve
    while (curveEnd < n - 1 && curveEnd - i < 50) {
      const p1 = points[curveEnd - 1];
      const p2 = points[curveEnd];
      
      // Track bounding box for spatial extent check
      minX = Math.min(minX, p2.x);
      maxX = Math.max(maxX, p2.x);
      minY = Math.min(minY, p2.y);
      maxY = Math.max(maxY, p2.y);
      
      // Calculate direction angle
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const segmentLen = Math.sqrt(dx * dx + dy * dy);
      
      if (segmentLen < 0.5) {
        curveEnd++;
        continue; // Skip very short segments
      }
      
      const currentAngle = Math.atan2(dy, dx);
      
      if (prevAngle !== null) {
        // Calculate angle change
        let angleDiff = currentAngle - prevAngle;
        // Normalize to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Track curvature direction (must be monotonic for gentle arc)
        if (Math.abs(angleDiff) > 0.01) { // Ignore tiny angle changes
          const thisDirection = angleDiff > 0 ? 1 : -1;
          
          if (curveDirection === null) {
            curveDirection = thisDirection;
          } else if (curveDirection !== thisDirection) {
            // Direction changed - curve is not monotonic, stop here
            break;
          }
        }
        
        totalAngleChange += Math.abs(angleDiff);
        
        // Check if average angle change exceeds threshold
        const avgAngleChangePerPoint = totalAngleChange / (curveEnd - i);
        if (avgAngleChangePerPoint > maxAnglePerPoint) {
          isGentleCurve = false;
          break;
        }
        
        // Check for sudden sharp turn (indicates end of gentle curve)
        if (Math.abs(angleDiff) > 0.5) { // ~29 degrees sudden change
          break;
        }
      }
      
      prevAngle = currentAngle;
      curveEnd++;
    }
    
    const curveLength = curveEnd - i;
    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;
    const spatialExtent = Math.max(bboxWidth, bboxHeight);
    
    // Only simplify if:
    // 1. It's a gentle curve (monotonic, low angle change)
    // 2. Has enough points
    // 3. Has significant spatial extent to avoid affecting small features
    if (isGentleCurve && curveLength >= minSpan && spatialExtent > minSpatialExtent) {
      // Keep key anchor points with geometric error checking
      const simplified: Point[] = [];
      const step = Math.max(4, Math.floor(curveLength / 5)); // ~5 points per large curve
      
      for (let k = step; k < curveLength - 1; k += step) {
        const idx = i + k;
        if (idx < n && idx > i) {
          // Check deviation from line to ensure we're not over-simplifying
          const startPt = points[i];
          const endPt = points[Math.min(i + curveLength - 1, n - 1)];
          const testPt = points[idx];
          const deviation = perpendicularDistance(testPt, startPt, endPt);
          
          // If this point deviates significantly from straight line, keep it
          if (deviation > 2) {
            simplified.push(points[idx]);
          }
        }
      }
      
      // Add simplified points
      for (const pt of simplified) {
        result.push(pt);
      }
      
      // Move to end of this curve
      i = curveEnd - 1;
    } else {
      // Not a large curve, move to next point normally
      i++;
    }
  }
  
  return result;
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
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

function drawSmoothContour(ctx: CanvasRenderingContext2D, contour: Point[], color: string, offsetX: number, offsetY: number): void {
  if (contour.length < 3) return;
  
  // Final cleanup before drawing - focus on removing problematic areas
  let cleanContour = removeSelfIntersections(contour);
  cleanContour = removeNarrowConcaveRegions(cleanContour);
  cleanContour = removeSelfIntersections(cleanContour);

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Add subtle shadow for visibility
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  
  // Start from the first point
  const start = cleanContour[0];
  ctx.moveTo(start.x + offsetX, start.y + offsetY);
  
  // Use simple quadratic curves that never cross - safer than bezier
  for (let i = 0; i < cleanContour.length; i++) {
    const p1 = cleanContour[i];
    const p2 = cleanContour[(i + 1) % cleanContour.length];
    
    // Simple midpoint curve - guaranteed not to create crossings
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    
    ctx.lineTo(midX + offsetX, midY + offsetY);
  }
  
  ctx.closePath();
  ctx.stroke();
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

// Get contour path points for vector export
export function getContourPath(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings
): ContourPathResult | null {
  const effectiveDPI = image.width / resizeSettings.widthInches;
  
  const baseOffsetInches = 0.015;
  const baseOffsetPixels = Math.round(baseOffsetInches * effectiveDPI);
  
  const autoBridgeInches = 0.02;
  const autoBridgePixels = Math.round(autoBridgeInches * effectiveDPI);
  
  let gapClosePixels = 0;
  if (strokeSettings.closeBigGaps) {
    gapClosePixels = Math.round(0.19 * effectiveDPI);
  } else if (strokeSettings.closeSmallGaps) {
    gapClosePixels = Math.round(0.07 * effectiveDPI);
  }
  
  const userOffsetPixels = Math.round(strokeSettings.width * effectiveDPI);
  const totalOffsetPixels = baseOffsetPixels + userOffsetPixels;
  
  try {
    const silhouetteMask = createSilhouetteMask(image);
    if (silhouetteMask.length === 0) return null;
    
    let autoBridgedMask = silhouetteMask;
    if (autoBridgePixels > 0) {
      const halfAutoBridge = Math.round(autoBridgePixels / 2);
      const dilatedAuto = dilateSilhouette(silhouetteMask, image.width, image.height, halfAutoBridge);
      const dilatedAutoWidth = image.width + halfAutoBridge * 2;
      const dilatedAutoHeight = image.height + halfAutoBridge * 2;
      const filledAuto = fillSilhouette(dilatedAuto, dilatedAutoWidth, dilatedAutoHeight);
      
      autoBridgedMask = new Uint8Array(image.width * image.height);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          autoBridgedMask[y * image.width + x] = filledAuto[(y + halfAutoBridge) * dilatedAutoWidth + (x + halfAutoBridge)];
        }
      }
    }
    
    let bridgedMask = autoBridgedMask;
    
    if (gapClosePixels > 0) {
      const halfGapPixels = Math.round(gapClosePixels / 2);
      const dilatedMask = dilateSilhouette(autoBridgedMask, image.width, image.height, halfGapPixels);
      const dilatedWidth = image.width + halfGapPixels * 2;
      const dilatedHeight = image.height + halfGapPixels * 2;
      const filledDilated = fillSilhouette(dilatedMask, dilatedWidth, dilatedHeight);
      
      bridgedMask = new Uint8Array(image.width * image.height);
      bridgedMask.set(autoBridgedMask);
      
      for (let y = 1; y < image.height - 1; y++) {
        for (let x = 1; x < image.width - 1; x++) {
          if (autoBridgedMask[y * image.width + x] === 0) {
            const srcX = x + halfGapPixels;
            const srcY = y + halfGapPixels;
            if (filledDilated[srcY * dilatedWidth + srcX] === 1) {
              let hasContentTop = false, hasContentBottom = false;
              let hasContentLeft = false, hasContentRight = false;
              
              for (let d = 1; d <= halfGapPixels && !hasContentTop; d++) {
                if (y - d >= 0 && autoBridgedMask[(y - d) * image.width + x] === 1) hasContentTop = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentBottom; d++) {
                if (y + d < image.height && autoBridgedMask[(y + d) * image.width + x] === 1) hasContentBottom = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentLeft; d++) {
                if (x - d >= 0 && autoBridgedMask[y * image.width + (x - d)] === 1) hasContentLeft = true;
              }
              for (let d = 1; d <= halfGapPixels && !hasContentRight; d++) {
                if (x + d < image.width && autoBridgedMask[y * image.width + (x + d)] === 1) hasContentRight = true;
              }
              
              if ((hasContentTop && hasContentBottom) || (hasContentLeft && hasContentRight)) {
                bridgedMask[y * image.width + x] = 1;
              }
            }
          }
        }
      }
    }
    
    // CRITICAL: Apply morphological closing to unify all objects into ONE shape
    // This ensures disconnected elements (cloud, wings, text) become a single cut contour
    const unifyRadius = Math.max(10, Math.round(0.05 * effectiveDPI)); // ~0.05" or 10px minimum
    const unifiedMask = unifyDisconnectedObjects(bridgedMask, image.width, image.height, unifyRadius);
    
    const baseDilatedMask = dilateSilhouette(unifiedMask, image.width, image.height, baseOffsetPixels);
    const baseWidth = image.width + baseOffsetPixels * 2;
    const baseHeight = image.height + baseOffsetPixels * 2;
    
    const filledMask = fillSilhouette(baseDilatedMask, baseWidth, baseHeight);
    
    const finalDilatedMask = dilateSilhouette(filledMask, baseWidth, baseHeight, userOffsetPixels);
    const dilatedWidth = baseWidth + userOffsetPixels * 2;
    const dilatedHeight = baseHeight + userOffsetPixels * 2;
    
    const boundaryPath = traceBoundary(finalDilatedMask, dilatedWidth, dilatedHeight);
    
    if (boundaryPath.length < 3) return null;
    
    const smoothedPath = smoothPath(boundaryPath, 2);
    
    // Convert to inches and flip Y for PDF coordinate system (Y=0 at bottom)
    const widthInches = dilatedWidth / effectiveDPI;
    const heightInches = dilatedHeight / effectiveDPI;
    
    // Flip Y coordinates so (0,0) is bottom-left instead of top-left
    const pathInInches = smoothedPath.map(p => ({
      x: p.x / effectiveDPI,
      y: heightInches - (p.y / effectiveDPI) // Flip Y
    }));
    
    const imageOffsetX = totalOffsetPixels / effectiveDPI;
    const imageOffsetY = totalOffsetPixels / effectiveDPI;
    
    return {
      pathPoints: pathInInches,
      widthInches,
      heightInches,
      imageOffsetX,
      imageOffsetY
    };
  } catch (error) {
    console.error('Error getting contour path:', error);
    return null;
  }
}

// Download PDF with raster image and vector contour using spot color "CutContour"
export async function downloadContourPDF(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings,
  filename: string
): Promise<void> {
  const contourResult = getContourPath(image, strokeSettings, resizeSettings);
  if (!contourResult) {
    console.error('Failed to generate contour path');
    return;
  }
  
  const { pathPoints, widthInches, heightInches, imageOffsetX, imageOffsetY } = contourResult;
  
  // Convert inches to points (72 points per inch)
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  
  // Create a canvas to get the image as PNG bytes
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  // Get PNG data as blob then array buffer
  const blob = await new Promise<Blob>((resolve) => {
    tempCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  // Embed the PNG image
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  // Draw image on page (convert inches to points)
  // Path points are already flipped to PDF coordinates (Y=0 at bottom)
  // Image Y position: imageOffsetY is from the BOTTOM in this coordinate system
  const imageXPts = imageOffsetX * 72;
  const imageWidthPts = resizeSettings.widthInches * 72;
  const imageHeightPts = resizeSettings.heightInches * 72;
  const imageYPts = imageOffsetY * 72; // Y from bottom
  
  page.drawImage(pngImage, {
    x: imageXPts,
    y: imageYPts,
    width: imageWidthPts,
    height: imageHeightPts,
  });
  
  // Build the contour path as PDF operators with spot color
  if (pathPoints.length > 2) {
    // Create spot color "CutContour" using Separation color space
    // The path will be drawn using raw PDF content stream operators
    const context = pdfDoc.context;
    
    // Create the tint transform function (maps 1.0 tint to magenta in CMYK)
    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],  // 0% tint = no color
      C1: [0, 1, 0, 0],  // 100% tint = magenta (in CMYK)
      N: 1,
    });
    const tintFunctionRef = context.register(tintFunction);
    
    // Create the Separation color space array
    const separationColorSpace = context.obj([
      PDFName.of('Separation'),
      PDFName.of('CutContour'),
      PDFName.of('DeviceCMYK'),
      tintFunctionRef,
    ]);
    const separationRef = context.register(separationColorSpace);
    
    // Add color space to page resources
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
    }
    
    // Build path operators
    let pathOps = '';
    
    // Set spot color for stroking: /CutContour CS 1 SCN
    pathOps += '/CutContour CS 1 SCN\n';
    
    // Set line width (0.5 points = thin line for cutting)
    pathOps += '0.5 w\n';
    
    // Move to first point (convert to points, Y already flipped in path data)
    const startX = pathPoints[0].x * 72;
    const startY = pathPoints[0].y * 72;
    pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
    
    // Draw smooth bezier curves
    for (let i = 0; i < pathPoints.length; i++) {
      const p0 = pathPoints[(i - 1 + pathPoints.length) % pathPoints.length];
      const p1 = pathPoints[i];
      const p2 = pathPoints[(i + 1) % pathPoints.length];
      const p3 = pathPoints[(i + 2) % pathPoints.length];
      
      const tension = 0.5;
      const cp1x = (p1.x + (p2.x - p0.x) * tension / 3) * 72;
      const cp1y = (p1.y + (p2.y - p0.y) * tension / 3) * 72;
      const cp2x = (p2.x - (p3.x - p1.x) * tension / 3) * 72;
      const cp2y = (p2.y - (p3.y - p1.y) * tension / 3) * 72;
      const endX = p2.x * 72;
      const endY = p2.y * 72;
      
      pathOps += `${cp1x.toFixed(4)} ${cp1y.toFixed(4)} ${cp2x.toFixed(4)} ${cp2y.toFixed(4)} ${endX.toFixed(4)} ${endY.toFixed(4)} c\n`;
    }
    
    // Close and stroke
    pathOps += 'h S\n';
    
    // Append to page content stream
    const existingContents = page.node.Contents();
    if (existingContents) {
      // Get existing content and append our path
      const contentStream = context.stream(pathOps);
      const contentStreamRef = context.register(contentStream);
      
      // Create array with existing content + new content
      if (existingContents instanceof PDFArray) {
        existingContents.push(contentStreamRef);
      } else {
        const newContents = context.obj([existingContents, contentStreamRef]);
        page.node.set(PDFName.of('Contents'), newContents);
      }
    }
  }
  
  // Set PDF metadata
  pdfDoc.setTitle('Sticker with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector']);
  
  // Save and download
  const pdfBytes = await pdfDoc.save();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Download PDF with shape background and CutContour spot color outline
export async function downloadShapePDF(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings,
  filename: string
): Promise<void> {
  // Calculate dimensions in points (72 points per inch)
  const widthPts = shapeSettings.widthInches * 72;
  const heightPts = shapeSettings.heightInches * 72;
  
  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  const context = pdfDoc.context;
  
  // Parse fill color from hex to RGB (0-1 range)
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 1, g: 1, b: 1 };
  };
  
  // Holographic is preview-only, exports as transparent (white fallback for PDF)
  const effectiveFillColor = shapeSettings.fillColor === 'holographic' ? '#FFFFFF' : shapeSettings.fillColor;
  const fillColor = hexToRgb(effectiveFillColor);
  
  // Center coordinates
  const cx = widthPts / 2;
  const cy = heightPts / 2;
  
  // No shape fill - only draw the cutline outline later
  
  // Crop image to remove empty space
  const croppedCanvas = cropImageToContent(image);
  let imageCanvas: HTMLCanvasElement;
  
  if (croppedCanvas) {
    imageCanvas = croppedCanvas;
  } else {
    imageCanvas = document.createElement('canvas');
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext('2d');
    if (ctx) ctx.drawImage(image, 0, 0);
  }
  
  // Get PNG bytes from cropped image
  const blob = await new Promise<Blob>((resolve) => {
    imageCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  // Embed image
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  // Calculate image size based on resize settings (same as preview)
  const imageWidth = resizeSettings.widthInches * 72; // Convert inches to points
  const imageHeight = resizeSettings.heightInches * 72;
  
  // Image position: centered with optional offset
  // Offset is stored at 300 DPI scale, convert to PDF points (72 per inch)
  // Canvas Y increases downward, PDF Y increases upward - flip Y offset
  const dpiToPoints = 72 / 300; // Convert 300 DPI pixels to points
  const offsetXPts = (shapeSettings.offsetX || 0) * dpiToPoints;
  const offsetYPts = (shapeSettings.offsetY || 0) * dpiToPoints;
  const imageX = (widthPts - imageWidth) / 2 + offsetXPts;
  const imageY = (heightPts - imageHeight) / 2 - offsetYPts; // Flip Y: canvas down = PDF up
  
  // Use pdf-lib's drawImage (same as working contour PDF)
  page.drawImage(pngImage, {
    x: imageX,
    y: imageY,
    width: imageWidth,
    height: imageHeight,
  });
  
  // Get resources for adding color space
  let resources = page.node.Resources();
  
  // Create CutContour spot color
  const tintFunction = context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: [0, 1, 0, 0], // Magenta in CMYK
    N: 1,
  });
  const tintFunctionRef = context.register(tintFunction);
  
  const separationColorSpace = context.obj([
    PDFName.of('Separation'),
    PDFName.of('CutContour'),
    PDFName.of('DeviceCMYK'),
    tintFunctionRef,
  ]);
  const separationRef = context.register(separationColorSpace);
  
  // Add color space to page resources
  if (resources) {
    let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) {
      colorSpaceDict = context.obj({});
      resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
    }
    (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
  }
  
  // Build shape outline path with CutContour spot color
  let pathOps = 'q\n'; // Save graphics state
  pathOps += '/CutContour CS 1 SCN\n';
  pathOps += '0.5 w\n'; // Line width
  
  // Calculate outline center - use page center (same as shape would be)
  const outlineCx = cx;
  const outlineCy = cy;
  
  if (shapeSettings.type === 'circle') {
    const r = Math.min(widthPts, heightPts) / 2;
    const k = 0.5522847498;
    const rk = r * k;
    // Circle uses same center as other shapes (no offset needed)
    const circleCy = outlineCy;
    pathOps += `${outlineCx + r} ${circleCy} m\n`;
    pathOps += `${outlineCx + r} ${circleCy + rk} ${outlineCx + rk} ${circleCy + r} ${outlineCx} ${circleCy + r} c\n`;
    pathOps += `${outlineCx - rk} ${circleCy + r} ${outlineCx - r} ${circleCy + rk} ${outlineCx - r} ${circleCy} c\n`;
    pathOps += `${outlineCx - r} ${circleCy - rk} ${outlineCx - rk} ${circleCy - r} ${outlineCx} ${circleCy - r} c\n`;
    pathOps += `${outlineCx + rk} ${circleCy - r} ${outlineCx + r} ${circleCy - rk} ${outlineCx + r} ${circleCy} c\n`;
  } else if (shapeSettings.type === 'oval') {
    const rx = widthPts / 2;
    const ry = heightPts / 2;
    const k = 0.5522847498;
    const rxk = rx * k;
    const ryk = ry * k;
    pathOps += `${outlineCx + rx} ${outlineCy} m\n`;
    pathOps += `${outlineCx + rx} ${outlineCy + ryk} ${outlineCx + rxk} ${outlineCy + ry} ${outlineCx} ${outlineCy + ry} c\n`;
    pathOps += `${outlineCx - rxk} ${outlineCy + ry} ${outlineCx - rx} ${outlineCy + ryk} ${outlineCx - rx} ${outlineCy} c\n`;
    pathOps += `${outlineCx - rx} ${outlineCy - ryk} ${outlineCx - rxk} ${outlineCy - ry} ${outlineCx} ${outlineCy - ry} c\n`;
    pathOps += `${outlineCx + rxk} ${outlineCy - ry} ${outlineCx + rx} ${outlineCy - ryk} ${outlineCx + rx} ${outlineCy} c\n`;
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(widthPts, heightPts);
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += `${sx} ${sy} m\n`;
    pathOps += `${sx + size} ${sy} l\n`;
    pathOps += `${sx + size} ${sy + size} l\n`;
    pathOps += `${sx} ${sy + size} l\n`;
  } else {
    // Rectangle - full page
    pathOps += `0 0 m\n`;
    pathOps += `${widthPts} 0 l\n`;
    pathOps += `${widthPts} ${heightPts} l\n`;
    pathOps += `0 ${heightPts} l\n`;
  }
  
  pathOps += 'h S\n'; // Close and stroke
  pathOps += 'Q\n'; // Restore graphics state
  
  // Create outline content stream
  const outlineStream = context.stream(pathOps);
  const outlineStreamRef = context.register(outlineStream);
  
  // Append outline to existing page contents (shape fill + image already drawn by pdf-lib)
  const existingContents = page.node.Contents();
  
  if (existingContents instanceof PDFArray) {
    existingContents.push(outlineStreamRef);
  } else if (existingContents) {
    const contentsArray = context.obj([existingContents, outlineStreamRef]);
    page.node.set(PDFName.of('Contents'), contentsArray);
  } else {
    page.node.set(PDFName.of('Contents'), outlineStreamRef);
  }
  
  // Set PDF metadata
  pdfDoc.setTitle('Shape with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector', 'shape']);
  
  // Save and download
  const pdfBytes = await pdfDoc.save();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Generate Contour PDF as base64 string (for email attachment)
export async function generateContourPDFBase64(
  image: HTMLImageElement,
  strokeSettings: StrokeSettings,
  resizeSettings: ResizeSettings
): Promise<string | null> {
  const contourResult = getContourPath(image, strokeSettings, resizeSettings);
  if (!contourResult) {
    console.error('Failed to generate contour path');
    return null;
  }
  
  const { pathPoints, widthInches, heightInches, imageOffsetX, imageOffsetY } = contourResult;
  
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;
  
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  tempCtx.drawImage(image, 0, 0);
  
  const blob = await new Promise<Blob>((resolve) => {
    tempCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  const imageXPts = imageOffsetX * 72;
  const imageWidthPts = resizeSettings.widthInches * 72;
  const imageHeightPts = resizeSettings.heightInches * 72;
  const imageYPts = imageOffsetY * 72;
  
  page.drawImage(pngImage, {
    x: imageXPts,
    y: imageYPts,
    width: imageWidthPts,
    height: imageHeightPts,
  });
  
  if (pathPoints.length > 2) {
    const context = pdfDoc.context;
    
    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [0, 1, 0, 0],
      N: 1,
    });
    const tintFunctionRef = context.register(tintFunction);
    
    const separationColorSpace = context.obj([
      PDFName.of('Separation'),
      PDFName.of('CutContour'),
      PDFName.of('DeviceCMYK'),
      tintFunctionRef,
    ]);
    const separationRef = context.register(separationColorSpace);
    
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
    }
    
    let pathOps = '';
    pathOps += '/CutContour CS 1 SCN\n';
    pathOps += '0.5 w\n';
    
    const startX = pathPoints[0].x * 72;
    const startY = pathPoints[0].y * 72;
    pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
    
    for (let i = 0; i < pathPoints.length; i++) {
      const p0 = pathPoints[(i - 1 + pathPoints.length) % pathPoints.length];
      const p1 = pathPoints[i];
      const p2 = pathPoints[(i + 1) % pathPoints.length];
      const p3 = pathPoints[(i + 2) % pathPoints.length];
      
      const tension = 0.5;
      const cp1x = (p1.x + (p2.x - p0.x) * tension / 3) * 72;
      const cp1y = (p1.y + (p2.y - p0.y) * tension / 3) * 72;
      const cp2x = (p2.x - (p3.x - p1.x) * tension / 3) * 72;
      const cp2y = (p2.y - (p3.y - p1.y) * tension / 3) * 72;
      const endX = p2.x * 72;
      const endY = p2.y * 72;
      
      pathOps += `${cp1x.toFixed(4)} ${cp1y.toFixed(4)} ${cp2x.toFixed(4)} ${cp2y.toFixed(4)} ${endX.toFixed(4)} ${endY.toFixed(4)} c\n`;
    }
    
    pathOps += 'h S\n';
    
    const existingContents = page.node.Contents();
    if (existingContents) {
      const contentStream = context.stream(pathOps);
      const contentStreamRef = context.register(contentStream);
      
      if (existingContents instanceof PDFArray) {
        existingContents.push(contentStreamRef);
      } else {
        const newContents = context.obj([existingContents, contentStreamRef]);
        page.node.set(PDFName.of('Contents'), newContents);
      }
    }
  }
  
  pdfDoc.setTitle('Sticker with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  
  const pdfBytes = await pdfDoc.save();
  
  let binary = '';
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}

// Generate Shape PDF as base64 string (for email attachment)
export async function generateShapePDFBase64(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings
): Promise<string | null> {
  const widthPts = shapeSettings.widthInches * 72;
  const heightPts = shapeSettings.heightInches * 72;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  const context = pdfDoc.context;
  
  const cx = widthPts / 2;
  const cy = heightPts / 2;
  
  const croppedCanvas = cropImageToContent(image);
  let imageCanvas: HTMLCanvasElement;
  
  if (croppedCanvas) {
    imageCanvas = croppedCanvas;
  } else {
    imageCanvas = document.createElement('canvas');
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext('2d');
    if (ctx) ctx.drawImage(image, 0, 0);
  }
  
  const blob = await new Promise<Blob>((resolve) => {
    imageCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  const imageWidth = resizeSettings.widthInches * 72;
  const imageHeight = resizeSettings.heightInches * 72;
  
  const dpiToPoints = 72 / 300;
  const offsetXPts = (shapeSettings.offsetX || 0) * dpiToPoints;
  const offsetYPts = (shapeSettings.offsetY || 0) * dpiToPoints;
  const imageX = (widthPts - imageWidth) / 2 + offsetXPts;
  const imageY = (heightPts - imageHeight) / 2 - offsetYPts;
  
  page.drawImage(pngImage, {
    x: imageX,
    y: imageY,
    width: imageWidth,
    height: imageHeight,
  });
  
  let resources = page.node.Resources();
  
  const tintFunction = context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: [0, 1, 0, 0],
    N: 1,
  });
  const tintFunctionRef = context.register(tintFunction);
  
  const separationColorSpace = context.obj([
    PDFName.of('Separation'),
    PDFName.of('CutContour'),
    PDFName.of('DeviceCMYK'),
    tintFunctionRef,
  ]);
  const separationRef = context.register(separationColorSpace);
  
  if (resources) {
    let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) {
      colorSpaceDict = context.obj({});
      resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
    }
    (colorSpaceDict as PDFDict).set(PDFName.of('CutContour'), separationRef);
  }
  
  let pathOps = 'q\n';
  pathOps += '/CutContour CS 1 SCN\n';
  pathOps += '0.5 w\n';
  
  const outlineCx = cx;
  const outlineCy = cy;
  
  if (shapeSettings.type === 'circle') {
    const r = Math.min(widthPts, heightPts) / 2;
    const k = 0.5522847498;
    const rk = r * k;
    const circleCy = outlineCy;
    pathOps += `${outlineCx + r} ${circleCy} m\n`;
    pathOps += `${outlineCx + r} ${circleCy + rk} ${outlineCx + rk} ${circleCy + r} ${outlineCx} ${circleCy + r} c\n`;
    pathOps += `${outlineCx - rk} ${circleCy + r} ${outlineCx - r} ${circleCy + rk} ${outlineCx - r} ${circleCy} c\n`;
    pathOps += `${outlineCx - r} ${circleCy - rk} ${outlineCx - rk} ${circleCy - r} ${outlineCx} ${circleCy - r} c\n`;
    pathOps += `${outlineCx + rk} ${circleCy - r} ${outlineCx + r} ${circleCy - rk} ${outlineCx + r} ${circleCy} c\n`;
  } else if (shapeSettings.type === 'oval') {
    const rx = widthPts / 2;
    const ry = heightPts / 2;
    const k = 0.5522847498;
    const rxk = rx * k;
    const ryk = ry * k;
    pathOps += `${outlineCx + rx} ${outlineCy} m\n`;
    pathOps += `${outlineCx + rx} ${outlineCy + ryk} ${outlineCx + rxk} ${outlineCy + ry} ${outlineCx} ${outlineCy + ry} c\n`;
    pathOps += `${outlineCx - rxk} ${outlineCy + ry} ${outlineCx - rx} ${outlineCy + ryk} ${outlineCx - rx} ${outlineCy} c\n`;
    pathOps += `${outlineCx - rx} ${outlineCy - ryk} ${outlineCx - rxk} ${outlineCy - ry} ${outlineCx} ${outlineCy - ry} c\n`;
    pathOps += `${outlineCx + rxk} ${outlineCy - ry} ${outlineCx + rx} ${outlineCy - ryk} ${outlineCx + rx} ${outlineCy} c\n`;
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(widthPts, heightPts);
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += `${sx} ${sy} m\n`;
    pathOps += `${sx + size} ${sy} l\n`;
    pathOps += `${sx + size} ${sy + size} l\n`;
    pathOps += `${sx} ${sy + size} l\n`;
  } else {
    pathOps += `0 0 m\n`;
    pathOps += `${widthPts} 0 l\n`;
    pathOps += `${widthPts} ${heightPts} l\n`;
    pathOps += `0 ${heightPts} l\n`;
  }
  
  pathOps += 'h S\n';
  pathOps += 'Q\n';
  
  const outlineStream = context.stream(pathOps);
  const outlineStreamRef = context.register(outlineStream);
  
  const existingContents = page.node.Contents();
  
  if (existingContents instanceof PDFArray) {
    existingContents.push(outlineStreamRef);
  } else if (existingContents) {
    const contentsArray = context.obj([existingContents, outlineStreamRef]);
    page.node.set(PDFName.of('Contents'), contentsArray);
  } else {
    page.node.set(PDFName.of('Contents'), outlineStreamRef);
  }
  
  pdfDoc.setTitle('Shape with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  
  const pdfBytes = await pdfDoc.save();
  
  let binary = '';
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}
