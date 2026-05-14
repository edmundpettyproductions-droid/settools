<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as notes from '../lib/notes';
  import * as contacts from '../lib/contacts';
  import type { NoteEntry, NoteCategory, UnifiedContact } from '../lib/types';

  let state = $state(notes.loadNotes());
  let people = $state<UnifiedContact[]>([]);
  let inputText = $state('');
  let inputCategory = $state<NoteCategory>('general');
  let inputScene = $state('');
  let inputPerson = $state('');
  let filter = $state<NoteCategory | 'all' | 'pinned'>('all');
  let search = $state('');

  function refresh() {
    state = notes.loadNotes();
    people = contacts.loadAllContacts();
  }

  onMount(() => {
    refresh();
    const unsub = sync.subscribe((keys) => {
      if (keys.some((k) => k === 'settools_notes' || /^(settools_(cast|crew|cast_bible)|ST_nextday)$/.test(k))) refresh();
    });
    return () => unsub();
  });

  async function submit(e: Event) {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    await notes.addNote({
      text,
      category: inputCategory,
      scene: inputScene.trim() || undefined,
      person: inputPerson.trim() || undefined,
    });
    inputText = ''; inputScene = ''; inputPerson = '';
    refresh();
  }

  async function togglePin(id: string) { await notes.togglePin(id); refresh(); }
  async function remove(id: string) {
    if (!confirm('Delete this note?')) return;
    await notes.deleteNote(id); refresh();
  }

  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let list = state.notes.slice();
    if (filter === 'pinned') list = list.filter((n) => n.pinned);
    else if (filter !== 'all') list = list.filter((n) => n.category === filter);
    if (q) list = list.filter((n) =>
      n.text.toLowerCase().includes(q) ||
      (n.person ?? '').toLowerCase().includes(q) ||
      (n.scene ?? '').toLowerCase().includes(q),
    );
    // Pinned first, then chronological (newest first)
    list.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });
    return list;
  });

  function copyAllAsText() {
    navigator.clipboard?.writeText(notes.exportAsText(filtered)).catch(() => {});
  }
  function downloadAsText() {
    const blob = new Blob([notes.exportAsText(filtered)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    a.download = `notes-${stamp}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
</script>

<section class="notes">
  <header class="hdr">
    <div class="hdr-eyebrow">QUICK NOTES</div>
    <h1>On-Set Notes</h1>
    <div class="hdr-meta">{state.notes.length} note{state.notes.length === 1 ? '' : 's'} · auto-synced across devices</div>
  </header>

  <!-- Compose form -->
  <form class="compose" onsubmit={submit}>
    <textarea
      class="compose-text"
      placeholder='Type a quick note — director&apos;s pick, continuity flag, anything worth remembering...'
      bind:value={inputText}
      rows="2"
    ></textarea>
    <div class="compose-row">
      <select bind:value={inputCategory}>
        <option value="general">📝 General</option>
        <option value="director">🎬 Director</option>
        <option value="continuity">🎞 Continuity</option>
        <option value="production">📋 Production</option>
      </select>
      <input type="text" placeholder="Scene (optional)" bind:value={inputScene} class="compose-meta" />
      <input
        type="text"
        placeholder="Person (optional — autocompletes from Contacts)"
        bind:value={inputPerson}
        class="compose-meta wider"
        list="contact-names"
      />
      <datalist id="contact-names">
        {#each people as p (p.name)}
          <option value={p.name}></option>
        {/each}
      </datalist>
      <button type="submit" class="btn primary" disabled={!inputText.trim()}>Save Note</button>
    </div>
  </form>

  <!-- Filter toolbar -->
  <div class="toolbar">
    <input class="search" type="search" placeholder="Search notes..." bind:value={search} />
    <div class="filters">
      <button class:active={filter === 'all'}        onclick={() => filter = 'all'}>All ({state.notes.length})</button>
      <button class:active={filter === 'pinned'}     onclick={() => filter = 'pinned'}>📌 Pinned ({state.notes.filter((n) => n.pinned).length})</button>
      <button class:active={filter === 'director'}   onclick={() => filter = 'director'}>🎬 Director</button>
      <button class:active={filter === 'continuity'} onclick={() => filter = 'continuity'}>🎞 Continuity</button>
      <button class:active={filter === 'production'} onclick={() => filter = 'production'}>📋 Production</button>
      <button class:active={filter === 'general'}    onclick={() => filter = 'general'}>📝 General</button>
    </div>
    {#if filtered.length}
      <div class="export-actions">
        <button class="btn ghost small" onclick={copyAllAsText} title="Copy filtered notes to clipboard">📋 Copy</button>
        <button class="btn ghost small" onclick={downloadAsText} title="Download as .txt">⬇ TXT</button>
      </div>
    {/if}
  </div>

  <!-- Notes list -->
  <div class="list">
    {#each filtered as n (n.id)}
      <article class="note" class:pinned={n.pinned}>
        <div class="note-head">
          <span class="cat">{notes.CATEGORY_LABELS[n.category]}</span>
          {#if n.scene}<span class="tag">Scene {n.scene}</span>{/if}
          {#if n.person}<span class="tag person">re: {n.person}</span>{/if}
          <span class="when" title={new Date(n.created_at).toLocaleString()}>{new Date(n.created_at).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
          <button class="pin-btn" class:on={n.pinned} onclick={() => togglePin(n.id)} title={n.pinned ? 'Unpin' : 'Pin'}>📌</button>
          <button class="del-btn" onclick={() => remove(n.id)} title="Delete">✕</button>
        </div>
        <div class="body">{n.text}</div>
      </article>
    {/each}
    {#if !filtered.length}
      <div class="empty">{state.notes.length ? 'No notes match the current filter.' : 'No notes yet. Type one above and hit Save.'}</div>
    {/if}
  </div>
</section>

<style>
  .notes { max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }

  /* Compose */
  .compose { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 18px 0 14px; }
  .compose-text {
    width: 100%; resize: vertical; min-height: 50px;
    font-family: var(--font); font-size: 14px; line-height: 1.5;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;
  }
  .compose-text:focus { outline: none; border-color: var(--accent); }
  .compose-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .compose-row select, .compose-meta {
    font-family: var(--font); font-size: 13px; padding: 8px 10px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px;
  }
  .compose-meta { width: 130px; }
  .compose-meta.wider { width: 220px; flex: 1; min-width: 180px; }
  .compose-row select:focus, .compose-meta:focus { outline: none; border-color: var(--accent); }

  .btn { font-family: var(--font); font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: all .12s; border: 1px solid; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }
  .btn.small { padding: 6px 10px; font-size: 11px; }

  /* Toolbar */
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 180px; font-family: var(--font); font-size: 13px; padding: 8px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  .search:focus { outline: none; border-color: var(--accent); }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; }
  .filters button { font-family: var(--mono); font-size: 11px; padding: 6px 10px; background: var(--bg2); color: var(--text2); border: 1px solid var(--border); border-radius: 5px; cursor: pointer; transition: all .12s; }
  .filters button:hover { color: var(--text); }
  .filters button.active { background: rgba(167,139,250,0.15); color: var(--accent); border-color: rgba(167,139,250,0.4); }
  .export-actions { display: flex; gap: 6px; }

  /* Notes list */
  .list { display: flex; flex-direction: column; gap: 8px; }
  .note { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; transition: border-color .12s; }
  .note.pinned { border-color: rgba(167,139,250,0.4); background: rgba(167,139,250,0.04); }
  .note-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .cat { font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--accent); }
  .tag { font-family: var(--mono); font-size: 10px; padding: 2px 7px; background: var(--bg3); color: var(--text2); border: 1px solid var(--border); border-radius: 3px; }
  .tag.person { color: var(--success); border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.07); }
  .when { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-left: auto; }
  .pin-btn, .del-btn { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 12px; padding: 2px 6px; transition: color .12s; }
  .pin-btn:hover, .del-btn:hover { color: var(--accent); }
  .pin-btn.on { color: var(--accent); }
  .del-btn:hover { color: var(--danger); }
  .body { font-size: 14px; line-height: 1.55; color: var(--text); white-space: pre-wrap; word-break: break-word; }

  .empty { text-align: center; padding: 40px 20px; color: var(--text3); font-style: italic; }
</style>
