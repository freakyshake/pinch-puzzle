import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { ShapeKinds, type ShapeKind } from './puzzle-components.js';

/** Shape is the primary cue; colour is a second, redundant cue. */
export const SHAPE_COLORS: Record<ShapeKind, string> = {
  [ShapeKinds.Cube]: '#e9805f',
  [ShapeKinds.Sphere]: '#5fa8e9',
  [ShapeKinds.Cone]: '#f2c14e',
  [ShapeKinds.Torus]: '#b57be0',
  [ShapeKinds.Gem]: '#5fd3a6',
  [ShapeKinds.Cylinder]: '#ef6f9a',
};

/** Pieces are about 8 cm across: large, easy pinch targets. */
export function shapeGeometry(shape: ShapeKind): BufferGeometry {
  switch (shape) {
    case ShapeKinds.Cube:
      return new BoxGeometry(0.07, 0.07, 0.07);
    case ShapeKinds.Sphere:
      return new SphereGeometry(0.042, 20, 14);
    case ShapeKinds.Cone:
      return new ConeGeometry(0.045, 0.085, 20);
    case ShapeKinds.Torus:
      return new TorusGeometry(0.032, 0.014, 10, 28);
    case ShapeKinds.Gem:
      return new OctahedronGeometry(0.048, 0);
    case ShapeKinds.Cylinder:
      return new CylinderGeometry(0.035, 0.035, 0.075, 20);
  }
}

export interface PieceVisual {
  root: Group;
  material: MeshStandardMaterial;
  /** Dark inverted-hull outline, shown in high-contrast mode. */
  outline: Mesh;
}

const outlineMaterial = new MeshBasicMaterial({ color: '#000000', side: BackSide });

export function createPieceVisual(shape: ShapeKind): PieceVisual {
  const color = new Color(SHAPE_COLORS[shape]);
  const material = new MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    emissive: color,
    emissiveIntensity: 0.12,
    flatShading: shape === ShapeKinds.Gem,
  });
  const geometry = shapeGeometry(shape);
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  const outline = new Mesh(geometry, outlineMaterial);
  outline.scale.setScalar(1.16);
  outline.visible = false;
  if (shape === ShapeKinds.Torus) {
    mesh.rotation.x = Math.PI / 2;
    outline.rotation.x = Math.PI / 2;
  }
  const root = new Group();
  root.add(mesh, outline);
  return { root, material, outline };
}

export interface SlotVisual {
  root: Group;
  ring: MeshStandardMaterial;
  ghost: MeshStandardMaterial;
  base: MeshStandardMaterial;
  /** Expanding ring flash played when a piece locks in. */
  burst: Mesh;
  burstMaterial: MeshBasicMaterial;
}

/** A glowing ring on the table with a translucent ghost of the shape above it. */
export function createSlotVisual(shape: ShapeKind, hover: number): SlotVisual {
  const color = new Color(SHAPE_COLORS[shape]);
  const ring = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    roughness: 0.6,
  });
  const ringMesh = new Mesh(new RingGeometry(0.052, 0.066, 40), ring);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.004;

  const base = new MeshStandardMaterial({ color: '#2b2d33', roughness: 0.9 });
  const baseMesh = new Mesh(new CylinderGeometry(0.052, 0.052, 0.004, 40), base);
  baseMesh.position.y = 0.002;

  const ghost = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const ghostMesh = new Mesh(shapeGeometry(shape), ghost);
  ghostMesh.position.y = hover;
  if (shape === ShapeKinds.Torus) ghostMesh.rotation.x = Math.PI / 2;

  const burstMaterial = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const burst = new Mesh(new RingGeometry(0.06, 0.072, 40), burstMaterial);
  burst.rotation.x = -Math.PI / 2;
  burst.position.y = 0.006;
  burst.visible = false;

  const root = new Group();
  root.add(baseMesh, ringMesh, ghostMesh, burst);
  return { root, ring, ghost, base, burst, burstMaterial };
}

export interface PlayMat {
  mesh: Mesh;
  material: MeshStandardMaterial;
}

/** Rounded felt mat that frames the play area on the table top. */
export function createPlayMat(width: number, depth: number, radius: number): PlayMat {
  const w = width / 2;
  const d = depth / 2;
  const r = radius;
  const shape = new Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);
  const material = new MeshStandardMaterial({ color: '#4a5363', roughness: 0.95 });
  const mesh = new Mesh(new ShapeGeometry(shape, 6), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return { mesh, material };
}
