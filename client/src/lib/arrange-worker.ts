type SkylineSeg = { x: number; y: number; w: number };
type PackItem = { id: string; w: number; h: number; rotation: number; gap: number };
type PlacedItem = { id: string; nx: number; ny: number; rotation: number; overflows: boolean };
type Candidate = { result: PlacedItem[]; maxHeight: number; wastedArea: number; overflows: number };

interface ArrangeInput {
  type: 'arrange';
  requestId: number;
  items: Array<{ id: string; w: number; h: number; fill: number }>;
  usableW: number;
  usableH: number;
  artboardWidth: number;
  artboardHeight: number;
  isAggressive: boolean;
  customGap?: number;
}

function findBestPos(sky: SkylineSeg[], itemW: number, itemH: number, usableH: number): { x: number; y: number; waste: number } | null {
  let bestX = -1, bestY = Infinity, bestWaste = Infinity, found = false;
  for (let i = 0; i < sky.length; i++) {
    let spanW = 0, maxY = 0, j = i;
    while (j < sky.length && spanW < itemW) {
      maxY = Math.max(maxY, sky[j].y);
      spanW += sky[j].w;
      j++;
    }
    if (spanW < itemW - 0.001) continue;
    if (maxY + itemH > usableH + 0.001) continue;
    let waste = 0;
    const rightBound = sky[i].x + itemW;
    for (let k = i; k < j; k++) {
      const segL = Math.max(sky[k].x, sky[i].x);
      const segR = Math.min(sky[k].x + sky[k].w, rightBound);
      waste += (maxY - sky[k].y) * Math.max(0, segR - segL);
    }
    const betterY = maxY < bestY - 0.001;
    const sameY = Math.abs(maxY - bestY) < 0.001;
    const moreLeft = sky[i].x < bestX - 0.001;
    const sameX = Math.abs(sky[i].x - bestX) < 0.001;
    if (betterY || (sameY && moreLeft) || (sameY && sameX && waste < bestWaste)) {
      bestY = maxY; bestX = sky[i].x; bestWaste = waste; found = true;
    }
  }
  return found ? { x: bestX, y: bestY, waste: bestWaste } : null;
}

function placeSeg(sky: SkylineSeg[], px: number, itemW: number, itemH: number): SkylineSeg[] {
  let topY = 0;
  for (const s of sky) {
    if (s.x < px + itemW && s.x + s.w > px) topY = Math.max(topY, s.y);
  }
  const next: SkylineSeg[] = [];
  for (const s of sky) {
    const sR = s.x + s.w, iR = px + itemW;
    if (sR <= px || s.x >= iR) { next.push(s); continue; }
    if (s.x < px) next.push({ x: s.x, y: s.y, w: px - s.x });
    if (sR > iR) next.push({ x: iR, y: s.y, w: sR - iR });
  }
  next.push({ x: px, y: topY + itemH, w: itemW });
  next.sort((a, b) => a.x - b.x);
  const merged: SkylineSeg[] = [next[0]];
  for (let k = 1; k < next.length; k++) {
    const prev = merged[merged.length - 1];
    if (Math.abs(prev.y - next[k].y) < 0.001 && Math.abs((prev.x + prev.w) - next[k].x) < 0.001) {
      prev.w += next[k].w;
    } else {
      merged.push(next[k]);
    }
  }
  return merged;
}

function toNxNy(absX: number, absY: number, w: number, h: number, abW: number, abH: number) {
  return {
    nx: Math.max(w / 2 / abW, Math.min((abW - w / 2) / abW, absX / abW)),
    ny: Math.max(h / 2 / abH, Math.min((abH - h / 2) / abH, absY / abH)),
  };
}

function skylinePack(items: PackItem[], usableW: number, usableH: number, abW: number, abH: number): { result: PlacedItem[]; maxHeight: number; wastedArea: number } {
  let sky: SkylineSeg[] = [{ x: 0, y: 0, w: usableW }];
  const result: PlacedItem[] = [];
  let totalWaste = 0;

  for (const item of items) {
    const g = item.gap;
    const halfG = g / 2;
    let pos: { x: number; y: number; waste: number } | null = null;
    let rw = 0, rh = 0;

    pos = findBestPos(sky, item.w + g, item.h + g, usableH);
    if (pos) { rw = item.w + g; rh = item.h + g; }
    if (!pos) {
      pos = findBestPos(sky, item.w + halfG, item.h + halfG, usableH);
      if (pos) { rw = item.w + halfG; rh = item.h + halfG; }
    }

    if (pos) {
      totalWaste += pos.waste;
      sky = placeSeg(sky, pos.x, rw, rh);
      const { nx, ny } = toNxNy(pos.x + item.w / 2, pos.y + item.h / 2, item.w, item.h, abW, abH);
      result.push({ id: item.id, nx, ny, rotation: item.rotation, overflows: false });
    } else {
      const skyMax = sky.length > 0 ? Math.max(...sky.map(s => s.y)) : 0;
      const absX = item.w / 2;
      const absY = skyMax + item.h / 2;
      sky = placeSeg(sky, 0, Math.min(item.w + halfG, usableW), item.h + halfG);
      const { nx, ny } = toNxNy(absX, absY, item.w, item.h, abW, abH);
      result.push({ id: item.id, nx, ny, rotation: item.rotation, overflows: true });
    }
  }
  const maxH = sky.length > 0 ? Math.max(...sky.map(s => s.y)) : 0;
  return { result, maxHeight: maxH, wastedArea: totalWaste };
}

function greedyOrientPack(sortedItems: Array<{ id: string; w: number; h: number; gap: number }>, usableW: number, usableH: number, abW: number, abH: number): { result: PlacedItem[]; maxHeight: number; wastedArea: number } {
  let sky: SkylineSeg[] = [{ x: 0, y: 0, w: usableW }];
  const result: PlacedItem[] = [];
  let totalWaste = 0;

  for (const item of sortedItems) {
    const g = item.gap;
    const orientations: Array<{ w: number; h: number; rot: number }> = [
      { w: item.w, h: item.h, rot: 0 },
    ];
    if (Math.abs(item.w - item.h) > 0.1) {
      orientations.push({ w: item.h, h: item.w, rot: 90 });
    }

    let bestPos: { x: number; y: number; waste: number } | null = null;
    let bestOrient = orientations[0];
    let bestSky = sky;

    for (const orient of orientations) {
      const halfG = g / 2;
      const attempts = [
        { w: orient.w + g, h: orient.h + g },
        { w: orient.w + halfG, h: orient.h + halfG },
      ];
      for (const attempt of attempts) {
        const pos = findBestPos(sky, attempt.w, attempt.h, usableH);
        if (!pos) continue;
        const score = pos.y * 10000 + pos.x * 10 + pos.waste;
        const bestScore = bestPos ? bestPos.y * 10000 + bestPos.x * 10 + bestPos.waste : Infinity;
        if (score < bestScore) {
          bestPos = pos;
          bestOrient = orient;
          bestSky = placeSeg(sky.map(s => ({ ...s })), pos.x, attempt.w, attempt.h);
        }
        break;
      }
    }

    if (bestPos) {
      totalWaste += bestPos.waste;
      sky = bestSky;
      const { nx, ny } = toNxNy(bestPos.x + bestOrient.w / 2, bestPos.y + bestOrient.h / 2, bestOrient.w, bestOrient.h, abW, abH);
      result.push({ id: item.id, nx, ny, rotation: bestOrient.rot, overflows: false });
    } else {
      const skyMax = sky.length > 0 ? Math.max(...sky.map(s => s.y)) : 0;
      const absX = item.w / 2;
      const absY = skyMax + item.h / 2;
      sky = placeSeg(sky, 0, Math.min(item.w + g, usableW), item.h + g);
      const { nx, ny } = toNxNy(absX, absY, item.w, item.h, abW, abH);
      result.push({ id: item.id, nx, ny, rotation: 0, overflows: true });
    }
  }
  const maxH = sky.length > 0 ? Math.max(...sky.map(s => s.y)) : 0;
  return { result, maxHeight: maxH, wastedArea: totalWaste };
}

function runArrange(input: ArrangeInput) {
  const { items, usableW, usableH, artboardWidth, artboardHeight, isAggressive, customGap } = input;
  const hasCustomGap = customGap !== undefined && customGap >= 0;
  const GAP = hasCustomGap ? customGap : (isAggressive ? 0.25 : 0.5);

  const getItemGap = (_fill: number): number => GAP;

  const evaluate = (pack: { result: PlacedItem[]; maxHeight: number; wastedArea: number }): Candidate => ({
    ...pack,
    overflows: pack.result.filter(r => r.overflows).length,
  });

  const makePackItems = (order: typeof items, orient: 'normal' | 'landscape' | 'portrait', gapOverride?: number): PackItem[] =>
    order.map(d => {
      const g = gapOverride !== undefined ? gapOverride : getItemGap(d.fill);
      let w = d.w, h = d.h, rot = 0;
      if (orient === 'landscape' && h > w) { const tmp = w; w = h; h = tmp; rot = 90; }
      if (orient === 'portrait' && w > h) { const tmp = w; w = h; h = tmp; rot = 90; }
      return { id: d.id, w, h, rotation: rot, gap: g };
    });

  const byWidth = [...items].sort((a, b) => b.w - a.w || b.h - a.h);
  const byHeight = [...items].sort((a, b) => Math.max(b.h, b.w) - Math.max(a.h, a.w) || (b.w * b.h) - (a.w * a.h));
  const byArea = [...items].sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const byPerimeter = [...items].sort((a, b) => (b.w + b.h) - (a.w + a.h));
  const byEmptySpace = [...items].sort((a, b) => a.fill - b.fill || (b.w * b.h) - (a.w * a.h));

  const sortOrders = [byWidth, byHeight, byArea, byPerimeter, byEmptySpace];

  const runCandidates = (gapOverride?: number): Candidate[] => {
    const cands: Candidate[] = [];
    for (const order of sortOrders) {
      cands.push(evaluate(skylinePack(makePackItems(order, 'normal', gapOverride), usableW, usableH, artboardWidth, artboardHeight)));
      if (isAggressive) {
        cands.push(evaluate(skylinePack(makePackItems(order, 'landscape', gapOverride), usableW, usableH, artboardWidth, artboardHeight)));
        cands.push(evaluate(skylinePack(makePackItems(order, 'portrait', gapOverride), usableW, usableH, artboardWidth, artboardHeight)));
        const greedyItems = order.map(d => ({
          id: d.id, w: d.w, h: d.h,
          gap: gapOverride !== undefined ? gapOverride : getItemGap(d.fill),
        }));
        cands.push(evaluate(greedyOrientPack(greedyItems, usableW, usableH, artboardWidth, artboardHeight)));
      }
    }
    return cands;
  };

  const candidates: Candidate[] = hasCustomGap
    ? [...runCandidates()]
    : [
        ...runCandidates(),
        ...runCandidates(0.125),
        ...runCandidates(0.0625),
      ];

  candidates.sort((a, b) => {
    if (a.overflows !== b.overflows) return a.overflows - b.overflows;
    if (Math.abs(a.maxHeight - b.maxHeight) > 0.01) return a.maxHeight - b.maxHeight;
    return a.wastedArea - b.wastedArea;
  });

  return candidates[0];
}

self.onmessage = function(e: MessageEvent) {
  try {
    if (e.data.type === 'arrange') {
      const result = runArrange(e.data);
      self.postMessage({ type: 'result', requestId: e.data.requestId, ...result });
    }
  } catch (err) {
    self.postMessage({ type: 'error', requestId: e.data?.requestId, error: String(err) });
  }
};
