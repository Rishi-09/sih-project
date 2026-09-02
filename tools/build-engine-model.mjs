/**
 * Rebuilds web/public/models/Rotax_915.glb from the source Rotax_915.FBX.
 *
 * Two steps, because nothing in the JS ecosystem reads FBX directly:
 *
 *   npm i fbx2gltf @gltf-transform/cli
 *   ./node_modules/fbx2gltf/bin/Linux/FBX2glTF \
 *       -i Rotax_915.FBX -o rotax_full --binary --pbr-metallic-roughness
 *   node tools/build-engine-model.mjs rotax_full.glb 0.35 0.001 \
 *       web/public/models/Rotax_915.glb
 *
 * The ratio/error defaults take the model from 1.98M to ~741k triangles at
 * 4.7 MB with a worst-case surface deviation of 0.07%. Do NOT raise the error
 * tolerance: an earlier build simplified to 143k triangles and shattered the
 * thin-walled CAD surfaces into a cloud of loose slivers.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const IN = process.argv[2] ?? 'rotax_full.glb';
const RATIO = Number(process.argv[3] ?? 0.35);
const ERROR = Number(process.argv[4] ?? 0.001);
const OUT = process.argv[5] ?? 'rotax_out.glb';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();

// ---- 1. strip scene junk: cameras, backdrop plane, helper spline, animation ----
const DROP = /^(camera|plane001|circle001)/i;
for (const node of root.listNodes()) {
  const n = node.getName() || '';
  if (DROP.test(n)) { node.dispose(); continue; }
}
for (const cam of root.listCameras()) cam.dispose();
for (const anim of root.listAnimations()) anim.dispose();

// ---- 2. measure per-primitive bounds BEFORE ----
function primBounds(prim) {
  const pos = prim.getAttribute('POSITION');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const el = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, el);
    for (let k = 0; k < 3; k++) { if (el[k] < min[k]) min[k] = el[k]; if (el[k] > max[k]) max[k] = el[k]; }
  }
  return { min, max };
}
const before = new Map();
let triBefore = 0;
for (const mesh of root.listMeshes()) {
  for (const [i, prim] of mesh.listPrimitives().entries()) {
    const key = `${mesh.getName()}#${i}#${prim.getMaterial()?.getName()}`;
    before.set(key, primBounds(prim));
    triBefore += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  }
}

// ---- 3. clean + weld + simplify ----
await doc.transform(
  // keepUniqueNames: every metal/hose/pipe material shares the same flat black
  // PBR factors, so a plain dedup collapses 36 named materials into one and
  // destroys the only per-part semantics the model carries.
  dedup({ keepUniqueNames: true }),
  prune({ keepAttributes: false, keepLeaves: false }),
  // CAD tessellation ships split verts everywhere; welding is what makes
  // simplification collapse surfaces instead of shattering them.
  weld({ tolerance: 0.0001 }),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio: RATIO,
    error: ERROR,       // max surface deviation, fraction of mesh extent
    lockBorder: true,   // pin material seams so parts can't tear apart
  }),
);

// ---- 4. compare bounds AFTER (shard artifacts blow the box out) ----
let triAfter = 0, worst = 0, worstKey = '';
const report = [];
for (const mesh of root.listMeshes()) {
  for (const [i, prim] of mesh.listPrimitives().entries()) {
    const key = `${mesh.getName()}#${i}#${prim.getMaterial()?.getName()}`;
    const t = (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    triAfter += t;
    const b0 = before.get(key), b1 = primBounds(prim);
    if (!b0) continue;
    const extent = Math.max(...b0.max.map((v, k) => v - b0.min[k]), 1e-6);
    let drift = 0;
    for (let k = 0; k < 3; k++) {
      drift = Math.max(drift, Math.abs(b1.min[k] - b0.min[k]) / extent, Math.abs(b1.max[k] - b0.max[k]) / extent);
    }
    if (drift > worst) { worst = drift; worstKey = key; }
    report.push({ key, t, drift });
  }
}

console.log(`tris ${triBefore} -> ${triAfter}  (${(100 * triAfter / triBefore).toFixed(1)}%)`);
console.log(`worst bbox drift: ${(worst * 100).toFixed(2)}%  on ${worstKey}`);
console.log('top drifters:');
report.sort((a, b) => b.drift - a.drift).slice(0, 8)
  .forEach(r => console.log(`  ${(r.drift * 100).toFixed(2)}%  tris=${r.t}  ${r.key}`));

// ---- 5. compress ----
await MeshoptEncoder.ready;
await doc.transform(
  quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD)/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

await io.write(OUT, doc);
console.log('wrote', OUT);
