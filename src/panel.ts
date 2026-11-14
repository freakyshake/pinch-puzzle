/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, UIKit, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { canStartVR } from './vr-support.js';

/** Enter XR button text where the browser has no headset to enter VR on. */
const NO_HEADSET_LABEL = 'VR needs a headset';

export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('progress-panel');
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (xrButton == null || exitButton == null) {
      return;
    }
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    // A desktop or phone browser has no headset: say so on the button, which
    // otherwise does nothing when pressed and reads as broken.
    const xrLabel = panel?.getElementById<UIKit.Text>('xr-label');
    void canStartVR().then((supported) => {
      if (!supported) xrLabel?.setProperties({ text: NO_HEADSET_LABEL });
    });

    const launchXR = () => this.world.launchXR();
    const exitXR = () => this.world.exitXR();
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      }),
    );
  }
}
