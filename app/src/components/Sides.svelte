<script lang="ts">
  import { onMount } from 'svelte';
  import { fileToBase64 } from '../lib/extract';
  import {
    extractFromCallSheet,
    extractFromShootingSchedule,
    extractFromStripBoard,
  } from '../lib/sides/reconcile';
  import type { CsSceneExtractResult } from '../lib/sides/reconcile';
  import { buildScriptIndex, computePagePlan, findMissingScenes } from '../lib/sides/scriptIndex';
  import { buildAnnotatedPdfs } from '../lib/sides/annotate';
  import { validateSides } from '../lib/sides/validate';
  import { extractCharacters, crossCheckCast } from '../lib/sides/characters';
  import * as store from '../lib/sides/store';
  import * as sync from '../lib/sync';
  import type {
    SourceScene,
    ValidationResult,
    CharactersByScene,
    CastCrossCheck,
    SidesProgress,
    ScriptCacheEntry,
  } from '../lib/sides/types';

  // ── Steps ──────────────────────────────────────────────────────────────────
  type Step = 'entry' | 'crosscheck' | 'script' | 'generate' | 'results';
  const STEP_ORDER: Step[] = ['entry', 'crosscheck', 'script', 'generate', 'results'];
  const STEP_LABELS: Record<Step, string> = {
    entry:      '1 Scenes',
    crosscheck: '2 Cross-check',
    script:     '3 Script',
    generate:   '4 Generate',
    results:    '5 Results',
  };

  let step = $state<Step>('entry');

  // ── Scene entry (manual — source of truth) ─────────────────────────────────
  const SCENE_NUM_RE = /^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?$/i;

  let sceneInput = $state('');
  let parsedScenes = $derived(
    sceneInput
      .split(/[\s,;\/\n\r]+/)
      .map((s) => s.trim().toUpperCase().replace(/\.$/, ''))
      .filter((s) => s.length > 0 && SCENE_NUM_RE.test(s)),
  );

  // ── Optional documents (cross-check only) ─────────────────────────────────
  let csFile    = $state<File | null>(null);
  let ssFile    = $state<File | null>(null);
  let stripFile = $state<File | null>(null);

  let autoShootDayNum     = $state<number | null>(null);
  let manualShootDayInput = $state('');
  let shootDayNum = $derived(
    manualShootDayInput.trim() !== '' && !isNaN(Number(manualShootDayInput.trim()))
      ? Number(manualShootDayInput.trim())
      : autoShootDayNum,
  );

  // ── Cross-check state ──────────────────────────────────────────────────────
  let crossCheckLoading = $state(false);
  let crossCheckErr     = $state<string | null>(null);
  let csExtracted    = $state<SourceScene[]>([]);
  let ssExtracted    = $state<SourceScene[]>([]);
  let stripExtracted = $state<SourceScene[]>([]);
  let castList = $state<CsSceneExtractResult['castList']>([]);

  // ── Script ─────────────────────────────────────────────────────────────────
  let scriptBuf     = $state<ArrayBuffer | null>(null);
  let scriptB64     = $state<string | null>(null);
  let scriptMeta    = $state<ScriptCacheEntry | null>(null);
  let cachedScripts = $state<ScriptCacheEntry[]>([]);
  let scriptErr     = $state<string | null>(null);
  let scriptLoading = $state(false);

  // ── Generation ─────────────────────────────────────────────────────────────
  const INITIAL_PROGRESS: SidesProgress[] = [
    { stage: 'index',      status: 'pending', message: 'Build scene index from script' },
    { stage: 'select',     status: 'pending', message: 'Select pages' },
    { stage: 'annotate',   status: 'pending', message: 'Annotate PDF' },
    { stage: 'validate',   status: 'pending', message: 'Validate sides' },
    { stage: 'characters', status: 'pending', message: 'Extract characters' },
  ];
  let progress   = $state<SidesProgress[]>(INITIAL_PROGRESS.map((p) => ({ ...p })));
  let generating = $state(false);
  let genErr     = $state<string | null>(null);

  // ── Results ────────────────────────────────────────────────────────────────
  let scriptOrderBytes = $state<Uint8Array | null>(null);
  let shootOrderBytes  = $state<Uint8Array | null>(null);
  let rawBytes         = $state<Uint8Array | null>(null);
  let validation       = $state<ValidationResult | null>(null);
  let characters       = $state<CharactersByScene | null>(null);
  let castCrossCheck   = $state<CastCrossCheck | null>(null);
  let resultPageCount  = $state(0);

  // ── Mount ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    cachedScripts = await store.listCachedScripts();
    const state = store.readState();
    if (state.scriptCache) scriptMeta = state.scriptCache;
    try {
      const nd = sync.getJSON<{ tomorrow?: { dayLabel?: string } }>('ST_nextday');
      const m = /Day\s*(\d+)/i.exec(nd?.tomorrow?.dayLabel ?? '');
      if (m?.[1]) autoShootDayNum = Number(m[1]);
    } catch { /* ignore */ }
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function stepDone(s: Step): boolean {
    return STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(step);
  }

  function setProgress(
    stage: SidesProgress['stage'],
    status: SidesProgress['status'],
    message: string,
  ) {
    progress = progress.map((p) => (p.stage === stage ? { ...p, status, message } : p));
  }

  function norm(n: string): string {
    return n.trim().toUpperCase().replace(/\.$/, '');
  }

  function sceneInDoc(scenes: SourceScene[], num: string): boolean {
    return scenes.some((s) => norm(s.num) === norm(num));
  }

  function extrasInDoc(scenes: SourceScene[], list: string[]): string[] {
    const listSet = new Set(list.map(norm));
    const seen = new Set<string>();
    return scenes
      .map((s) => norm(s.num))
      .filter((n) => !listSet.has(n) && !seen.has(n) && seen.add(n));
  }

  function inferRevision(filename: string): string {
    const m = filename.match(/\b(rev\.?\s*[a-z]+|production draft|shooting draft|[a-z]+\s*draft)\b/i);
    return m?.[0] ?? 'default';
  }

  function bufToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  }

  function resetAll() {
    sceneInput = '';
    csFile = null; ssFile = null; stripFile = null;
    csExtracted = []; ssExtracted = []; stripExtracted = [];
    castList = []; crossCheckErr = null;
    scriptOrderBytes = null; shootOrderBytes = null; rawBytes = null;
    validation = null; characters = null; castCrossCheck = null;
    genErr = null;
    progress = INITIAL_PROGRESS.map((p) => ({ ...p }));
  }

  // ── Step 1 → Step 2/3 ─────────────────────────────────────────────────────
  function proceedFromEntry() {
    if (!parsedScenes.length) return;
    const hasDocs = !!(csFile || ssFile || stripFile);
    if (hasDocs) {
      runCrossCheck(); // fires async, UI transitions immediately
      step = 'crosscheck';
    } else {
      step = 'script';
    }
  }

  // ── Cross-check extraction ─────────────────────────────────────────────────
  async function runCrossCheck() {
    crossCheckLoading = true;
    crossCheckErr = null;
    csExtracted = []; ssExtracted = []; stripExtracted = []; castList = [];

    const errors: string[] = [];

    if (csFile) {
      try {
        const b64 = await fileToBase64(csFile);
        const result = await extractFromCallSheet(b64);
        csExtracted = result.scenes;
        castList = result.castList;
      } catch (e) {
        errors.push(`Call sheet: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (ssFile) {
      try {
        const b64 = await fileToBase64(ssFile);
        const { scenes } = await extractFromShootingSchedule(b64, shootDayNum);
        ssExtracted = scenes;
      } catch (e) {
        errors.push(`Schedule: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (stripFile) {
      try {
        const b64 = await fileToBase64(stripFile);
        stripExtracted = await extractFromStripBoard(b64);
      } catch (e) {
        errors.push(`Strip board: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (errors.length) crossCheckErr = errors.join('\n');
    crossCheckLoading = false;
  }

  // ── Script ─────────────────────────────────────────────────────────────────
  async function uploadScript(file: File) {
    scriptLoading = true; scriptErr = null;
    try {
      const buf = await file.arrayBuffer();
      const revisionLabel = inferRevision(file.name);
      await store.saveScript(buf, {
        revisionLabel,
        filename: file.name,
        filesize: file.size,
        pageCount: 0,
      });
      scriptBuf = buf;
      scriptB64 = bufToBase64(buf);
      scriptMeta = {
        revisionLabel,
        filename: file.name,
        filesize: file.size,
        cachedAt: new Date().toISOString(),
        pageCount: 0,
      };
      cachedScripts = await store.listCachedScripts();
    } catch (e) {
      scriptErr = e instanceof Error ? e.message : String(e);
    } finally {
      scriptLoading = false;
    }
  }

  async function loadCachedScript(entry: ScriptCacheEntry) {
    scriptLoading = true; scriptErr = null;
    try {
      const buf = await store.loadScript(entry.revisionLabel);
      if (!buf) throw new Error('Script not in this browser\'s cache. Re-upload the PDF.');
      scriptBuf = buf;
      scriptB64 = bufToBase64(buf);
      scriptMeta = entry;
    } catch (e) {
      scriptErr = e instanceof Error ? e.message : String(e);
    } finally {
      scriptLoading = false;
    }
  }

  async function deleteCachedScript(revisionLabel: string) {
    await store.deleteScript(revisionLabel);
    cachedScripts = await store.listCachedScripts();
    if (scriptMeta?.revisionLabel === revisionLabel) {
      scriptMeta = null; scriptBuf = null; scriptB64 = null;
    }
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  async function generate() {
    if (!scriptBuf || !parsedScenes.length) return;
    generating = true; genErr = null;
    scriptOrderBytes = null; shootOrderBytes = null; rawBytes = null;
    validation = null; characters = null; castCrossCheck = null;
    progress = INITIAL_PROGRESS.map((p) => ({ ...p }));

    // User-entered order = shoot order
    const shootOrderNums = [...parsedScenes];

    try {
      // ── Stage 1: Build scene index ──────────────────────────────────────────
      setProgress('index', 'running', 'Scanning script for scene headings…');
      const { entries: index, totalPages } = await buildScriptIndex(
        scriptBuf,
        shootOrderNums,
        scriptB64 ?? undefined,
        (msg) => setProgress('index', 'running', msg),
      );

      const missing = findMissingScenes(index, shootOrderNums);
      const foundCount = index.filter((e) => !e.isContinuation).length;

      if (missing.length > 0) {
        setProgress(
          'index', 'done',
          `⚠ ${foundCount} scenes found — ${missing.length} not located ` +
          `(${missing.join(', ')}): those will be skipped`,
        );
      } else {
        setProgress('index', 'done', `Index built — ${foundCount} scenes located`);
      }

      // Only work with scenes that were actually found
      const foundNums = shootOrderNums.filter((n) => !missing.includes(n));
      if (!foundNums.length) {
        throw new Error(
          'None of the entered scene numbers could be located in this script PDF.\n\n' +
          'Common causes:\n' +
          '• The script was scanned as images (no text layer)\n' +
          '• The scene numbers in your list don\'t match those printed in the script\n' +
          '• The wrong script revision is loaded',
        );
      }

      // ── Stage 2: Page selection ─────────────────────────────────────────────
      setProgress('select', 'running', 'Computing pages to include…');
      const pagePlan = computePagePlan(index, foundNums, totalPages);
      if (!pagePlan.pages0.length) throw new Error('Page selection returned 0 pages.');
      setProgress('select', 'done', `${pagePlan.pages0.length} pages selected`);

      // Script order = sort found scenes by their page in the index
      const scriptOrderNums = [...foundNums].sort((a, b) => {
        const eA = index.find((e) => norm(e.num) === norm(a) && !e.isContinuation);
        const eB = index.find((e) => norm(e.num) === norm(b) && !e.isContinuation);
        return (eA?.page ?? 0) - (eB?.page ?? 0);
      });

      // ── Stage 3: Annotate ───────────────────────────────────────────────────
      setProgress('annotate', 'running', 'Building annotated PDFs…');
      const annotated = await buildAnnotatedPdfs(
        scriptBuf, pagePlan, index, foundNums, shootOrderNums,
      );
      scriptOrderBytes = annotated.scriptOrderBytes;
      shootOrderBytes  = annotated.shootOrderBytes;
      rawBytes         = annotated.rawBytes;
      resultPageCount  = annotated.pageCount;
      setProgress('annotate', 'done', `${annotated.pageCount} pages annotated`);

      // ── Stage 4: Validate ───────────────────────────────────────────────────
      setProgress('validate', 'running', 'Validating…');
      const valResult = await validateSides(
        annotated.scriptOrderBytes, pagePlan.pages0, index, foundNums,
      );
      validation = valResult;
      if (valResult.passed) {
        setProgress('validate', 'done', 'All target scenes confirmed in sides');
      } else {
        setProgress(
          'validate', 'done',
          `${valResult.issues.length} note(s) — see results for details`,
        );
      }

      // ── Stage 5: Characters ─────────────────────────────────────────────────
      setProgress('characters', 'running', 'Extracting characters…');
      const chars = await extractCharacters(annotated.scriptOrderBytes, scriptOrderNums);
      characters = chars;
      await store.saveCharactersByScene(chars);
      if (castList.length > 0) castCrossCheck = crossCheckCast(chars, castList);
      await store.recordGeneration(foundNums);
      const totalSpeakers = new Set(Object.values(chars).flat()).size;
      setProgress(
        'characters', 'done',
        `${totalSpeakers} unique characters across ${foundNums.length} scenes`,
      );

      step = 'results';
    } catch (e) {
      genErr = e instanceof Error ? e.message : String(e);
    } finally {
      generating = false;
    }
  }

  // ── Download ───────────────────────────────────────────────────────────────
  function download(bytes: Uint8Array, suffix: string) {
    const base = (scriptMeta?.filename ?? 'script')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-z0-9_\-]/gi, '-');
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-${suffix}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  let canGenerate = $derived(!!scriptBuf && !!scriptB64 && parsedScenes.length > 0);
  let hasDocs     = $derived(!!(csFile || ssFile || stripFile));
</script>

<div class="sides-wrap">
  <!-- Stepper -->
  <div class="stepper">
    {#each STEP_ORDER as s}
      <div class="step-item" class:active={step === s} class:done={stepDone(s)}>
        {STEP_LABELS[s]}
      </div>
    {/each}
  </div>

  <!-- ── Step 1: Scene Entry ────────────────────────────────────────────── -->
  {#if step === 'entry'}
    <div class="panel">
      <div class="panel-hdr">Tomorrow's Scenes</div>
      <p class="panel-sub">
        Enter the scene numbers you're shooting tomorrow — one per line, or comma/space separated.
        These are the <strong>source of truth</strong>; documents below are for cross-checking only.
      </p>

      <div class="sec-label">Scene numbers *</div>
      <textarea
        class="scene-textarea"
        placeholder="e.g.  47, 48, 49, 61A, 62&#10;or one per line"
        bind:value={sceneInput}
        rows="4"
      ></textarea>

      {#if parsedScenes.length > 0}
        <div class="chip-row">
          {#each parsedScenes as num}
            <span class="scene-chip">{num}</span>
          {/each}
          <span class="chip-count">{parsedScenes.length} scene{parsedScenes.length !== 1 ? 's' : ''}</span>
        </div>
      {/if}

      <!-- Optional documents -->
      <div class="docs-divider">
        <span>Optional documents — for cross-checking only</span>
      </div>

      <div class="upload-grid">
        {#each [
          { key: 'cs',    label: 'Call Sheet PDF',       file: csFile,    set: (f: File|null) => { csFile = f; } },
          { key: 'ss',    label: 'Shooting Schedule PDF', file: ssFile,    set: (f: File|null) => { ssFile = f; } },
          { key: 'strip', label: 'Strip Board PDF',       file: stripFile, set: (f: File|null) => { stripFile = f; } },
        ] as src}
          <div>
            <div class="upload-label">{src.label}</div>
            <div
              class="upload-zone" class:loaded={src.file !== null}
              role="button" tabindex="0"
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) src.set(f); }}
              onclick={() => document.getElementById(`src-${src.key}`)?.click()}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById(`src-${src.key}`)?.click(); }}
            >
              {src.file ? `✓ ${src.file.name}` : 'Drop or click to upload'}
            </div>
            <input id={`src-${src.key}`} type="file" accept=".pdf" style="display:none"
              onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) src.set(f); (e.target as HTMLInputElement).value = ''; }}
            />
            {#if src.file}
              <button class="clear-btn" onclick={() => src.set(null)}>× Remove</button>
            {/if}
          </div>
        {/each}
      </div>

      {#if ssFile}
        <div class="shoot-day-row">
          <label class="shoot-day-label" for="shoot-day-input">
            Today is Shoot Day #
            {#if autoShootDayNum && !manualShootDayInput}
              <span class="auto-day">(auto: {autoShootDayNum})</span>
            {/if}
          </label>
          <input
            id="shoot-day-input" class="shoot-day-input" type="number" min="1"
            placeholder={autoShootDayNum ? String(autoShootDayNum) : 'e.g. 5'}
            bind:value={manualShootDayInput}
          />
          {#if shootDayNum}
            <span class="shoot-day-hint">→ schedule will extract Day {shootDayNum + 1}</span>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-primary" onclick={proceedFromEntry} disabled={!parsedScenes.length}>
          {hasDocs ? 'Extract & Cross-check →' : 'Continue →'}
        </button>
      </div>
    </div>

  <!-- ── Step 2: Cross-check ────────────────────────────────────────────── -->
  {:else if step === 'crosscheck'}
    <div class="panel">
      <div class="panel-hdr">Cross-check Results</div>
      <p class="panel-sub">
        Your scene list compared against the uploaded documents. This is for reference only —
        you can proceed regardless.
      </p>

      {#if crossCheckLoading}
        <div class="loading-row">
          <div class="spinner"></div>
          <span>Extracting from documents…</span>
        </div>
      {:else}
        <!-- Comparison table -->
        <div class="cc-table-wrap">
          <table class="cc-table">
            <thead>
              <tr>
                <th>Scene</th>
                {#if csFile}<th>Call Sheet</th>{/if}
                {#if ssFile}<th>Schedule</th>{/if}
                {#if stripFile}<th>Strip Board</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each parsedScenes as num}
                <tr>
                  <td class="cc-num">{num}</td>
                  {#if csFile}
                    <td class:cc-yes={sceneInDoc(csExtracted, num)} class:cc-no={!sceneInDoc(csExtracted, num)}>
                      {sceneInDoc(csExtracted, num) ? '✓' : '✗'}
                    </td>
                  {/if}
                  {#if ssFile}
                    <td class:cc-yes={sceneInDoc(ssExtracted, num)} class:cc-no={!sceneInDoc(ssExtracted, num)}>
                      {sceneInDoc(ssExtracted, num) ? '✓' : '✗'}
                    </td>
                  {/if}
                  {#if stripFile}
                    <td class:cc-yes={sceneInDoc(stripExtracted, num)} class:cc-no={!sceneInDoc(stripExtracted, num)}>
                      {sceneInDoc(stripExtracted, num) ? '✓' : '✗'}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Extras in docs not in list -->
        {#each [
          { label: 'Call Sheet', extras: extrasInDoc(csExtracted, parsedScenes), show: !!csFile },
          { label: 'Schedule',   extras: extrasInDoc(ssExtracted, parsedScenes), show: !!ssFile },
          { label: 'Strip Board', extras: extrasInDoc(stripExtracted, parsedScenes), show: !!stripFile },
        ].filter(x => x.show && x.extras.length > 0) as row}
          <div class="extras-warn">
            ⚠ <strong>{row.label}</strong> has scenes not in your list:
            <span class="extras-nums">{row.extras.join(', ')}</span>
          </div>
        {/each}

        <!-- Cast list from call sheet -->
        {#if castList.length > 0}
          <div class="sec-label" style="margin-top:16px">Cast list from call sheet ({castList.length} called)</div>
          <div class="cast-grid">
            {#each castList as c}
              <div class="cast-row">
                <span class="cast-num">#{c.num}</span>
                <span class="cast-name">{c.name}</span>
                <span class="cast-role">({c.role})</span>
                <span class="cast-time">{c.callTime}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if crossCheckErr}
          <div class="err-box" style="margin-top:12px">
            Some extractions failed (documents still usable for reference):<br/>{crossCheckErr}
          </div>
        {/if}
      {/if}

      <div class="actions">
        <button class="btn-ghost" onclick={() => step = 'entry'}>← Back</button>
        <button class="btn-primary" onclick={() => step = 'script'} disabled={crossCheckLoading}>
          Continue →
        </button>
      </div>
    </div>

  <!-- ── Step 3: Script ─────────────────────────────────────────────────── -->
  {:else if step === 'script'}
    <div class="panel">
      <div class="panel-hdr">Script PDF</div>
      <p class="panel-sub">
        Scripts are cached locally by revision label. Upload once per revision and reuse across shoot days.
      </p>

      {#if cachedScripts.length > 0}
        <div class="sec-label">Cached scripts</div>
        <div class="cached-list">
          {#each cachedScripts as entry}
            <div class="cached-row" class:active-cache={scriptMeta?.revisionLabel === entry.revisionLabel}>
              <div>
                <div class="cached-name">{entry.filename}</div>
                <div class="cached-meta">{entry.revisionLabel} · {Math.round(entry.filesize / 1024)} KB</div>
              </div>
              <div class="cached-btns">
                <button class="btn-sm" onclick={() => loadCachedScript(entry)}>
                  {scriptMeta?.revisionLabel === entry.revisionLabel ? '✓ Loaded' : 'Load'}
                </button>
                <button class="btn-sm danger" onclick={() => deleteCachedScript(entry.revisionLabel)}>Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="sec-label" style="margin-top:14px">Upload a new script revision</div>
      <div
        class="upload-zone" class:loaded={scriptBuf !== null}
        role="button" tabindex="0"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) uploadScript(f); }}
        onclick={() => document.getElementById('script-input')?.click()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('script-input')?.click(); }}
      >
        {scriptLoading ? 'Reading…' : scriptBuf ? `✓ ${scriptMeta?.filename}` : 'Drop or click to upload script PDF'}
      </div>
      <input id="script-input" type="file" accept=".pdf" style="display:none"
        onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadScript(f); (e.target as HTMLInputElement).value = ''; }}
      />
      {#if scriptErr}<div class="err-box" style="margin-top:8px">{scriptErr}</div>{/if}

      <div class="actions">
        <button class="btn-ghost" onclick={() => step = hasDocs ? 'crosscheck' : 'entry'}>← Back</button>
        <button class="btn-primary" onclick={() => step = 'generate'} disabled={!scriptBuf}>
          Ready to Generate →
        </button>
      </div>
    </div>

  <!-- ── Step 4: Generate ───────────────────────────────────────────────── -->
  {:else if step === 'generate'}
    <div class="panel">
      <div class="panel-hdr">Generate Sides</div>

      <div class="scene-summary">
        <div class="sec-label">{parsedScenes.length} scenes for tomorrow</div>
        <div class="chip-row">
          {#each parsedScenes as num}
            <span class="scene-chip">{num}</span>
          {/each}
        </div>
      </div>

      <div class="prog-list">
        {#each progress as p}
          <div class="prog-row">
            <div class="prog-dot"
              class:run={p.status === 'running'}
              class:done={p.status === 'done'}
              class:err={p.status === 'error'}
            ></div>
            <span class="prog-msg" class:dim={p.status === 'pending'}>{p.message}</span>
          </div>
        {/each}
      </div>

      {#if genErr}<div class="err-box">{genErr}</div>{/if}

      <div class="actions">
        <button class="btn-ghost" onclick={() => step = 'script'} disabled={generating}>← Back</button>
        <button class="btn-primary" onclick={generate} disabled={!canGenerate || generating}>
          {generating ? 'Generating…' : '✦ Generate Sides'}
        </button>
      </div>
    </div>

  <!-- ── Step 5: Results ────────────────────────────────────────────────── -->
  {:else if step === 'results'}
    <div class="panel">
      <div class="panel-hdr">Sides Ready</div>

      {#if validation}
        <div class="val-badge" class:val-pass={validation.passed} class:val-fail={!validation.passed}>
          {validation.passed
            ? `✓ All ${resultPageCount} pages validated`
            : `ℹ ${validation.issues.length} note${validation.issues.length !== 1 ? 's' : ''} (non-blocking)`}
        </div>
        {#if !validation.passed}
          <div class="val-issues">
            {#each validation.issues as issue}
              <div class="val-issue">{issue.page > 0 ? `Page ${issue.page}: ` : ''}{issue.description}</div>
            {/each}
          </div>
        {/if}
      {/if}

      <div class="dl-row">
        {#if scriptOrderBytes}
          <button class="dl-btn primary" onclick={() => download(scriptOrderBytes!, 'sides-script-order')}>
            ⬇ Script Order
            <span class="dl-sub">{resultPageCount} pages · annotated</span>
          </button>
        {/if}
        {#if shootOrderBytes}
          <button class="dl-btn ghost" onclick={() => download(shootOrderBytes!, 'sides-shoot-order')}>
            ⬇ Shoot Order
            <span class="dl-sub">annotated</span>
          </button>
        {/if}
        {#if rawBytes}
          <button class="dl-btn ghost" onclick={() => download(rawBytes!, 'sides-raw')}>
            ⬇ Raw
            <span class="dl-sub">no annotations</span>
          </button>
        {/if}
      </div>

      <!-- Cast cross-check -->
      {#if castCrossCheck}
        <div class="sec-label" style="margin-top:20px">Cast Cross-check</div>
        {#if castCrossCheck.unmatchedSpeakers.length === 0 && castCrossCheck.uncalledCast.length === 0}
          <div class="xcheck-ok">✓ All speakers match the call sheet cast list.</div>
        {:else}
          {#if castCrossCheck.unmatchedSpeakers.length > 0}
            <div class="xcheck-warn">
              <strong>Speakers in sides not on call sheet:</strong>
              {#each castCrossCheck.unmatchedSpeakers as s}
                <div class="xcheck-row">"{s.speaker}" — scenes {s.scenes.join(', ')}</div>
              {/each}
            </div>
          {/if}
          {#if castCrossCheck.uncalledCast.length > 0}
            <div class="xcheck-warn" style="margin-top:8px">
              <strong>Called cast with no lines in sides:</strong>
              {#each castCrossCheck.uncalledCast as c}
                <div class="xcheck-row">#{c.num} {c.name} ({c.role})</div>
              {/each}
            </div>
          {/if}
        {/if}
      {/if}

      <!-- Per-scene characters -->
      {#if characters && parsedScenes.length > 0}
        <div class="sec-label" style="margin-top:20px">Characters per Scene</div>
        <div class="chars-grid">
          {#each parsedScenes as num}
            {@const speakers = characters[num] ?? []}
            <div class="char-scene">
              <span class="char-num">Sc {num}</span>
              <span class="char-names">
                {#if speakers.length === 0}
                  <em class="no-chars">no dialogue found</em>
                {:else}
                  {speakers.join(' · ')}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions" style="margin-top:24px">
        <button class="btn-ghost" onclick={() => { resetAll(); step = 'entry'; }}>← Start Over</button>
        <button class="btn-ghost" onclick={() => step = 'generate'}>Regenerate</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .sides-wrap { max-width: 860px; margin: 0 auto; padding: 24px 20px 48px; }

  /* Stepper */
  .stepper { display: flex; margin-bottom: 20px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .step-item { flex: 1; padding: 8px 6px; font-size: 10px; font-weight: 700; font-family: var(--mono); color: var(--text3); text-align: center; text-transform: uppercase; letter-spacing: .05em; border-right: 1px solid var(--border); background: var(--bg2); }
  .step-item:last-child { border-right: none; }
  .step-item.active { color: var(--accent); background: rgba(167,139,250,.1); }
  .step-item.done { color: var(--success); }

  /* Panel */
  .panel { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; }
  .panel-hdr { font-family: var(--cond); font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
  .panel-sub { font-size: 13px; color: var(--text2); margin-bottom: 20px; line-height: 1.55; }
  .sec-label { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--text3); margin-bottom: 6px; }

  /* Scene textarea */
  .scene-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; background: var(--bg3); border: 1.5px solid var(--border2); border-radius: var(--radius); color: var(--text); font-family: var(--mono); font-size: 14px; line-height: 1.6; resize: vertical; margin-bottom: 10px; }
  .scene-textarea:focus { outline: none; border-color: var(--accent); }

  /* Scene chips */
  .chip-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 14px; align-items: center; }
  .scene-chip { padding: 3px 10px; background: rgba(167,139,250,.15); border: 1px solid rgba(167,139,250,.35); border-radius: 10px; font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--accent); }
  .chip-count { font-family: var(--mono); font-size: 11px; color: var(--text3); margin-left: 4px; }

  /* Docs divider */
  .docs-divider { display: flex; align-items: center; gap: 10px; margin: 16px 0 14px; color: var(--text3); font-size: 11px; font-family: var(--mono); }
  .docs-divider::before, .docs-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  /* Upload */
  .upload-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 14px; }
  @media (max-width: 620px) { .upload-grid { grid-template-columns: 1fr; } }
  .upload-label { font-size: 11px; color: var(--text2); margin-bottom: 4px; font-weight: 600; }
  .upload-zone { border: 1.5px dashed var(--border2); border-radius: var(--radius); padding: 16px 10px; text-align: center; font-size: 12px; color: var(--text3); cursor: pointer; transition: all .15s; min-height: 58px; display: flex; align-items: center; justify-content: center; }
  .upload-zone:hover, .upload-zone:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
  .upload-zone.loaded { border-style: solid; border-color: var(--success); color: var(--success); }
  .clear-btn { margin-top: 4px; font-size: 10px; color: var(--text3); background: none; border: none; cursor: pointer; padding: 2px 0; }
  .clear-btn:hover { color: var(--danger); }

  /* Shoot day */
  .shoot-day-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
  .shoot-day-label { font-size: 12px; font-weight: 600; color: var(--text2); white-space: nowrap; }
  .auto-day { font-size: 10px; color: var(--text3); font-weight: 400; }
  .shoot-day-input { width: 70px; padding: 5px 8px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 5px; color: var(--text); font-family: var(--mono); font-size: 13px; text-align: center; }
  .shoot-day-input:focus { outline: none; border-color: var(--accent); }
  .shoot-day-hint { font-size: 11px; color: var(--text3); font-family: var(--mono); }

  /* Cross-check table */
  .loading-row { display: flex; align-items: center; gap: 12px; color: var(--text2); font-size: 13px; padding: 20px 0; }
  .spinner { width: 18px; height: 18px; border: 2px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .cc-table-wrap { overflow-x: auto; margin-bottom: 14px; }
  .cc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .cc-table th { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); padding: 6px 14px; text-align: center; border-bottom: 1px solid var(--border); }
  .cc-table th:first-child { text-align: left; }
  .cc-table td { padding: 5px 14px; text-align: center; border-bottom: 1px solid var(--border); }
  .cc-table tbody tr:hover { background: var(--bg3); }
  .cc-num { font-family: var(--mono); font-weight: 700; color: var(--accent); text-align: left !important; }
  .cc-yes { color: var(--success); font-weight: 700; }
  .cc-no  { color: var(--danger);  font-weight: 700; }
  .extras-warn { font-size: 12px; color: var(--warn); padding: 7px 12px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.25); border-radius: 5px; margin-bottom: 6px; }
  .extras-nums { font-family: var(--mono); margin-left: 6px; }

  /* Cast list */
  .cast-grid { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow-y: auto; }
  .cast-row { display: grid; grid-template-columns: 28px 1fr 1fr 60px; gap: 8px; padding: 4px 8px; background: var(--bg3); border-radius: 4px; font-size: 12px; align-items: center; }
  .cast-num { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .cast-name { color: var(--text); font-weight: 600; }
  .cast-role { color: var(--text2); }
  .cast-time { font-family: var(--mono); font-size: 11px; color: var(--accent); text-align: right; }

  /* Script cache */
  .cached-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .cached-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: 5px; }
  .cached-row.active-cache { border-color: var(--accent); }
  .cached-name { font-size: 12px; color: var(--text); }
  .cached-meta { font-family: var(--mono); font-size: 10px; color: var(--text3); margin-top: 1px; }
  .cached-btns { display: flex; gap: 5px; flex-shrink: 0; }
  .btn-sm { padding: 4px 10px; background: var(--bg2); color: var(--text2); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; cursor: pointer; transition: all .12s; }
  .btn-sm:hover { color: var(--accent); border-color: var(--accent); }
  .btn-sm.danger:hover { color: var(--danger); border-color: var(--danger); }

  /* Scene summary on generate step */
  .scene-summary { margin-bottom: 14px; }

  /* Progress */
  .prog-list { padding: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
  .prog-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text2); }
  .prog-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--border2); transition: background .2s; }
  .prog-dot.run { background: var(--warn); animation: sdpulse .8s ease-in-out infinite; }
  .prog-dot.done { background: var(--success); }
  .prog-dot.err  { background: var(--danger); }
  .prog-msg.dim { opacity: .4; }
  @keyframes sdpulse { 0%,100%{opacity:1}50%{opacity:.35} }

  /* Validation */
  .val-badge { padding: 9px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
  .val-pass { background: rgba(52,211,153,.12); color: var(--success); }
  .val-fail { background: rgba(251,191,36,.10); color: var(--warn); }
  .val-issues { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .val-issue { font-size: 12px; color: var(--warn); padding: 5px 10px; background: rgba(251,191,36,.06); border-radius: 4px; }

  /* Downloads */
  .dl-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .dl-btn { display: flex; flex-direction: column; align-items: center; padding: 12px 22px; border-radius: var(--radius); border: 1px solid; cursor: pointer; font-size: 13px; font-weight: 600; transition: all .15s; gap: 3px; }
  .dl-btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .dl-btn.primary:hover { background: var(--accent2); border-color: var(--accent2); }
  .dl-btn.ghost { background: none; color: var(--text2); border-color: var(--border2); }
  .dl-btn.ghost:hover { background: var(--bg3); color: var(--text); border-color: var(--accent); }
  .dl-sub { font-size: 10px; font-family: var(--mono); opacity: .65; font-weight: 400; }

  /* Cross-check results */
  .xcheck-ok { font-size: 13px; color: var(--success); padding: 8px 12px; background: rgba(52,211,153,.08); border-radius: 5px; }
  .xcheck-warn strong { font-size: 12px; color: var(--warn); display: block; margin-bottom: 4px; }
  .xcheck-row { font-size: 12px; color: var(--text2); padding: 3px 0 3px 12px; border-left: 2px solid var(--warn); margin-bottom: 2px; }

  /* Characters */
  .chars-grid { display: flex; flex-direction: column; gap: 3px; }
  .char-scene { display: grid; grid-template-columns: 60px 1fr; gap: 10px; padding: 5px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; align-items: start; }
  .char-num { font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--accent); padding-top: 1px; }
  .char-names { font-size: 12px; color: var(--text2); line-height: 1.45; }
  .no-chars { color: var(--text3); font-style: italic; }

  /* Actions */
  .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  .btn-primary { padding: 10px 20px; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); border-radius: var(--radius); font-family: var(--font); font-size: 13px; font-weight: 600; cursor: pointer; transition: all .12s; }
  .btn-primary:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); }
  .btn-primary:disabled { opacity: .45; cursor: not-allowed; }
  .btn-ghost { padding: 10px 18px; background: transparent; color: var(--text2); border: 1px solid var(--border); border-radius: var(--radius); font-family: var(--font); font-size: 13px; font-weight: 600; cursor: pointer; transition: all .12s; }
  .btn-ghost:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .btn-ghost:disabled { opacity: .45; cursor: not-allowed; }
  .err-box { background: rgba(224,90,90,.12); color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; }
</style>
