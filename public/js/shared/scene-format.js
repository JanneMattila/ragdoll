// Scene JSON format shared by the browser, the server and the build scripts.
// Pure JS with no dependencies so it runs in Node and in the browser.

export const OBJECT_TYPES = ['box', 'sphere', 'cylinder', 'ramp', 'stairs', 'quarterPipe'];
export const MATERIALS = ['default', 'wood', 'metal', 'ice', 'rubber', 'grass', 'concrete'];
export const ITEM_KINDS = ['ragdoll', 'human', 'cratePyramid', 'tower', 'dominoes', 'beachBall', 'barrels', 'snowman'];

const LIMITS = { objects: 400, dynamic: 150, items: 20, coord: 200, size: 200 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, def, lo = -Infinity, hi = Infinity) => (isNum(v) ? clamp(v, lo, hi) : def);
const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
const vec3 = (v, def, lo, hi) =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) ? v.map((x) => clamp(x, lo, hi)) : def.slice();
const color = (v, def) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
const text = (v, def, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
const pick = (v, list, def) => (list.includes(v) ? v : def);

const DEFAULT_COLORS = {
  box: '#b0a89a', sphere: '#c9b18a', cylinder: '#8a9bb0', ramp: '#a0805c', stairs: '#9c9c9c', quarterPipe: '#b08a5a',
};

/** Validates and sanitizes an untrusted scene (e.g. from the LLM). Throws on unusable input. */
export function normalizeScene(raw, meta = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Scene must be a JSON object');
  const env = raw.environment && typeof raw.environment === 'object' ? raw.environment : {};
  const spawn = raw.spawn && typeof raw.spawn === 'object' ? raw.spawn : {};
  const cam = raw.camera && typeof raw.camera === 'object' ? raw.camera : {};

  const scene = {
    id: meta.id ?? text(raw.id, 'scene', 80),
    name: text(raw.name, 'Untitled scene', 60),
    description: text(raw.description, '', 400),
    source: meta.source ?? raw.source ?? 'user',
    createdAt: meta.createdAt ?? raw.createdAt ?? new Date().toISOString(),
    environment: {
      sky: color(env.sky, '#9fc9ef'),
      ground: color(env.ground, '#7a8a6a'),
      fog: num(env.fog, 0.008, 0, 0.05),
      sunIntensity: num(env.sunIntensity, 2.2, 0, 6),
    },
    spawn: { position: vec3(spawn.position, [0, 0, 0], -LIMITS.coord, LIMITS.coord), rotationY: num(spawn.rotationY, 0, -360, 360) },
    camera: {
      position: vec3(cam.position, [8, 6, 10], -LIMITS.coord * 2, LIMITS.coord * 2),
      target: vec3(cam.target, [0, 1, 0], -LIMITS.coord, LIMITS.coord),
    },
    objects: [],
    items: [],
  };
  const prompt = meta.prompt ?? raw.prompt;
  if (prompt) scene.prompt = String(prompt).slice(0, 2000);
  const basedOn = meta.basedOn ?? raw.basedOn;
  if (basedOn) scene.basedOn = String(basedOn).slice(0, 100);

  const objects = Array.isArray(raw.objects) ? raw.objects : [];
  let dynamicCount = 0;
  for (const o of objects) {
    if (scene.objects.length >= LIMITS.objects) break;
    const n = normalizeObject(o);
    if (!n) continue;
    if (n.dynamic) {
      if (dynamicCount >= LIMITS.dynamic) { delete n.dynamic; delete n.mass; }
      else dynamicCount++;
    }
    scene.objects.push(n);
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  for (const it of items.slice(0, LIMITS.items)) {
    if (!it || !ITEM_KINDS.includes(it.kind)) continue;
    scene.items.push({
      kind: it.kind,
      position: vec3(it.position, scene.spawn.position, -LIMITS.coord, LIMITS.coord),
      rotationY: num(it.rotationY, 0, -360, 360),
    });
  }
  if (scene.objects.length === 0 && scene.items.length === 0) throw new Error('Scene has no valid objects');
  return scene;
}

function normalizeObject(o) {
  if (!o || typeof o !== 'object' || !OBJECT_TYPES.includes(o.type)) return null;
  const S = LIMITS.size;
  const base = {
    type: o.type,
    position: vec3(o.position, [0, 0, 0], -LIMITS.coord, LIMITS.coord),
    rotation: vec3(o.rotation, [0, 0, 0], -360, 360),
    color: color(o.color, DEFAULT_COLORS[o.type]),
    material: pick(o.material, MATERIALS, 'default'),
  };
  if (typeof o.name === 'string') base.name = o.name.slice(0, 40);
  switch (o.type) {
    case 'box':
      base.size = vec3(o.size, [1, 1, 1], 0.02, S);
      break;
    case 'sphere':
      base.radius = num(o.radius, 0.5, 0.02, S / 2);
      break;
    case 'cylinder':
      base.radius = num(o.radius, 0.5, 0.02, S / 2);
      base.height = num(o.height, 1, 0.02, S);
      break;
    case 'ramp':
      base.size = vec3(o.size, [2, 1, 4], 0.05, S);
      break;
    case 'stairs':
      base.steps = int(o.steps, 8, 1, 60);
      base.stepHeight = num(o.stepHeight, 0.18, 0.03, 2);
      base.stepDepth = num(o.stepDepth, 0.3, 0.05, 4);
      base.width = num(o.width, 2, 0.2, 40);
      base.landingDepth = num(o.landingDepth, 0, 0, 40);
      break;
    case 'quarterPipe':
      base.radius = num(o.radius, 2.5, 0.5, 20);
      base.width = num(o.width, 4, 0.5, 40);
      base.segments = int(o.segments, 10, 3, 24);
      base.deckDepth = num(o.deckDepth, 1.2, 0, 10);
      break;
  }
  const allowDynamic = ['box', 'sphere', 'cylinder'].includes(o.type);
  if (allowDynamic && o.dynamic === true) {
    base.dynamic = true;
    base.mass = num(o.mass, 5, 0.05, 500);
  }
  return base;
}

// ---------- quaternion helpers ([x, y, z, w]) ----------
const D2R = Math.PI / 180;
export function quatFromEulerDeg([ex, ey, ez]) {
  const c1 = Math.cos((ex * D2R) / 2), c2 = Math.cos((ey * D2R) / 2), c3 = Math.cos((ez * D2R) / 2);
  const s1 = Math.sin((ex * D2R) / 2), s2 = Math.sin((ey * D2R) / 2), s3 = Math.sin((ez * D2R) / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export function quatRotate(q, [vx, vy, vz]) {
  const [qx, qy, qz, qw] = q;
  const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Wedge (triangular prism) geometry. Base centered at origin, low edge at +z, high edge at -z. */
export function wedgeGeometry([w, h, d]) {
  const x = w / 2, z = d / 2;
  return {
    vertices: [[-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]],
    faces: [[3, 2, 1, 0], [2, 3, 4, 5], [0, 1, 5, 4], [0, 4, 3], [1, 2, 5]],
  };
}

/**
 * Expands a normalized scene into primitive shapes:
 * { shape: 'box'|'sphere'|'cylinder'|'wedge', halfExtents|radius|height|size, position, quaternion, color, material, dynamic, mass }
 */
export function expandScene(scene) {
  const out = [];
  for (const o of scene.objects) {
    const q = quatFromEulerDeg(o.rotation);
    const place = (local, localQuat, prim) =>
      out.push({
        color: o.color, material: o.material, dynamic: false, mass: 0, name: o.name, ...prim,
        position: add(o.position, quatRotate(q, local)),
        quaternion: localQuat ? quatMul(q, localQuat) : q,
      });
    switch (o.type) {
      case 'box':
        place([0, 0, 0], null, { shape: 'box', halfExtents: o.size.map((s) => s / 2), dynamic: !!o.dynamic, mass: o.mass ?? 0 });
        break;
      case 'sphere':
        place([0, 0, 0], null, { shape: 'sphere', radius: o.radius, dynamic: !!o.dynamic, mass: o.mass ?? 0 });
        break;
      case 'cylinder':
        place([0, 0, 0], null, { shape: 'cylinder', radius: o.radius, height: o.height, dynamic: !!o.dynamic, mass: o.mass ?? 0 });
        break;
      case 'ramp':
        place([0, 0, 0], null, { shape: 'wedge', size: o.size });
        break;
      case 'stairs': {
        // Solid steps rising towards local -z; position is the bottom-front center.
        for (let i = 0; i < o.steps; i++) {
          const h = (i + 1) * o.stepHeight;
          place([0, h / 2, -(i + 0.5) * o.stepDepth], null, { shape: 'box', halfExtents: [o.width / 2, h / 2, o.stepDepth / 2] });
        }
        if (o.landingDepth > 0) {
          const h = o.steps * o.stepHeight;
          place([0, h / 2, -o.steps * o.stepDepth - o.landingDepth / 2], null, {
            shape: 'box', halfExtents: [o.width / 2, h / 2, o.landingDepth / 2],
          });
        }
        break;
      }
      case 'quarterPipe': {
        // Concave curve facing +z; flat bottom at local z = +R/2, vertical lip at z = -R/2, height R.
        const R = o.radius, t = 0.12, zB = R / 2;
        const step = Math.PI / 2 / o.segments;
        for (let i = 0; i < o.segments; i++) {
          const a0 = i * step, a1 = (i + 1) * step, am = (a0 + a1) / 2;
          const p0 = [0, R - R * Math.cos(a0), zB - R * Math.sin(a0)];
          const p1 = [0, R - R * Math.cos(a1), zB - R * Math.sin(a1)];
          const len = Math.hypot(p1[1] - p0[1], p1[2] - p0[2]) + 0.02;
          const mid = [0, (p0[1] + p1[1]) / 2 - (Math.cos(am) * t) / 2, (p0[2] + p1[2]) / 2 - (Math.sin(am) * t) / 2];
          place(mid, quatFromEulerDeg([am / D2R, 0, 0]), { shape: 'box', halfExtents: [o.width / 2, t / 2, len / 2] });
        }
        if (o.deckDepth > 0) {
          place([0, R / 2, zB - R - o.deckDepth / 2], null, { shape: 'box', halfExtents: [o.width / 2, R / 2, o.deckDepth / 2] });
        }
        break;
      }
    }
  }
  return out;
}

/** Text describing the format, used in the LLM system prompt. */
export const SCENE_FORMAT_DOC = `
Scene JSON format (units are meters, Y is up, the infinite ground plane is at y = 0, keep the scene within about 60 x 60 m around the origin):
{
  "name": "Short title",
  "description": "One or two sentences about the location and why it is fun for ragdoll physics",
  "environment": { "sky": "#rrggbb", "ground": "#rrggbb", "fog": 0.008, "sunIntensity": 2.2 },
  "spawn": { "position": [x, y, z], "rotationY": degrees },   // where a ragdoll is placed by default: an interesting spot ON TOP of a surface (e.g. top of the stairs, roof edge). y = surface height.
  "camera": { "position": [x, y, z], "target": [x, y, z] },   // good viewing angle onto the spawn point
  "objects": [ ...objects ],
  "items": [ { "kind": "ragdoll" | "human" | "cratePyramid" | "tower" | "dominoes" | "beachBall" | "barrels" | "snowman", "position": [x, y, z], "rotationY": degrees } ]  // optional pre-placed props (max ~4), position is the base point on a FLAT surface; "human" is a standing self-balancing person who falls when pushed hard, "ragdoll" is limp
}
Object types (all accept "position", "rotation" [x, y, z] in DEGREES (XYZ euler), "color" "#rrggbb", "material" one of ${MATERIALS.join(', ')}, optional "name"):
- { "type": "box", "size": [w, h, d] }                      position = box CENTER (so a box resting on the ground has y = h/2)
- { "type": "sphere", "radius": r }                         position = center
- { "type": "cylinder", "radius": r, "height": h }          upright along Y, position = center (use rotation [0,0,90] for a horizontal bar along X)
- { "type": "ramp", "size": [w, h, d] }                     solid wedge; position = center of its BASE (y = bottom); rises from the low edge at local +z to height h at local -z
- { "type": "stairs", "steps": n, "stepHeight": 0.18, "stepDepth": 0.3, "width": 2, "landingDepth": 0 }  solid staircase; position = bottom-front center (y = bottom); climbs towards local -z; total height = steps*stepHeight; an optional landing continues at the top
- { "type": "quarterPipe", "radius": 2.5, "width": 4, "segments": 10, "deckDepth": 1.2 } skate quarter pipe; position = base center (y = bottom); footprint z from -radius/2 to +radius/2; curved face opens towards local +z, deck behind it at height = radius
box, sphere and cylinder may set "dynamic": true and "mass": kg to become movable physics props (max 150 dynamic objects). Everything else is static.
Rotate objects with "rotation" (mostly Y). Objects must rest on the ground or on other objects (no floating unless intended). Make surfaces where ragdolls tumble in fun ways: slopes, ledges, edges, steps, railings and loose props.
Use materials: "ice" is slippery, "rubber" is bouncy.
`;
