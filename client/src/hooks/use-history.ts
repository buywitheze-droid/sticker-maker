import { useRef, useCallback } from "react";

export interface HistorySnapshot {
  designsJson: string;
  selectedDesignId: string | null;
  imageInfoMap?: Map<string, unknown>;
  artboardWidth?: number;
  artboardHeight?: number;
  /**
   * Height the customer had picked by hand at this point, which auto-shrink treats as a
   * floor. Travels with `artboardHeight` because the two describe the same decision: a
   * snapshot that restored one without the other would leave the sheet pinned to a size
   * nobody chose, or silently un-pin one they did.
   */
  manualHeightFloor?: number | null;
}

const MAX_HISTORY = 50;

interface SheetStack {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

/**
 * Undo/redo stacks, kept one per gangsheet.
 *
 * Sheets are edited independently, so a single shared stack would let an undo
 * on one sheet silently revert an edit the customer made on another. Callers
 * that have no sheet (or predate them) fall through to a `_default` stack and
 * behave exactly as they did with one global history.
 */
export function useHistory() {
  const stacksRef = useRef<Map<string, SheetStack>>(new Map());
  const isUndoRedoRef = useRef(false);

  const getStack = (sheetId?: string): SheetStack => {
    const key = sheetId ?? "_default";
    let stack = stacksRef.current.get(key);
    if (!stack) {
      stack = { past: [], future: [] };
      stacksRef.current.set(key, stack);
    }
    return stack;
  };

  const pushSnapshot = useCallback((snapshot: HistorySnapshot, sheetId?: string) => {
    if (isUndoRedoRef.current) return;
    const stack = getStack(sheetId);
    stack.past.push(snapshot);
    if (stack.past.length > MAX_HISTORY) {
      stack.past.shift();
    }
    stack.future = [];
  }, []);

  const undo = useCallback(
    (currentSnapshot: HistorySnapshot, sheetId?: string): HistorySnapshot | null => {
      const stack = getStack(sheetId);
      if (stack.past.length === 0) return null;
      const prev = stack.past.pop()!;
      stack.future.push(currentSnapshot);
      isUndoRedoRef.current = true;
      return prev;
    },
    []
  );

  const redo = useCallback(
    (currentSnapshot: HistorySnapshot, sheetId?: string): HistorySnapshot | null => {
      const stack = getStack(sheetId);
      if (stack.future.length === 0) return null;
      const next = stack.future.pop()!;
      stack.past.push(currentSnapshot);
      isUndoRedoRef.current = true;
      return next;
    },
    []
  );

  const clearIsUndoRedo = useCallback(() => {
    isUndoRedoRef.current = false;
  }, []);

  const canUndo = useCallback(
    (sheetId?: string) => (stacksRef.current.get(sheetId ?? "_default")?.past.length ?? 0) > 0,
    [],
  );
  const canRedo = useCallback(
    (sheetId?: string) => (stacksRef.current.get(sheetId ?? "_default")?.future.length ?? 0) > 0,
    [],
  );

  const deleteSheetHistory = useCallback((sheetId: string) => {
    stacksRef.current.delete(sheetId);
  }, []);

  return { pushSnapshot, undo, redo, clearIsUndoRedo, canUndo, canRedo, deleteSheetHistory };
}
