<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as PS from '../lib/projectSettings';

  // ─── State ──────────────────────────────────────────────────────────
  let settings = $state<PS.ProjectSettings>(PS.load());
  let saveMsg = $state('');

  // ─── Derived ────────────────────────────────────────────────────────
  let isUnion = $derived(settings.union === 'union');
  let otThresholdsStr = $derived(settings.otThresholds.join(', '));

  // ─── Load ──────────────────────────────────────────────────────────
  onMount(() => {
    settings = PS.load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(PS.STORAGE_KEY)) settings = PS.load();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  async function toggleUnion() {
    const newStatus: PS.UnionStatus = isUnion ? 'non-union' : 'union';
    settings = PS.applyUnionDefaults(settings, newStatus);
    await PS.save(settings);
    flash('Switched to ' + (newStatus === 'union' ? 'Union' : 'Non-Union') + ' defaults');
  }

  async function onSave() {
    await PS.save(settings);
    flash('Settings saved');
  }

  function flash(msg: string) {
    saveMsg = msg;
    setTimeout(() => saveMsg = '', 2000);
  }

  function parseOTThresholds(val: string) {
    settings.otThresholds = val
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);
  }

  function parseBumps(val: string) {
    settings.bgBumpCategories = val
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
</script>

<div class="settings-tab">
  <div class="toolbar">
    <h2>Project Settings</h2>
    {#if saveMsg}<span class="save-msg">{saveMsg}</span>{/if}
  </div>

  <div class="settings-scroll">
    <!-- Union Toggle — the big one -->
    <section class="section">
      <h3 class="section-title">Production Type</h3>
      <div class="toggle-row">
        <button
          class="union-toggle"
          class:active={!isUnion}
          onclick={toggleUnion}
        >
          <span class="ut-label">Non-Union</span>
          <span class="ut-desc">Flexible timing, no SAG rules enforced</span>
        </button>
        <button
          class="union-toggle"
          class:active={isUnion}
          onclick={toggleUnion}
        >
          <span class="ut-label">Union (SAG-AFTRA)</span>
          <span class="ut-desc">Strict meal penalties, turnaround, Exhibit G</span>
        </button>
      </div>
      <p class="hint">Switching resets timing defaults. You can still customize everything below.</p>
    </section>

    <!-- Meal Penalty -->
    <section class="section">
      <h3 class="section-title">Meal Penalty</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="ps-meal-due">Meal Due After (minutes)</label>
          <input id="ps-meal-due" type="number" bind:value={settings.mealDueMins} min="60" max="720" class="field-input num" onblur={onSave} />
          <span class="field-hint">{Math.floor(settings.mealDueMins / 60)}h {settings.mealDueMins % 60}m from last meal or first shot</span>
        </div>
        <div class="field">
          <label class="field-label" for="ps-grace">Grace Period (minutes)</label>
          <input id="ps-grace" type="number" bind:value={settings.graceMins} min="0" max="30" class="field-input num" onblur={onSave} />
          <span class="field-hint">{isUnion ? 'SAG standard: 6 minutes' : 'Set to 0 for no grace period'}</span>
        </div>
      </div>
    </section>

    <!-- Overtime -->
    <section class="section">
      <h3 class="section-title">Overtime</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="ps-ot-enabled">OT Tracking</label>
          <label class="switch">
            <input id="ps-ot-enabled" type="checkbox" bind:checked={settings.otEnabled} onchange={onSave} />
            <span class="slider"></span>
            <span class="switch-label">{settings.otEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        <div class="field">
          <label class="field-label" for="ps-ot-thresholds">OT Thresholds (hours, comma-separated)</label>
          <input
            id="ps-ot-thresholds"
            type="text"
            value={otThresholdsStr}
            class="field-input"
            placeholder="8, 10, 12, 14"
            onblur={(e) => { parseOTThresholds((e.target as HTMLInputElement).value); void onSave(); }}
          />
          <span class="field-hint">{isUnion ? 'Union standard: 8, 10, 12, 14' : 'Common: 8, 10, 12'}</span>
        </div>
      </div>
    </section>

    <!-- Turnaround -->
    <section class="section">
      <h3 class="section-title">Turnaround</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="ps-turn-hours">Minimum Rest (hours)</label>
          <input id="ps-turn-hours" type="number" bind:value={settings.turnaroundHours} min="0" max="24" class="field-input num" onblur={onSave} />
          <span class="field-hint">{isUnion ? 'SAG: 10h (12h after night work)' : 'Industry standard: 10h'}</span>
        </div>
        <div class="field">
          <label class="field-label" for="ps-turn-enforced">Enforce Turnaround</label>
          <label class="switch">
            <input id="ps-turn-enforced" type="checkbox" bind:checked={settings.turnaroundEnforced} onchange={onSave} />
            <span class="slider"></span>
            <span class="switch-label">{settings.turnaroundEnforced ? 'Warn on violations' : 'Track only'}</span>
          </label>
        </div>
      </div>
    </section>

    <!-- Background / Extras -->
    <section class="section">
      <h3 class="section-title">Background / Extras</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="ps-bg-voucher">Require Vouchers</label>
          <label class="switch">
            <input id="ps-bg-voucher" type="checkbox" bind:checked={settings.bgVoucherRequired} onchange={onSave} />
            <span class="slider"></span>
            <span class="switch-label">{settings.bgVoucherRequired ? 'SAG Vouchers' : 'Simple Check-In'}</span>
          </label>
        </div>
        <div class="field full">
          <label class="field-label" for="ps-bump-cats">Bump Categories (one per line)</label>
          <textarea
            id="ps-bump-cats"
            class="field-ta"
            rows="4"
            value={settings.bgBumpCategories.join('\n')}
            onblur={(e) => { parseBumps((e.target as HTMLTextAreaElement).value); void onSave(); }}
          ></textarea>
          <span class="field-hint">{settings.bgBumpCategories.length} categories configured</span>
        </div>
      </div>
    </section>

    <!-- Time Sheet -->
    <section class="section">
      <h3 class="section-title">Time Sheets</h3>
      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="ps-ts-label">Time Sheet Label</label>
          <input id="ps-ts-label" type="text" bind:value={settings.timeSheetLabel} class="field-input" onblur={onSave} />
          <span class="field-hint">{isUnion ? 'Standard: "Exhibit G"' : 'Common: "Time Sheet" or "Daily Time Report"'}</span>
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .settings-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .toolbar {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .toolbar h2 {
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .save-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  .settings-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ─── Sections ─── */
  .section {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
  }
  .section-title {
    font-family: var(--cond);
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    margin-bottom: 12px;
  }
  .hint {
    font-size: 11px;
    color: var(--text3);
    margin-top: 8px;
    line-height: 1.4;
  }

  /* ─── Union toggle ─── */
  .toggle-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .union-toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 16px;
    border: 2px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
  }
  .union-toggle:hover { border-color: var(--accent); }
  .union-toggle.active {
    border-color: var(--accent);
    background: rgba(167, 139, 250, 0.08);
  }
  .ut-label {
    font-family: var(--cond);
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.03em;
  }
  .union-toggle.active .ut-label { color: var(--accent); }
  .ut-desc {
    font-size: 11px;
    color: var(--text3);
    line-height: 1.3;
  }

  /* ─── Fields ─── */
  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.full { grid-column: 1 / -1; }
  .field-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .field-input {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 7px 10px;
    font-size: 13px;
    color: var(--text);
    font-family: var(--font);
  }
  .field-input.num { width: 100px; font-family: var(--mono); }
  .field-input:focus { border-color: var(--accent); outline: none; }
  .field-ta {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--mono);
    resize: vertical;
    line-height: 1.5;
  }
  .field-ta:focus { border-color: var(--accent); outline: none; }
  .field-hint {
    font-size: 10px;
    color: var(--text3);
    font-family: var(--mono);
  }

  /* ─── Switch toggle ─── */
  .switch {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .switch input { display: none; }
  .slider {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--border);
    border-radius: 10px;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .slider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--text3);
    border-radius: 50%;
    transition: all 0.2s;
  }
  .switch input:checked + .slider {
    background: var(--accent);
  }
  .switch input:checked + .slider::before {
    left: 18px;
    background: var(--bg);
  }
  .switch-label {
    font-size: 12px;
    color: var(--text2);
  }

  @media (max-width: 640px) {
    .settings-scroll { padding: 10px 12px; }
    .toggle-row { grid-template-columns: 1fr; }
    .field-grid { grid-template-columns: 1fr; }
  }
</style>
