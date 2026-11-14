/**
 * Whether this browser can start a VR session at all: true in a headset
 * browser (and in the development emulator), false in an ordinary desktop or
 * phone browser, where pressing Enter XR can do nothing.
 *
 * Only used to word the page honestly. The Enter XR button keeps working
 * whatever this answers, so a wrong "no" can never lock a player out.
 */
export async function canStartVR(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-vr')) === true;
  } catch {
    return false;
  }
}
