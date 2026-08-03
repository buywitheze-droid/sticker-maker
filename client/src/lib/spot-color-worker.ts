interface Point {
  x: number;
  y: number;
}

interface SpotColorInputWorker {
  hex: string;
  rgb: { r: number; g: number; b: number };
  spotWhite?: boolean;
  spotGloss?: boolean;
  spotWhiteName?: string;
  spotGlossName?: string;
  spotFluorY?: boolean;
  spotFluorM?: boolean;
  spotFluorG?: boolean;
  spotFluorOrange?: boolean;
  spotFluorYName?: string;
  spotFluorMName?: string;
  spotFluorGName?: string;
  spotFluorOrangeName?: string;
}

interface SpotColorRegionWorker {
  name: string;
  paths: Point[][];
  tintCMYK: [number, number, number, number];
}

interface WorkerMessage {
  type: 'trace';
  imageBuffer: ArrayBuffer;
  imageWidth: number;
  imageHeight: number;
  spotColors: SpotColorInputWorker[];
  widthInches: number;
  heightInches: number;
  dpi: number;
}

interface WorkerResponse {
  type: 'result';
  regions: SpotColorRegionWorker[];
}

interface WorkerMessagePremask {
  type: 'trace_premask';
  masks: Record<string, ArrayBuffer>;
  maskWidth: number;
  maskHeight: number;
  widthInches: number;
  heightInches: number;
  dpi: number;
  channelNames: Record<string, string>;
}

/** Scale a 1-bit mask from srcW×srcH to dstW×dstH (nearest-neighbor). */
function scaleMask(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(Math.floor(dy * srcH / dstH), srcH - 1);
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(Math.floor(dx * srcW / dstW), srcW - 1);
      dst[dy * dstW + dx] = src[sy * srcW + sx];
    }
  }
  return dst;
}

function createClosestColorMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  markedColors: SpotColorInputWorker[],
  allSpotColors: SpotColorInputWorker[],
  colorTolerance: number,
  alphaThreshold: number
): Uint8Array {
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

/**
 * Morphological dilation with a square structuring element (Chebyshev distance).
 * Two separable passes (H then V) for O(w·h·r) cost.
 */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(width * height);
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let v = 0;
      for (let i = x0; i <= x1; i++) { if (mask[row + i]) { v = 1; break; } }
      tmp[row + x] = v;
    }
  }
  // Vertical pass
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let v = 0;
      for (let j = y0; j <= y1; j++) { if (tmp[j * width + x]) { v = 1; break; } }
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * Morphological erosion (inverse of dilate).
 */
function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let v = 1;
      for (let i = x0; i <= x1; i++) { if (!mask[row + i]) { v = 0; break; } }
      tmp[row + x] = v;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let v = 1;
      for (let j = y0; j <= y1; j++) { if (!tmp[j * width + x]) { v = 0; break; } }
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * Morphological closing: dilate then erode. Bridges sub-pixel gaps caused
 * by anti-aliased boundary pixels failing the closest-color match, so a
 * full spot-color region produces one solid coverage area instead of one
 * riddled with pinhole gaps. Net shape change is ~0; only holes ≤ 2*radius
 * wide get filled.
 */
function morphologicalClose(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return erode(dilate(mask, width, height, radius), width, height, radius);
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
      if ((above > 0) !== (below > 0)) {
        if (above > 0) {
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
      if ((left > 0) !== (right > 0)) {
        if (left > 0) {
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

/** Shoelace area of a closed polygon (in whatever units the points are in). */
function polygonArea(path: Point[]): number {
  let area = 0;
  for (let i = 0; i < path.length; i++) {
    const j = (i + 1) % path.length;
    area += path[i].x * path[j].y - path[j].x * path[i].y;
  }
  return Math.abs(area) / 2;
}

// Pre-filter in pixel space before any expensive processing.
// 200 sq-px ≈ a 14×14 region — anything smaller is noise.
const MIN_PIXEL_AREA = 200;
// Holes get a much lower floor: dropping a small hole while its outer
// contour survives would flood the counter solid under even-odd fill
// (e.g. the inside of a small "o" or "e" at 300 DPI).
const MIN_HOLE_PIXEL_AREA = 25;

// Post-filter sanity check in inch space after smoothing.
const MIN_CONTOUR_AREA_SQ_IN = 2e-4;
const MIN_HOLE_AREA_SQ_IN = 2.5e-5;

/**
 * Douglas-Peucker polyline simplification — iterative (explicit stack) to
 * avoid deep recursion on long jagged contours.
 */
function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 3) return pts;
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    const ax = pts[start].x, ay = pts[start].y;
    const bx = pts[end].x,   by = pts[end].y;
    const abLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    let maxDist = 0, maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const dist = abLen === 0
        ? Math.sqrt((pts[i].x - ax) ** 2 + (pts[i].y - ay) ** 2)
        : Math.abs((by - ay) * pts[i].x - (bx - ax) * pts[i].y + bx * ay - by * ax) / abLen;
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const result: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) result.push(pts[i]);
  return result;
}

/**
 * Chaikin's corner-cutting algorithm for closed polygons.
 * Each iteration replaces every edge AB with two new points at ¼ and ¾
 * along the edge, converging to a quadratic B-spline.
 * 3 iterations is enough to make pixel-grid staircase diagonals look smooth.
 */
function chaikinSmooth(pts: Point[], iterations: number): Point[] {
  let cur = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [];
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    cur = next;
  }
  return cur;
}

/**
 * Signed area in Y-down image coordinates (marching squares' native space).
 * Positive  → clockwise winding     → outer filled contour.
 * Negative  → counter-clockwise     → inner hole contour.
 */
function signedArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return sum / 2;
}

function traceMaskToInchPaths(mask: Uint8Array, width: number, height: number, pixelsPerInch: number): Point[][] {
  // DP epsilon: 1 pixel in inch space — collapses staircase pixel-grid runs
  // into single diagonal segments before Chaikin smoothing.
  const dpEpsilon = 1.0 / pixelsPerInch;
  const pxToSqIn = 1 / (pixelsPerInch * pixelsPerInch);

  const rawPaths = marchingSquaresTrace(mask, width, height);
  const result: Point[][] = [];

  for (const rawPath of rawPaths) {
    const collapsed = collapseCollinear(rawPath);
    if (collapsed.length < 3) continue;

    // Pre-filter in pixel space (cheap). Holes (negative signed area) use a
    // lower threshold — dropping a small hole while its outer contour
    // survives would flood the interior solid under even-odd fill.
    const rawSa = signedArea(collapsed);
    const minPxArea = rawSa < 0 ? MIN_HOLE_PIXEL_AREA : MIN_PIXEL_AREA;
    if (Math.abs(rawSa) < minPxArea) continue;

    // Convert to inches.
    const inchPts = collapsed.map(p => ({ x: p.x / pixelsPerInch, y: p.y / pixelsPerInch }));

    // Simplify staircase runs into diagonal segments.
    const simplified = douglasPeucker(inchPts, dpEpsilon);
    if (simplified.length < 3) continue;

    // Outer contours (CW, positive signed area) get 2 Chaikin passes.
    // Hole contours (CCW, negative) stay unsmoothed — Chaikin shrinks
    // polygons inward, collapsing thin ink rings into blobs.
    const sa = signedArea(simplified);
    const smoothed = sa > 0 ? chaikinSmooth(simplified, 2) : simplified;

    const minSqIn = sa < 0 ? MIN_HOLE_AREA_SQ_IN : MIN_CONTOUR_AREA_SQ_IN;
    if (smoothed.length >= 3 && polygonArea(smoothed) >= minSqIn) {
      result.push(smoothed);
    }
  }

  return result;
}

function processSpotColors(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  spotColors: SpotColorInputWorker[],
  dpi: number
): SpotColorRegionWorker[] {
  const whiteColors = spotColors.filter(c => c.spotWhite);
  const glossColors = spotColors.filter(c => c.spotGloss);
  const whiteName = spotColors.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE';
  const glossName = spotColors.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS';

  const regions: SpotColorRegionWorker[] = [];

  // Morphological closing radius: at 300 DPI, 4 px ≈ 0.013" — bridges
  // anti-aliased boundary pixels that fail closest-color matching so each
  // selection produces one solid region instead of many tiny isolated dots.
  // Closing only fills holes ≤ 2*radius wide so distinct design elements
  // (intentional gaps) are preserved.
  const closingRadius = Math.max(2, Math.round(dpi / 75));

  if (whiteColors.length > 0) {
    const raw = createClosestColorMask(pixelData, width, height, whiteColors, spotColors, 60, 240);
    const mask = morphologicalClose(raw, width, height, closingRadius);
    const paths = traceMaskToInchPaths(mask, width, height, dpi);
    if (paths.length > 0) {
      regions.push({ name: whiteName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  if (glossColors.length > 0) {
    const raw = createClosestColorMask(pixelData, width, height, glossColors, spotColors, 60, 240);
    const mask = morphologicalClose(raw, width, height, closingRadius);
    const paths = traceMaskToInchPaths(mask, width, height, dpi);
    if (paths.length > 0) {
      regions.push({ name: glossName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  const fluorTypes: Array<{
    field: keyof SpotColorInputWorker;
    nameField: keyof SpotColorInputWorker;
    defaultName: string;
    tintCMYK: [number, number, number, number];
  }> = [
    { field: 'spotFluorY',      nameField: 'spotFluorYName',      defaultName: 'FY', tintCMYK: [0,   0,   1, 0] },
    { field: 'spotFluorM',      nameField: 'spotFluorMName',      defaultName: 'FM', tintCMYK: [0,   1,   0, 0] },
    { field: 'spotFluorG',      nameField: 'spotFluorGName',      defaultName: 'FG', tintCMYK: [1,   0,   1, 0] },
    { field: 'spotFluorOrange', nameField: 'spotFluorOrangeName', defaultName: 'FO', tintCMYK: [0, 0.5,   1, 0] },
  ];

  for (const ft of fluorTypes) {
    const matchingColors = spotColors.filter(c => c[ft.field as keyof SpotColorInputWorker]);
    if (matchingColors.length > 0) {
      const fluorName = (matchingColors[0][ft.nameField as keyof SpotColorInputWorker] as string) || ft.defaultName;
      const raw = createClosestColorMask(pixelData, width, height, matchingColors, spotColors, 60, 240);
      const mask = morphologicalClose(raw, width, height, closingRadius);
      const paths = traceMaskToInchPaths(mask, width, height, dpi);
      if (paths.length > 0) {
        regions.push({ name: fluorName, paths, tintCMYK: ft.tintCMYK });
      }
    }
  }

  return regions;
}

self.onmessage = function(e: MessageEvent<WorkerMessage | WorkerMessagePremask>) {
  try {
    if (e.data.type === 'trace') {
      const { imageBuffer, imageWidth, imageHeight, spotColors, dpi } = e.data as WorkerMessage;
      const pixelData = new Uint8ClampedArray(imageBuffer);
      const regions = processSpotColors(pixelData, imageWidth, imageHeight, spotColors, dpi);
      const response: WorkerResponse = { type: 'result', regions };
      self.postMessage(response);
    } else if (e.data.type === 'trace_premask') {
      const { masks, maskWidth, maskHeight, widthInches, heightInches, dpi, channelNames } = e.data as WorkerMessagePremask;
      const outW = Math.round(widthInches * dpi);
      const outH = Math.round(heightInches * dpi);

      const FLUOR_TINTS: Record<string, [number, number, number, number]> = {
        FY:    [0,   0,   1, 0],
        FM:    [0,   1,   0, 0],
        FG:    [1,   0,   1, 0],
        FO:    [0, 0.5,   1, 0],
        // White underbase: [0,0,0,0] renders as invisible in standard PDF viewers
        // so the design image is visible through it.  RIP software identifies the
        // channel by name (RDG_WHITE), not by the CMYK tint.
        WHITE: [0,   0,   0, 0],
      };

      const regions: SpotColorRegionWorker[] = [];
      for (const [channel, maskBuffer] of Object.entries(masks)) {
        const srcMask = new Uint8Array(maskBuffer);
        const scaledMask = scaleMask(srcMask, maskWidth, maskHeight, outW, outH);
        const paths = traceMaskToInchPaths(scaledMask, outW, outH, dpi);
        if (paths.length > 0) {
          const name = channelNames[channel] || channel;
          const tintCMYK = FLUOR_TINTS[channel] ?? ([0, 1, 0, 0] as [number, number, number, number]);
          regions.push({ name, paths, tintCMYK });
        }
      }
      const response: WorkerResponse = { type: 'result', regions };
      self.postMessage(response);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  }
};
