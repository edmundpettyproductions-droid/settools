// Unit tests for projectSettings.ts — union/non-union defaults and toggle logic

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock store — exposed so beforeEach can clear it
const mockStore = new Map<string, string>();

// Mock sync module before importing anything that uses it
vi.mock('../sync', () => ({
  getJSON: <T>(key: string): T | null => {
    const raw = mockStore.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  set: async (key: string, value: string) => {
    mockStore.set(key, value);
  },
  subscribe: () => {},
}));

import {
  UNION_DEFAULTS,
  NON_UNION_DEFAULTS,
  applyUnionDefaults,
  load,
  type ProjectSettings,
} from '../projectSettings';

describe('projectSettings', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  describe('defaults', () => {
    it('union defaults have 6-minute grace period', () => {
      expect(UNION_DEFAULTS.graceMins).toBe(6);
    });

    it('non-union defaults have 0 grace period', () => {
      expect(NON_UNION_DEFAULTS.graceMins).toBe(0);
    });

    it('union has 4 OT thresholds (8, 10, 12, 14)', () => {
      expect(UNION_DEFAULTS.otThresholds).toEqual([8, 10, 12, 14]);
    });

    it('non-union has 3 OT thresholds (8, 10, 12)', () => {
      expect(NON_UNION_DEFAULTS.otThresholds).toEqual([8, 10, 12]);
    });

    it('both default to 6-hour meal', () => {
      expect(UNION_DEFAULTS.mealDueMins).toBe(360);
      expect(NON_UNION_DEFAULTS.mealDueMins).toBe(360);
    });

    it('union requires vouchers, non-union does not', () => {
      expect(UNION_DEFAULTS.bgVoucherRequired).toBe(true);
      expect(NON_UNION_DEFAULTS.bgVoucherRequired).toBe(false);
    });

    it('union label is "Exhibit G", non-union is "Time Sheet"', () => {
      expect(UNION_DEFAULTS.timeSheetLabel).toBe('Exhibit G');
      expect(NON_UNION_DEFAULTS.timeSheetLabel).toBe('Time Sheet');
    });

    it('union enforces turnaround, non-union does not', () => {
      expect(UNION_DEFAULTS.turnaroundEnforced).toBe(true);
      expect(NON_UNION_DEFAULTS.turnaroundEnforced).toBe(false);
    });
  });

  describe('applyUnionDefaults', () => {
    it('switching to union applies union defaults', () => {
      const current = { ...NON_UNION_DEFAULTS };
      const result = applyUnionDefaults(current, 'union');

      expect(result.union).toBe('union');
      expect(result.graceMins).toBe(6);
      expect(result.turnaroundEnforced).toBe(true);
      expect(result.bgVoucherRequired).toBe(true);
      expect(result.timeSheetLabel).toBe('Exhibit G');
    });

    it('switching to non-union applies non-union defaults', () => {
      const current = { ...UNION_DEFAULTS };
      const result = applyUnionDefaults(current, 'non-union');

      expect(result.union).toBe('non-union');
      expect(result.graceMins).toBe(0);
      expect(result.turnaroundEnforced).toBe(false);
      expect(result.bgVoucherRequired).toBe(false);
      expect(result.timeSheetLabel).toBe('Time Sheet');
    });

    it('preserves lastUpdated when toggling', () => {
      const current = { ...NON_UNION_DEFAULTS, lastUpdated: '2026-05-15T12:00:00Z' };
      const result = applyUnionDefaults(current, 'union');

      expect(result.lastUpdated).toBe('2026-05-15T12:00:00Z');
    });
  });

  describe('load', () => {
    it('defaults to non-union when no data stored', () => {
      const settings = load();
      expect(settings.union).toBe('non-union');
      expect(settings.graceMins).toBe(0);
    });
  });
});
