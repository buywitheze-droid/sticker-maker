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

  const directTolerance = 100;

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

// Pre-filter: skip any raw contour whose pixel-space area is below this.
// Applied before DP/Chaikin so we never run expensive processing on noise.
// 200 sq-pixels ≈ a 14×14 region at any DPI — clearly below any real detail.
const MIN_PIXEL_AREA = 200;

// Post-filter: sanity check in inch space after smoothing.
// 2e-4 sq in ≈ 18 pixels at 300 DPI — catches anything that shrank below threshold.
const MIN_CONTOUR_AREA_SQ_IN = 2e-4;

/**
 * Douglas-Peucker polyline simplification.
 * Removes points that deviate less than `epsilon` from the straight line
 * between their neighbours.  Collapses staircase pixel-runs into single
 * diagonal segments before Chaikin smoothing, keeping the point count low.
 */
function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 3) return pts;

  // Find the point with the greatest perpendicular distance from the
  // line segment pts[0] → pts[last].
  const last = pts.length - 1;
  const ax = pts[0].x, ay = pts[0].y;
  const bx = pts[last].x, by = pts[last].y;
  const abLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);

  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < last; i++) {
    const dist = abLen === 0
      ? Math.sqrt((pts[i].x - ax) ** 2 + (pts[i].y - ay) ** 2)
      : Math.abs((by - ay) * pts[i].x - (bx - ax) * pts[i].y + bx * ay - by * ax) / abLen;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left  = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[last]];
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
  // DP epsilon: 1 pixel in inch space — aggressively collapses staircase runs
  // into diagonal segments so Chaikin has clean corners to smooth.
  const dpEpsilon = 1.0 / pixelsPerInch;

  const rawPaths = marchingSquaresTrace(mask, width, height);
  const result: Point[][] = [];

  for (const rawPath of rawPaths) {
    const collapsed = collapseCollinear(rawPath);
    if (collapsed.length < 3) continue;

    // ── Pre-filter in pixel space (cheap, before any costly processing).
    //    signedArea on integer pixel coords gives the exact pixel area.
    //    Skip anything smaller than MIN_PIXEL_AREA — pure noise.
    const pxSA = signedArea(collapsed);
    if (Math.abs(pxSA) < MIN_PIXEL_AREA) continue;

    // ── Convert to inches.
    const inchPts = collapsed.map(p => ({ x: p.x / pixelsPerInch, y: p.y / pixelsPerInch }));

    // ── Simplify staircase runs into diagonal segments.
    const simplified = douglasPeucker(inchPts, dpEpsilon);
    if (simplified.length < 3) continue;

    // ── Smooth outer contours only (2 Chaikin passes = 4× point multiplication).
    //    Inner (hole) contours keep the DP-simplified polygon unchanged.
    //    Chaikin cuts corners inward; applied to a hole it shrinks it — collapsing
    //    thin ink rings and flooding the enclosed white area with ink.
    //    Winding: positive signed area = CW in Y-down = outer; negative = hole.
    const sa = signedArea(simplified);
    const smoothed = sa > 0 ? chaikinSmooth(simplified, 2) : simplified;

    if (smoothed.length >= 3 && polygonArea(smoothed) >= MIN_CONTOUR_AREA_SQ_IN) {
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

  if (whiteColors.length > 0) {
    const mask = createClosestColorMask(pixelData, width, height, whiteColors, spotColors, 80, 128);
    const paths = traceMaskToInchPaths(mask, width, height, dpi);
    if (paths.length > 0) {
      regions.push({ name: whiteName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  if (glossColors.length > 0) {
    const mask = createClosestColorMask(pixelData, width, height, glossColors, spotColors, 80, 128);
    const paths = traceMaskToInchPaths(mask, width, height, dpi);
    if (paths.length > 0) {
      regions.push({ name: glossName, paths, tintCMYK: [0, 1, 0, 0] });
    }
  }

  // Per-channel CMYK tints so RIP software can distinguish channels visually.
  // FY = Yellow, FM = Magenta, FG = Green (C+Y), FO = Orange (M+Y)
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
      const mask = createClosestColorMask(pixelData, width, height, matchingColors, spotColors, 80, 128);
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
