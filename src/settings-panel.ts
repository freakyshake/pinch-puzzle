import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { PuzzleSystem } from './puzzle-system.js';
import {
  CLOSER_STEP,
  getSettings,
  HEIGHT_STEP,
  onSettingsChange,
  resetSettings,
  updateSettings,
} from './settings.js';

/** Scene node ID of the comfort panel beside the table. */
const PANEL_NODE = 'settings-panel';

/** Toggle look: green when on, slate when off. The label always says which. */
const TOGGLE_ON = {
  backgroundColor: '#5fd3a6',
  color: '#10261c',
  hover: { backgroundColor: '#7fe0b9' },
};
const TOGGLE_OFF = {
  backgroundColor: '#565a66',
  color: '#fafaf7',
  hover: { backgroundColor: '#6a6f7c' },
};

/**
 * Wires the comfort panel: table height and distance, high contrast, music,
 * restart board and reset. Buttons respond to a fingertip poke or a pinch
 * from a distance.
 */
export class SettingsPanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (panel == null) return;

    const bind = (id: string, action: () => void) => {
      const button = panel.getElementById(id);
      if (button == null) return;
      button.name = id;
      button.addEventListener('click', action);
      this.cleanupFuncs.push(() => button.removeEventListener('click', action));
    };

    bind('height-down', () =>
      updateSettings({ height: getSettings().height - HEIGHT_STEP }),
    );
    bind('height-up', () =>
      updateSettings({ height: getSettings().height + HEIGHT_STEP }),
    );
    bind('move-closer', () =>
      updateSettings({ closer: getSettings().closer + CLOSER_STEP }),
    );
    bind('move-farther', () =>
      updateSettings({ closer: getSettings().closer - CLOSER_STEP }),
    );
    bind('contrast-toggle', () =>
      updateSettings({ highContrast: !getSettings().highContrast }),
    );
    bind('music-toggle', () => updateSettings({ music: !getSettings().music }));
    bind('reset-settings', () => resetSettings());
    bind('restart-board', () => this.world.getSystem(PuzzleSystem)?.restartBoard());

    const contrastLabel = panel.getElementById<UIKit.Text>('contrast-label');
    const musicLabel = panel.getElementById<UIKit.Text>('music-label');
    const contrastToggle = panel.getElementById('contrast-toggle');
    const musicToggle = panel.getElementById('music-toggle');
    const refresh = () => {
      const s = getSettings();
      contrastToggle?.setProperties(s.highContrast ? TOGGLE_ON : TOGGLE_OFF);
      musicToggle?.setProperties(s.music ? TOGGLE_ON : TOGGLE_OFF);
      contrastLabel?.setProperties({ text: s.highContrast ? 'On' : 'Off' });
      musicLabel?.setProperties({ text: s.music ? 'On' : 'Off' });
    };
    refresh();
    this.cleanupFuncs.push(onSettingsChange(refresh));
  }
}
