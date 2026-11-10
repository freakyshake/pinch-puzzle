import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PanelSystem } from './panel.js';
import { PuzzleSystem } from './puzzle-system.js';
import { SettingsPanelSystem } from './settings-panel.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(PuzzleSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(SettingsPanelSystem);
});
