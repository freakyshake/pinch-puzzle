import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  createSceneMaterial,
  CylinderGeometry,
  DataTexture,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  UnsignedByteType,
} from '@iwsdk/core';
import { mergeByMaterial } from './lib/merge.js';

/**
 * The room around the puzzle table, built in code so the game downloads no
 * models: a plywood floor, coloured walls with a window in the back wall, a
 * ceiling, wall art, plants and the trophy shelf. Origin is the player's seat
 * on the floor; the player faces -Z.
 *
 * Nothing here casts shadows: the scene's key light is meant to reach the
 * table as if the room were open, so walls and ceiling only receive.
 */

/** Room size in meters: x from -HALF_W to HALF_W, z from BACK to FRONT. */
const HALF_W = 4.2;
const BACK = -5;
const FRONT = 3.2;
const HEIGHT = 3;
const WALL = 0.12;
/** Window opening in the back wall. */
const WIN_HALF = 1.3;
const WIN_SILL = 0.95;
const WIN_TOP = 2.35;

/** Small seeded random generator (mulberry32): same pixels in every realm. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pixelTexture(width: number, height: number, pixels: Uint8Array): DataTexture {
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * One tile of plywood planks: eight boards across, each a slightly different
 * honey tone, with long soft grain streaks, dark seams and staggered ends.
 */
function createPlankTexture(size = 512): DataTexture {
  const random = makeRandom(41);
  const boards = 8;
  const boardWidth = size / boards;
  const tone: number[] = [];
  const joint: number[] = [];
  for (let b = 0; b < boards; b += 1) {
    tone.push(0.9 + random() * 0.2);
    joint.push(Math.floor(random() * size));
  }
  // Grain: a few long sine streaks per board, fixed phases.
  const phase: number[] = [];
  for (let i = 0; i < boards * 3; i += 1) phase.push(random() * Math.PI * 2);
  const base = [0xd8, 0xb4, 0x80];
  const seam = [0x8c, 0x68, 0x40];
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const b = Math.min(boards - 1, Math.floor(x / boardWidth));
      const across = x - b * boardWidth;
      const v = (y / size) * Math.PI * 2;
      const grain =
        0.035 * Math.sin(v * 3 + phase[b * 3] + across * 0.5) +
        0.025 * Math.sin(v * 7 + phase[b * 3 + 1] + across * 1.3) +
        0.02 * Math.sin(across * 2.1 + phase[b * 3 + 2]);
      const shade = tone[b] + grain;
      const edge = Math.min(across, boardWidth - across);
      const end = Math.min(Math.abs(y - joint[b]), size - Math.abs(y - joint[b]));
      const line = Math.max(1 - edge / 1.6, 1 - end / 1.6, 0) * 0.75;
      const index = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const wood = Math.min(255, base[c] * shade);
        pixels[index + c] = Math.round(wood + (seam[c] - wood) * line);
      }
      pixels[index + 3] = 255;
    }
  }
  return pixelTexture(size, size, pixels);
}

/**
 * Sunlight through the window, lying on the floor: four bright panes with the
 * frame's shadow between them and soft edges. Alpha only matters here.
 */
function createSunTexture(size = 128): DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  const soft = (t: number) => Math.min(1, Math.max(0, t));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const border = Math.min(u, 1 - u, v, 1 - v);
      const bar = Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5));
      const light = soft(border / 0.09) * soft((bar - 0.012) / 0.03);
      const index = (y * size + x) * 4;
      pixels[index] = 255;
      pixels[index + 1] = 236;
      pixels[index + 2] = 196;
      pixels[index + 3] = Math.round(255 * light);
    }
  }
  return pixelTexture(size, size, pixels);
}

const paint = (id: string, color: `#${string}`, roughness = 0.92): Material =>
  createSceneMaterial({ id, model: 'standard', baseColor: color, roughness });

/**
 * Wall paint that carries some light of its own. The key light comes from
 * almost straight above, so upright walls and the ceiling would otherwise be
 * left in the dark; this stands in for the light a real room bounces around.
 */
const wallPaint = (id: string, color: `#${string}`, glow: number): Material =>
  createSceneMaterial({
    id,
    model: 'standard',
    baseColor: color,
    roughness: 0.92,
    emissive: color,
    emissiveIntensity: glow,
  });

const backWallPaint = wallPaint('room-wall-terracotta', '#D98A66', 0.3);
const sideWallPaint = wallPaint('room-wall-sage', '#A9C6A0', 0.3);
const frontWallPaint = wallPaint('room-wall-cream', '#E9D8BC', 0.3);
const ceilingPaint = wallPaint('room-ceiling', '#F4EFE6', 0.72);
const trimPaint = paint('room-trim', '#F6F2EA', 0.6);
const hillNear = paint('room-hill-near', '#9CC48C', 1);
const hillFar = paint('room-hill-far', '#B7D3B2', 1);

function box(
  size: [number, number, number],
  material: Material,
  x: number,
  y: number,
  z: number,
  name?: string,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  return mesh;
}

/** Floor, four walls (the back one with a window opening) and a ceiling. */
export function createRoomShell(): Group {
  const room = new Group();
  room.name = 'room';
  const width = HALF_W * 2;
  const depth = FRONT - BACK;
  const midZ = (FRONT + BACK) / 2;

  const planks = createPlankTexture();
  planks.wrapS = planks.wrapT = RepeatWrapping;
  // One tile is eight boards, 1.2 m across and 2.4 m long.
  planks.repeat.set(width / 1.2, depth / 2.4);
  const floor = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshStandardMaterial({ map: planks, roughness: 0.62 }),
  );
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, midZ);

  const ceiling = new Mesh(new PlaneGeometry(width, depth), ceilingPaint);
  ceiling.name = 'ceiling';
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, HEIGHT, midZ);

  // Back wall in four pieces around the window opening.
  const backZ = BACK - WALL / 2;
  const sideSpan = HALF_W - WIN_HALF;
  const back = new Group();
  back.name = 'back-wall';
  back.add(
    box([sideSpan, HEIGHT, WALL], backWallPaint, -(WIN_HALF + sideSpan / 2), HEIGHT / 2, backZ),
    box([sideSpan, HEIGHT, WALL], backWallPaint, WIN_HALF + sideSpan / 2, HEIGHT / 2, backZ),
    box([WIN_HALF * 2, WIN_SILL, WALL], backWallPaint, 0, WIN_SILL / 2, backZ),
    box([WIN_HALF * 2, HEIGHT - WIN_TOP, WALL], backWallPaint, 0, (HEIGHT + WIN_TOP) / 2, backZ),
  );

  const walls = new Group();
  walls.name = 'walls';
  walls.add(
    box([WALL, HEIGHT, depth], sideWallPaint, -HALF_W - WALL / 2, HEIGHT / 2, midZ, 'left-wall'),
    box([WALL, HEIGHT, depth], sideWallPaint, HALF_W + WALL / 2, HEIGHT / 2, midZ, 'right-wall'),
    box([width, HEIGHT, WALL], frontWallPaint, 0, HEIGHT / 2, FRONT + WALL / 2, 'front-wall'),
  );

  // White trim: skirting along the walls, and the window frame.
  const trim = new Group();
  trim.name = 'trim';
  const skirt = 0.09;
  trim.add(
    box([sideSpan, skirt, 0.02], trimPaint, -(WIN_HALF + sideSpan / 2), skirt / 2, BACK + 0.01),
    box([sideSpan, skirt, 0.02], trimPaint, WIN_HALF + sideSpan / 2, skirt / 2, BACK + 0.01),
    box([WIN_HALF * 2, skirt, 0.02], trimPaint, 0, skirt / 2, BACK + 0.01),
    box([0.02, skirt, depth], trimPaint, -HALF_W + 0.01, skirt / 2, midZ),
    box([0.02, skirt, depth], trimPaint, HALF_W - 0.01, skirt / 2, midZ),
    box([width, skirt, 0.02], trimPaint, 0, skirt / 2, FRONT - 0.01),
  );
  const frame = 0.07;
  const winH = WIN_TOP - WIN_SILL;
  const winMidY = (WIN_TOP + WIN_SILL) / 2;
  const windowFrame = new Group();
  windowFrame.name = 'window';
  windowFrame.add(
    box([WIN_HALF * 2 + frame, frame, WALL + 0.06], trimPaint, 0, WIN_SILL, backZ),
    box([WIN_HALF * 2 + frame, frame, WALL + 0.04], trimPaint, 0, WIN_TOP, backZ),
    box([frame, winH, WALL + 0.04], trimPaint, -WIN_HALF, winMidY, backZ),
    box([frame, winH, WALL + 0.04], trimPaint, WIN_HALF, winMidY, backZ),
    box([0.04, winH, 0.04], trimPaint, 0, winMidY, backZ),
    box([WIN_HALF * 2, 0.04, 0.04], trimPaint, 0, winMidY, backZ),
    // A deeper sill to rest the eye on.
    box([WIN_HALF * 2 + 0.24, 0.035, 0.2], trimPaint, 0, WIN_SILL - 0.02, BACK + 0.06),
  );

  // Soft hills far outside, so the window has a view.
  const outdoors = new Group();
  outdoors.name = 'outdoors';
  const hill = (r: number, x: number, z: number, material: Material) => {
    const mesh = new Mesh(new SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), material);
    mesh.scale.y = 0.42;
    mesh.position.set(x, -0.06, z);
    return mesh;
  };
  outdoors.add(
    hill(7, -6, -24, hillFar),
    hill(9, 7, -27, hillFar),
    hill(5, 1.5, -19, hillNear),
    hill(4, -9, -17, hillNear),
  );

  // Sunlight from the window on the floor, slanting toward the player.
  const sun = new Mesh(
    new PlaneGeometry(2.3, 1.9),
    new MeshBasicMaterial({
      map: createSunTexture(),
      transparent: true,
      opacity: 0.34,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  sun.name = 'sun-patch';
  sun.rotation.x = -Math.PI / 2;
  sun.rotation.z = -0.22;
  sun.position.set(0.55, 0.006, BACK + 1.75);

  room.add(floor, ceiling, back, walls, trim, windowFrame, outdoors, sun);
  return mergeByMaterial(room);
}

/** The six piece colors, in board order. */
const PIECE_COLORS = ['#E9805F', '#5FA8E9', '#F2C14E', '#B57BE0', '#5FD3A6', '#EF6F9A'] as const;
const pieceGloss = PIECE_COLORS.map((color, i) =>
  createSceneMaterial({
    id: `room-piece-${i}`,
    model: 'standard',
    baseColor: color,
    roughness: 0.45,
    emissive: color,
    emissiveIntensity: 0.12,
  }),
);
const canvasCream = paint('room-canvas-cream', '#F3EBDD');
const frameWood = paint('room-frame-wood', '#B98A58', 0.6);
const potClay = paint('room-pot', '#C9714E', 0.8);
const leafGreen = paint('room-leaf', '#4FA36C', 0.7);
const leafDark = paint('room-leaf-dark', '#3C8758', 0.7);
const trunkBrown = paint('room-trunk', '#8A6548', 0.9);

function framed(width: number, height: number, x: number, y: number, motif: Mesh[]): Group {
  const art = new Group();
  art.position.set(x, y, 0);
  art.add(
    box([width + 0.07, height + 0.07, 0.035], frameWood, 0, 0, 0.0175),
    box([width, height, 0.012], canvasCream, 0, 0, 0.038),
  );
  for (const shape of motif) {
    shape.position.z += 0.046;
    art.add(shape);
  }
  return art;
}

/**
 * Two framed prints of the game's own shapes. Origin is on the wall surface
 * at the center of the pair; the prints face +Z.
 */
export function createWallArt(): Group {
  const art = new Group();
  art.name = 'wall-art';
  const disc = new Mesh(new CircleGeometry(0.17, 40), pieceGloss[1]);
  disc.position.set(-0.05, 0.12, 0);
  const square = box([0.24, 0.24, 0.004], pieceGloss[0], 0.08, -0.14, 0);
  const triangle = new Mesh(new CircleGeometry(0.19, 3), pieceGloss[2]);
  triangle.rotation.z = Math.PI / 2;
  triangle.position.set(0, -0.02, 0);
  const ring = new Mesh(new TorusGeometry(0.13, 0.035, 12, 40), pieceGloss[3]);
  ring.scale.z = 0.2;
  ring.position.set(0, 0.03, 0);
  art.add(
    framed(0.62, 0.84, -0.42, 0, [disc, square]),
    framed(0.5, 0.5, 0.36, 0.17, [triangle]),
    framed(0.5, 0.26, 0.36, -0.29, [ring]),
  );
  return mergeByMaterial(art);
}

/** Potted plant about 1.5 m tall. Origin is where the pot meets the floor. */
export function createPlant(): Group {
  const plant = new Group();
  plant.name = 'plant';
  const pot = new Mesh(new CylinderGeometry(0.2, 0.15, 0.36, 28), potClay);
  pot.position.y = 0.18;
  const rim = new Mesh(new TorusGeometry(0.2, 0.022, 10, 28), potClay);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.36;
  const trunk = new Mesh(new CylinderGeometry(0.018, 0.028, 0.95, 10), trunkBrown);
  trunk.position.y = 0.36 + 0.475;
  plant.add(pot, rim, trunk);
  // Broad leaves spiralling up the trunk; fixed angles, no randomness.
  const leaf = new IcosahedronGeometry(1, 2);
  for (let i = 0; i < 11; i += 1) {
    const turn = i * 2.4;
    const up = 0.62 + i * 0.085;
    const length = 0.3 - i * 0.008;
    const holder = new Group();
    holder.position.set(0, up, 0);
    holder.rotation.y = turn;
    const blade = new Mesh(leaf, i % 2 ? leafDark : leafGreen);
    blade.scale.set(0.115, 0.012, length / 2);
    blade.position.set(0, 0.07, length / 2 + 0.02);
    blade.rotation.x = -0.55 + i * 0.035;
    holder.add(blade);
    plant.add(holder);
  }
  return mergeByMaterial(plant);
}

/**
 * Wall shelf with one small trophy per board (trophy-1 to trophy-6), each the
 * shape and color of that board. PuzzleSystem shows a trophy when its board
 * is solved. Origin is on the wall surface, under the middle of the shelf.
 */
export function createTrophyShelf(): Group {
  const shelf = new Group();
  shelf.name = 'trophy-shelf';
  const length = 1.9;
  const board = new Group();
  board.name = 'shelf-board';
  board.add(
    box([length, 0.035, 0.2], frameWood, 0, 0, 0.1),
    box([0.03, 0.12, 0.16], frameWood, -length / 2 + 0.2, -0.075, 0.08),
    box([0.03, 0.12, 0.16], frameWood, length / 2 - 0.2, -0.075, 0.08),
  );
  shelf.add(mergeByMaterial(board));
  const size = 0.085;
  const shapes = [
    new BoxGeometry(size * 1.6, size * 1.6, size * 1.6),
    new SphereGeometry(size, 24, 16),
    new ConeGeometry(size, size * 2, 28),
    new TorusGeometry(size * 0.8, size * 0.36, 14, 32),
    new OctahedronGeometry(size * 1.15, 0),
    new CylinderGeometry(size * 0.85, size * 0.85, size * 1.7, 28),
  ];
  shapes.forEach((geometry, i) => {
    const trophy = new Group();
    trophy.name = `trophy-${i + 1}`;
    trophy.position.set((i - 2.5) * 0.29, 0.0175, 0.1);
    const stand = new Mesh(new CylinderGeometry(0.06, 0.07, 0.03, 20), trimPaint);
    stand.position.y = 0.015;
    const piece = new Mesh(geometry, pieceGloss[i]);
    piece.position.y = 0.03 + size + 0.012;
    trophy.add(stand, piece);
    shelf.add(trophy);
  });
  return shelf;
}
