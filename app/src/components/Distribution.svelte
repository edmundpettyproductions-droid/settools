<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as D from '../lib/distro';
  import * as NC from '../lib/nextCall';

  // ─── State ──────────────────────────────────────────────────────────
  let data = $state<D.DistroState>(D.loadDistro());
  let ncData = $state<NC.NextCallData>(NC.loadNextCall());
  let view = $state<'compose' | 'recipients'>('compose');
  let emailBody = $state('');
  let copyMsg = $state('');

  // ─── Derived ────────────────────────────────────────────────────────
  let includedCount = $derived(data.recipients.filter((r) => r.included).length);
  let totalCount = $derived(data.recipients.length);

  // ─── Load / Save ───────────────────────────────────────────────────
  function load() {
    data = D.loadDistro();
    ncData = NC.loadNextCall();
    if (!data.subject) data.subject = D.generateSubject(ncData);
  }

  async function save() { await D.saveDistro(data); }

  onMount(() => {
    load();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(D.STORAGE_KEY)) data = D.loadDistro();
      if (keys.includes(NC.STORAGE_KEY)) ncData = NC.loadNextCall();
    });
    return () => unsub();
  });

  // ─── Actions ───────────────────────────────────────────────────────
  async function refreshRecipients() {
    const fresh = D.buildRecipients();
    // Merge: keep existing inclusion state, add new ones
    const existing = new Map(data.recipients.map((r) => [r.email.toLowerCase(), r]));
    for (const r of fresh) {
      const ex = existing.get(r.email.toLowerCase());
      if (ex) r.included = ex.included;
    }
    data.recipients = fresh;
    data = data;
    await save();
  }

  function generateEmail() {
    data.subject = D.generateSubject(ncData);
    emailBody = D.generateEmailBody(ncData, data.bodyPrefix, data.bodySuffix);
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(emailBody);
      copyMsg = 'Body copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  async function copyRecipients() {
    const list = D.emailList(data.recipients);
    try {
      await navigator.clipboard.writeText(list);
      copyMsg = 'Recipients copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  function openMailto() {
    if (!emailBody) generateEmail();
    const url = D.buildMailto(data.recipients, data.subject, emailBody);
    window.open(url, '_blank');
  }

  function toggleAll(included: boolean) {
    for (const r of data.recipients) r.included = included;
    data = data;
    void save();
  }

  function onBlur() { void save(); }
</script>

<div class="dist-tab">
  <div class="toolbar">
    <h2>Distribution</h2>
    <span class="count-badge">{includedCount}/{totalCount} recipients</span>
    <div class="toolbar-actions">
      <button class="tb-btn" class:active={view === 'compose'} onclick={() => view = 'compose'}>Compose</button>
      <button class="tb-btn" class:active={view === 'recipients'} onclick={() => view = 'recipients'}>Recipients</button>
      <button class="tb-btn" onclick={refreshRecipients}>Refresh List</button>
    </div>
  </div>

  {#if view === 'compose'}
    <div class="compose-scroll">
      <!-- Subject -->
      <div class="field-row">
        <label class="fld-label" for="dist-subject">Subject</label>
        <input id="dist-subject" bind:value={data.subject} class="fld-full" placeholder="Call sheet subject line" onblur={onBlur} />
      </div>

      <!-- Prefix -->
      <div class="field-row">
        <label class="fld-label" for="dist-prefix">Opening Message</label>
        <textarea
          id="dist-prefix"
          bind:value={data.bodyPrefix}
          class="fld-ta"
          rows="2"
          placeholder="Hi all, please see tomorrow's call sheet below..."
          onblur={onBlur}
        ></textarea>
      </div>

      <!-- Call sheet preview (auto-generated from Next Day Call) -->
      <div class="field-row">
        <span class="fld-label">Call Sheet Body (from Next Day tab)</span>
        <div class="callsheet-preview">
          {#if emailBody}
            <pre>{emailBody}</pre>
          {:else}
            <p class="empty-note">Click <strong>Generate</strong> to build the email from the Next Day Call tab data.</p>
          {/if}
        </div>
      </div>

      <!-- Suffix -->
      <div class="field-row">
        <label class="fld-label" for="dist-suffix">Closing Message</label>
        <textarea
          id="dist-suffix"
          bind:value={data.bodySuffix}
          class="fld-ta"
          rows="2"
          placeholder="Please confirm receipt. Thank you!"
          onblur={onBlur}
        ></textarea>
      </div>

      <!-- Actions -->
      <div class="compose-actions">
        <button class="action-btn" onclick={generateEmail}>Generate Email</button>
        <button class="action-btn ghost" onclick={copyEmail} disabled={!emailBody}>Copy Body</button>
        <button class="action-btn ghost" onclick={copyRecipients}>Copy Recipients</button>
        <button class="action-btn ghost" onclick={openMailto}>Open in Mail App</button>
        {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
      </div>
    </div>

  {:else}
    <!-- RECIPIENTS -->
    <div class="recip-scroll">
      <div class="recip-actions">
        <button class="tb-btn" onclick={() => toggleAll(true)}>Select All</button>
        <button class="tb-btn" onclick={() => toggleAll(false)}>Deselect All</button>
        <button class="tb-btn" onclick={copyRecipients}>Copy Emails</button>
        {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
      </div>

      {#if data.recipients.length === 0}
        <div class="empty">
          <p>No recipients found. Click <strong>Refresh List</strong> to pull from Contacts, or add people in the Contacts tab first.</p>
        </div>
      {:else}
        <div class="recip-grid">
          <div class="rg-header">
            <span></span>
            <span>Name</span>
            <span>Email</span>
            <span>Dept</span>
          </div>
          {#each data.recipients as r, i (r.email)}
            <label class="rg-row" class:excluded={!r.included}>
              <input type="checkbox" bind:checked={r.included} onchange={() => void save()} />
              <span class="rg-name">{r.name}</span>
              <span class="rg-email">{r.email}</span>
              <span class="rg-dept">{r.dept}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .dist-tab {
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
  .count-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(52, 211, 153, 0.1);
    color: var(--success);
    border: 1px solid rgba(52, 211, 153, 0.2);
  }
  .toolbar-actions { display: flex; gap: 6px; margin-left: auto; }
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
  .tb-btn.active { background: rgba(167, 139, 250, 0.13); color: var(--accent); border-color: var(--accent); }

  /* ─── Compose ─── */
  .compose-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field-row { display: flex; flex-direction: column; gap: 4px; }
  .fld-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .fld-full {
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--text);
    font-family: var(--font);
  }
  .fld-full:focus { border-color: var(--accent); outline: none; }
  .fld-ta {
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text);
    font-family: var(--font);
    resize: vertical;
    line-height: 1.5;
  }
  .fld-ta:focus { border-color: var(--accent); outline: none; }

  .callsheet-preview {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px;
    max-height: 300px;
    overflow-y: auto;
  }
  .callsheet-preview pre {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .empty-note { font-size: 12px; color: var(--text3); }

  .compose-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 6px;
  }
  .action-btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font);
  }
  .action-btn:hover { background: var(--accent2); border-color: var(--accent2); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .action-btn.ghost {
    background: transparent;
    color: var(--text2);
    border-color: var(--border);
  }
  .action-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── Recipients ─── */
  .recip-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px;
  }
  .recip-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 12px;
  }

  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; }

  .recip-grid {
    display: grid;
    grid-template-columns: 28px 1fr 1fr 120px;
    gap: 0;
  }
  .rg-header {
    display: contents;
  }
  .rg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    padding: 6px 8px;
    border-bottom: 2px solid var(--border);
    background: var(--bg2);
    position: sticky;
    top: 0;
  }
  .rg-row {
    display: contents;
    cursor: pointer;
  }
  .rg-row > * {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    transition: background 0.08s;
  }
  .rg-row:hover > * { background: var(--bg2); }
  .rg-row.excluded > * { opacity: 0.4; }
  .rg-row input[type="checkbox"] { accent-color: var(--accent); cursor: pointer; }
  .rg-name { font-weight: 600; color: var(--text); }
  .rg-email { font-family: var(--mono); font-size: 11px; color: var(--success); }
  .rg-dept { font-size: 11px; color: var(--text2); }

  @media (max-width: 640px) {
    .compose-scroll { padding: 10px 12px; }
    .recip-grid { grid-template-columns: 28px 1fr 1fr; }
    .rg-dept { display: none; }
  }
</style>
