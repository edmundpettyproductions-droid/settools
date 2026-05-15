// Tiny navigation bus — lets child components request a top-level tab switch
// without coupling to App.svelte. App subscribes in onMount; any component
// can fire `requestTab('issues')` to jump to that tab.

export type Tab =
  | 'tomorrow'
  | 'depts'
  | 'contacts'
  | 'conflicts'
  | 'notes'
  | 'issues'
  | 'cast-bible'
  | 'resources';

export const ALL_TABS: readonly Tab[] = [
  'tomorrow',
  'depts',
  'contacts',
  'conflicts',
  'notes',
  'issues',
  'cast-bible',
  'resources',
];

export function isTab(v: unknown): v is Tab {
  return typeof v === 'string' && (ALL_TABS as readonly string[]).includes(v);
}

type Listener = (tab: Tab) => void;
const listeners = new Set<Listener>();

/** Request a top-level tab switch. App listens via `onTabRequest`. */
export function requestTab(tab: Tab): void {
  for (const l of listeners) {
    try { l(tab); } catch (e) { console.warn('[nav] listener threw:', e); }
  }
}

/** Subscribe to tab-switch requests. Returns an unsubscribe fn. */
export function onTabRequest(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
