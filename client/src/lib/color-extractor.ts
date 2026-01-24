export interface ExtractedColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
  count: number;
  percentage: number;
  spotWhite: boolean;
  spotGloss: boolean;
  name?: string;
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

// Predefined palette of primary, secondary, and neutral colors
// Chromatic colors first (priority), then minimal neutrals
const COLOR_PALETTE: Array<{ name: string; rgb: { r: number; g: number; b: number }; hex: string; isNeutral: boolean }> = [
  // Primary colors
  { name: 'Red', rgb: { r: 200, g: 30, b: 30 }, hex: '#C81E1E', isNeutral: false },
  { name: 'Yellow', rgb: { r: 250, g: 210, b: 50 }, hex: '#FAD232', isNeutral: false },
  { name: 'Blue', rgb: { r: 40, g: 100, b: 220 }, hex: '#2864DC', isNeutral: false },
  
  // Secondary colors
  { name: 'Orange', rgb: { r: 240, g: 120, b: 20 }, hex: '#F07814', isNeutral: false },
  { name: 'Green', rgb: { r: 50, g: 180, b: 80 }, hex: '#32B450', isNeutral: false },
  { name: 'Purple', rgb: { r: 140, g: 60, b: 180 }, hex: '#8C3CB4', isNeutral: false },
  
  // Tertiary colors
  { name: 'Cyan', rgb: { r: 40, g: 190, b: 220 }, hex: '#28BEDC', isNeutral: false },
  { name: 'Magenta', rgb: { r: 220, g: 50, b: 150 }, hex: '#DC3296', isNeutral: false },
  { name: 'Pink', rgb: { r: 255, g: 150, b: 180 }, hex: '#FF96B4', isNeutral: false },
  { name: 'Teal', rgb: { r: 30, g: 150, b: 150 }, hex: '#1E9696', isNeutral: false },
  { name: 'Brown', rgb: { r: 140, g: 80, b: 40 }, hex: '#8C5028', isNeutral: false },
  
  // Minimal neutrals (grouped)
  { name: 'Black', rgb: { r: 30, g: 30, b: 30 }, hex: '#1E1E1E', isNeutral: true },
  { name: 'Gray', rgb: { r: 128, g: 128, b: 128 }, hex: '#808080', isNeutral: true },
  { name: 'White', rgb: { r: 245, g: 245, b: 245 }, hex: '#F5F5F5', isNeutral: true },
];

function findClosestPaletteColor(r: number, g: number, b: number): typeof COLOR_PALETTE[0] {
  let closest = COLOR_PALETTE[0];
  let minDistance = Infinity;
  
  for (const paletteColor of COLOR_PALETTE) {
    const dist = colorDistance({ r, g, b }, paletteColor.rgb);
    if (dist < minDistance) {
      minDistance = dist;
      closest = paletteColor;
    }
  }
  
  return closest;
}

export function extractDominantColors(
  imageData: ImageData,
  maxColors: number = 9,
  minPercentage: number = 0.1
): ExtractedColor[] {
  const paletteCounts = new Map<string, { color: typeof COLOR_PALETTE[0]; count: number }>();
  const data = imageData.data;
  let totalOpaquePixels = 0;

  // Initialize all palette colors
  for (const paletteColor of COLOR_PALETTE) {
    paletteCounts.set(paletteColor.name, { color: paletteColor, count: 0 });
  }

  // Count pixels matching each palette color
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 50) continue;
    totalOpaquePixels++;

    const closestColor = findClosestPaletteColor(r, g, b);
    const entry = paletteCounts.get(closestColor.name)!;
    entry.count++;
  }

  if (totalOpaquePixels === 0) return [];

  // Convert to ExtractedColor array
  const allColors: Array<ExtractedColor & { isNeutral: boolean }> = Array.from(paletteCounts.values())
    .filter(entry => entry.count > 0)
    .map(entry => ({
      rgb: entry.color.rgb,
      hex: entry.color.hex,
      count: entry.count,
      percentage: (entry.count / totalOpaquePixels) * 100,
      spotWhite: false,
      spotGloss: false,
      name: entry.color.name,
      isNeutral: entry.color.isNeutral
    }))
    .filter(c => c.percentage >= minPercentage);

  // Sort: chromatic colors first (by percentage), then neutrals (by percentage)
  const chromaticColors = allColors.filter(c => !c.isNeutral).sort((a, b) => b.percentage - a.percentage);
  const neutralColors = allColors.filter(c => c.isNeutral).sort((a, b) => b.percentage - a.percentage);
  
  // Combine: all chromatic first, then neutrals
  const sortedColors = [...chromaticColors, ...neutralColors];

  return sortedColors.slice(0, maxColors).map(({ isNeutral, ...color }) => color);
}

export function extractColorsFromCanvas(canvas: HTMLCanvasElement, maxColors: number = 9): ExtractedColor[] {
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

export function extractColorsFromImage(image: HTMLImageElement, maxColors: number = 9): ExtractedColor[] {
  if (!image.complete || image.width === 0 || image.height === 0) return [];
  
  // Use full image resolution for better color detection
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return [];
  
  tempCtx.drawImage(image, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  
  const colors = extractDominantColors(imageData, maxColors);
  console.log('[ColorExtractor] Detected colors:', colors.map(c => ({ name: c.name, hex: c.hex, pct: c.percentage.toFixed(2) })));
  return colors;
}
