// projectSettings.ts — Global per-project configuration
// Union vs non-union toggle + configurable timing defaults.
// Other modules read these settings to adjust behavior.

import * as sync from './sync';

// ─── Types ───────────────────────────────────────────────────────────
export type UnionStatus = 'union' | 'non-union';

export interface ProjectSettings {
  union: UnionStatus;

  // Meal penalty
  mealDueMins: number;       // minutes before meal is due (default 360 = 6h)
  graceMins: number;         // grace period after due (union: 6, non-union: configurable)

  // Overtime thresholds (hours)
  otEnabled: boolean;
  otThresholds: number[];    // e.g. [8, 10, 12, 14]

  // Turnaround
  turnaroundHours: number;   // minimum rest between wrap & next call (union: 10 or 12)
  turnaroundEnforced: boolean;

  // Background / Extras
  bgVoucherRequired: boolean;  // union: SAG vouchers, non-union: simpler check-in
  bgBumpCategories: string[];  // available bump types

  // Time sheet
  timeSheetLabel: string;      // "Exhibit G" for union, "Time Sheet" for non-union

  // Misc
  lastUpdated: string | null;
}

export const STORAGE_KEY = 'settools_project_settings';

// ─── Defaults ────────────────────────────────────────────────────────
export const UNION_DEFAULTS: ProjectSettings = {
  union: 'union',
  mealDueMins: 360,         // 6 hours
  graceMins: 6,             // SAG 6-minute grace
  otEnabled: true,
  otThresholds: [8, 10, 12, 14],
  turnaroundHours: 10,
  turnaroundEnforced: true,
  bgVoucherRequired: true,
  bgBumpCategories: [
    'Wet Work', 'Smoke Work', 'Special Ability', 'Stand-In',
    'Photo Double', 'Silent Bits', 'Stunt', 'Wardrobe Change',
    'Car / Vehicle', 'Body Makeup', 'Hair / Wig', 'Meals Penalty',
  ],
  timeSheetLabel: 'Exhibit G',
  lastUpdated: null,
};

export const NON_UNION_DEFAULTS: ProjectSettings = {
  union: 'non-union',
  mealDueMins: 360,         // still 6h common practice
  graceMins: 0,             // no formal grace on non-union
  otEnabled: true,
  otThresholds: [8, 10, 12],  // fewer thresholds
  turnaroundHours: 10,
  turnaroundEnforced: false,
  bgVoucherRequired: false,
  bgBumpCategories: [
    'Wet Work', 'Smoke Work', 'Special Ability', 'Stand-In',
    'Photo Double', 'Wardrobe Change', 'Car / Vehicle',
  ],
  timeSheetLabel: 'Time Sheet',
  lastUpdated: null,
};

// ─── Load / Save ─────────────────────────────────────────────────────
export function load(): ProjectSettings {
  const raw = sync.getJSON<Partial<ProjectSettings>>(STORAGE_KEY);
  if (raw?.union) {
    const base = raw.union === 'union' ? UNION_DEFAULTS : NON_UNION_DEFAULTS;
    return { ...base, ...raw };
  }
  // Default to non-union since user primarily works non-union
  return { ...NON_UNION_DEFAULTS };
}

export async function save(settings: ProjectSettings): Promise<void> {
  settings.lastUpdated = new Date().toISOString();
  await sync.set(STORAGE_KEY, JSON.stringify(settings));
}

// ─── Helpers ─────────────────────────────────────────────────────────
/** Switch union status and apply appropriate defaults for fields the user hasn't customized */
export function applyUnionDefaults(
  current: ProjectSettings,
  newStatus: UnionStatus,
): ProjectSettings {
  const defaults = newStatus === 'union' ? UNION_DEFAULTS : NON_UNION_DEFAULTS;
  return {
    ...defaults,
    union: newStatus,
    // Preserve any custom overrides the user explicitly set
    lastUpdated: current.lastUpdated,
  };
}

/** Is the project union? */
export function isUnion(): boolean {
  return load().union === 'union';
}

/** Get meal settings from project config */
export function mealConfig(): { mealDueMins: number; graceMins: number } {
  const s = load();
  return { mealDueMins: s.mealDueMins, graceMins: s.graceMins };
}

/** Get OT thresholds from project config */
export function otConfig(): { enabled: boolean; thresholds: number[] } {
  const s = load();
  return { enabled: s.otEnabled, thresholds: s.otThresholds };
}
