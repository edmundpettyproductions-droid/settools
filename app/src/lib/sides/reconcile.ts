// Source reconciliation: extract scene lists from call sheet, shooting schedule,
// and strip board PDFs, then compare them to produce a canonical scene list
// and a conflict report. One Claude call per source document.

import { extractFromPdf } from '../extract';
import type { CanonicalScene, SourceScene, SceneConflict, ConflictReport } from './types';

const SYS = 'Film production schedule parser. Return ONLY raw JSON, no markdown, no extra text.';

// ── Individual source extractors ───────────────────────────────────────────────

interface SsExtractResult {
  dayLabel: string;
  scenes: SourceScene[];
}

export async function extractFromShootingSchedule(
  pdfB64: string,
  shootDayNum: number | null,
): Promise<SsExtractResult> {
  const dayCtx = shootDayNum
    ? `Today is Shoot Day ${shootDayNum}. Extract ONLY scenes for Shoot Day ${shootDayNum + 1} (tomorrow).`
    : 'Extract ONLY scenes for the NEXT shooting day listed in this document.';

  const P =
    `This is a shooting schedule PDF.\n${dayCtx}\n` +
    'Return JSON: {\n' +
    '  "dayLabel": "Day 5",\n' +
    '  "scenes": [\n' +
    '    {"num":"47","set":"WAREHOUSE","intExt":"INT","dn":"Day","pages":"2/8","castNums":["1","3"]}\n' +
    '  ]\n' +
    '}\n' +
    'num: scene number as printed (e.g. "47", "61A"). set: location name only (no INT/EXT/D/N). ' +
    'intExt: "INT", "EXT", or "INT/EXT". dn: "Day", "Night", "Dusk", or "Dawn". ' +
    'pages: page fraction (e.g. "2/8", "1 1/8"). castNums: list of character/cast numbers as strings. ' +
    'Include ALL scenes for that one day in shooting order. Omit any other day.';

  const raw = await extractFromPdf(pdfB64, P, { system: SYS });
  const parsed = parseJson<{ dayLabel?: string; scenes?: SourceScene[] }>(raw, 'shooting schedule');
  return { dayLabel: parsed.dayLabel ?? '', scenes: parsed.scenes ?? [] };
}

export interface CsSceneExtractResult {
  scenes: SourceScene[];
  castList: Array<{ num: string; name: string; role: string; callTime: string }>;
}

export async function extractFromCallSheet(pdfB64: string): Promise<CsSceneExtractResult> {
  const P =
    'This is a call sheet PDF. Extract two things:\n\n' +
    '1. SCENES: Extract ONLY the scenes listed in the MAIN SHOOTING SCHEDULE for the shoot day ' +
    'this call sheet covers — these are the scenes being shot on the day this call sheet is FOR. ' +
    'Look for a section titled something like "SHOOTING SCHEDULE", "SCENES TO BE PHOTOGRAPHED", ' +
    '"PRODUCTION BREAKDOWN", or a breakdown strip table. ' +
    'CRITICAL: Do NOT include any "ADVANCE SCHEDULE" or "TOMORROW" section — those are for a future day. ' +
    'Do NOT include scenes from any other day. Only the scenes for the primary shoot day on this call sheet.\n\n' +
    '2. CAST LIST: All cast members called, with their character number, name, role, and call time.\n\n' +
    'Return JSON: {\n' +
    '  "scenes": [\n' +
    '    {"num":"47","set":"WAREHOUSE","intExt":"INT","dn":"Day","pages":"2/8","castNums":["1","3"]}\n' +
    '  ],\n' +
    '  "castList": [\n' +
    '    {"num":"1","name":"Jane Smith","role":"Olivia","callTime":"07:30"}\n' +
    '  ]\n' +
    '}\n' +
    'num: scene number as printed (e.g. "47", "61A"). set: location name only (no INT/EXT/D/N prefix). ' +
    'intExt: "INT", "EXT", or "INT/EXT". dn: "Day", "Night", "Dusk", or "Dawn". ' +
    'pages: page fraction (e.g. "2/8", "1 1/8"). castNums: character/cast numbers as strings. ' +
    'Include scenes in shooting order. For castList include all called cast with num, name, role, callTime in HH:MM 24h.';

  const raw = await extractFromPdf(pdfB64, P, { system: SYS });
  const parsed = parseJson<{ scenes?: SourceScene[]; castList?: CsSceneExtractResult['castList'] }>(raw, 'call sheet');
  return { scenes: parsed.scenes ?? [], castList: parsed.castList ?? [] };
}

export async function extractFromStripBoard(pdfB64: string): Promise<SourceScene[]> {
  const P =
    'This is a strip board / production schedule PDF showing colored strips. ' +
    'Extract ALL visible scene strips (ignore banner/header strips). ' +
    'Return JSON: {\n' +
    '  "scenes": [\n' +
    '    {"num":"47","set":"WAREHOUSE","intExt":"INT","dn":"Day","pages":"2/8","castNums":["1","3"]}\n' +
    '  ]\n' +
    '}\n' +
    'Extract in the order the strips appear (top-to-bottom / left-to-right). ' +
    'num: scene number. set: location. intExt: INT/EXT/INT/EXT. dn: Day/Night/Dusk/Dawn. ' +
    'pages: page fraction if visible. castNums: cast/character numbers visible on the strip.';

  const raw = await extractFromPdf(pdfB64, P, { system: SYS });
  const parsed = parseJson<{ scenes?: SourceScene[] }>(raw, 'strip board');
  return parsed.scenes ?? [];
}

// ── Reconciliation ─────────────────────────────────────────────────────────────

function normalizeNum(num: string): string {
  return num.trim().toUpperCase().replace(/\.$/, '');
}

function normalizeField(val: string | undefined | null): string {
  return (val ?? '').trim().toUpperCase();
}

function fieldsMatch(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true; // absent = no conflict
  return normalizeField(a) === normalizeField(b);
}

export interface ReconcileResult {
  canonical: CanonicalScene[];
  conflicts: SceneConflict[];
  csScenes: SourceScene[];
  castList: CsSceneExtractResult['castList'];
}

/**
 * Reconcile scenes from all loaded sources.
 *
 * Presence conflicts are ONLY raised between CS ↔ SS (both cover exactly one shoot day).
 * Strip board has the entire show — it is used ONLY to cross-check field values (set, intExt, dn)
 * for scenes already on the CS or SS, never to flag missing scenes.
 */
export function reconcileScenes(
  csScenes: SourceScene[],
  ssScenes: SourceScene[],
  stripScenes: SourceScene[],
): { canonical: CanonicalScene[]; conflicts: SceneConflict[] } {
  const conflicts: SceneConflict[] = [];

  const ssMap    = new Map(ssScenes.map((s)    => [normalizeNum(s.num), s]));
  const stripMap = new Map(stripScenes.map((s) => [normalizeNum(s.num), s]));

  // Iterate only over CS ∪ SS — strip scenes that don't appear in either are ignored
  // (they belong to other shoot days and should never be flagged as conflicts).
  const activeNums = new Set([
    ...csScenes.map((s) => normalizeNum(s.num)),
    ...ssScenes.map((s) => normalizeNum(s.num)),
  ]);

  for (const num of activeNums) {
    const cs    = csScenes.find((s) => normalizeNum(s.num) === num) ?? null;
    const ss    = ssMap.get(num) ?? null;
    const strip = stripMap.get(num) ?? null; // optional confirmation only

    // Presence conflict: CS vs SS only (both should cover exactly the same shoot day).
    if (cs && ss === null && ssScenes.length > 0) {
      conflicts.push({
        sceneNum: num,
        field: 'presence',
        csValue: 'On call sheet',
        ssValue: null,
        stripValue: strip ? 'Confirmed on strip board' : null,
        resolution: null,
      });
    } else if (!cs && ss) {
      conflicts.push({
        sceneNum: num,
        field: 'presence',
        csValue: null,
        ssValue: 'On shooting schedule',
        stripValue: strip ? 'Confirmed on strip board' : null,
        resolution: null,
      });
    }

    if (!cs) continue; // SS-only scenes don't become canonical until resolved.

    // Field conflicts: CS vs SS (authoritative), with strip as a tiebreak note.
    // Strip-only field disagreements are NOT flagged — strip can have stale data.
    const checkField = (
      field: SceneConflict['field'],
      get: (s: SourceScene) => string,
    ) => {
      const csVal   = get(cs);
      const ssVal   = ss    ? get(ss)    : null;
      const stripVal = strip ? get(strip) : null;

      const ssDisagrees    = ssVal    !== null && !fieldsMatch(csVal, ssVal);
      const stripDisagrees = stripVal !== null && !fieldsMatch(csVal, stripVal);

      // Only flag if the shooting schedule disagrees (the authoritative daily document).
      // Strip disagreement alone is informational only — not a blocking conflict.
      if (ssDisagrees) {
        conflicts.push({
          sceneNum: num,
          field,
          csValue: csVal,
          ssValue: ssVal,
          stripValue: stripDisagrees ? stripVal : null,
          resolution: null,
        });
      }
    };

    if (ss) {
      checkField('set',    (s) => s.set);
      checkField('intExt', (s) => s.intExt);
      checkField('dn',     (s) => s.dn);
      checkField('pages',  (s) => s.pages);
    }
  }

  // Canonical list = CS scenes in their shooting order (call sheet is the authority).
  const canonical: CanonicalScene[] = csScenes.map((s, i) => ({ ...s, shootOrder: i }));
  return { canonical, conflicts };
}

/** Apply user resolutions from conflict report to refine the canonical list. */
export function applyResolutions(
  canonical: CanonicalScene[],
  conflicts: SceneConflict[],
): { refined: CanonicalScene[]; unresolvedCount: number } {
  const unresolved = conflicts.filter((c) => c.resolution === null);

  // Remove scenes the user resolved as "not shooting"
  const removedNums = new Set(
    conflicts
      .filter((c) => c.field === 'presence' && c.resolution === 'remove')
      .map((c) => normalizeNum(c.sceneNum)),
  );

  const refined = canonical
    .filter((s) => !removedNums.has(normalizeNum(s.num)))
    .map((scene, i) => ({ ...scene, shootOrder: i }));

  return { refined, unresolvedCount: unresolved.length };
}

export function buildConflictReport(conflicts: SceneConflict[]): ConflictReport {
  return {
    conflicts,
    allResolved: conflicts.every((c) => c.resolution !== null),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string, label: string): T {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error(`No JSON object in ${label} response`);
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
    }
  }
  throw new Error(`Malformed JSON in ${label} response`);
}
