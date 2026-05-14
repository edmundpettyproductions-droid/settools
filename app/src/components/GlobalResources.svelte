<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as data from '../lib/data';

  type ResourceType = 'project' | 'header' | 'schedule' | 'dood' | 'cast' | 'crew' | 'nextday' | 'signin' | 'scenes' | 'other';

  interface Resource {
    key: string;
    label: string;
    icon: string;
    description: string;
    size: number;          // bytes
    countSummary: string;  // "12 entries", "8 days", etc.
    toolUrl: string;       // where to view it in the vanilla tools
    type: ResourceType;
    present: boolean;      // false → show as "not loaded" placeholder
  }

  // Hardcoded catalog of known data keys. Order = display order.
  // Excludes settools_uh_cs (the current call sheet PDF) per user request —
  // call sheets are "current day" data, not a global reference.
  const CATALOG: Array<Omit<Resource, 'size' | 'countSummary' | 'present'> & {
    summarize: (raw: string) => string;
  }> = [
    {
      key: 'settools_pt', label: 'Projects', icon: '🎬', type: 'project',
      description: 'All shoots you have on file. Switch active project here.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { projects?: Record<string, { name: string; days?: unknown[] }>; activeProject?: string };
          const n = Object.keys(v.projects ?? {}).length;
          const active = v.activeProject && v.projects?.[v.activeProject]?.name;
          return active ? `${n} project${n === 1 ? '' : 's'} · active: ${active}` : `${n} project${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_uh', label: 'Universal Header', icon: '📋', type: 'header',
      description: 'Today\'s call time, first shot, location, director, episode.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as Record<string, string>;
          const set = Object.values(v).filter(Boolean).length;
          return `${set} field${set === 1 ? '' : 's'} set`;
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_scenes', label: 'Scenes', icon: '🎞', type: 'scenes',
      description: 'Scene list with locations, times, and current shoot order.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { scenes?: unknown[] };
          const n = v.scenes?.length ?? 0;
          return `${n} scene${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_st', label: 'Scene Tracker', icon: '📊', type: 'schedule',
      description: 'Shooting + strip schedule with ahead/behind tracking.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { rows?: unknown[]; log?: unknown[] };
          const rows = v.rows?.length ?? 0;
          const log = v.log?.length ?? 0;
          return rows ? `${rows} entries · ${log} log events` : '—';
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_dood', label: 'Day Out of Days', icon: '📅', type: 'dood',
      description: 'Cast + department schedules grouped by date.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { departments?: Record<string, unknown> };
          const n = Object.keys(v.departments ?? {}).length;
          return `${n} department${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_cast', label: 'Cast Tracker', icon: '🎭', type: 'cast',
      description: 'Cast members with call times and arrival status.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { people?: unknown[]; rows?: unknown[] };
          const n = v.people?.length ?? v.rows?.length ?? 0;
          return `${n} cast member${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
    {
      key: 'settools_crew', label: 'Crew Tracker', icon: '👥', type: 'crew',
      description: 'Crew roster with call times and arrivals.',
      toolUrl: '/crew-tracker.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { people?: unknown[]; rows?: unknown[] };
          const n = v.people?.length ?? v.rows?.length ?? 0;
          return `${n} crew member${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
    {
      key: 'ST_nextday', label: 'Next Day Prep', icon: '🌅', type: 'nextday',
      description: 'Tomorrow\'s draft schedule, contacts, script + docs.',
      toolUrl: '/next-day.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { contacts?: unknown[]; docs?: unknown[]; scenes?: unknown[] };
          const c = v.contacts?.length ?? 0;
          const d = v.docs?.length ?? 0;
          const s = v.scenes?.length ?? 0;
          return `${c} contacts · ${d} docs · ${s} scenes`;
        } catch { return '—'; }
      },
    },
    {
      key: 'ST_signin', label: 'Sign-In Records', icon: '✍', type: 'signin',
      description: 'Cast sign-in / sign-out events with signatures.',
      toolUrl: '/sign-in.html',
      summarize: (raw) => {
        try {
          const v = JSON.parse(raw) as { records?: unknown[]; signins?: unknown[] };
          const n = v.records?.length ?? v.signins?.length ?? 0;
          return `${n} sign-in event${n === 1 ? '' : 's'}`;
        } catch { return '—'; }
      },
    },
  ];

  let resources = $state<Resource[]>([]);
  let viewKey   = $state<string | null>(null);
  let viewBody  = $state<string>('');

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function refresh() {
    resources = CATALOG.map((entry) => {
      const raw = sync.get(entry.key);
      const present = raw !== null && raw.length > 0;
      return {
        key: entry.key,
        label: entry.label,
        icon: entry.icon,
        description: entry.description,
        type: entry.type,
        toolUrl: entry.toolUrl,
        size: raw?.length ?? 0,
        countSummary: present && raw ? entry.summarize(raw) : 'Not loaded yet',
        present,
      };
    });
  }

  function viewRaw(key: string) {
    const raw = sync.get(key);
    if (!raw) return;
    viewKey = key;
    try { viewBody = JSON.stringify(JSON.parse(raw), null, 2); }
    catch { viewBody = raw; }
  }

  function closeViewer() { viewKey = null; viewBody = ''; }

  function downloadAsJSON(key: string) {
    const raw = sync.get(key);
    if (!raw) return;
    let pretty = raw;
    try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* leave as-is */ }
    const blob = new Blob([pretty], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    a.href = url;
    a.download = `${key}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  let proj = $derived(data.activeProject());

  onMount(() => {
    refresh();
    const unsub = sync.subscribe(refresh);
    return () => unsub();
  });
</script>

<section class="resources">
  <header class="hdr">
    <div class="hdr-l">
      <div class="hdr-eyebrow">GLOBAL RESOURCES</div>
      <h1>Production Files</h1>
      {#if proj}
        <div class="hdr-meta">Active project: <strong>{proj.name}</strong></div>
      {/if}
    </div>
  </header>

  <p class="lede">Everything synced for this workspace, in one place. Click <strong>Open in tool</strong> to edit; <strong>View JSON</strong> or <strong>Download</strong> for inspection or backup.</p>

  <div class="grid">
    {#each resources as r (r.key)}
      <article class="card" class:dim={!r.present}>
        <div class="card-head">
          <span class="icon">{r.icon}</span>
          <div class="card-title">
            <h3>{r.label}</h3>
            <div class="card-meta">{r.countSummary}{#if r.present} · {formatBytes(r.size)}{/if}</div>
          </div>
        </div>
        <p class="desc">{r.description}</p>
        <div class="actions">
          <a class="btn" href={r.toolUrl} target="_blank" rel="noopener">Open in tool ↗</a>
          {#if r.present}
            <button class="btn ghost" onclick={() => viewRaw(r.key)}>View JSON</button>
            <button class="btn ghost" onclick={() => downloadAsJSON(r.key)}>Download</button>
          {/if}
        </div>
      </article>
    {/each}
  </div>

  <div class="footnote">
    Not seeing something you expect? It hasn't been uploaded/edited in this workspace yet.
    Open the matching tool and load the file — within ~10 seconds it appears here on all devices.
  </div>
</section>

{#if viewKey}
  <div class="modal-bg" onclick={closeViewer} onkeydown={(e) => e.key === 'Escape' && closeViewer()} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>{viewKey}</h3>
        <button class="modal-close" onclick={closeViewer} aria-label="Close">×</button>
      </header>
      <pre class="modal-body">{viewBody}</pre>
    </div>
  </div>
{/if}

<style>
  .resources { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
  .hdr { margin-bottom: 14px; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr-l h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .hdr-meta strong { color: var(--text); font-weight: 600; }
  .lede { color: var(--text2); font-size: 13px; line-height: 1.6; margin: 6px 0 24px; max-width: 760px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }

  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; transition: border-color .12s, opacity .12s; }
  .card:hover { border-color: var(--border2); }
  .card.dim { opacity: 0.55; }

  .card-head { display: flex; gap: 12px; align-items: flex-start; }
  .icon { font-size: 24px; line-height: 1; padding-top: 2px; }
  .card-title { flex: 1; min-width: 0; }
  .card-title h3 { font-family: var(--font); font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: 0.01em; margin-bottom: 2px; }
  .card-meta { font-family: var(--mono); font-size: 11px; color: var(--text2); }

  .desc { font-size: 12.5px; color: var(--text2); line-height: 1.5; flex: 1; }

  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .btn { font-family: var(--font); font-size: 11px; font-weight: 600; padding: 6px 11px; border-radius: 4px; cursor: pointer; text-decoration: none; transition: all .12s; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); display: inline-flex; align-items: center; }
  .btn:hover { background: var(--accent2); border-color: var(--accent2); }
  .btn.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn.ghost:hover { color: var(--accent); border-color: var(--accent); }

  .footnote { font-size: 11.5px; color: var(--text3); margin-top: 32px; line-height: 1.6; max-width: 760px; }

  /* Modal */
  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
  .modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; width: min(900px, 100%); max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
  .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  .modal-head h3 { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--accent); }
  .modal-close { background: none; border: none; color: var(--text2); font-size: 24px; cursor: pointer; line-height: 1; padding: 0 4px; }
  .modal-close:hover { color: var(--text); }
  .modal-body { padding: 16px 18px; overflow: auto; flex: 1; font-family: var(--mono); font-size: 12px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; }
</style>
