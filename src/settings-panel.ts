import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { PostureSystem } from './posture.js';
import { PuzzleSystem } from './puzzle-system.js';
import {
  CLOSER_STEP,
  getSettings,
  HEIGHT_STEP,
  onSettingsChange,
  resetSettings,
  updateSettings,
} from './settings.js';
import { canStartVR } from './vr-support.js';

/** Scene node ID of the comfort panel, beside the progress panel. */
const PANEL_NODE = 'settings-panel';

/** Line under Fit to me: the resting text, and the two answers to a press. */
const FIT_NOTE = 'Or pinch and hold in the air for 3 seconds';
const FIT_NOTE_STARTED = 'Sit how you like and hold still: fitting now';
const FIT_NOTE_FLAT = 'Fit to me works in VR: press Enter XR first';
const FIT_NOTE_NO_HEADSET = 'Fit to me works in VR, on a headset';
const FIT_NOTE_SECONDS = 4;

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
 * restart board and reset. The panel is about a metre away: point at a
 * button and pinch.
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
      updateSettings({ height: getSettings().height - HEIGHT_STEP, heightSet: true }),
    );
    bind('height-up', () =>
      updateSettings({ height: getSettings().height + HEIGHT_STEP, heightSet: true }),
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
    // The button always answers: what it is about to do in VR, or that it
    // needs VR on the flat page. Silence here reads as a broken button.
    const fitNote = panel.getElementById<UIKit.Text>('fit-note');
    let noteTimer = 0;
    let flatNote = FIT_NOTE_FLAT;
    void canStartVR().then((supported) => {
      if (!supported) flatNote = FIT_NOTE_NO_HEADSET;
    });
    bind('fit-to-me', () => {
      const started = this.world.getSystem(PostureSystem)?.requestFit() === true;
      fitNote?.setProperties({ text: started ? FIT_NOTE_STARTED : flatNote });
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(
        () => fitNote?.setProperties({ text: FIT_NOTE }),
        FIT_NOTE_SECONDS * 1000,
      );
    });
    this.cleanupFuncs.push(() => window.clearTimeout(noteTimer));
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
