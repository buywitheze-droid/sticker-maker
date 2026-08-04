/**
 * IndexedDB-backed draft storage for gangsheet sessions.
 *
 * Replaces sessionStorage-based persistence with crash-safe, Blob-native storage
 * that survives tab closes and browser restarts.
 *
 * DB layout
 * ─────────
 *   DB:    gangsheet_draft  (version 1)
 *   Store: meta  → key "current" → DraftMeta
 *   Store: blobs → key per imageKey → Blob (PNG, processed state)
 */

export interface DraftDesign {
  id: string;
  name: string;
  imageKey: string;
  widthInches: number;
  heightInches: number;
  transform: {
    nx: number;
    ny: number;
    s: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  originalWidth: number;
  originalHeight: number;
  dpi: number;
  originalDPI: number;
  alphaThresholded?: boolean;
  halftoned?: boolean;
  printFileName?: boolean;
}

export interface DraftSheet {
  id: string;
  name: string;
  artboardHeight: number;
  designs: DraftDesign[];
}

export interface DraftMeta {
  version: number;
  savedAt: number;
  sheets: DraftSheet[];
  activeSheetId: string;
  artboardWidth: number;
  /** Stable image keys that have a matching entry in the blobs store. */
  blobKeys: string[];
}

const DB_NAME = 'gangsheet_draft';
const DB_VERSION = 1;
const META_STORE = 'meta';
const BLOB_STORE = 'blobs';
const DRAFT_KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persist meta + blobs atomically.
 * Blobs not present in `blobs` but already in the store are left untouched so
 * that a partial re-save (e.g. only changed images) doesn't evict existing data.
 */
export async function saveDraft(
  meta: Omit<DraftMeta, 'version' | 'savedAt'>,
  blobs: Map<string, Blob>,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };

    const fullMeta: DraftMeta = {
      ...meta,
      version: 1,
      savedAt: Date.now(),
    };

    tx.objectStore(META_STORE).put(fullMeta, DRAFT_KEY);
    for (const [key, blob] of blobs) {
      tx.objectStore(BLOB_STORE).put(blob, key);
    }
  });
}

/** Load the saved draft. Returns null if none exists or the DB is unavailable. */
export async function loadDraft(): Promise<{ meta: DraftMeta; blobs: Map<string, Blob> } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readonly');
    tx.onerror = () => { db.close(); reject(tx.error); };

    const blobs = new Map<string, Blob>();

    const metaReq = tx.objectStore(META_STORE).get(DRAFT_KEY);
    metaReq.onsuccess = () => {
      const meta = metaReq.result as DraftMeta | undefined;
      if (!meta) { db.close(); resolve(null); return; }

      let pending = meta.blobKeys.length;
      if (pending === 0) { db.close(); resolve({ meta, blobs }); return; }

      for (const key of meta.blobKeys) {
        const blobReq = tx.objectStore(BLOB_STORE).get(key);
        blobReq.onsuccess = () => {
          if (blobReq.result) blobs.set(key, blobReq.result as Blob);
          if (--pending === 0) { db.close(); resolve({ meta, blobs }); }
        };
        blobReq.onerror = () => {
          if (--pending === 0) { db.close(); resolve({ meta, blobs }); }
        };
      }
    };
    metaReq.onerror = () => { db.close(); reject(metaReq.error); };
  });
}

/** Remove all draft data from IndexedDB. */
export async function clearDraft(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); }; // non-fatal

    tx.objectStore(META_STORE).delete(DRAFT_KEY);
    tx.objectStore(BLOB_STORE).clear();
  });
}
