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
// maxDistance: custom match threshold (lower = stricter, higher = wider matching)
const COLOR_PALETTE: Array<{ name: string; rgb: { r: number; g: number; b: number }; hex: string; isNeutral: boolean; maxDistance?: number }> = [
  // Reds
  { name: 'Red', rgb: { r: 200, g: 30, b: 30 }, hex: '#C81E1E', isNeutral: false },
  { name: 'Dark Red', rgb: { r: 139, g: 0, b: 0 }, hex: '#8B0000', isNeutral: false },
  { name: 'Crimson', rgb: { r: 220, g: 20, b: 60 }, hex: '#DC143C', isNeutral: false },
  { name: 'Scarlet', rgb: { r: 255, g: 36, b: 0 }, hex: '#FF2400', isNeutral: false },
  { name: 'Maroon', rgb: { r: 128, g: 0, b: 0 }, hex: '#800000', isNeutral: false },
  
  // Greens - WIDER matching (maxDistance: 55) to catch various green shades
  { name: 'Green', rgb: { r: 50, g: 180, b: 80 }, hex: '#32B450', isNeutral: false, maxDistance: 55 },
  { name: 'Dark Green', rgb: { r: 0, g: 100, b: 0 }, hex: '#006400', isNeutral: false, maxDistance: 55 },
  { name: 'Lime', rgb: { r: 50, g: 205, b: 50 }, hex: '#32CD32', isNeutral: false, maxDistance: 55 },
  { name: 'Forest', rgb: { r: 34, g: 139, b: 34 }, hex: '#228B22', isNeutral: false, maxDistance: 55 },
  { name: 'Olive', rgb: { r: 128, g: 128, b: 0 }, hex: '#808000', isNeutral: false, maxDistance: 55 },
  { name: 'Mint', rgb: { r: 152, g: 255, b: 152 }, hex: '#98FF98', isNeutral: false, maxDistance: 55 },
  { name: 'Sage', rgb: { r: 130, g: 160, b: 120 }, hex: '#82A078', isNeutral: false, maxDistance: 55 },
  { name: 'Kelly Green', rgb: { r: 76, g: 187, b: 23 }, hex: '#4CBB17', isNeutral: false, maxDistance: 55 },
  
  // Blues - WIDER matching (maxDistance: 55) to catch various blue shades
  { name: 'Blue', rgb: { r: 40, g: 100, b: 220 }, hex: '#2864DC', isNeutral: false, maxDistance: 55 },
  { name: 'Navy', rgb: { r: 0, g: 0, b: 128 }, hex: '#000080', isNeutral: false, maxDistance: 55 },
  { name: 'Royal Blue', rgb: { r: 65, g: 105, b: 225 }, hex: '#4169E1', isNeutral: false, maxDistance: 55 },
  { name: 'Cobalt', rgb: { r: 0, g: 71, b: 171 }, hex: '#0047AB', isNeutral: false, maxDistance: 55 },
  { name: 'Sky Blue', rgb: { r: 135, g: 206, b: 235 }, hex: '#87CEEB', isNeutral: false, maxDistance: 55 },
  { name: 'Light Blue', rgb: { r: 173, g: 216, b: 230 }, hex: '#ADD8E6', isNeutral: false, maxDistance: 55 },
  { name: 'Steel Blue', rgb: { r: 70, g: 130, b: 180 }, hex: '#4682B4', isNeutral: false, maxDistance: 55 },
  { name: 'Dark Blue', rgb: { r: 0, g: 0, b: 80 }, hex: '#000050', isNeutral: false, maxDistance: 55 },
  
  // Other primary/secondary
  { name: 'Yellow', rgb: { r: 250, g: 210, b: 50 }, hex: '#FAD232', isNeutral: false },
  { name: 'Orange', rgb: { r: 240, g: 120, b: 20 }, hex: '#F07814', isNeutral: false },
  
  // Purples and Lavenders - VERY STRICT matching (maxDistance: 25) for bright purples
  // Dark purples use wider threshold (35) to avoid merging with black
  { name: 'Purple', rgb: { r: 140, g: 60, b: 180 }, hex: '#8C3CB4', isNeutral: false, maxDistance: 25 },
  { name: 'Lavender', rgb: { r: 230, g: 190, b: 230 }, hex: '#E6BEE6', isNeutral: false, maxDistance: 25 },
  { name: 'Violet', rgb: { r: 148, g: 0, b: 211 }, hex: '#9400D3', isNeutral: false, maxDistance: 25 },
  { name: 'Light Purple', rgb: { r: 177, g: 156, b: 217 }, hex: '#B19CD9', isNeutral: false, maxDistance: 25 },
  { name: 'Plum', rgb: { r: 142, g: 69, b: 133 }, hex: '#8E4585', isNeutral: false, maxDistance: 25 },
  // Dark purples - wider threshold to catch dark purple shades before they match black
  { name: 'Dark Purple', rgb: { r: 48, g: 25, b: 52 }, hex: '#301934', isNeutral: false, maxDistance: 35 },
  { name: 'Eggplant', rgb: { r: 65, g: 30, b: 70 }, hex: '#411E46', isNeutral: false, maxDistance: 35 },
  { name: 'Deep Purple', rgb: { r: 75, g: 0, b: 110 }, hex: '#4B006E', isNeutral: false, maxDistance: 35 },
  
  // Golds - WIDER matching (maxDistance: 60) to catch gold-like colors
  { name: 'Gold', rgb: { r: 255, g: 215, b: 0 }, hex: '#FFD700', isNeutral: false, maxDistance: 60 },
  { name: 'Dark Gold', rgb: { r: 184, g: 134, b: 11 }, hex: '#B8860B', isNeutral: false, maxDistance: 60 },
  { name: 'Light Gold', rgb: { r: 250, g: 250, b: 210 }, hex: '#FAFAD2', isNeutral: false, maxDistance: 60 },
  
  // Tertiary colors
  // Magentas and Pinks - WIDER matching (maxDistance: 55) to catch various shades
  { name: 'Magenta', rgb: { r: 255, g: 0, b: 255 }, hex: '#FF00FF', isNeutral: false, maxDistance: 55 },
  { name: 'Hot Pink', rgb: { r: 255, g: 105, b: 180 }, hex: '#FF69B4', isNeutral: false, maxDistance: 55 },
  { name: 'Deep Pink', rgb: { r: 255, g: 20, b: 147 }, hex: '#FF1493', isNeutral: false, maxDistance: 55 },
  { name: 'Fuchsia', rgb: { r: 255, g: 0, b: 128 }, hex: '#FF0080', isNeutral: false, maxDistance: 55 },
  { name: 'Pink', rgb: { r: 255, g: 150, b: 180 }, hex: '#FF96B4', isNeutral: false, maxDistance: 55 },
  { name: 'Rose', rgb: { r: 255, g: 0, b: 127 }, hex: '#FF007F', isNeutral: false, maxDistance: 55 },
  // Teal/Cyan - WIDER matching (maxDistance: 60) to catch various teal shades
  { name: 'Teal', rgb: { r: 30, g: 150, b: 150 }, hex: '#1E9696', isNeutral: false, maxDistance: 60 },
  { name: 'Cyan', rgb: { r: 0, g: 200, b: 200 }, hex: '#00C8C8', isNeutral: false, maxDistance: 60 },
  { name: 'Aqua', rgb: { r: 0, g: 255, b: 255 }, hex: '#00FFFF', isNeutral: false, maxDistance: 60 },
  { name: 'Turquoise', rgb: { r: 64, g: 224, b: 208 }, hex: '#40E0D0', isNeutral: false, maxDistance: 60 },
  { name: 'Dark Teal', rgb: { r: 0, g: 100, b: 100 }, hex: '#006464', isNeutral: false, maxDistance: 60 },
  { name: 'Brown', rgb: { r: 140, g: 80, b: 40 }, hex: '#8C5028', isNeutral: false },
  
  // Skin Tones (for character illustrations like Disney)
  { name: 'Light Skin', rgb: { r: 255, g: 224, b: 189 }, hex: '#FFE0BD', isNeutral: false },
  { name: 'Medium Skin', rgb: { r: 234, g: 192, b: 134 }, hex: '#EAC086', isNeutral: false },
  { name: 'Tan Skin', rgb: { r: 198, g: 134, b: 66 }, hex: '#C68642', isNeutral: false },
  { name: 'Dark Skin', rgb: { r: 141, g: 85, b: 36 }, hex: '#8D5524', isNeutral: false },
  
  // Olive variations (additional to existing Olive in greens)
  { name: 'Dark Olive', rgb: { r: 85, g: 85, b: 0 }, hex: '#555500', isNeutral: false },
  { name: 'Light Olive', rgb: { r: 170, g: 170, b: 85 }, hex: '#AAAA55', isNeutral: false },
  { name: 'Olive Drab', rgb: { r: 107, g: 142, b: 35 }, hex: '#6B8E23', isNeutral: false },
  
  // Minimal neutrals (grouped)
  { name: 'Black', rgb: { r: 30, g: 30, b: 30 }, hex: '#1E1E1E', isNeutral: true },
  { name: 'Gray', rgb: { r: 128, g: 128, b: 128 }, hex: '#808080', isNeutral: true },
  // White - WIDER matching (maxDistance: 70) to include super light cream colors
  { name: 'White', rgb: { r: 245, g: 245, b: 245 }, hex: '#F5F5F5', isNeutral: true, maxDistance: 70 },
];

// Default maximum distance to consider a color a valid match
// Colors can override this with their own maxDistance property
const DEFAULT_MAX_COLOR_DISTANCE = 45;

function findClosestPaletteColor(r: number, g: number, b: number): typeof COLOR_PALETTE[0] | null {
  let closest: typeof COLOR_PALETTE[0] | null = null;
  let minDistance = Infinity;
  
  for (const paletteColor of COLOR_PALETTE) {
    const dist = colorDistance({ r, g, b }, paletteColor.rgb);
    // Use per-color maxDistance if defined, otherwise use default
    const maxDist = paletteColor.maxDistance ?? DEFAULT_MAX_COLOR_DISTANCE;
    
    // Only consider this color if within its distance threshold
    if (dist < minDistance && dist <= maxDist) {
      minDistance = dist;
      closest = paletteColor;
    }
  }
  
  return closest;
}

export function extractDominantColors(
  imageData: ImageData,
  maxColors: number = 9,
  minPercentage: number = 0.5
): ExtractedColor[] {
  // Track actual RGB totals for each palette color to compute average
  const paletteCounts = new Map<string, { 
    color: typeof COLOR_PALETTE[0]; 
    count: number;
    totalR: number;
    totalG: number;
    totalB: number;
  }>();
  const data = imageData.data;
  let totalOpaquePixels = 0;

  // Initialize all palette colors
  for (const paletteColor of COLOR_PALETTE) {
    paletteCounts.set(paletteColor.name, { 
      color: paletteColor, 
      count: 0,
      totalR: 0,
      totalG: 0,
      totalB: 0
    });
  }

  // Count pixels matching each palette color
  // Only count fully opaque pixels (alpha >= 220) to get accurate spot colors
  // Semi-transparent pixels (anti-aliasing, edges, artifacts) can produce false color matches
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Only count nearly-opaque pixels for spot color detection
    // This filters out ALL semi-transparent artifacts, edges, and anti-aliasing
    if (a < 220) continue;

    const closestColor = findClosestPaletteColor(r, g, b);
    // Skip if color doesn't match any palette color closely enough
    if (!closestColor) continue;
    
    totalOpaquePixels++;
    const entry = paletteCounts.get(closestColor.name)!;
    entry.count++;
    // Track actual pixel colors to compute average
    entry.totalR += r;
    entry.totalG += g;
    entry.totalB += b;
  }

  if (totalOpaquePixels === 0) return [];

  // Convert to ExtractedColor array using ACTUAL average colors from image
  const allColors: Array<ExtractedColor & { isNeutral: boolean }> = Array.from(paletteCounts.values())
    .filter(entry => entry.count > 0)
    .map(entry => {
      // Compute actual average color from matched pixels
      const avgR = Math.round(entry.totalR / entry.count);
      const avgG = Math.round(entry.totalG / entry.count);
      const avgB = Math.round(entry.totalB / entry.count);
      
      return {
        rgb: { r: avgR, g: avgG, b: avgB },
        hex: rgbToHex(avgR, avgG, avgB),
        count: entry.count,
        percentage: (entry.count / totalOpaquePixels) * 100,
        spotWhite: false,
        spotGloss: false,
        name: entry.color.name,
        isNeutral: entry.color.isNeutral
      };
    })
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
