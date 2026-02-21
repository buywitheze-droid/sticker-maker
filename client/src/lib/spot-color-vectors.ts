import { PDFDocument, PDFName, PDFArray, PDFDict, PDFPage } from 'pdf-lib';
import { simplifyPathForPDF } from './contour-outline';

interface Point {
  x: number;
  y: number;
}

interface SpotColorInfo {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite: boolean;
  spotGloss: boolean;
  spotWhiteName?: string;
  spotGlossName?: string;
}

interface SpotColorRegion {
  name: string;
  paths: Point[][];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function colorMatch(
  pixelR: number, pixelG: number, pixelB: number,
  targetR: number, targetG: number, targetB: number,
  tolerance: number
): boolean {
  const dist = Math.sqrt(
    (pixelR - targetR) ** 2 +
    (pixelG - targetG) ** 2 +
    (pixelB - targetB) ** 2
  );
  return dist <= tolerance;
}

function createColorMask(
  imageData: ImageData,
  targetColors: Array<{ r: number; g: number; b: number }>,
  tolerance: number = 50
): Uint8Array {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (a < 128) continue;

      for (const target of targetColors) {
        if (colorMatch(r, g, b, target.r, target.g, target.b, tolerance)) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }

  return mask;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number = 1): Uint8Array {
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny * width + nx] === 1) {
              found = true;
            }
          }
        }
      }
      result[y * width + x] = found ? 1 : 0;
    }
  }
  return result;
}

function findEdgePixels(mask: Uint8Array, width: number, height: number): Uint8Array {
  const edges = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      const hasTransparentNeighbor =
        (x === 0 || mask[y * width + (x - 1)] === 0) ||
        (x === width - 1 || mask[y * width + (x + 1)] === 0) ||
        (y === 0 || mask[(y - 1) * width + x] === 0) ||
        (y === height - 1 || mask[(y + 1) * width + x] === 0);
      if (hasTransparentNeighbor) {
        edges[y * width + x] = 1;
      }
    }
  }
  return edges;
}

function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
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

function traceAllRegions(mask: Uint8Array, width: number, height: number): Point[][] {
  const visited = new Uint8Array(width * height);
  const regions: Point[][] = [];
  const edgeMask = findEdgePixels(mask, width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edgeMask[y * width + x] === 1 && visited[y * width + x] === 0) {
        const tempMask = new Uint8Array(width * height);
        const queue: Point[] = [{ x, y }];
        const regionEdges: Point[] = [];

        while (queue.length > 0) {
          const p = queue.pop()!;
          const idx = p.y * width + p.x;
          if (visited[idx] === 1 || edgeMask[idx] !== 1) continue;
          visited[idx] = 1;
          tempMask[idx] = 1;
          regionEdges.push(p);

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = p.x + dx;
              const ny = p.y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (visited[ny * width + nx] === 0 && edgeMask[ny * width + nx] === 1) {
                  queue.push({ x: nx, y: ny });
                }
              }
            }
          }
        }

        if (regionEdges.length > 10) {
          const path = traceBoundary(tempMask, width, height);
          if (path.length > 10) {
            regions.push(path);
          }
        }
      }
    }
  }

  return regions;
}

function smoothPath(points: Point[], windowSize: number): Point[] {
  if (points.length < windowSize * 2 + 1) return points;

  const result: Point[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    let sumX = 0, sumY = 0;
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = (i + j + n) % n;
      sumX += points[idx].x;
      sumY += points[idx].y;
    }
    result.push({
      x: sumX / (windowSize * 2 + 1),
      y: sumY / (windowSize * 2 + 1)
    });
  }

  return result;
}

export function traceColorRegions(
  image: HTMLImageElement,
  spotColors: SpotColorInfo[],
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

  const whiteColors: Array<{ r: number; g: number; b: number }> = [];
  const glossColors: Array<{ r: number; g: number; b: number }> = [];
  let whiteName = 'RDG_WHITE';
  let glossName = 'RDG_GLOSS';

  for (const sc of spotColors) {
    const rgb = typeof sc.rgb === 'object' ? sc.rgb : hexToRgb(sc.hex);
    if (sc.spotWhite) {
      whiteColors.push(rgb);
      if (sc.spotWhiteName) whiteName = sc.spotWhiteName;
    }
    if (sc.spotGloss) {
      glossColors.push(rgb);
      if (sc.spotGlossName) glossName = sc.spotGlossName;
    }
  }

  const regions: SpotColorRegion[] = [];
  const pixelsPerInch = dpi;

  if (whiteColors.length > 0) {
    console.log(`[SpotColor] Tracing ${whiteColors.length} colors for ${whiteName}`);
    const mask = createColorMask(imageData, whiteColors, 50);
    const dilated = dilateMask(mask, canvas.width, canvas.height, 1);
    const rawPaths = traceAllRegions(dilated, canvas.width, canvas.height);
    console.log(`[SpotColor] Found ${rawPaths.length} regions for ${whiteName}`);

    const paths = rawPaths.map(rawPath => {
      const smoothed = smoothPath(rawPath, 3);
      return smoothed.map(p => ({
        x: p.x / pixelsPerInch,
        y: p.y / pixelsPerInch
      }));
    });

    if (paths.length > 0) {
      regions.push({ name: whiteName, paths });
    }
  }

  if (glossColors.length > 0) {
    console.log(`[SpotColor] Tracing ${glossColors.length} colors for ${glossName}`);
    const mask = createColorMask(imageData, glossColors, 50);
    const dilated = dilateMask(mask, canvas.width, canvas.height, 1);
    const rawPaths = traceAllRegions(dilated, canvas.width, canvas.height);
    console.log(`[SpotColor] Found ${rawPaths.length} regions for ${glossName}`);

    const paths = rawPaths.map(rawPath => {
      const smoothed = smoothPath(rawPath, 3);
      return smoothed.map(p => ({
        x: p.x / pixelsPerInch,
        y: p.y / pixelsPerInch
      }));
    });

    if (paths.length > 0) {
      regions.push({ name: glossName, paths });
    }
  }

  return regions;
}

function spotColorPathsToPDFOps(
  pathsInches: Point[][],
  spotColorName: string,
  fill: boolean = true
): string {
  let allOps = '';

  for (const pathPoints of pathsInches) {
    const simplified = simplifyPathForPDF(pathPoints, 0.005);
    if (simplified.length < 3) continue;

    let pathOps = 'q\n';
    pathOps += `/${spotColorName} cs 1 scn\n`;

    const pts = simplified.map(p => ({ x: p.x * 72, y: p.y * 72 }));
    pathOps += `${pts[0].x.toFixed(4)} ${pts[0].y.toFixed(4)} m\n`;
    for (let i = 1; i < pts.length; i++) {
      pathOps += `${pts[i].x.toFixed(4)} ${pts[i].y.toFixed(4)} l\n`;
    }
    pathOps += 'h\n';
    pathOps += fill ? 'f\n' : 'S\n';
    pathOps += 'Q\n';
    allOps += pathOps;
  }

  return allOps;
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
  }
}

export function addSpotColorVectorsToPDF(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: HTMLImageElement,
  spotColors: SpotColorInfo[],
  widthInches: number,
  heightInches: number,
  pageHeightInches: number,
  imageOffsetXInches: number,
  imageOffsetYInches: number
): string[] {
  if (!spotColors || spotColors.length === 0) return [];

  const regions = traceColorRegions(image, spotColors, widthInches, heightInches);
  if (regions.length === 0) return [];

  const context = pdfDoc.context;
  const addedLabels: string[] = [];

  for (const region of regions) {
    const offsetPaths = region.paths.map(path =>
      path.map(p => ({
        x: p.x + imageOffsetXInches,
        y: pageHeightInches - (p.y + imageOffsetYInches)
      }))
    );

    const cmykTint = region.name.toUpperCase().includes('WHITE')
      ? [0, 0, 0, 0]
      : [0, 0, 0, 0];

    const tintFunction = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: cmykTint,
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

    const resources = page.node.Resources();
    if (resources) {
      let colorSpaceDict = resources.get(PDFName.of('ColorSpace'));
      if (!colorSpaceDict) {
        colorSpaceDict = context.obj({});
        resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
      }
      (colorSpaceDict as PDFDict).set(PDFName.of(region.name), separationRef);
    }

    const pathOps = spotColorPathsToPDFOps(offsetPaths, region.name, true);
    console.log(`[SpotColor PDF] ${region.name}: ${region.paths.length} paths, ${pathOps.length} chars ops`);

    if (pathOps.length > 0) {
      appendContentStream(page, context, pathOps);
      addedLabels.push(region.name);
    }
  }

  return addedLabels;
}
