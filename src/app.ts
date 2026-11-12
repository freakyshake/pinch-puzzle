import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { setFrameLimit } from './frame-limit.js';
import { PanelSystem } from './panel.js';
import { PuzzleSystem } from './puzzle-system.js';
import { SettingsPanelSystem } from './settings-panel.js';
import { warmUpShaders } from './warm-up.js';

/** The flat page never needs more than this many pixels per CSS pixel. */
const FLAT_PIXEL_RATIO = 1.25;

/**
 * Creates the world and resolves once the scene is ready to be shown. Loaded
 * on demand by index.ts, after it has checked that the browser can run it.
 */
export async function start(container: HTMLDivElement): Promise<void> {
  const world = await World.create(container, projectOptions);
  world.registerSystem(PuzzleSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(SettingsPanelSystem);

  world.visibilityState.subscribe((state) => {
    const flat = state === VisibilityState.NonImmersive;
    setFrameLimit(flat);
    // Pixel ratio only sizes the flat canvas; in VR the headset sets the
    // resolution. three.js refuses size changes while presenting.
    if (flat && !world.renderer.xr.isPresenting) {
      world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, FLAT_PIXEL_RATIO));
    }
  });

  await warmUpShaders(world);
  performance.mark('pinch-puzzle-ready');
}
