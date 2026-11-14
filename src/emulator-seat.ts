/**
 * Development only: seats the emulated player.
 *
 * The XR emulator (IWER, the browser stand-in for a headset that the dev
 * server adds) starts every session as a standing player holding controllers,
 * eyes 1.6 m up and looking straight ahead. Nobody plays a tabletop game like
 * that: the table ends up below the bottom of the view and the game looks
 * broken the moment VR starts. A real player sits and looks down at the table.
 *
 * So when VR starts in the emulator, and only while the emulated head is still
 * in that untouched starting pose, the head is put at a seated eye height,
 * looking down at the table, with tracked hands instead of controllers. A pose
 * set by a test script or by dragging the emulator's controls is left alone.
 *
 * On a headset, and in the published build, there is no emulator and this does
 * nothing.
 */

interface EmulatedVector {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

interface EmulatedQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): unknown;
}

interface EmulatedPose {
  position: EmulatedVector;
  quaternion: EmulatedQuaternion;
}

/** The parts of IWER's XRDevice used here (see iwer/lib/device/XRDeviceBase). */
interface EmulatedDevice extends EmulatedPose {
  primaryInputMode: 'controller' | 'hand';
  hands: { left?: EmulatedPose; right?: EmulatedPose };
  /**
   * Who is driving the poses: the on-screen controls (manual) or code
   * (programmatic). The controls copy the device state when this changes.
   */
  controlMode: 'manual' | 'programmatic';
  notifyStateChange(): void;
}

/** IWER's starting eye height. */
const START_EYE = 1.6;
/** Seated eyes. At this height the automatic table height is the default one. */
const SEAT = { x: 0, y: 1.2, z: 0.15 };
/** Looking down at the far half of the table, in degrees below level. */
const LOOK_DOWN = 33;
/** Hands rest above the near edge of the table, left and right. */
const HAND = { x: 0.26, y: 0.88, z: -0.22 };

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * The emulator draws a set of coloured arrows on each hand: drag one with the
 * mouse to move that hand, click them to switch between moving and turning.
 * At their stock size they cover the board, so they are drawn small here, and
 * the G key hides them, together with the two hand panels in the bottom
 * corners, for a clear view. G again brings them back.
 *
 * The arrows keep a fixed size on screen whatever their scale in the scene,
 * so the size is set on the arrow set itself (TranslateHandles and
 * RotateHandles in @pmndrs/handle, both with a public `size`, stock value 1).
 */
const HANDLE_SIZE = 0.35;
const HANDLE_HIDDEN = 0.0001;
const CLEAR_VIEW_KEY = 'KeyG';
/** The hand panels are the only emulator elements pinned to the bottom edge. */
const PANEL_STYLE = 'div[style*="bottom: 8px"] { display: none !important; }';

interface EmulatorHandle {
  /** The arrow set now shown; replaced when a click switches move and turn. */
  handles?: { size?: number };
  addEventListener(type: 'click', listener: () => void): void;
}

interface EmulatorWindow {
  IWER_DEVICE?: EmulatedDevice & {
    devui?: { devUIContainer?: { shadowRoot: ShadowRoot | null } };
  };
  /** Set by the emulator's on-screen controls (see @iwer/devui scene.js). */
  transformHandles?: Map<string, EmulatorHandle>;
}

let clearView = false;
let controlsBound = false;
let panelStyle: HTMLStyleElement | null = null;

function applyEmulatorView(): void {
  const emulator = window as EmulatorWindow;
  emulator.transformHandles?.forEach((handle) => {
    if (handle.handles != null) handle.handles.size = clearView ? HANDLE_HIDDEN : HANDLE_SIZE;
  });
  const root = emulator.IWER_DEVICE?.devui?.devUIContainer?.shadowRoot;
  if (root == null) return;
  if (clearView && panelStyle == null) {
    panelStyle = document.createElement('style');
    panelStyle.textContent = PANEL_STYLE;
    root.appendChild(panelStyle);
  } else if (!clearView && panelStyle != null) {
    panelStyle.remove();
    panelStyle = null;
  }
}

function tidyEmulatorControls(): void {
  applyEmulatorView();
  if (controlsBound) return;
  controlsBound = true;
  // A click on the arrows swaps in a new arrow set at the stock size.
  (window as EmulatorWindow).transformHandles?.forEach((handle) =>
    handle.addEventListener('click', applyEmulatorView),
  );
  window.addEventListener('keydown', (event) => {
    if (event.code !== CLEAR_VIEW_KEY || event.repeat) return;
    // Typing a G into one of the emulator's own fields is not a shortcut.
    const typing = event
      .composedPath()
      .some((target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
    if (typing) return;
    clearView = !clearView;
    try {
      applyEmulatorView();
    } catch (error) {
      console.warn('[emulator] could not change the emulator view', error);
    }
  });
  console.info('[emulator] hand arrows drawn small; press G to hide or show the emulator hand controls');
}

export function seatEmulatedPlayer(): void {
  const device = (window as { IWER_DEVICE?: EmulatedDevice }).IWER_DEVICE;
  if (device == null) return;
  try {
    tidyEmulatorControls();
    const { position, quaternion } = device;
    const untouched =
      near(position.x, 0) &&
      near(position.y, START_EYE) &&
      near(position.z, 0) &&
      near(quaternion.x, 0) &&
      near(quaternion.y, 0) &&
      near(quaternion.z, 0);
    if (!untouched) return;

    const half = (-LOOK_DOWN * Math.PI) / 360;
    // The emulator's on-screen controls keep their own copy of every pose and
    // write it back each frame, so a pose set behind their back is undone at
    // once. Taking control, setting the poses and handing control back makes
    // them pick the new poses up, hands included.
    const before = device.controlMode;
    device.controlMode = 'programmatic';
    device.primaryInputMode = 'hand';
    position.set(SEAT.x, SEAT.y, SEAT.z);
    quaternion.set(Math.sin(half), 0, 0, Math.cos(half));
    device.hands.left?.position.set(-HAND.x, HAND.y, HAND.z);
    device.hands.right?.position.set(HAND.x, HAND.y, HAND.z);
    device.notifyStateChange();
    device.controlMode = before;
    console.info('[emulator] seated the emulated player: eyes 1.2 m, looking at the table, hands');
  } catch (error) {
    // The emulator is a development aid; never let it stop the game.
    console.warn('[emulator] could not seat the emulated player', error);
  }
}
