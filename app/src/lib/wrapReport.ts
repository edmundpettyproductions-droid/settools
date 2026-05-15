// wrapReport.ts — Day Wrap Auto-Report generator
// Pulls from every data source to produce an end-of-day summary.

import * as sync from './sync';
import * as T from './tracker';
import * as S from './scenes';
import * as PT from './prodTimers';
import * as issues from './issues';
import * as notes from './notes';
import * as CL from './commLog';
import type { UHState, NoteEntry, IssueEntry } from './types';

// ─── Types ───────────────────────────────────────────────────────────
export interface WrapReport {
  generated: string;   // ISO datetime
  production: string;
  episode: string;
  shootDay: string;
  date: string;
  director: string;
  location: string;

  // Timing
  generalCall: string;
  firstShot: string;
  lastShot: string;         // wrap time of the last scene completed
  totalElapsed: string;     // first shot → last wrap

  // Scenes
  sceneSummary: S.SceneSummary;
  sceneLines: SceneLine[];

  // Cast
  castCount: number;
  castWrapped: number;
  castLines: PersonLine[];

  // Crew
  crewCount: number;
  crewWrapped: number;
  crewLines: PersonLine[];

  // OT
  otAlerts: OTAlert[];

  // Meal
  mealStatus: string;

  // Open issues carry-forward
  openIssues: IssueEntry[];

  // Pinned/flagged notes
  flaggedNotes: NoteEntry[];

  // Communications summary
  commCount: number;
  commFlagged: number;
  commEntries: CL.CommEntry[];
}

export interface SceneLine {
  sceneNum: string;
  status: S.SceneStatus;
  pages: string;
  setups: number;
  firstUp: string;
  wrapped: string;
  elapsed: string;
}

export interface PersonLine {
  name: string;
  role: string;
  callTime: string;
  arrivedAt: string;
  wrapTime: string;
  hoursWorked: string;
}

export interface OTAlert {
  name: string;
  role: string;
  source: 'cast' | 'crew';
  hoursWorked: string;
  threshold: string;
}

// ─── Storage ─────────────────────────────────────────────────────────
export const STORAGE_KEY = 'settools_wrap_report';

export interface WrapReportState {
  reports: WrapReport[];
}

export function loadReports(): WrapReportState {
  const raw = sync.getJSON<WrapReportState>(STORAGE_KEY);
  if (raw?.reports) return raw;
  return { reports: [] };
}

export async function saveReports(state: WrapReportState): Promise<void> {
  await sync.set(STORAGE_KEY, JSON.stringify(state));
}

// ─── Time helpers ────────────────────────────────────────────────────
function parseHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fmt12(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m?.[1] || !m[2]) return hhmm;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'p' : 'a';
  return `${h % 12 || 12}:${min}${ap}`;
}

function fmtHours(mins: number): string {
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDecimalHours(hours: number): string {
  if (hours <= 0) return '—';
  return `${hours.toFixed(1)}h`;
}

// ─── Generate ────────────────────────────────────────────────────────
export function generate(): WrapReport {
  const uh = sync.getJSON<UHState>('settools_uh') ?? {};
  const prodState = PT.loadState();
  const sceneData = S.loadScenes();
  const castData = T.loadTracker('settools_cast');
  const crewData = T.loadTracker('settools_crew');
  const openIss = issues.openIssues();
  const allNotes = notes.loadNotes().notes;
  const flaggedNotes = allNotes.filter((n) => n.pinned);

  // Scene summary
  const sceneSummary = S.summarize(sceneData.rows);

  // Scene lines
  const sceneLines: SceneLine[] = sceneData.rows
    .filter((r) => r.status !== 'scheduled')
    .map((r) => {
      const elapsed = S.elapsedMins(r.firstUp, r.wrapped);
      return {
        sceneNum: r.sceneNum,
        status: r.status,
        pages: r.pages,
        setups: r.setups,
        firstUp: fmt12(r.firstUp),
        wrapped: fmt12(r.wrapped),
        elapsed: elapsed != null ? S.fmtMins(elapsed) : '—',
      };
    });

  // Last scene wrap time
  let lastWrapMins = 0;
  let lastWrapStr = '';
  for (const r of sceneData.rows) {
    if (r.status === 'complete' && r.wrapped) {
      const mins = parseHHMM(r.wrapped);
      if (mins != null && mins > lastWrapMins) {
        lastWrapMins = mins;
        lastWrapStr = r.wrapped;
      }
    }
  }

  // Total elapsed
  const firstShotMins = parseHHMM(prodState.firstShot ?? uh.firstShot);
  const totalElapsed = firstShotMins != null && lastWrapMins > 0
    ? fmtHours(lastWrapMins - firstShotMins)
    : '—';

  // Person lines helper
  function buildPersonLines(rows: T.TrackerRow[]): PersonLine[] {
    return rows
      .filter((r) => r.name.trim())
      .map((r) => {
        const arrMins = parseHHMM(r.arrivedAt);
        const wrapMins = parseHHMM(r.wrapTime);
        const worked = arrMins != null && wrapMins != null ? wrapMins - arrMins : null;
        return {
          name: r.name,
          role: r.role,
          callTime: fmt12(r.callTime),
          arrivedAt: fmt12(r.arrivedAt),
          wrapTime: fmt12(r.wrapTime),
          hoursWorked: worked != null ? fmtHours(worked) : '—',
        };
      });
  }

  const castLines = buildPersonLines(castData.rows);
  const crewLines = buildPersonLines(crewData.rows);

  // OT alerts
  const otPeople = PT.computeOT();
  const otAlerts: OTAlert[] = otPeople
    .filter((p) => p.currentThreshold != null)
    .map((p) => ({
      name: p.name,
      role: p.role,
      source: p.source,
      hoursWorked: fmtDecimalHours(p.hoursWorked),
      threshold: p.currentThreshold!.label,
    }));

  // Meal status
  const meal = PT.computeMeal(prodState);

  // Communications
  const commData = CL.todayEntries();
  const commFlagged = commData.filter((e) => e.flagged && !e.resolved).length;

  return {
    generated: new Date().toISOString(),
    production: uh.production ?? '',
    episode: uh.episode ?? '',
    shootDay: uh.shootDay ?? '',
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    director: uh.director ?? '',
    location: uh.location ?? '',

    generalCall: fmt12(uh.callTime),
    firstShot: fmt12(prodState.firstShot ?? uh.firstShot),
    lastShot: fmt12(lastWrapStr || null),
    totalElapsed,

    sceneSummary,
    sceneLines,

    castCount: castLines.length,
    castWrapped: castData.rows.filter((r) => r.wrapTime).length,
    castLines,

    crewCount: crewLines.length,
    crewWrapped: crewData.rows.filter((r) => r.wrapTime).length,
    crewLines,

    otAlerts,
    mealStatus: meal.display,
    openIssues: openIss,
    flaggedNotes,

    commCount: commData.length,
    commFlagged,
    commEntries: commData,
  };
}

// ─── Format as text ──────────────────────────────────────────────────
export function formatText(r: WrapReport): string {
  const lines: string[] = [];
  const hr = '═'.repeat(60);
  const hr2 = '─'.repeat(60);

  lines.push(hr);
  lines.push(`  DAY WRAP REPORT`);
  lines.push(hr);
  lines.push('');

  // Header
  if (r.production) lines.push(`Production:   ${r.production}${r.episode ? ` — Ep ${r.episode}` : ''}`);
  if (r.shootDay) lines.push(`Shoot Day:    ${r.shootDay}`);
  lines.push(`Date:         ${r.date}`);
  if (r.director) lines.push(`Director:     ${r.director}`);
  if (r.location) lines.push(`Location:     ${r.location}`);
  lines.push('');

  // Timing
  lines.push(hr2);
  lines.push('  TIMING');
  lines.push(hr2);
  lines.push(`General Call:   ${r.generalCall}`);
  lines.push(`First Shot:     ${r.firstShot}`);
  lines.push(`Last Shot:      ${r.lastShot}`);
  lines.push(`Total Elapsed:  ${r.totalElapsed}`);
  lines.push(`Meal Status:    ${r.mealStatus}`);
  lines.push('');

  // Scenes
  lines.push(hr2);
  lines.push('  SCENES');
  lines.push(hr2);
  const ss = r.sceneSummary;
  lines.push(`Complete: ${ss.complete}/${ss.total}   Pages: ${S.fmtEighths(ss.completeEighths)}/${S.fmtEighths(ss.totalEighths)}   Omitted: ${ss.omitted}`);
  if (r.sceneLines.length) {
    lines.push('');
    lines.push(`  ${'Sc'.padEnd(8)}${'Status'.padEnd(12)}${'Pages'.padEnd(8)}${'Setups'.padEnd(8)}${'Start'.padEnd(10)}${'Wrap'.padEnd(10)}Elapsed`);
    for (const s of r.sceneLines) {
      lines.push(`  ${s.sceneNum.padEnd(8)}${S.STATUS_LABELS[s.status].padEnd(12)}${s.pages.padEnd(8)}${String(s.setups).padEnd(8)}${s.firstUp.padEnd(10)}${s.wrapped.padEnd(10)}${s.elapsed}`);
    }
  }
  lines.push('');

  // Cast
  lines.push(hr2);
  lines.push('  CAST');
  lines.push(hr2);
  lines.push(`Total: ${r.castCount}   Wrapped: ${r.castWrapped}`);
  if (r.castLines.length) {
    lines.push('');
    lines.push(`  ${'Name'.padEnd(20)}${'Character'.padEnd(16)}${'Call'.padEnd(10)}${'In'.padEnd(10)}${'Wrap'.padEnd(10)}Hours`);
    for (const p of r.castLines) {
      lines.push(`  ${p.name.padEnd(20)}${p.role.padEnd(16)}${p.callTime.padEnd(10)}${p.arrivedAt.padEnd(10)}${p.wrapTime.padEnd(10)}${p.hoursWorked}`);
    }
  }
  lines.push('');

  // Crew
  lines.push(hr2);
  lines.push('  CREW');
  lines.push(hr2);
  lines.push(`Total: ${r.crewCount}   Wrapped: ${r.crewWrapped}`);
  if (r.crewLines.length) {
    lines.push('');
    lines.push(`  ${'Name'.padEnd(20)}${'Role/Dept'.padEnd(16)}${'Call'.padEnd(10)}${'In'.padEnd(10)}${'Wrap'.padEnd(10)}Hours`);
    for (const p of r.crewLines) {
      lines.push(`  ${p.name.padEnd(20)}${p.role.padEnd(16)}${p.callTime.padEnd(10)}${p.arrivedAt.padEnd(10)}${p.wrapTime.padEnd(10)}${p.hoursWorked}`);
    }
  }
  lines.push('');

  // OT Alerts
  if (r.otAlerts.length) {
    lines.push(hr2);
    lines.push('  OVERTIME ALERTS');
    lines.push(hr2);
    for (const a of r.otAlerts) {
      lines.push(`  ${a.name.padEnd(20)}${a.role.padEnd(16)}${a.source.padEnd(6)}${a.hoursWorked.padEnd(10)}≥ ${a.threshold}`);
    }
    lines.push('');
  }

  // Open Issues
  if (r.openIssues.length) {
    lines.push(hr2);
    lines.push('  OPEN ISSUES (carry-forward)');
    lines.push(hr2);
    for (const i of r.openIssues) {
      const typ = issues.TYPE_LABELS[i.type]?.label ?? i.type;
      lines.push(`  [${i.status.toUpperCase()}] ${typ}: ${i.description}`);
      if (i.person) lines.push(`    Person: ${i.person}`);
    }
    lines.push('');
  }

  // Flagged Notes
  if (r.flaggedNotes.length) {
    lines.push(hr2);
    lines.push('  FLAGGED NOTES');
    lines.push(hr2);
    for (const n of r.flaggedNotes) {
      const tag = n.scene ? ` [Sc ${n.scene}]` : '';
      lines.push(`  • ${n.text}${tag}`);
    }
    lines.push('');
  }

  // Communications
  if (r.commEntries.length) {
    lines.push(hr2);
    lines.push(`  COMMUNICATIONS (${r.commCount} total${r.commFlagged ? `, ${r.commFlagged} flagged` : ''})`);
    lines.push(hr2);
    for (const e of r.commEntries) {
      const dt = new Date(e.timestamp);
      const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const dir = e.direction === 'inbound' ? '←' : '→';
      const flag = e.flagged ? ' ★' : '';
      lines.push(`  ${time}  ${dir} ${CL.TYPE_LABELS[e.type].label}${flag}  ${e.contact}${e.subject ? ` — ${e.subject}` : ''}`);
    }
    lines.push('');
  }

  lines.push(hr);
  lines.push(`  Generated ${new Date(r.generated).toLocaleTimeString()} — Set Tools DA Workstation`);
  lines.push(hr);

  return lines.join('\n');
}
