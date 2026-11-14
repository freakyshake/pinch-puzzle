import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { seatEmulatedPlayer } from './emulator-seat.js';
import { setFrameLimit } from './frame-limit.js';
import { PanelSystem } from './panel.js';
import { PostureSystem } from './posture.js';
import { PuzzleSystem } from './puzzle-system.js';
import { SettingsPanelSystem } from './settings-panel.js';
import { installLightPanning, useFullSpatialAudio } from './spatial-audio.js';
import { canStartVR } from './vr-support.js';
import { warmUpShaders } from './warm-up.js';

/** The flat page never needs more than this many pixels per CSS pixel. */
const FLAT_PIXEL_RATIO = 1.25;

/**
 * Creates the world and resolves once the scene is ready to be shown. Loaded
 * on demand by index.ts, after it has checked that the browser can run it.
 */
export async function start(container: HTMLDivElement): Promise<void> {
  installLightPanning();
  const world = await World.create(container, projectOptions);
  world.registerSystem(PuzzleSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(PostureSystem);
  world.registerSystem(SettingsPanelSystem);

  world.visibilityState.subscribe((state) => {
    const flat = state === VisibilityState.NonImmersive;
    setFrameLimit(flat);
    if (!flat) {
      useFullSpatialAudio();
      seatEmulatedPlayer();
    }
    // Pixel ratio only sizes the flat canvas; in VR the headset sets the
    // resolution. three.js refuses size changes while presenting.
    if (flat && !world.renderer.xr.isPresenting) {
      world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, FLAT_PIXEL_RATIO));
    }
  });

  await warmUpShaders(world);
  performance.mark('pinch-puzzle-ready');
  showStartBar(world);
}

/** Start bar texts where the browser has no headset to enter VR on. */
const NO_HEADSET_BUTTON = 'VR needs a headset';
const NO_HEADSET_NOTE =
  'This is a preview. Open this page in a VR headset browser to play: seated, hands only.';

/**
 * The large Play in VR button on the flat page (markup and style in
 * index.html). It does what the Enter XR button on the panel does; that one
 * is small on a flat screen. Hidden while a VR session runs.
 */
function showStartBar(world: World): void {
  const bar = document.getElementById('start');
  const button = document.getElementById('enter-vr');
  const note = document.getElementById('start-note');
  if (bar == null || button == null || !world.xrEnabled) return;

  // The click is the user gesture the browser asks for before starting VR.
  button.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((state) => {
    bar.hidden = state !== VisibilityState.NonImmersive;
  });
  // The button stays clickable either way: a wrong "no" from the browser
  // must never lock a headset player out.
  void canStartVR().then((supported) => {
    if (supported) return;
    button.textContent = NO_HEADSET_BUTTON;
    button.classList.add('no-headset');
    if (note != null) note.textContent = NO_HEADSET_NOTE;
  });
}
