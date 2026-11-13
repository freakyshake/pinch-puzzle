/**
 * Player settings (accessibility and comfort), persisted in localStorage.
 * Plain module state with change listeners; no ECS, DOM or renderer imports
 * beyond localStorage, which is wrapped so private windows still work.
 */

export interface Settings {
  /** Table height offset in meters (negative is lower). */
  height: number;
  /** Table distance offset in meters (positive is closer to the player). */
  closer: number;
  /**
   * True once the player has chosen a height with Lower or Higher: that
   * height is kept. While false the table follows the player's eye height.
   */
  heightSet: boolean;
  highContrast: boolean;
  music: boolean;
}

export const HEIGHT_STEP = 0.04;
// Table top heights: default 0.575 m, lowest 0.415 m, highest 0.935 m. A
// Quest 3 tester seated in an office chair needed 0.575 m (Nov 13), which
// was the old lowest setting, so that is now the default with room below.
export const HEIGHT_MIN = -0.36;
export const HEIGHT_MAX = 0.16;
export const CLOSER_STEP = 0.05;
export const CLOSER_MIN = -0.1;
export const CLOSER_MAX = 0.2;

const KEY = 'pinch-puzzle.settings.v1';
const DEFAULTS: Settings = {
  height: -0.2,
  closer: 0,
  heightSet: false,
  highContrast: false,
  music: true,
};

type Listener = (next: Settings, prev: Settings) => void;

const listeners = new Set<Listener>();
let current: Settings = load();

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
}

function finiteOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : fallback;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      height: clamp(finiteOr(parsed.height, DEFAULTS.height), HEIGHT_MIN, HEIGHT_MAX),
      closer: clamp(finiteOr(parsed.closer, DEFAULTS.closer), CLOSER_MIN, CLOSER_MAX),
      // Settings saved before this flag existed already hold a chosen height.
      heightSet: parsed.heightSet ?? parsed.height != null,
      highContrast: parsed.highContrast === true,
      music: parsed.music !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Nearest height the Lower and Higher buttons can reach. */
export function snapHeight(height: number): number {
  return clamp(Math.round(height / HEIGHT_STEP) * HEIGHT_STEP, HEIGHT_MIN, HEIGHT_MAX);
}

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  const prev = current;
  const next: Settings = {
    ...prev,
    ...patch,
  };
  next.height = clamp(next.height, HEIGHT_MIN, HEIGHT_MAX);
  next.closer = clamp(next.closer, CLOSER_MIN, CLOSER_MAX);
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private window, blocked site data): keep in memory.
  }
  for (const listener of listeners) listener(next, prev);
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULTS });
}

/** Subscribe to changes; returns an unsubscribe function for cleanupFuncs. */
export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
