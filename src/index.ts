import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { installFrameLimit, setFrameLimit } from './frame-limit.js';
import { PanelSystem } from './panel.js';
import { PuzzleSystem } from './puzzle-system.js';
import { SettingsPanelSystem } from './settings-panel.js';

// Cap the flat preview page at 30 fps so desktop GPUs stay quiet; VR is
// never capped. Must run before World.create starts the render loop.
installFrameLimit();

/** The flat page never needs more than this many pixels per CSS pixel. */
const FLAT_PIXEL_RATIO = 1.25;

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
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
});
