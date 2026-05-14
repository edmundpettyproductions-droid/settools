// Conflict review state + PDF export for the manual triage workflow.
// User opens the Conflicts tab → reads each detected cross-source conflict
// → marks it "acknowledged" (non-issue) or "to_fix" (needs bible update) →
// exports a printable PDF checklist of the to_fix items for offline editing.

import * as sync from './sync';
import * as contacts from './contacts';
import { fieldLabel, sourceLabel } from './contacts';
import type {
  ConflictStatusMap, ConflictReviewEntry, ConflictReviewStatus,
  ContactConflict, UnifiedContact,
} from './types';

const KEY = 'settools_conflict_status';

/** Stable id for a conflict — used to persist review state across re-merges. */
export function conflictId(contactName: string, field: string): string {
  return `${contacts.nameKey(contactName)}__${field}`;
}

export function loadStatus(): ConflictStatusMap {
  const s = sync.getJSON<ConflictStatusMap>(KEY);
  if (!s || typeof s !== 'object') return { entries: {} };
  return {
    entries: (s.entries && typeof s.entries === 'object') ? s.entries : {},
    last_updated: typeof s.last_updated === 'string' ? s.last_updated : undefined,
  };
}

export function getStatus(id: string): ConflictReviewEntry {
  const map = loadStatus();
  return map.entries[id] ?? { status: 'unreviewed', updated_at: '' };
}

export async function setStatus(id: string, status: ConflictReviewStatus, note?: string): Promise<void> {
  const map = loadStatus();
  if (status === 'unreviewed' && !note) {
    delete map.entries[id];  // unreviewed = absence, keep map clean
  } else {
    map.entries[id] = {
      status,
      note: note?.trim() || undefined,
      updated_at: new Date().toISOString(),
    };
  }
  map.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(map));
}

export async function clearAll(): Promise<void> {
  await sync.set(KEY, JSON.stringify({ entries: {}, last_updated: new Date().toISOString() } satisfies ConflictStatusMap));
}

/** Drop status entries whose conflict no longer exists (the underlying data was fixed). */
export async function pruneStaleStatuses(currentIds: Set<string>): Promise<number> {
  const map = loadStatus();
  let removed = 0;
  for (const id of Object.keys(map.entries)) {
    if (!currentIds.has(id)) { delete map.entries[id]; removed++; }
  }
  if (removed > 0) {
    map.last_updated = new Date().toISOString();
    await sync.set(KEY, JSON.stringify(map));
  }
  return removed;
}

/** A conflict + its review state, ready for display. */
export interface ConflictRow {
  id: string;
  contactName: string;
  conflict: ContactConflict;
  review: ConflictReviewEntry;
}

/** Walk every contact's conflicts and return a flat list with review state attached. */
export function listConflicts(contactList: UnifiedContact[]): ConflictRow[] {
  const map = loadStatus();
  const rows: ConflictRow[] = [];
  for (const c of contactList) {
    if (!c.conflicts) continue;
    for (const conflict of c.conflicts) {
      const id = conflictId(c.name, conflict.field);
      const review = map.entries[id] ?? { status: 'unreviewed' as ConflictReviewStatus, updated_at: '' };
      rows.push({ id, contactName: c.name, conflict, review });
    }
  }
  return rows;
}

/** Counts per status — for the filter chips + nav badge. */
export interface ConflictCounts {
  total: number;
  unreviewed: number;
  acknowledged: number;
  to_fix: number;
}

export function countByStatus(rows: ConflictRow[]): ConflictCounts {
  let unreviewed = 0, acknowledged = 0, to_fix = 0;
  for (const r of rows) {
    if (r.review.status === 'acknowledged') acknowledged++;
    else if (r.review.status === 'to_fix') to_fix++;
    else unreviewed++;
  }
  return { total: rows.length, unreviewed, acknowledged, to_fix };
}

// ── PDF export ────────────────────────────────────────────────────────────
// Generates a printable HTML doc with the to_fix items in checklist form
// and opens it in a new window with window.print(). The browser's
// "Save as PDF" handles the actual PDF output.
export function exportToFixPdf(rows: ConflictRow[], opts?: { productionName?: string }) {
  const toFix = rows.filter((r) => r.review.status === 'to_fix');
  if (!toFix.length) {
    alert('Nothing marked "Fix in Bible" yet.\n\nGo through the conflicts list, click "⚠ Fix in Bible" on items that need to be updated in your bible, then export.');
    return;
  }
  const stamp = new Date().toLocaleString();
  const prod = opts?.productionName?.trim() || 'Production';
  const escape = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const rowsHtml = toFix.map((r, i) => {
    const valuesHtml = r.conflict.values.map((v) =>
      `<div class="value"><span class="src">${escape(sourceLabel(v.source))}:</span> ${escape(v.value)}</div>`
    ).join('');
    const note = r.review.note ? `<div class="note"><strong>Note:</strong> ${escape(r.review.note)}</div>` : '';
    return `
      <tr>
        <td class="check"><div class="checkbox"></div></td>
        <td class="num">${i + 1}</td>
        <td class="person">${escape(r.contactName)}</td>
        <td class="field">${escape(fieldLabel(r.conflict.field))}</td>
        <td class="values">${valuesHtml}${note}</td>
        <td class="fix-col"><div class="fix-line"></div><div class="fix-line"></div></td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Cast Bible Fix List — ${escape(prod)}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 0; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 10.5px; color: #555; margin-bottom: 12px; }
  .intro { font-size: 11px; color: #333; margin-bottom: 14px; line-height: 1.45; max-width: 7.5in; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th {
    background: #1a1530; color: #fff;
    padding: 7px 8px; text-align: left;
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  }
  td {
    padding: 8px; border-bottom: 1px solid #d8d8d8; vertical-align: top;
  }
  tr:nth-child(even) td { background: #fafafa; }
  td.check { width: 22px; text-align: center; padding-left: 0; padding-right: 0; }
  .checkbox {
    width: 14px; height: 14px; border: 1.5px solid #555; border-radius: 2px;
    display: inline-block; margin-top: 1px;
  }
  td.num { width: 22px; font-weight: 700; color: #666; }
  td.person { width: 130px; font-weight: 700; }
  td.field {
    width: 80px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #444;
  }
  td.values { font-size: 11px; }
  .value { padding: 1px 0; }
  .value .src { font-weight: 600; color: #888; font-size: 10px; margin-right: 4px; }
  .note { margin-top: 4px; font-size: 10px; color: #006633; font-style: italic; }
  td.fix-col { width: 1.6in; padding-top: 12px; }
  .fix-line { border-bottom: 1px solid #777; height: 14px; margin-bottom: 6px; }
  .footer { margin-top: 20px; font-size: 9px; color: #888; text-align: center; }
  @media print { body { padding: 0 } }
</style>
</head><body>
  <h1>Cast Bible — Fix List</h1>
  <div class="meta">${escape(prod)} · ${toFix.length} item${toFix.length === 1 ? '' : 's'} · Generated ${escape(stamp)}</div>
  <div class="intro">
    Items flagged in Set Tools as cross-source conflicts requiring manual updates to the Cast Bible.
    Open your bible alongside this sheet. For each row: review the values from each source, write the
    correct value in the "New Value" column, then update the bible and check the box.
  </div>
  <table>
    <thead><tr>
      <th></th>
      <th>#</th>
      <th>Person</th>
      <th>Field</th>
      <th>Current Values (by source)</th>
      <th>New Value / Notes</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">Set Tools · Conflict Review · Print to PDF to save · ${escape(stamp)}</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Allow pop-ups for this site to export the fix list.'); return; }
  win.document.write(html);
  win.document.close();
}
