/**
 * Keeps the browser's head-shaped (HRTF) sound filters out of memory until
 * the player is actually in VR.
 *
 * three.js switches every positional sound to the 'HRTF' panning model as it
 * creates it. The first panner that does so makes the browser build its HRTF
 * filter database, about 50 MB in Chromium, even on the flat preview page
 * where nothing has played yet. Here each new PannerNode starts on the light
 * 'equalpower' model (left/right pan plus distance) and ignores the request
 * for HRTF; useFullSpatialAudio() switches them all over when an immersive
 * session starts, which is where the extra cues (height, front/back) matter.
 *
 * Only standard Web Audio is used: BaseAudioContext.createPanner and
 * PannerNode.panningModel.
 */
const panners: PannerNode[] = [];
let setModel: ((this: PannerNode, value: PanningModelType) => void) | undefined;
let full = false;

export function installLightPanning(): void {
  if (setModel || typeof PannerNode === 'undefined' || typeof BaseAudioContext === 'undefined') {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(PannerNode.prototype, 'panningModel');
  const getModel = descriptor?.get;
  const createPanner = BaseAudioContext.prototype.createPanner;
  if (!descriptor?.set || !getModel || !createPanner) return;
  setModel = descriptor.set;

  BaseAudioContext.prototype.createPanner = function (this: BaseAudioContext): PannerNode {
    const panner = createPanner.call(this);
    if (full) {
      setModel!.call(panner, 'HRTF');
    } else {
      // Shadow the property on this one node: reads stay truthful, writes
      // are held back until useFullSpatialAudio().
      Object.defineProperty(panner, 'panningModel', {
        configurable: true,
        get: () => getModel.call(panner),
        set: () => {},
      });
      panners.push(panner);
    }
    return panner;
  };
}

/** Switch every positional sound to HRTF. Safe to call more than once. */
export function useFullSpatialAudio(): void {
  if (full || !setModel) return;
  full = true;
  for (const panner of panners) {
    delete (panner as { panningModel?: PanningModelType }).panningModel;
    setModel.call(panner, 'HRTF');
  }
  console.info(
    `[audio] ${panners.length} positional sources now use ${panners[0]?.panningModel ?? 'HRTF'} panning`,
  );
  panners.length = 0;
}
