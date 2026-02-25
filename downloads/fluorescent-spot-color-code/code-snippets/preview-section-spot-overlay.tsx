// FROM: client/src/components/preview-section.tsx (lines ~1630-1780)
// This contains the spot color preview overlay system:
// 1. Pulse animation effect for assigned spot colors
// 2. createSpotOverlayCanvas() - pixel-level color matching and overlay rendering
// 3. Integration into the main render pipeline

// ============================================================
// REFS needed (declared at component level)
// ============================================================
// const spotPulseRef = useRef(1);
// const spotAnimFrameRef = useRef<number | null>(null);
// const spotOverlayCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

// ============================================================
// SPOT PREVIEW PULSE ANIMATION
// Runs when spotPreviewData has assigned colors, creates a gentle pulsing glow
// ============================================================
/*
useEffect(() => {
  if (!spotPreviewData?.enabled) {
    spotPulseRef.current = 1;
    if (spotAnimFrameRef.current !== null) {
      cancelAnimationFrame(spotAnimFrameRef.current);
      spotAnimFrameRef.current = null;
    }
    return;
  }
  
  const whiteColors = spotPreviewData.colors.filter(c => c.spotWhite);
  const glossColors = spotPreviewData.colors.filter(c => c.spotGloss);
  const fluorYColors = spotPreviewData.colors.filter(c => c.spotFluorY);
  const fluorMColors = spotPreviewData.colors.filter(c => c.spotFluorM);
  const fluorGColors = spotPreviewData.colors.filter(c => c.spotFluorG);
  const fluorOrangeColors = spotPreviewData.colors.filter(c => c.spotFluorOrange);
  
  if (whiteColors.length === 0 && glossColors.length === 0 && fluorYColors.length === 0 && fluorMColors.length === 0 && fluorGColors.length === 0 && fluorOrangeColors.length === 0) {
    spotPulseRef.current = 1;
    if (spotAnimFrameRef.current !== null) {
      cancelAnimationFrame(spotAnimFrameRef.current);
      spotAnimFrameRef.current = null;
    }
    return;
  }
  
  let startTime: number | null = null;
  let lastFrameTime = 0;
  const FRAME_INTERVAL = 1000 / 30; // 30fps
  
  const animate = (timestamp: number) => {
    if (startTime === null) startTime = timestamp;
    
    if (timestamp - lastFrameTime >= FRAME_INTERVAL) {
      lastFrameTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;
      spotPulseRef.current = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 1.5));
      
      if (renderRef.current) {
        renderRef.current();
      }
    }
    
    spotAnimFrameRef.current = requestAnimationFrame(animate);
  };
  
  spotAnimFrameRef.current = requestAnimationFrame(animate);
  
  return () => {
    if (spotAnimFrameRef.current !== null) {
      cancelAnimationFrame(spotAnimFrameRef.current);
      spotAnimFrameRef.current = null;
    }
    spotPulseRef.current = 1;
  };
}, [spotPreviewData]);
*/

// ============================================================
// CREATE SPOT OVERLAY CANVAS
// Pixel-level color matching: for each pixel in the image, checks if it matches
// any assigned spot color (within tolerance), then paints the overlay pixel with
// the corresponding fluorescent color.
//
// Fluorescent overlay colors:
//   Yellow:  RGB(223, 255, 0)   - #DFFF00
//   Magenta: RGB(255, 0, 255)   - #FF00FF
//   Green:   RGB(57, 255, 20)   - #39FF14
//   Orange:  RGB(255, 102, 0)   - #FF6600
//   White:   RGB(255, 255, 255) - #FFFFFF
//   Gloss:   RGB(180, 180, 190) - semi-metallic
//
// The overlay canvas is cached by a composite key to avoid recomputation.
// ============================================================
/*
const createSpotOverlayCanvas = (source?: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement | null => {
  if (!imageInfo || !spotPreviewData?.enabled) return null;
  
  const whiteColors = spotPreviewData.colors.filter(c => c.spotWhite);
  const glossColors = spotPreviewData.colors.filter(c => c.spotGloss);
  const fluorYColors = spotPreviewData.colors.filter(c => c.spotFluorY);
  const fluorMColors = spotPreviewData.colors.filter(c => c.spotFluorM);
  const fluorGColors = spotPreviewData.colors.filter(c => c.spotFluorG);
  const fluorOrangeColors = spotPreviewData.colors.filter(c => c.spotFluorOrange);
  
  const hasAny = whiteColors.length > 0 || glossColors.length > 0 || fluorYColors.length > 0 || fluorMColors.length > 0 || fluorGColors.length > 0 || fluorOrangeColors.length > 0;
  if (!hasAny) return null;
  
  const img = source || imageInfo.image;
  const imgIdentity = (img as HTMLImageElement).src || `${img.width}x${img.height}`;
  const cacheKey = `${imgIdentity}-${img.width}x${img.height}-w:${whiteColors.map(c => c.hex).join(',')}-g:${glossColors.map(c => c.hex).join(',')}-fy:${fluorYColors.map(c => c.hex).join(',')}-fm:${fluorMColors.map(c => c.hex).join(',')}-fg:${fluorGColors.map(c => c.hex).join(',')}-fo:${fluorOrangeColors.map(c => c.hex).join(',')}`;
  
  if (spotOverlayCacheRef.current?.key === cacheKey) {
    return spotOverlayCacheRef.current.canvas;
  }
  
  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return null;
  
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = srcCanvas.width;
  overlayCanvas.height = srcCanvas.height;
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) return null;
  
  const overlayData = overlayCtx.createImageData(srcCanvas.width, srcCanvas.height);
  
  const parseColors = (colors: typeof whiteColors) => colors.map(c => ({
    r: parseInt(c.hex.slice(1, 3), 16),
    g: parseInt(c.hex.slice(3, 5), 16),
    b: parseInt(c.hex.slice(5, 7), 16),
  }));
  
  const parsedWhite = parseColors(whiteColors);
  const parsedGloss = parseColors(glossColors);
  const parsedFluorY = parseColors(fluorYColors);
  const parsedFluorM = parseColors(fluorMColors);
  const parsedFluorG = parseColors(fluorGColors);
  const parsedFluorOrange = parseColors(fluorOrangeColors);
  
  const colorGroups: { parsed: typeof parsedWhite; overlayR: number; overlayG: number; overlayB: number }[] = [
    ...parsedWhite.length > 0 ? [{ parsed: parsedWhite, overlayR: 255, overlayG: 255, overlayB: 255 }] : [],
    ...parsedGloss.length > 0 ? [{ parsed: parsedGloss, overlayR: 180, overlayG: 180, overlayB: 190 }] : [],
    ...parsedFluorY.length > 0 ? [{ parsed: parsedFluorY, overlayR: 223, overlayG: 255, overlayB: 0 }] : [],
    ...parsedFluorM.length > 0 ? [{ parsed: parsedFluorM, overlayR: 255, overlayG: 0, overlayB: 255 }] : [],
    ...parsedFluorG.length > 0 ? [{ parsed: parsedFluorG, overlayR: 57, overlayG: 255, overlayB: 20 }] : [],
    ...parsedFluorOrange.length > 0 ? [{ parsed: parsedFluorOrange, overlayR: 255, overlayG: 102, overlayB: 0 }] : [],
  ];
  
  const tolerance = 30;
  const pixels = srcData.data;
  const out = overlayData.data;
  const len = pixels.length;
  
  for (let idx = 0; idx < len; idx += 4) {
    const a = pixels[idx + 3];
    if (a < 128) continue;
    
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    
    for (const group of colorGroups) {
      let matched = false;
      for (const t of group.parsed) {
        if (Math.abs(r - t.r) <= tolerance && Math.abs(g - t.g) <= tolerance && Math.abs(b - t.b) <= tolerance) {
          out[idx] = group.overlayR; out[idx + 1] = group.overlayG; out[idx + 2] = group.overlayB; out[idx + 3] = 255;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }
  
  overlayCtx.putImageData(overlayData, 0, 0);
  spotOverlayCacheRef.current = { key: cacheKey, canvas: overlayCanvas };
  return overlayCanvas;
};
*/

// ============================================================
// HOW THE OVERLAY IS DRAWN IN THE MAIN RENDER (inside drawSingleDesign or doRender)
// The overlay canvas is drawn on top of the design image with the pulsing opacity:
// ============================================================
// const overlayCanvas = createSpotOverlayCanvas(designImage);
// if (overlayCanvas) {
//   ctx.save();
//   ctx.globalAlpha = spotPulseRef.current * 0.7;
//   ctx.drawImage(overlayCanvas, drawX, drawY, drawWidth, drawHeight);
//   ctx.restore();
// }
