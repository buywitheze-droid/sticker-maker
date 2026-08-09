import { PDFDocument, PDFName, PDFArray, PDFDict, PDFPage, PDFHexString } from 'pdf-lib';
import { type SpotColorInput } from './spot-color-types';
import SpotColorWorker from './spot-color-worker?worker';
import { runPooled, resolveWorkerPoolSize } from './worker-pool';

interface Point {
  x: number;
  y: number;
}

interface SpotColorRegion {
  name: string;
  paths: Point[][];
  tintCMYK: [number, number, number, number];
}

const SPOT_COLOR_DPI = 300;

/** One separation to trace: which colours belong to it, and what to call it. */
interface SpotSeparationJob {
  regionName: string;
  markedColors: SpotColorInput[];
}

/**
 * Works out which separations this design actually needs. Anything with no assigned
 * colours is skipped rather than dispatched, so a design using only white does one
 * pass instead of six.
 */
function planSeparations(spotColors: SpotColorInput[]): SpotSeparationJob[] {
  const jobs: SpotSeparationJob[] = [];

  const white = spotColors.filter(c => c.spotWhite);
  if (white.length > 0) {
    jobs.push({
      regionName: spotColors.find(c => c.spotWhite)?.spotWhiteName || 'RDG_WHITE',
      markedColors: white,
    });
  }

  const gloss = spotColors.filter(c => c.spotGloss);
  if (gloss.length > 0) {
    jobs.push({
      regionName: spotColors.find(c => c.spotGloss)?.spotGlossName || 'RDG_GLOSS',
      markedColors: gloss,
    });
  }

  const fluorTypes = [
    { field: 'spotFluorY' as const, nameField: 'spotFluorYName' as const, defaultName: 'FY' },
    { field: 'spotFluorM' as const, nameField: 'spotFluorMName' as const, defaultName: 'FM' },
    { field: 'spotFluorG' as const, nameField: 'spotFluorGName' as const, defaultName: 'FG' },
    { field: 'spotFluorOrange' as const, nameField: 'spotFluorOrangeName' as const, defaultName: 'FO' },
  ];
  for (const ft of fluorTypes) {
    const marked = spotColors.filter(c => c[ft.field]);
    if (marked.length > 0) {
      jobs.push({
        regionName: marked[0][ft.nameField] || ft.defaultName,
        markedColors: marked,
      });
    }
  }

  return jobs;
}

function toWorkerColors(spotColors: SpotColorInput[]) {
  return spotColors.map(c => ({
    hex: c.hex,
    rgb: c.rgb,
    spotWhite: c.spotWhite,
    spotGloss: c.spotGloss,
    spotWhiteName: c.spotWhiteName,
    spotGlossName: c.spotGlossName,
    spotFluorY: c.spotFluorY,
    spotFluorM: c.spotFluorM,
    spotFluorG: c.spotFluorG,
    spotFluorOrange: c.spotFluorOrange,
    spotFluorYName: c.spotFluorYName,
    spotFluorMName: c.spotFluorMName,
    spotFluorGName: c.spotFluorGName,
    spotFluorOrangeName: c.spotFluorOrangeName,
  }));
}

/**
 * Traces every spot separation the design needs, running them concurrently.
 *
 * Each separation is an independent mask-and-trace over the same pixels, and they used
 * to run in sequence inside one worker — six full passes back to back. Fanning them
 * across a pool measured 3.8x faster on a representative design.
 *
 * Each job gets its own copy of the pixel buffer, since a transfer would detach it
 * from the others. Six copies of a 12.4 MB image measured 23 ms of main-thread time,
 * against the ~400 ms of wall clock the parallelism saves. Encoding once and sharing a
 * Blob instead was measured and came out worse: the encode alone cost more than the
 * copies, and every worker then paid to decode it.
 */
async function traceColorRegionsAsync(
  image: HTMLImageElement | ImageBitmap,
  spotColors: SpotColorInput[],
  widthInches: number,
  heightInches: number
): Promise<SpotColorRegion[]> {
  const jobs = planSeparations(spotColors);
  if (jobs.length === 0) return [];

  const width = Math.round(widthInches * SPOT_COLOR_DPI);
  const height = Math.round(heightInches * SPOT_COLOR_DPI);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    console.warn('[SpotColor] No 2D context, skipping spot colors');
    return [];
  }
  ctx.drawImage(image, 0, 0, width, height);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch (err) {
    console.warn('[SpotColor] Could not read pixels, skipping spot colors:', err);
    return [];
  }

  const workerColors = toWorkerColors(spotColors);
  console.log(
    `[SpotColor] Tracing ${jobs.length} separation(s) at ${width}x${height}, ${SPOT_COLOR_DPI} DPI, ` +
    `${resolveWorkerPoolSize(jobs.length)} worker(s)`
  );

  const timeoutMs = Math.max(30000, Math.round((width * height) / 50000) * 1000);
  const results = await withTimeout(
    runPooled<SpotSeparationJob, { type: string; region: SpotColorRegion | null }>(
      jobs,
      () => new SpotColorWorker(),
      job => {
        // Per-job copy: a transferred buffer would be detached for the other jobs.
        const buffer = pixels.slice().buffer;
        return {
          payload: {
            type: 'trace',
            imageBuffer: buffer,
            imageWidth: width,
            imageHeight: height,
            markedColors: toWorkerColors(job.markedColors),
            spotColors: workerColors,
            regionName: job.regionName,
            dpi: SPOT_COLOR_DPI,
          },
          transfer: [buffer],
        };
      },
      { name: 'SpotColor' },
    ),
    timeoutMs,
  );

  if (!results) {
    console.warn(`[SpotColor] Tracing timed out after ${timeoutMs}ms`);
    return [];
  }

  const regions = results
    .map(r => (r && r.type === 'result' ? r.region : null))
    .filter((r): r is SpotColorRegion => r !== null);

  console.log(`[SpotColor] Traced ${regions.length} region(s) at ${SPOT_COLOR_DPI} DPI`);
  for (const r of regions) {
    console.log(`[SpotColor]   ${r.name}: ${r.paths.length} contours`);
  }
  return regions;
}

/** Resolves to null if `work` has not finished in time. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); console.warn('[SpotColor] Tracing failed:', err); resolve(null); },
    );
  });
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

function addSpotColorRegionAsLayer(
  pdfDoc: PDFDocument,
  page: PDFPage,
  region: SpotColorRegion,
  offsetPaths: Point[][],
  ocgRef: any
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

  let propertiesDict = pageResources.get(PDFName.of('Properties'));
  if (!propertiesDict) {
    propertiesDict = context.obj({});
    (pageResources as PDFDict).set(PDFName.of('Properties'), propertiesDict);
  }
  const ocgTag = `OC_${region.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  (propertiesDict as PDFDict).set(PDFName.of(ocgTag), ocgRef);

  const validPaths = offsetPaths.filter(p => p.length >= 3);
  if (validPaths.length === 0) return;

  let ops = `/OC /${ocgTag} BDC\nq\n`;
  ops += `/${region.name} cs 1 scn\n`;
  for (const path of validPaths) {
    const pts = path.map(p => ({ x: p.x * 72, y: p.y * 72 }));
    ops += `${pts[0].x.toFixed(4)} ${pts[0].y.toFixed(4)} m\n`;
    for (let j = 1; j < pts.length; j++) {
      ops += `${pts[j].x.toFixed(4)} ${pts[j].y.toFixed(4)} l\n`;
    }
    ops += 'h\n';
  }
  ops += 'f*\nQ\nEMC\n';

  console.log(`[SpotColor PDF] Layer "${region.name}": ${region.paths.length} contours, ${ops.length} chars`);
  appendContentStream(page, context, ops);
}

/**
 * Add spot color vectors to the same page as the raster image,
 * each fluorescent color in its own named OCG layer.
 */
export async function addSpotColorVectorsToPDF(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: HTMLImageElement | ImageBitmap,
  spotColors: SpotColorInput[],
  widthInches: number,
  heightInches: number,
  pageHeightInches: number,
  imageOffsetXInches: number,
  imageOffsetYInches: number,
  rotationDeg: number = 0,
): Promise<string[]> {
  if (!spotColors || spotColors.length === 0) return [];

  const hasWhite = spotColors.some(c => c.spotWhite);
  const hasGloss = spotColors.some(c => c.spotGloss);
  const hasFluor = spotColors.some(c => c.spotFluorY || c.spotFluorM || c.spotFluorG || c.spotFluorOrange);
  if (!hasWhite && !hasGloss && !hasFluor) return [];

  const regions = await traceColorRegionsAsync(image, spotColors, widthInches, heightInches);
  if (regions.length === 0) return [];

  const context = pdfDoc.context;
  const addedLabels: string[] = [];
  const ocgRefs: any[] = [];

  // Reuse existing OCGs for same-named regions across multiple designs
  const existingOcgTags = new Map<string, any>();
  try {
    const res = page.node.Resources();
    const props = res?.get(PDFName.of('Properties'));
    if (props instanceof PDFDict) {
      const entries = props.entries();
      for (const [key, val] of entries) {
        existingOcgTags.set(key.toString().replace('/', ''), val);
      }
    }
  } catch { /* first call, no properties yet */ }

  // Design center in canvas coords (Y-down)
  const designCx = imageOffsetXInches + widthInches / 2;
  const designCy = imageOffsetYInches + heightInches / 2;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  for (const region of regions) {
    const offsetPaths = region.paths.map(path =>
      path.map(p => {
        // Image-relative to image-centered
        const relX = p.x - widthInches / 2;
        const relY = p.y - heightInches / 2;
        // Rotate around image center
        const rotX = relX * cosR - relY * sinR;
        const rotY = relX * sinR + relY * cosR;
        // Translate to absolute page coords, flip Y for PDF
        return {
          x: designCx + rotX,
          y: pageHeightInches - (designCy + rotY),
        };
      })
    );

    const ocgTag = `OC_${region.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    let ocgRef = existingOcgTags.get(ocgTag);
    let isNewOcg = false;

    if (!ocgRef) {
      const ocgDict = context.obj({
        Type: PDFName.of('OCG'),
        Name: PDFHexString.fromText(region.name),
      });
      ocgRef = context.register(ocgDict);
      isNewOcg = true;
    }

    if (isNewOcg) {
      ocgRefs.push(ocgRef);
    }

    addSpotColorRegionAsLayer(pdfDoc, page, region, offsetPaths, ocgRef);
    if (!addedLabels.includes(region.name)) {
      addedLabels.push(region.name);
    }
  }

  if (ocgRefs.length === 0) return addedLabels;

  registerOptionalContentGroups(pdfDoc, ocgRefs);

  return addedLabels;
}

/**
 * List new optional-content groups in the document catalog.
 *
 * A separation that is drawn but never registered here is invisible to the
 * layer panel of every viewer and to the RIP, so this is what turns marked-up
 * content into an actual named channel.
 */
function registerOptionalContentGroups(pdfDoc: PDFDocument, ocgRefs: any[]): void {
  if (ocgRefs.length === 0) return;
  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;
  const ocProperties = catalog.get(PDFName.of('OCProperties'));
  if (!ocProperties) {
    catalog.set(
      PDFName.of('OCProperties'),
      context.obj({
        OCGs: context.obj([...ocgRefs]),
        D: context.obj({
          ON: context.obj([...ocgRefs]),
          Order: context.obj([...ocgRefs]),
          BaseState: PDFName.of('ON'),
        }),
      }),
    );
    return;
  }
  const existingOCGs = (ocProperties as PDFDict).get(PDFName.of('OCGs'));
  if (existingOCGs instanceof PDFArray) {
    for (const ref of ocgRefs) existingOCGs.push(ref);
  }
  const dDict = (ocProperties as PDFDict).get(PDFName.of('D'));
  if (dDict instanceof PDFDict) {
    const order = dDict.get(PDFName.of('Order'));
    if (order instanceof PDFArray) {
      for (const ref of ocgRefs) order.push(ref);
    }
    const on = dDict.get(PDFName.of('ON'));
    if (on instanceof PDFArray) {
      for (const ref of ocgRefs) on.push(ref);
    }
  }
}

/**
 * Add separations whose masks the caller has already built.
 *
 * This is how the white underbase gets into the file. Unlike the colour
 * separations above there is nothing to match here — the mask is derived from
 * the silhouette of the whole sheet, covers the page rather than one design,
 * and only needs tracing and placing.
 */
export async function addSpotColorVectorsFromMasksToPDF(
  pdfDoc: PDFDocument,
  page: PDFPage,
  masks: Record<string, Uint8Array>,
  maskWidth: number,
  maskHeight: number,
  channelNames: Record<string, string>,
  widthInches: number,
  heightInches: number,
  pageHeightInches: number,
  imageOffsetXInches: number,
  imageOffsetYInches: number,
  rotationDeg = 0,
): Promise<string[]> {
  const hasInk = Object.values(masks).some(mask => mask.some(v => v > 0));
  if (!hasInk) return [];

  // Handed over rather than copied: these are full-sheet masks, and at 150 DPI
  // a 22 x 120 in sheet is around 60 MB that nobody needs two of.
  const masksForWorker: Record<string, ArrayBuffer> = {};
  const transferable: ArrayBuffer[] = [];
  for (const [channel, mask] of Object.entries(masks)) {
    const buffer = mask.buffer.slice(mask.byteOffset, mask.byteOffset + mask.byteLength);
    masksForWorker[channel] = buffer;
    transferable.push(buffer);
  }

  const regions = await new Promise<SpotColorRegion[]>(resolve => {
    let worker: Worker;
    try {
      worker = new SpotColorWorker();
    } catch (err) {
      console.warn('[SpotColor] could not start the mask worker:', err);
      resolve([]);
      return;
    }

    const outW = Math.round(widthInches * SPOT_COLOR_DPI);
    const outH = Math.round(heightInches * SPOT_COLOR_DPI);
    // Scaled to the sheet: a full-length gangsheet is legitimately slow to
    // trace, and a fixed timeout would abandon the underbase on exactly the
    // orders that most need one.
    const timeoutMs = Math.max(30_000, Math.round((outW * outH) / 50_000) * 1000);
    const timeout = setTimeout(() => {
      worker.terminate();
      console.warn('[SpotColor] mask worker timed out');
      resolve([]);
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data?.type === 'result' ? (e.data.regions ?? []) : []);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      resolve([]);
    };

    worker.postMessage({
      type: 'trace_premask',
      masks: masksForWorker,
      maskWidth,
      maskHeight,
      widthInches,
      heightInches,
      dpi: SPOT_COLOR_DPI,
      channelNames,
    }, transferable);
  });

  if (regions.length === 0) return [];

  const context = pdfDoc.context;
  const addedLabels: string[] = [];
  const ocgRefs: any[] = [];

  const existingOcgTags = new Map<string, any>();
  try {
    const props = page.node.Resources()?.get(PDFName.of('Properties'));
    if (props instanceof PDFDict) {
      for (const [key, val] of props.entries()) {
        existingOcgTags.set(key.toString().replace('/', ''), val);
      }
    }
  } catch {
    /* nothing registered yet */
  }

  const designCx = imageOffsetXInches + widthInches / 2;
  const designCy = imageOffsetYInches + heightInches / 2;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  for (const region of regions) {
    const offsetPaths = region.paths.map(path =>
      path.map(p => {
        // Same Y-down to Y-up correction as the colour separations above.
        const relX = p.x - widthInches / 2;
        const relY = p.y - heightInches / 2;
        return {
          x: designCx + relX * cosR + relY * sinR,
          y: (pageHeightInches - designCy) + relX * sinR - relY * cosR,
        };
      }),
    );

    const ocgTag = `OC_${region.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    let ocgRef = existingOcgTags.get(ocgTag);
    if (!ocgRef) {
      ocgRef = context.register(
        context.obj({ Type: PDFName.of('OCG'), Name: PDFHexString.fromText(region.name) }),
      );
      ocgRefs.push(ocgRef);
    }

    addSpotColorRegionAsLayer(pdfDoc, page, region, offsetPaths, ocgRef);
    if (!addedLabels.includes(region.name)) addedLabels.push(region.name);
  }

  registerOptionalContentGroups(pdfDoc, ocgRefs);

  return addedLabels;
}
