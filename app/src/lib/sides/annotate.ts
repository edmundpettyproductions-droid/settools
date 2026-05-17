// annotate.ts — Canvas-based annotation engine
//
// Pipeline: pdf.js renders pages → Canvas 2D draws annotations → jsPDF compiles output.
// This replaces the pdf-lib approach which had persistent coordinate + ArrayBuffer issues.
//
// Key coordinate facts:
//   pdf.js y: 0 = bottom of page, pageHeight = top (standard PDF convention)
//   canvas y: 0 = top of page, canvasHeight = bottom (standard web convention)
//   Conversion: canvas_y = canvasHeight - pdf_y * renderScale

import type { PagePlan } from './scriptIndex';
import type { SceneIndexEntry } from './types';

// ── Minimal pdf.js types ──────────────────────────────────────────────────────

interface PdfjsViewport {
  width:  number;
  height: number;
  scale:  number;
}

interface PdfjsRenderTask {
  promise: Promise<void>;
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): PdfjsViewport;
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): PdfjsRenderTask;
}

interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}

// ── Minimal jsPDF types ───────────────────────────────────────────────────────

interface JsPDFDoc {
  addPage(format: [number, number]): JsPDFDoc;
  addImage(
    imageData: string,
    format: string,
    x: number, y: number,
    w: number, h: number,
  ): JsPDFDoc;
  output(type: 'arraybuffer'): ArrayBuffer;
}

type JsPDFCtor = new (opts: { unit: string; format: [number, number] }) => JsPDFDoc;

// ── CDN loading ───────────────────────────────────────────────────────────────

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSPDF_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

async function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return; // already in DOM
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs(): Promise<{
  getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
}> {
  const w = window as unknown as Record<string, unknown>;
  if (!w['pdfjsLib']) {
    await loadScript(PDFJS_CDN);
    (w['pdfjsLib'] as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return w['pdfjsLib'] as { getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfjsDocument> } };
}

async function ensureJsPDF(): Promise<JsPDFCtor> {
  const w = window as unknown as Record<string, unknown>;
  const mod = w['jspdf'] as { jsPDF?: JsPDFCtor } | undefined;
  if (!mod?.jsPDF) {
    await loadScript(JSPDF_CDN);
  }
  const loaded = (window as unknown as Record<string, unknown>)['jspdf'] as { jsPDF?: JsPDFCtor };
  if (!loaded?.jsPDF) throw new Error('jsPDF loaded but window.jspdf.jsPDF is missing');
  return loaded.jsPDF;
}

// ── Annotation constants (all in PDF points unless marked) ───────────────────

const RENDER_SCALE    = 2;      // render at 2× → 144 DPI (good for printing)
const SLASH_MARGIN_PT = 42;     // horizontal inset for diagonal slash lines
const SLASH_OPACITY   = 0.58;
const SLASH_WIDTH_PT  = 1.8;
const BORDER_OPACITY  = 0.30;
const BORDER_WIDTH_PT = 0.4;
const SLASH_GUTTER_PT = 12;     // extra space above a heading before slash starts
const ELLIPSE_RY_PT   = 9;      // ellipse half-height
const ELLIPSE_X_PT    = 48;     // horizontal centre of each ellipse from page edge
const ELLIPSE_W_PT    = 1.5;    // ellipse border stroke width
const ELLIPSE_OPACITY = 0.90;

function ellipseRxPt(numStr: string): number {
  // Wider ellipse for longer scene numbers so they fit nicely.
  const len = numStr.length;
  if (len <= 1) return 10;
  if (len <= 2) return 14;
  if (len <= 3) return 18;
  return 22;
}

// ── Per-page annotation drawn on an already-rendered canvas ─────────────────

/**
 * Draw slashes and ellipses on a canvas that already contains the rendered PDF page.
 *
 * @param ctx       2D context of the canvas
 * @param canvasW   canvas pixel width  (= pagePtW × RENDER_SCALE)
 * @param canvasH   canvas pixel height (= pagePtH × RENDER_SCALE)
 * @param pagePtW   PDF page width  in pt (from getViewport({scale:1}).width)
 * @param pagePtH   PDF page height in pt (from getViewport({scale:1}).height)
 * @param page0     0-indexed original script page number
 */
function annotateCanvas(
  ctx:       CanvasRenderingContext2D,
  canvasW:   number,
  canvasH:   number,
  pagePtW:   number,
  pagePtH:   number,
  page0:     number,
  pagePlan:  PagePlan,
  allIndex:  SceneIndexEntry[],
  targetSet: Set<string>,
): void {
  const sc = RENDER_SCALE;

  // Convert a PDF y-coordinate (0 = page bottom) → canvas y (0 = canvas top)
  const cy = (pdfY: number): number => canvasH - pdfY * sc;

  ctx.save();
  ctx.lineCap = 'square';

  // ── Diagonal slashes through non-target regions (split pages only) ──────────
  const segs = pagePlan.splitMap.get(page0);
  if (segs && segs.length >= 2) {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg || seg.isTarget) continue;

      // Top of this region in PDF y-space (higher y = closer to page top)
      const yTopPt = i === 0
        ? pagePtH                             // very top of the page
        : (seg.y + SLASH_GUTTER_PT);          // just above this heading

      // Bottom of this region
      const nextSeg = segs[i + 1];
      const yBotPt = i === segs.length - 1
        ? 0                                   // very bottom of the page
        : (nextSeg ? nextSeg.y + SLASH_GUTTER_PT : 0);

      if (yTopPt <= yBotPt) continue;

      const x1 = SLASH_MARGIN_PT * sc;
      const x2 = (pagePtW - SLASH_MARGIN_PT) * sc;
      // In canvas space, yTop is SMALLER (higher on screen), yBot is LARGER
      const cy1 = cy(yTopPt);   // canvas y of region top    (near 0)
      const cy2 = cy(yBotPt);   // canvas y of region bottom (near canvasH)

      // Diagonal slash from top-left to bottom-right
      ctx.beginPath();
      ctx.moveTo(x1, cy1);
      ctx.lineTo(x2, cy2);
      ctx.globalAlpha = SLASH_OPACITY;
      ctx.strokeStyle = '#000';
      ctx.lineWidth   = SLASH_WIDTH_PT * sc;
      ctx.stroke();

      // Thin horizontal border lines bracketing the slashed region
      ctx.globalAlpha = BORDER_OPACITY;
      ctx.lineWidth   = BORDER_WIDTH_PT * sc;

      if (cy1 > 2) {              // avoid painting at the very top edge
        ctx.beginPath();
        ctx.moveTo(x1, cy1);
        ctx.lineTo(x2, cy1);
        ctx.stroke();
      }
      if (cy2 < canvasH - 2) {   // avoid painting at the very bottom edge
        ctx.beginPath();
        ctx.moveTo(x1, cy2);
        ctx.lineTo(x2, cy2);
        ctx.stroke();
      }
    }
  }

  // ── Hollow ellipses around target scene-number headings ─────────────────────
  const origPage1 = page0 + 1;
  const headings  = allIndex.filter(
    (e) => e.page === origPage1 && targetSet.has(e.num.toUpperCase()),
  );

  ctx.globalAlpha = ELLIPSE_OPACITY;
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = ELLIPSE_W_PT * sc;

  for (const h of headings) {
    const rx = ellipseRxPt(h.num) * sc;
    const ry = ELLIPSE_RY_PT * sc;
    const ey = cy(h.y);   // vertical centre of the heading in canvas coords

    // Left-margin ellipse
    ctx.beginPath();
    ctx.ellipse(ELLIPSE_X_PT * sc, ey, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();

    // Right-margin ellipse (scene numbers are mirrored in standard script format)
    ctx.beginPath();
    ctx.ellipse(canvasW - ELLIPSE_X_PT * sc, ey, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnnotateResult {
  scriptOrderBytes: Uint8Array;
  shootOrderBytes:  Uint8Array;
  rawBytes:         Uint8Array;
  pageCount:        number;
}

/**
 * Build annotated sides PDFs from the source script and computed page plan.
 *
 * Renders each page with pdf.js, annotates with Canvas 2D, compiles with jsPDF.
 */
export async function buildAnnotatedPdfs(
  scriptBuf:  ArrayBuffer,
  pagePlan:   PagePlan,
  allIndex:   SceneIndexEntry[],
  targetNums: string[],
  shootOrder: string[],
  onProgress?: (msg: string) => void,
): Promise<AnnotateResult> {
  const [pdfjs, JsPDF] = await Promise.all([ensurePdfJs(), ensureJsPDF()]);

  // Load PDF with a copy of the buffer — pdf.js transfers (detaches) the buffer
  // to its Web Worker; the original scriptBuf must stay usable for other callers.
  const pdfDoc = await pdfjs
    .getDocument({ data: new Uint8Array(scriptBuf.slice(0)) })
    .promise;

  const totalPdfPages = pdfDoc.numPages;
  const targetSet     = new Set(targetNums.map((n) => n.trim().toUpperCase()));
  const validPages0   = pagePlan.pages0.filter((p) => p >= 0 && p < totalPdfPages);

  // ── Phase 1: render each page once, cache raw + annotated JPEG strings ───────
  //
  // We keep data URLs (strings) rather than canvases so memory is freed as we go.
  // Each page at 144 DPI ≈ 100–250 KB JPEG — 68 pages ≈ 10–17 MB total. Fine.

  interface PageCache { rawJpg: string; annJpg: string; ptW: number; ptH: number }
  const cache = new Map<number, PageCache>();

  for (let i = 0; i < validPages0.length; i++) {
    const page0 = validPages0[i]!;
    onProgress?.(`Rendering page ${i + 1} / ${validPages0.length}…`);

    const page = await pdfDoc.getPage(page0 + 1);
    const vp1  = page.getViewport({ scale: 1 });              // dimensions in pt
    const vp2  = page.getViewport({ scale: RENDER_SCALE });   // render at 2×

    const canvas    = document.createElement('canvas');
    canvas.width    = Math.round(vp2.width);
    canvas.height   = Math.round(vp2.height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');

    // Render PDF page content onto the canvas
    await page.render({ canvasContext: ctx, viewport: vp2 }).promise;

    // Snapshot before annotations (for the raw/unannotated PDF)
    const rawJpg = canvas.toDataURL('image/jpeg', 0.88);

    // Draw annotations on top of the rendered page
    annotateCanvas(
      ctx,
      canvas.width, canvas.height,
      vp1.width,    vp1.height,
      page0,
      pagePlan, allIndex, targetSet,
    );

    // Snapshot after annotations (for the annotated PDFs)
    const annJpg = canvas.toDataURL('image/jpeg', 0.88);

    cache.set(page0, { rawJpg, annJpg, ptW: vp1.width, ptH: vp1.height });

    // Immediately free canvas pixel memory
    canvas.width  = 0;
    canvas.height = 0;
  }

  // ── Build shoot-order page list ──────────────────────────────────────────────
  const shootPages0: number[] = [];
  const addedInShoot = new Set<number>();

  for (const num of shootOrder) {
    const norm  = num.trim().toUpperCase();
    const entry = allIndex.find((e) => e.num.toUpperCase() === norm && !e.isContinuation);
    if (!entry) continue;

    const entryIdx  = allIndex.indexOf(entry);
    const nextEntry = allIndex.slice(entryIdx + 1).find((e) => !e.isContinuation);
    const start0    = entry.page - 1;
    const end0      = nextEntry ? nextEntry.page - 2 : totalPdfPages - 1;

    for (let p = start0; p <= end0; p++) {
      if (validPages0.includes(p) && !addedInShoot.has(p)) {
        addedInShoot.add(p);
        shootPages0.push(p);
      }
    }
  }

  // ── Phase 2: compile three PDFs from cached images ───────────────────────────
  onProgress?.('Compiling PDFs…');

  function compilePdf(pages0: number[], annotated: boolean): Uint8Array {
    if (!pages0.length) return new Uint8Array(0);
    let doc: JsPDFDoc | null = null;

    for (const page0 of pages0) {
      const c = cache.get(page0);
      if (!c) continue;

      const img = annotated ? c.annJpg : c.rawJpg;

      if (!doc) {
        doc = new JsPDF({ unit: 'pt', format: [c.ptW, c.ptH] });
      } else {
        doc.addPage([c.ptW, c.ptH]);
      }
      // addImage: x=0, y=0 is top-left corner in jsPDF; image fills the full page
      doc.addImage(img, 'JPEG', 0, 0, c.ptW, c.ptH);
    }

    if (!doc) return new Uint8Array(0);
    return new Uint8Array(doc.output('arraybuffer'));
  }

  const scriptOrderBytes = compilePdf(validPages0,  true);
  const shootOrderBytes  = compilePdf(shootPages0,   true);
  const rawBytes         = compilePdf(validPages0,   false);

  return {
    scriptOrderBytes,
    shootOrderBytes,
    rawBytes,
    pageCount: validPages0.length,
  };
}
