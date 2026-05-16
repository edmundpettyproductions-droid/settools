// Character extraction from generated sides via ALL-CAPS speaker pattern.
// Deterministic regex — no LLM. Cross-checks against the call sheet cast list.

import type { CharactersByScene, CastCrossCheck } from './types';

// ── Minimal pdf.js types ───────────────────────────────────────────────────────

interface PdfTextItem {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
}

interface PdfjsDocument {
  numPages: number;
  getPage(num: number): Promise<{
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    getViewport(opts: { scale: number }): { width: number; height: number };
  }>;
}

async function ensurePdfJs(): Promise<void> {
  const w = window as unknown as { pdfjsLib?: unknown };
  if (w.pdfjsLib) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(s);
  });
  const pdfjs = (window as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── Patterns ───────────────────────────────────────────────────────────────────

// Speaker names in screenplay format:
// - ALL CAPS (may include spaces, hyphens, apostrophes)
// - Length 2–35 chars
// - Optionally followed by "(CONT'D)", "(V.O.)", "(O.S.)", "(O.C.)"
// - Positioned in the center of the page (speaker column ≈ 35–65% of page width)
const SPEAKER_RE = /^[A-Z][A-Z\s\-''.]{1,33}[A-Z]$/;
const SPEAKER_SUFFIX_RE = /\s*\((?:CONT[''']?D\.?|V\.O\.?|O\.S\.?|O\.C\.?)\)\s*$/i;

// Scene heading: catches "47  INT. WAREHOUSE - DAY" lines.
const HEADING_RE = /\b(INT|EXT|INT\.\/EXT|EXT\.\/INT|I\/E)\b/i;
const SCENE_NUM_RE = /^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?$/;

// Words that look like ALL-CAPS but are not speakers.
const NOT_SPEAKERS = new Set([
  'CONTINUED', 'CONT', 'FADE', 'CUT', 'DISSOLVE', 'SMASH', 'MATCH',
  'INTERCUT', 'BACK', 'ANGLE', 'CLOSE', 'WIDE', 'POV', 'LATER',
  'MEANWHILE', 'MONTAGE', 'SERIES', 'OMITTED', 'END', 'ACT',
  'TEASER', 'TAG', 'COLD', 'BLACK', 'TITLE', 'OVER', 'PULL',
  'PUSH', 'SLAM', 'THE', 'AND', 'BUT',
]);

// ── Line grouping (same logic as scriptIndex) ─────────────────────────────────

interface TextLine {
  y: number;
  text: string;
  x: number;        // x of first item
  pageWidth: number;
}

function groupIntoLines(items: PdfTextItem[], pageWidth: number): TextLine[] {
  const Y_TOL = 3;
  const visible = items.filter((it) => it.str.trim());
  visible.sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > Y_TOL) return dy;
    return a.transform[4] - b.transform[4];
  });

  const lineGroups: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of visible) {
    const y = item.transform[5];
    const last = lineGroups[lineGroups.length - 1];
    if (last && Math.abs(last.y - y) <= Y_TOL) {
      last.items.push(item);
    } else {
      lineGroups.push({ y, items: [item] });
    }
  }

  return lineGroups.map(({ y, items: lineItems }) => {
    const sorted = lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
    return {
      y,
      text: sorted.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim(),
      x: sorted[0]?.transform[4] ?? 0,
      pageWidth,
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSpeaker(line: TextLine): boolean {
  const SPEAKER_X_MIN = line.pageWidth * 0.30;
  const SPEAKER_X_MAX = line.pageWidth * 0.72;

  if (line.x < SPEAKER_X_MIN || line.x > SPEAKER_X_MAX) return false;

  // Strip trailing qualifiers before testing
  const cleaned = line.text.replace(SPEAKER_SUFFIX_RE, '').trim();
  if (!SPEAKER_RE.test(cleaned)) return false;
  if (NOT_SPEAKERS.has(cleaned)) return false;
  if (cleaned.length < 2) return false;

  return true;
}

const SCENE_NUM_GLYPH_GAP = 20; // pt — same as scriptIndex.ts

function extractSceneNum(line: TextLine): string | null {
  if (!HEADING_RE.test(line.text)) return null;

  // Strategy A: left margin (0–40% of page width)
  const maxLeft = line.pageWidth * 0.40;
  if (line.x < maxLeft) {
    // Try glyph concatenation on left-margin items — reconstruct from the line's
    // raw items (we only have x via line.x here, so fall through to text match)
  }

  // Strategy B: line text starts with scene number (handles embedded and left-margin)
  const m = line.text.match(/^(\d+(?:[A-Z]+)?(?:-\d+[A-Z]*)?)\.?\s/);
  if (m?.[1]) return m[1];

  // Strategy C: scene number anywhere in the first 40% of line text as a token
  const firstToken = line.text.split(/\s+/)[0]?.replace(/\.$/, '') ?? '';
  if (SCENE_NUM_RE.test(firstToken)) return firstToken;

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract a per-scene map of character names from the generated sides PDF.
 * Uses the script index scene order to attribute speakers to the correct scene.
 * @param sidesBuf       ArrayBuffer of the generated sides (annotated, script order)
 * @param scenesInOrder  Scene numbers in the order they appear in the sides PDF
 */
export async function extractCharacters(
  sidesBuf: Uint8Array,
  scenesInOrder: string[],
): Promise<CharactersByScene> {
  await ensurePdfJs();
  const pdfjs = (window as unknown as {
    pdfjsLib: {
      getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
    };
  }).pdfjsLib;

  // Use a copy so pdf.js can transfer the buffer to its Worker without detaching
  // the caller's Uint8Array (which may be reused downstream).
  const doc = await pdfjs.getDocument({ data: sidesBuf.slice() }).promise;
  const result: CharactersByScene = {};
  for (const num of scenesInOrder) {
    result[num] = [];
  }

  let currentScene: string | null = scenesInOrder[0] ?? null;
  const speakersPerScene: Record<string, Set<string>> = {};
  for (const num of scenesInOrder) speakersPerScene[num] = new Set();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = groupIntoLines(tc.items as PdfTextItem[], viewport.width);

    for (const line of lines) {
      // Check if this line is a scene heading — update current scene context.
      const sceneNum = extractSceneNum(line);
      if (sceneNum) {
        const norm = sceneNum.toUpperCase();
        if (scenesInOrder.some((n) => n.toUpperCase() === norm)) {
          currentScene = scenesInOrder.find((n) => n.toUpperCase() === norm) ?? null;
        }
        continue;
      }

      // Check if this is a speaker line.
      if (currentScene && speakersPerScene[currentScene] && isSpeaker(line)) {
        const cleaned = line.text.replace(SPEAKER_SUFFIX_RE, '').trim();
        speakersPerScene[currentScene].add(cleaned);
      }
    }
  }

  for (const num of scenesInOrder) {
    result[num] = [...(speakersPerScene[num] ?? [])].sort();
  }

  return result;
}

/**
 * Cross-check character extraction against the call sheet cast list.
 */
export function crossCheckCast(
  charactersByScene: CharactersByScene,
  castList: Array<{ num: string; name: string; role: string; callTime: string }>,
): CastCrossCheck {
  // All unique speakers across all scenes
  const allSpeakers = new Set<string>();
  const speakerScenes: Record<string, string[]> = {};
  for (const [scene, speakers] of Object.entries(charactersByScene)) {
    for (const sp of speakers) {
      allSpeakers.add(sp);
      if (!speakerScenes[sp]) speakerScenes[sp] = [];
      speakerScenes[sp].push(scene);
    }
  }

  // Normalize cast list for comparison (by character/role name, all-caps)
  const calledRoles = new Map<string, typeof castList[0]>();
  for (const c of castList) {
    if (c.role) calledRoles.set(c.role.toUpperCase().trim(), c);
  }

  // Speakers that don't match any called character role
  const unmatchedSpeakers: CastCrossCheck['unmatchedSpeakers'] = [];
  for (const speaker of allSpeakers) {
    const norm = speaker.toUpperCase().trim();
    if (!calledRoles.has(norm)) {
      unmatchedSpeakers.push({ speaker, scenes: speakerScenes[speaker] ?? [] });
    }
  }

  // Called cast whose character doesn't appear as any speaker
  const uncalledCast: CastCrossCheck['uncalledCast'] = [];
  for (const [roleNorm, castEntry] of calledRoles) {
    if (!allSpeakers.has(roleNorm)) {
      uncalledCast.push({
        name: castEntry.name,
        num: castEntry.num,
        role: castEntry.role,
      });
    }
  }

  return { unmatchedSpeakers, uncalledCast };
}
