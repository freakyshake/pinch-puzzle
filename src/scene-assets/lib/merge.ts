import {
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Mesh,
} from '@iwsdk/core';

/**
 * Collapses everything under `root` into one mesh per material. Static set
 * pieces are built from many small parts; drawn one by one they dominate the
 * game's draw calls, which a headset pays for twice (once per eye).
 * Positions, normals and UVs are baked in place, so the result looks the
 * same. Only for parts that never move on their own.
 */
export function mergeByMaterial(root: Group): Group {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<Material, BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const baked = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const flat = baked.index ? baked.toNonIndexed() : baked;
    const material = object.material as Material;
    const list = byMaterial.get(material) ?? [];
    list.push(flat);
    byMaterial.set(material, list);
  });
  const merged = new Group();
  merged.name = root.name;
  for (const [material, list] of byMaterial) {
    let count = 0;
    for (const geometry of list) count += geometry.attributes.position.count;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let at = 0;
    for (const geometry of list) {
      const attributes = geometry.attributes;
      position.set(attributes.position.array, at * 3);
      // A part without normals or UVs keeps zeros there.
      if (attributes.normal) normal.set(attributes.normal.array, at * 3);
      if (attributes.uv) uv.set(attributes.uv.array, at * 2);
      at += attributes.position.count;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    const mesh = new Mesh(geometry, material);
    mesh.name = `${root.name}-${material.name || merged.children.length}`;
    merged.add(mesh);
  }
  return merged;
}
