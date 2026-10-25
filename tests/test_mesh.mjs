import assert from "node:assert/strict";
import {
  parseOBJ,
  parseSTL,
  parsePLY,
  parseOFF,
  parseGLTF,
  parseGLB,
  makeExample,
  smooth,
  brushSmooth,
  brushSmoothInPlace,
  pickRay,
  stats,
  simplify,
  exportOBJ,
  exportSTL,
  exportPLY,
  cloneMesh,
  bounds,
} from "../mesh-core.js";
const obj = `# test\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n`;
const q = parseOBJ(obj, "quad.obj");
assert.equal(q.indices.length / 3, 2);
assert.equal(stats(q).vertices, 4);
const ascii = `solid sample\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid sample\n`;
assert.equal(
  parseSTL(new TextEncoder().encode(ascii).buffer).indices.length / 3,
  1,
);
const binary = await exportSTL(q).arrayBuffer(),
  round = parseSTL(binary, "round.stl");
assert.equal(round.indices.length / 3, 2);
assert.equal(stats(round).vertices, 4);
const objOut = exportOBJ(q),
  objAgain = parseOBJ(await objOut.text(), "round.obj");
assert.equal(objAgain.indices.length / 3, 2);
const plyAscii = `ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2\n3 0 2 3\n`;
const plyMesh = parsePLY(new TextEncoder().encode(plyAscii).buffer);
assert.equal(plyMesh.indices.length / 3, 2);
const plyRound = parsePLY(await exportPLY(q).arrayBuffer());
assert.equal(plyRound.indices.length / 3, 2);
const plyHead = new TextEncoder().encode(
  "ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
);
const plyBin = new ArrayBuffer(plyHead.length + 3 * 12 + 1 + 3 * 4);
new Uint8Array(plyBin, 0, plyHead.length).set(plyHead);
const pv = new DataView(plyBin);
let po = plyHead.length;
for (const n of [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  pv.setFloat32(po, n, true);
  po += 4;
}
pv.setUint8(po++, 3);
for (const n of [0, 1, 2]) {
  pv.setInt32(po, n, true);
  po += 4;
}
assert.equal(parsePLY(plyBin).indices.length / 3, 1);
const beHeader = new TextEncoder().encode(
    "ply\nformat binary_big_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
  ),
  beBuf = new ArrayBuffer(beHeader.length + 49);
new Uint8Array(beBuf, 0, beHeader.length).set(beHeader);
const beView = new DataView(beBuf);
let beOff = beHeader.length;
for (const n of [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  beView.setFloat32(beOff, n, false);
  beOff += 4;
}
beView.setUint8(beOff++, 3);
for (const n of [0, 1, 2]) {
  beView.setInt32(beOff, n, false);
  beOff += 4;
}
assert.equal(parsePLY(beBuf).indices.length / 3, 1);
const points = parsePLY(
  new TextEncoder().encode(
    "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n",
  ).buffer,
  "points.ply",
);
assert.equal(points.indices.length, 0);
assert.equal(points.pointCloud, true);
assert.equal(
  parsePLY(await exportPLY(points).arrayBuffer(), "points-export.ply").positions
    .length,
  points.positions.length,
);
const off = parseOFF("OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n");
assert.equal(off.indices.length / 3, 2);
const raw = new ArrayBuffer(60),
  rv = new DataView(raw);
for (let i = 0; i < 12; i++)
  rv.setFloat32(i * 4, [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0][i], true);
for (let i = 0; i < 6; i++)
  rv.setUint16(48 + i * 2, [0, 1, 2, 0, 2, 3][i], true);
const base64 = Buffer.from(raw).toString("base64");
const gltfDoc = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, translation: [2, 0, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: [
    { byteLength: 60, uri: `data:application/octet-stream;base64,${base64}` },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 48 },
    { buffer: 0, byteOffset: 48, byteLength: 12 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
    { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
  ],
};
const gltfMesh = await parseGLTF(JSON.stringify(gltfDoc), "quad.gltf");
assert.equal(gltfMesh.indices.length / 3, 2);
assert.equal(bounds(gltfMesh).min[0], 2);
const externalDoc = structuredClone(gltfDoc);
externalDoc.buffers[0].uri = "mesh.bin";
const externalMesh = await parseGLTF(JSON.stringify(externalDoc), "quad.gltf", [
  { name: "mesh.bin", arrayBuffer: async () => raw },
]);
assert.equal(externalMesh.indices.length / 3, 2);
const glbDoc = { ...gltfDoc, buffers: [{ byteLength: 60 }] };
const jsonBytes = new TextEncoder().encode(JSON.stringify(glbDoc));
const padded = (jsonBytes.length + 3) & ~3;
const total = 12 + 8 + padded + 8 + 60;
const glb = new ArrayBuffer(total),
  gv = new DataView(glb);
gv.setUint32(0, 0x46546c67, true);
gv.setUint32(4, 2, true);
gv.setUint32(8, total, true);
gv.setUint32(12, padded, true);
gv.setUint32(16, 0x4e4f534a, true);
new Uint8Array(glb, 20, jsonBytes.length).set(jsonBytes);
new Uint8Array(glb, 20 + jsonBytes.length, padded - jsonBytes.length).fill(
  0x20,
);
let go = 20 + padded;
gv.setUint32(go, 60, true);
gv.setUint32(go + 4, 0x004e4942, true);
new Uint8Array(glb, go + 8, 60).set(new Uint8Array(raw));
const glbMesh = await parseGLB(glb, "quad.glb");
assert.equal(glbMesh.indices.length / 3, 2);
assert.equal(bounds(glbMesh).min[0], 2);

const model = makeExample(),
  before = cloneMesh(model),
  sm = smooth(model, { strength: 0.45, iterations: 3 });
assert.equal(sm.indices.length, model.indices.length);
assert.ok(
  sm.positions.some((v, i) => Math.abs(v - before.positions[i]) > 1e-7),
);
assert.deepEqual([...model.positions], [...before.positions]);
function roughness(m) {
  const adj = Array.from({ length: m.positions.length / 3 }, () => new Set());
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = m.indices.slice(i, i + 3);
    for (const [u, v] of [
      [a, b],
      [a, c],
      [b, a],
      [b, c],
      [c, a],
      [c, b],
    ])
      adj[u].add(v);
  }
  let total = 0;
  for (let i = 0; i < adj.length; i++) {
    const ns = adj[i];
    if (!ns.size) continue;
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      let avg = 0;
      for (const j of ns) avg += m.positions[j * 3 + k] / ns.size;
      sum += (avg - m.positions[i * 3 + k]) ** 2;
    }
    total += sum;
  }
  return Math.sqrt(total / adj.length);
}
assert.ok(
  roughness(sm) < roughness(model),
  "сглаживание должно уменьшать локальную шероховатость",
);
const b0 = bounds(model),
  b1 = bounds(sm);
for (let k = 0; k < 3; k++)
  assert.ok(
    Math.abs(b1.size[k] - b0.size[k]) / b0.size[k] < 0.05,
    "габариты не должны заметно измениться на тестовом шаре",
  );
const brush = brushSmooth(model, [0, 1, 0], { radius: 0.35, strength: 0.7 });
assert.ok(brush.changed > 0);
for (let i = 0; i < model.positions.length; i += 3) {
  const d = Math.hypot(
    model.positions[i],
    model.positions[i + 1] - 1,
    model.positions[i + 2],
  );
  if (d > 0.35)
    assert.deepEqual(
      [...brush.mesh.positions.slice(i, i + 3)],
      [...model.positions.slice(i, i + 3)],
    );
}
const inPlaceMesh = cloneMesh(model),
  inPlaceBefore = new Float32Array(inPlaceMesh.positions),
  inPlaceBrush = brushSmoothInPlace(inPlaceMesh, [0, 1, 0], {
    radius: 0.35,
    strength: 0.7,
    preserveBoundary: false,
  });
assert.ok(inPlaceBrush.changed > 0);
assert.ok(inPlaceMesh.positions.some((v, i) => v !== inPlaceBefore[i]));
const rayHit = pickRay(q, [0.5, 0.5, 1], [0, 0, -1]);
assert.ok(rayHit);
assert.ok(Math.abs(rayHit[2]) < 1e-6);
const open = q,
  protectedOpen = smooth(open, {
    strength: 0.8,
    iterations: 2,
    preserveBoundary: true,
  });
assert.deepEqual([...protectedOpen.positions], [...open.positions]);
const target = Math.floor((model.indices.length / 3) * 0.45),
  reduced = simplify(model, target);
assert.ok(reduced.indices.length / 3 < model.indices.length / 3);
assert.ok(reduced.indices.length / 3 >= 4);
assert.ok(
  Math.abs(reduced.indices.length / 3 - target) < Math.max(20, target * 0.04),
);
assert.equal(reduced.unchanged, false);
for (const v of reduced.positions) assert.ok(Number.isFinite(v));
const angleProtected = simplify(model, target, {
  minAngle: 179,
  maxAngle: 180,
});
assert.equal(
  angleProtected.indices.length,
  model.indices.length,
  "вне углового диапазона сетка не должна упрощаться",
);
assert.equal(angleProtected.unchanged, true);
let rejected = false;
try {
  parseOBJ("v NaN 0 0\nf 1 1 1\n");
} catch {
  rejected = true;
}
assert.ok(rejected);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      checks: [
        "STL ASCII/Binary",
        "OBJ polygon triangulation and export",
        "PLY ASCII/little-endian/big-endian, point clouds and export",
        "OFF import",
        "glTF/GLB 2.0 import with node transform",
        "Taubin-like smoothing reduces measured roughness",
        "smoothing preserves test bounds and source copy",
        "brush falloff modifies only its radius",
        "in-place brush operation and ray picking",
        "open-boundary protection",
        "angle-ranged simplification and protected angular features",
        "non-finite OBJ rejection",
      ],
      sourceTriangles: model.indices.length / 3,
      smoothedRoughness: +roughness(sm).toFixed(6),
      originalRoughness: +roughness(model).toFixed(6),
      simplificationTarget: target,
      simplificationActual: reduced.indices.length / 3,
    },
    null,
    2,
  ),
);
