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
  // Reds - WIDER matching (maxDistance: 55) to catch various red shades
  { name: 'Red', rgb: { r: 220, g: 30, b: 30 }, hex: '#DC1E1E', isNeutral: false, maxDistance: 55 },
  { name: 'Dark Red', rgb: { r: 139, g: 0, b: 0 }, hex: '#8B0000', isNeutral: false, maxDistance: 55 },
  { name: 'Crimson', rgb: { r: 220, g: 20, b: 60 }, hex: '#DC143C', isNeutral: false, maxDistance: 55 },
  { name: 'Scarlet', rgb: { r: 255, g: 36, b: 0 }, hex: '#FF2400', isNeutral: false, maxDistance: 55 },
  { name: 'Maroon', rgb: { r: 128, g: 0, b: 0 }, hex: '#800000', isNeutral: false, maxDistance: 55 },
  { name: 'Cherry', rgb: { r: 222, g: 49, b: 99 }, hex: '#DE3163', isNeutral: false, maxDistance: 55 },
  { name: 'Coral Red', rgb: { r: 255, g: 64, b: 64 }, hex: '#FF4040', isNeutral: false, maxDistance: 55 },
  { name: 'Brick Red', rgb: { r: 203, g: 65, b: 84 }, hex: '#CB4154', isNeutral: false, maxDistance: 55 },
  
  // Greens - WIDER matching (maxDistance: 55) to catch various green shades
  { name: 'Green', rgb: { r: 50, g: 180, b: 80 }, hex: '#32B450', isNeutral: false, maxDistance: 55 },
  { name: 'Dark Green', rgb: { r: 0, g: 100, b: 0 }, hex: '#006400', isNeutral: false, maxDistance: 55 },
  { name: 'Lime', rgb: { r: 50, g: 205, b: 50 }, hex: '#32CD32', isNeutral: false, maxDistance: 55 },
  { name: 'Forest', rgb: { r: 34, g: 139, b: 34 }, hex: '#228B22', isNeutral: false, maxDistance: 55 },
  { name: 'Olive', rgb: { r: 128, g: 128, b: 0 }, hex: '#808000', isNeutral: false, maxDistance: 55 },
  { name: 'Mint', rgb: { r: 152, g: 255, b: 152 }, hex: '#98FF98', isNeutral: false, maxDistance: 55 },
  { name: 'Sage', rgb: { r: 130, g: 160, b: 120 }, hex: '#82A078', isNeutral: false, maxDistance: 55 },
  { name: 'Kelly Green', rgb: { r: 76, g: 187, b: 23 }, hex: '#4CBB17', isNeutral: false, maxDistance: 55 },
  
  // Blues - VERY WIDE matching (maxDistance: 65) to catch various blue shades
  { name: 'Blue', rgb: { r: 40, g: 100, b: 220 }, hex: '#2864DC', isNeutral: false, maxDistance: 65 },
  { name: 'Electric Blue', rgb: { r: 42, g: 0, b: 239 }, hex: '#2A00EF', isNeutral: false, maxDistance: 65 },
  { name: 'Ultramarine', rgb: { r: 63, g: 0, b: 255 }, hex: '#3F00FF', isNeutral: false, maxDistance: 65 },
  { name: 'Indigo', rgb: { r: 75, g: 0, b: 130 }, hex: '#4B0082', isNeutral: false, maxDistance: 65 },
  { name: 'Navy', rgb: { r: 0, g: 0, b: 128 }, hex: '#000080', isNeutral: false, maxDistance: 65 },
  { name: 'Royal Blue', rgb: { r: 65, g: 105, b: 225 }, hex: '#4169E1', isNeutral: false, maxDistance: 65 },
  { name: 'Cobalt', rgb: { r: 0, g: 71, b: 171 }, hex: '#0047AB', isNeutral: false, maxDistance: 65 },
  { name: 'Sky Blue', rgb: { r: 135, g: 206, b: 235 }, hex: '#87CEEB', isNeutral: false, maxDistance: 65 },
  { name: 'Light Blue', rgb: { r: 173, g: 216, b: 230 }, hex: '#ADD8E6', isNeutral: false, maxDistance: 65 },
  { name: 'Steel Blue', rgb: { r: 70, g: 130, b: 180 }, hex: '#4682B4', isNeutral: false, maxDistance: 65 },
  { name: 'Dark Blue', rgb: { r: 0, g: 0, b: 80 }, hex: '#000050', isNeutral: false, maxDistance: 65 },
  { name: 'Powder Blue', rgb: { r: 176, g: 224, b: 230 }, hex: '#B0E0E6', isNeutral: false, maxDistance: 65 },
  { name: 'Cerulean', rgb: { r: 0, g: 123, b: 167 }, hex: '#007BA7', isNeutral: false, maxDistance: 65 },
  { name: 'Azure', rgb: { r: 0, g: 127, b: 255 }, hex: '#007FFF', isNeutral: false, maxDistance: 65 },
  { name: 'Sapphire', rgb: { r: 15, g: 82, b: 186 }, hex: '#0F52BA', isNeutral: false, maxDistance: 65 },
  { name: 'Cornflower', rgb: { r: 100, g: 149, b: 237 }, hex: '#6495ED', isNeutral: false, maxDistance: 65 },
  { name: 'Periwinkle', rgb: { r: 204, g: 204, b: 255 }, hex: '#CCCCFF', isNeutral: false, maxDistance: 65 },
  
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
  // Magentas and Pinks - VERY WIDE matching (maxDistance: 65) to catch all shades
  { name: 'Magenta', rgb: { r: 255, g: 0, b: 255 }, hex: '#FF00FF', isNeutral: false, maxDistance: 65 },
  { name: 'Hot Pink', rgb: { r: 255, g: 105, b: 180 }, hex: '#FF69B4', isNeutral: false, maxDistance: 65 },
  { name: 'Deep Pink', rgb: { r: 255, g: 20, b: 147 }, hex: '#FF1493', isNeutral: false, maxDistance: 65 },
  { name: 'Fuchsia', rgb: { r: 255, g: 0, b: 128 }, hex: '#FF0080', isNeutral: false, maxDistance: 65 },
  { name: 'Pink', rgb: { r: 255, g: 182, b: 193 }, hex: '#FFB6C1', isNeutral: false, maxDistance: 65 },
  { name: 'Rose', rgb: { r: 255, g: 0, b: 127 }, hex: '#FF007F', isNeutral: false, maxDistance: 65 },
  { name: 'Salmon', rgb: { r: 250, g: 128, b: 114 }, hex: '#FA8072', isNeutral: false, maxDistance: 65 },
  { name: 'Coral', rgb: { r: 255, g: 127, b: 80 }, hex: '#FF7F50', isNeutral: false, maxDistance: 65 },
  { name: 'Light Pink', rgb: { r: 255, g: 182, b: 193 }, hex: '#FFB6C1', isNeutral: false, maxDistance: 65 },
  { name: 'Blush', rgb: { r: 222, g: 93, b: 131 }, hex: '#DE5D83', isNeutral: false, maxDistance: 65 },
  { name: 'Raspberry', rgb: { r: 227, g: 11, b: 92 }, hex: '#E30B5C', isNeutral: false, maxDistance: 65 },
  { name: 'Cerise', rgb: { r: 222, g: 49, b: 99 }, hex: '#DE3163', isNeutral: false, maxDistance: 65 },
  { name: 'Ruby', rgb: { r: 224, g: 17, b: 95 }, hex: '#E0115F', isNeutral: false, maxDistance: 65 },
  { name: 'Orchid', rgb: { r: 218, g: 112, b: 214 }, hex: '#DA70D6', isNeutral: false, maxDistance: 65 },
  { name: 'Pale Pink', rgb: { r: 250, g: 218, b: 221 }, hex: '#FADADD', isNeutral: false, maxDistance: 65 },
  // Teal/Cyan - VERY WIDE matching (maxDistance: 80) to merge similar cyan shades
  { name: 'Cyan', rgb: { r: 35, g: 190, b: 230 }, hex: '#23BEE6', isNeutral: false, maxDistance: 80 },
  { name: 'Teal', rgb: { r: 60, g: 128, b: 140 }, hex: '#3C808C', isNeutral: false, maxDistance: 80 },
  { name: 'Aqua', rgb: { r: 0, g: 255, b: 255 }, hex: '#00FFFF', isNeutral: false, maxDistance: 80 },
  { name: 'Turquoise', rgb: { r: 64, g: 224, b: 208 }, hex: '#40E0D0', isNeutral: false, maxDistance: 80 },
  { name: 'Dark Teal', rgb: { r: 0, g: 100, b: 100 }, hex: '#006464', isNeutral: false, maxDistance: 80 },
  { name: 'Ocean Blue', rgb: { r: 0, g: 119, b: 190 }, hex: '#0077BE', isNeutral: false, maxDistance: 80 },
  { name: 'Seafoam', rgb: { r: 159, g: 226, b: 191 }, hex: '#9FE2BF', isNeutral: false, maxDistance: 80 },
  { name: 'Robin Egg', rgb: { r: 0, g: 204, b: 204 }, hex: '#00CCCC', isNeutral: false, maxDistance: 80 },
  { name: 'Peacock', rgb: { r: 51, g: 161, b: 201 }, hex: '#33A1C9', isNeutral: false, maxDistance: 80 },
  { name: 'Cadet Blue', rgb: { r: 95, g: 158, b: 160 }, hex: '#5F9EA0', isNeutral: false, maxDistance: 80 },
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
  
  // Minimal neutrals (grouped into 2 black levels + 3 gray levels with wide matching)
  { name: 'Dark Black', rgb: { r: 10, g: 10, b: 10 }, hex: '#0A0A0A', isNeutral: true, maxDistance: 25 },
  { name: 'Light Black', rgb: { r: 40, g: 40, b: 40 }, hex: '#282828', isNeutral: true, maxDistance: 25 },
  { name: 'Dark Gray', rgb: { r: 64, g: 64, b: 64 }, hex: '#404040', isNeutral: true, maxDistance: 40 },
  { name: 'Medium Gray', rgb: { r: 128, g: 128, b: 128 }, hex: '#808080', isNeutral: true, maxDistance: 40 },
  { name: 'Light Gray', rgb: { r: 192, g: 192, b: 192 }, hex: '#C0C0C0', isNeutral: true, maxDistance: 40 },
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

// Detect background color by sampling image corners and edges
function detectBackgroundColor(imageData: ImageData): { r: number; g: number; b: number } | null {
  const { width, height, data } = imageData;
  const sampleSize = Math.min(10, Math.floor(Math.min(width, height) / 10));
  const edgeSamples: Array<{ r: number; g: number; b: number }> = [];
  
  // Sample from all 4 corners
  const cornerPositions = [
    { startX: 0, startY: 0 },
    { startX: width - sampleSize, startY: 0 },
    { startX: 0, startY: height - sampleSize },
    { startX: width - sampleSize, startY: height - sampleSize }
  ];
  
  for (const corner of cornerPositions) {
    for (let dy = 0; dy < sampleSize; dy++) {
      for (let dx = 0; dx < sampleSize; dx++) {
        const x = corner.startX + dx;
        const y = corner.startY + dy;
        const i = (y * width + x) * 4;
        if (data[i + 3] >= 250) {
          edgeSamples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        }
      }
    }
  }
  
  // If corners are mostly transparent, sample along all 4 edges
  if (edgeSamples.length < 20) {
    // Sample top and bottom edges
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 50))) {
      for (const y of [0, 1, 2, height - 3, height - 2, height - 1]) {
        if (y >= 0 && y < height) {
          const i = (y * width + x) * 4;
          if (data[i + 3] >= 250) {
            edgeSamples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
          }
        }
      }
    }
    // Sample left and right edges
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 50))) {
      for (const x of [0, 1, 2, width - 3, width - 2, width - 1]) {
        if (x >= 0 && x < width) {
          const i = (y * width + x) * 4;
          if (data[i + 3] >= 250) {
            edgeSamples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
          }
        }
      }
    }
  }
  
  console.log(`[ColorExtractor] Edge samples collected: ${edgeSamples.length}`);
  
  if (edgeSamples.length < 20) return null; // Not enough edge samples
  
  // Find the most common color among edge/corner pixels
  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const c of edgeSamples) {
    // Quantize to reduce noise (group similar colors)
    const qr = Math.round(c.r / 16) * 16;
    const qg = Math.round(c.g / 16) * 16;
    const qb = Math.round(c.b / 16) * 16;
    const key = `${qr},${qg},${qb}`;
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
      existing.r = (existing.r * (existing.count - 1) + c.r) / existing.count;
      existing.g = (existing.g * (existing.count - 1) + c.g) / existing.count;
      existing.b = (existing.b * (existing.count - 1) + c.b) / existing.count;
    } else {
      colorCounts.set(key, { count: 1, r: c.r, g: c.g, b: c.b });
    }
  }
  
  // Find the dominant corner color
  const entries = Array.from(colorCounts.values());
  const bestEntry = entries.reduce<{ count: number; r: number; g: number; b: number } | null>(
    (best, entry) => (!best || entry.count > best.count) ? entry : best,
    null
  );
  
  // Only consider it a background if it's in at least 50% of edge samples
  if (bestEntry && bestEntry.count >= edgeSamples.length * 0.5) {
    const bgColor = { r: Math.round(bestEntry.r), g: Math.round(bestEntry.g), b: Math.round(bestEntry.b) };
    console.log(`[ColorExtractor] Detected background color: rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`);
    return bgColor;
  }
  
  return null;
}

export function extractDominantColors(
  imageData: ImageData,
  maxColors: number = 18,
  minPercentage: number = 0.5
): ExtractedColor[] {
  // Detect background color from corners
  const bgColor = detectBackgroundColor(imageData);
  const bgColorTolerance = 30; // Distance threshold to consider a pixel as background
  
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
  // Only count fully opaque pixels (alpha >= 250) to get accurate spot colors
  // Semi-transparent pixels (anti-aliasing, edges, artifacts) can produce false color matches
  // Using 250 instead of 220 to be stricter and avoid picking up background artifacts
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Only count truly opaque pixels for spot color detection
    // This filters out ALL semi-transparent artifacts, edges, anti-aliasing, and background noise
    if (a < 250) continue;
    
    // Skip pixels that match the detected background color
    if (bgColor) {
      const bgDist = Math.sqrt(
        (r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2
      );
      if (bgDist <= bgColorTolerance) continue;
    }

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

  // Sort all colors by percentage (highest first) - include neutrals like black/gray/white
  const sortedColors = allColors.sort((a, b) => b.percentage - a.percentage);

  return sortedColors.slice(0, maxColors).map(({ isNeutral, ...color }) => color);
}

export function extractColorsFromCanvas(canvas: HTMLCanvasElement, maxColors: number = 18): ExtractedColor[] {
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

export function extractColorsFromImage(image: HTMLImageElement, maxColors: number = 18): ExtractedColor[] {
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
