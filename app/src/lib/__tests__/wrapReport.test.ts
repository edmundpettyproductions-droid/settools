// Unit tests for wrapReport.ts — generate() and formatText()

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock store ────────────────────────────────────────────────
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

import { generate, formatText } from '../wrapReport';

// ─── Helpers ─────────────────────────────────────────────────────────
function seedUH(overrides: Record<string, unknown> = {}) {
  mockStore.set(
    'settools_uh',
    JSON.stringify({
      production: 'Test Production',
      episode: '101',
      shootDay: '3',
      director: 'Jane Director',
      location: 'Stage 5',
      callTime: '07:00',
      firstShot: '08:14',
      ...overrides,
    }),
  );
}

function seedScenes() {
  mockStore.set(
    'settools_scenes',
    JSON.stringify({
      nid: 4,
      rows: [
        {
          id: 1,
          sceneNum: '14',
          description: 'Kitchen argument',
          setLocation: 'INT. KITCHEN',
          cast: '1,2',
          pages: '2 3/8',
          status: 'complete',
          firstUp: '08:30',
          wrapped: '10:45',
          setups: 4,
          notes: '',
        },
        {
          id: 2,
          sceneNum: '15',
          description: 'Hallway chase',
          setLocation: 'INT. HALLWAY',
          cast: '1',
          pages: '1',
          status: 'complete',
          firstUp: '11:00',
          wrapped: '12:30',
          setups: 2,
          notes: '',
        },
        {
          id: 3,
          sceneNum: '16',
          description: 'Rooftop confrontation',
          setLocation: 'EXT. ROOFTOP',
          cast: '1,3',
          pages: '3 1/8',
          status: 'scheduled',
          firstUp: null,
          wrapped: null,
          setups: 0,
          notes: '',
        },
      ],
    }),
  );
}

function seedCast() {
  mockStore.set(
    'settools_cast',
    JSON.stringify({
      nid: 3,
      rows: [
        {
          id: 1,
          empId: '',
          name: 'Alice Actor',
          role: 'SARAH',
          callTime: '07:00',
          onSetTime: '',
          isolate: false,
          arrived: true,
          arrivedAt: '06:55',
          adjMins: 0,
          adjNote: '',
          kioskIn: null,
          kioskOut: null,
          wrapTime: '13:00',
        },
        {
          id: 2,
          empId: '',
          name: 'Bob Performer',
          role: 'TOM',
          callTime: '08:00',
          onSetTime: '',
          isolate: false,
          arrived: true,
          arrivedAt: '08:05',
          adjMins: 0,
          adjNote: '',
          kioskIn: null,
          kioskOut: null,
          wrapTime: null,
        },
      ],
    }),
  );
}

function seedCrew() {
  mockStore.set(
    'settools_crew',
    JSON.stringify({
      nid: 2,
      rows: [
        {
          id: 1,
          empId: '',
          name: 'Charlie DP',
          role: 'Director of Photography',
          callTime: '06:00',
          onSetTime: '',
          isolate: false,
          arrived: true,
          arrivedAt: '05:58',
          adjMins: 0,
          adjNote: '',
          kioskIn: null,
          kioskOut: null,
          wrapTime: null,
        },
      ],
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────
describe('wrapReport', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  describe('generate() with empty store', () => {
    it('returns a WrapReport without throwing', () => {
      expect(() => generate()).not.toThrow();
    });

    it('has empty production fields', () => {
      const r = generate();
      expect(r.production).toBe('');
      expect(r.director).toBe('');
    });

    it('has zero scene counts', () => {
      const r = generate();
      expect(r.sceneSummary.total).toBe(0);
      expect(r.sceneSummary.complete).toBe(0);
    });

    it('has dash-only timing when no data', () => {
      const r = generate();
      expect(r.firstShot).toBe('—');
      expect(r.lastShot).toBe('—');
      expect(r.totalElapsed).toBe('—');
    });
  });

  describe('generate() with full seed data', () => {
    beforeEach(() => {
      seedUH();
      seedScenes();
      seedCast();
      seedCrew();
    });

    it('picks up production name', () => {
      const r = generate();
      expect(r.production).toBe('Test Production');
      expect(r.episode).toBe('101');
      expect(r.director).toBe('Jane Director');
    });

    it('formats firstShot from UH', () => {
      const r = generate();
      expect(r.firstShot).toBe('8:14a');
    });

    it('counts scenes correctly (2 complete, 3 total)', () => {
      const r = generate();
      expect(r.sceneSummary.complete).toBe(2);
      expect(r.sceneSummary.total).toBe(3);
    });

    it('builds sceneLines only for non-scheduled scenes', () => {
      const r = generate();
      // scenes 14 and 15 are complete; 16 is scheduled → excluded
      expect(r.sceneLines).toHaveLength(2);
      expect(r.sceneLines[0]?.sceneNum).toBe('14');
      expect(r.sceneLines[1]?.sceneNum).toBe('15');
    });

    it('formats scene firstUp and wrapped as 12h', () => {
      const r = generate();
      const sc14 = r.sceneLines[0]!;
      expect(sc14.firstUp).toBe('8:30a');
      expect(sc14.wrapped).toBe('10:45a');
    });

    it('computes lastShot from latest complete scene wrap', () => {
      const r = generate();
      // scene 15 wrapped at 12:30
      expect(r.lastShot).toBe('12:30p');
    });

    it('counts cast lines', () => {
      const r = generate();
      expect(r.castCount).toBe(2);
    });

    it('counts cast wrapped (only Alice has wrapTime)', () => {
      const r = generate();
      expect(r.castWrapped).toBe(1);
    });

    it('counts crew lines', () => {
      const r = generate();
      expect(r.crewCount).toBe(1);
    });

    it('generates a truthy ISO timestamp', () => {
      const r = generate();
      expect(() => new Date(r.generated)).not.toThrow();
      expect(new Date(r.generated).getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('formatText()', () => {
    it('produces non-empty text', () => {
      seedUH();
      seedScenes();
      seedCast();
      seedCrew();
      const r = generate();
      const text = formatText(r);
      expect(text.length).toBeGreaterThan(100);
    });

    it('includes DAY WRAP REPORT header', () => {
      const r = generate();
      expect(formatText(r)).toContain('DAY WRAP REPORT');
    });

    it('includes production name when set', () => {
      seedUH();
      const r = generate();
      expect(formatText(r)).toContain('Test Production');
    });

    it('includes SCENES section', () => {
      const r = generate();
      expect(formatText(r)).toContain('SCENES');
    });

    it('includes CAST section', () => {
      seedCast();
      const r = generate();
      expect(formatText(r)).toContain('CAST');
    });

    it('includes actor name when cast seeded', () => {
      seedUH();
      seedScenes();
      seedCast();
      seedCrew();
      const r = generate();
      expect(formatText(r)).toContain('Alice Actor');
    });
  });
});
