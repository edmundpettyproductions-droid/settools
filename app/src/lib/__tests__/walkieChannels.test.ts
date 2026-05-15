// Unit tests for walkieChannels.ts — channel CRUD, reorder, format

import { describe, it, expect, vi } from 'vitest';

// Mock sync module
vi.mock('../sync', () => {
  const store = new Map<string, string>();
  return {
    getJSON: <T>(key: string): T | null => {
      const raw = store.get(key);
      return raw ? JSON.parse(raw) : null;
    },
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    subscribe: () => {},
  };
});

import {
  load,
  addChannel,
  removeChannel,
  moveUp,
  moveDown,
  formatText,
  type WalkieState,
} from '../walkieChannels';

describe('walkieChannels', () => {
  function freshState(): WalkieState {
    return load(); // loads defaults (8 channels)
  }

  describe('load defaults', () => {
    it('loads 8 default channels', () => {
      const state = freshState();
      expect(state.channels).toHaveLength(8);
    });

    it('first channel is Production / Open on Ch 1', () => {
      const state = freshState();
      expect(state.channels[0]?.channel).toBe('1');
      expect(state.channels[0]?.department).toBe('Production / Open');
    });

    it('each channel has a unique id', () => {
      const state = freshState();
      const ids = state.channels.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('addChannel', () => {
    it('appends a blank channel', () => {
      const state = freshState();
      const before = state.channels.length;
      addChannel(state);
      expect(state.channels.length).toBe(before + 1);
    });

    it('new channel has empty fields', () => {
      const state = freshState();
      const ch = addChannel(state);
      expect(ch.channel).toBe('');
      expect(ch.department).toBe('');
      expect(ch.notes).toBe('');
    });

    it('increments nid for each add', () => {
      const state = freshState();
      const nidBefore = state.nid;
      addChannel(state);
      expect(state.nid).toBe(nidBefore + 1);
    });
  });

  describe('removeChannel', () => {
    it('removes a channel by id', () => {
      const state = freshState();
      const targetId = state.channels[2]!.id;
      removeChannel(state, targetId);
      expect(state.channels.find((c) => c.id === targetId)).toBeUndefined();
      expect(state.channels).toHaveLength(7);
    });

    it('does nothing for non-existent id', () => {
      const state = freshState();
      removeChannel(state, 99999);
      expect(state.channels).toHaveLength(8);
    });
  });

  describe('moveUp / moveDown', () => {
    it('moveUp swaps with previous element', () => {
      const state = freshState();
      const second = state.channels[1]!.department;
      const first = state.channels[0]!.department;
      moveUp(state, 1);
      expect(state.channels[0]!.department).toBe(second);
      expect(state.channels[1]!.department).toBe(first);
    });

    it('moveUp at index 0 does nothing', () => {
      const state = freshState();
      const first = state.channels[0]!.department;
      moveUp(state, 0);
      expect(state.channels[0]!.department).toBe(first);
    });

    it('moveDown swaps with next element', () => {
      const state = freshState();
      const first = state.channels[0]!.department;
      const second = state.channels[1]!.department;
      moveDown(state, 0);
      expect(state.channels[0]!.department).toBe(second);
      expect(state.channels[1]!.department).toBe(first);
    });

    it('moveDown at last index does nothing', () => {
      const state = freshState();
      const last = state.channels[7]!.department;
      moveDown(state, 7);
      expect(state.channels[7]!.department).toBe(last);
    });
  });

  describe('formatText', () => {
    it('includes header', () => {
      const state = freshState();
      const text = formatText(state.channels);
      expect(text).toContain('WALKIE CHANNEL CHART');
    });

    it('includes all channels', () => {
      const state = freshState();
      const text = formatText(state.channels);
      expect(text).toContain('Ch 1');
      expect(text).toContain('Ch 8');
      expect(text).toContain('Production / Open');
      expect(text).toContain('Locations / Transpo');
    });

    it('includes notes in parentheses', () => {
      const state = freshState();
      const text = formatText(state.channels);
      expect(text).toContain('(General production channel)');
      expect(text).toContain('(AD team + BG wrangling)');
    });
  });
});
