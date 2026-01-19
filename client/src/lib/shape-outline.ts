import type { ShapeSettings, ResizeSettings } from "@/lib/types";
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { cropImageToContent } from './image-crop';

export function calculateShapeDimensions(
  designWidthInches: number,
  designHeightInches: number,
  shapeType: ShapeSettings['type'],
  offset: number
): { widthInches: number; heightInches: number } {
  const totalOffset = offset * 2; // offset on each side
  
  if (shapeType === 'circle') {
    // Circle uses the larger dimension to ensure design fits
    const diameter = Math.max(designWidthInches, designHeightInches) + totalOffset;
    return { widthInches: diameter, heightInches: diameter };
  } else if (shapeType === 'square') {
    // Square uses the larger dimension
    const size = Math.max(designWidthInches, designHeightInches) + totalOffset;
    return { widthInches: size, heightInches: size };
  } else if (shapeType === 'oval') {
    // Oval follows the design aspect ratio
    return {
      widthInches: designWidthInches + totalOffset,
      heightInches: designHeightInches + totalOffset
    };
  } else {
    // Rectangle follows the design aspect ratio
    return {
      widthInches: designWidthInches + totalOffset,
      heightInches: designHeightInches + totalOffset
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
  
  const imageWidth = resizeSettings.widthInches * 72;
  const imageHeight = resizeSettings.heightInches * 72;
  
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
  
  const imageWidth = resizeSettings.widthInches * 72;
  const imageHeight = resizeSettings.heightInches * 72;
  
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
