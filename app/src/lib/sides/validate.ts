// Post-generation validation: confirms that every target scene heading appears
// somewhere in the generated sides PDF.
// Does NOT flag non-target headings on shared pages — those are expected and
// are handled visually by the slash annotations.

import type { ValidationResult } from './types';
import type { SceneIndexEntry } from './types';

// ── Minimal pdf.js types ──────────────────────────────────────────────────────

interface PdfTextItem {
  str: string;
  transform: [number, number, number, number, number, number];
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

async function ensurePdfJs(): Promise<void> {
  const w = window as unknown as { pdfjsLib?: unknown };
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

// ── Text helpers ──────────────────────────────────────────────────────────────

const HEADING_RE = /\b(INT|EXT|INT\.\/EXT|EXT\.\/INT|I\/E)\b/i;
const OMITTED_RE = /\bOMITTED\b/i;
const SCENE_NUM_RE = /^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?$/;

// Match left margin (0–40%) or right margin (60–100%) — same as scriptIndex.ts
const LEFT_MARGIN_RATIO  = 0.40;
const RIGHT_MARGIN_RATIO = 0.60;
const GLYPH_X_GAP = 20;

function groupLines(items: PdfTextItem[], pageWidth: number) {
  const Y_TOL = 4;
  const visible = items.filter((it) => it.str.trim());
  visible.sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > Y_TOL) return dy;
    return a.transform[4] - b.transform[4];
  });
  const lines: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of visible) {
    const y = item.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= Y_TOL) last.items.push(item);
    else lines.push({ y, items: [item] });
  }
  return lines.map(({ y, items: li }) => ({
    y,
    pageWidth,
    text: [...li].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
    items: li,
  }));
}

function extractSceneNumFromLine(
  lineItems: PdfTextItem[],
  lineText: string,
  pageWidth: number,
): string | null {
  // Strategy A: left margin
  const maxLeft = pageWidth * LEFT_MARGIN_RATIO;
  const leftItems = lineItems.filter((it) => it.transform[4] < maxLeft).sort((a, b) => a.transform[4] - b.transform[4]);
  if (leftItems.length) {
    let concat = ''; let prevRight = -Infinity;
    for (const it of leftItems) {
      if (concat && it.transform[4] - prevRight > GLYPH_X_GAP) break;
      concat += it.str.replace(/\s/g, '');
      prevRight = it.transform[4] + (it.width || 6);
    }
    const c = concat.trim().replace(/\.$/, '');
    if (SCENE_NUM_RE.test(c)) return c;
  }
  // Strategy B: right margin
  const minRight = pageWidth * RIGHT_MARGIN_RATIO;
  const rightItems = lineItems.filter((it) => it.transform[4] > minRight).sort((a, b) => a.transform[4] - b.transform[4]);
  if (rightItems.length) {
    let concat = ''; let prevRight = -Infinity;
    for (const it of rightItems) {
      if (concat && it.transform[4] - prevRight > GLYPH_X_GAP) break;
      concat += it.str.replace(/\s/g, '');
      prevRight = it.transform[4] + (it.width || 6);
    }
    const c = concat.trim().replace(/\.$/, '');
    if (SCENE_NUM_RE.test(c)) return c;
  }
  // Strategy C: line text starts with scene number
  const m = lineText.match(/^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?\s/);
  if (m?.[1]) return m[1];
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate the annotated sides PDF.
 * Only checks that every target scene heading is found somewhere in the sides.
 * Non-target headings on shared pages are expected and not flagged.
 */
export async function validateSides(
  sidesBuf: Uint8Array,
  _originalPages0: number[],      // kept for API compatibility
  _allIndex: SceneIndexEntry[],   // kept for API compatibility
  targetNums: string[],
): Promise<ValidationResult> {
  await ensurePdfJs();
  const pdfjs = (window as unknown as {
    pdfjsLib: {
      getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
    };
  }).pdfjsLib;

  // Use a copy so pdf.js can transfer the buffer to its Worker without detaching
  // the caller's Uint8Array (which may be reused by the next pipeline stage).
  const doc = await pdfjs.getDocument({ data: sidesBuf.slice() }).promise;
  const targetSet = new Set(targetNums.map((n) => n.trim().toUpperCase().replace(/\.$/, '')));
  const seenNums = new Set<string>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = groupLines(tc.items as PdfTextItem[], viewport.width);

    for (const line of lines) {
      // Strategy 1: normal INT/EXT heading — extract scene number from margin
      if (HEADING_RE.test(line.text)) {
        const num = extractSceneNumFromLine(line.items, line.text, viewport.width);
        if (num) seenNums.add(num.toUpperCase().replace(/\.$/, ''));
        continue;
      }
      // Strategy 2: OMITTED heading — scene number in margin, no INT/EXT
      // e.g.  "55A    OMITTED    55A"  or  "55A (OMITTED)"
      if (OMITTED_RE.test(line.text)) {
        const num = extractSceneNumFromLine(line.items, line.text, viewport.width);
        if (num) seenNums.add(num.toUpperCase().replace(/\.$/, ''));
        continue;
      }
      // Strategy 3: standalone scene number line in the margin — handles scripts
      // where the scene number appears on its own line above the heading.
      const numOnly = line.text.trim().replace(/\.$/, '');
      if (SCENE_NUM_RE.test(numOnly)) {
        seenNums.add(numOnly.toUpperCase());
      }
    }
  }

  const issues: ValidationResult['issues'] = [];
  for (const num of targetNums) {
    const norm = num.trim().toUpperCase().replace(/\.$/, '');
    if (!seenNums.has(norm)) {
      issues.push({
        page: 0,
        description: `Scene ${num} heading not found in the generated sides — check that the script index located this scene correctly.`,
      });
    }
  }

  return { passed: issues.length === 0, issues };
}
