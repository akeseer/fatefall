/**
 * Shared CSS 3D die construction + quaternion math.
 *
 * Both the live DiceTray and the decorative start-screen die build their
 * polyhedra from here: geometry, numbered faces, and the quaternion helpers
 * used to tumble a die and land it on an exact face.
 */

import { DiceType } from '../rules/DiceEvents';

/** Size (px) of each square face box before clipping. */
export const FACE_BOX = 64;
export const FACE_FONT = 24;

export interface DiceFace {
  /** Position in the face list (also the DOM child order). */
  index: number;
  /** The number printed on the face (the rolled result). */
  value: number;
  /** Outward-facing normal in the die's local frame. */
  normal: [number, number, number];
  /** Local right vector (text baseline direction). */
  u: [number, number, number];
  /** Local up vector (glyph-top direction). */
  v: [number, number, number];
  transform: string;
  clip: string;
}

export type Quat = [number, number, number, number]; // [w, x, y, z]

// ── Vector helpers ───────────────────────────────────

export function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize3(v: number[]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ── Quaternion helpers ───────────────────────────────

export function quatFromAxisAngle(axis: number[], angle: number): Quat {
  const [x, y, z] = normalize3(axis);
  const half = angle / 2;
  const s = Math.sin(half);
  return [Math.cos(half), x * s, y * s, z * s];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Rotate a vector by a quaternion (Rodrigues form). */
export function quatRotate(q: Quat, v: number[]): [number, number, number] {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/** Column-major CSS matrix3d for a quaternion rotation. */
export function quatToMatrix3d(q: Quat): string {
  const [w, x, y, z] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  return `matrix3d(${m.join(',')})`;
}

// ── Face geometry ────────────────────────────────────

/** Orient a face (local +Z) along its outward normal via an orthonormal basis. */
function basisFromNormal(n: [number, number, number]): { u: [number, number, number]; v: [number, number, number]; n: [number, number, number] } {
  const ref: [number, number, number] = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize3(cross3(ref, n));
  const v = normalize3(cross3(n, u));
  return { u, v, n };
}

function faceTransform(n: [number, number, number], distance: number, uIn?: [number, number, number], vIn?: [number, number, number]): string {
  // Callers with explicit u/v pass a basis aligned to the polyhedron's real
  // vertices so clipped faces meet edge-to-edge; otherwise derive one.
  const { u, v } = uIn && vIn ? { u: uIn, v: vIn } : basisFromNormal(n);
  const m = [
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    n[0], n[1], n[2], 0,
    0, 0, 0, 1,
  ];
  return `matrix3d(${m.join(',')}) translateZ(${distance.toFixed(2)}px)`;
}

export function buildDiceModel(type: DiceType): DiceFace[] {
  switch (type) {
    case 'd4': return buildTetrahedron();
    case 'd6': return buildCube();
    case 'd8': return buildOctahedron();
    case 'd10': return buildPentagonalTrapezohedron();
    case 'd12': return buildDodecahedron();
    case 'd20': return buildIcosahedron();
    default: return buildIcosahedron();
  }
}

// ── Tetrahedron (d4) ──────────────────────────────

function buildTetrahedron(): DiceFace[] {
  const B = FACE_BOX;
  const clip = 'clip-path:polygon(50% 0%, 0% 100%, 100% 100%);';
  const V: [number, number, number][] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  const F = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  return F.map((face, i) => {
    const center = face.map(vi => V[vi]).reduce(
      (a, v) => [a[0] + v[0] / 3, a[1] + v[1] / 3, a[2] + v[2] / 3] as [number, number, number],
      [0, 0, 0] as [number, number, number]
    );
    const normal = normalize3(center);
    return {
      index: i,
      value: i + 1,
      normal,
      ...basisFromNormal(normal),
      transform: faceTransform(normal, B * 0.2041),
      clip,
    };
  });
}

// ── Cube (d6) ─────────────────────────────────────

function buildCube(): DiceFace[] {
  const B = FACE_BOX;
  const clip = 'clip-path:polygon(5% 5%, 95% 5%, 95% 95%, 5% 95%);';
  const normals: [number, number, number][] = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  ];
  const values = [1, 6, 3, 4, 2, 5];
  return normals.map((n, i) => ({
    index: i,
    value: values[i],
    normal: n,
    ...basisFromNormal(n),
    transform: faceTransform(n, B / 2),
    clip,
  }));
}

// ── Octahedron (d8) ───────────────────────────────

function buildOctahedron(): DiceFace[] {
  const B = FACE_BOX;
  const clip = 'clip-path:polygon(50% 0%, 0% 100%, 100% 100%);';
  const normals: [number, number, number][] = [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  ];
  return normals.map((n, i) => {
    const normal = normalize3(n);
    return {
      index: i,
      value: i + 1,
      normal,
      ...basisFromNormal(normal),
      transform: faceTransform(normal, B / Math.sqrt(6)),
      clip,
    };
  });
}

// ── Pentagonal Trapezohedron (d10) ────────────────

function buildPentagonalTrapezohedron(): DiceFace[] {
  const B = FACE_BOX;
  const clip = 'clip-path:polygon(50% 0%, 85% 35%, 100% 100%, 0% 100%, 15% 35%);';

  const faces: DiceFace[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const len = Math.hypot(nx, 0.3, nz);
    const normal: [number, number, number] = [nx / len, 0.3 / len, nz / len];
    faces.push({
      index: i,
      value: i,
      normal,
      ...basisFromNormal(normal),
      transform: faceTransform(normal, B * 0.62),
      clip,
    });
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const len = Math.hypot(nx, 0.3, nz);
    const normal: [number, number, number] = [nx / len, -0.3 / len, nz / len];
    faces.push({
      index: 5 + i,
      value: 5 + i,
      normal,
      ...basisFromNormal(normal),
      transform: faceTransform(normal, B * 0.62),
      clip,
    });
  }
  return faces;
}

// ── Dodecahedron (d12) ────────────────────────────

function buildDodecahedron(): DiceFace[] {
  const B = FACE_BOX;
  const phi = (1 + Math.sqrt(5)) / 2;
  const clip = 'clip-path:polygon(50% 5%, 85% 38%, 72% 90%, 28% 90%, 15% 38%);';
  const normals: [number, number, number][] = [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
    [0, phi, 1 / phi], [0, phi, -1 / phi], [0, -phi, 1 / phi], [0, -phi, -1 / phi],
  ];
  const values = [1, 2, 3, 4, 9, 10, 11, 12, 5, 6, 7, 8];
  return normals.map((n, i) => {
    const normal = normalize3(n);
    return {
      index: i,
      value: values[i],
      normal,
      ...basisFromNormal(normal),
      transform: faceTransform(normal, B * 0.2784),
      clip,
    };
  });
}

// ── Icosahedron (d20) ─────────────────────────────

function buildIcosahedron(): DiceFace[] {
  const B = FACE_BOX;
  const PHI = (1 + Math.sqrt(5)) / 2;
  const V: [number, number, number][] = [
    [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
    [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
    [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
  ];
  const FACES: number[][] = [
    [0, 4, 8], [0, 8, 1], [0, 1, 9], [0, 9, 5], [0, 5, 4],
    [4, 8, 10], [2, 10, 4], [10, 6, 8], [8, 1, 6], [1, 9, 7],
    [9, 5, 11], [5, 4, 2], [9, 11, 7], [11, 2, 5], [6, 7, 1],
    [3, 2, 10], [3, 10, 6], [3, 6, 7], [3, 7, 11], [3, 11, 2],
  ];
  return FACES.map((idx, i) => {
    const [va, vb, vc] = idx.map(vi => V[vi]);
    const center: [number, number, number] = [
      (va[0] + vb[0] + vc[0]) / 3,
      (va[1] + vb[1] + vc[1]) / 3,
      (va[2] + vb[2] + vc[2]) / 3,
    ];
    const normal = normalize3(center);
    // Vertex-aligned basis: glyph-up points from the face center toward the
    // clip triangle's apex vertex, so the triangle's three corners land
    // exactly on the icosahedron's real vertices and adjacent faces close
    // edge-to-edge. The old ref-derived basis was rotated ~140° off the
    // vertex directions, leaving 60px gaps between every face — the die
    // looked like a pile of separate triangles instead of a solid d20.
    const v = normalize3([center[0] - va[0], center[1] - va[1], center[2] - va[2]]);
    const u = normalize3(cross3(v, normal));
    return {
      index: i,
      value: i + 1,
      normal,
      u,
      v,
      transform: faceTransform(normal, B * 0.6545, u, v),
      clip: 'clip-path:polygon(50% 0%, 6.7% 75%, 93.3% 75%);',
    };
  });
}

// ── DOM scene builder ───────────────────────────────

function hueFromColor(hex: string): number {
  // Expand 3-digit shorthand (#c33 → #cc3333) — slicing the short form
  // produced NaN, which made every die face's hsl() background invalid and
  // left the dice transparent (a hollow shell of numbers).
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

/**
 * Build the numbered CSS 3D die (all faces), positioned by its center.
 * `extra` is appended to the scene's cssText (e.g. scale, opacity, z-index).
 */
export function buildDieScene(
  faces: DiceFace[],
  color: string,
  leftCss: string,
  topCss: string = '40%',
  extra: string = ''
): HTMLElement {
  const scene = document.createElement('div');
  scene.className = 'big-die';
  scene.style.cssText = `position:absolute; top:${topCss}; left:${leftCss}; transform-style:preserve-3d; z-index:95; pointer-events:none;${extra}`;
  const hue = hueFromColor(color);

  // Solid interior: the clipped faces tile the polyhedron's surface, but the
  // slivers at each vertex still let the page show through. Three crossed
  // discs (a poor-man's sphere) block the interior from every viewing angle.
  // They live inside ONE wrapper so scene.children[0] stays the "core" that
  // the dice tray reads as the die's body.
  //
  // CRITICAL: the core must sit INSIDE the painted silhouette. The d20's
  // faces are a hexagon inscribed in the face box, so a disc sized to the
  // box pokes out past the hexagon's edges and its near-black rim reads as a
  // dark ring hugging the die — the "weird shadow" around the dice. Sized to
  // radius ~42 (the hexagon's edge is at ~50), with a softer rim, it stays
  // hidden behind the surface at every rotation.
  const core = document.createElement('div');
  core.style.cssText = `position:absolute; left:-42px; top:-42px; width:84px; height:84px; transform-style:preserve-3d;`;
  const disc = (transform: string) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.32) 60%, rgba(0,0,0,0.48) 100%);`;
    if (transform) d.style.transform = transform;
    return d;
  };
  core.appendChild(disc(''));
  core.appendChild(disc('rotateX(90deg)'));
  core.appendChild(disc('rotateY(90deg)'));
  scene.appendChild(core);

  // Light the die from the top-front in its own frame — a painted die keeps
  // its face colors as it tumbles. Faces whose local normal points up-front
  // glow bright; down-back faces fall to shadow. The whole polyhedron then
  // reads as one solid object instead of a pile of same-brightness chips.
  for (const face of faces) {
    const f = document.createElement('div');
    const light = Math.max(0, Math.min(1, 0.62 * face.normal[2] + 0.38 * face.normal[1]));
    const shade = Math.round(22 + 56 * light);
    const hi = Math.min(86, shade + 16);
    const lo = Math.max(18, shade - 16);
    // Crisp 1px seam (no heavy inset blur — that made each triangle look
    // like a separate rounded tile); top-left lit gradient per face.
    f.style.cssText = `position:absolute; left:-${FACE_BOX / 2}px; top:-${FACE_BOX / 2}px; width:${FACE_BOX}px; height:${FACE_BOX}px; backface-visibility:hidden; ${face.clip}; background:linear-gradient(135deg, hsl(${hue},60%,${hi}%) 0%, hsl(${hue},52%,${shade}%) 55%, hsl(${hue},44%,${lo}%) 100%); box-shadow:inset 0 0 0 1px rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center;`;
    f.style.transform = face.transform;
    // Crisp glyph: a soft 1px drop for legibility with NO fuzzy halo, so the
    // number sits cleanly on the face instead of carrying a smog blur.
    f.innerHTML = `<span style="font-family:monospace; font-size:${FACE_FONT}px; font-weight:bold; color:rgba(255,255,255,0.96); text-shadow:0 1px 1px rgba(0,0,0,0.55);">${face.value}</span>`;
    scene.appendChild(f);
  }

  return scene;
}
