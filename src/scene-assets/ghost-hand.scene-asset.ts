import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { bevelBox } from './lib/hardsurface.js';

/**
 * Translucent right "ghost hand" used by the onboarding demo.
 *
 * Contract: palm down, fingers point along -Z, thumb on the -X side. The local
 * origin is the pinch point: where the index and thumb tips meet when closed.
 * Named joints (IndexJoint1..3, ThumbJoint) are animated by setGhostPinch().
 * Palm is about 8 cm wide and 9 cm long.
 */

const PALM_W = 0.08;
const PALM_L = 0.09;
const PALM_T = 0.024;

/** [name, x, length per segment, radius] */
const FINGERS: [string, number, number[], number][] = [
  ['Index', -0.027, [0.04, 0.025, 0.02], 0.0085],
  ['Middle', -0.009, [0.045, 0.028, 0.022], 0.0088],
  ['Ring', 0.009, [0.042, 0.026, 0.02], 0.0083],
  ['Pinky', 0.026, [0.032, 0.02, 0.017], 0.0074],
];

const INDEX_OPEN = [-0.12, -0.12, -0.08];
const INDEX_CLOSED = [-0.72, -0.85, -0.55];
const RELAXED = [-0.32, -0.38, -0.25];
const THUMB_BASE = new Vector3(-0.036, -0.004, -0.004);
const THUMB_RADIUS = 0.0095;
const THUMB_OPEN = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.75);

function ghostMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#e6f8ff',
    emissive: '#8fd8ff',
    emissiveIntensity: 0.65,
    roughness: 0.4,
    transparent: true,
    opacity: 0.5,
  });
}

/** One capsule bone pointing along -Z from its parent joint. */
function bone(name: string, length: number, radius: number, mat: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(radius, Math.max(0.001, length - radius), 4, 10), mat);
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = -length / 2;
  return mesh;
}

function finger(
  name: string,
  x: number,
  lengths: number[],
  radius: number,
  pose: number[],
  mat: MeshStandardMaterial,
): Group {
  const root = new Group();
  root.name = name;
  root.position.set(x, 0, -PALM_L / 2 + 0.006);
  let parent: Object3D = root;
  lengths.forEach((len, i) => {
    const joint = new Group();
    joint.name = `${name}Joint${i + 1}`;
    if (i > 0) joint.position.z = -lengths[i - 1];
    joint.rotation.x = pose[i];
    joint.add(bone(`${name}Bone${i + 1}`, len, radius * (1 - i * 0.08), mat));
    parent.add(joint);
    parent = joint;
  });
  const tip = new Object3D();
  tip.name = `${name}Tip`;
  tip.position.z = -lengths[lengths.length - 1];
  parent.add(tip);
  return root;
}

const AXIS_FORWARD = new Vector3(0, 0, -1);

/** Builds the ghost hand, open, with its origin at the closed pinch point. */
export function createGhostHand(): Group {
  const mat = ghostMaterial();
  const root = new Group();
  root.name = 'GhostHand';
  const hand = new Group();
  hand.name = 'Hand';
  root.add(hand);

  const palm = new Mesh(bevelBox(PALM_W, PALM_T, PALM_L, 0.006, 0.014), mat);
  palm.name = 'Palm';
  hand.add(palm);

  for (const [name, x, lengths, radius] of FINGERS) {
    const pose = name === 'Index' ? INDEX_CLOSED : RELAXED;
    hand.add(finger(name, x, lengths, radius, pose, mat));
  }

  // Measure the closed index tip in hand space, then aim the thumb at it so
  // the two tips meet exactly when the pinch closes.
  hand.updateMatrixWorld(true);
  const tipClosed = new Vector3();
  hand.getObjectByName('IndexTip')!.getWorldPosition(tipClosed);
  const toTip = tipClosed.clone().sub(THUMB_BASE);
  const reach = toTip.length();
  const closed = new Quaternion().setFromUnitVectors(AXIS_FORWARD, toTip.normalize());

  const thumb = new Group();
  thumb.name = 'ThumbJoint';
  thumb.position.copy(THUMB_BASE);
  thumb.quaternion.copy(THUMB_OPEN);
  const first = reach * 0.55;
  thumb.add(bone('ThumbBone1', first, THUMB_RADIUS, mat));
  const thumbTipJoint = new Group();
  thumbTipJoint.name = 'ThumbJoint2';
  thumbTipJoint.position.z = -first;
  thumbTipJoint.add(bone('ThumbBone2', reach - first, THUMB_RADIUS * 0.9, mat));
  thumb.add(thumbTipJoint);
  hand.add(thumb);

  // Open the index again; the rig animates from here.
  for (let i = 0; i < 3; i++) {
    hand.getObjectByName(`IndexJoint${i + 1}`)!.rotation.x = INDEX_OPEN[i];
  }
  hand.position.copy(tipClosed).negate();

  root.userData.ghostHand = {
    thumbOpen: THUMB_OPEN.toArray(),
    thumbClosed: closed.toArray(),
  };
  return root;
}

/** Animates a ghost hand between open (0) and pinched (1). Allocation free. */
export class GhostHandRig {
  private index: Object3D[] = [];
  private thumb: Object3D;
  private thumbTip: Object3D;
  private open = new Quaternion();
  private closed = new Quaternion();

  constructor(root: Object3D) {
    for (let i = 1; i <= 3; i++) this.index.push(root.getObjectByName(`IndexJoint${i}`)!);
    this.thumb = root.getObjectByName('ThumbJoint')!;
    this.thumbTip = root.getObjectByName('ThumbJoint2')!;
    const data = root.userData.ghostHand as { thumbOpen: number[]; thumbClosed: number[] };
    this.open.fromArray(data.thumbOpen);
    this.closed.fromArray(data.thumbClosed);
  }

  setPinch(t: number): void {
    for (let i = 0; i < 3; i++) {
      this.index[i].rotation.x = INDEX_OPEN[i] + (INDEX_CLOSED[i] - INDEX_OPEN[i]) * t;
    }
    this.thumb.quaternion.slerpQuaternions(this.open, this.closed, t);
    this.thumbTip.rotation.x = -0.3 * (1 - t);
  }
}
