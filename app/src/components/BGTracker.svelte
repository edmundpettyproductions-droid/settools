<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as BG from '../lib/bgTracker';

  // ─── State ──────────────────────────────────────────────────────────
  let data = $state<BG.BGState>(BG.load());
  let copyMsg = $state('');
  let bumpPickerId = $state<number | null>(null);
  let voucherMode = $state(BG.isVoucherMode());

  // ─── Derived ────────────────────────────────────────────────────────
  let summary = $derived(BG.summarize(data.performers));
  let bumpCategories = $derived(BG.getBumpCategories());

  // ─── Load / Save ───────────────────────────────────────────────────
  function reload() {
    data = BG.load();
    voucherMode = BG.isVoucherMode();
  }
  async function save() { await BG.save(data); }

  onMount(() => {
    reload();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(BG.STORAGE_KEY)) reload();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  function addPerformer() {
    BG.addPerformer(data);
    data = data;
    void save();
  }

  function removePerformer(id: number) {
    BG.removePerformer(data, id);
    data = data;
    void save();
  }

  function doCheckIn(p: BG.BGPerformer) {
    BG.checkIn(p);
    data = data;
    void save();
  }

  function doCheckOut(p: BG.BGPerformer) {
    BG.checkOut(p);
    data = data;
    void save();
  }

  function sendToMeal() {
    const now = new Date();
    const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    for (const p of data.performers) {
      if (p.checkedIn && !p.checkOutTime && !p.mealIn) {
        p.mealIn = hhmm;
      }
    }
    data = data;
    void save();
  }

  function returnFromMeal() {
    const now = new Date();
    const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    for (const p of data.performers) {
      if (p.mealIn && !p.mealOut) {
        p.mealOut = hhmm;
      }
    }
    data = data;
    void save();
  }

  function wrapAll() {
    for (const p of data.performers) {
      if (p.checkedIn && !p.checkOutTime) BG.checkOut(p);
    }
    data = data;
    void save();
  }

  function toggleBump(p: BG.BGPerformer, cat: string) {
    if (p.bumps.includes(cat)) {
      BG.removeBump(p, cat);
    } else {
      BG.addBump(p, cat);
    }
    data = data;
    void save();
  }

  function incWardrobe(p: BG.BGPerformer) {
    p.wardrobeChanges++;
    data = data;
    void save();
  }

  function decWardrobe(p: BG.BGPerformer) {
    if (p.wardrobeChanges > 0) p.wardrobeChanges--;
    data = data;
    void save();
  }

  async function copyLog() {
    const text = BG.formatText(data);
    try {
      await navigator.clipboard.writeText(text);
      copyMsg = 'Copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  function onBlur() { void save(); }
</script>

<div class="bg-tab">
  <div class="toolbar">
    <h2>Background</h2>
    <span class="count-badge">{summary.checkedIn}/{summary.total} in</span>
    {#if summary.wrapped > 0}
      <span class="wrap-badge">{summary.wrapped} wrapped</span>
    {/if}
    {#if summary.withBumps > 0}
      <span class="bump-badge">{summary.totalBumps} bumps</span>
    {/if}
    <div class="toolbar-actions">
      <button class="tb-btn" onclick={addPerformer}>+ Add</button>
      <button class="tb-btn" onclick={sendToMeal}>Meal Out</button>
      <button class="tb-btn" onclick={returnFromMeal}>Meal Back</button>
      <button class="tb-btn" onclick={wrapAll}>Wrap All</button>
      <button class="tb-btn" onclick={copyLog}>Copy</button>
      {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
    </div>
  </div>

  <!-- Header fields -->
  <div class="header-fields">
    <div class="hf">
      <label class="hf-label" for="bg-date">Date</label>
      <input id="bg-date" type="date" bind:value={data.date} class="hf-input" onblur={onBlur} />
    </div>
    <div class="hf">
      <label class="hf-label" for="bg-call">BG Call</label>
      <input id="bg-call" type="time" bind:value={data.generalCall} class="hf-input" onblur={onBlur} />
    </div>
    <div class="hf grow">
      <label class="hf-label" for="bg-holding">Holding Location</label>
      <input id="bg-holding" bind:value={data.holdingLocation} class="hf-input" placeholder="Base camp tent, etc." onblur={onBlur} />
    </div>
  </div>

  <!-- Performer list -->
  <div class="performers-scroll">
    {#if data.performers.length === 0}
      <div class="empty">
        <p>No background performers added yet.</p>
        <p>Click <strong>+ Add</strong> to start checking in BG.</p>
      </div>
    {:else}
      {#each data.performers as p (p.id)}
        <div class="performer-card" class:checked-in={p.checkedIn} class:wrapped={!!p.checkOutTime}>
          <!-- Row 1: Name, voucher, check-in -->
          <div class="pc-top">
            <input
              class="pc-name"
              bind:value={p.name}
              placeholder="Name"
              onblur={onBlur}
            />
            {#if voucherMode}
              <input
                class="pc-voucher"
                bind:value={p.voucherNum}
                placeholder="Voucher #"
                onblur={onBlur}
              />
            {:else}
              <input
                class="pc-voucher"
                bind:value={p.voucherNum}
                placeholder="Badge #"
                onblur={onBlur}
              />
            {/if}
            <input
              class="pc-rate"
              bind:value={p.rate}
              placeholder="Rate"
              onblur={onBlur}
            />
            <div class="pc-check">
              {#if !p.checkedIn}
                <button class="check-btn in" onclick={() => doCheckIn(p)}>Check In</button>
              {:else if !p.checkOutTime}
                <button class="check-btn out" onclick={() => doCheckOut(p)}>Wrap</button>
              {:else}
                <span class="check-done">Wrapped</span>
              {/if}
            </div>
            <button class="remove-btn" title="Remove" onclick={() => removePerformer(p.id)}>✕</button>
          </div>

          <!-- Row 2: Times -->
          <div class="pc-times">
            <div class="time-field">
              <span class="tf-label">Call</span>
              <input type="time" bind:value={p.callTime} class="tf-input" onblur={onBlur} />
            </div>
            <div class="time-field">
              <span class="tf-label">In</span>
              <span class="tf-value">{BG.fmt12(p.checkInTime)}</span>
            </div>
            <div class="time-field">
              <span class="tf-label">Out</span>
              <span class="tf-value">{BG.fmt12(p.checkOutTime)}</span>
            </div>
            <div class="time-field">
              <span class="tf-label">Hours</span>
              <span class="tf-value">{BG.hoursWorked(p)}</span>
            </div>
            {#if p.mealIn}
              <div class="time-field">
                <span class="tf-label">Meal</span>
                <span class="tf-value">{BG.fmt12(p.mealIn)}{p.mealOut ? ` → ${BG.fmt12(p.mealOut)}` : ' (out)'}</span>
              </div>
            {/if}
          </div>

          <!-- Row 3: Wardrobe, bumps, scenes, notes -->
          <div class="pc-details">
            <div class="detail-group">
              <span class="dg-label">W/C</span>
              <div class="counter">
                <button class="counter-btn" onclick={() => decWardrobe(p)} disabled={p.wardrobeChanges <= 0}>−</button>
                <span class="counter-val">{p.wardrobeChanges}</span>
                <button class="counter-btn" onclick={() => incWardrobe(p)}>+</button>
              </div>
            </div>

            <div class="detail-group grow">
              <span class="dg-label">Bumps</span>
              <div class="bump-chips">
                {#each p.bumps as b (b)}
                  <button class="bump-chip active" onclick={() => toggleBump(p, b)}>{b} ✕</button>
                {/each}
                <button class="bump-add" onclick={() => bumpPickerId = bumpPickerId === p.id ? null : p.id}>+ Bump</button>
              </div>
              {#if bumpPickerId === p.id}
                <div class="bump-picker">
                  {#each bumpCategories as cat (cat)}
                    <button
                      class="bp-option"
                      class:selected={p.bumps.includes(cat)}
                      onclick={() => toggleBump(p, cat)}
                    >{cat}</button>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="detail-group">
              <span class="dg-label">Scenes</span>
              <input class="detail-input sm" bind:value={p.scenes} placeholder="1, 5, 12" onblur={onBlur} />
            </div>

            <div class="detail-group grow">
              <span class="dg-label">Notes</span>
              <input class="detail-input" bind:value={p.notes} placeholder="Notes" onblur={onBlur} />
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Summary bar -->
  {#if data.performers.length > 0}
    <div class="summary-bar">
      <span>Total: {summary.total}</span>
      <span>In: {summary.checkedIn}</span>
      <span>Wrapped: {summary.wrapped}</span>
      {#if summary.atMeal > 0}<span class="at-meal">At Meal: {summary.atMeal}</span>{/if}
      <span>W/C: {summary.totalWardrobeChanges}</span>
      <span>Bumps: {summary.totalBumps}</span>
    </div>
  {/if}
</div>

<style>
  .bg-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ─── Toolbar ─── */
  .toolbar {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .toolbar h2 {
    font-family: var(--cond);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .count-badge, .wrap-badge, .bump-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid;
  }
  .count-badge { background: rgba(52, 211, 153, 0.1); color: var(--success); border-color: rgba(52, 211, 153, 0.2); }
  .wrap-badge { background: rgba(167, 139, 250, 0.1); color: var(--accent); border-color: rgba(167, 139, 250, 0.2); }
  .bump-badge { background: rgba(251, 191, 36, 0.1); color: var(--warning); border-color: rgba(251, 191, 36, 0.2); }
  .toolbar-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; flex-wrap: wrap; }
  .tb-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.12s;
  }
  .tb-btn:hover { border-color: var(--accent); color: var(--accent); }
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── Header fields ─── */
  .header-fields {
    display: flex;
    gap: 10px;
    padding: 8px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .hf { display: flex; flex-direction: column; gap: 2px; }
  .hf.grow { flex: 1; }
  .hf-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .hf-input {
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
  }
  .hf-input:focus { border-color: var(--accent); outline: none; }

  /* ─── Performer list ─── */
  .performers-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; margin-bottom: 8px; }

  /* ─── Performer card ─── */
  .performer-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.12s;
  }
  .performer-card:hover { border-color: rgba(167, 139, 250, 0.3); }
  .performer-card.checked-in { border-left: 3px solid var(--success); }
  .performer-card.wrapped { border-left: 3px solid var(--accent); opacity: 0.7; }

  .pc-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pc-name {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border2);
    padding: 4px 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font);
    outline: none;
  }
  .pc-name:focus { border-color: var(--accent); }
  .pc-voucher, .pc-rate {
    width: 80px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border2);
    padding: 4px 2px;
    font-size: 12px;
    color: var(--text2);
    font-family: var(--mono);
    outline: none;
    text-align: center;
  }
  .pc-voucher:focus, .pc-rate:focus { border-color: var(--accent); }

  .pc-check { flex-shrink: 0; }
  .check-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    border: 1px solid;
    font-family: var(--font);
  }
  .check-btn.in { background: rgba(52, 211, 153, 0.1); color: var(--success); border-color: rgba(52, 211, 153, 0.3); }
  .check-btn.in:hover { background: rgba(52, 211, 153, 0.2); }
  .check-btn.out { background: rgba(167, 139, 250, 0.1); color: var(--accent); border-color: rgba(167, 139, 250, 0.3); }
  .check-btn.out:hover { background: rgba(167, 139, 250, 0.2); }
  .check-done { font-family: var(--mono); font-size: 10px; color: var(--text3); }

  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text3);
    padding: 2px;
    opacity: 0.3;
    transition: all 0.12s;
  }
  .performer-card:hover .remove-btn { opacity: 1; }
  .remove-btn:hover { color: var(--danger); }

  /* ─── Times row ─── */
  .pc-times {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }
  .time-field { display: flex; align-items: center; gap: 4px; }
  .tf-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    color: var(--text3);
  }
  .tf-input {
    background: transparent;
    border: 1px solid var(--border2);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    color: var(--text);
    font-family: var(--mono);
  }
  .tf-input:focus { border-color: var(--accent); outline: none; }
  .tf-value { font-family: var(--mono); font-size: 11px; color: var(--text2); }

  /* ─── Details row ─── */
  .pc-details {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .detail-group { display: flex; align-items: center; gap: 4px; }
  .detail-group.grow { flex: 1; min-width: 120px; flex-wrap: wrap; }
  .dg-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    color: var(--text3);
    flex-shrink: 0;
  }
  .detail-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border2);
    padding: 2px 4px;
    font-size: 11px;
    color: var(--text2);
    font-family: var(--font);
    outline: none;
    flex: 1;
    min-width: 60px;
  }
  .detail-input.sm { width: 70px; flex: none; }
  .detail-input:focus { border-color: var(--accent); }

  /* ─── Counter ─── */
  .counter { display: flex; align-items: center; gap: 2px; }
  .counter-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    width: 20px;
    height: 20px;
    font-size: 12px;
    color: var(--text2);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.1s;
    padding: 0;
  }
  .counter-btn:hover { border-color: var(--accent); color: var(--accent); }
  .counter-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .counter-val { font-family: var(--mono); font-size: 12px; color: var(--text); min-width: 18px; text-align: center; }

  /* ─── Bumps ─── */
  .bump-chips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
  .bump-chip {
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.1s;
  }
  .bump-chip.active {
    background: rgba(251, 191, 36, 0.12);
    color: var(--warning);
    border-color: rgba(251, 191, 36, 0.3);
  }
  .bump-add {
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px dashed var(--border);
    background: none;
    color: var(--text3);
    cursor: pointer;
  }
  .bump-add:hover { border-color: var(--accent); color: var(--accent); }

  .bump-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
    padding: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 100%;
  }
  .bp-option {
    font-family: var(--mono);
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text2);
    cursor: pointer;
    transition: all 0.1s;
  }
  .bp-option:hover { border-color: var(--accent); color: var(--accent); }
  .bp-option.selected { background: rgba(251, 191, 36, 0.12); color: var(--warning); border-color: rgba(251, 191, 36, 0.3); }

  /* ─── Summary bar ─── */
  .summary-bar {
    display: flex;
    gap: 16px;
    padding: 6px 16px;
    background: var(--bg2);
    border-top: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 10px;
    color: var(--text2);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .at-meal { color: var(--warning); }

  @media (max-width: 640px) {
    .header-fields { flex-direction: column; }
    .pc-top { flex-wrap: wrap; }
    .pc-name { min-width: 100%; }
    .pc-details { flex-direction: column; }
  }
</style>
