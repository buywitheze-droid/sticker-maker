/**
 * editSplit tag system — splits layer-panel rows when a pixel-changing edit
 * (halftone, upscale, pixelClean, crop) is applied to SOME but not ALL copies
 * of a design row.
 *
 * Tag format: `${toolKey}:${uuid}` — the uuid is minted once per user gesture
 * so all copies edited in one gesture share the same tag (and therefore the
 * same split row), while separate gestures never merge even for the same tool.
 */

export type EditSplitTool = "halftone" | "upscale" | "pixelClean" | "crop";

/**
 * Minimal shape the helper needs. Satisfied by `DesignItem` and by plain
 * objects in tests (no DOM required).
 */
export interface DesignLike {
  id: string;
  imageInfo: { image: { src: string } };
  widthInches: number;
  heightInches: number;
  transform: { s: number };
  editSplit?: string;
}

/** The same placed-size formula used by `layerRows`. */
function sizeKeyOf(d: DesignLike): string {
  return `${(d.widthInches * d.transform.s).toFixed(2)}x${(d.heightInches * d.transform.s).toFixed(2)}`;
}

/**
 * The row-grouping key used by `layerRows`.
 *
 * Split designs (editSplit set) are keyed by their tag + size rather than by
 * image source. After a pixel edit each copy gets a new blob URL, so copies
 * edited together in one gesture would land in separate rows if we kept `src`
 * in the key. Using the tag (which is shared by the gesture) groups them back
 * into a single split row regardless of their individual post-edit sources.
 *
 * Unsplit designs keep the original `src::sk` key so the pre-existing
 * resize-split behaviour is unaffected.
 */
export function rowKeyOf(d: DesignLike): string {
  const sk = sizeKeyOf(d);
  return d.editSplit
    ? `editSplit:${d.editSplit}::${sk}`
    : `${d.imageInfo.image.src}::${sk}`;
}

/**
 * Compute which editSplit tag each edited design should receive.
 *
 * Returns a `Map<id, string | undefined>` only for IDs that are in
 * `editingIds`. The value meaning:
 *  - `undefined`  — the design's whole row is being edited; no stamp needed.
 *  - `string`     — partial edit; apply this tag (shared within one gesture).
 *
 * IDs absent from the returned map were not in `editingIds` and are untouched.
 */
export function computeEditSplitStamps(
  editingIds: string[],
  allDesigns: DesignLike[],
  toolKey: EditSplitTool,
): Map<string, string | undefined> {
  if (editingIds.length === 0) return new Map();

  const editingSet = new Set(editingIds);

  // Group all designs by their current row key.
  const rowGroups = new Map<string, string[]>(); // rowKey -> [id, ...]
  for (const d of allDesigns) {
    const key = rowKeyOf(d);
    const g = rowGroups.get(key);
    if (g) g.push(d.id);
    else rowGroups.set(key, [d.id]);
  }

  // Collect which editing ids fall into each row.
  const editingByRow = new Map<string, string[]>();
  for (const d of allDesigns) {
    if (!editingSet.has(d.id)) continue;
    const key = rowKeyOf(d);
    const g = editingByRow.get(key);
    if (g) g.push(d.id);
    else editingByRow.set(key, [d.id]);
  }

  const result = new Map<string, string | undefined>();

  for (const [rowKey, rowMembers] of rowGroups) {
    const editingInRow = editingByRow.get(rowKey);
    if (!editingInRow || editingInRow.length === 0) continue;

    const isPartial = editingInRow.length < rowMembers.length;
    if (!isPartial) {
      // Whole row edited — no stamp; existing tag (if any) should be cleared.
      for (const id of editingInRow) result.set(id, undefined);
    } else {
      // Partial edit — all edited members in this row share one fresh tag.
      const tag = `${toolKey}:${crypto.randomUUID()}`;
      for (const id of editingInRow) result.set(id, tag);
    }
  }

  return result;
}

/**
 * Extract the tool key from an editSplit tag for i18n lookup.
 * e.g. `"halftone:550e8400-…"` → `"halftone"`.
 */
export function badgeLabelKey(editSplit: string): string {
  const colonIdx = editSplit.indexOf(":");
  return colonIdx >= 0 ? editSplit.slice(0, colonIdx) : editSplit;
}
