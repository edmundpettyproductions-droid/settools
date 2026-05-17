<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as WR from '../lib/wrapReport';
  import * as S from '../lib/scenes';
  import * as issues from '../lib/issues';
  import * as CL from '../lib/commLog';

  // ─── State ──────────────────────────────────────────────────────────
  let report = $state<WR.WrapReport | null>(null);
  let reportText = $state('');
  let history = $state<WR.WrapReport[]>([]);
  let view = $state<'current' | 'history'>('current');
  let copyMsg = $state('');
  let historyIdx = $state(-1);  // -1 = current report

  // ─── Load ──────────────────────────────────────────────────────────
  function loadHistory() {
    const state = WR.loadReports();
    history = state.reports;
  }

  onMount(() => {
    loadHistory();
    const unsub = sync.subscribe((keys) => {
      if (keys.includes(WR.STORAGE_KEY)) loadHistory();
    });
    return () => unsub();
  });

  // ─── Actions ──────────────────────────────────────────────────────
  function generateReport() {
    report = WR.generate();
    reportText = WR.formatText(report);
    historyIdx = -1;
    view = 'current';
  }

  async function saveReport() {
    if (!report) return;
    const state = WR.loadReports();
    // Prevent duplicate saves for same generation
    const exists = state.reports.some((r) => r.generated === report!.generated);
    if (!exists) {
      state.reports.unshift(report);
      // Keep last 30 reports
      if (state.reports.length > 30) state.reports = state.reports.slice(0, 30);
      await WR.saveReports(state);
      loadHistory();
    }
    copyMsg = 'Report saved!';
    setTimeout(() => copyMsg = '', 2000);
  }

  async function copyReport() {
    const histItem = historyIdx >= 0 ? history[historyIdx] : undefined;
    const text = histItem
      ? WR.formatText(histItem)
      : reportText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyMsg = 'Copied!';
      setTimeout(() => copyMsg = '', 2000);
    } catch { copyMsg = 'Failed'; }
  }

  function viewHistoryReport(idx: number) {
    historyIdx = idx;
    const r = history[idx];
    if (r) {
      report = r;
      reportText = WR.formatText(r);
    }
    view = 'current';
  }

  async function deleteHistoryReport(idx: number) {
    const state = WR.loadReports();
    state.reports.splice(idx, 1);
    await WR.saveReports(state);
    loadHistory();
    if (historyIdx === idx) {
      historyIdx = -1;
      report = null;
      reportText = '';
    }
  }

  // ─── Derived ──────────────────────────────────────────────────────
  let displayReport = $derived(report);
</script>

<div class="wrap-tab">
  <div class="toolbar">
    <h2>Wrap Report</h2>
    <div class="toolbar-actions">
      <button class="tb-btn" class:active={view === 'current'} onclick={() => view = 'current'}>Report</button>
      <button class="tb-btn" class:active={view === 'history'} onclick={() => view = 'history'}>
        History
        {#if history.length > 0}<span class="badge">{history.length}</span>{/if}
      </button>
      <button class="tb-btn accent" onclick={generateReport}>Generate</button>
    </div>
  </div>

  {#if view === 'current'}
    <div class="report-scroll">
      {#if !displayReport}
        <div class="empty">
          <p>No wrap report generated yet.</p>
          <p>Click <strong>Generate</strong> to build today's wrap report from all your tab data.</p>
          <button class="action-btn" onclick={generateReport}>Generate Wrap Report</button>
        </div>
      {:else}
        <!-- Summary Cards -->
        <div class="summary-strip">
          <div class="card">
            <span class="card-label">Shoot Day</span>
            <span class="card-value">{displayReport.shootDay || '—'}</span>
          </div>
          <div class="card">
            <span class="card-label">Scenes</span>
            <span class="card-value">{displayReport.sceneSummary.complete}/{displayReport.sceneSummary.total}</span>
          </div>
          <div class="card">
            <span class="card-label">Pages</span>
            <span class="card-value">{S.fmtEighths(displayReport.sceneSummary.completeEighths)}</span>
          </div>
          <div class="card">
            <span class="card-label">First Shot</span>
            <span class="card-value">{displayReport.firstShot}</span>
          </div>
          <div class="card">
            <span class="card-label">Last Shot</span>
            <span class="card-value">{displayReport.lastShot}</span>
          </div>
          <div class="card">
            <span class="card-label">Elapsed</span>
            <span class="card-value">{displayReport.totalElapsed}</span>
          </div>
          <div class="card">
            <span class="card-label">Cast</span>
            <span class="card-value">{displayReport.castWrapped}/{displayReport.castCount}</span>
          </div>
          <div class="card">
            <span class="card-label">Crew</span>
            <span class="card-value">{displayReport.crewWrapped}/{displayReport.crewCount}</span>
          </div>
          {#if displayReport.otAlerts.length > 0}
            <div class="card danger">
              <span class="card-label">OT Alerts</span>
              <span class="card-value">{displayReport.otAlerts.length}</span>
            </div>
          {/if}
          {#if displayReport.openIssues.length > 0}
            <div class="card warn">
              <span class="card-label">Open Issues</span>
              <span class="card-value">{displayReport.openIssues.length}</span>
            </div>
          {/if}
        </div>

        <!-- Sections -->
        <div class="sections">
          <!-- Scenes -->
          {#if displayReport.sceneLines.length > 0}
            <details class="section" open>
              <summary class="section-title">Scenes ({displayReport.sceneSummary.complete} complete, {S.fmtEighths(displayReport.sceneSummary.completeEighths)} pages)</summary>
              <div class="scene-grid">
                <div class="sg-header">
                  <span>Scene</span><span>Status</span><span>Pages</span><span>Setups</span><span>Start</span><span>Wrap</span><span>Elapsed</span>
                </div>
                {#each displayReport.sceneLines as s (s.sceneNum)}
                  <div class="sg-row" class:complete={s.status === 'complete'} class:omitted={s.status === 'omitted'}>
                    <span class="sg-sc">{s.sceneNum}</span>
                    <span class="sg-status status-{s.status}">{S.STATUS_LABELS[s.status]}</span>
                    <span>{s.pages}</span>
                    <span>{s.setups}</span>
                    <span>{s.firstUp}</span>
                    <span>{s.wrapped}</span>
                    <span>{s.elapsed}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Cast -->
          {#if displayReport.castLines.length > 0}
            <details class="section" open>
              <summary class="section-title">Cast ({displayReport.castWrapped}/{displayReport.castCount} wrapped)</summary>
              <div class="person-grid">
                <div class="pg-header">
                  <span>Name</span><span>Character</span><span>Call</span><span>In</span><span>Wrap</span><span>Hours</span>
                </div>
                {#each displayReport.castLines as p (p.name)}
                  <div class="pg-row">
                    <span class="pg-name">{p.name}</span>
                    <span class="pg-role">{p.role}</span>
                    <span>{p.callTime}</span>
                    <span>{p.arrivedAt}</span>
                    <span>{p.wrapTime}</span>
                    <span class="pg-hours">{p.hoursWorked}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Crew -->
          {#if displayReport.crewLines.length > 0}
            <details class="section">
              <summary class="section-title">Crew ({displayReport.crewWrapped}/{displayReport.crewCount} wrapped)</summary>
              <div class="person-grid">
                <div class="pg-header">
                  <span>Name</span><span>Role / Dept</span><span>Call</span><span>In</span><span>Wrap</span><span>Hours</span>
                </div>
                {#each displayReport.crewLines as p (p.name)}
                  <div class="pg-row">
                    <span class="pg-name">{p.name}</span>
                    <span class="pg-role">{p.role}</span>
                    <span>{p.callTime}</span>
                    <span>{p.arrivedAt}</span>
                    <span>{p.wrapTime}</span>
                    <span class="pg-hours">{p.hoursWorked}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- OT Alerts -->
          {#if displayReport.otAlerts.length > 0}
            <details class="section" open>
              <summary class="section-title danger-text">Overtime Alerts ({displayReport.otAlerts.length})</summary>
              <div class="ot-grid">
                {#each displayReport.otAlerts as a (a.name + a.source)}
                  <div class="ot-row">
                    <span class="ot-name">{a.name}</span>
                    <span class="ot-role">{a.role}</span>
                    <span class="ot-source">{a.source}</span>
                    <span class="ot-hours">{a.hoursWorked}</span>
                    <span class="ot-badge">{a.threshold}+</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Open Issues -->
          {#if displayReport.openIssues.length > 0}
            <details class="section" open>
              <summary class="section-title warn-text">Open Issues — Carry Forward ({displayReport.openIssues.length})</summary>
              <div class="issues-list">
                {#each displayReport.openIssues as i (i.id)}
                  <div class="issue-row">
                    <span class="issue-type">{issues.TYPE_LABELS[i.type]?.icon} {issues.TYPE_LABELS[i.type]?.label}</span>
                    <span class="issue-desc">{i.description}</span>
                    {#if i.person}<span class="issue-person">{i.person}</span>{/if}
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Flagged Notes -->
          {#if displayReport.flaggedNotes.length > 0}
            <details class="section">
              <summary class="section-title">Flagged Notes ({displayReport.flaggedNotes.length})</summary>
              <div class="notes-list">
                {#each displayReport.flaggedNotes as n (n.id)}
                  <div class="note-row">
                    {#if n.scene}<span class="note-scene">Sc {n.scene}</span>{/if}
                    <span class="note-text">{n.text}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Communications -->
          {#if displayReport.commEntries.length > 0}
            <details class="section">
              <summary class="section-title">Communications ({displayReport.commCount} today{displayReport.commFlagged > 0 ? `, ${displayReport.commFlagged} flagged` : ''})</summary>
              <div class="comm-list">
                {#each displayReport.commEntries as e (e.id)}
                  <div class="comm-row" class:flagged={e.flagged}>
                    <span class="comm-icon">{CL.TYPE_LABELS[e.type].icon}</span>
                    <span class="comm-dir" class:inbound={e.direction === 'inbound'}>{e.direction === 'inbound' ? '←' : '→'}</span>
                    <span class="comm-contact">{e.contact}</span>
                    {#if e.subject}<span class="comm-subject">{e.subject}</span>{/if}
                    <span class="comm-time">{new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>

        <!-- Text preview + actions -->
        <details class="section text-section">
          <summary class="section-title">Plain Text Preview</summary>
          <pre class="text-preview">{reportText}</pre>
        </details>

        <div class="report-actions">
          <button class="action-btn" onclick={saveReport}>Save Report</button>
          <button class="action-btn ghost" onclick={copyReport}>Copy Text</button>
          <button class="action-btn ghost" onclick={generateReport}>Regenerate</button>
          {#if copyMsg}<span class="copy-msg">{copyMsg}</span>{/if}
        </div>
      {/if}
    </div>

  {:else}
    <!-- HISTORY -->
    <div class="history-scroll">
      {#if history.length === 0}
        <div class="empty">
          <p>No saved wrap reports yet. Generate and save a report to build your history.</p>
        </div>
      {:else}
        <div class="history-list">
          {#each history as r, idx (r.generated)}
            <div class="history-card" class:active={historyIdx === idx}>
              <div class="hc-header">
                <span class="hc-date">{new Date(r.generated).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span class="hc-time">{new Date(r.generated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                {#if r.shootDay}<span class="hc-day">Day {r.shootDay}</span>{/if}
              </div>
              <div class="hc-stats">
                <span>Scenes: {r.sceneSummary.complete}/{r.sceneSummary.total}</span>
                <span>Pages: {S.fmtEighths(r.sceneSummary.completeEighths)}</span>
                <span>Cast: {r.castWrapped}/{r.castCount}</span>
                <span>{r.firstShot} — {r.lastShot}</span>
              </div>
              <div class="hc-actions">
                <button class="tb-btn" onclick={() => viewHistoryReport(idx)}>View</button>
                <button class="tb-btn" onclick={() => {
                  reportText = WR.formatText(r);
                  void copyReport();
                }}>Copy</button>
                <button class="tb-btn danger" onclick={() => void deleteHistoryReport(idx)}>Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap-tab {
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
  .tb-btn.accent { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .tb-btn.accent:hover { background: var(--accent2); border-color: var(--accent2); }
  .tb-btn.danger { color: var(--danger); border-color: var(--danger); }
  .tb-btn.danger:hover { background: rgba(224, 90, 90, 0.1); }
  .badge {
    font-size: 9px;
    background: rgba(167, 139, 250, 0.2);
    color: var(--accent);
    padding: 1px 5px;
    border-radius: 8px;
    margin-left: 4px;
  }

  /* ─── Report scroll ─── */
  .report-scroll, .history-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .empty { padding: 40px; text-align: center; }
  .empty p { font-size: 14px; color: var(--text2); line-height: 1.6; margin-bottom: 12px; }

  /* ─── Summary cards ─── */
  .summary-strip {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 80px;
  }
  .card.danger { border-color: var(--danger); background: rgba(224, 90, 90, 0.08); }
  .card.warn { border-color: var(--warn); background: rgba(251, 191, 36, 0.08); }
  .card-label {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
  }
  .card-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
    font-family: var(--cond);
  }
  .card.danger .card-value { color: var(--danger); }
  .card.warn .card-value { color: var(--warn); }

  /* ─── Sections ─── */
  .sections { display: flex; flex-direction: column; gap: 8px; }
  .section {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .section-title {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text2);
    padding: 8px 14px;
    background: var(--bg2);
    cursor: pointer;
    user-select: none;
  }
  .section-title:hover { color: var(--accent); }
  .section-title.danger-text { color: var(--danger); }
  .section-title.warn-text { color: var(--warn); }

  /* ─── Scene grid ─── */
  .scene-grid { padding: 0 4px 4px; }
  .sg-header, .sg-row {
    display: grid;
    grid-template-columns: 60px 90px 60px 60px 80px 80px 80px;
    gap: 0;
  }
  .sg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .sg-row > span {
    padding: 5px 8px;
    font-size: 12px;
    color: var(--text2);
    border-bottom: 1px solid var(--border);
  }
  .sg-row.complete > span { color: var(--text); }
  .sg-row.omitted > span { opacity: 0.4; text-decoration: line-through; }
  .sg-sc { font-weight: 600; color: var(--text); }
  .status-complete { color: var(--success) !important; }
  .status-shooting { color: var(--accent) !important; }
  .status-rehearsing { color: var(--warn) !important; }
  .status-omitted { color: var(--text3) !important; }

  /* ─── Person grid ─── */
  .person-grid { padding: 0 4px 4px; }
  .pg-header, .pg-row {
    display: grid;
    grid-template-columns: 1fr 120px 70px 70px 70px 70px;
    gap: 0;
  }
  .pg-header span {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text3);
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .pg-row > span {
    padding: 5px 8px;
    font-size: 12px;
    color: var(--text2);
    border-bottom: 1px solid var(--border);
  }
  .pg-name { font-weight: 600; color: var(--text); }
  .pg-role { font-size: 11px; }
  .pg-hours { font-family: var(--mono); font-size: 11px; }

  /* ─── OT grid ─── */
  .ot-grid { padding: 8px 14px; }
  .ot-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .ot-name { font-weight: 600; color: var(--text); min-width: 120px; }
  .ot-role { color: var(--text2); min-width: 100px; }
  .ot-source { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; min-width: 40px; }
  .ot-hours { font-family: var(--mono); color: var(--danger); min-width: 60px; }
  .ot-badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(224, 90, 90, 0.15);
    color: var(--danger);
    border: 1px solid rgba(224, 90, 90, 0.3);
  }

  /* ─── Issues list ─── */
  .issues-list { padding: 8px 14px; }
  .issue-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .issue-type { font-weight: 600; white-space: nowrap; color: var(--warn); }
  .issue-desc { color: var(--text); flex: 1; }
  .issue-person { font-family: var(--mono); font-size: 10px; color: var(--text3); }

  /* ─── Notes list ─── */
  .notes-list { padding: 8px 14px; }
  .note-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .note-scene {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(167, 139, 250, 0.1);
    color: var(--accent);
    white-space: nowrap;
  }
  .note-text { color: var(--text2); }

  /* ─── Communications ─── */
  .comm-list { padding: 8px 14px; }
  .comm-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .comm-row.flagged { border-left: 2px solid var(--warn); padding-left: 6px; }
  .comm-icon { font-size: 14px; }
  .comm-dir { font-family: var(--mono); font-size: 10px; color: var(--text3); }
  .comm-dir.inbound { color: var(--success); }
  .comm-contact { font-weight: 600; color: var(--text); }
  .comm-subject { font-size: 11px; color: var(--text2); }
  .comm-time { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-left: auto; }

  /* ─── Text preview ─── */
  .text-section { margin-top: 12px; }
  .text-preview {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text2);
    line-height: 1.5;
    padding: 14px;
    white-space: pre-wrap;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  /* ─── Report actions ─── */
  .report-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 14px 0 6px;
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
  .action-btn.ghost {
    background: transparent;
    color: var(--text2);
    border-color: var(--border);
  }
  .action-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
  .copy-msg { font-family: var(--mono); font-size: 11px; color: var(--success); }

  /* ─── History ─── */
  .history-list { display: flex; flex-direction: column; gap: 8px; }
  .history-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    transition: border-color 0.12s;
  }
  .history-card:hover { border-color: var(--accent); }
  .history-card.active { border-color: var(--accent); background: rgba(167, 139, 250, 0.05); }
  .hc-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .hc-date { font-weight: 600; font-size: 14px; color: var(--text); }
  .hc-time { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .hc-day {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(167, 139, 250, 0.1);
    color: var(--accent);
  }
  .hc-stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--text2);
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .hc-stats span { font-family: var(--mono); font-size: 11px; }
  .hc-actions { display: flex; gap: 6px; }

  @media (max-width: 640px) {
    .report-scroll { padding: 10px 12px; }
    .summary-strip { gap: 6px; }
    .card { min-width: 60px; padding: 6px 10px; }
    .card-value { font-size: 14px; }
    .sg-header, .sg-row { grid-template-columns: 50px 70px 50px 50px 60px 60px 60px; }
    .pg-header, .pg-row { grid-template-columns: 1fr 80px 60px 60px 60px 60px; }
  }
</style>
