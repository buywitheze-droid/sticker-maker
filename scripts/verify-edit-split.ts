/**
 * verify-edit-split.ts
 *
 * Standalone tests for `computeEditSplitStamps` and `rowKeyOf`. No DOM, no
 * React — runs with `npx tsx scripts/verify-edit-split.ts`.
 */
import { computeEditSplitStamps, rowKeyOf } from "../client/src/lib/edit-split";

// ---------------------------------------------------------------------------
// Minimal mock — satisfies the DesignLike duck-type without HTMLImageElement
// ---------------------------------------------------------------------------
function makeDesign(
  id: string,
  src: string,
  widthInches = 4,
  heightInches = 4,
  editSplit?: string,
) {
  return {
    id,
    imageInfo: { image: { src } },
    widthInches,
    heightInches,
    transform: { s: 1 },
    editSplit,
  };
}

let pass = true;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    pass = false;
  }
}

// ---------------------------------------------------------------------------
// Case 1: 3 copies of design A; edit 2 → the 2 get a stamp, the 1 does not,
//         and both edited copies share the same tag value.
// ---------------------------------------------------------------------------
console.log("\nCase 1: partial edit (2 of 3 copies)");
{
  const d1 = makeDesign("a1", "blob:img-a");
  const d2 = makeDesign("a2", "blob:img-a");
  const d3 = makeDesign("a3", "blob:img-a");
  const all = [d1, d2, d3];

  const stamps = computeEditSplitStamps(["a1", "a2"], all, "halftone");

  check("a1 gets a stamp", !!stamps.get("a1"));
  check("a2 gets a stamp", !!stamps.get("a2"));
  check("a3 not in result (untouched)", !stamps.has("a3"));
  check("a1 and a2 share the same tag", stamps.get("a1") === stamps.get("a2"));
  check(
    "tag starts with 'halftone:'",
    (stamps.get("a1") ?? "").startsWith("halftone:"),
  );
}

// ---------------------------------------------------------------------------
// Case 2: 2 copies of design A; edit both → no stamp for either.
// ---------------------------------------------------------------------------
console.log("\nCase 2: whole-row edit (2 of 2 copies)");
{
  const d1 = makeDesign("b1", "blob:img-b");
  const d2 = makeDesign("b2", "blob:img-b");
  const all = [d1, d2];

  const stamps = computeEditSplitStamps(["b1", "b2"], all, "upscale");

  check("b1 in result", stamps.has("b1"));
  check("b2 in result", stamps.has("b2"));
  check("b1 stamp is undefined (no split)", stamps.get("b1") === undefined);
  check("b2 stamp is undefined (no split)", stamps.get("b2") === undefined);
}

// ---------------------------------------------------------------------------
// Case 3: 1 solo design; edit it → no stamp (whole row).
// ---------------------------------------------------------------------------
console.log("\nCase 3: solo design (1 of 1 copy)");
{
  const d1 = makeDesign("c1", "blob:img-c");
  const all = [d1];

  const stamps = computeEditSplitStamps(["c1"], all, "crop");

  check("c1 in result", stamps.has("c1"));
  check("c1 stamp is undefined (no split)", stamps.get("c1") === undefined);
}

// ---------------------------------------------------------------------------
// Case 4: 2 copies that already have different editSplit tags;
//         edit one → it gets a FRESH stamp (not the old one).
// ---------------------------------------------------------------------------
console.log("\nCase 4: re-stamp already-split copy");
{
  const oldTag = "halftone:old-uuid-1234";
  const d1 = makeDesign("d1", "blob:img-d-halftoned", 4, 4, oldTag);
  const d2 = makeDesign("d2", "blob:img-d-orig"); // different src, different row
  const all = [d1, d2];

  // d1 is in its own row (oldTag makes it unique), d2 is in a different row.
  // Editing only d1 → partial edit of d1's row? No — d1's row has only 1 member (d1
  // and d2 are in different rows). So editing d1 = whole-row edit → no stamp.
  const stamps = computeEditSplitStamps(["d1"], all, "pixelClean");
  check("d1 in result (whole row)", stamps.has("d1"));
  check("no stamp when only member of its row", stamps.get("d1") === undefined);

  // Now: two copies sharing the same src+size+editSplit (same split row),
  // edit one → fresh stamp.
  const e1 = makeDesign("e1", "blob:img-e-halftoned", 4, 4, oldTag);
  const e2 = makeDesign("e2", "blob:img-e-halftoned", 4, 4, oldTag);
  const all2 = [e1, e2];

  const stamps2 = computeEditSplitStamps(["e1"], all2, "pixelClean");
  check("e1 gets a stamp (partial of split row)", !!stamps2.get("e1"));
  check(
    "new stamp differs from old tag",
    stamps2.get("e1") !== oldTag,
  );
  check(
    "new stamp starts with 'pixelClean:'",
    (stamps2.get("e1") ?? "").startsWith("pixelClean:"),
  );
  check("e2 not touched", !stamps2.has("e2"));
}

// ---------------------------------------------------------------------------
// Case 5: empty editing set → empty result
// ---------------------------------------------------------------------------
console.log("\nCase 5: empty editing set");
{
  const d1 = makeDesign("f1", "blob:img-f");
  const stamps = computeEditSplitStamps([], [d1], "crop");
  check("empty result for empty editingIds", stamps.size === 0);
}

// ---------------------------------------------------------------------------
// Case 6: cross-sheet — one copy on active sheet, one on another sheet.
//         Editing the active-sheet copy is a partial edit of the row even
//         though the all-sheets population has two members.
//
//         This is the regression that the reviewer caught: if the helper only
//         sees active-sheet designs it would count 1-of-1 → whole-row → no stamp.
// ---------------------------------------------------------------------------
console.log("\nCase 6: cross-sheet partial edit");
{
  // Same image src + size on both sheets → same row in layerRows.
  const activeSheetCopy  = makeDesign("g1", "blob:img-g");
  const otherSheetCopy   = makeDesign("g2", "blob:img-g"); // different sheet, same row

  // The caller passes ALL designs from ALL sheets to computeEditSplitStamps.
  const allSheetDesigns = [activeSheetCopy, otherSheetCopy];

  // Only the active-sheet copy is being edited.
  const stamps = computeEditSplitStamps(["g1"], allSheetDesigns, "upscale");

  check("g1 gets a stamp (partial cross-sheet row)", !!stamps.get("g1"));
  check("stamp starts with 'upscale:'", (stamps.get("g1") ?? "").startsWith("upscale:"));
  check("g2 not in result (other sheet, not edited)", !stamps.has("g2"));
}

// Case 6b: editing BOTH copies (one per sheet) → no stamp (whole row).
console.log("\nCase 6b: cross-sheet whole-row edit (both copies)");
{
  const h1 = makeDesign("h1", "blob:img-h");
  const h2 = makeDesign("h2", "blob:img-h");
  const allSheetDesigns = [h1, h2];

  const stamps = computeEditSplitStamps(["h1", "h2"], allSheetDesigns, "crop");

  check("h1 stamp is undefined (whole row, no split)", stamps.get("h1") === undefined);
  check("h2 stamp is undefined (whole row, no split)", stamps.get("h2") === undefined);
}

// ---------------------------------------------------------------------------
// Case 7: rowKeyOf three-tier grouping formula.
// ---------------------------------------------------------------------------
console.log("\nCase 7: rowKeyOf three-tier grouping");
{
  const tag = "halftone:shared-uuid-abc";

  // Tier 1: editSplit set — keyed by tag+size regardless of src
  const splitCopy1 = makeDesign("i1", "blob:post-edit-url-1", 4, 4, tag);
  const splitCopy2 = makeDesign("i2", "blob:post-edit-url-2", 4, 4, tag);
  check(
    "same editSplit tag + different src → same rowKey",
    rowKeyOf(splitCopy1) === rowKeyOf(splitCopy2),
  );
  check("split rowKey starts with 'editSplit:'", rowKeyOf(splitCopy1).startsWith("editSplit:"));

  // Tier 2: rowLineage set (no editSplit) — keyed by lineage, not current src
  // This is the whole-row-edit path where editSplitStamps returns undefined.
  function makeDesignWithLineage(id: string, src: string, lineage: string) {
    return { ...makeDesign(id, src), rowLineage: lineage };
  }
  const lineage = "blob:original-src";
  const wholeCopy1 = makeDesignWithLineage("j1", "blob:new-src-1", lineage);
  const wholeCopy2 = makeDesignWithLineage("j2", "blob:new-src-2", lineage);
  check(
    "same rowLineage + different src → same rowKey (whole-row edit stays together)",
    rowKeyOf(wholeCopy1) === rowKeyOf(wholeCopy2),
  );
  check(
    "rowLineage-keyed rowKey is the lineage, not the post-edit src",
    rowKeyOf(wholeCopy1).startsWith("blob:original-src"),
  );

  // Tier 3: neither set — keyed by current src
  check(
    "unsplit designs still key by current src",
    rowKeyOf(makeDesign("k1", "blob:orig")).startsWith("blob:orig"),
  );
}

// ---------------------------------------------------------------------------
// Case 8: ThresholdAlphaAll cross-sheet — all active-sheet designs are passed
//         to computeEditSplitStamps along with a cross-sheet copy.
//         Active-sheet designs that have a twin on another sheet should stamp.
//         Active-sheet designs that are solo (no other-sheet twin) should not.
// ---------------------------------------------------------------------------
console.log("\nCase 8: ThresholdAlphaAll cross-sheet stamping");
{
  // Design A: one copy on active sheet, one on another sheet → partial row
  const a_active = makeDesign("k1", "blob:img-k");
  const a_other  = makeDesign("k2", "blob:img-k"); // different sheet

  // Design B: only on active sheet (solo) → whole row
  const b_active = makeDesign("k3", "blob:img-l");

  // "ThresholdAlphaAll" edits all active-sheet designs: k1 and k3
  // The allDesigns population includes the other-sheet copy too: k1, k2, k3
  const allSheetDesigns = [a_active, a_other, b_active];
  const stamps = computeEditSplitStamps(
    ["k1", "k3"],  // active-sheet design IDs
    allSheetDesigns,
    "pixelClean",
  );

  check("design A (cross-sheet) gets a stamp", !!stamps.get("k1"));
  check("design B (solo) has undefined stamp (no split)", stamps.get("k3") === undefined);
  check("other-sheet copy not in result", !stamps.has("k2"));
}

// ---------------------------------------------------------------------------
console.log(pass ? "\nPASS — all cases passed." : "\nFAIL — see errors above.");
process.exit(pass ? 0 : 1);
