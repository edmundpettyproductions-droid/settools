<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as contacts from '../lib/contacts';
  import type { UnifiedContact, ContactSource } from '../lib/types';

  type FilterTag = 'all' | 'cast' | 'crew' | 'phone' | 'email' | 'agent';

  let allContacts = $state<UnifiedContact[]>([]);
  let search = $state('');
  let filter = $state<FilterTag>('all');
  let expanded = $state<string | null>(null);  // name of currently-expanded contact
  let copyToast = $state('');

  function refresh() {
    allContacts = contacts.loadAllContacts();
  }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      // Re-merge if any contact-bearing key changed
      if (keys.some((k) => /^(settools_(cast|crew|cast_bible)|ST_nextday)$/.test(k))) {
        refresh();
      }
    });
    return () => unsub();
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  let counts = $derived(contacts.stats(allContacts));

  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return allContacts.filter((c) => {
      // Filter chip
      if (filter === 'cast' && c.category !== 'cast') return false;
      if (filter === 'crew' && c.category !== 'crew') return false;
      if (filter === 'phone' && !c.phone) return false;
      if (filter === 'email' && !c.email) return false;
      if (filter === 'agent' && !c.agent_name && !c.agent_phone && !c.agent_email) return false;
      // Search
      if (!q) return true;
      const haystack = (c.name + ' ' + (c.character ?? '') + ' ' + (c.role ?? '') + ' '
        + (c.department ?? '') + ' ' + (c.actor_legal ?? '') + ' ' + (c.agent_name ?? '')
        + ' ' + (c.agency_name ?? '')).toLowerCase();
      return haystack.includes(q);
    });
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyToast = `Copied ${label}`;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      copyToast = `Copied ${label}`;
    }
    setTimeout(() => { copyToast = ''; }, 1800);
  }

  function toggleExpand(name: string) {
    expanded = expanded === name ? null : name;
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  function sourceLabel(s: ContactSource): string {
    switch (s) {
      case 'cast_bible': return 'Cast Bible';
      case 'call_sheet': return 'Call Sheet';
      case 'next_day':   return 'Next Day Prep';
      case 'sign_in':    return 'Sign-In Records';
    }
  }

  function secondaryLine(c: UnifiedContact): string {
    if (c.character && c.role) return `${c.character} · ${c.role}`;
    if (c.character) return c.character;
    if (c.role) return c.role;
    if (c.department) return c.department;
    return c.category[0]!.toUpperCase() + c.category.slice(1);
  }
</script>

<section class="contacts">
  <header class="hdr">
    <div class="hdr-l">
      <div class="hdr-eyebrow">CONTACTS</div>
      <h1>Production Directory</h1>
      <div class="hdr-meta">
        <strong>{counts.total}</strong> contacts ·
        {counts.cast} cast · {counts.crew} crew ·
        {counts.withPhone} with phone · {counts.withEmail} with email
      </div>
    </div>
  </header>

  <p class="lede">
    One unified view of every person known to your workspace — merged from Call Sheet, Cast Bible, and Next Day Prep.
    Tap any phone or email to launch your dialer / texting app / email client.
  </p>

  {#if !allContacts.length}
    <div class="empty">
      <p>No contacts yet.</p>
      <p class="dim">Upload a call sheet (Crew Tracker) or a cast bible (Cast Bible tab) to populate.</p>
    </div>
  {:else}
    <!-- Toolbar -->
    <div class="toolbar">
      <input
        class="search"
        type="search"
        placeholder="Search by name, character, role, dept…"
        bind:value={search}
      />
      <div class="filters">
        <button class:active={filter === 'all'}   onclick={() => filter = 'all'}>All ({counts.total})</button>
        <button class:active={filter === 'cast'}  onclick={() => filter = 'cast'}>Cast ({counts.cast})</button>
        <button class:active={filter === 'crew'}  onclick={() => filter = 'crew'}>Crew ({counts.crew})</button>
        <button class:active={filter === 'phone'} onclick={() => filter = 'phone'}>📞 ({counts.withPhone})</button>
        <button class:active={filter === 'email'} onclick={() => filter = 'email'}>✉ ({counts.withEmail})</button>
        <button class:active={filter === 'agent'} onclick={() => filter = 'agent'}>w/ Agent ({counts.withAgent})</button>
      </div>
    </div>

    <!-- Rows -->
    <div class="rows">
      {#each filtered as c (c.name)}
        <article class="row" class:expanded={expanded === c.name}>
          <button class="row-main" onclick={() => toggleExpand(c.name)} aria-expanded={expanded === c.name}>
            <span class="avatar" data-cat={c.category}>{contacts.initials(c.name)}</span>
            <div class="info">
              <div class="name">{c.name}{#if c.status}<span class="status status-{c.status.toLowerCase()}">{c.status}</span>{/if}</div>
              <div class="secondary">{secondaryLine(c)}</div>
            </div>
            <div class="chevron">{expanded === c.name ? '▾' : '▸'}</div>
          </button>

          <div class="quick">
            {#if c.phone}
              <a class="qa primary" href={contacts.telUrl(c.phone)} title="Call {c.phone}" aria-label="Call {c.name}">
                <span class="qa-icon">📞</span><span class="qa-label">{c.phone}</span>
              </a>
              <a class="qa" href={contacts.smsUrl(c.phone)} title="Text {c.phone}" aria-label="Text {c.name}">💬</a>
              <button class="qa" onclick={() => copy(c.phone!, c.name + ' phone')} title="Copy phone" aria-label="Copy phone">📋</button>
            {/if}
            {#if c.email}
              <a class="qa primary" href={contacts.mailtoUrl(c.email)} title="Email {c.email}" aria-label="Email {c.name}">
                <span class="qa-icon">✉</span><span class="qa-label">{c.email}</span>
              </a>
              <button class="qa" onclick={() => copy(c.email!, c.name + ' email')} title="Copy email" aria-label="Copy email">📋</button>
            {/if}
            {#if !c.phone && !c.email}
              <span class="qa empty-actions">No contact info on file</span>
            {/if}
          </div>

          {#if expanded === c.name}
            <div class="details">
              {#if c.actor_legal}
                <div class="detail-row"><span class="d-k">Legal name</span><span class="d-v">{c.actor_legal}</span></div>
              {/if}
              {#if c.agent_name || c.agent_phone || c.agent_email || c.agency_name}
                <div class="detail-section">
                  <div class="d-section-title">Agent / Representation</div>
                  {#if c.agency_name}<div class="detail-row"><span class="d-k">Agency</span><span class="d-v">{c.agency_name}</span></div>{/if}
                  {#if c.agent_name}<div class="detail-row"><span class="d-k">Agent</span><span class="d-v">{c.agent_name}</span></div>{/if}
                  {#if c.agent_phone}
                    <div class="detail-row">
                      <span class="d-k">Agent Phone</span>
                      <span class="d-v">
                        <a href={contacts.telUrl(c.agent_phone)}>{c.agent_phone}</a>
                        <button class="copy-mini" onclick={() => copy(c.agent_phone!, 'agent phone')}>📋</button>
                      </span>
                    </div>
                  {/if}
                  {#if c.agent_email}
                    <div class="detail-row">
                      <span class="d-k">Agent Email</span>
                      <span class="d-v">
                        <a href={contacts.mailtoUrl(c.agent_email)}>{c.agent_email}</a>
                        <button class="copy-mini" onclick={() => copy(c.agent_email!, 'agent email')}>📋</button>
                      </span>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if c.manager_name || c.manager_phone || c.manager_email}
                <div class="detail-section">
                  <div class="d-section-title">Management</div>
                  {#if c.manager_name}<div class="detail-row"><span class="d-k">Manager</span><span class="d-v">{c.manager_name}</span></div>{/if}
                  {#if c.manager_phone}
                    <div class="detail-row">
                      <span class="d-k">Manager Phone</span>
                      <span class="d-v"><a href={contacts.telUrl(c.manager_phone)}>{c.manager_phone}</a></span>
                    </div>
                  {/if}
                  {#if c.manager_email}
                    <div class="detail-row">
                      <span class="d-k">Manager Email</span>
                      <span class="d-v"><a href={contacts.mailtoUrl(c.manager_email)}>{c.manager_email}</a></span>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if c.guardian_name || c.guardian_phone}
                <div class="detail-section">
                  <div class="d-section-title">Guardian (Minor)</div>
                  {#if c.guardian_name}<div class="detail-row"><span class="d-k">Guardian</span><span class="d-v">{c.guardian_name}</span></div>{/if}
                  {#if c.guardian_phone}
                    <div class="detail-row">
                      <span class="d-k">Guardian Phone</span>
                      <span class="d-v"><a href={contacts.telUrl(c.guardian_phone)}>{c.guardian_phone}</a></span>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if c.diet}
                <div class="detail-row"><span class="d-k">Diet</span><span class="d-v diet">{c.diet}</span></div>
              {/if}
              {#if c.notes}
                <div class="detail-row"><span class="d-k">Notes</span><span class="d-v">{c.notes}</span></div>
              {/if}
              <div class="detail-row sources">
                <span class="d-k">Source{c.sources.length === 1 ? '' : 's'}</span>
                <span class="d-v">
                  {#each c.sources as s, i (s)}<span class="source-tag">{sourceLabel(s)}</span>{#if i < c.sources.length - 1}{' '}{/if}{/each}
                </span>
              </div>
            </div>
          {/if}
        </article>
      {/each}
      {#if !filtered.length}
        <div class="empty-row">No contacts match "{search}" with the current filter.</div>
      {/if}
    </div>
  {/if}

  {#if copyToast}
    <div class="toast" role="status">{copyToast}</div>
  {/if}
</section>

<style>
  .contacts { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; position: relative; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr-l h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .hdr-meta strong { color: var(--accent); font-weight: 700; }
  .lede { color: var(--text2); font-size: 13px; line-height: 1.6; margin: 12px 0 22px; max-width: 760px; }

  .empty { text-align: center; padding: 60px 20px; color: var(--text2); }
  .empty p.dim { font-size: 12px; color: var(--text3); margin-top: 8px; }
  .empty-row { text-align: center; padding: 32px; color: var(--text3); font-style: italic; }

  /* Toolbar */
  .toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 220px; font-family: var(--font); font-size: 13px; padding: 9px 14px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
  .search:focus { outline: none; border-color: var(--accent); }
  .filters { display: flex; gap: 5px; flex-wrap: wrap; }
  .filters button {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    padding: 7px 12px; background: var(--bg2); color: var(--text2);
    border: 1px solid var(--border); border-radius: 6px; cursor: pointer;
    transition: all .12s; white-space: nowrap;
  }
  .filters button:hover { color: var(--text); border-color: var(--border2); }
  .filters button.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: rgba(167,139,250,0.4); }

  /* Rows */
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; transition: border-color .12s; overflow: hidden; }
  .row:hover { border-color: var(--border2); }
  .row.expanded { border-color: var(--accent); }

  .row-main {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; width: 100%; background: none; border: none;
    text-align: left; cursor: pointer; color: inherit;
  }
  .row-main:hover { background: rgba(167,139,250,0.04); }

  .avatar {
    width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--cond); font-size: 14px; font-weight: 700;
    color: var(--text); border: 1px solid var(--border2);
    background: var(--bg3);
  }
  .avatar[data-cat="cast"]    { background: rgba(167,139,250,0.18); color: var(--accent); border-color: rgba(167,139,250,0.45); }
  .avatar[data-cat="crew"]    { background: rgba(52,211,153,0.13);   color: var(--success); border-color: rgba(52,211,153,0.4); }
  .avatar[data-cat="other"]   { background: var(--bg3); color: var(--text2); }

  .info { flex: 1; min-width: 0; }
  .name { font-size: 14px; color: var(--text); font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .secondary { font-size: 12px; color: var(--text2); margin-top: 2px; }

  .status { font-family: var(--mono); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.06em; text-transform: uppercase; }
  .status-locked    { background: rgba(52,211,153,0.13); color: var(--success); }
  .status-cancelled { background: rgba(224,90,90,0.13);  color: var(--danger); }
  .status-wrapped   { background: rgba(167,139,250,0.13);color: var(--accent); }
  .status-tentative,
  .status-pending   { background: rgba(240,160,64,0.13); color: var(--warn); }

  .chevron { color: var(--text3); font-family: var(--mono); font-size: 14px; flex-shrink: 0; }

  /* Quick actions row (always visible) */
  .quick {
    display: flex; gap: 6px; padding: 0 16px 12px; flex-wrap: wrap; align-items: center;
  }
  .qa {
    font-family: var(--mono); font-size: 11px;
    padding: 6px 10px; border-radius: 5px; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg3); color: var(--text2);
    text-decoration: none; transition: all .12s;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .qa:hover { color: var(--accent); border-color: var(--accent); background: var(--bg4); }
  .qa.primary { color: var(--text); border-color: var(--border2); }
  .qa.primary:hover { color: var(--accent); border-color: var(--accent); background: rgba(167,139,250,0.07); }
  .qa-icon { font-size: 13px; }
  .qa-label { font-size: 11.5px; }
  .qa.empty-actions { background: none; color: var(--text3); border-color: transparent; cursor: default; font-style: italic; }
  .qa.empty-actions:hover { color: var(--text3); border-color: transparent; background: none; }

  /* Expanded details */
  .details {
    padding: 0 16px 16px;
    border-top: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 4px;
  }
  .detail-section { padding-top: 10px; }
  .d-section-title { font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text3); margin-bottom: 6px; padding-top: 6px; }
  .detail-row { display: flex; gap: 12px; padding: 4px 0; align-items: baseline; }
  .d-k { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; min-width: 110px; flex-shrink: 0; }
  .d-v { font-size: 12.5px; color: var(--text); flex: 1; word-break: break-word; }
  .d-v a { color: var(--accent); text-decoration: none; }
  .d-v a:hover { text-decoration: underline; }
  .d-v.diet { color: var(--warn); font-style: italic; }
  .copy-mini { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 12px; padding: 0 4px; margin-left: 6px; }
  .copy-mini:hover { color: var(--accent); }

  .sources { padding-top: 12px; margin-top: 6px; border-top: 1px dashed var(--border); }
  .source-tag { font-family: var(--mono); font-size: 10px; padding: 2px 6px; background: var(--bg3); color: var(--text3); border: 1px solid var(--border); border-radius: 3px; margin-right: 4px; }

  /* Toast */
  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--bg3); color: var(--success); border: 1px solid var(--success);
    padding: 10px 18px; border-radius: 8px; font-family: var(--mono); font-size: 12px;
    z-index: 1000; box-shadow: 0 4px 14px rgba(0,0,0,0.4);
  }
</style>
