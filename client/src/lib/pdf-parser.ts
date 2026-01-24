import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PDFCutContourInfo {
  hasCutContour: boolean;
  cutContourPath: Path2D | null;
  cutContourPoints: { x: number; y: number }[][];
  pageWidth: number;
  pageHeight: number;
}

export interface ParsedPDFData {
  image: HTMLImageElement;
  width: number;
  height: number;
  cutContourInfo: PDFCutContourInfo;
  originalPdfData: ArrayBuffer;
  dpi: number;
}

export async function parsePDF(file: File): Promise<ParsedPDFData> {
  const arrayBuffer = await file.arrayBuffer();
  
  // First, use pdf-lib to check for CutContour spot color in resources
  const cutContourInfo = await extractCutContourFromRawPDF(arrayBuffer);
  console.log('[PDF Parser] CutContour result:', cutContourInfo.hasCutContour, 'paths:', cutContourInfo.cutContourPoints.length);
  
  // Then render with PDF.js for the image
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  
  const targetDPI = 300;
  const pdfScale = targetDPI / 72;
  const viewport = page.getViewport({ scale: pdfScale });
  
  // Update cutContourInfo with page dimensions
  cutContourInfo.pageWidth = viewport.width;
  cutContourInfo.pageHeight = viewport.height;
  
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  
  await page.render({
    canvasContext: ctx,
    viewport: viewport,
    canvas: canvas
  } as any).promise;
  
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/png');
  });
  
  return {
    image,
    width: viewport.width,
    height: viewport.height,
    cutContourInfo,
    originalPdfData: arrayBuffer,
    dpi: targetDPI
  };
}

// Extract CutContour from raw PDF using pdf-lib to read resources and content streams
async function extractCutContourFromRawPDF(arrayBuffer: ArrayBuffer): Promise<PDFCutContourInfo> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream } = await import('pdf-lib');
  
  const result: PDFCutContourInfo = {
    hasCutContour: false,
    cutContourPath: null,
    cutContourPoints: [],
    pageWidth: 0,
    pageHeight: 0
  };
  
  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return result;
    
    const page = pages[0];
    const { width, height } = page.getSize();
    result.pageWidth = width;
    result.pageHeight = height;
    
    // Check ColorSpace resources for Separation/CutContour
    const resources = page.node.Resources();
    const context = pdfDoc.context;
    
    if (resources) {
      const colorSpaces = resources.get(PDFName.of('ColorSpace'));
      if (colorSpaces instanceof PDFDict) {
        const entries = colorSpaces.entries();
        for (const [name, value] of entries) {
          const nameStr = name.toString();
          console.log('[PDF Parser] ColorSpace found:', nameStr);
          
          // Resolve indirect references
          let resolvedValue = value;
          if (value && 'toString' in value && value.toString().startsWith('/')) {
            // It's a name reference, try to look it up
          } else {
            // Try to dereference if it's a ref
            try {
              resolvedValue = context.lookup(value as any) || value;
            } catch (e) {
              // Keep original value
            }
          }
          
          // Check if this is a Separation color space with CutContour
          if (resolvedValue instanceof PDFArray) {
            const firstElement = resolvedValue.get(0);
            const firstStr = firstElement?.toString() || '';
            console.log('[PDF Parser] ColorSpace type:', firstStr);
            
            if (firstStr === '/Separation') {
              const spotName = resolvedValue.get(1);
              if (spotName) {
                const spotNameStr = spotName.toString();
                console.log('[PDF Parser] Separation spot color:', spotNameStr);
                if (spotNameStr.toLowerCase().includes('cutcontour')) {
                  result.hasCutContour = true;
                  console.log('[PDF Parser] CutContour spot color detected!');
                }
              }
            }
          } else {
            // Log the type for debugging
            console.log('[PDF Parser] ColorSpace value type:', resolvedValue?.constructor?.name);
          }
        }
      }
    }
    
    // Also search raw PDF bytes for CutContour text as fallback
    const pdfBytes = new Uint8Array(arrayBuffer);
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);
    if (pdfText.toLowerCase().includes('cutcontour')) {
      console.log('[PDF Parser] CutContour found in raw PDF bytes!');
      result.hasCutContour = true;
    }
    
    // If CutContour found, try to extract path from content stream
    if (result.hasCutContour) {
      const contents = page.node.Contents();
      if (contents) {
        // Get content stream as string to parse path commands
        let contentStr = '';
        if (contents instanceof PDFStream) {
          const decoded = contents.getContents();
          contentStr = new TextDecoder().decode(decoded);
        } else if (contents instanceof PDFArray) {
          for (let i = 0; i < contents.size(); i++) {
            const stream = contents.get(i);
            if (stream instanceof PDFStream) {
              const decoded = stream.getContents();
              contentStr += new TextDecoder().decode(decoded) + '\n';
            }
          }
        }
        
        console.log('[PDF Parser] Content stream length:', contentStr.length);
        
        // Look for CutContour color space usage and following path
        const cutContourPattern = /\/CutContour\s+(?:CS|cs)\s+[\d.]+\s+(?:SCN|scn|SC|sc)/gi;
        if (cutContourPattern.test(contentStr)) {
          console.log('[PDF Parser] CutContour usage found in content stream');
          
          // Extract path points after CutContour color is set
          // Parse the content stream for path operations
          const pathPoints = extractPathFromContentStream(contentStr, width, height);
          if (pathPoints.length > 0) {
            result.cutContourPoints = pathPoints;
            console.log('[PDF Parser] Extracted', pathPoints.length, 'paths');
          }
        }
      }
    }
    
  } catch (error) {
    console.warn('[PDF Parser] Error parsing PDF with pdf-lib:', error);
  }
  
  return result;
}

// Extract path points from PDF content stream
function extractPathFromContentStream(content: string, pageWidth: number, pageHeight: number): { x: number; y: number }[][] {
  const paths: { x: number; y: number }[][] = [];
  let currentPath: { x: number; y: number }[] = [];
  let inCutContour = false;
  
  // Split content into tokens
  const lines = content.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if we're entering CutContour mode
    if (/\/CutContour\s+(?:CS|cs)/i.test(trimmed)) {
      inCutContour = true;
      continue;
    }
    
    // Check if we're exiting CutContour mode (different color space)
    if (inCutContour && /\/\w+\s+(?:CS|cs)\s/i.test(trimmed) && !/CutContour/i.test(trimmed)) {
      if (currentPath.length > 0) {
        paths.push([...currentPath]);
        currentPath = [];
      }
      inCutContour = false;
      continue;
    }
    
    if (inCutContour) {
      // Parse path commands: m (moveto), l (lineto), c (curveto), h (closepath), S/s (stroke)
      const moveMatch = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+m$/);
      if (moveMatch) {
        if (currentPath.length > 0) {
          paths.push([...currentPath]);
          currentPath = [];
        }
        currentPath.push({ x: parseFloat(moveMatch[1]), y: parseFloat(moveMatch[2]) });
        continue;
      }
      
      const lineMatch = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+l$/);
      if (lineMatch) {
        currentPath.push({ x: parseFloat(lineMatch[1]), y: parseFloat(lineMatch[2]) });
        continue;
      }
      
      const curveMatch = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+c$/);
      if (curveMatch) {
        // For curves, just use the endpoint
        currentPath.push({ x: parseFloat(curveMatch[5]), y: parseFloat(curveMatch[6]) });
        continue;
      }
      
      if (trimmed === 'h' || trimmed === 'H') {
        // Close path
        if (currentPath.length > 0) {
          currentPath.push({ ...currentPath[0] });
        }
        continue;
      }
      
      if (trimmed === 'S' || trimmed === 's' || trimmed === 'f' || trimmed === 'F' || trimmed === 'B' || trimmed === 'b') {
        // Stroke or fill - end of path
        if (currentPath.length > 0) {
          paths.push([...currentPath]);
          currentPath = [];
        }
        continue;
      }
    }
  }
  
  if (currentPath.length > 0) {
    paths.push(currentPath);
  }
  
  return paths;
}

async function extractCutContour(
  page: pdfjsLib.PDFPageProxy, 
  viewport: pdfjsLib.PageViewport,
  scale: number
): Promise<PDFCutContourInfo> {
  const result: PDFCutContourInfo = {
    hasCutContour: false,
    cutContourPath: null,
    cutContourPoints: [],
    pageWidth: viewport.width,
    pageHeight: viewport.height
  };
  
  try {
    const operatorList = await page.getOperatorList();
    const ops = operatorList.fnArray;
    const args = operatorList.argsArray;
    
    let inCutContour = false;
    let currentPath: { x: number; y: number }[] = [];
    const path2D = new Path2D();
    
    // Debug: Log all operators and look for spot color patterns
    const colorOps: string[] = [];
    const allColorArgs: any[] = [];
    
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const arg = args[i];
      
      // Check for various color-related operators
      if (op === pdfjsLib.OPS.setFillColorN || 
          op === pdfjsLib.OPS.setStrokeColorN ||
          op === pdfjsLib.OPS.setFillColorSpace ||
          op === pdfjsLib.OPS.setStrokeColorSpace) {
        colorOps.push(`op${op}`);
        allColorArgs.push(arg);
        
        // Check for CutContour in any argument
        if (Array.isArray(arg)) {
          for (const a of arg) {
            if (typeof a === 'string' && a.toLowerCase().includes('cutcontour')) {
              result.hasCutContour = true;
              inCutContour = true;
              console.log('[PDF Parser] CutContour found in args:', a);
            }
          }
        }
      }
    }
    
    if (colorOps.length > 0) {
      console.log('[PDF Parser] Color operators found:', colorOps.length);
      console.log('[PDF Parser] Sample color args:', allColorArgs.slice(0, 5));
    } else {
      console.log('[PDF Parser] No color operators found in operator list');
    }
    
    // Also check the raw PDF stream for CutContour text
    console.log('[PDF Parser] Total operators:', ops.length);
    
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const arg = args[i];
      
      if (op === pdfjsLib.OPS.setFillColorN || op === pdfjsLib.OPS.setStrokeColorN) {
        const colorName = arg?.[arg.length - 1];
        if (typeof colorName === 'string' && 
            colorName.toLowerCase().includes('cutcontour')) {
          inCutContour = true;
          result.hasCutContour = true;
          console.log('[PDF Parser] CutContour detected:', colorName);
        }
      }
      
      if (op === pdfjsLib.OPS.setFillRGBColor || op === pdfjsLib.OPS.setStrokeRGBColor) {
        inCutContour = false;
      }
      
      if (inCutContour) {
        if (op === pdfjsLib.OPS.moveTo) {
          const x = arg[0] * scale;
          const y = viewport.height - (arg[1] * scale);
          path2D.moveTo(x, y);
          if (currentPath.length > 0) {
            result.cutContourPoints.push([...currentPath]);
            currentPath = [];
          }
          currentPath.push({ x, y });
        } else if (op === pdfjsLib.OPS.lineTo) {
          const x = arg[0] * scale;
          const y = viewport.height - (arg[1] * scale);
          path2D.lineTo(x, y);
          currentPath.push({ x, y });
        } else if (op === pdfjsLib.OPS.curveTo) {
          const x1 = arg[0] * scale;
          const y1 = viewport.height - (arg[1] * scale);
          const x2 = arg[2] * scale;
          const y2 = viewport.height - (arg[3] * scale);
          const x3 = arg[4] * scale;
          const y3 = viewport.height - (arg[5] * scale);
          path2D.bezierCurveTo(x1, y1, x2, y2, x3, y3);
          currentPath.push({ x: x3, y: y3 });
        } else if (op === pdfjsLib.OPS.closePath) {
          path2D.closePath();
          if (currentPath.length > 0) {
            currentPath.push(currentPath[0]);
            result.cutContourPoints.push([...currentPath]);
            currentPath = [];
          }
        }
      }
    }
    
    if (currentPath.length > 0) {
      result.cutContourPoints.push([...currentPath]);
    }
    
    if (result.hasCutContour && result.cutContourPoints.length > 0) {
      result.cutContourPath = path2D;
    }
    
  } catch (error) {
    console.warn('Could not extract CutContour from PDF:', error);
  }
  
  return result;
}

export function isPDFFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// Generate a PDF with the image and a proper vector CutContour spot color path
export async function generatePDFWithVectorCutContour(
  image: HTMLImageElement,
  cutContourPoints: { x: number; y: number }[][],
  pageWidth: number,
  pageHeight: number,
  dpi: number,
  filename: string
): Promise<void> {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = await import('pdf-lib');
  
  // Convert from pixels to points (72 points per inch)
  const widthPts = (pageWidth / dpi) * 72;
  const heightPts = (pageHeight / dpi) * 72;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPts, heightPts]);
  const context = pdfDoc.context;
  
  // Embed the image
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const imageDataUrl = canvas.toDataURL('image/png');
  const imageBytes = await fetch(imageDataUrl).then(res => res.arrayBuffer());
  const pngImage = await pdfDoc.embedPng(imageBytes);
  
  // Draw the image to fill the page
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: widthPts,
    height: heightPts,
  });
  
  // Create CutContour spot color using Separation color space
  if (cutContourPoints.length > 0 && cutContourPoints.some(path => path.length > 2)) {
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
    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as any).set(PDFName.of('CutContour'), separationRef);
    }
    
    // Build path operators
    let pathOps = '/CutContour CS 1 SCN\n0.5 w\n';
    
    for (const path of cutContourPoints) {
      if (path.length < 2) continue;
      
      // Scale from pixels to points and flip Y coordinate
      const scaleX = widthPts / pageWidth;
      const scaleY = heightPts / pageHeight;
      
      const startX = path[0].x * scaleX;
      const startY = heightPts - (path[0].y * scaleY);
      pathOps += `${startX.toFixed(4)} ${startY.toFixed(4)} m\n`;
      
      for (let i = 1; i < path.length; i++) {
        const x = path[i].x * scaleX;
        const y = heightPts - (path[i].y * scaleY);
        pathOps += `${x.toFixed(4)} ${y.toFixed(4)} l\n`;
      }
      
      pathOps += 'S\n';
    }
    
    // Append to page content stream
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
  
  pdfDoc.setTitle('PDF with CutContour');
  pdfDoc.setSubject('Contains CutContour spot color for cutting machines');
  pdfDoc.setKeywords(['CutContour', 'spot color', 'cutting', 'vector']);
  
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
