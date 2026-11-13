import { ShapeKinds, type ShapeKind } from './puzzle-components.js';

/**
 * Table layout. Must match the `puzzle-table` node in
 * public/scenes/main.iwsdk.scene.json (stage top 0.035 + table height 0.74).
 * The table top is 1.1 m wide and about 0.79 m deep.
 */
export const TABLE = {
  x: 0,
  topY: 0.775,
  z: -0.55,
};

/** Height above the table top that tray pieces float at. */
export const TRAY_HOVER = 0.07;
/** Height above the table top that a placed piece sits at. */
export const SLOT_HOVER = 0.045;

/** Offsets are in meters from the table center; +z is toward the player. */
export interface PieceDef {
  shape: ShapeKind;
  tray: [number, number];
  slot: [number, number];
}

export interface BoardDef {
  name: string;
  /** One short line on the progress panel, or empty for none. */
  hint: string;
  pieces: PieceDef[];
}

/** One slot on a board: its shape and table offset [x, z]. */
type SlotSpec = [ShapeKind, number, number];

/** Tray spacing between neighbouring pieces. */
const TRAY_GAP = 0.15;
/** Up to this many pieces sit in one row; larger boards use two rows. */
const TRAY_ROW_MAX = 5;

/**
 * Lays the tray out automatically so a board is just its slots. Pieces are
 * dealt onto the tray in the order given by `trayOrder` (indices into
 * `slots`), so the tray never mirrors the slot layout.
 */
function board(
  name: string,
  slots: SlotSpec[],
  trayOrder: number[],
  hint = '',
): BoardDef {
  const n = slots.length;
  const rows = n <= TRAY_ROW_MAX ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  // One row sits at z 0.2; two rows split around it, the far row first.
  const rowZ = rows.length === 1 ? [0.2] : [0.15, 0.28];
  const trayPositions: [number, number][] = [];
  rows.forEach((count, r) => {
    // Equal rows are staggered by half a gap so no piece hides another.
    const staggered = rows.length === 2 && rows[0] === rows[1];
    const offset = staggered ? (r === 0 ? -TRAY_GAP / 4 : TRAY_GAP / 4) : 0;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * TRAY_GAP + offset;
      trayPositions.push([x, rowZ[r]]);
    }
  });
  const pieces = trayOrder.map((slotIndex, i) => {
    const [shape, sx, sz] = slots[slotIndex];
    return { shape, tray: trayPositions[i], slot: [sx, sz] as [number, number] };
  });
  return { name, hint, pieces };
}

/** Points on an ellipse, for ring-shaped boards. */
function ring(
  shapes: ShapeKind[],
  cx: number,
  cz: number,
  rx: number,
  rz: number,
): SlotSpec[] {
  return shapes.map((shape, i) => {
    const a = (i / shapes.length) * Math.PI * 2;
    return [
      shape,
      Math.round((cx + rx * Math.cos(a)) * 1000) / 1000,
      Math.round((cz - rz * Math.sin(a)) * 1000) / 1000,
    ];
  });
}

const { Cube, Sphere, Cone, Torus, Gem, Cylinder } = ShapeKinds;

/**
 * Six boards, 3 to 8 pieces. Difficulty rises through piece count, then
 * repeated shapes (two of a kind), then look-alike neighbours.
 */
export const BOARDS: BoardDef[] = [
  board(
    'First Light',
    [
      [Cube, 0.18, -0.08],
      [Sphere, -0.18, -0.08],
      [Cone, 0, -0.08],
    ],
    [0, 1, 2],
    'Pinch a shape. Drop it on its match.',
  ),
  board(
    'Four Winds',
    [
      [Torus, 0.1, -0.16],
      [Cube, -0.1, 0.0],
      [Gem, 0.1, 0.0],
      [Sphere, -0.1, -0.16],
    ],
    [0, 1, 2, 3],
    'Too far to reach? Toss it toward its match.',
  ),
  board(
    'Crown',
    [
      [Cylinder, 0, -0.17],
      [Gem, -0.2, -0.05],
      [Cone, 0.2, -0.05],
      [Torus, -0.1, 0.05],
      [Cube, 0.1, 0.05],
    ],
    [0, 1, 2, 3, 4],
  ),
  board(
    'Twin Peaks',
    ring([Cone, Sphere, Cube, Cone, Cylinder, Sphere], 0, -0.11, 0.19, 0.15),
    [2, 0, 5, 4, 1, 3],
    'Twins fit either matching ring.',
  ),
  board(
    'Bloom',
    [
      [Gem, 0, -0.12],
      ...ring([Torus, Cube, Cylinder, Torus, Sphere, Cone], 0, -0.12, 0.21, 0.16),
    ],
    [3, 0, 6, 2, 5, 1, 4],
  ),
  board(
    'Constellation',
    ring([Cube, Gem, Cylinder, Cone, Sphere, Torus, Gem, Cylinder], 0, -0.12, 0.28, 0.16),
    [5, 2, 7, 0, 3, 6, 1, 4],
  ),
];
