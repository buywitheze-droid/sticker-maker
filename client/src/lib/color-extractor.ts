export interface ExtractedColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
  count: number;
  percentage: number;
  spotWhite: boolean;
  spotGloss: boolean;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function colorDistance(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

function quantizeColor(r: number, g: number, b: number, levels: number = 32): string {
  const step = 256 / levels;
  const qr = Math.floor(r / step) * step;
  const qg = Math.floor(g / step) * step;
  const qb = Math.floor(b / step) * step;
  return `${qr},${qg},${qb}`;
}

export function extractDominantColors(
  imageData: ImageData,
  maxColors: number = 6,
  minPercentage: number = 1
): ExtractedColor[] {
  const colorCounts = new Map<string, { r: number; g: number; b: number; count: number }>();
  const data = imageData.data;
  let totalOpaquePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue;
    totalOpaquePixels++;

    const key = quantizeColor(r, g, b);
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
      existing.r = Math.round((existing.r * (existing.count - 1) + r) / existing.count);
      existing.g = Math.round((existing.g * (existing.count - 1) + g) / existing.count);
      existing.b = Math.round((existing.b * (existing.count - 1) + b) / existing.count);
    } else {
      colorCounts.set(key, { r, g, b, count: 1 });
    }
  }

  if (totalOpaquePixels === 0) return [];

  let colors = Array.from(colorCounts.values())
    .map(c => ({
      rgb: { r: c.r, g: c.g, b: c.b },
      hex: rgbToHex(c.r, c.g, c.b),
      count: c.count,
      percentage: (c.count / totalOpaquePixels) * 100,
      spotWhite: false,
      spotGloss: false
    }))
    .filter(c => c.percentage >= minPercentage)
    .sort((a, b) => b.count - a.count);

  const mergedColors: ExtractedColor[] = [];
  const mergeThreshold = 40;

  for (const color of colors) {
    let merged = false;
    for (const existing of mergedColors) {
      if (colorDistance(color.rgb, existing.rgb) < mergeThreshold) {
        existing.count += color.count;
        existing.percentage += color.percentage;
        merged = true;
        break;
      }
    }
    if (!merged && mergedColors.length < maxColors) {
      mergedColors.push(color);
    }
  }

  return mergedColors.slice(0, maxColors).sort((a, b) => b.percentage - a.percentage);
}

export function extractColorsFromCanvas(canvas: HTMLCanvasElement, maxColors: number = 6): ExtractedColor[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  
  const sampleSize = Math.min(canvas.width, canvas.height, 300);
  const scaleX = sampleSize / canvas.width;
  const scaleY = sampleSize / canvas.height;
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = Math.max(1, Math.floor(canvas.width * scaleX));
  tempCanvas.height = Math.max(1, Math.floor(canvas.height * scaleY));
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCtx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  
  return extractDominantColors(imageData, maxColors);
}
