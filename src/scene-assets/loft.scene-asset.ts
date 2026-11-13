import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  createSceneMaterial,
  createScenePrimitiveObject,
  CylinderGeometry,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
} from '@iwsdk/core';
import { mergeByMaterial } from './lib/merge.js';

/**
 * The game room: a converted industrial loft at dusk. Polished concrete,
 * beige tilt-up walls, dark steel trusses with linear lights, a roll-up door
 * open to the evening sky, warm wall lamps, a leather lounge facing a big
 * screen, a dartboard, foosball and shuffleboard tables and a drinks bar.
 *
 * Every set is built in room coordinates (origin at the player's seat on the
 * floor, player facing -Z) and placed at the origin by the scene. Each set is
 * merged to one mesh per material. Nothing casts shadows; the scene grounds
 * furniture with ContactShadow nodes.
 */

export const LOFT = {
  halfWidth: 5,
  back: -6.5,
  front: 3.5,
  height: 4.4,
  wall: 0.14,
  /** Big steel-framed window in the back wall, looking west at a sunset. */
  doorLeft: -4.3,
  doorRight: -1.5,
  doorTop: 3.3,
  sill: 0.85,
};

/** The six piece colors, in board order. */
export const PIECE_COLORS = ['#E9805F', '#5FA8E9', '#F2C14E', '#B57BE0', '#5FD3A6', '#EF6F9A'] as const;

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

/** Tileable value noise with `period` cells across the tile, 0..1. */
function valueNoise(seed: number, period: number): (u: number, v: number) => number {
  const random = makeRandom(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i += 1) grid[i] = random();
  const at = (i: number, j: number) => grid[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function pixelTexture(width: number, height: number, pixels: Uint8Array, repeat = false): DataTexture {
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Paints a width x height RGBA image from a per-pixel function of (u, v),
 * with v = 0 at the top of the picture. (Texture rows start at the bottom,
 * so rows are written bottom-up.)
 */
function paintImage(
  width: number,
  height: number,
  shade: (u: number, v: number) => [number, number, number, number?],
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = shade((x + 0.5) / width, 1 - (y + 0.5) / height);
      const index = (y * width + x) * 4;
      pixels[index] = Math.max(0, Math.min(255, Math.round(r)));
      pixels[index + 1] = Math.max(0, Math.min(255, Math.round(g)));
      pixels[index + 2] = Math.max(0, Math.min(255, Math.round(b)));
      pixels[index + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return pixels;
}

/**
 * Polished concrete, 3 m tile: warm grey with cloudy trowel marks, a few
 * darker patches and saw-cut joints every 1.5 m.
 */
function concreteTexture(size = 512): DataTexture {
  const broad = valueNoise(3, 4);
  const mid = valueNoise(5, 16);
  const fine = valueNoise(7, 96);
  const pixels = paintImage(size, size, (u, v) => {
    const n = 0.5 * broad(u, v) + 0.32 * mid(u, v) + 0.18 * fine(u, v);
    const shade = 0.8 + 0.34 * n;
    const ju = Math.min(u % 0.5, 0.5 - (u % 0.5)) * size;
    const jv = Math.min(v % 0.5, 0.5 - (v % 0.5)) * size;
    const joint = Math.max(0, 1 - Math.min(ju, jv) / 1.3) * 0.45;
    const k = shade * (1 - joint);
    return [88 * k, 80 * k, 72 * k];
  });
  return pixelTexture(size, size, pixels, true);
}

/** Beige tilt-up wall panel, one panel per tile, seams at the edges. */
function wallTexture(size = 256): DataTexture {
  const broad = valueNoise(11, 3);
  const fine = valueNoise(13, 48);
  const pixels = paintImage(size, size, (u, v) => {
    const k = 0.93 + 0.08 * broad(u, v) + 0.04 * fine(u, v);
    const seam = Math.max(0, 1 - Math.min(u, 1 - u) * size / 1.6) * 0.35;
    const kk = k * (1 - seam);
    return [204 * kk, 186 * kk, 160 * kk];
  });
  return pixelTexture(size, size, pixels, true);
}

/** Area rug: slate field, worn cream border, faded diamond lattice. */
function rugTexture(size = 256): DataTexture {
  const wear = valueNoise(17, 24);
  const pixels = paintImage(size, size, (u, v) => {
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const w = 0.75 + 0.25 * wear(u, v);
    if (edge < 0.03) return [52 * w, 50 * w, 54 * w];
    if (edge < 0.085) return [176 * w, 160 * w, 138 * w];
    const d = Math.abs(((u * 6 + v * 4) % 1) - 0.5) + Math.abs(((u * 6 - v * 4 + 10) % 1) - 0.5);
    const line = d > 0.88 ? 0.35 : 0;
    return [(78 + 70 * line) * w, (84 + 50 * line) * w, (96 + 20 * line) * w];
  });
  return pixelTexture(size, size, pixels);
}

/** Signed-distance shapes for the screen and the prints, in tile units. */
function shapeDistance(kind: number, x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  switch (kind) {
    case 0: return Math.max(ax, ay) - 0.8; // square
    case 1: return Math.hypot(x, y) - 0.9; // circle
    case 2: return Math.max(ax * 0.866 + y * 0.5, -y) - 0.45; // triangle
    case 3: return Math.abs(Math.hypot(x, y) - 0.7) - 0.24; // ring
    case 4: return (ax + ay) / Math.SQRT2 - 0.72; // diamond
    default: return Math.max(ax - 0.62, ay - 0.9); // cylinder, side on
  }
}

/**
 * The big screen's picture: an evening gradient with the six game shapes in
 * a row, each glowing in its piece color. No text, no logos.
 */
function screenTexture(width = 512, height = 288): DataTexture {
  const colors = PIECE_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const pixels = paintImage(width, height, (u, v) => {
    const top = [24, 26, 58];
    const bottom = [92, 50, 86];
    let r = top[0] + (bottom[0] - top[0]) * v;
    let g = top[1] + (bottom[1] - top[1]) * v;
    let b = top[2] + (bottom[2] - top[2]) * v;
    for (let i = 0; i < 6; i += 1) {
      const cx = (i + 0.5) / 6;
      const x = ((u - cx) * width) / 34;
      const y = ((v - 0.52) * height) / 34;
      const d = shapeDistance(i, x, -y);
      const fill = d < 0 ? 1 : 0;
      const glow = Math.exp(-Math.max(0, d) * 2.2) * 0.55;
      const t = Math.max(fill, glow);
      r += (colors[i][0] - r) * t;
      g += (colors[i][1] - g) * t;
      b += (colors[i][2] - b) * t;
    }
    // A soft floor reflection band.
    if (v > 0.74) {
      const k = 0.85;
      r *= k;
      g *= k;
      b *= k;
    }
    return [r, g, b];
  });
  return pixelTexture(width, height, pixels);
}

/** Dartboard face: 20 black and cream sectors, red and green rings, bull. */
function dartboardTexture(size = 256): DataTexture {
  const pixels = paintImage(size, size, (u, v) => {
    const x = u * 2 - 1;
    const y = v * 2 - 1;
    const r = Math.hypot(x, y);
    if (r > 1) return [20, 20, 22, 255];
    if (r < 0.06) return [200, 36, 40];
    if (r < 0.12) return [30, 140, 70];
    if (r > 0.94) return [22, 22, 24];
    const sector = Math.floor((Math.atan2(y, x) + Math.PI + Math.PI / 20) / (Math.PI / 10)) % 20;
    const dark = sector % 2 === 0;
    const ring = (r > 0.82 && r < 0.9) || (r > 0.5 && r < 0.57);
    if (ring) return dark ? [200, 36, 40] : [30, 140, 70];
    return dark ? [28, 28, 30] : [232, 220, 194];
  });
  return pixelTexture(size, size, pixels);
}

/** Seven-segment digit test, for the framed shirt number. */
function sevenSegment(digit: number, x: number, y: number): boolean {
  const on: Record<number, string> = { 2: 'abged', 3: 'abgcd' };
  const s = 0.2;
  const seg = (name: string) => {
    switch (name) {
      case 'a': return y < s && x > 0 && x < 1;
      case 'g': return Math.abs(y - 1) < s / 2 && x > 0 && x < 1;
      case 'd': return y > 2 - s && x > 0 && x < 1;
      case 'b': return x > 1 - s && y < 1;
      case 'c': return x > 1 - s && y > 1;
      case 'e': return x < s && y > 1;
      default: return x < s && y < 1;
    }
  };
  if (x < 0 || x > 1 || y < 0 || y > 2) return false;
  return [...on[digit]].some(seg);
}

/** A framed shirt: cream with a red number 23 on charcoal. */
function shirtTexture(size = 256): DataTexture {
  const pixels = paintImage(size, size, (u, v) => {
    const body = u > 0.3 && u < 0.7 && v > 0.26 && v < 0.9;
    const sleeves = v > 0.26 && v < 0.44 && ((u > 0.16 && u < 0.3) || (u > 0.7 && u < 0.84));
    const neck = v < 0.34 && Math.abs(u - 0.5) < (0.34 - v) * 0.9 + 0.02;
    if (!(body || sleeves) || neck) return [42, 44, 50];
    const digit = u < 0.5 ? 2 : 3;
    const dx = ((u < 0.5 ? u - 0.355 : u - 0.515) / 0.13);
    const dy = (v - 0.47) / 0.16;
    if (sevenSegment(digit, dx, dy)) return [186, 38, 48];
    return [236, 231, 220];
  });
  return pixelTexture(size, size, pixels);
}

/** Soft round glow, white with falling alpha; tinted by the material. */
function glowTexture(size = 128): DataTexture {
  const pixels = paintImage(size, size, (u, v) => {
    const r = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
    return [255, 255, 255, 255 * (1 - r) * (1 - r)];
  });
  return pixelTexture(size, size, pixels);
}

/** Evening sky for the fake window: deep blue above, warm at the bottom. */
function duskTexture(): DataTexture {
  const pixels = paintImage(8, 64, (_u, v) => {
    const t = v;
    return [60 + (240 - 60) * t, 70 + (150 - 70) * t, 130 + (110 - 130) * t];
  });
  return pixelTexture(8, 64, pixels);
}

/**
 * The view from the window: a calm dusk after the sun has gone. Deep blue
 * overhead fading to lavender, long violet-pink cloud bands catching the last
 * light, a thin peach glow on the horizon, and dark low land below. Muted on
 * purpose: it is ambience, not a light source. Painted once; v = 0 is the top.
 * From the seat the window shows about u 0.36 to 0.62 and v 0.17 to 0.8.
 */
function sunsetTexture(width = 512, height = 256): DataTexture {
  const cloudBroad = valueNoise(61, 10);
  const cloudFine = valueNoise(67, 40);
  const ridge = valueNoise(71, 9);
  const ridgeFine = valueNoise(73, 40);
  const horizon = 0.6;
  const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * Math.min(1, Math.max(0, t)));
  const stops = [
    [0, [30, 40, 82]],
    [0.22, [58, 72, 128]],
    [0.4, [104, 100, 156]],
    [0.52, [168, 128, 160]],
    [0.6, [214, 156, 140]],
  ] as const;
  const sky = (v: number) => {
    for (let i = 1; i < stops.length; i += 1) {
      if (v <= stops[i][0]) return mix([...stops[i - 1][1]], [...stops[i][1]], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return [...stops[stops.length - 1][1]];
  };
  const pixels = paintImage(width, height, (u, v) => {
    // Low land: a soft ridge line, then flat dark ground with a faint haze.
    const ridgeTop = horizon - 0.025 - 0.035 * ridge(u, 0.4) - 0.008 * ridgeFine(u, 0.7);
    if (v > ridgeTop) {
      const depth = Math.min(1, (v - ridgeTop) / 0.3);
      const c = mix([58, 54, 84], [24, 26, 38], depth);
      return [c[0], c[1], c[2]];
    }
    let c = sky(v);
    // Where the sun went down: a wide, faint warmth just above the land.
    const warm = Math.exp(-Math.hypot((u - 0.48) * 2.2, (v - horizon) * 7)) * 0.35;
    c = mix(c, [236, 176, 146], warm);
    // Long thin cloud bands, stretched sideways, brightest near the horizon.
    const band = 0.65 * cloudBroad(u * 0.8, v * 2.4) + 0.35 * cloudFine(u * 1.6, v * 5);
    const height = Math.max(0, 1 - Math.abs(v - 0.4) * 3.6);
    const amount = Math.min(0.85, Math.max(0, band - 0.44) * 4.2 * height);
    const lit = mix([110, 92, 150], [226, 150, 168], (v - 0.22) / 0.32);
    c = mix(c, lit, amount);
    return [c[0], c[1], c[2]];
  });
  return pixelTexture(width, height, pixels);
}

/** One tile of light wooden boards, for the shuffleboard top. */
function boardTexture(size = 256): DataTexture {
  const random = makeRandom(41);
  const tones = Array.from({ length: 6 }, () => 0.9 + random() * 0.18);
  const grain = valueNoise(43, 64);
  const pixels = paintImage(size, size, (u, v) => {
    const b = Math.min(5, Math.floor(u * 6));
    const edge = Math.min(u * 6 - b, b + 1 - u * 6) * (size / 6);
    const k = tones[b] * (0.92 + 0.12 * grain(u * 0.2, v)) * (edge < 1 ? 0.7 : 1);
    return [222 * k, 184 * k, 128 * k];
  });
  return pixelTexture(size, size, pixels, true);
}

const solid = (id: string, color: `#${string}`, roughness = 0.85, metalness = 0): Material =>
  createSceneMaterial({ id, model: 'standard', baseColor: color, roughness, metalness });

/** Lit from inside: emissive plus color, for lamps, LEDs and screens. */
const lamp = (color: `#${string}`): Material => new MeshBasicMaterial({ color });

const glowMap = glowTexture();
/** Additive light pool on a wall or floor, tinted. */
const pool = (color: `#${string}`, opacity: number): Material =>
  new MeshBasicMaterial({
    map: glowMap,
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

const floorMap = concreteTexture();
floorMap.repeat.set((LOFT.halfWidth * 2) / 3, (LOFT.front - LOFT.back) / 3);
const floorMat = new MeshStandardMaterial({ map: floorMap, roughness: 0.34 });

const wallMap = wallTexture();
/**
 * Walls carry some light of their own: the key light is overhead, so upright
 * surfaces would otherwise sit in the dark; this stands in for bounce light.
 */
const wallMat = new MeshStandardMaterial({
  map: wallMap,
  roughness: 0.9,
  emissive: '#ffffff',
  emissiveMap: wallMap,
  emissiveIntensity: 0.16,
});
const deckMat = solid('loft-deck', '#55585E', 0.9);
const steel = solid('loft-steel', '#25272B', 0.5, 0.4);
const steelLight = solid('loft-steel-light', '#8E9297', 0.45, 0.5);
const jamb = solid('loft-jamb', '#3C3F45', 0.7);
const doorPaint = solid('loft-door', '#C7C1B6', 0.6);
const ledMat = lamp('#FFF1DC');
const duskMat = new MeshBasicMaterial({ map: duskTexture() });
const sunsetMat = new MeshBasicMaterial({ map: sunsetTexture() });
const sconceGlow = pool('#FFB45E', 0.7);
const sconceMetal = solid('loft-sconce', '#2A2A2C', 0.4, 0.6);
const bulb = lamp('#FFE2B0');
const frameBlack = solid('loft-frame-black', '#16171A', 0.5);
const dartMap = dartboardTexture();
const dartMat = new MeshStandardMaterial({
  map: dartMap,
  roughness: 0.8,
  emissive: '#ffffff',
  emissiveMap: dartMap,
  emissiveIntensity: 0.3,
});
const shirtMat = new MeshStandardMaterial({ map: shirtTexture(), roughness: 0.85 });

function box(
  size: [number, number, number],
  material: Material,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  return mesh;
}

/** Soft-edged block (cushions, leather, cabinets). */
function soft(
  size: [number, number, number],
  radius: number,
  material: Material,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): Mesh {
  const mesh = createScenePrimitiveObject(
    { geometry: { type: 'roundedBox', size, radius, segments: 3 } },
    material,
  );
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  return mesh;
}

function cylinder(r: number, h: number, material: Material, x: number, y: number, z: number, segments = 16): Mesh {
  const mesh = new Mesh(new CylinderGeometry(r, r, h, segments), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A flat plane facing +Z (rotate the holder to face elsewhere). */
function plane(w: number, h: number, material: Material, x: number, y: number, z: number, rotY = 0): Mesh {
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  return mesh;
}

/** Wall lamp: a dark cone shade over a warm bulb, and its light pool on the wall. */
function sconce(x: number, y: number, z: number, rotY: number): Group {
  const lampGroup = new Group();
  lampGroup.position.set(x, y, z);
  lampGroup.rotation.y = rotY;
  const arm = box([0.03, 0.03, 0.16], sconceMetal, 0, 0.02, 0.08);
  const shade = new Mesh(new ConeGeometry(0.11, 0.13, 20, 1, true), sconceMetal);
  shade.position.set(0, 0, 0.17);
  const light = new Mesh(new SphereGeometry(0.045, 12, 8), bulb);
  light.position.set(0, -0.04, 0.17);
  const glow = plane(1.6, 1.6, sconceGlow, 0, -0.1, 0.012);
  lampGroup.add(arm, shade, light, glow);
  return lampGroup;
}

/**
 * Floor, walls (the back one with the roll-up door opening), roof deck,
 * trusses with linear lights, wall lamps, dartboard, framed shirt, a steel
 * side door, and the street outside at dusk.
 */
export function createLoftShell(): Group {
  const { halfWidth: W, back: B, front: F, height: H, wall: T, doorLeft: DL, doorRight: DR, doorTop: DT, sill: S } = LOFT;
  const depth = F - B;
  const midZ = (F + B) / 2;
  const room = new Group();
  room.name = 'loft';

  const floor = plane(W * 2, depth, floorMat, 0, 0, midZ);
  floor.rotation.x = -Math.PI / 2;
  const deck = plane(W * 2, depth, deckMat, 0, H, midZ);
  deck.rotation.x = Math.PI / 2;
  room.add(floor, deck);

  // Walls. Panels are 3 m wide: UV repeat follows each wall's size.
  const wallPiece = (w: number, h: number, x: number, y: number, z: number, rotY: number) => {
    const mesh = plane(w, h, wallMat, x, y, z, rotY);
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (w / 3), uv.getY(i) * (h / H));
    return mesh;
  };
  room.add(
    wallPiece(depth, H, -W, H / 2, midZ, Math.PI / 2),
    wallPiece(depth, H, W, H / 2, midZ, -Math.PI / 2),
    wallPiece(W * 2, H, 0, H / 2, F, Math.PI),
    wallPiece(DL + W, H, (DL - W) / 2, H / 2, B, 0),
    wallPiece(W - DR, H, (W + DR) / 2, H / 2, B, 0),
    wallPiece(DR - DL, H - DT, (DL + DR) / 2, (H + DT) / 2, B, 0),
    wallPiece(DR - DL, S, (DL + DR) / 2, S / 2, B, 0),
  );
  // Pilasters along the side walls, slightly proud of the panels.
  for (const z of [-5, -2, 1]) {
    room.add(box([0.12, H, 0.42], wallMat, -W + 0.06, H / 2, z), box([0.12, H, 0.42], wallMat, W - 0.06, H / 2, z));
  }

  // Window: a black steel frame with a 3 x 3 grid of panes, a deep sill,
  // and the faint dusk light it lets onto the floor.
  const winMid = (DL + DR) / 2;
  const winW = DR - DL;
  const winH = DT - S;
  const winY = (DT + S) / 2;
  const bar = 0.05;
  room.add(
    box([0.1, winH + 0.1, T + 0.06], frameBlack, DL - 0.05, winY, B),
    box([0.1, winH + 0.1, T + 0.06], frameBlack, DR + 0.05, winY, B),
    box([winW + 0.2, 0.1, T + 0.06], frameBlack, winMid, DT + 0.05, B),
    box([winW + 0.36, 0.05, 0.32], woodMid, winMid, S - 0.025, B + 0.1),
  );
  for (let i = 1; i < 3; i += 1) {
    room.add(box([bar, winH, bar], frameBlack, DL + (winW * i) / 3, winY, B));
    room.add(box([winW, bar, bar], frameBlack, winMid, S + (winH * i) / 3, B));
  }
  const sunlight = plane(winW * 1.25, 3.4, pool('#B892B8', 0.12), winMid + 0.3, 0.007, B + 2.2);
  sunlight.rotation.x = -Math.PI / 2;
  sunlight.rotation.z = -0.25;
  room.add(sunlight);

  // Steel side door with a narrow glass panel, and its frame.
  room.add(
    box([1.04, 2.26, 0.06], jamb, -0.75, 1.13, B + 0.02),
    box([0.92, 2.16, 0.05], doorPaint, -0.75, 1.08, B + 0.05),
    plane(0.16, 0.7, duskMat, -0.5, 1.5, B + 0.08),
    box([0.03, 0.18, 0.05], steel, -1.08, 1.05, B + 0.1),
  );

  // Trusses across the room, purlins along it, and long warm LED bars.
  const chordY = H - 0.75;
  for (const z of [-5.6, -3.6, -1.6, 0.4, 2.4]) {
    room.add(box([W * 2, 0.08, 0.14], steel, 0, chordY, z), box([W * 2, 0.08, 0.14], steel, 0, H - 0.12, z));
    for (let x = -W + 0.5; x < W; x += 1) {
      room.add(box([0.05, 0.55, 0.05], steel, x, chordY + 0.3, z));
      const diagonal = box([0.04, 1.14, 0.04], steel, x + 0.5, chordY + 0.3, z);
      diagonal.rotation.z = Math.atan2(1, 0.55) * (Math.round(x) % 2 === 0 ? 1 : -1);
      room.add(diagonal);
    }
  }
  for (const x of [-3.2, 0, 3.2]) room.add(box([0.1, 0.12, depth], steel, x, H - 0.2, midZ));
  for (const [x, z] of [[-2.2, -3.4], [2.2, -3.4], [0, -0.6], [-2.2, 1.6], [2.2, 1.6]] as const) {
    room.add(box([0.08, 0.05, 2.4], ledMat, x, chordY - 0.12, z), box([0.012, 0.32, 0.012], steel, x, chordY + 0.05, z - 1.1), box([0.012, 0.32, 0.012], steel, x, chordY + 0.05, z + 1.1));
  }

  // Wall lamps with warm pools, the dartboard and the framed shirt.
  room.add(
    sconce(-W, 2.6, -4.4, Math.PI / 2),
    sconce(-W, 2.6, -1.0, Math.PI / 2),
    sconce(DL - 0.55, 2.8, B, 0),
    sconce(W - 0.45, 2.8, B, 0),
    sconce(W, 2.75, -1.8, -Math.PI / 2),
  );
  const dart = new Mesh(new CircleGeometry(0.28, 48), dartMat);
  // In front of its black backing disc, which reaches x = -W + 0.035.
  dart.position.set(-W + 0.045, 1.73, -4.4);
  dart.rotation.y = Math.PI / 2;
  room.add(dart, cylinder(0.3, 0.04, frameBlack, -W + 0.015, 1.73, -4.4, 40));
  room.children[room.children.length - 1].rotation.z = Math.PI / 2;
  room.add(box([0.72, 0.92, 0.04], frameBlack, 0.45, 2.15, B + 0.02), plane(0.62, 0.82, shirtMat, 0.45, 2.15, B + 0.045));

  // Outside: a painted sunset far beyond the window. One unlit picture, big
  // enough to fill the window from anywhere in the room.
  room.add(plane(30, 12, sunsetMat, -8, 3, B - 12));

  return mergeByMaterial(room);
}

const leather = solid('loft-leather', '#5C3A27', 0.55);
const leatherDark = solid('loft-leather-dark', '#43291C', 0.6);
const woodDark = solid('loft-wood-dark', '#3E2C21', 0.7);
const woodMid = solid('loft-wood-mid', '#7B5636', 0.65);
const blackMetal = solid('loft-black-metal', '#1B1C1F', 0.45, 0.5);
const rugMat = new MeshStandardMaterial({ map: rugTexture(), roughness: 1 });
const candle = lamp('#FFD08A');
const ceramic = solid('loft-ceramic', '#E8E2D6', 0.4);

/** A sofa run of `seats` cushions, back along local -Z, facing +Z. */
function sofa(seats: number, material: Material, dark: Material): Group {
  const sofaGroup = new Group();
  const seatW = 0.78;
  const width = seats * seatW;
  sofaGroup.add(
    soft([width + 0.36, 0.3, 0.98], 0.06, dark, 0, 0.2, 0),
    soft([width + 0.36, 0.56, 0.24], 0.08, material, 0, 0.62, -0.38),
    soft([0.2, 0.44, 0.96], 0.07, material, -width / 2 - 0.08, 0.5, 0),
    soft([0.2, 0.44, 0.96], 0.07, material, width / 2 + 0.08, 0.5, 0),
  );
  for (let i = 0; i < seats; i += 1) {
    const x = (i - (seats - 1) / 2) * seatW;
    sofaGroup.add(soft([seatW - 0.03, 0.14, 0.72], 0.05, material, x, 0.42, 0.08));
    sofaGroup.add(soft([seatW - 0.05, 0.4, 0.16], 0.06, material, x, 0.72, -0.24));
  }
  return sofaGroup;
}

/**
 * The lounge, in front of the big screen: a long leather sofa with its back
 * to the player, a second one along the right wall, a recliner, a rug, a
 * coffee table with a tray and candles, and a side table.
 */
export function createLounge(): Group {
  const lounge = new Group();
  lounge.name = 'lounge';
  const rug = plane(3.4, 2.5, rugMat, 2.55, 0.006, -4.35);
  rug.rotation.x = -Math.PI / 2;
  lounge.add(rug);

  // Long sofa faces the screen (-Z): its back is toward the player.
  const main = sofa(3, leather, leatherDark);
  main.position.set(2.5, 0, -2.95);
  main.rotation.y = Math.PI;
  const side = sofa(3, leather, leatherDark);
  side.position.set(4.45, 0, -4.35);
  side.rotation.y = -Math.PI / 2;
  lounge.add(main, side);

  // Recliner, angled toward the screen.
  const recliner = sofa(1, leatherDark, leatherDark);
  recliner.position.set(0.85, 0, -4.55);
  recliner.rotation.y = 2.4;
  lounge.add(recliner);

  // Coffee table: dark wood top on black legs, a tray, three candles.
  lounge.add(soft([1.3, 0.07, 0.72], 0.02, woodDark, 2.55, 0.42, -4.4));
  for (const [dx, dz] of [[-0.58, -0.3], [0.58, -0.3], [-0.58, 0.3], [0.58, 0.3]] as const) {
    lounge.add(box([0.04, 0.4, 0.04], blackMetal, 2.55 + dx, 0.2, -4.4 + dz));
  }
  lounge.add(soft([0.5, 0.03, 0.32], 0.01, blackMetal, 2.5, 0.47, -4.42));
  for (const [dx, h] of [[-0.14, 0.12], [0, 0.17], [0.14, 0.09]] as const) {
    lounge.add(cylinder(0.035, h, ceramic, 2.5 + dx, 0.485 + h / 2, -4.42, 12));
    lounge.add(cylinder(0.008, 0.025, candle, 2.5 + dx, 0.485 + h + 0.012, -4.42, 6));
  }
  // Side table by the recliner.
  lounge.add(cylinder(0.24, 0.04, woodDark, 0.25, 0.55, -5.25, 24), cylinder(0.03, 0.53, blackMetal, 0.25, 0.27, -5.25, 8), cylinder(0.18, 0.02, blackMetal, 0.25, 0.01, -5.25, 20));
  return mergeByMaterial(lounge);
}

const bezel = solid('loft-bezel', '#0E0F11', 0.35, 0.3);
const screenMat = new MeshBasicMaterial({ map: screenTexture() });
const speakerCloth = solid('loft-speaker', '#1C1D21', 0.95);
const tvSpill = pool('#7F86FF', 0.16);

/**
 * The big screen on the back wall, right of center, with tall speakers on
 * each side, a low console and a soundbar.
 */
export function createMediaWall(): Group {
  const { back: B } = LOFT;
  const media = new Group();
  media.name = 'media-wall';
  const cx = 2.6;
  const cy = 1.9;
  media.add(
    box([2.76, 1.58, 0.07], bezel, cx, cy, B + 0.06),
    plane(2.66, 1.5, screenMat, cx, cy, B + 0.096),
    box([0.24, 0.92, 0.16], speakerCloth, cx - 1.65, cy, B + 0.1),
    box([0.24, 0.92, 0.16], speakerCloth, cx + 1.65, cy, B + 0.1),
    box([1.0, 0.08, 0.1], speakerCloth, cx, 0.62, B + 0.36),
    soft([2.6, 0.5, 0.46], 0.02, woodDark, cx, 0.25, B + 0.25),
    box([2.5, 0.02, 0.02], blackMetal, cx, 0.36, B + 0.485),
  );
  // Screen light falling on the floor in front of it.
  const spill = plane(3.6, 2.2, tvSpill, cx, 0.008, B + 1.4);
  spill.rotation.x = -Math.PI / 2;
  media.add(spill);
  return mergeByMaterial(media);
}

const fridgeGlow = lamp('#BFE4FF');
const canBlue = solid('loft-can-blue', '#2E6FD8', 0.35, 0.5);
const canRed = solid('loft-can-red', '#D8473A', 0.35, 0.5);
const bottleAmber = solid('loft-bottle-amber', '#9A5B22', 0.15);
const bottleGreen = solid('loft-bottle-green', '#2F6E48', 0.15);
const bottleClear = solid('loft-bottle-clear', '#C9D6DA', 0.12);
const leaf = solid('loft-leaf', '#4F9A5E', 0.75);
const potMat = solid('loft-pot', '#2B2C30', 0.6);

function bottle(material: Material, x: number, y: number, z: number, h: number): Mesh[] {
  return [cylinder(0.04, h, material, x, y + h / 2, z, 10), cylinder(0.015, h * 0.35, material, x, y + h + h * 0.17, z, 8)];
}

function pottedPlant(x: number, y: number, z: number, scale: number): Mesh[] {
  const parts: Mesh[] = [cylinder(0.09 * scale, 0.14 * scale, potMat, x, y + 0.07 * scale, z, 14)];
  for (let i = 0; i < 6; i += 1) {
    const blade = new Mesh(new SphereGeometry(1, 8, 6), leaf);
    const a = i * 1.05;
    blade.scale.set(0.035 * scale, 0.16 * scale, 0.02 * scale);
    blade.position.set(x + Math.cos(a) * 0.05 * scale, y + 0.24 * scale, z + Math.sin(a) * 0.05 * scale);
    blade.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    parts.push(blade);
  }
  return parts;
}

/**
 * A drinks bar on the right wall: dark cabinet with a glass-front fridge of
 * cans, and a wall shelf with bottles and small plants. The trophy shelf
 * hangs between the cabinet and this shelf.
 */
export function createBar(): Group {
  const W = LOFT.halfWidth;
  const bar = new Group();
  bar.name = 'bar';
  const x = W - 0.27;
  bar.add(
    soft([0.52, 0.92, 1.9], 0.02, woodDark, x, 0.46, -1.8),
    box([0.56, 0.04, 1.96], woodMid, x - 0.01, 0.94, -1.8),
    box([0.02, 0.7, 0.62], fridgeGlow, x - 0.27, 0.43, -1.25),
    box([0.03, 0.74, 0.03], blackMetal, x - 0.285, 0.43, -0.93),
  );
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 5; i += 1) {
      bar.add(cylinder(0.03, 0.11, (i + row) % 3 === 0 ? canRed : canBlue, x - 0.18, 0.16 + row * 0.22, -1.48 + i * 0.11, 10));
    }
  }
  bar.add(...bottle(bottleAmber, x - 0.05, 0.96, -2.5, 0.22), ...bottle(bottleClear, x - 0.05, 0.96, -2.38, 0.26), ...pottedPlant(x - 0.05, 0.96, -2.12, 1));
  // Upper shelf.
  bar.add(box([0.26, 0.035, 1.9], woodMid, W - 0.13, 2.38, -1.8));
  const shelfItems: [Material, number][] = [[bottleGreen, 0.24], [bottleAmber, 0.2], [bottleClear, 0.27], [bottleAmber, 0.22]];
  shelfItems.forEach(([material, h], i) => bar.add(...bottle(material, W - 0.13, 2.4, -2.55 + i * 0.16, h)));
  bar.add(...pottedPlant(W - 0.13, 2.4, -1.6, 1.1), ...pottedPlant(W - 0.13, 2.4, -1.05, 0.9));
  return mergeByMaterial(bar);
}

const feltGreen = solid('loft-felt', '#2F8A4C', 0.9);
const lineWhite = lamp('#E8EEE6');
const rodMetal = solid('loft-rod', '#B9BDC2', 0.3, 0.8);
const teamRed = solid('loft-team-red', '#C7372F', 0.5);
const teamBlue = solid('loft-team-blue', '#2C5BB8', 0.5);
const handle = solid('loft-handle', '#141416', 0.6);
const boardMap = boardTexture();
boardMap.repeat.set(1, 3);
const boardTop = new MeshStandardMaterial({ map: boardMap, roughness: 0.25 });

/** Foosball table, long side along X, centered on (x, z). */
function foosball(x: number, z: number): Mesh[] {
  const parts: Mesh[] = [
    soft([1.42, 0.26, 0.78], 0.02, woodDark, x, 0.78, z),
    box([1.3, 0.01, 0.66], feltGreen, x, 0.84, z),
    box([0.012, 0.012, 0.66], lineWhite, x, 0.846, z),
    box([0.08, 0.66, 0.08], woodDark, x - 0.62, 0.33, z - 0.3),
    box([0.08, 0.66, 0.08], woodDark, x + 0.62, 0.33, z - 0.3),
    box([0.08, 0.66, 0.08], woodDark, x - 0.62, 0.33, z + 0.3),
    box([0.08, 0.66, 0.08], woodDark, x + 0.62, 0.33, z + 0.3),
  ];
  const rods = 8;
  for (let i = 0; i < rods; i += 1) {
    const rx = x - 0.56 + i * 0.16;
    const team = i % 2 === 0 ? teamRed : teamBlue;
    const rod = cylinder(0.01, 1.18, rodMetal, rx, 0.9, z, 8);
    rod.rotation.x = Math.PI / 2;
    const grip = cylinder(0.022, 0.14, handle, rx, 0.9, z + (i % 2 === 0 ? 0.62 : -0.62), 10);
    grip.rotation.x = Math.PI / 2;
    parts.push(rod, grip);
    const players = [1, 2, 3, 2, 3, 2, 3, 1][i];
    for (let p = 0; p < players; p += 1) {
      const pz = z + (p - (players - 1) / 2) * 0.18;
      parts.push(box([0.035, 0.1, 0.05], team, rx, 0.88, pz), cylinder(0.022, 0.03, team, rx, 0.945, pz, 8));
    }
  }
  return parts;
}

/** Shuffleboard table, long side along Z, centered on (x, z). */
function shuffleboard(x: number, z: number): Mesh[] {
  const length = 3.6;
  const parts: Mesh[] = [
    box([0.62, 0.12, length], woodDark, x, 0.74, z),
    box([0.5, 0.02, length - 0.1], boardTop, x, 0.81, z),
    box([0.06, 0.1, length], woodMid, x - 0.31, 0.82, z),
    box([0.06, 0.1, length], woodMid, x + 0.31, 0.82, z),
  ];
  for (const dz of [-1.4, 0, 1.4]) {
    parts.push(box([0.5, 0.68, 0.1], woodDark, x, 0.34, z + dz));
  }
  for (const [dz, team] of [[-1.55, teamRed], [-1.47, teamBlue], [-1.35, teamRed]] as const) {
    parts.push(cylinder(0.03, 0.02, team, x + (dz === -1.47 ? 0.08 : -0.05), 0.83, z + dz, 16));
  }
  return parts;
}

/** Foosball on the left, shuffleboard along the right side, near the player. */
export function createGameTables(): Group {
  const tables = new Group();
  tables.name = 'game-tables';
  tables.add(...foosball(-2.5, -2.4), ...shuffleboard(3.55, -0.1));
  return mergeByMaterial(tables);
}
