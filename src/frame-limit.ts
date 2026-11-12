/**
 * Frame cap for the flat (non-VR) page.
 *
 * Before the player enters VR, the browser drives the render loop with
 * window.requestAnimationFrame at the monitor's refresh rate (120 to 240 Hz on
 * gaming monitors), so a desktop GPU runs flat out on a preview page. This
 * wraps window.requestAnimationFrame so that, while `limited` is true, frames
 * are delivered at most FLAT_FPS times a second.
 *
 * Immersive sessions are untouched: in VR, three.js schedules frames with the
 * XR session's own requestAnimationFrame, not the window's. The flag is also
 * cleared whenever the world reports an immersive state (the desktop emulator
 * drives its XR frames from the window).
 *
 * Cancellation stays exact: each caller gets a stable id that maps to the
 * currently pending native request, so cancelAnimationFrame always stops the
 * loop, including when three.js switches from the window to the XR session.
 */
const FLAT_FPS = 30;
const MIN_INTERVAL = 1000 / FLAT_FPS - 2; // small slack for timer jitter

let limited = true;

export function setFrameLimit(on: boolean): void {
  limited = on;
}

export function installFrameLimit(): void {
  if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, number>();
  let nextId = 1;
  let lastDelivered = 0;

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextId++;
    const tick = (time: number) => {
      if (!pending.has(id)) return;
      // Callbacks in the same native frame share one timestamp, so every
      // caller that was due in a delivered frame still runs in it.
      if (limited && time !== lastDelivered && time - lastDelivered < MIN_INTERVAL) {
        pending.set(id, nativeRequest(tick));
        return;
      }
      pending.delete(id);
      lastDelivered = time;
      callback(time);
    };
    pending.set(id, nativeRequest(tick));
    return id;
  };

  window.cancelAnimationFrame = (id: number): void => {
    const native = pending.get(id);
    if (native === undefined) return;
    nativeCancel(native);
    pending.delete(id);
  };
}
