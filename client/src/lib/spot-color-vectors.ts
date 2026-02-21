import { PDFDocument, PDFName, PDFArray, PDFDict, PDFPage } from 'pdf-lib';
import { type SpotColorInput } from './contour-outline';

interface Point {
  x: number;
  y: number;
}

interface SpotColorRegion {
  name: string;
  paths: Point[][];
  tintCMYK: [number, number, number, number];
}

function createClosestColorMask(
  imageData: ImageData,
  markedColors: SpotColorInput[],
  allSpotColors: SpotColorInput[],
  colorTolerance: number = 60,
  alphaThreshold: number = 240
): Uint8Array {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  const markedHexSet = new Set(markedColors.map(mc => mc.hex));
  const markedRGBs = markedColors.map(mc => mc.rgb);
  const allColorsIndexed = allSpotColors.map(c => ({
    rgb: c.rgb,
    hex: c.hex
  }));

  const directTolerance = 80;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (a < alphaThreshold) continue;

      let closestHex = '';
      let closestDistance = Infinity;

      for (const sc of allColorsIndexed) {
        const dr = r - sc.rgb.r;
        const dg = g - sc.rgb.g;
        const db = b - sc.rgb.b;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestHex = sc.hex;
        }
      }

      if (closestDistance < colorTolerance && markedHexSet.has(closestHex)) {
        let withinDirect = false;
        for (const mrgb of markedRGBs) {
          const dr = r - mrgb.r;
          const dg = g - mrgb.g;
          const db = b - mrgb.b;
          if (Math.sqrt(dr * dr + dg * dg + db * db) < directTolerance) {
            withinDirect = true;
            break;
          }
        }
        if (withinDirect) {
          mask[y * width + x] = 1;
        }
      }
    }
  }

  return mask;
}

function marchingSquaresTrace(mask: Uint8Array, width: number, height: number): Point[][] {
  function getMask(x: number, y: number): number {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return mask[y * width + x];
  }

  interface Edge {
    fromX: number; fromY: number;
    toX: number; toY: number;
    dx: number; dy: number;
  }

  const edges: Edge[] = [];

  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const above = getMask(x, y - 1);
      const below = getMask(x, y);
      if (above !== below) {
        if (above === 1) {
          edges.push({ fromX: x + 1, fromY: y, toX: x, toY: y, dx: -1, dy: 0 });
        } else {
          edges.push({ fromX: x, fromY: y, toX: x + 1, toY: y, dx: 1, dy: 0 });
        }
      }
    }
  }

  for (let x = 0; x <= width; x++) {
    for (let y = 0; y < height; y++) {
      const left = getMask(x - 1, y);
      const right = getMask(x, y);
      if (left !== right) {
        if (left === 1) {
          edges.push({ fromX: x, fromY: y, toX: x, toY: y + 1, dx: 0, dy: 1 });
        } else {
          edges.push({ fromX: x, fromY: y + 1, toX: x, toY: y, dx: 0, dy: -1 });
        }
      }
    }
  }

  if (edges.length === 0) return [];

  const fromMap = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const key = `${edges[i].fromX},${edges[i].fromY}`;
    if (!fromMap.has(key)) fromMap.set(key, []);
    fromMap.get(key)!.push(i);
  }

  const rightTurnPriority: Record<string, [number, number][]> = {
    '1,0': [[0, 1], [1, 0], [0, -1], [-1, 0]],
    '0,1': [[-1, 0], [0, 1], [1, 0], [0, -1]],
    '-1,0': [[0, -1], [-1, 0], [0, 1], [1, 0]],
    '0,-1': [[1, 0], [0, -1], [-1, 0], [0, 1]],
  };

  const used = new Uint8Array(edges.length);
  const contours: Point[][] = [];

  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used[startIdx]) continue;

    const contour: Point[] = [];
    let edgeIdx = startIdx;
    const maxSteps = edges.length;
    let steps = 0;

    while (!used[edgeIdx] && steps < maxSteps) {
      used[edgeIdx] = 1;
      const edge = edges[edgeIdx];
      contour.push({ x: edge.fromX, y: edge.fromY });

      const nextKey = `${edge.toX},${edge.toY}`;
      const candidates = fromMap.get(nextKey);
      if (!candidates) break;

      const priority = rightTurnPriority[`${edge.dx},${edge.dy}`];
      let nextIdx = -1;

      if (priority) {
        for (const [pdx, pdy] of priority) {
          for (const ci of candidates) {
            if (!used[ci] && edges[ci].dx === pdx && edges[ci].dy === pdy) {
              nextIdx = ci;
              break;
            }
          }
          if (nextIdx !== -1) break;
        }
      } else {
        for (const ci of candidates) {
          if (!used[ci]) { nextIdx = ci; break; }
        }
      }

      if (nextIdx === -1) break;
      edgeIdx = nextIdx;
      steps++;
    }

    if (contour.length > 2) {
      contours.push(contour);
    }
  }

  return contours;
}

function collapseCollinear(contour: Point[]): Point[] {
  if (contour.length < 3) return contour;

  const result: Point[] = [];

  for (let i = 0; i < contour.length; i++) {
    const prev = contour[(i - 1 + contour.length) % contour.length];
    const curr = contour[i];
    const next = contour[(i + 1) % contour.length];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const sameDirX = (dx1 > 0 && dx2 > 0) || (dx1 < 0 && dx2 < 0) || (dx1 === 0 && dx2 === 0);
    const sameDirY = (dy1 > 0 && dy2 > 0) || (dy1 < 0 && dy2 < 0) || (dy1 === 0 && dy2 === 0);

    if (!(sameDirX && sameDirY)) {
      result.push(curr);
    }
  }

  return result.length >= 3 ? result : contour;
}

function traceColorRegions(
  image: HTMLImageElement,
  spotColors: SpotColorInput[],
  widthInches: number,
  heightInches: number
): SpotColorRegion[] {
  const canvas = document.createElement('canvas');
  const dpi = 150;
  canvas.width = Math.round(widthInches * dpi);
  canvas.height = Math.round(heightInches * dpi);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const whiteColors = spotColors.filter(c => c.spotWhite);
  const glossColors = spotColors.filter(c => c.spotGloss);
  let whiteName = spotColors.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE';
  let glossName = spotColors.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS';

  const regions: SpotColorRegion[] = [];
  const pixelsPerInch = dpi;

  function traceMaskToInchPaths(mask: Uint8Array): Point[][] {
    const rawPaths = marchingSquaresTrace(mask, canvas.width, canvas.height);
    return rawPaths.map(rawPath => {
      const collapsed = collapseCollinear(rawPath);
      return collapsed.map(p => ({
        x: p.x / pixelsPerInch,
        y: p.y / pixelsPerInch
      }));
    }).filter(p => p.length >= 3);
  }

  if (whiteColors.length > 0) {
    console.log(`[SpotColor] Tracing ${whiteColors.length} colors for ${whiteName} (marching squares)`);
    const mask = createClosestColorMask(imageData, whiteColors, spotColors, 60, 240);
    const paths = traceMaskToInchPaths(mask);
    console.log(`[SpotColor] Found ${paths.length} contours for ${whiteName}`);
    if (paths.length > 0) {
      regions.push({ name: whiteName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  if (glossColors.length > 0) {
    console.log(`[SpotColor] Tracing ${glossColors.length} colors for ${glossName} (marching squares)`);
    const mask = createClosestColorMask(imageData, glossColors, spotColors, 60, 240);
    const paths = traceMaskToInchPaths(mask);
    console.log(`[SpotColor] Found ${paths.length} contours for ${glossName}`);
    if (paths.length > 0) {
      regions.push({ name: glossName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  const fluorTypes = [
    { field: 'spotFluorY' as const, nameField: 'spotFluorYName' as const, defaultName: 'Fluorescent_Y' },
    { field: 'spotFluorM' as const, nameField: 'spotFluorMName' as const, defaultName: 'Fluorescent_M' },
    { field: 'spotFluorG' as const, nameField: 'spotFluorGName' as const, defaultName: 'Fluorescent_G' },
    { field: 'spotFluorOrange' as const, nameField: 'spotFluorOrangeName' as const, defaultName: 'Fluorescent_Orange' },
  ];

  for (const ft of fluorTypes) {
    const matchingColors = spotColors.filter(c => c[ft.field]);
    if (matchingColors.length > 0) {
      const fluorName = matchingColors[0][ft.nameField] || ft.defaultName;
      console.log(`[SpotColor] Tracing ${matchingColors.length} colors for ${fluorName} (marching squares)`);
      const mask = createClosestColorMask(imageData, matchingColors, spotColors, 60, 240);
      const paths = traceMaskToInchPaths(mask);
      console.log(`[SpotColor] Found ${paths.length} contours for ${fluorName}`);
      if (paths.length > 0) {
        regions.push({ name: fluorName, paths, tintCMYK: [0, 1, 0, 0] });
      }
    }
  }

  return regions;
}

function spotColorPathsToPDFOps(
  pathsInches: Point[][],
  spotColorName: string
): string {
  if (pathsInches.length === 0) return '';

  const validPaths = pathsInches.filter(p => p.length >= 3);
  if (validPaths.length === 0) return '';

  let compoundPath = 'q\n';
  compoundPath += `/${spotColorName} cs 1 scn\n`;

  for (const path of validPaths) {
    const pts = path.map(p => ({ x: p.x * 72, y: p.y * 72 }));
    compoundPath += `${pts[0].x.toFixed(4)} ${pts[0].y.toFixed(4)} m\n`;
    for (let j = 1; j < pts.length; j++) {
      compoundPath += `${pts[j].x.toFixed(4)} ${pts[j].y.toFixed(4)} l\n`;
    }
    compoundPath += 'h\n';
  }

  compoundPath += 'f*\n';
  compoundPath += 'Q\n';

  return compoundPath;
}

function appendContentStream(
  page: PDFPage,
  context: PDFDocument['context'],
  ops: string
): void {
  if (!ops || ops.length === 0) return;

  const contentStream = context.stream(ops);
  const contentStreamRef = context.register(contentStream);

  const existingContents = page.node.Contents();
  if (existingContents) {
    if (existingContents instanceof PDFArray) {
      existingContents.push(contentStreamRef);
    } else {
      const newContents = context.obj([existingContents, contentStreamRef]);
      page.node.set(PDFName.of('Contents'), newContents);
    }
  } else {
    page.node.set(PDFName.of('Contents'), contentStreamRef);
  }
}

function addSpotColorRegionToPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  region: SpotColorRegion,
  offsetPaths: Point[][]
): void {
  const context = pdfDoc.context;

  const tintFunction = context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: region.tintCMYK,
    N: 1,
  });
  const tintFunctionRef = context.register(tintFunction);

  const separationColorSpace = context.obj([
    PDFName.of('Separation'),
    PDFName.of(region.name),
    PDFName.of('DeviceCMYK'),
    tintFunctionRef,
  ]);
  const separationRef = context.register(separationColorSpace);

  let pageResources = page.node.Resources();
  if (!pageResources) {
    pageResources = context.obj({});
    page.node.set(PDFName.of('Resources'), pageResources);
  }

  let colorSpaceDict = pageResources.get(PDFName.of('ColorSpace'));
  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({});
    (pageResources as PDFDict).set(PDFName.of('ColorSpace'), colorSpaceDict);
  }
  (colorSpaceDict as PDFDict).set(PDFName.of(region.name), separationRef);

  const pathOps = spotColorPathsToPDFOps(offsetPaths, region.name);
  console.log(`[SpotColor PDF] ${region.name}: ${region.paths.length} contours, ${pathOps.length} chars ops`);

  if (pathOps.length > 0) {
    appendContentStream(page, context, pathOps);
  }
}

export function addSpotColorVectorsToPDF(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: HTMLImageElement,
  spotColors: SpotColorInput[],
  widthInches: number,
  heightInches: number,
  pageHeightInches: number,
  imageOffsetXInches: number,
  imageOffsetYInches: number,
  singleArtboard: boolean = false,
  pageWidthPts?: number,
  pageHeightPts?: number
): string[] {
  if (!spotColors || spotColors.length === 0) return [];

  const hasWhite = spotColors.some(c => c.spotWhite);
  const hasGloss = spotColors.some(c => c.spotGloss);
  const hasFluor = spotColors.some(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange);
  if (!hasWhite && !hasGloss && !hasFluor) return [];

  const regions = traceColorRegions(image, spotColors, widthInches, heightInches);
  if (regions.length === 0) return [];

  const addedLabels: string[] = [];

  for (const region of regions) {
    const offsetPaths = region.paths.map(path =>
      path.map(p => ({
        x: p.x + imageOffsetXInches,
        y: pageHeightInches - (p.y + imageOffsetYInches)
      }))
    );

    if (singleArtboard) {
      addSpotColorRegionToPage(pdfDoc, page, region, offsetPaths);
      addedLabels.push(region.name);
    } else {
      const wPts = pageWidthPts || (widthInches + imageOffsetXInches * 2) * 72;
      const hPts = pageHeightPts || pageHeightInches * 72;
      const newPage = pdfDoc.addPage([wPts, hPts]);
      addSpotColorRegionToPage(pdfDoc, newPage, region, offsetPaths);
      addedLabels.push(region.name);
    }
  }

  return addedLabels;
}
