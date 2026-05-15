// Unit tests for scenes.ts — load normalization, summarize, page math, paste

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStore = new Map<string, string>();

vi.mock('../sync', () => ({
  getJSON: <T>(key: string): T | null => {
    const raw = mockStore.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  set: async (key: string, value: string) => {
    mockStore.set(key, value);
  },
  subscribe: () => () => {},
}));

import {
  loadScenes,
  summarize,
  parsePageEighths,
  fmtEighths,
  applyPaste,
  mkScene,
  advanceStatus,
  resetStatus,
  STORAGE_KEY,
} from '../scenes';

describe('scenes', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  // ─── loadScenes normalization ─────────────────────────────────────
  describe('loadScenes normalization', () => {
    it('returns empty SceneData when no data stored', () => {
      const d = loadScenes();
      expect(d.rows).toHaveLength(0);
      expect(d.nid).toBe(1);
    });

    it('loads modern field names correctly', () => {
      mockStore.set(
        STORAGE_KEY,
        JSON.stringify({
          nid: 2,
          rows: [
            {
              id: 1,
              sceneNum: '14',
              description: 'Kitchen fight',
              setLocation: 'INT. KITCHEN',
              cast: '1,2',
              pages: '2 3/8',
              status: 'scheduled',
              firstUp: null,
              wrapped: null,
              setups: 0,
              notes: '',
            },
          ],
        }),
      );
      const d = loadScenes();
      expect(d.rows[0]?.sceneNum).toBe('14');
      expect(d.rows[0]?.setLocation).toBe('INT. KITCHEN');
    });

    it('maps old field name "scene" → sceneNum', () => {
      mockStore.set(
        STORAGE_KEY,
        JSON.stringify({
          nid: 3,
          rows: [
            { id: '1', scene: '9', set: 'INT', description: 'Surveillance van', pages: '7/8', status: 'shooting', setups: 0 },
          ],
        }),
      );
      const d = loadScenes();
      expect(d.rows[0]?.sceneNum).toBe('9');
      expect(d.rows[0]?.setLocation).toBe('INT');
    });

    it('coerces string id to number', () => {
      mockStore.set(
        STORAGE_KEY,
        JSON.stringify({
          rows: [{ id: '3', scene: '5', pages: '1', status: 'scheduled', setups: 0 }],
        }),
      );
      const d = loadScenes();
      expect(typeof d.rows[0]?.id).toBe('number');
      expect(d.rows[0]?.id).toBe(3);
    });

    it('handles extra fields like "dn" gracefully (ignores them)', () => {
      mockStore.set(
        STORAGE_KEY,
        JSON.stringify({
          rows: [{ id: 1, scene: '42', dn: 'D', pages: '5 6/8', status: 'scheduled', setups: 0 }],
        }),
      );
      expect(() => loadScenes()).not.toThrow();
      const d = loadScenes();
      expect(d.rows[0]?.sceneNum).toBe('42');
    });

    it('defaults missing fields to correct types', () => {
      mockStore.set(STORAGE_KEY, JSON.stringify({ rows: [{ id: 1 }] }));
      const d = loadScenes();
      const row = d.rows[0]!;
      expect(row.sceneNum).toBe('');
      expect(row.description).toBe('');
      expect(row.status).toBe('scheduled');
      expect(row.firstUp).toBeNull();
      expect(row.wrapped).toBeNull();
      expect(row.setups).toBe(0);
    });
  });

  // ─── parsePageEighths ─────────────────────────────────────────────
  describe('parsePageEighths', () => {
    it('parses "2 3/8"', () => expect(parsePageEighths('2 3/8')).toBe(19));
    it('parses "7/8"', () => expect(parsePageEighths('7/8')).toBe(7));
    it('parses "1"', () => expect(parsePageEighths('1')).toBe(8));
    it('parses "0"', () => expect(parsePageEighths('0')).toBe(0));
    it('parses "5 6/8"', () => expect(parsePageEighths('5 6/8')).toBe(46));
    it('returns 0 for empty string', () => expect(parsePageEighths('')).toBe(0));
  });

  // ─── fmtEighths ───────────────────────────────────────────────────
  describe('fmtEighths', () => {
    it('formats 19 → "2 3/8"', () => expect(fmtEighths(19)).toBe('2 3/8'));
    it('formats 8 → "1"', () => expect(fmtEighths(8)).toBe('1'));
    it('formats 7 → "7/8"', () => expect(fmtEighths(7)).toBe('7/8'));
    it('formats 0 → ""', () => expect(fmtEighths(0)).toBe(''));
  });

  // ─── summarize ────────────────────────────────────────────────────
  describe('summarize', () => {
    it('counts scene statuses', () => {
      const rows = [
        mkScene(1, { status: 'complete', pages: '1' }),
        mkScene(2, { status: 'shooting', pages: '2' }),
        mkScene(3, { status: 'scheduled', pages: '1' }),
        mkScene(4, { status: 'omitted', pages: '1' }),
      ];
      const s = summarize(rows);
      expect(s.total).toBe(4);
      expect(s.complete).toBe(1);
      expect(s.shooting).toBe(1);
      expect(s.scheduled).toBe(1);
      expect(s.omitted).toBe(1);
    });

    it('excludes omitted pages from totalEighths', () => {
      const rows = [
        mkScene(1, { status: 'complete', pages: '1' }),    // 8 eighths
        mkScene(2, { status: 'omitted', pages: '2' }),     // excluded
      ];
      const s = summarize(rows);
      expect(s.totalEighths).toBe(8);
      expect(s.completeEighths).toBe(8);
    });
  });

  // ─── advanceStatus / resetStatus ─────────────────────────────────
  describe('advanceStatus', () => {
    it('advances scheduled → rehearsing', () => {
      const r = mkScene(1, { status: 'scheduled' });
      advanceStatus(r);
      expect(r.status).toBe('rehearsing');
    });

    it('advances rehearsing → shooting and sets firstUp', () => {
      const r = mkScene(1, { status: 'rehearsing', firstUp: null });
      advanceStatus(r);
      expect(r.status).toBe('shooting');
      expect(r.firstUp).toBeTruthy();
    });

    it('advances shooting → complete and sets wrapped', () => {
      const r = mkScene(1, { status: 'shooting', firstUp: '09:00', wrapped: null });
      advanceStatus(r);
      expect(r.status).toBe('complete');
      expect(r.wrapped).toBeTruthy();
    });

    it('does not advance omitted', () => {
      const r = mkScene(1, { status: 'omitted' });
      advanceStatus(r);
      expect(r.status).toBe('omitted');
    });
  });

  describe('resetStatus', () => {
    it('resets to scheduled and clears timing', () => {
      const r = mkScene(1, { status: 'complete', firstUp: '09:00', wrapped: '10:30', setups: 4 });
      resetStatus(r);
      expect(r.status).toBe('scheduled');
      expect(r.firstUp).toBeNull();
      expect(r.wrapped).toBeNull();
      expect(r.setups).toBe(0);
    });
  });

  // ─── applyPaste ───────────────────────────────────────────────────
  describe('applyPaste', () => {
    it('parses tab-separated data with headers', () => {
      const text = 'Scene\tDescription\tSet/Location\tCast\tPages\tNotes\n14\tKitchen fight\tINT. KITCHEN\t1,2\t2 3/8\t';
      const { rows } = applyPaste([], text, 1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.sceneNum).toBe('14');
      expect(rows[0]?.setLocation).toBe('INT. KITCHEN');
      expect(rows[0]?.pages).toBe('2 3/8');
    });

    it('returns existing rows unchanged when pasted data is empty', () => {
      const existing = [mkScene(1, { sceneNum: '1' })];
      const { rows, result } = applyPaste(existing, '', 2);
      expect(rows).toHaveLength(1);
      expect(result.added).toBe(0);
    });

    it('increments nid for each added row', () => {
      const text = 'Scene\tDescription\n1\tFirst\n2\tSecond';
      const { nid, result } = applyPaste([], text, 10);
      expect(result.added).toBe(2);
      expect(nid).toBe(12);
    });
  });
});
