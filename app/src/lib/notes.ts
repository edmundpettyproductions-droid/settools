// Quick Notes — fast jot pad. Persists to settools_notes via sync.ts.

import * as sync from './sync';
import type { NoteEntry, NotesState, NoteCategory } from './types';

const KEY = 'settools_notes';

export function loadNotes(): NotesState {
  const s = sync.getJSON<NotesState>(KEY);
  if (!s) return { notes: [] };
  return {
    notes: Array.isArray(s.notes) ? s.notes : [],
    last_updated: typeof s.last_updated === 'string' ? s.last_updated : undefined,
  };
}

export async function addNote(partial: Omit<NoteEntry, 'id' | 'created_at'>): Promise<NoteEntry> {
  const state = loadNotes();
  const note: NoteEntry = {
    id: makeId(),
    created_at: new Date().toISOString(),
    ...partial,
  };
  state.notes.unshift(note);
  state.last_updated = note.created_at;
  await sync.set(KEY, JSON.stringify(state));
  return note;
}

export async function updateNote(id: string, patch: Partial<NoteEntry>): Promise<void> {
  const state = loadNotes();
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx === -1) return;
  state.notes[idx] = { ...state.notes[idx]!, ...patch };
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function deleteNote(id: string): Promise<void> {
  const state = loadNotes();
  state.notes = state.notes.filter((n) => n.id !== id);
  state.last_updated = new Date().toISOString();
  await sync.set(KEY, JSON.stringify(state));
}

export async function togglePin(id: string): Promise<void> {
  const state = loadNotes();
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  await updateNote(id, { pinned: !note.pinned });
}

function makeId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  director: '🎬 Director',
  continuity: '🎞 Continuity',
  production: '📋 Production',
  general: '📝 General',
};

/** Notes that mention a specific person — for cross-linking from Contacts. */
export function notesForPerson(name: string): NoteEntry[] {
  const norm = name.toLowerCase().trim();
  if (!norm) return [];
  return loadNotes().notes.filter(
    (n) => (n.person && n.person.toLowerCase().trim() === norm) || n.text.toLowerCase().includes(norm),
  );
}

/** Plain-text export for end-of-day production report. */
export function exportAsText(notes: NoteEntry[]): string {
  return notes
    .map((n) => {
      const when = new Date(n.created_at).toLocaleString();
      const tags = [
        CATEGORY_LABELS[n.category],
        n.scene ? `Scene ${n.scene}` : null,
        n.person ? `re: ${n.person}` : null,
      ].filter(Boolean).join(' · ');
      return `[${when}] ${tags ? tags + '\n' : ''}${n.text}`;
    })
    .join('\n\n');
}
