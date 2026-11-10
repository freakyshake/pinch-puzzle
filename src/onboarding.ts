import {
  Color,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  World,
} from '@iwsdk/core';
import {
  createGhostHand,
  GhostHandRig,
} from './scene-assets/ghost-hand.scene-asset.js';
import type { ShapeKind } from './puzzle-components.js';
import { SHAPE_COLORS, shapeGeometry } from './shapes.js';

/** Seconds for one full demonstration loop. */
const LOOP = 4.4;
const HAND_OPACITY = 0.5;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** 0..1 progress of `t` through the window [a, b]. */
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

/**
 * Ghost-hand demonstration of the core gesture, shown in the first seconds
 * and again when the player is idle: the hand moves over a tray piece,
 * pinches, carries a ghost copy to the matching slot, lets go and fades.
 * No text is needed to understand it.
 */
export class PinchDemo {
  private entity: Entity;
  private root: Group;
  private rig: GhostHandRig;
  private handMaterials: MeshStandardMaterial[] = [];
  private piece: Mesh;
  private pieceMaterial: MeshStandardMaterial;
  private from = new Vector3();
  private to = new Vector3();
  private shape: ShapeKind | null = null;
  private clock = 0;
  /** 0..1 overall fade so the demo can appear and leave softly. */
  private presence = 0;
  private wanted = false;

  constructor(world: World) {
    this.root = createGhostHand();
    this.rig = new GhostHandRig(this.root);
    this.root.traverse((child) => {
      const mat = (child as Mesh).material as MeshStandardMaterial | undefined;
      if (mat && !this.handMaterials.includes(mat)) this.handMaterials.push(mat);
    });
    this.pieceMaterial = new MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.piece = new Mesh(undefined, this.pieceMaterial);
    this.piece.name = 'GhostPiece';
    this.root.add(this.piece);
    this.root.visible = false;
    this.root.name = 'onboarding-hand';
    this.entity = world.createTransformEntity(this.root);
  }

  /** Demonstrate moving a piece of `shape` from `from` to `to` (world space). */
  show(shape: ShapeKind, from: Vector3, to: Vector3): void {
    if (shape !== this.shape) {
      this.shape = shape;
      this.piece.geometry = shapeGeometry(shape);
      this.piece.rotation.x = shape === 'torus' ? Math.PI / 2 : 0;
      const color = new Color(SHAPE_COLORS[shape]);
      this.pieceMaterial.color.copy(color);
      this.pieceMaterial.emissive.copy(color);
    }
    if (!this.wanted || !from.equals(this.from) || !to.equals(this.to)) {
      if (!this.wanted) this.clock = 0;
      this.from.copy(from);
      this.to.copy(to);
    }
    this.wanted = true;
  }

  hide(): void {
    this.wanted = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  update(delta: number): void {
    this.presence += (this.wanted ? 1 : -1) * delta * 2.5;
    this.presence = Math.min(1, Math.max(0, this.presence));
    if (this.presence === 0) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.clock = (this.clock + delta) % LOOP;
    const t = this.clock;

    // Timeline: fade in above the piece, descend, pinch, carry on an arc,
    // release over the slot, rise and fade, short rest.
    const appear = span(t, 0, 0.5);
    const descend = span(t, 0.4, 1.1);
    const pinch = span(t, 1.15, 1.45);
    const carry = span(t, 1.55, 2.85);
    const release = span(t, 2.95, 3.2);
    const rise = span(t, 3.2, 3.8);
    const p = this.root.position;
    p.lerpVectors(this.from, this.to, carry);
    p.y += 0.1 * (1 - descend) + 0.09 * Math.sin(Math.PI * carry) + 0.1 * rise;
    this.rig.setPinch(pinch * (1 - release));
    this.piece.visible = pinch > 0.95 && release < 0.05;

    const fade = appear * (1 - rise) * this.presence;
    for (const mat of this.handMaterials) mat.opacity = HAND_OPACITY * fade;
    this.pieceMaterial.opacity = 0.45 * fade;
  }

  dispose(): void {
    this.entity.dispose();
  }
}
