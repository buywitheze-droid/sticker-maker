import type { ShapeSettings, ResizeSettings } from "@/lib/types";
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { cropImageToContent, createEdgeBleedCanvas } from './image-crop';

export interface SpotColorInput {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite: boolean;
  spotGloss: boolean;
  spotWhiteName?: string;
  spotGlossName?: string;
}

// Helper function to generate PDF path operations for a rounded rectangle
function getRoundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522847498; // Bezier approximation constant for circles
  const rk = r * k;
  
  let path = `${x + r} ${y} m\n`; // Start at top-left + radius
  path += `${x + width - r} ${y} l\n`; // Top edge
  path += `${x + width - r + rk} ${y} ${x + width} ${y + r - rk} ${x + width} ${y + r} c\n`; // Top-right corner
  path += `${x + width} ${y + height - r} l\n`; // Right edge
  path += `${x + width} ${y + height - r + rk} ${x + width - r + rk} ${y + height} ${x + width - r} ${y + height} c\n`; // Bottom-right corner
  path += `${x + r} ${y + height} l\n`; // Bottom edge
  path += `${x + r - rk} ${y + height} ${x} ${y + height - r + rk} ${x} ${y + height - r} c\n`; // Bottom-left corner
  path += `${x} ${y + r} l\n`; // Left edge
  path += `${x} ${y + r - rk} ${x + r - rk} ${y} ${x + r} ${y} c\n`; // Top-left corner
  
  return path;
}

export function calculateShapeDimensions(
  designWidthInches: number,
  designHeightInches: number,
  shapeType: ShapeSettings['type'],
  offset: number
): { widthInches: number; heightInches: number } {
  const totalOffset = offset * 2; // offset on each side
  
  if (shapeType === 'circle') {
    // Circle uses the larger dimension to ensure design fits
    // Use a smaller offset multiplier for circles to create a tighter fit
    const largerDim = Math.max(designWidthInches, designHeightInches);
    const diameter = largerDim + (totalOffset * 0.5); // Half offset for tighter circle fit
    return { widthInches: diameter, heightInches: diameter };
  } else if (shapeType === 'square' || shapeType === 'rounded-square') {
    // Square uses the larger dimension
    const size = Math.max(designWidthInches, designHeightInches) + totalOffset;
    return { widthInches: size, heightInches: size };
  } else if (shapeType === 'oval') {
    // Oval follows the design aspect ratio with tighter offset
    // Use half offset for ovals to create a tighter fit like circles
    const tightOffset = totalOffset * 0.5;
    let width = designWidthInches + tightOffset;
    let height = designHeightInches + tightOffset;
    
    // Minimum aspect ratio: at least 1.2:1 (20% longer on one side)
    const minAspectRatio = 1.2;
    const currentRatio = Math.max(width, height) / Math.min(width, height);
    
    if (currentRatio < minAspectRatio) {
      // Design is too square-ish, stretch to make it a proper oval
      if (width >= height) {
        // Make it wider
        width = height * minAspectRatio;
      } else {
        // Make it taller
        height = width * minAspectRatio;
      }
    }
    
    return {
      widthInches: parseFloat(width.toFixed(3)),
      heightInches: parseFloat(height.toFixed(3))
    };
  } else {
    // Rectangle and rounded-rectangle follow the design aspect ratio
    // But force a minimum aspect ratio difference to ensure it looks like a rectangle
    let width = designWidthInches + totalOffset;
    let height = designHeightInches + totalOffset;
    
    // Minimum aspect ratio: at least 1.2:1 (20% longer on one side)
    const minAspectRatio = 1.2;
    const currentRatio = Math.max(width, height) / Math.min(width, height);
    
    if (currentRatio < minAspectRatio) {
      // Design is too square-ish, stretch to make it a proper rectangle
      if (width >= height) {
        // Make it wider
        width = height * minAspectRatio;
      } else {
        // Make it taller
        height = width * minAspectRatio;
      }
    }
    
    return {
      widthInches: parseFloat(width.toFixed(3)),
      heightInches: parseFloat(height.toFixed(3))
    };
  }
}

export async function downloadShapePDF(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings,
  filename: string,
  spotColors?: SpotColorInput[],
  singleArtboard: boolean = true
): Promise<void> {
  // Calculate shape size based on design size + offset
  const { widthInches, heightInches } = calculateShapeDimensions(
    resizeSettings.widthInches,
    resizeSettings.heightInches,
    shapeSettings.type,
    shapeSettings.offset
  );
  
  const bleedInches = shapeSettings.bleedEnabled ? 0.10 : 0; // 0.10" bleed around the shape (if enabled)
  const bleedPts = bleedInches * 72;
  
  // Page size includes bleed area (if enabled)
  const widthPts = widthInches * 72 + (bleedPts * 2);
  const heightPts = heightInches * 72 + (bleedPts * 2);
  
  // Shape dimensions for cut line (without bleed)
  const shapeWidthPts = widthInches * 72;
  const shapeHeightPts = heightInches * 72;
  
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
  
  let imageWidth = resizeSettings.widthInches * 72;
  let imageHeight = resizeSettings.heightInches * 72;
  
  // For circles and ovals, scale down the image so it fits entirely inside the shape
  // A rectangle fits inside a circle when its diagonal ≤ diameter
  // For an oval, the inscribed rectangle must satisfy (w/2/a)² + (h/2/b)² ≤ 1
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(shapeWidthPts, shapeHeightPts) / 2;
    const diameter = radius * 2;
    const diagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
    if (diagonal > diameter) {
      const scale = diameter / diagonal;
      imageWidth *= scale;
      imageHeight *= scale;
    }
  } else if (shapeSettings.type === 'oval') {
    const a = shapeWidthPts / 2;  // horizontal semi-axis
    const b = shapeHeightPts / 2; // vertical semi-axis
    // Check if rectangle corners exceed ellipse boundary
    const halfW = imageWidth / 2;
    const halfH = imageHeight / 2;
    const ellipseCheck = (halfW / a) ** 2 + (halfH / b) ** 2;
    if (ellipseCheck > 1) {
      const scale = 1 / Math.sqrt(ellipseCheck);
      imageWidth *= scale;
      imageHeight *= scale;
    }
  }
  
  // Center the image in the page (which includes bleed)
  const imageX = (widthPts - imageWidth) / 2;
  const imageY = (heightPts - imageHeight) / 2;
  
  // Convert hex fill color to RGB values (0-1 range)
  const hexToRgb = (hex: string) => {
    if (hex === 'transparent') return null;
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 1, g: 1, b: 1 };
  };
  const effectiveFillColor = shapeSettings.fillColor === 'holographic' ? 'transparent' : shapeSettings.fillColor;
  const fillRgb = hexToRgb(effectiveFillColor);
  const isTransparentFill = effectiveFillColor === 'transparent';
  
  const cornerRadiusPts = (shapeSettings.cornerRadius || 0.25) * 72;
  
  // Get bleed color RGB
  const bleedRgb = shapeSettings.bleedColor ? hexToRgb(shapeSettings.bleedColor) : { r: 1, g: 1, b: 1 };
  
  if (shapeSettings.bleedEnabled && bleedPts > 0) {
    // Solid color bleed mode - use canvas approach for reliable rendering
    const canvasScale = 2;
    const canvasWidthPx = Math.round(widthPts * canvasScale);
    const canvasHeightPx = Math.round(heightPts * canvasScale);
    
    const bleedPx = bleedPts * canvasScale;
    const shapeWidthPx = shapeWidthPts * canvasScale;
    const shapeHeightPx = shapeHeightPts * canvasScale;
    const shapeX = (canvasWidthPx - shapeWidthPx) / 2;
    const shapeY = (canvasHeightPx - shapeHeightPx) / 2;
    const imgWidthPx = imageWidth * canvasScale;
    const imgHeightPx = imageHeight * canvasScale;
    const imgX = shapeX + (shapeWidthPx - imgWidthPx) / 2;
    const imgY = shapeY + (shapeHeightPx - imgHeightPx) / 2;
    const cornerRadiusPx = cornerRadiusPts * canvasScale;
    
    // Create canvas for the full page with bleed
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = canvasWidthPx;
    fullCanvas.height = canvasHeightPx;
    const ctx = fullCanvas.getContext('2d')!;
    
    // Draw bleed color first (expanded shape)
    ctx.fillStyle = shapeSettings.bleedColor || '#FFFFFF';
    ctx.beginPath();
    if (shapeSettings.type === 'circle') {
      const radius = Math.min(shapeWidthPx, shapeHeightPx) / 2 + bleedPx;
      ctx.arc(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, radius, 0, Math.PI * 2);
    } else if (shapeSettings.type === 'oval') {
      ctx.ellipse(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, shapeWidthPx / 2 + bleedPx, shapeHeightPx / 2 + bleedPx, 0, 0, Math.PI * 2);
    } else if (shapeSettings.type === 'square') {
      const size = Math.min(shapeWidthPx, shapeHeightPx);
      const sx = shapeX + (shapeWidthPx - size) / 2 - bleedPx;
      const sy = shapeY + (shapeHeightPx - size) / 2 - bleedPx;
      ctx.rect(sx, sy, size + bleedPx * 2, size + bleedPx * 2);
    } else if (shapeSettings.type === 'rounded-square') {
      const size = Math.min(shapeWidthPx, shapeHeightPx);
      const sx = shapeX + (shapeWidthPx - size) / 2 - bleedPx;
      const sy = shapeY + (shapeHeightPx - size) / 2 - bleedPx;
      ctx.roundRect(sx, sy, size + bleedPx * 2, size + bleedPx * 2, cornerRadiusPx);
    } else if (shapeSettings.type === 'rounded-rectangle') {
      ctx.roundRect(shapeX - bleedPx, shapeY - bleedPx, shapeWidthPx + bleedPx * 2, shapeHeightPx + bleedPx * 2, cornerRadiusPx);
    } else {
      ctx.rect(shapeX - bleedPx, shapeY - bleedPx, shapeWidthPx + bleedPx * 2, shapeHeightPx + bleedPx * 2);
    }
    ctx.fill();
    
    // Draw fill color on top (within cut line) - skip if transparent or holographic
    if (effectiveFillColor !== 'transparent') {
      ctx.fillStyle = effectiveFillColor;
      ctx.beginPath();
      if (shapeSettings.type === 'circle') {
        const radius = Math.min(shapeWidthPx, shapeHeightPx) / 2;
        ctx.arc(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, radius, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'oval') {
        ctx.ellipse(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, shapeWidthPx / 2, shapeHeightPx / 2, 0, 0, Math.PI * 2);
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(shapeWidthPx, shapeHeightPx);
        const sx = shapeX + (shapeWidthPx - size) / 2;
        const sy = shapeY + (shapeHeightPx - size) / 2;
        ctx.rect(sx, sy, size, size);
      } else if (shapeSettings.type === 'rounded-square') {
        const size = Math.min(shapeWidthPx, shapeHeightPx);
        const sx = shapeX + (shapeWidthPx - size) / 2;
        const sy = shapeY + (shapeHeightPx - size) / 2;
        ctx.roundRect(sx, sy, size, size, cornerRadiusPx);
      } else if (shapeSettings.type === 'rounded-rectangle') {
        ctx.roundRect(shapeX, shapeY, shapeWidthPx, shapeHeightPx, cornerRadiusPx);
      } else {
        ctx.rect(shapeX, shapeY, shapeWidthPx, shapeHeightPx);
      }
      ctx.fill();
    }
    
    // Draw image clipped to cut line shape
    ctx.save();
    ctx.beginPath();
    if (shapeSettings.type === 'circle') {
      const radius = Math.min(shapeWidthPx, shapeHeightPx) / 2;
      ctx.arc(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, radius, 0, Math.PI * 2);
    } else if (shapeSettings.type === 'oval') {
      ctx.ellipse(shapeX + shapeWidthPx / 2, shapeY + shapeHeightPx / 2, shapeWidthPx / 2, shapeHeightPx / 2, 0, 0, Math.PI * 2);
    } else if (shapeSettings.type === 'square') {
      const size = Math.min(shapeWidthPx, shapeHeightPx);
      const sx = shapeX + (shapeWidthPx - size) / 2;
      const sy = shapeY + (shapeHeightPx - size) / 2;
      ctx.rect(sx, sy, size, size);
    } else if (shapeSettings.type === 'rounded-square') {
      const size = Math.min(shapeWidthPx, shapeHeightPx);
      const sx = shapeX + (shapeWidthPx - size) / 2;
      const sy = shapeY + (shapeHeightPx - size) / 2;
      ctx.roundRect(sx, sy, size, size, cornerRadiusPx);
    } else if (shapeSettings.type === 'rounded-rectangle') {
      ctx.roundRect(shapeX, shapeY, shapeWidthPx, shapeHeightPx, cornerRadiusPx);
    } else {
      ctx.rect(shapeX, shapeY, shapeWidthPx, shapeHeightPx);
    }
    ctx.clip();
    ctx.drawImage(imageCanvas, imgX, imgY, imgWidthPx, imgHeightPx);
    ctx.restore();
    
    // Embed canvas as PNG in PDF
    const fullBlob = await new Promise<Blob>((resolve) => {
      fullCanvas.toBlob((b) => resolve(b!), 'image/png');
    });
    const fullPngBytes = new Uint8Array(await fullBlob.arrayBuffer());
    const fullImage = await pdfDoc.embedPng(fullPngBytes);
    
    page.drawImage(fullImage, {
      x: 0,
      y: 0,
      width: widthPts,
      height: heightPts,
    });
  } else {
    // Solid fill background mode - skip if transparent
    if (!isTransparentFill && fillRgb) {
      let bgPathOps = 'q\n';
      bgPathOps += `${fillRgb.r} ${fillRgb.g} ${fillRgb.b} rg\n`;
      
      if (shapeSettings.type === 'circle') {
        const r = Math.min(widthPts, heightPts) / 2;
        const k = 0.5522847498;
        const rk = r * k;
        bgPathOps += `${cx + r} ${cy} m\n`;
        bgPathOps += `${cx + r} ${cy + rk} ${cx + rk} ${cy + r} ${cx} ${cy + r} c\n`;
        bgPathOps += `${cx - rk} ${cy + r} ${cx - r} ${cy + rk} ${cx - r} ${cy} c\n`;
        bgPathOps += `${cx - r} ${cy - rk} ${cx - rk} ${cy - r} ${cx} ${cy - r} c\n`;
        bgPathOps += `${cx + rk} ${cy - r} ${cx + r} ${cy - rk} ${cx + r} ${cy} c\n`;
      } else if (shapeSettings.type === 'oval') {
        const rx = widthPts / 2;
        const ry = heightPts / 2;
        const k = 0.5522847498;
        const rxk = rx * k;
        const ryk = ry * k;
        bgPathOps += `${cx + rx} ${cy} m\n`;
        bgPathOps += `${cx + rx} ${cy + ryk} ${cx + rxk} ${cy + ry} ${cx} ${cy + ry} c\n`;
        bgPathOps += `${cx - rxk} ${cy + ry} ${cx - rx} ${cy + ryk} ${cx - rx} ${cy} c\n`;
        bgPathOps += `${cx - rx} ${cy - ryk} ${cx - rxk} ${cy - ry} ${cx} ${cy - ry} c\n`;
        bgPathOps += `${cx + rxk} ${cy - ry} ${cx + rx} ${cy - ryk} ${cx + rx} ${cy} c\n`;
      } else if (shapeSettings.type === 'square') {
        const size = Math.min(widthPts, heightPts);
        const sx = (widthPts - size) / 2;
        const sy = (heightPts - size) / 2;
        bgPathOps += `${sx} ${sy} m\n`;
        bgPathOps += `${sx + size} ${sy} l\n`;
        bgPathOps += `${sx + size} ${sy + size} l\n`;
        bgPathOps += `${sx} ${sy + size} l\n`;
      } else if (shapeSettings.type === 'rounded-square') {
        const size = Math.min(widthPts, heightPts);
        const sx = (widthPts - size) / 2;
        const sy = (heightPts - size) / 2;
        bgPathOps += getRoundedRectPath(sx, sy, size, size, cornerRadiusPts);
      } else if (shapeSettings.type === 'rounded-rectangle') {
        bgPathOps += getRoundedRectPath(0, 0, widthPts, heightPts, cornerRadiusPts);
      } else {
        bgPathOps += `0 0 m\n`;
        bgPathOps += `${widthPts} 0 l\n`;
        bgPathOps += `${widthPts} ${heightPts} l\n`;
        bgPathOps += `0 ${heightPts} l\n`;
      }
      bgPathOps += 'h f\n';
      bgPathOps += 'Q\n';
      
      const bgStream = context.stream(bgPathOps);
      const bgStreamRef = context.register(bgStream);
      page.node.set(PDFName.of('Contents'), bgStreamRef);
    }
    
    // Draw the original image on top
    const blob = await new Promise<Blob>((resolve) => {
      imageCanvas.toBlob((b) => resolve(b!), 'image/png');
    });
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pngImage = await pdfDoc.embedPng(pngBytes);
    
    page.drawImage(pngImage, {
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight,
    });
  }
  
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
  
  // Cut line path (at exact cut position, without bleed)
  let pathOps = 'q\n';
  pathOps += '/CutContour CS 1 SCN\n';
  pathOps += '0.5 w\n';
  
  const outlineCx = cx;
  const outlineCy = cy;
  
  const cutCornerRadiusPts = (shapeSettings.cornerRadius || 0.25) * 72;
  
  if (shapeSettings.type === 'circle') {
    const r = Math.min(shapeWidthPts, shapeHeightPts) / 2; // Without bleed
    const k = 0.5522847498;
    const rk = r * k;
    const circleCy = outlineCy;
    pathOps += `${outlineCx + r} ${circleCy} m\n`;
    pathOps += `${outlineCx + r} ${circleCy + rk} ${outlineCx + rk} ${circleCy + r} ${outlineCx} ${circleCy + r} c\n`;
    pathOps += `${outlineCx - rk} ${circleCy + r} ${outlineCx - r} ${circleCy + rk} ${outlineCx - r} ${circleCy} c\n`;
    pathOps += `${outlineCx - r} ${circleCy - rk} ${outlineCx - rk} ${circleCy - r} ${outlineCx} ${circleCy - r} c\n`;
    pathOps += `${outlineCx + rk} ${circleCy - r} ${outlineCx + r} ${circleCy - rk} ${outlineCx + r} ${circleCy} c\n`;
  } else if (shapeSettings.type === 'oval') {
    const rx = shapeWidthPts / 2; // Without bleed
    const ry = shapeHeightPts / 2;
    const k = 0.5522847498;
    const rxk = rx * k;
    const ryk = ry * k;
    pathOps += `${outlineCx + rx} ${outlineCy} m\n`;
    pathOps += `${outlineCx + rx} ${outlineCy + ryk} ${outlineCx + rxk} ${outlineCy + ry} ${outlineCx} ${outlineCy + ry} c\n`;
    pathOps += `${outlineCx - rxk} ${outlineCy + ry} ${outlineCx - rx} ${outlineCy + ryk} ${outlineCx - rx} ${outlineCy} c\n`;
    pathOps += `${outlineCx - rx} ${outlineCy - ryk} ${outlineCx - rxk} ${outlineCy - ry} ${outlineCx} ${outlineCy - ry} c\n`;
    pathOps += `${outlineCx + rxk} ${outlineCy - ry} ${outlineCx + rx} ${outlineCy - ryk} ${outlineCx + rx} ${outlineCy} c\n`;
  } else if (shapeSettings.type === 'square') {
    const size = Math.min(shapeWidthPts, shapeHeightPts); // Without bleed
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += `${sx} ${sy} m\n`;
    pathOps += `${sx + size} ${sy} l\n`;
    pathOps += `${sx + size} ${sy + size} l\n`;
    pathOps += `${sx} ${sy + size} l\n`;
  } else if (shapeSettings.type === 'rounded-square') {
    const size = Math.min(shapeWidthPts, shapeHeightPts);
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += getRoundedRectPath(sx, sy, size, size, cutCornerRadiusPts);
  } else if (shapeSettings.type === 'rounded-rectangle') {
    pathOps += getRoundedRectPath(bleedPts, bleedPts, shapeWidthPts, shapeHeightPts, cutCornerRadiusPts);
  } else {
    // Rectangle without bleed
    pathOps += `${bleedPts} ${bleedPts} m\n`;
    pathOps += `${bleedPts + shapeWidthPts} ${bleedPts} l\n`;
    pathOps += `${bleedPts + shapeWidthPts} ${bleedPts + shapeHeightPts} l\n`;
    pathOps += `${bleedPts} ${bleedPts + shapeHeightPts} l\n`;
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
  
  // Add spot color layers (RDG_WHITE and RDG_GLOSS) if any colors are marked
  if (spotColors && spotColors.length > 0) {
    const hasWhite = spotColors.some(c => c.spotWhite);
    const hasGloss = spotColors.some(c => c.spotGloss);
    
    if (hasWhite || hasGloss) {
      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCanvas.width = image.width;
        maskCanvas.height = image.height;
        maskCtx.drawImage(image, 0, 0);
        const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const pixelData = imgData.data;
        
        const createSpotColorLayerForShape = async (
          colorName: string,
          markedColors: SpotColorInput[],
          tintCMYK: [number, number, number, number],
          targetPage: typeof page
        ): Promise<void> => {
          const w = maskCanvas.width;
          const h = maskCanvas.height;
          
          const binaryMask: boolean[][] = [];
          const colorTolerance = 60;
          const alphaThreshold = 240;
          
          const markedHexSet = new Set(markedColors.map(mc => mc.hex));
          
          const allSpotColorsIndexed = spotColors.map((c, idx) => ({ 
            rgb: c.rgb, 
            hex: c.hex,
            index: idx
          }));
          
          for (let y = 0; y < h; y++) {
            binaryMask[y] = [];
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const r = pixelData[i];
              const g = pixelData[i + 1];
              const b = pixelData[i + 2];
              const a = pixelData[i + 3];
              
              if (a < alphaThreshold) {
                binaryMask[y][x] = false;
                continue;
              }
              
              let closestHex = '';
              let closestDistance = Infinity;
              
              for (const sc of allSpotColorsIndexed) {
                const dr = r - sc.rgb.r;
                const dg = g - sc.rgb.g;
                const db = b - sc.rgb.b;
                const distance = Math.sqrt(dr*dr + dg*dg + db*db);
                
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closestHex = sc.hex;
                }
              }
              
              const matches = closestDistance < colorTolerance && markedHexSet.has(closestHex);
              binaryMask[y][x] = matches;
            }
          }
          
          let hasMatch = false;
          outer: for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (binaryMask[y][x]) {
                hasMatch = true;
                break outer;
              }
            }
          }
          
          if (!hasMatch) {
            console.log(`[Shape PDF] No matching pixels found for ${colorName}`);
            return;
          }
          
          const tintFunction = context.obj({
            FunctionType: 2,
            Domain: [0, 1],
            C0: [0, 0, 0, 0],
            C1: tintCMYK,
            N: 1,
          });
          const tintRef = context.register(tintFunction);
          
          const separation = context.obj([
            PDFName.of('Separation'),
            PDFName.of(colorName),
            PDFName.of('DeviceCMYK'),
            tintRef,
          ]);
          const sepRef = context.register(separation);
          
          let pageResources = targetPage.node.Resources();
          if (!pageResources) {
            pageResources = context.obj({});
            targetPage.node.set(PDFName.of('Resources'), pageResources);
          }
          
          let colorSpaceDict = pageResources.get(PDFName.of('ColorSpace'));
          if (!colorSpaceDict) {
            colorSpaceDict = context.obj({});
            (pageResources as PDFDict).set(PDFName.of('ColorSpace'), colorSpaceDict);
          }
          (colorSpaceDict as PDFDict).set(PDFName.of(colorName), sepRef);
          
          const scaleX = (resizeSettings.widthInches * 72) / w;
          const scaleY = (resizeSettings.heightInches * 72) / h;
          const spotOffsetX = imageX;
          const spotOffsetY = imageY;
          
          const toY = (py: number) => spotOffsetY + (h - py) * scaleY;
          const toX = (px: number) => spotOffsetX + px * scaleX;
          
          const spans: Array<{y: number; x1: number; x2: number}> = [];
          
          for (let y = 0; y < h; y++) {
            let inSpan = false;
            let spanStart = 0;
            
            for (let x = 0; x <= w; x++) {
              const filled = x < w && binaryMask[y][x];
              
              if (filled && !inSpan) {
                inSpan = true;
                spanStart = x;
              } else if (!filled && inSpan) {
                inSpan = false;
                spans.push({ y, x1: spanStart, x2: x });
              }
            }
          }
          
          if (spans.length === 0) {
            console.log(`[Shape PDF] No matching pixels for ${colorName}`);
            return;
          }
          
          const spansByY = new Map<number, Array<{x1: number; x2: number}>>();
          for (const span of spans) {
            if (!spansByY.has(span.y)) spansByY.set(span.y, []);
            spansByY.get(span.y)!.push({x1: span.x1, x2: span.x2});
          }
          
          const regions: Array<{x1: number; x2: number; y1: number; y2: number}> = [];
          const processedSpans = new Set<string>();
          
          for (const span of spans) {
            const key = `${span.y},${span.x1},${span.x2}`;
            if (processedSpans.has(key)) continue;
            processedSpans.add(key);
            
            let y1 = span.y;
            let y2 = span.y;
            
            for (let y = span.y - 1; y >= 0; y--) {
              const rowSpans = spansByY.get(y) || [];
              if (rowSpans.some(s => s.x1 === span.x1 && s.x2 === span.x2)) {
                y1 = y;
                processedSpans.add(`${y},${span.x1},${span.x2}`);
              } else break;
            }
            
            for (let y = span.y + 1; y < h; y++) {
              const rowSpans = spansByY.get(y) || [];
              if (rowSpans.some(s => s.x1 === span.x1 && s.x2 === span.x2)) {
                y2 = y;
                processedSpans.add(`${y},${span.x1},${span.x2}`);
              } else break;
            }
            
            regions.push({ x1: span.x1, x2: span.x2, y1, y2 });
          }
          
          let spotOps = `q /${colorName} cs 1 scn\n`;
          
          for (const r of regions) {
            const x1 = toX(r.x1);
            const y1 = toY(r.y2 + 1);
            const x2 = toX(r.x2);
            const y2 = toY(r.y1);
            const rw = x2 - x1;
            const rh = y2 - y1;
            spotOps += `${x1.toFixed(2)} ${y1.toFixed(2)} ${rw.toFixed(2)} ${rh.toFixed(2)} re\n`;
          }
          
          console.log(`[Shape PDF] ${colorName}: ${regions.length} rectangles`);
          
          spotOps += 'f\nQ\n';
          
          const spotStream = context.stream(spotOps);
          const spotStreamRef = context.register(spotStream);
          
          const pageContents = targetPage.node.Contents();
          if (pageContents) {
            if (pageContents instanceof PDFArray) {
              pageContents.push(spotStreamRef);
            } else {
              const newContents = context.obj([pageContents, spotStreamRef]);
              targetPage.node.set(PDFName.of('Contents'), newContents);
            }
          } else {
            targetPage.node.set(PDFName.of('Contents'), spotStreamRef);
          }
          
          console.log(`[Shape PDF] Added ${colorName} spot color layer with ${regions.length} solid regions`);
        };
        
        const whiteName = spotColors.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE';
        const glossName = spotColors.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS';
        
        if (singleArtboard) {
          if (hasWhite) {
            const whiteColors = spotColors.filter(c => c.spotWhite);
            await createSpotColorLayerForShape(whiteName, whiteColors, [0, 0, 0, 1], page);
          }
          
          if (hasGloss) {
            const glossColors = spotColors.filter(c => c.spotGloss);
            await createSpotColorLayerForShape(glossName, glossColors, [1, 0, 1, 0], page);
          }
        } else {
          if (hasWhite) {
            const whitePage = pdfDoc.addPage([widthPts, heightPts]);
            const whiteColors = spotColors.filter(c => c.spotWhite);
            await createSpotColorLayerForShape(whiteName, whiteColors, [0, 0, 0, 1], whitePage);
          }
          
          if (hasGloss) {
            const glossPage = pdfDoc.addPage([widthPts, heightPts]);
            const glossColors = spotColors.filter(c => c.spotGloss);
            await createSpotColorLayerForShape(glossName, glossColors, [1, 0, 1, 0], glossPage);
          }
        }
      }
    }
  }
  
  const whiteName = spotColors?.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE';
  const glossName = spotColors?.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS';
  
  pdfDoc.setTitle('Shape with CutContour and Spot Colors');
  pdfDoc.setSubject(singleArtboard 
    ? `Single artboard with Design + CutContour + ${whiteName} + ${glossName}`
    : `Contains CutContour and spot color layers for cutting machines`);
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector', 'shape']);
  
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

export async function generateShapePDFBase64(
  image: HTMLImageElement,
  shapeSettings: ShapeSettings,
  resizeSettings: ResizeSettings
): Promise<string | null> {
  // Calculate shape size based on design size + offset
  const { widthInches, heightInches } = calculateShapeDimensions(
    resizeSettings.widthInches,
    resizeSettings.heightInches,
    shapeSettings.type,
    shapeSettings.offset
  );
  
  const widthPts = widthInches * 72;
  const heightPts = heightInches * 72;
  
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
  
  let imageWidth = resizeSettings.widthInches * 72;
  let imageHeight = resizeSettings.heightInches * 72;
  
  // For circles and ovals, scale down the image so it fits entirely inside the shape
  if (shapeSettings.type === 'circle') {
    const radius = Math.min(widthPts, heightPts) / 2;
    const diameter = radius * 2;
    const diagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
    if (diagonal > diameter) {
      const scale = diameter / diagonal;
      imageWidth *= scale;
      imageHeight *= scale;
    }
  } else if (shapeSettings.type === 'oval') {
    const a = widthPts / 2;  // horizontal semi-axis
    const b = heightPts / 2; // vertical semi-axis
    const halfW = imageWidth / 2;
    const halfH = imageHeight / 2;
    const ellipseCheck = (halfW / a) ** 2 + (halfH / b) ** 2;
    if (ellipseCheck > 1) {
      const scale = 1 / Math.sqrt(ellipseCheck);
      imageWidth *= scale;
      imageHeight *= scale;
    }
  }
  
  // Center the image in the shape
  const imageX = (widthPts - imageWidth) / 2;
  const imageY = (heightPts - imageHeight) / 2;
  
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
  
  const cutCornerRadiusPts = (shapeSettings.cornerRadius || 0.25) * 72;
  
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
  } else if (shapeSettings.type === 'rounded-square') {
    const size = Math.min(widthPts, heightPts);
    const sx = (widthPts - size) / 2;
    const sy = (heightPts - size) / 2;
    pathOps += getRoundedRectPath(sx, sy, size, size, cutCornerRadiusPts);
  } else if (shapeSettings.type === 'rounded-rectangle') {
    pathOps += getRoundedRectPath(0, 0, widthPts, heightPts, cutCornerRadiusPts);
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
