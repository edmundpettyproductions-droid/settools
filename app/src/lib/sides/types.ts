// Types for the Sides v2 pipeline.

/** A scene as it appears in one source document. */
export interface SourceScene {
  num: string;        // "47", "61A", "47-1"
  set: string;
  intExt: string;     // "INT", "EXT", "INT/EXT"
  dn: string;         // "Day", "Night", "Dusk", "Dawn"
  pages: string;      // "2/8", "1 1/8"
  castNums: string[]; // ["1", "3"]
}

/** Canonical scene agreed across all loaded sources. */
export interface CanonicalScene extends SourceScene {
  shootOrder: number; // 0-indexed position in shoot day
}

/** A field where two or more sources disagree. */
export interface SceneConflict {
  sceneNum: string;
  field: 'presence' | 'set' | 'intExt' | 'dn' | 'pages';
  csValue: string | null;   // null = source didn't have this scene/field
  ssValue: string | null;
  stripValue: string | null;
  /** User-chosen winning value. Must be set before proceeding. */
  resolution: string | null;
}

export interface ConflictReport {
  conflicts: SceneConflict[];
  allResolved: boolean;
}

/** One entry in the deterministic script heading index. */
export interface SceneIndexEntry {
  num: string;
  page: number;               // 1-indexed PDF page number
  y: number;                  // y from PDF bottom (pdf-lib coords)
  x: number;                  // x of the scene number text at left margin
  headingText: string;        // reconstructed heading line
  nextStartPage: number | null;
  nextStartY: number | null;  // y of next scene heading (for slash boundaries)
  omitted: boolean;
  isContinuation: boolean;    // "(CONT'D)" marker at top of page — not a new scene
}

/** Result of the post-generation validation check per page. */
export interface ValidationResult {
  passed: boolean;
  issues: Array<{
    page: number; // 1-indexed in the SIDES pdf (not script)
    description: string;
  }>;
}

/** Character names found per scene in the generated sides. */
export type CharactersByScene = Record<string, string[]>;

/** Cross-check result between cast on call sheet and speakers in sides. */
export interface CastCrossCheck {
  unmatchedSpeakers: Array<{ speaker: string; scenes: string[] }>;
  uncalledCast: Array<{ name: string; num: string; role: string }>;
}

/** Script PDF stored in IndexedDB. Key = revision label (or "default"). */
export interface ScriptCacheEntry {
  revisionLabel: string;  // "Rev. Blue", "Production Draft", "default"
  filename: string;
  filesize: number;
  cachedAt: string;       // ISO datetime
  pageCount: number;
}

/** Persisted to sync state under key `settools_sides`. */
export interface SidesState {
  scriptCache?: ScriptCacheEntry;
  charactersByScene?: CharactersByScene;
  lastGeneratedAt?: string;
  lastGeneratedScenes?: string[];
}

/** Progress update from the generation pipeline. */
export interface SidesProgress {
  stage: 'reconcile' | 'index' | 'select' | 'annotate' | 'validate' | 'characters' | 'done' | 'error';
  status: 'pending' | 'running' | 'done' | 'error';
  message: string;
}
