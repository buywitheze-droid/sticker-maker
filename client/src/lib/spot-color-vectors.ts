import { PDFDocument, PDFName, PDFArray, PDFDict, PDFPage, PDFHexString } from 'pdf-lib';
import { type SpotColorInput } from './spot-color-types';
import SpotColorWorker from './spot-color-worker?worker';

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

function traceColorRegionsAsync(
  image: HTMLImageElement,
  spotColors: SpotColorInput[],
  widthInches: number,
  heightInches: number
): Promise<SpotColorRegion[]> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(widthInches * SPOT_COLOR_DPI);
    canvas.height = Math.round(heightInches * SPOT_COLOR_DPI);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const workerColors = spotColors.map(c => ({
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

    let worker: Worker;
    try {
      worker = new SpotColorWorker();
    } catch (err) {
      console.warn('[SpotColor] Worker creation failed, skipping spot colors:', err);
      resolve([]);
      return;
    }

    const pixelCount = canvas.width * canvas.height;
    const timeoutMs = Math.max(30000, Math.round(pixelCount / 50000) * 1000);

    const timeout = setTimeout(() => {
      worker.terminate();
      console.warn(`[SpotColor] Worker timed out after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      if (e.data.type === 'result') {
        const regions: SpotColorRegion[] = e.data.regions;
        console.log(`[SpotColor] Worker returned ${regions.length} regions at ${SPOT_COLOR_DPI} DPI`);
        for (const r of regions) {
          console.log(`[SpotColor]   ${r.name}: ${r.paths.length} contours`);
        }
        resolve(regions);
      } else {
        resolve([]);
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      console.warn('[SpotColor] Worker error, skipping spot colors:', err);
      resolve([]);
    };

    console.log(`[SpotColor] Sending to worker: ${canvas.width}x${canvas.height} at ${SPOT_COLOR_DPI} DPI`);
    const buffer = imageData.data.buffer;
    worker.postMessage({
      type: 'trace',
      imageBuffer: buffer,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      spotColors: workerColors,
      widthInches,
      heightInches,
      dpi: SPOT_COLOR_DPI,
    }, [buffer]);
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
  image: HTMLImageElement,
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

  const catalog = pdfDoc.catalog;
  let ocProperties = catalog.get(PDFName.of('OCProperties'));
  if (!ocProperties) {
    const ocgsArray = context.obj([...ocgRefs]);
    const orderArray = context.obj([...ocgRefs]);
    const onArray = context.obj([...ocgRefs]);
    const dDict = context.obj({ ON: onArray, Order: orderArray, BaseState: PDFName.of('ON') });
    ocProperties = context.obj({ OCGs: ocgsArray, D: dDict });
    catalog.set(PDFName.of('OCProperties'), ocProperties);
  } else {
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

  return addedLabels;
}

/* ─── SMask edge-smoothing ────────────────────────────────────────────────────
 * Three-pass box blur that approximates a Gaussian blur.  Applied exclusively
 * to the SMask (alpha channel) of each spot-color XObject so edges look smooth
 * instead of pixel-staircase jagged.  The ink-tint channel is left untouched
 * so full ink coverage is preserved inside the selection.
 * radius=2 at 300 DPI ≈ 0.007" of edge feather — enough to kill staircases
 * without producing a visible halo.
 */
function _boxBlurH(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[base + Math.max(0, Math.min(w - 1, k))];
    dst[base] = acc * inv;
    for (let x = 1; x < w; x++) {
      acc += src[base + Math.min(x + r, w - 1)] - src[base + Math.max(x - r - 1, 0)];
      dst[base + x] = acc * inv;
    }
  }
  return dst;
}

function _boxBlurV(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[Math.max(0, Math.min(h - 1, k)) * w + x];
    dst[x] = acc * inv;
    for (let y = 1; y < h; y++) {
      acc += src[Math.min(y + r, h - 1) * w + x] - src[Math.max(y - r - 1, 0) * w + x];
      dst[y * w + x] = acc * inv;
    }
  }
  return dst;
}

function _blurSmask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  let buf = new Float32Array(mask);
  for (let p = 0; p < 3; p++) {   // three passes ≈ Gaussian
    buf = _boxBlurH(buf, w, h, radius);
    buf = _boxBlurV(buf, w, h, radius);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(255, Math.max(0, buf[i] + 0.5)) | 0;
  }
  return out;
}

/**
 * Embed fluorescent spot color channels as raster image XObjects in the PDF.
 * Each channel is a grayscale image (255 = full ink, 0 = no ink) placed in a
 * Separation colorspace layer at exactly the same position/size/rotation as the
 * CMYK design image.  No vectorization — edges are pixel-perfect.
 */
export async function addSpotColorRastersToPDF(
  pdfDoc: PDFDocument,
  page: PDFPage,
  channels: Array<{
    name: string;
    tintCMYK: [number, number, number, number];
    mask: Uint8Array;        // grayscale bytes at maskWidth×maskHeight
    maskWidth: number;
    maskHeight: number;
  }>,
  designWidthPt: number,
  designHeightPt: number,
  bottomLeftX: number,       // PDF-space (pts, Y-up) bottom-left of design
  bottomLeftY: number,
  rotRad: number,            // rotation already in radians (same sign as page.drawImage uses)
): Promise<string[]> {
  const addedNames: string[] = [];
  const context = pdfDoc.context;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // Ensure page has a Resources dict
  let pageResources = page.node.Resources();
  if (!pageResources) {
    pageResources = context.obj({});
    page.node.set(PDFName.of('Resources'), pageResources);
  }

  for (const ch of channels) {
    if (!ch.mask.some(v => v > 0)) continue;

    // ── 1. Separation colorspace: /Separation /Name /DeviceCMYK <<tint fn>>
    const tintFn = context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: ch.tintCMYK,
      N: 1,
    });
    const tintFnRef = context.register(tintFn);
    const sep = context.obj([
      PDFName.of('Separation'),
      PDFName.of(ch.name),
      PDFName.of('DeviceCMYK'),
      tintFnRef,
    ]);
    const sepRef = context.register(sep);

    // ── 2a. Soft-mask (SMask) — Gaussian-blurred DeviceGray alpha channel.
    //        Blurring smooths the hard binary 0/255 boundary into a gradient,
    //        eliminating pixel-staircase aliasing on all edges (inner colour
    //        boundaries and outer design-to-background transitions alike).
    //        radius=2 at 300 DPI ≈ 0.007" of feather — invisible as a halo but
    //        enough to produce the smooth Photoshop-wand look.
    const smoothedSmask = _blurSmask(ch.mask, ch.maskWidth, ch.maskHeight, 2);
    const smaskStream = context.stream(smoothedSmask, {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Image'),
      Width: ch.maskWidth,
      Height: ch.maskHeight,
      ColorSpace: PDFName.of('DeviceGray'),
      BitsPerComponent: 8,
    });
    const smaskRef = context.register(smaskStream);

    // ── 2b. Image XObject (raw grayscale, 1 byte/pixel).
    //        Ink tint channel keeps the original (canvas-alpha-weighted) data so
    //        full ink coverage is preserved inside the selection; only the SMask
    //        is blurred for smooth edge transparency.
    const imageStream = context.stream(ch.mask, {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Image'),
      Width: ch.maskWidth,
      Height: ch.maskHeight,
      ColorSpace: sepRef,
      BitsPerComponent: 8,
      SMask: smaskRef,
    });
    const imageRef = context.register(imageStream);
    const imgTag = `SpotR_${ch.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // ── 3. Optional Content Group (layer) so the channel can be toggled in Acrobat
    const ocgDict = context.obj({
      Type: PDFName.of('OCG'),
      Name: PDFHexString.fromText(ch.name),
    });
    const ocgRef = context.register(ocgDict);
    const ocgTag = `OC_${ch.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // ── 4. Register in page resources
    let xoDict = pageResources.get(PDFName.of('XObject'));
    if (!xoDict) { xoDict = context.obj({}); (pageResources as PDFDict).set(PDFName.of('XObject'), xoDict); }
    (xoDict as PDFDict).set(PDFName.of(imgTag), imageRef);

    let propsDict = pageResources.get(PDFName.of('Properties'));
    if (!propsDict) { propsDict = context.obj({}); (pageResources as PDFDict).set(PDFName.of('Properties'), propsDict); }
    (propsDict as PDFDict).set(PDFName.of(ocgTag), ocgRef);

    // ── 5. Content stream: CTM positions image exactly like the CMYK layer
    //       [a b c d e f] cm  where a=W·cosθ, b=W·sinθ, c=-H·sinθ, d=H·cosθ
    const a = (designWidthPt  * cosR).toFixed(4);
    const b = (designWidthPt  * sinR).toFixed(4);
    const c = (-designHeightPt * sinR).toFixed(4);
    const d = (designHeightPt  * cosR).toFixed(4);
    const e = bottomLeftX.toFixed(4);
    const f = bottomLeftY.toFixed(4);

    const ops = `/OC /${ocgTag} BDC\nq\n${a} ${b} ${c} ${d} ${e} ${f} cm\n/${imgTag} Do\nQ\nEMC\n`;
    appendContentStream(page, context, ops);

    // ── 6. Register OCG in catalog OCProperties
    try {
      const catalog = pdfDoc.catalog;
      let ocProps = catalog.get(PDFName.of('OCProperties'));
      if (!ocProps) {
        const arr = context.obj([ocgRef]);
        ocProps = context.obj({ OCGs: arr, D: context.obj({ Order: arr }) });
        catalog.set(PDFName.of('OCProperties'), ocProps);
      } else {
        const arr = (ocProps as PDFDict).get(PDFName.of('OCGs'));
        if (arr instanceof PDFArray) arr.push(ocgRef);
      }
    } catch { /* non-fatal */ }

    addedNames.push(ch.name);
    console.log(`[SpotColor PDF] Raster layer "${ch.name}": ${ch.maskWidth}×${ch.maskHeight} px`);
  }

  return addedNames;
}

/**
 * Like addSpotColorVectorsToPDF but uses pre-computed per-channel pixel masks
 * (from region-level spot selections) instead of re-running color detection.
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
  const hasMasks = Object.values(masks).some(m => m.some(v => v > 0));
  if (!hasMasks) return [];

  // Transfer mask buffers to worker (zero-copy)
  const masksForWorker: Record<string, ArrayBuffer> = {};
  const transferable: ArrayBuffer[] = [];
  for (const [ch, mask] of Object.entries(masks)) {
    const buf = mask.buffer.slice(mask.byteOffset, mask.byteOffset + mask.byteLength);
    masksForWorker[ch] = buf;
    transferable.push(buf);
  }

  const regions = await new Promise<SpotColorRegion[]>((resolve) => {
    let worker: Worker;
    try { worker = new SpotColorWorker(); }
    catch (err) {
      console.warn('[SpotColor] Worker creation failed for masks:', err);
      resolve([]); return;
    }

    const outW = Math.round(widthInches * SPOT_COLOR_DPI);
    const outH = Math.round(heightInches * SPOT_COLOR_DPI);
    const timeoutMs = Math.max(30000, Math.round(outW * outH / 50000) * 1000);
    const timeout = setTimeout(() => {
      worker.terminate();
      console.warn('[SpotColor] Mask worker timed out');
      resolve([]);
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data.type === 'result' ? e.data.regions : []);
    };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); resolve([]); };

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
    const res = page.node.Resources();
    const props = res?.get(PDFName.of('Properties'));
    if (props instanceof PDFDict) {
      for (const [key, val] of props.entries()) {
        existingOcgTags.set(key.toString().replace('/', ''), val);
      }
    }
  } catch { /* first call */ }

  const designCx = imageOffsetXInches + widthInches / 2;
  const designCy = imageOffsetYInches + heightInches / 2;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);

  for (const region of regions) {
    const offsetPaths = region.paths.map(path =>
      path.map(p => {
        const relX = p.x - widthInches / 2;
        const relY = p.y - heightInches / 2;
        const rotX = relX * cosR - relY * sinR;
        const rotY = relX * sinR + relY * cosR;
        return { x: designCx + rotX, y: pageHeightInches - (designCy + rotY) };
      })
    );

    const ocgTag = `OC_${region.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    let ocgRef = existingOcgTags.get(ocgTag);
    let isNewOcg = false;
    if (!ocgRef) {
      const ocgDict = context.obj({ Type: PDFName.of('OCG'), Name: PDFHexString.fromText(region.name) });
      ocgRef = context.register(ocgDict);
      isNewOcg = true;
    }
    if (isNewOcg) ocgRefs.push(ocgRef);

    addSpotColorRegionAsLayer(pdfDoc, page, region, offsetPaths, ocgRef);
    if (!addedLabels.includes(region.name)) addedLabels.push(region.name);
  }

  if (ocgRefs.length === 0) return addedLabels;

  const catalog = pdfDoc.catalog;
  let ocProperties = catalog.get(PDFName.of('OCProperties'));
  if (!ocProperties) {
    const ocgsArray = context.obj([...ocgRefs]);
    const orderArray = context.obj([...ocgRefs]);
    const onArray = context.obj([...ocgRefs]);
    const dDict = context.obj({ ON: onArray, Order: orderArray, BaseState: PDFName.of('ON') });
    ocProperties = context.obj({ OCGs: ocgsArray, D: dDict });
    catalog.set(PDFName.of('OCProperties'), ocProperties);
  } else {
    const existingOCGs = (ocProperties as PDFDict).get(PDFName.of('OCGs'));
    if (existingOCGs instanceof PDFArray) { for (const ref of ocgRefs) existingOCGs.push(ref); }
    const dDict = (ocProperties as PDFDict).get(PDFName.of('D'));
    if (dDict instanceof PDFDict) {
      const order = dDict.get(PDFName.of('Order'));
      if (order instanceof PDFArray) { for (const ref of ocgRefs) order.push(ref); }
      const on = dDict.get(PDFName.of('ON'));
      if (on instanceof PDFArray) { for (const ref of ocgRefs) on.push(ref); }
    }
  }

  return addedLabels;
}
