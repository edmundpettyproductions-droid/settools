<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as T from '../lib/tracker';
  import type { UHState } from '../lib/types';

  // ─── Types ──────────────────────────────────────────────────────────
  interface SignInPerson {
    name: string;
    role: string;
    callTime: string;
    source: 'cast' | 'crew';
  }

  interface SignInRecord {
    name: string;
    role: string;
    callTime: string;
    signedAt: string;
    signedOutAt: string | null;
    timestamp: number;
    sig: string | null;
  }

  interface SignInState {
    cast: Array<{ name: string; role: string; callTime: string }>;
    records: SignInRecord[];
    show: string;
    date: string;
    settings: {
      stationTitle: string;
      sigPrompt: string;
      confirmMsg: string;
      signoutMsg: string;
      customNote: string;
    };
  }

  // Props
  let { kiosk = false }: { kiosk?: boolean } = $props();

  const SI_KEY = 'ST_signin';
  const DEFAULT_SETTINGS: SignInState['settings'] = {
    stationTitle: 'Sign-In Station',
    sigPrompt: 'Tap to confirm your arrival',
    confirmMsg: 'Thank you! Have a great shoot.',
    signoutMsg: 'Have a great rest of your day!',
    customNote: '',
  };

  // ─── State ──────────────────────────────────────────────────────────
  let people = $state<SignInPerson[]>([]);
  let records = $state<SignInRecord[]>([]);
  let show = $state('');
  let dateStr = $state('');
  let settings = $state<SignInState['settings']>({ ...DEFAULT_SETTINGS });

  // UI state
  let confirmingPerson = $state<SignInPerson | null>(null);
  let successPerson = $state<{ name: string; time: string; action: 'in' | 'out' } | null>(null);
  let successTimeout: number | undefined;

  // ─── Time helpers ───────────────────────────────────────────────────
  function nowDisplay(): string {
    const d = new Date();
    const h = d.getHours(), m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ap}`;
  }

  // ─── Load / save ───────────────────────────────────────────────────
  function loadSignIn() {
    const raw = sync.getJSON<SignInState>(SI_KEY);
    if (raw) {
      records = raw.records ?? [];
      show = raw.show ?? '';
      dateStr = raw.date ?? '';
      settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    }
  }

  function loadPeople() {
    const castData = T.loadTracker('settools_cast');
    const crewData = T.loadTracker('settools_crew');
    const result: SignInPerson[] = [];
    for (const r of castData.rows) {
      if (r.name.trim()) result.push({ name: r.name, role: r.role, callTime: r.callTime, source: 'cast' });
    }
    for (const r of crewData.rows) {
      if (r.name.trim()) result.push({ name: r.name, role: r.role, callTime: r.callTime, source: 'crew' });
    }
    // Sort: by call time, then name
    result.sort((a, b) => {
      const ta = a.callTime || '99:99', tb = b.callTime || '99:99';
      const cmp = ta.localeCompare(tb);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
    people = result;

    // Auto-populate show/date from UH if empty
    if (!show || !dateStr) {
      const uh = sync.getJSON<UHState>('settools_uh');
      if (uh?.production && !show) show = uh.production;
      if (!dateStr) {
        const d = new Date();
        dateStr = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      }
    }
  }

  async function saveState() {
    const state: SignInState = {
      cast: people.map(p => ({ name: p.name, role: p.role, callTime: p.callTime })),
      records,
      show,
      date: dateStr,
      settings,
    };
    await sync.set(SI_KEY, JSON.stringify(state));
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────
  onMount(() => {
    loadPeople();
    loadSignIn();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes('settools_cast') || keys.includes('settools_crew')) loadPeople();
      if (keys.includes(SI_KEY)) loadSignIn();
    });
    return () => unsub();
  });

  // ─── Record lookup ──────────────────────────────────────────────────
  function findRecord(name: string): SignInRecord | undefined {
    return records.find(r => r.name === name);
  }
  function isSignedIn(name: string): boolean {
    return records.some(r => r.name === name);
  }

  let signedCount = $derived(records.length);
  let totalCount = $derived(people.length);

  // ─── Actions ────────────────────────────────────────────────────────
  function openConfirm(person: SignInPerson) {
    if (isSignedIn(person.name)) return; // already signed in
    confirmingPerson = person;
  }

  function cancelConfirm() {
    confirmingPerson = null;
  }

  async function doSignOut(person: SignInPerson) {
    const rec = findRecord(person.name);
    if (!rec || rec.signedOutAt) return;
    const timeStr = nowDisplay();
    rec.signedOutAt = timeStr;
    records = records;
    await saveState();
    showSuccess(person.name, timeStr, 'out');
  }

  function showSuccess(name: string, time: string, action: 'in' | 'out') {
    if (successTimeout) clearTimeout(successTimeout);
    successPerson = { name, time, action };
    successTimeout = window.setTimeout(() => { successPerson = null; }, 2500);
  }

  // ─── Grid layout ───────────────────────────────────────────────────
  let gridCols = $derived.by(() => {
    const n = people.length;
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    if (n <= 16) return 4;
    return Math.ceil(Math.sqrt(n));
  });

  // ─── Signature canvas ───────────────────────────────────────────────
  let sigCanvas = $state<HTMLCanvasElement | null>(null);
  let sigDrawing = false;
  let sigHasData = $state(false);

  function sigGetCtx() {
    return sigCanvas?.getContext('2d') ?? null;
  }

  function sigClear() {
    const ctx = sigGetCtx();
    if (!ctx || !sigCanvas) return;
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigHasData = false;
  }

  function sigPointerDown(e: PointerEvent) {
    if (!sigCanvas) return;
    sigDrawing = true;
    sigCanvas.setPointerCapture(e.pointerId);
    const ctx = sigGetCtx();
    if (!ctx) return;
    const { x, y } = sigPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function sigPointerMove(e: PointerEvent) {
    if (!sigDrawing) return;
    const ctx = sigGetCtx();
    if (!ctx) return;
    const { x, y } = sigPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    sigHasData = true;
  }

  function sigPointerUp() { sigDrawing = false; }

  function sigPos(e: PointerEvent) {
    if (!sigCanvas) return { x: 0, y: 0 };
    const rect = sigCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (sigCanvas.width / rect.width),
      y: (e.clientY - rect.top) * (sigCanvas.height / rect.height),
    };
  }

  function sigToDataURL(): string | null {
    if (!sigCanvas || !sigHasData) return null;
    return sigCanvas.toDataURL('image/png');
  }

  // ─── Updated confirmSignIn with signature ───────────────────────────
  async function confirmSignInWithSig() {
    if (!confirmingPerson) return;
    const person = confirmingPerson;
    const timeStr = nowDisplay();
    records.push({
      name: person.name,
      role: person.role,
      callTime: person.callTime,
      signedAt: timeStr,
      signedOutAt: null,
      timestamp: Date.now(),
      sig: sigToDataURL(),
    });
    records = records;
    confirmingPerson = null;
    sigClear(); // clear canvas so next person's signature starts fresh
    await saveState();
    showSuccess(person.name, timeStr, 'in');
  }

  // ─── Print export ───────────────────────────────────────────────────
  function printSignInSheet() {
    window.print();
  }
</script>

<div class="signin-tab" class:kiosk>
  <!-- HEADER -->
  <div class="si-header">
    <h2>{settings.stationTitle}</h2>
    <span class="si-info">
      {show || 'Set Tools'} · {dateStr || 'Today'} · {signedCount}/{totalCount} signed in
    </span>
    <button class="si-print-btn" onclick={printSignInSheet} title="Print sign-in sheet with signatures">🖨 Print</button>
  </div>

  <!-- PRINT-ONLY TABLE (hidden on screen, shown when printing) -->
  <div class="si-print-only">
    <div class="si-print-hdr">
      <h1>{show || 'Production'} — Sign-In Sheet</h1>
      <p>{dateStr || 'Date'}</p>
    </div>
    <table class="si-print-table">
      <thead><tr>
        <th>#</th><th>Name</th><th>Role</th><th>Call</th><th>Signed In</th><th>Signed Out</th><th>Signature</th>
      </tr></thead>
      <tbody>
        {#each records as r, i (r.name + r.timestamp)}
          <tr>
            <td>{i + 1}</td>
            <td>{r.name}</td>
            <td>{r.role || ''}</td>
            <td>{r.callTime || ''}</td>
            <td>{r.signedAt}</td>
            <td>{r.signedOutAt || ''}</td>
            <td>
              {#if r.sig}
                <img src={r.sig} alt="signature" class="si-print-sig" />
              {:else}
                <span class="si-print-nosig">—</span>
              {/if}
            </td>
          </tr>
        {/each}
        {#each people.filter(p => !records.some(r => r.name === p.name)) as p (p.name + p.source)}
          <tr class="si-print-unsigned">
            <td></td>
            <td>{p.name}</td>
            <td>{p.role || ''}</td>
            <td>{p.callTime || ''}</td>
            <td colspan="3"></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="si-print-footer">Printed from Set Tools · {new Date().toLocaleString()}</div>
  </div>

  <!-- GRID -->
  {#if people.length === 0}
    <div class="si-empty">
      <h3>No Cast or Crew Loaded</h3>
      <p>Upload a call sheet (📋 button in the header bar) or manually add people in the Cast/Crew timer tabs first.</p>
    </div>
  {:else}
    <div class="si-grid" style="grid-template-columns: repeat({gridCols}, 1fr);">
      {#each people as person (person.name + person.source)}
        {@const rec = findRecord(person.name)}
        {@const signedIn = !!rec}
        <div
          class="si-card"
          class:signed-in={signedIn}
          class:cast={person.source === 'cast'}
          class:crew={person.source === 'crew'}
          role="button"
          tabindex="0"
          aria-pressed={signedIn}
          onclick={() => { if (!signedIn) openConfirm(person); }}
          onkeydown={(e) => { if (!signedIn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openConfirm(person); } }}
        >
          {#if signedIn}
            <span class="si-check">&#10003;</span>
          {/if}
          <span class="si-name">{person.name}</span>
          {#if person.role}
            <span class="si-role">{person.role}</span>
          {/if}
          {#if person.callTime}
            <span class="si-call">{T.fmt12(person.callTime)}</span>
          {/if}
          {#if signedIn && rec}
            <span class="si-time">Signed in {rec.signedAt}</span>
            {#if !rec.signedOutAt}
              <button
                class="si-signout-btn"
                type="button"
                onclick={() => void doSignOut(person)}
              >Sign Out</button>
            {:else}
              <span class="si-time out">Out {rec.signedOutAt}</span>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- CONFIRM OVERLAY -->
{#if confirmingPerson}
  <div class="si-overlay" role="dialog" aria-modal="true" aria-label="Confirm sign-in"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) cancelConfirm(); }}
    onkeydown={(e) => { if (e.key === 'Escape') cancelConfirm(); }}>
    <div class="si-confirm">
      <div class="si-confirm-name">{confirmingPerson.name}</div>
      {#if confirmingPerson.role}
        <div class="si-confirm-role">{confirmingPerson.role}</div>
      {/if}
      <div class="si-confirm-meta">
        {#if confirmingPerson.callTime}
          <div class="si-meta-item">
            <span class="si-meta-label">Call</span>
            <span class="si-meta-val">{T.fmt12(confirmingPerson.callTime)}</span>
          </div>
        {/if}
      </div>

      <!-- Signature pad -->
      <p class="si-confirm-prompt">{settings.sigPrompt}</p>
      <div class="si-sig-wrap">
        <canvas
          bind:this={sigCanvas}
          class="si-sig-canvas"
          width="400"
          height="120"
          aria-label="Signature pad — draw your signature here"
          onpointerdown={sigPointerDown}
          onpointermove={sigPointerMove}
          onpointerup={sigPointerUp}
          onpointerleave={sigPointerUp}
        ></canvas>
        <div class="si-sig-bar">
          <span class="si-sig-hint">{sigHasData ? '✓ Signature captured' : 'Draw signature above (optional)'}</span>
          <button class="si-sig-clear" type="button" onclick={sigClear} disabled={!sigHasData}>Clear</button>
        </div>
      </div>

      <div class="si-confirm-btns">
        <button class="si-btn ghost" type="button" onclick={cancelConfirm}>Cancel</button>
        <button class="si-btn confirm" type="button" onclick={() => void confirmSignInWithSig()}>
          Confirm Sign-In
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- SUCCESS FLASH -->
{#if successPerson}
  <div class="si-success">
    <div class="si-success-icon">{successPerson.action === 'in' ? '&#10003;' : '&#8617;'}</div>
    <div class="si-success-name">{successPerson.name}</div>
    <div class="si-success-time">
      {successPerson.action === 'in' ? 'Signed in' : 'Signed out'} at {successPerson.time}
    </div>
    <div class="si-success-msg">
      {successPerson.action === 'in' ? settings.confirmMsg : settings.signoutMsg}
    </div>
  </div>
{/if}

<style>
  .signin-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .si-header {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
  }
  .si-header h2 {
    font-family: var(--cond);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .si-info {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
  }

  /* Empty state */
  .si-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px;
  }
  .si-empty h3 {
    font-family: var(--cond);
    font-size: 24px;
    font-weight: 700;
    color: var(--accent);
  }
  .si-empty p {
    font-size: 14px;
    color: var(--text2);
    text-align: center;
    max-width: 400px;
    line-height: 1.6;
  }

  /* Card grid */
  .si-grid {
    flex: 1;
    display: grid;
    gap: 10px;
    padding: 10px;
    overflow-y: auto;
    align-content: start;
  }

  .si-card {
    background: var(--bg2);
    border: 2px solid var(--border2);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px 12px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, transform 0.1s;
    user-select: none;
    text-align: center;
    position: relative;
    min-height: 100px;
    font-family: inherit;
    color: inherit;
  }
  .si-card:not(.signed-in):hover {
    border-color: var(--accent);
    background: var(--bg3);
    transform: scale(0.98);
  }
  .si-card:not(.signed-in):active {
    transform: scale(0.95);
  }
  .si-card.signed-in {
    border-color: var(--success);
    background: rgba(52, 211, 153, 0.06);
    cursor: default;
  }

  .si-check {
    position: absolute;
    top: 8px;
    right: 10px;
    color: var(--success);
    font-size: 20px;
    font-weight: 700;
  }

  .si-name {
    font-family: var(--cond);
    font-size: clamp(14px, 2vw, 22px);
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
    word-break: break-word;
  }
  .si-card.signed-in .si-name { color: var(--text2); }

  .si-role {
    font-size: clamp(10px, 1.3vw, 14px);
    color: var(--text2);
    margin-top: 3px;
  }
  .si-call {
    font-family: var(--mono);
    font-size: clamp(10px, 1.2vw, 14px);
    color: var(--accent);
    margin-top: 5px;
  }
  .si-card.signed-in .si-call { color: var(--text3); }

  .si-time {
    font-size: clamp(9px, 1vw, 12px);
    color: var(--success);
    margin-top: 4px;
    font-family: var(--mono);
  }
  .si-time.out { color: var(--text3); }

  .si-signout-btn {
    margin-top: 6px;
    background: none;
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text2);
    font-size: clamp(9px, 1vw, 11px);
    padding: 3px 10px;
    cursor: pointer;
    transition: all 0.12s;
    font-family: var(--mono);
  }
  .si-signout-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Confirm overlay */
  .si-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .si-confirm {
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 16px;
    padding: 40px;
    text-align: center;
    max-width: 480px;
    width: 100%;
  }
  .si-confirm-name {
    font-family: var(--cond);
    font-size: clamp(32px, 6vw, 56px);
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.02em;
    line-height: 1.1;
  }
  .si-confirm-role {
    font-size: clamp(14px, 2vw, 20px);
    color: var(--text2);
    margin-top: 6px;
  }
  .si-confirm-meta {
    display: flex;
    gap: 24px;
    justify-content: center;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  .si-meta-item { display: flex; flex-direction: column; gap: 2px; }
  .si-meta-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text3);
  }
  .si-meta-val {
    font-family: var(--mono);
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
  }
  .si-confirm-prompt {
    font-size: 14px;
    color: var(--text2);
    margin-top: 24px;
  }
  .si-confirm-btns {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 24px;
  }
  .si-btn {
    padding: 12px 28px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    border: 1px solid;
    font-family: inherit;
  }
  .si-btn.ghost {
    background: transparent;
    color: var(--text2);
    border-color: var(--border2);
  }
  .si-btn.ghost:hover {
    background: var(--bg3);
    color: var(--text);
    border-color: var(--accent);
  }
  .si-btn.confirm {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .si-btn.confirm:hover {
    background: var(--accent2);
    border-color: var(--accent2);
  }

  /* Success flash */
  .si-success {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 400;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    animation: fade-in 0.2s ease;
  }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

  .si-success-icon {
    font-size: 80px;
    color: var(--success);
    animation: pop 0.35s ease;
  }
  @keyframes pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

  .si-success-name {
    font-family: var(--cond);
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 700;
    color: var(--text);
  }
  .si-success-time {
    font-family: var(--mono);
    font-size: 16px;
    color: var(--accent);
  }
  .si-success-msg {
    font-size: 14px;
    color: var(--text2);
  }

  /* Print button */
  .si-print-btn {
    margin-left: auto;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text2);
    font-size: 12px;
    padding: 5px 12px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .si-print-btn:hover { background: var(--bg4); color: var(--text); }

  /* Print-only table (hidden on screen) */
  .si-print-only { display: none; }
  @media print {
    .signin-tab > :not(.si-print-only) { display: none !important; }
    .si-print-only {
      display: block;
      font-family: Arial, sans-serif;
      color: #000;
      padding: 20px;
    }
    .si-print-hdr { text-align: center; margin-bottom: 16px; }
    .si-print-hdr h1 { font-size: 20px; margin: 0 0 4px; }
    .si-print-hdr p { font-size: 13px; color: #555; margin: 0; }
    .si-print-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .si-print-table th, .si-print-table td {
      border: 1px solid #ccc;
      padding: 5px 8px;
      text-align: left;
    }
    .si-print-table th { background: #f0f0f0; font-weight: 700; }
    .si-print-unsigned { color: #888; }
    .si-print-sig { height: 40px; max-width: 120px; display: block; }
    .si-print-nosig { color: #bbb; }
    .si-print-footer { margin-top: 12px; font-size: 10px; color: #888; text-align: center; }
  }

  /* Signature pad */
  .si-sig-wrap {
    margin-top: 12px;
    background: var(--bg3);
    border: 2px solid var(--border2);
    border-radius: 8px;
    overflow: hidden;
  }
  .si-sig-canvas {
    display: block;
    width: 100%;
    height: 120px;
    cursor: crosshair;
    touch-action: none;
    background: var(--bg3);
  }
  .si-sig-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg2);
  }
  .si-sig-hint {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text3);
    letter-spacing: 0.04em;
  }
  .si-sig-clear {
    background: none;
    border: 1px solid var(--border2);
    border-radius: 3px;
    color: var(--text3);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
    font-family: var(--mono);
  }
  .si-sig-clear:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
  .si-sig-clear:disabled { opacity: 0.35; cursor: default; }

  /* Responsive */
  @media (max-width: 640px) {
    .si-header { flex-wrap: wrap; padding: 10px 14px; }
    .si-grid { gap: 6px; padding: 6px; }
    .si-card { padding: 10px 8px; min-height: 80px; }
    .si-confirm { padding: 24px; }
  }

  /* Kiosk mode — full viewport, larger touch targets */
  .signin-tab.kiosk {
    height: 100vh;
  }
  .signin-tab.kiosk .si-header {
    padding: 14px 24px;
  }
  .signin-tab.kiosk .si-header h2 {
    font-size: 22px;
  }
  .signin-tab.kiosk .si-grid {
    gap: 14px;
    padding: 14px;
  }
  .signin-tab.kiosk .si-card {
    min-height: 120px;
    padding: 20px 16px;
    border-radius: 12px;
    border-width: 3px;
  }
  .signin-tab.kiosk .si-name {
    font-size: clamp(18px, 2.5vw, 28px);
  }
  .signin-tab.kiosk .si-role {
    font-size: clamp(12px, 1.5vw, 18px);
  }
  .signin-tab.kiosk .si-call {
    font-size: clamp(12px, 1.5vw, 18px);
  }
</style>
