import { createComponent, Types } from '@iwsdk/core';

/** Every piece and slot has a shape; a piece only fits a slot of the same shape. */
export const ShapeKinds = {
  Cube: 'cube',
  Sphere: 'sphere',
  Cone: 'cone',
  Torus: 'torus',
  Gem: 'gem',
  Cylinder: 'cylinder',
} as const;
export type ShapeKind = (typeof ShapeKinds)[keyof typeof ShapeKinds];

export const PieceStates = {
  Tray: 'tray',
  Held: 'held',
  Returning: 'returning',
  Snapping: 'snapping',
  Placed: 'placed',
} as const;

export const Piece = createComponent('Piece', {
  shape: { type: Types.Enum, enum: ShapeKinds, default: ShapeKinds.Cube },
  state: { type: Types.Enum, enum: PieceStates, default: PieceStates.Tray },
  /** World position the piece rests at on the tray. */
  home: { type: Types.Vec3, default: [0, 0, 0] },
  /** World position the piece is gliding toward (home or a slot). */
  target: { type: Types.Vec3, default: [0, 0, 0] },
  slot: { type: Types.Entity, default: null },
  /** 0..1 scale pulse, decays every frame. */
  pulse: { type: Types.Float32, default: 0 },
});

export const Slot = createComponent('Slot', {
  shape: { type: Types.Enum, enum: ShapeKinds, default: ShapeKinds.Cube },
  occupant: { type: Types.Entity, default: null },
  /** 0..1 success glow, decays every frame. */
  glow: { type: Types.Float32, default: 0 },
  /** 0..1 wrong-shape flash, decays every frame. */
  wrong: { type: Types.Float32, default: 0 },
});
