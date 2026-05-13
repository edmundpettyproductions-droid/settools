// Set Tools — Sync Layer (local-first, 10s polling, last-write-wins)
//
// Design:
//   • localStorage stays the source of truth on each device (fast UI, offline-safe)
//   • A monkeypatch on Storage.prototype.setItem/removeItem auto-mirrors writes
//     to Supabase whenever a workspace is joined — existing tool code does NOT
//     need to change. Any settools_* or ST_* key is synced.
//   • Polls every 10s and overwrites local with newer server values.
//   • If Supabase is unreachable, the app keeps working from localStorage.
//
// Public API (window.SetToolsSync):
//   await init()                      — load client, sign in anonymously, restore workspace
//   await createWorkspace(name)       — returns 6-char join code
//   await joinWorkspace(code)         — returns workspace id
//   leaveWorkspace()                  — clears workspace, stops polling (data stays local)
//   hasWorkspace()                    — bool
//   getWorkspaceCode()                — string|null
//   subscribe(fn)                     — fn(changedKeys[]) called after each pull
//                                       returns an unsubscribe fn

(function () {
'use strict';

// ── Config ────────────────────────────────────────────────────────────────
var SUPABASE_URL      = 'https://qywzcaghcyueegxnkhjj.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5d3pjYWdoY3l1ZWVneG5raGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0ODA2MTAsImV4cCI6MjA5NDA1NjYxMH0.is6qHpLiDI-fi2z30bjs4LReBFvWLB3yPoo4XypTLsA';
var POLL_MS           = 10000;
var WS_LOCAL_KEY      = '_st_workspace';
var SYNC_PREFIXES     = ['settools_', 'ST_'];  // which keys get synced
var NEVER_SYNC        = ['st-key'];            // hard blocklist (API key)

// ── State ─────────────────────────────────────────────────────────────────
var supabase    = null;
var workspaceId = null;
var workspaceCode = null;
var pollTimer   = null;
var subscribers = [];
var ready       = false;

// ── Helpers ───────────────────────────────────────────────────────────────
function shouldSync(key) {
  if (!key || typeof key !== 'string') return false;
  if (NEVER_SYNC.indexOf(key) !== -1) return false;
  for (var i = 0; i < SYNC_PREFIXES.length; i++) {
    if (key.indexOf(SYNC_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function loadSupabaseClient() {
  return new Promise(function (resolve, reject) {
    // Loaded via <script src="...supabase.min.js"> tag in the page itself.
    // We just check it's actually available.
    if (window.supabase && window.supabase.createClient) { resolve(); return; }
    reject(new Error('Supabase client not loaded — expected <script src="…/supabase-js@2"> before sync.js'));
  });
}

async function ensureSession() {
  var got = await supabase.auth.getSession();
  if (got && got.data && got.data.session) return;
  var r = await supabase.auth.signInAnonymously();
  if (r.error) throw r.error;
}

function readStoredWorkspace() {
  try { return JSON.parse(localStorage.getItem(WS_LOCAL_KEY) || 'null'); }
  catch (e) { return null; }
}
function writeStoredWorkspace(ws) {
  if (ws) localStorage.setItem(WS_LOCAL_KEY, JSON.stringify(ws));
  else    localStorage.removeItem(WS_LOCAL_KEY);
  workspaceId   = ws ? ws.id   : null;
  workspaceCode = ws ? ws.code : null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
async function init() {
  if (ready) return { hasWorkspace: !!workspaceId, workspaceCode: workspaceCode };
  await loadSupabaseClient();
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: '_st_supabase_auth' }
  });
  await ensureSession();
  var ws = readStoredWorkspace();
  if (ws) {
    workspaceId   = ws.id;
    workspaceCode = ws.code;
    startPolling();
  }
  ready = true;
  return { hasWorkspace: !!workspaceId, workspaceCode: workspaceCode };
}

async function createWorkspace(name) {
  if (!ready) await init();
  var r = await supabase.rpc('create_workspace', { p_name: name || 'My Production' });
  if (r.error) throw r.error;
  var row = r.data && r.data[0];
  if (!row) throw new Error('create_workspace returned no row');
  writeStoredWorkspace({ id: row.workspace_id, code: row.join_code });
  await pushAllLocal();  // upload existing local data so the new workspace owns it
  startPolling();
  return row.join_code;
}

async function joinWorkspace(code) {
  if (!ready) await init();
  if (!code || typeof code !== 'string') throw new Error('Workspace code required');
  var r = await supabase.rpc('join_workspace', { p_code: code });
  if (r.error) throw r.error;
  writeStoredWorkspace({ id: r.data, code: code.toUpperCase().trim() });
  await pullAll();       // overwrite local with the workspace's data
  startPolling();
  return r.data;
}

function leaveWorkspace() {
  stopPolling();
  writeStoredWorkspace(null);
}

// ── Push / Pull ───────────────────────────────────────────────────────────
async function pushAllLocal() {
  if (!workspaceId) return;
  var rows = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!shouldSync(k)) continue;
    rows.push({ workspace_id: workspaceId, key: k, value: { raw: localStorage.getItem(k) } });
  }
  if (!rows.length) return;
  var r = await supabase.from('kv_store').upsert(rows, { onConflict: 'workspace_id,key' });
  if (r.error) console.warn('[sync] push-all failed:', r.error);
}

async function pullAll() {
  if (!workspaceId) return;
  var r = await supabase.from('kv_store').select('key,value,updated_at').eq('workspace_id', workspaceId);
  if (r.error) { console.warn('[sync] pull failed:', r.error); return; }
  var changed = [];
  (r.data || []).forEach(function (row) {
    var newVal = (row.value && row.value.raw != null) ? row.value.raw : JSON.stringify(row.value);
    var oldVal = localStorage.getItem(row.key);
    if (newVal !== oldVal) {
      // Bypass our own monkeypatch to avoid bouncing the write back to server
      _origSet.call(localStorage, row.key, newVal);
      changed.push(row.key);
    }
  });
  if (changed.length) fireSubscribers(changed);
}

function fireSubscribers(keys) {
  for (var i = 0; i < subscribers.length; i++) {
    try { subscribers[i](keys); } catch (e) { console.warn('[sync] subscriber threw:', e); }
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function(){ pullAll(); }, POLL_MS);
  pullAll();
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── localStorage monkeypatch ──────────────────────────────────────────────
// Auto-mirror writes for synced keys whenever a workspace is active.
var _origSet    = Storage.prototype.setItem;
var _origRemove = Storage.prototype.removeItem;

Storage.prototype.setItem = function (k, v) {
  _origSet.apply(this, arguments);
  if (this === window.localStorage && workspaceId && shouldSync(k) && supabase) {
    supabase.from('kv_store').upsert(
      [{ workspace_id: workspaceId, key: k, value: { raw: String(v) } }],
      { onConflict: 'workspace_id,key' }
    ).then(function(r){ if (r.error) console.warn('[sync] upsert err', k, r.error); });
  }
};

Storage.prototype.removeItem = function (k) {
  _origRemove.apply(this, arguments);
  if (this === window.localStorage && workspaceId && shouldSync(k) && supabase) {
    supabase.from('kv_store').delete()
      .eq('workspace_id', workspaceId).eq('key', k)
      .then(function(r){ if (r.error) console.warn('[sync] delete err', k, r.error); });
  }
};

// ── Export ────────────────────────────────────────────────────────────────
window.SetToolsSync = {
  init: init,
  createWorkspace:  createWorkspace,
  joinWorkspace:    joinWorkspace,
  leaveWorkspace:   leaveWorkspace,
  pullAll:          pullAll,
  pushAllLocal:     pushAllLocal,
  hasWorkspace:     function(){ return !!workspaceId; },
  getWorkspaceCode: function(){ return workspaceCode; },
  subscribe: function (cb) {
    subscribers.push(cb);
    return function () { subscribers = subscribers.filter(function (s) { return s !== cb; }); };
  }
};

})();
