import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  
  const targetDPI = 300;
  const pdfScale = targetDPI / 72;
  const viewport = page.getViewport({ scale: pdfScale });
  
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  
  await page.render({
    canvasContext: ctx,
    viewport: viewport,
    canvas: canvas
  } as any).promise;
  
  const cutContourInfo = await extractCutContour(page, viewport, pdfScale);
  
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
    
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const arg = args[i];
      
      if (op === pdfjsLib.OPS.setFillColorN || op === pdfjsLib.OPS.setStrokeColorN) {
        const colorName = arg?.[arg.length - 1];
        if (typeof colorName === 'string' && 
            colorName.toLowerCase().includes('cutcontour')) {
          inCutContour = true;
          result.hasCutContour = true;
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
