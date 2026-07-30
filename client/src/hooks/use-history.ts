import { useRef, useCallback } from "react";

export interface HistorySnapshot {
  designsJson: string;
  selectedDesignId: string | null;
  imageInfoMap?: Map<string, unknown>;
  artboardWidth?: number;
  artboardHeight?: number;
}

const MAX_HISTORY = 50;

interface SheetStack {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

export function useHistory() {
  const stacksRef = useRef<Map<string, SheetStack>>(new Map());
  const isUndoRedoRef = useRef(false);

  const getStack = (sheetId: string): SheetStack => {
    if (!stacksRef.current.has(sheetId)) {
      stacksRef.current.set(sheetId, { past: [], future: [] });
    }
    return stacksRef.current.get(sheetId)!;
  };

  const pushSnapshot = useCallback((snapshot: HistorySnapshot, sheetId?: string) => {
    if (isUndoRedoRef.current) return;
    const stack = getStack(sheetId ?? '_default');
    stack.past.push(snapshot);
    if (stack.past.length > MAX_HISTORY) {
      stack.past.shift();
    }
    stack.future = [];
  }, []);

  const undo = useCallback(
    (currentSnapshot: HistorySnapshot, sheetId?: string): HistorySnapshot | null => {
      const stack = getStack(sheetId ?? '_default');
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
      const stack = getStack(sheetId ?? '_default');
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

  const canUndo = useCallback((sheetId?: string) => {
    return (stacksRef.current.get(sheetId ?? '_default')?.past.length ?? 0) > 0;
  }, []);

  const canRedo = useCallback((sheetId?: string) => {
    return (stacksRef.current.get(sheetId ?? '_default')?.future.length ?? 0) > 0;
  }, []);

  const deleteSheetHistory = useCallback((sheetId: string) => {
    stacksRef.current.delete(sheetId);
  }, []);

  return { pushSnapshot, undo, redo, clearIsUndoRedo, canUndo, canRedo, deleteSheetHistory };
}
