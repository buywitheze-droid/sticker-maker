/**
 * verify-edit-split.ts
 *
 * Standalone test for `computeEditSplitStamps`. No DOM, no React — runs with
 * `npx tsx scripts/verify-edit-split.ts`.
 */
import { computeEditSplitStamps } from "../client/src/lib/edit-split";

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
console.log(pass ? "\nPASS — all cases passed." : "\nFAIL — see errors above.");
process.exit(pass ? 0 : 1);
