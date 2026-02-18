import type { ShapeSettings, ResizeSettings } from "@/lib/types";
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { cropImageToContent } from './image-crop';

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
    const diameter = Math.max(designWidthInches, designHeightInches) + totalOffset;
    return { widthInches: diameter, heightInches: diameter };
  } else if (shapeType === 'square' || shapeType === 'rounded-square') {
    const size = Math.max(designWidthInches, designHeightInches) + totalOffset;
    return { widthInches: size, heightInches: size };
  } else if (shapeType === 'oval') {
    let width = designWidthInches + totalOffset;
    let height = designHeightInches + totalOffset;
    
    const minAspectRatio = 1.2;
    const currentRatio = Math.max(width, height) / Math.min(width, height);
    
    if (currentRatio < minAspectRatio) {
      if (width >= height) {
        width = height * minAspectRatio;
      } else {
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
  filename: string
): Promise<void> {
  // Calculate shape size based on design size + offset
  const { widthInches, heightInches } = calculateShapeDimensions(
    resizeSettings.widthInches,
    resizeSettings.heightInches,
    shapeSettings.type,
    shapeSettings.offset
  );
  
  const bleedInches = 0.10; // 0.10" bleed around the shape
  const bleedPts = bleedInches * 72;
  
  // Page size includes bleed area
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
  
  const blob = await new Promise<Blob>((resolve) => {
    imageCanvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  
  const pngImage = await pdfDoc.embedPng(pngBytes);
  
  // Convert hex fill color to RGB values (0-1 range)
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 1, g: 1, b: 1 };
  };
  const fillRgb = hexToRgb(shapeSettings.fillColor);
  
  // Draw background shape with bleed (fills entire page)
  let bgPathOps = 'q\n';
  bgPathOps += `${fillRgb.r} ${fillRgb.g} ${fillRgb.b} rg\n`; // Set fill color
  
  const cornerRadiusPts = (shapeSettings.cornerRadius || 0.25) * 72; // Default 0.25 inch corner radius
  
  if (shapeSettings.type === 'circle') {
    const r = Math.min(widthPts, heightPts) / 2; // Include bleed
    const k = 0.5522847498;
    const rk = r * k;
    bgPathOps += `${cx + r} ${cy} m\n`;
    bgPathOps += `${cx + r} ${cy + rk} ${cx + rk} ${cy + r} ${cx} ${cy + r} c\n`;
    bgPathOps += `${cx - rk} ${cy + r} ${cx - r} ${cy + rk} ${cx - r} ${cy} c\n`;
    bgPathOps += `${cx - r} ${cy - rk} ${cx - rk} ${cy - r} ${cx} ${cy - r} c\n`;
    bgPathOps += `${cx + rk} ${cy - r} ${cx + r} ${cy - rk} ${cx + r} ${cy} c\n`;
  } else if (shapeSettings.type === 'oval') {
    const rx = widthPts / 2; // Include bleed
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
    const size = Math.min(widthPts, heightPts); // Include bleed
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
  bgPathOps += 'h f\n'; // Close and fill
  bgPathOps += 'Q\n';
  
  const bgStream = context.stream(bgPathOps);
  const bgStreamRef = context.register(bgStream);
  
  // Insert background as first content stream
  page.node.set(PDFName.of('Contents'), bgStreamRef);
  
  let imageWidth = resizeSettings.widthInches * 72;
  let imageHeight = resizeSettings.heightInches * 72;
  
  // Center the image in the page (which includes bleed)
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
  
  pdfDoc.setTitle('Shape with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
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
