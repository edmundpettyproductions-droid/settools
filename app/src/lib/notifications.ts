// notifications.ts — Browser notification + sound + vibration layer.
//
// Triggers (per tracker mode):
//   • pre-call warning: N minutes before call time
//   • late warning:     N minutes after call when person hasn't arrived
//   • on arrival:       when a person is marked arrived
//   • all arrived:      when every member of a timer group has arrived
//
// Output channels (each independently toggleable):
//   • In-app toast (always renders; handled by TrackerTab)
//   • Browser notification (Notification API — works when tab is hidden/blurred)
//   • Sound (synthesized via WebAudio, no asset needed)
//   • Vibration (Vibration API — Android/Chrome only, no-op on iOS Safari)
//
// Storage: prefs are per-mode (cast/crew) so cast and crew can have different rules.

import * as sync from './sync';
import * as sms from './sms';

export type TrackerMode = 'cast' | 'crew';
export type FromSlot = sms.FromSlot;
export const FROM_SLOTS: FromSlot[] = ['A', 'B', 'C', 'D'];

// ───────────────────────────────────────────────────────────────────────────
// Vibration patterns
// ───────────────────────────────────────────────────────────────────────────

export interface VibrationPattern {
  id: string;
  label: string;
  pattern: number[]; // ms on/off/on/off…
}

export const VIBRATION_PATTERNS: VibrationPattern[] = [
  { id: 'none',       label: 'None',          pattern: [] },
  { id: 'short',      label: 'Short tap',     pattern: [120] },
  { id: 'double',     label: 'Double tap',    pattern: [90, 80, 90] },
  { id: 'triple',     label: 'Triple tap',    pattern: [70, 60, 70, 60, 70] },
  { id: 'long',       label: 'Long buzz',     pattern: [500] },
  { id: 'heartbeat',  label: 'Heartbeat',     pattern: [100, 60, 200, 400] },
  { id: 'sos',        label: 'SOS',           pattern: [80,60,80,60,80, 200, 250,80,250,80,250, 200, 80,60,80,60,80] },
  { id: 'rolling',    label: 'Rolling',       pattern: [50,40,80,40,120,40,200] },
];

export function patternById(id: string): VibrationPattern | undefined {
  return VIBRATION_PATTERNS.find(p => p.id === id);
}

// ───────────────────────────────────────────────────────────────────────────
// Preferences
// ───────────────────────────────────────────────────────────────────────────

export interface NotifPrefs {
  enabled: boolean;             // master switch
  browserEnabled: boolean;      // OS-level Notification API
  soundEnabled: boolean;        // play ding
  vibrateEnabled: boolean;      // navigator.vibrate
  onlyWhenHidden: boolean;      // only fire when tab is hidden/unfocused

  preCallEnabled: boolean;
  preCallMinutes: number;
  preCallVibration: string;     // pattern id

  lateEnabled: boolean;
  lateMinutes: number;
  lateVibration: string;

  arrivalEnabled: boolean;
  arrivalVibration: string;

  allArrivedEnabled: boolean;
  allArrivedVibration: string;

  // SMS — Twilio
  smsEnabled: boolean;          // master SMS switch
  smsTo: string;                // E.164, e.g. "+13105551234"
  preCallSms: boolean;
  preCallSmsFrom: FromSlot;
  lateSms: boolean;
  lateSmsFrom: FromSlot;
  arrivalSms: boolean;
  arrivalSmsFrom: FromSlot;
  allArrivedSms: boolean;
  allArrivedSmsFrom: FromSlot;
}

export const DEFAULT_PREFS: NotifPrefs = {
  enabled: false,
  browserEnabled: true,
  soundEnabled: false,
  vibrateEnabled: true,
  onlyWhenHidden: false,

  preCallEnabled: true,
  preCallMinutes: 5,
  preCallVibration: 'double',

  lateEnabled: true,
  lateMinutes: 10,
  lateVibration: 'sos',

  arrivalEnabled: false,
  arrivalVibration: 'short',

  allArrivedEnabled: true,
  allArrivedVibration: 'rolling',

  smsEnabled: false,
  smsTo: '',
  preCallSms: false,
  preCallSmsFrom: 'A',
  lateSms: false,
  lateSmsFrom: 'B',
  arrivalSms: false,
  arrivalSmsFrom: 'C',
  allArrivedSms: false,
  allArrivedSmsFrom: 'D',
};

export function prefsKey(mode: TrackerMode): string {
  return `settools_notif_${mode}`;
}

export function loadPrefs(mode: TrackerMode): NotifPrefs {
  const raw = sync.getJSON<Partial<NotifPrefs>>(prefsKey(mode));
  return { ...DEFAULT_PREFS, ...(raw ?? {}) };
}

export async function savePrefs(mode: TrackerMode, prefs: NotifPrefs): Promise<void> {
  await sync.set(prefsKey(mode), JSON.stringify(prefs));
}

// ───────────────────────────────────────────────────────────────────────────
// Permission
// ───────────────────────────────────────────────────────────────────────────

export function permission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); }
  catch { return 'denied'; }
}

// ───────────────────────────────────────────────────────────────────────────
// Capability detection
// ───────────────────────────────────────────────────────────────────────────

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// ───────────────────────────────────────────────────────────────────────────
// Sound (synthesized — no asset)
// ───────────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
type WindowWithWebkit = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const w = window as WindowWithWebkit;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try { audioCtx = new Ctor(); return audioCtx; } catch { return null; }
}

export function playDing(): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = now + i * 0.14;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
  } catch { /* ignore */ }
}

// ───────────────────────────────────────────────────────────────────────────
// Vibrate
// ───────────────────────────────────────────────────────────────────────────

export function vibratePattern(id: string): void {
  if (!canVibrate()) return;
  const p = patternById(id);
  if (!p || p.pattern.length === 0) return;
  try { navigator.vibrate(p.pattern); } catch { /* ignore */ }
}

// ───────────────────────────────────────────────────────────────────────────
// Fire a notification
// ───────────────────────────────────────────────────────────────────────────

export interface FireOpts {
  title: string;
  body?: string;
  tag?: string;              // dedupe key for OS notification stack
  vibrationId?: string;      // override pattern (else uses no vibration)
  silent?: boolean;          // skip sound even if enabled
  forceShow?: boolean;       // bypass onlyWhenHidden check
  sms?: boolean;             // also send SMS via Twilio (if enabled + recipient set)
  smsFrom?: FromSlot;        // which Twilio from-slot to use (defaults to 'A')
}

export function fire(prefs: NotifPrefs, opts: FireOpts): void {
  if (!prefs.enabled) return;
  const tabVisible = typeof document !== 'undefined' && !document.hidden;

  // SMS is independent of onlyWhenHidden (always sends if enabled)
  if (opts.sms && prefs.smsEnabled && prefs.smsTo) {
    const smsBody = `${opts.title}${opts.body ? '\n' + opts.body : ''}`;
    void sms.sendSms({ to: prefs.smsTo, body: smsBody, fromSlot: opts.smsFrom ?? 'A' });
  }

  if (prefs.onlyWhenHidden && !opts.forceShow && tabVisible) {
    // Tab is visible — only vibrate (subtle); skip sound + OS popup
    if (prefs.vibrateEnabled && opts.vibrationId) vibratePattern(opts.vibrationId);
    return;
  }

  if (prefs.vibrateEnabled && opts.vibrationId) vibratePattern(opts.vibrationId);
  if (prefs.soundEnabled && !opts.silent) playDing();

  if (prefs.browserEnabled && canNotify() && Notification.permission === 'granted') {
    try {
      new Notification(opts.title, {
        body: opts.body,
        tag: opts.tag,
        silent: true, // we play our own sound; prevent double-ding
      });
    } catch { /* ignore */ }
  }
}

export async function testSms(prefs: NotifPrefs, fromSlot: FromSlot, label: string): Promise<{ ok: boolean; error?: string }> {
  if (!prefs.smsTo) return { ok: false, error: 'No recipient phone set' };
  const res = await sms.sendSms({
    to: prefs.smsTo,
    body: `Set Tools test — ${label} (slot ${fromSlot})`,
    fromSlot,
  });
  return res;
}

// ───────────────────────────────────────────────────────────────────────────
// Test fire (for the settings panel "Test" buttons)
// ───────────────────────────────────────────────────────────────────────────

export function test(prefs: NotifPrefs, vibrationId: string, label: string): void {
  // Bypass onlyWhenHidden so user can hear/feel the test
  fire(prefs, { title: `Set Tools — Test`, body: label, vibrationId, forceShow: true, tag: 'st-test' });
}
