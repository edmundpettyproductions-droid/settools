<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as sync from '../lib/sync';
  import type { UHState } from '../lib/types';
  import * as extract from '../lib/extract';
  import * as T from '../lib/tracker';

  const UH_KEY = 'settools_uh';
  const TIME_KEYS = new Set<keyof UHState>(['callTime', 'firstShot']);

  // Field metadata — ordered for display
  type FieldKey = keyof UHState;
  interface FieldDef {
    key: FieldKey;
    prefix?: string;    // label prefix shown before value (e.g. "Day ", "Ep ", "Dir: ")
    icon?: string;      // emoji icon (replaces prefix for time + location)
    placeholder: string;
    inputWidth: string; // CSS width for the <input> while editing
    bold?: boolean;     // production name shown bold
  }
  const FIELDS: FieldDef[] = [
    { key: 'production', placeholder: 'Production',  inputWidth: '130px', bold: true },
    { key: 'shootDay',   prefix: 'Day ',  placeholder: '—',        inputWidth: '44px'  },
    { key: 'episode',    prefix: 'Ep ',   placeholder: '—',        inputWidth: '44px'  },
    { key: 'callTime',   icon: '📞',      placeholder: '07:00',    inputWidth: '54px'  },
    { key: 'firstShot',  icon: '🎬',      placeholder: '09:00',    inputWidth: '54px'  },
    { key: 'location',   icon: '📍',      placeholder: 'Location', inputWidth: '160px' },
    { key: 'director',   prefix: 'Dir: ', placeholder: 'Director', inputWidth: '110px' },
  ];

  let uh = $state<UHState>({});
  let editingField = $state<FieldKey | null>(null);
  let editVal = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  function load() {
    uh = sync.getJSON<UHState>(UH_KEY) ?? {};
  }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(UH_KEY)) load();
    });
    return () => unsub();
  });

  async function startEdit(field: FieldKey) {
    if (editingField === field) return;
    // Commit any pending edit before switching fields
    if (editingField) await commitEdit();
    editingField = field;
    editVal = uh[field] ?? '';
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  function cancelEdit() {
    editingField = null;
    editVal = '';
  }

  async function commitEdit() {
    if (!editingField) return;
    const field = editingField;
    let val = editVal.trim();
    if (TIME_KEYS.has(field)) val = normTime(val);

    editingField = null;
    editVal = '';

    // Build updated state — omit empty fields
    const updated: UHState = { ...uh };
    if (val) {
      (updated as Record<string, string>)[field] = val;
    } else {
      delete (updated as Record<string, string | undefined>)[field];
    }
    uh = updated;
    await sync.set(UH_KEY, JSON.stringify(updated));
  }

  function normTime(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

    // AM/PM: "7:30am", "7pm", "7:30 PM"
    const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(s);
    if (ampm?.[1] != null && ampm[3] != null) {
      let h = parseInt(ampm[1], 10);
      const m = ampm[2] != null ? parseInt(ampm[2], 10) : 0;
      const period = ampm[3].toLowerCase();
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      if (h <= 23 && m <= 59) return fmt(h, m);
    }
    // HH:MM already
    const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (colon?.[1] != null && colon[2] != null) {
      const h = parseInt(colon[1], 10), m = parseInt(colon[2], 10);
      if (h <= 23 && m <= 59) return fmt(h, m);
    }
    // H:M (single minute digit) e.g. "7:3" → "07:30"
    const shortColon = /^(\d{1,2}):(\d)$/.exec(s);
    if (shortColon?.[1] != null && shortColon[2] != null) {
      const h = parseInt(shortColon[1], 10), m = parseInt(shortColon[2], 10) * 10;
      if (h <= 23 && m <= 59) return fmt(h, m);
    }
    // 3-4 digit: "730" → "07:30", "1430" → "14:30"
    if (/^\d{3,4}$/.test(s)) {
      const n = parseInt(s, 10), h = Math.floor(n / 100), m = n % 100;
      if (h <= 23 && m <= 59) return fmt(h, m);
    }
    // Single 1-2 digit hour: "7" → "07:00"
    if (/^\d{1,2}$/.test(s)) {
      const h = parseInt(s, 10);
      if (h <= 23) return fmt(h, 0);
    }
    return raw; // unrecognized — keep as typed
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); void commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    if (e.key === 'Tab')    { e.preventDefault(); void commitEditThenAdvance(e.shiftKey); }
  }

  async function commitEditThenAdvance(reverse: boolean) {
    const currentField = editingField;
    if (!currentField) return;
    await commitEdit();
    const idx = FIELDS.findIndex((f) => f.key === currentField);
    const nextIdx = reverse ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < FIELDS.length) {
      const nextKey = FIELDS[nextIdx]?.key;
      if (nextKey) await startEdit(nextKey);
    }
  }

  function displayVal(f: FieldDef): string {
    return uh[f.key] ?? '';
  }

  // ─── Call Sheet Upload ────────────────────────────────────────────
  let csFileInput = $state<HTMLInputElement | null>(null);
  let csStatus = $state<{ type: 'loading' | 'ok' | 'err'; msg: string } | null>(null);
  let csUploading = $state(false);

  function onCsFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void processCallSheet(file);
    input.value = '';
  }

  async function processCallSheet(file: File) {
    // Warn before overwriting existing cast/crew data
    const existingCast = T.loadTracker('settools_cast');
    const existingCrew = T.loadTracker('settools_crew');
    const namedCast = existingCast.rows.filter((r) => r.name.trim()).length;
    const namedCrew = existingCrew.rows.filter((r) => r.name.trim()).length;
    if (namedCast > 0 || namedCrew > 0) {
      const ok = window.confirm(
        `Uploading a call sheet will replace your existing data:\n` +
        `  • ${namedCast} cast member${namedCast !== 1 ? 's' : ''}\n` +
        `  • ${namedCrew} crew member${namedCrew !== 1 ? 's' : ''}\n\n` +
        `Arrival times, wrap times, and meal times will be lost.\nContinue?`
      );
      if (!ok) return;
    }

    csUploading = true;
    csStatus = { type: 'loading', msg: 'Reading PDF...' };
    try {
      const b64 = await extract.fileToBase64(file);

      // Extract BOTH cast and crew in one prompt
      csStatus = { type: 'loading', msg: 'Extracting cast & crew...' };
      const system = 'You extract cast AND crew data from film/TV call sheets. Return ONLY raw JSON, no markdown.';
      const prompt = `Extract from this call sheet and return exactly this JSON structure (no markdown):
{"cast":[{"id":"","name":"","role":"","callTime":"","onSetTime":""}],
"crew":[{"id":"","name":"","role":"","callTime":"","onSetTime":""}],
"header":{"production":"","episode":"","director":"","callTime":"","location":"","shootDay":""}}
cast: actors/performers only. role=character name. crew: department staff only. role=job title/dept.
id=badge/ID or empty. callTime/onSetTime=HH:MM 24h. header fields: empty string if not found.`;

      const rawResp = await extract.extractFromPdf(b64, prompt, { system });
      const result = extract.parseJsonResponse<{
        cast?: T.ExtractedPerson[];
        crew?: T.ExtractedPerson[];
        header?: T.ExtractResult['header'];
      }>(rawResp);

      let castCount = 0, crewCount = 0;

      // Load existing trackers to replace
      if (result.cast?.length) {
        const castData = T.loadTracker('settools_cast');
        let nid = castData.nid;
        const newRows: T.TrackerRow[] = [];
        for (const p of result.cast) {
          newRows.push(T.mkRow(nid++, {
            empId: String(p.id ?? ''),
            name: String(p.name ?? ''),
            role: String(p.role ?? ''),
            callTime: T.normTime(String(p.callTime ?? '')),
            onSetTime: T.normTime(String(p.onSetTime ?? '')),
          }));
        }
        castCount = newRows.length;
        await T.saveTracker('settools_cast', { rows: newRows, nid });
      }

      if (result.crew?.length) {
        const crewData = T.loadTracker('settools_crew');
        let nid = crewData.nid;
        const newRows: T.TrackerRow[] = [];
        for (const p of result.crew) {
          newRows.push(T.mkRow(nid++, {
            empId: String(p.id ?? ''),
            name: String(p.name ?? ''),
            role: String(p.role ?? ''),
            callTime: T.normTime(String(p.callTime ?? '')),
            onSetTime: T.normTime(String(p.onSetTime ?? '')),
          }));
        }
        crewCount = newRows.length;
        await T.saveTracker('settools_crew', { rows: newRows, nid });
      }

      // Merge header into UH
      if (result.header) {
        await T.mergeExtractedHeader(result.header);
        load(); // refresh UH display
      }

      csStatus = { type: 'ok', msg: `✓ ${castCount} cast, ${crewCount} crew` };
      setTimeout(() => { csStatus = null; }, 5000);
    } catch (e) {
      csStatus = { type: 'err', msg: e instanceof Error ? e.message.slice(0, 60) : String(e) };
    } finally {
      csUploading = false;
    }
  }
</script>

<div class="uh-bar" role="toolbar" aria-label="Universal header — production info">
  {#each FIELDS as f, i (f.key)}
    {#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}

    <div class="field" class:is-editing={editingField === f.key}>
      {#if f.icon}
        <!-- Icon-prefixed field (time, location) -->
        <span class="icon">{f.icon}</span>
      {:else if f.prefix}
        <!-- Label-prefixed field (Day, Ep, Dir) -->
        <span class="lbl">{f.prefix}</span>
      {/if}

      {#if editingField === f.key}
        <input
          bind:this={inputEl}
          bind:value={editVal}
          class="edit-input"
          style:width={f.inputWidth}
          onkeydown={onKeydown}
          onblur={() => void commitEdit()}
          placeholder={f.placeholder}
          spellcheck={false}
          autocomplete="off"
        />
      {:else}
        <button
          class="val"
          class:empty={!displayVal(f)}
          class:bold={f.bold}
          onclick={() => void startEdit(f.key)}
          title="Click to edit {f.prefix ?? f.icon ?? f.key}"
        >{displayVal(f) || f.placeholder}</button>
      {/if}
    </div>
  {/each}

  <div class="actions">
    <button
      class="upload-btn"
      class:uploading={csUploading}
      title="Upload call sheet PDF to populate header, cast & crew"
      disabled={csUploading}
      onclick={() => csFileInput?.click()}
    >
      {csUploading ? '⏳ Extracting...' : '📋 Call Sheet'}
    </button>
    <input
      bind:this={csFileInput}
      type="file"
      accept=".pdf"
      onchange={onCsFileChange}
      style="position:fixed;left:-9999px;width:0;height:0;opacity:0"
    />
    {#if csStatus}
      <span class="cs-status {csStatus.type}" title={csStatus.msg}>
        {csStatus.msg}
      </span>
    {/if}
  </div>
</div>

<style>
  .uh-bar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 20px;
    height: 34px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text2);
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .uh-bar::-webkit-scrollbar { display: none; }

  .sep {
    color: var(--border);
    margin: 0 8px;
    user-select: none;
    flex-shrink: 0;
  }

  .field {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    position: relative;
  }

  .icon {
    font-size: 11px;
    line-height: 1;
    opacity: 0.8;
    flex-shrink: 0;
  }

  .lbl {
    color: var(--text3);
    font-size: 11px;
    flex-shrink: 0;
  }

  .val {
    background: none;
    border: none;
    border-bottom: 1px dashed transparent;
    padding: 1px 2px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
    border-radius: 2px;
    line-height: 1.4;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .val:hover {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }
  .val.empty {
    color: var(--text3);
    font-style: italic;
  }
  .val.bold {
    font-family: var(--font);
    font-weight: 700;
    font-size: 12px;
    color: var(--text);
    letter-spacing: 0.02em;
  }
  .val.bold:hover { color: var(--accent); }

  .edit-input {
    background: var(--bg2);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
    outline: none;
    box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
    min-width: 40px;
    line-height: 1.4;
  }
  .edit-input::placeholder { color: var(--text3); font-style: italic; }

  .actions {
    margin-left: auto;
    flex-shrink: 0;
    padding-left: 16px;
  }

  .upload-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 10px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
  }
  .upload-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .upload-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .upload-btn.uploading {
    color: var(--accent);
    border-color: var(--accent);
    animation: pulse-btn 1.5s ease infinite;
  }
  @keyframes pulse-btn {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  .cs-status {
    font-family: var(--mono);
    font-size: 10px;
    white-space: nowrap;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cs-status.loading { color: var(--text2); }
  .cs-status.ok { color: var(--success); }
  .cs-status.err { color: var(--danger); }

  /* Responsive: on very small screens let it scroll */
  @media (max-width: 640px) {
    .uh-bar { padding: 0 12px; }
  }
</style>
