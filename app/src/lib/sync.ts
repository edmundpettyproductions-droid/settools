// Set Tools — typed Supabase sync (Svelte side)
//
// Mirrors the vanilla js/sync.js model: anonymous auth, workspace by 6-char code,
// kv_store is the source of truth, 10-second polling. Used by the Svelte app.
// The vanilla pages keep their own sync.js implementation; both apps see the
// same data because they share the Supabase database, not localStorage.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qywzcaghcyueegxnkhjj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5d3pjYWdoY3l1ZWVneG5raGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0ODA2MTAsImV4cCI6MjA5NDA1NjYxMH0.is6qHpLiDI-fi2z30bjs4LReBFvWLB3yPoo4XypTLsA';
const POLL_MS = 10_000;
const WS_LOCAL_KEY = '_st_workspace';

interface Workspace { id: string; code: string }
interface KvRow { key: string; value: { raw?: string } | unknown; updated_at: string }

const SYNC_PREFIXES = ['settools_', 'ST_'];
const NEVER_SYNC = new Set(['st-key']);

function shouldSync(key: string): boolean {
  if (NEVER_SYNC.has(key)) return false;
  return SYNC_PREFIXES.some((p) => key.startsWith(p));
}

let supabase: SupabaseClient | null = null;
let workspaceId: string | null = null;
let workspaceCode: string | null = null;
let pollTimer: number | null = null;
let initPromise: Promise<{ hasWorkspace: boolean; workspaceCode: string | null }> | null = null;
const subscribers: Array<(keys: string[]) => void> = [];

function readStoredWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(WS_LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Workspace) : null;
  } catch {
    return null;
  }
}
function writeStoredWorkspace(ws: Workspace | null) {
  if (ws) localStorage.setItem(WS_LOCAL_KEY, JSON.stringify(ws));
  else localStorage.removeItem(WS_LOCAL_KEY);
  workspaceId = ws?.id ?? null;
  workspaceCode = ws?.code ?? null;
}

async function ensureSession(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const r = await client.auth.signInAnonymously();
  if (r.error) throw r.error;
}

/** Initialize Supabase, sign in anonymously, restore workspace. Idempotent. */
export function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, storageKey: '_st_supabase_auth_svelte' },
    });
    await ensureSession(supabase);
    const ws = readStoredWorkspace();
    if (ws) {
      workspaceId = ws.id;
      workspaceCode = ws.code;
      startPolling();
    }
    return { hasWorkspace: !!workspaceId, workspaceCode };
  })();
  return initPromise;
}

export async function createWorkspace(name: string): Promise<string> {
  await init();
  if (!supabase) throw new Error('Supabase not initialized');
  const r = await supabase.rpc('create_workspace', { p_name: name || 'My Production' });
  if (r.error) throw r.error;
  const row = (r.data as Array<{ workspace_id: string; join_code: string }>)?.[0];
  if (!row) throw new Error('create_workspace returned no row');
  writeStoredWorkspace({ id: row.workspace_id, code: row.join_code });
  startPolling();
  return row.join_code;
}

export async function joinWorkspace(code: string): Promise<string> {
  await init();
  if (!supabase) throw new Error('Supabase not initialized');
  const r = await supabase.rpc('join_workspace', { p_code: code });
  if (r.error) throw r.error;
  const id = r.data as string;
  writeStoredWorkspace({ id, code: code.toUpperCase().trim() });
  await pullAll();
  startPolling();
  return id;
}

export function leaveWorkspace() {
  stopPolling();
  writeStoredWorkspace(null);
}

export function hasWorkspace(): boolean { return !!workspaceId; }
export function getWorkspaceCode(): string | null { return workspaceCode; }

/** Read a synced value. Falls back to local first; freshest value comes from polling. */
export function get(key: string): string | null {
  return localStorage.getItem(key);
}

/** Read a synced value parsed as JSON. Returns null on absence or parse failure. */
export function getJSON<T = unknown>(key: string): T | null {
  const raw = get(key);
  if (raw == null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Write a value locally and (if synced + workspace) mirror to kv_store. */
export async function set(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
  if (shouldSync(key) && workspaceId && supabase) {
    const r = await supabase.from('kv_store').upsert(
      [{ workspace_id: workspaceId, key, value: { raw: value } }],
      { onConflict: 'workspace_id,key' },
    );
    if (r.error) console.warn('[sync] upsert err', key, r.error);
  }
}

async function pullAll() {
  if (!workspaceId || !supabase) return;
  const r = await supabase.from('kv_store').select('key,value,updated_at').eq('workspace_id', workspaceId);
  if (r.error) { console.warn('[sync] pull failed:', r.error); return; }
  const rows = (r.data ?? []) as KvRow[];
  const changed: string[] = [];
  for (const row of rows) {
    const v = row.value as { raw?: string } | unknown;
    const newVal = v && typeof v === 'object' && 'raw' in v && typeof (v as { raw?: unknown }).raw === 'string'
      ? (v as { raw: string }).raw
      : JSON.stringify(v);
    const oldVal = localStorage.getItem(row.key);
    if (newVal !== oldVal) {
      localStorage.setItem(row.key, newVal);
      changed.push(row.key);
    }
  }
  if (changed.length) fireSubscribers(changed);
}

export { pullAll };

function fireSubscribers(keys: string[]) {
  for (const cb of subscribers) {
    try { cb(keys); } catch (e) { console.warn('[sync] subscriber threw:', e); }
  }
}

export function subscribe(cb: (keys: string[]) => void): () => void {
  subscribers.push(cb);
  return () => {
    const i = subscribers.indexOf(cb);
    if (i !== -1) subscribers.splice(i, 1);
  };
}

function startPolling() {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => { pullAll(); }, POLL_MS);
  pullAll();
}
function stopPolling() {
  if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null; }
}
