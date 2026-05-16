// PDF annotation: draws diagonal slashes through non-target scene regions
// and hollow ellipses around target scene numbers.
// All coordinates come from the deterministic scriptIndex — no LLM involved.

import type { PagePlan } from './scriptIndex';
import type { SceneIndexEntry } from './types';

// ── Minimal pdf-lib types ─────────────────────────────────────────────────────

interface RgbColor { type: 'RGB'; r: number; g: number; b: number }

interface PdfLibPage {
  getSize(): { width: number; height: number };
  drawLine(opts: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness: number;
    color: RgbColor;
    opacity: number;
  }): void;
  drawEllipse(opts: {
    x: number; y: number;
    xScale: number; yScale: number;
    color: RgbColor; opacity: number;
    borderColor: RgbColor; borderWidth: number; borderOpacity: number;
  }): void;
}

interface PdfLibDoc {
  getPageCount(): number;
  getPage(index: number): PdfLibPage;
  copyPages(src: PdfLibDoc, indices: number[]): Promise<PdfLibPage[]>;
  addPage(page: PdfLibPage): void;
  save(): Promise<Uint8Array>;
}

interface PdfLib {
  PDFDocument: {
    load(buf: ArrayBuffer, opts?: { ignoreEncryption?: boolean }): Promise<PdfLibDoc>;
    create(): Promise<PdfLibDoc>;
  };
  rgb(r: number, g: number, b: number): RgbColor;
}

// ── CDN loading ────────────────────────────────────────────────────────────────

async function ensurePdfLib(): Promise<PdfLib> {
  const w = window as unknown as { PDFLib?: PdfLib };
  if (w.PDFLib) return w.PDFLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdf-lib from CDN'));
    document.head.appendChild(s);
  });
  if (!w.PDFLib) throw new Error('pdf-lib loaded but window.PDFLib missing');
  return w.PDFLib;
}

// ── Annotation parameters ──────────────────────────────────────────────────────

const SLASH_MARGIN = 42;        // pt — horizontal inset for slash lines
const SLASH_OPACITY = 0.58;
const SLASH_THICKNESS = 1.8;
const BORDER_THICKNESS = 0.4;
const BORDER_OPACITY = 0.3;
const SLASH_Y_GUTTER = 12;      // pt — breathing room above a scene heading before slash starts
const ELLIPSE_Y_OFFSET = 0;     // pt — vertical shift for ellipse center relative to heading y
const ELLIPSE_SCALE_Y = 9;      // pt — half-height of ellipse
const ELLIPSE_OPACITY = 0;      // fill opacity (hollow)
const ELLIPSE_BORDER_W = 1.5;
const ELLIPSE_BORDER_OPACITY = 0.9;

function ellipseXScale(numStr: string): number {
  // Wider ellipse for longer scene numbers.
  const len = numStr.length;
  if (len <= 1) return 10;
  if (len <= 2) return 14;
  if (len <= 3) return 18;
  return 22;
}

// ── Per-page annotation ────────────────────────────────────────────────────────

function annotatePage(
  page: PdfLibPage,
  origPage1: number, // 1-indexed original script page
  pagePlan: PagePlan,
  allIndex: SceneIndexEntry[],
  targetNums: Set<string>,
  PDFLib: PdfLib,
): void {
  const { width: W, height: H } = page.getSize();
  const RGB = PDFLib.rgb;
  const black = RGB(0, 0, 0);
  const page0 = origPage1 - 1;

  // ── Slashes through non-target regions (split pages only) ──────────────────
  const segs = pagePlan.splitMap.get(page0);
  if (segs && segs.length >= 2) {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === undefined || seg.isTarget) continue;

      // Region top: page top for first seg, just above this heading for later segs.
      const yTop = i === 0 ? H : (seg.y + SLASH_Y_GUTTER);
      // Region bottom: page bottom for last seg, just above next heading for earlier segs.
      const nextSeg = segs[i + 1];
      const yBot = i === segs.length - 1 ? 0 : (nextSeg ? nextSeg.y + SLASH_Y_GUTTER : 0);

      if (yTop <= yBot) continue;

      // Diagonal slash
      page.drawLine({
        start: { x: SLASH_MARGIN, y: yTop },
        end: { x: W - SLASH_MARGIN, y: yBot },
        thickness: SLASH_THICKNESS,
        color: black,
        opacity: SLASH_OPACITY,
      });
      // Thin horizontal border lines to bracket the region
      if (yTop < H - 4) {
        page.drawLine({
          start: { x: SLASH_MARGIN, y: yTop },
          end: { x: W - SLASH_MARGIN, y: yTop },
          thickness: BORDER_THICKNESS,
          color: black,
          opacity: BORDER_OPACITY,
        });
      }
      if (yBot > 4) {
        page.drawLine({
          start: { x: SLASH_MARGIN, y: yBot },
          end: { x: W - SLASH_MARGIN, y: yBot },
          thickness: BORDER_THICKNESS,
          color: black,
          opacity: BORDER_OPACITY,
        });
      }
    }
  }

  // ── Ellipses around target scene numbers ───────────────────────────────────
  // Find all index entries for this page that belong to target scenes.
  const headingsOnPage = allIndex.filter(
    (e) => e.page === origPage1 && targetNums.has(e.num.toUpperCase()),
  );

  for (const h of headingsOnPage) {
    const xScale = ellipseXScale(h.num);
    const ey = h.y + ELLIPSE_Y_OFFSET;

    // Left-margin ellipse (around the scene number)
    page.drawEllipse({
      x: 48, y: ey,
      xScale, yScale: ELLIPSE_SCALE_Y,
      color: RGB(0, 0, 0), opacity: ELLIPSE_OPACITY,
      borderColor: black, borderWidth: ELLIPSE_BORDER_W, borderOpacity: ELLIPSE_BORDER_OPACITY,
    });
    // Right-margin ellipse (scene numbers repeat at the right margin in standard format)
    page.drawEllipse({
      x: W - 48, y: ey,
      xScale, yScale: ELLIPSE_SCALE_Y,
      color: RGB(0, 0, 0), opacity: ELLIPSE_OPACITY,
      borderColor: black, borderWidth: ELLIPSE_BORDER_W, borderOpacity: ELLIPSE_BORDER_OPACITY,
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface AnnotateResult {
  /** Annotated sides in script page order. */
  scriptOrderBytes: Uint8Array;
  /** Annotated sides in shooting order. */
  shootOrderBytes: Uint8Array;
  /** Raw (unannotated) pages for reference. */
  rawBytes: Uint8Array;
  /** Page count in the generated sides. */
  pageCount: number;
}

/**
 * Build annotated sides PDFs from the source script and the computed page plan.
 * @param scriptBuf  ArrayBuffer of the original script PDF
 * @param pagePlan   Output of computePagePlan() from scriptIndex
 * @param allIndex   Full script index from buildScriptIndex()
 * @param targetNums Canonical scene numbers being shot tomorrow
 * @param shootOrder Scene numbers in the order they will be shot (for shoot-order PDF)
 */
export async function buildAnnotatedPdfs(
  scriptBuf: ArrayBuffer,
  pagePlan: PagePlan,
  allIndex: SceneIndexEntry[],
  targetNums: string[],
  shootOrder: string[],
): Promise<AnnotateResult> {
  const PDFLib = await ensurePdfLib();
  const srcPdf = await PDFLib.PDFDocument.load(scriptBuf, { ignoreEncryption: true });
  const totalPages = srcPdf.getPageCount();

  const targetSet = new Set(targetNums.map((n) => n.trim().toUpperCase()));

  // Validate all pages are within range.
  const validPages0 = pagePlan.pages0.filter((p) => p >= 0 && p < totalPages);

  // ── Raw (unannotated) PDF ──────────────────────────────────────────────────
  const rawDoc = await PDFLib.PDFDocument.create();
  const rawCopied = await rawDoc.copyPages(srcPdf, validPages0);
  for (const p of rawCopied) rawDoc.addPage(p);
  const rawBytes = await rawDoc.save();

  // ── Annotated script-order PDF ─────────────────────────────────────────────
  const scriptDoc = await PDFLib.PDFDocument.create();
  const scriptCopied = await scriptDoc.copyPages(srcPdf, validPages0);
  for (let i = 0; i < scriptCopied.length; i++) {
    const page = scriptCopied[i];
    if (!page) continue;
    scriptDoc.addPage(page);
    const origPage1 = (validPages0[i] ?? 0) + 1;
    annotatePage(
      scriptDoc.getPage(i),
      origPage1,
      pagePlan,
      allIndex,
      targetSet,
      PDFLib,
    );
  }
  const scriptOrderBytes = await scriptDoc.save();

  // ── Annotated shoot-order PDF ──────────────────────────────────────────────
  // Build a map: sceneNum → pages0 that belong to it (in script order).
  const scenePages0Map = new Map<string, number[]>();
  for (const num of shootOrder) {
    const normNum = num.trim().toUpperCase();
    const entries = allIndex.filter(
      (e) => e.num.toUpperCase() === normNum && !e.isContinuation,
    );
    if (!entries.length) continue;
    const entry = entries[0]!;
    const nextEntry = allIndex.find(
      (e, idx) => !e.isContinuation && idx > allIndex.indexOf(entry),
    );
    const startPage0 = entry.page - 1;
    const endPage0 = nextEntry ? nextEntry.page - 2 : entry.page - 1;
    const scenePages: number[] = [];
    for (let p = startPage0; p <= Math.max(startPage0, endPage0); p++) {
      if (validPages0.includes(p)) scenePages.push(p);
    }
    scenePages0Map.set(normNum, scenePages);
  }

  const shootDoc = await PDFLib.PDFDocument.create();
  const addedInShoot = new Set<number>();
  for (const num of shootOrder) {
    const normNum = num.trim().toUpperCase();
    const pages = scenePages0Map.get(normNum) ?? [];
    for (const p of pages) {
      if (addedInShoot.has(p)) continue;
      addedInShoot.add(p);
      const [copied] = await shootDoc.copyPages(srcPdf, [p]);
      if (!copied) continue;
      shootDoc.addPage(copied);
      const shootPageIdx = shootDoc.getPageCount() - 1;
      annotatePage(
        shootDoc.getPage(shootPageIdx),
        p + 1,
        pagePlan,
        allIndex,
        targetSet,
        PDFLib,
      );
    }
  }
  const shootOrderBytes = await shootDoc.save();

  return {
    scriptOrderBytes,
    shootOrderBytes,
    rawBytes,
    pageCount: validPages0.length,
  };
}
