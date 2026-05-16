// Sides state persistence.
// Script PDF bytes → IndexedDB (local to this device, too large for Supabase sync).
// Everything else → settools_sides in sync state (shared across workspace).

import * as sync from '../sync';
import type { SidesState, ScriptCacheEntry, CharactersByScene } from './types';

const SYNC_KEY = 'settools_sides';
const IDB_DB = 'set-tools-sides';
const IDB_STORE = 'scripts';
const IDB_VERSION = 1;

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'revisionLabel' });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

interface ScriptRecord {
  revisionLabel: string;
  buf: ArrayBuffer;
  filename: string;
  filesize: number;
  cachedAt: string;
  pageCount: number;
}

export async function saveScript(
  buf: ArrayBuffer,
  meta: Omit<ScriptCacheEntry, 'cachedAt'>,
): Promise<void> {
  const db = await openDb();
  const record: ScriptRecord = {
    revisionLabel: meta.revisionLabel ?? 'default',
    buf,
    filename: meta.filename,
    filesize: meta.filesize,
    cachedAt: new Date().toISOString(),
    pageCount: meta.pageCount,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Update sync metadata (no bytes)
  const state = readState();
  state.scriptCache = {
    revisionLabel: record.revisionLabel,
    filename: record.filename,
    filesize: record.filesize,
    cachedAt: record.cachedAt,
    pageCount: record.pageCount,
  };
  await writeState(state);
}

export async function loadScript(revisionLabel: string | null): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const key = revisionLabel ?? 'default';
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => {
      const rec = req.result as ScriptRecord | undefined;
      resolve(rec?.buf ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listCachedScripts(): Promise<ScriptCacheEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => {
      const records = (req.result as ScriptRecord[]).map(
        (r): ScriptCacheEntry => ({
          revisionLabel: r.revisionLabel,
          filename: r.filename,
          filesize: r.filesize,
          cachedAt: r.cachedAt,
          pageCount: r.pageCount,
        }),
      );
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteScript(revisionLabel: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(revisionLabel);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Sync state helpers ─────────────────────────────────────────────────────────

export function readState(): SidesState {
  return sync.getJSON<SidesState>(SYNC_KEY) ?? {};
}

export async function writeState(state: SidesState): Promise<void> {
  await sync.set(SYNC_KEY, JSON.stringify(state));
}

export async function saveCharactersByScene(chars: CharactersByScene): Promise<void> {
  const state = readState();
  state.charactersByScene = chars;
  await writeState(state);
}

export async function recordGeneration(sceneNums: string[]): Promise<void> {
  const state = readState();
  state.lastGeneratedAt = new Date().toISOString();
  state.lastGeneratedScenes = sceneNums;
  await writeState(state);
}
