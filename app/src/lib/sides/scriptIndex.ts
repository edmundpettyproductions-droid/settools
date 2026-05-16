// Deterministic scene-heading index built from the script PDF using pdf.js.
// Falls back to the Claude LLM for any scenes the regex approach can't locate
// (handles locked PDFs, non-standard formats, numbered-scene-off scripts, etc.).

import type { SceneIndexEntry } from './types';
import { extractFromPdf } from '../extract';

// ── Minimal pdf.js types (loaded from CDN) ────────────────────────────────────

interface PdfTextItem {
  str: string;
  transform: [number, number, number, number, number, number]; // tx=transform[4], ty=transform[5]
  width: number;
  height: number;
}

interface PdfjsPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
}

interface PdfjsDocument {
  numPages: number;
  getPage(pageNum: number): Promise<PdfjsPage>;
}

// ── Regex patterns ─────────────────────────────────────────────────────────────

// Scene numbers: "47", "61A", "61AB", "47-1", "47-1A"
const SCENE_NUM_RE = /^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?$/;

// Scene headings: INT. / EXT. / INT./EXT. / I/E etc.
const HEADING_RE = /\b(INT|EXT|I\/E)\b/i;

// OMITTED scenes
const OMITTED_RE = /\bOMITTED\b/i;

// CONT'D continuation markers
const CONTD_RE = /\(CONT[''']?D\.?\)|\bCONTINUED\b/i;

// ── Line grouping ──────────────────────────────────────────────────────────────

const LINE_Y_TOLERANCE = 4;    // pt — items within this y-delta are on the same line
const GLYPH_X_GAP     = 20;   // pt — max gap between adjacent glyphs to concat
// Scene numbers appear in the leftmost OR rightmost portion of the page.
// Left: 0–40% of page width. Right: 60–100%.
const LEFT_MARGIN_RATIO  = 0.40;
const RIGHT_MARGIN_RATIO = 0.60;

interface TextLine {
  y: number;
  items: PdfTextItem[];
  pageWidth: number;
}

function groupIntoLines(items: PdfTextItem[], pageWidth: number): TextLine[] {
  const visible = items.filter((it) => it.str.trim().length > 0);
  visible.sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > LINE_Y_TOLERANCE) return dy;
    return a.transform[4] - b.transform[4];
  });

  const lines: TextLine[] = [];
  for (const item of visible) {
    const y = item.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= LINE_Y_TOLERANCE) {
      last.items.push(item);
    } else {
      lines.push({ y, items: [item], pageWidth });
    }
  }
  return lines;
}

// ── Scene number extraction ────────────────────────────────────────────────────

interface SceneNumResult { num: string; x: number }

function tryExtractSceneNum(line: TextLine): SceneNumResult | null {
  // ── Strategy A: left-margin glyph fragment concat ─────────────────────────
  const maxLeftX = line.pageWidth * LEFT_MARGIN_RATIO;
  const leftItems = line.items
    .filter((it) => it.transform[4] < maxLeftX)
    .sort((a, b) => a.transform[4] - b.transform[4]);

  if (leftItems.length) {
    let concat = '';
    let prevRight = -Infinity;
    const firstX = leftItems[0].transform[4];
    for (const it of leftItems) {
      const x = it.transform[4];
      if (concat && x - prevRight > GLYPH_X_GAP) break;
      concat += it.str.replace(/\s/g, '');
      prevRight = x + (it.width || 6);
    }
    const candidate = concat.trim().replace(/\.$/, '');
    if (SCENE_NUM_RE.test(candidate)) return { num: candidate, x: firstX };
  }

  // ── Strategy B: right-margin glyph fragment concat ────────────────────────
  // Many production scripts print the scene number mirrored on the right margin.
  const minRightX = line.pageWidth * RIGHT_MARGIN_RATIO;
  const rightItems = line.items
    .filter((it) => it.transform[4] > minRightX)
    .sort((a, b) => a.transform[4] - b.transform[4]);

  if (rightItems.length) {
    let concat = '';
    let prevRight = -Infinity;
    const firstX = rightItems[0].transform[4];
    for (const it of rightItems) {
      const x = it.transform[4];
      if (concat && x - prevRight > GLYPH_X_GAP) break;
      concat += it.str.replace(/\s/g, '');
      prevRight = x + (it.width || 6);
    }
    const candidate = concat.trim().replace(/\.$/, '');
    if (SCENE_NUM_RE.test(candidate)) return { num: candidate, x: firstX };
  }

  return null;
}

function lineText(line: TextLine): string {
  return [...line.items]
    .sort((a, b) => a.transform[4] - b.transform[4])
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Per-page scanning ──────────────────────────────────────────────────────────

interface SceneCandidate {
  num: string;
  y: number;
  x: number;
  headingText: string;
  omitted: boolean;
  isContinuation: boolean;
}

function scanLines(lines: TextLine[]): SceneCandidate[] {
  const results: SceneCandidate[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const text = lineText(line);
    const hasHeading = HEADING_RE.test(text);
    const hasOmitted = OMITTED_RE.test(text);
    if (!hasHeading && !hasOmitted) continue;

    // Strategy 1: left OR right margin scene number (handles both formats)
    let numResult = tryExtractSceneNum(line);

    // Strategy 2: heading text begins with a scene number
    // e.g., a single PDF run: "47  INT. WAREHOUSE - DAY" or "47. INT. WAREHOUSE"
    if (!numResult) {
      const m = text.match(/^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?\s+/);
      if (m?.[1]) {
        numResult = { num: m[1], x: line.items[0]?.transform[4] ?? 0 };
      }
    }

    // Strategy 3: scene number is on the line ABOVE the heading
    // (some scripts print the number on its own line, then the INT./EXT. below)
    if (!numResult && li > 0) {
      const prevLine = lines[li - 1]!;
      const prevText = lineText(prevLine).trim().replace(/\.$/, '');
      if (SCENE_NUM_RE.test(prevText)) {
        numResult = { num: prevText, x: prevLine.items[0]?.transform[4] ?? 0 };
      }
    }

    if (!numResult) continue;

    const isContinuation = CONTD_RE.test(text);

    results.push({
      num: numResult.num,
      y: line.y,
      x: numResult.x,
      headingText: text,
      omitted: OMITTED_RE.test(text),
      isContinuation,
    });
  }

  return results;
}

// ── Find scene num y-coord on a specific page (for LLM-fallback entries) ──────
// (kept as a named helper — used by findYOnPage below)

/**
 * Given a page number and scene number, search for the heading y-coordinate.
 * Used when the LLM tells us which page a scene is on but the deterministic
 * pass missed it (e.g., numbered-scene-off format, unusual margins).
 */
async function findYOnPage(
  pdfjsDoc: PdfjsDocument,
  pageNum: number,
  sceneNum: string,
): Promise<{ y: number; x: number; headingText: string } | null> {
  const page = await pdfjsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const lines = groupIntoLines(tc.items as PdfTextItem[], viewport.width);

  const normNum = sceneNum.trim().toUpperCase().replace(/\.$/, '');

  for (const line of lines) {
    const text = lineText(line);
    // Check if this line contains a heading with the right scene num
    if (!HEADING_RE.test(text) && !OMITTED_RE.test(text)) continue;

    // Try left margin
    const numRes = tryExtractSceneNum(line);
    if (numRes && numRes.num.toUpperCase() === normNum) {
      return { y: line.y, x: numRes.x, headingText: text };
    }
    // Try leading num in text
    const m = text.match(/^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?\s+/);
    if (m?.[1] && m[1].toUpperCase() === normNum) {
      return { y: line.y, x: line.items[0]?.transform[4] ?? 36, headingText: text };
    }
  }

  // Looser fallback: any line that mentions this scene number AND has a heading keyword
  // (handles scripts where the number is embedded mid-line)
  const numPattern = new RegExp(`\\b${normNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const line of lines) {
    const text = lineText(line);
    if (numPattern.test(text) && HEADING_RE.test(text)) {
      return { y: line.y, x: line.items[0]?.transform[4] ?? 36, headingText: text };
    }
  }

  return null;
}

// ── Targeted full-script text search (runs before LLM fallback) ───────────────

/**
 * For a single target scene number, scan every page's cached lines looking for
 * any heading line that mentions this scene number anywhere (not just left margin).
 * This handles scripts with unusual layouts that the initial pass missed.
 */
async function findTargetSceneAnywhere(
  pdfjsDoc: PdfjsDocument,
  sceneNum: string,
  pageLineCache: Map<number, TextLine[]>,
): Promise<{ page: number; y: number; x: number; headingText: string } | null> {
  const normNum = sceneNum.trim().toUpperCase().replace(/\.$/, '');
  // Build a pattern that matches the scene number as an isolated token
  const escaped = normNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numPat = new RegExp(`(?:^|[^\\dA-Z])${escaped}(?:[^\\dA-Z]|$)`, 'i');

  for (let p = 1; p <= pdfjsDoc.numPages; p++) {
    let lines = pageLineCache.get(p);
    if (!lines) {
      // Page wasn't cached yet (shouldn't happen, but guard)
      const page = await pdfjsDoc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      lines = groupIntoLines(tc.items as PdfTextItem[], viewport.width);
      pageLineCache.set(p, lines);
    }

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const text = lineText(line);

      // Check if this is a heading line that contains the scene number anywhere
      if ((HEADING_RE.test(text) || OMITTED_RE.test(text)) && numPat.test(text)) {
        return { page: p, y: line.y, x: line.items[0]?.transform[4] ?? 36, headingText: text };
      }

      // Also check: scene number on its own line, then heading on next line
      const bare = text.trim().replace(/\.$/, '');
      if (bare.toUpperCase() === normNum && li + 1 < lines.length) {
        const nextLine = lines[li + 1]!;
        const nextText = lineText(nextLine);
        if (HEADING_RE.test(nextText) || OMITTED_RE.test(nextText)) {
          return { page: p, y: nextLine.y, x: line.items[0]?.transform[4] ?? 36, headingText: nextText };
        }
      }
    }
  }
  return null;
}

// ── CDN loading ────────────────────────────────────────────────────────────────

async function ensurePdfJs(): Promise<void> {
  const w = window as unknown as { pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } } };
  if (w.pdfjsLib) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
    document.head.appendChild(s);
  });
  const pdfjs = (window as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function getPdfjsLib() {
  return (window as unknown as {
    pdfjsLib: {
      getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
    };
  }).pdfjsLib;
}

// ── LLM fallback ──────────────────────────────────────────────────────────────

interface LlmSceneLocation {
  num: string;
  pdfPage: number;   // 1-indexed counting from first physical page
  omitted: boolean;
}

/**
 * Ask Claude to locate specific scenes in the script PDF.
 * Used only when the deterministic pdf.js pass fails to find them.
 */
async function locateScenesViaLlm(
  scriptB64: string,
  missingNums: string[],
): Promise<LlmSceneLocation[]> {
  const P =
    `Analyze this film script PDF. Locate these specific scenes: ${missingNums.join(', ')}.\n\n` +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "scenes": [\n' +
    '    {"num":"47","pdfPage":29,"omitted":false}\n' +
    '  ]\n' +
    '}\n\n' +
    'RULES:\n' +
    '- pdfPage = ACTUAL PDF page number counting from 1 for the very first physical page of this file (include title pages, blank pages). Do NOT use the printed page numbers in headers/footers.\n' +
    '- pdfPage is the page where the scene HEADING first appears.\n' +
    '- omitted: true only if the scene is explicitly marked OMITTED in the script.\n' +
    '- If a scene cannot be found, omit it from the array (do not guess).\n' +
    '- Include ALL of the listed scenes that you can find.';

  const SYS = 'Film script analyst. Return ONLY valid JSON, no markdown, no extra text.';

  const raw = await extractFromPdf(scriptB64, P, { system: SYS, maxTokens: 4000 });

  // Parse response
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
  let parsed: { scenes?: LlmSceneLocation[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const match = start >= 0 ? cleaned.slice(start) : cleaned;
    parsed = JSON.parse(match);
  }
  return parsed.scenes ?? [];
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ScriptIndexResult {
  entries: SceneIndexEntry[];
  /** Total physical page count of the script PDF (needed for last-scene page range). */
  totalPages: number;
}

/**
 * Build a deterministic index of all scene headings in the script PDF.
 * If targetNums + scriptB64 are provided, runs an LLM fallback for any
 * scenes that the pdf.js regex pass could not locate.
 */
export async function buildScriptIndex(
  scriptBuf: ArrayBuffer,
  targetNums?: string[],
  scriptB64?: string,
  onProgress?: (msg: string) => void,
): Promise<ScriptIndexResult> {
  await ensurePdfJs();
  const pdfjs = getPdfjsLib();
  // Use a copy of the buffer so pdf.js can transfer it to its Web Worker
  // without detaching the original — the original must stay usable for pdf-lib later.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(scriptBuf.slice(0)) }).promise;
  const allCandidates: Array<SceneCandidate & { page: number }> = [];
  const pageLineCache = new Map<number, TextLine[]>();

  onProgress?.(`Scanning ${doc.numPages} pages for scene headings…`);

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = groupIntoLines(tc.items as PdfTextItem[], viewport.width);
    pageLineCache.set(p, lines);

    const candidates = scanLines(lines);
    for (const c of candidates) allCandidates.push({ ...c, page: p });
  }

  onProgress?.(`Deterministic pass: ${allCandidates.length} headings found`);

  // ── Fallback pass 1: targeted full-script text search ─────────────────────
  // Runs before the LLM — handles wider margins, right-margin numbers, and
  // scripts where the number appears embedded in the heading text differently.
  if (targetNums && targetNums.length > 0) {
    const foundNums = new Set(
      allCandidates
        .filter((c) => !c.isContinuation)
        .map((c) => c.num.toUpperCase()),
    );
    const missing = targetNums.filter((n) => !foundNums.has(n.trim().toUpperCase()));

    if (missing.length > 0) {
      onProgress?.(`${missing.length} scene(s) not found in initial pass — running targeted text search…`);

      for (const num of missing) {
        const found = await findTargetSceneAnywhere(doc, num, pageLineCache);
        if (found) {
          allCandidates.push({
            num,
            page: found.page,
            y: found.y,
            x: found.x,
            headingText: found.headingText,
            omitted: OMITTED_RE.test(found.headingText),
            isContinuation: false,
          });
          foundNums.add(num.toUpperCase());
          onProgress?.(`Found scene ${num} via text search (page ${found.page})`);
        }
      }
    }
  }

  // ── Fallback pass 2: LLM (only for scenes still missing after text search) ─
  if (targetNums && targetNums.length > 0 && scriptB64) {
    const foundNums = new Set(
      allCandidates.filter((c) => !c.isContinuation).map((c) => c.num.toUpperCase()),
    );
    const missing = targetNums.filter((n) => !foundNums.has(n.trim().toUpperCase()));

    if (missing.length > 0) {
      onProgress?.(
        `${missing.length} scene${missing.length !== 1 ? 's' : ''} not found by text search ` +
        `(${missing.join(', ')}) — asking Claude to locate them…`,
      );

      try {
        const llmResults = await locateScenesViaLlm(scriptB64, missing);

        for (const loc of llmResults) {
          if (loc.pdfPage < 1 || loc.pdfPage > doc.numPages) continue;

          // Try to get exact y/x from pdf.js on the LLM-identified page
          const coords = await findYOnPage(doc, loc.pdfPage, loc.num);
          const y = coords?.y ?? 600;
          const x = coords?.x ?? 36;
          const headingText = coords?.headingText ?? `${loc.num} (located by AI)`;

          if (!foundNums.has(loc.num.toUpperCase())) {
            allCandidates.push({
              num: loc.num,
              page: loc.pdfPage,
              y,
              x,
              headingText,
              omitted: loc.omitted,
              isContinuation: false,
            });
            foundNums.add(loc.num.toUpperCase());
          }
        }

        const stillMissing = missing.filter((n) => !foundNums.has(n.toUpperCase()));
        if (stillMissing.length > 0) {
          onProgress?.(`Still missing after AI lookup: ${stillMissing.join(', ')}`);
        } else {
          onProgress?.(`All scenes located (${llmResults.length} found via AI)`);
        }
      } catch (llmErr) {
        onProgress?.(`AI lookup failed: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}`);
      }
    }
  }

  // Re-sort after any fallback additions (by page, then y descending for pdf.js coords)
  allCandidates.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return b.y - a.y;
  });

  // Build index entries with next-scene pointers
  // Warn if script appears to have no text (likely a scanned image PDF)
  const totalLines = Array.from(pageLineCache.values()).reduce((s, l) => s + l.length, 0);
  if (totalLines < doc.numPages * 3) {
    onProgress?.(
      '⚠ Very little text detected in this script — it may be a scanned image PDF with no text layer. ' +
      'Scene detection requires a text-selectable PDF.',
    );
  }

  const entries: SceneIndexEntry[] = allCandidates.map((c, i) => {
    const next = allCandidates[i + 1] ?? null;
    return {
      num: c.num,
      page: c.page,
      y: c.y,
      x: c.x,
      headingText: c.headingText,
      nextStartPage: next?.page ?? null,
      nextStartY: next?.y ?? null,
      omitted: c.omitted,
      isContinuation: c.isContinuation,
    };
  });

  return { entries, totalPages: doc.numPages };
}

/** Look up all index entries for a given scene number. */
export function findSceneEntries(index: SceneIndexEntry[], num: string): SceneIndexEntry[] {
  const normalized = num.trim().toUpperCase().replace(/\.$/, '');
  return index.filter((e) => e.num.toUpperCase() === normalized);
}

/** Return any canonical scene numbers missing from the index (no non-continuation entry). */
export function findMissingScenes(index: SceneIndexEntry[], canonicalNums: string[]): string[] {
  return canonicalNums.filter((num) => {
    const entries = findSceneEntries(index, num);
    return !entries.some((e) => !e.isContinuation);
  });
}

// ── Page plan ──────────────────────────────────────────────────────────────────

export interface PagePlan {
  /** 0-indexed pages to include (sorted, deduped). */
  pages0: number[];
  /** Per included page (0-indexed): segments in top-to-bottom order. */
  splitMap: Map<number, Array<{ num: string; isTarget: boolean; y: number; x: number }>>;
}

export function computePagePlan(
  index: SceneIndexEntry[],
  targetNums: string[],
  totalPages: number,
): PagePlan {
  const targetSet = new Set(targetNums.map((n) => n.trim().toUpperCase()));
  const pageSet = new Set<number>();
  const splitMap = new Map<number, Array<{ num: string; isTarget: boolean; y: number; x: number }>>();

  const nonCont = index.filter((e) => !e.isContinuation);

  for (let i = 0; i < nonCont.length; i++) {
    const entry = nonCont[i]!;
    const isTarget = targetSet.has(entry.num.toUpperCase());
    const nextNonCont = nonCont[i + 1] ?? null;

    const startPage0 = entry.page - 1;
    // For the last scene in the script, include all remaining pages up to the end.
    // Previously this was capped at entry.page - 1 (= startPage0), which only
    // ever included a single page for the final scene — now fixed.
    const endPage0 = nextNonCont ? nextNonCont.page - 2 : totalPages - 1;

    for (let p = startPage0; p <= Math.max(startPage0, endPage0); p++) {
      if (isTarget) pageSet.add(p);
    }

    // Register on split pages (pages shared with a neighbour)
    const addToSplit = (p: number) => {
      if (!splitMap.has(p)) splitMap.set(p, []);
      const segs = splitMap.get(p)!;
      if (!segs.some((s) => s.num.toUpperCase() === entry.num.toUpperCase())) {
        segs.push({ num: entry.num, isTarget, y: entry.y, x: entry.x });
      }
    };

    const prevNonCont = nonCont[i - 1] ?? null;
    if (prevNonCont?.page === entry.page) addToSplit(entry.page - 1);
    if (nextNonCont?.page === entry.page) addToSplit(entry.page - 1);
  }

  for (const [, segs] of splitMap) segs.sort((a, b) => b.y - a.y);

  return { pages0: [...pageSet].sort((a, b) => a - b), splitMap };
}
