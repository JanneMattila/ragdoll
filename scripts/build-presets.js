// Pre-generates the built-in scenes into data/presets. Run with `npm run build`.
// Pass --ai to have the Copilot SDK model design the presets from their descriptions instead.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeScene } from '../public/js/shared/scene-format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'presets');
const CREATED = '2026-01-01T00:00:00.000Z';

const box = (size, position, color, extra = {}) => ({ type: 'box', size, position, color, ...extra });
const cyl = (radius, height, position, color, extra = {}) => ({ type: 'cylinder', radius, height, position, color, ...extra });
const sphere = (radius, position, color, extra = {}) => ({ type: 'sphere', radius, position, color, ...extra });
const tree = (x, z, h = 3, leaf = '#3d8b3d') => [
  cyl(0.18, h, [x, h / 2, z], '#6b4a2b', { material: 'wood' }),
  sphere(h * 0.4, [x, h + h * 0.25, z], leaf),
];

const PRESETS = [];
const preset = (id, def) => PRESETS.push({ id: `preset-${id}`, ...def });

preset('staircase', {
  name: 'Grand Staircase',
  description: 'A long double staircase with a landing on top. Perfect for the classic tumble-down-the-stairs test.',
  environment: { sky: '#bcd7f0', ground: '#8f9a86' },
  spawn: { position: [0, 4, -2.5], rotationY: 0 },
  camera: { position: [13, 7.5, 5], target: [0, 2.2, 0] },
  objects: [
    { type: 'stairs', steps: 20, stepHeight: 0.2, stepDepth: 0.35, width: 3, landingDepth: 3, position: [0, 0, 6], color: '#c9c3b6', material: 'concrete' },
    { type: 'stairs', steps: 20, stepHeight: 0.2, stepDepth: 0.35, width: 3, position: [0, 0, -11], rotation: [0, 180, 0], color: '#c9c3b6', material: 'concrete' },
    box([0.1, 1, 3], [-1.55, 4.5, -2.5], '#8a6a4a', { material: 'wood', name: 'railing' }),
    cyl(0.6, 0.8, [3, 0.4, 8], '#a0522d'), sphere(0.6, [3, 1.2, 8], '#4f9a4f'),
    cyl(0.6, 0.8, [-3, 0.4, 8], '#a0522d'), sphere(0.6, [-3, 1.2, 8], '#4f9a4f'),
    box([8, 0.05, 4], [0, 0.025, 9], '#b03a3a', { name: 'carpet' }),
  ],
  items: [{ kind: 'cratePyramid', position: [0, 0.05, 9.5], rotationY: 0 }],
});

{
  const objects = [];
  for (let i = 0; i < 8; i++) {
    const s = 16 - i * 2;
    objects.push(box([s, 1, s], [0, i + 0.5, 0], i % 2 ? '#d8c08a' : '#cfb47a', { material: 'concrete' }));
  }
  objects.push({ type: 'stairs', steps: 16, stepHeight: 0.5, stepDepth: 0.5, width: 3, position: [0, 0, 9], color: '#bfa36a', material: 'concrete' });
  objects.push({ type: 'ramp', size: [3, 8, 16], position: [9, 0, 0], rotation: [0, 90, 0], color: '#d9f0ff', material: 'ice', name: 'ice slide' });
  for (const [x, z] of [[-12, 6], [-11, -9], [13, -10], [-14, -2]]) objects.push(...tree(x, z, 4, '#2f7d32'));
  preset('pyramid', {
    name: 'Stepped Pyramid',
    description: 'An eight-level stepped pyramid with a steep staircase on the front and an icy slide on the side.',
    environment: { sky: '#f3d9a4', ground: '#c9b07a', fog: 0.006, sunIntensity: 2.8 },
    spawn: { position: [0, 8, 0], rotationY: 0 },
    camera: { position: [18, 13, 20], target: [0, 4, 0] },
    objects,
  });
}

{
  const objects = [
    box([12, 20, 12], [0, 10, 0], '#7f8fa6', { material: 'concrete', name: 'building' }),
    box([12, 0.6, 0.3], [0, 20.3, 5.85], '#6d7a8d'), box([12, 0.6, 0.3], [0, 20.3, -5.85], '#6d7a8d'),
    box([0.3, 0.6, 12], [5.85, 20.3, 0], '#6d7a8d'), box([0.3, 0.6, 12], [-5.85, 20.3, 0], '#6d7a8d'),
    box([2, 1.2, 1.5], [-3, 20.6, -3], '#b8bec6', { material: 'metal', name: 'AC unit' }),
    box([2, 1.2, 1.5], [0, 20.6, -3], '#b8bec6', { material: 'metal' }),
    cyl(1.3, 2.4, [3, 22.2, -2.5], '#8b5a2b', { material: 'wood', name: 'water tank' }),
    cyl(0.1, 1, [2, 20.5, -1.5], '#555555'), cyl(0.1, 1, [4, 20.5, -1.5], '#555555'),
    cyl(0.1, 1, [2, 20.5, -3.5], '#555555'), cyl(0.1, 1, [4, 20.5, -3.5], '#555555'),
    box([6, 0.1, 2.2], [0, 4, 7], '#c0392b', { rotation: [-18, 0, 0], material: 'rubber', name: 'awning' }),
    box([1.8, 1.6, 1.2], [4, 0.8, 8.5], '#2e7d32', { material: 'metal', name: 'dumpster' }),
    box([1.8, 0.8, 4.2], [-4, 0.65, 11], '#d35400', { material: 'metal', name: 'car' }),
    box([1.6, 0.6, 2.2], [-4, 1.35, 10.8], '#e67e22', { material: 'metal' }),
  ];
  // Scaffolding on the right side of the building.
  for (const h of [5, 10, 15]) objects.push(box([2, 0.15, 8], [7, h, 0], '#a1887f', { material: 'wood' }));
  for (const z of [-3.9, 3.9]) for (const x of [6.1, 7.9]) objects.push(cyl(0.06, 15, [x, 7.5, z], '#9e9e9e', { material: 'metal' }));
  for (let i = 0; i < 6; i++) objects.push(box([0.6, 0.6, 0.6], [2 + (i % 3) * 0.65, 0.3 + Math.floor(i / 3) * 0.6, 9], '#c8a165', { dynamic: true, mass: 4, name: 'cardboard box' }));
  preset('office-building', {
    name: 'Office Rooftop',
    description: 'A 20 m office building with rooftop clutter, scaffolding and a bouncy awning far below.',
    environment: { sky: '#a7c6e8', ground: '#7d7d7d', sunIntensity: 2.4 },
    spawn: { position: [0, 20, 5], rotationY: 0 },
    camera: { position: [20, 16, 24], target: [0, 10, 4] },
    objects,
  });
}

preset('skate-park', {
  name: 'Skate Park',
  description: 'Two facing quarter pipes, a funbox, a kicker and a grind rail. Ragdolls do great unintentional tricks here.',
  environment: { sky: '#9ecbf5', ground: '#a9a9a9' },
  spawn: { position: [0, 3, -9.9], rotationY: 0 },
  camera: { position: [13, 6, 6], target: [0, 1.5, -3] },
  objects: [
    box([14, 0.04, 24], [0, 0.02, 0], '#bdbdbd', { material: 'concrete', name: 'slab' }),
    { type: 'quarterPipe', radius: 3, width: 8, segments: 12, deckDepth: 1.5, position: [0, 0, -8], color: '#c49a6c', material: 'wood' },
    { type: 'quarterPipe', radius: 3, width: 8, segments: 12, deckDepth: 1.5, position: [0, 0, 8], rotation: [0, 180, 0], color: '#c49a6c', material: 'wood' },
    box([4, 0.6, 3], [0, 0.3, 0], '#8d6e63', { material: 'wood', name: 'funbox' }),
    { type: 'ramp', size: [4, 0.6, 2], position: [0, 0, 2.5], color: '#a1887f', material: 'wood' },
    { type: 'ramp', size: [4, 0.6, 2], position: [0, 0, -2.5], rotation: [0, 180, 0], color: '#a1887f', material: 'wood' },
    cyl(0.05, 6, [5, 0.55, 0], '#d0d0d0', { rotation: [90, 0, 0], material: 'metal', name: 'rail' }),
    cyl(0.05, 0.5, [5, 0.25, -2.5], '#707070', { material: 'metal' }),
    cyl(0.05, 0.5, [5, 0.25, 2.5], '#707070', { material: 'metal' }),
    { type: 'ramp', size: [2, 0.8, 2.5], position: [-5, 0, 3], color: '#ef6c00', material: 'wood', name: 'kicker' },
  ],
});

preset('playground', {
  name: 'Playground',
  description: 'A slippery slide tower, a seesaw that actually tips and a sandbox to land in.',
  environment: { sky: '#aee1ff', ground: '#6fae4f' },
  spawn: { position: [0, 2.5, 0], rotationY: 180 },
  camera: { position: [7, 5, 6], target: [0, 1.4, -1] },
  objects: [
    box([1.4, 0.15, 1.4], [0, 2.425, 0], '#3f7fbf', { material: 'wood', name: 'platform' }),
    ...[[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]].map(([x, z]) => cyl(0.06, 3.3, [x, 1.65, z], '#f1c40f', { material: 'metal' })),
    { type: 'stairs', steps: 10, stepHeight: 0.25, stepDepth: 0.2, width: 0.8, position: [0, 0, 2.7], color: '#e67e22', material: 'wood' },
    { type: 'ramp', size: [0.9, 2.5, 4.5], position: [0, 0, -2.95], rotation: [0, 180, 0], color: '#e74c3c', material: 'ice', name: 'slide' },
    cyl(0.1, 4.2, [6, 2.5, 0], '#c0392b', { rotation: [0, 0, 90], material: 'metal', name: 'swing bar' }),
    cyl(0.08, 2.5, [4, 1.25, 0], '#c0392b', { material: 'metal' }), cyl(0.08, 2.5, [8, 1.25, 0], '#c0392b', { material: 'metal' }),
    cyl(0.2, 1, [-5, 0.2, -2], '#7f8c8d', { rotation: [0, 0, 90], material: 'metal', name: 'seesaw pivot' }),
    box([0.4, 0.08, 4], [-5, 0.45, -2], '#d35400', { dynamic: true, mass: 15, material: 'wood', name: 'seesaw plank' }),
    box([3, 0.3, 0.15], [-5, 0.15, 3.5], '#8d6e63'), box([3, 0.3, 0.15], [-5, 0.15, 6.5], '#8d6e63'),
    box([0.15, 0.3, 3], [-6.5, 0.15, 5], '#8d6e63'), box([0.15, 0.3, 3], [-3.5, 0.15, 5], '#8d6e63'),
    box([2.85, 0.12, 2.85], [-5, 0.06, 5], '#f0d9a0', { material: 'grass', name: 'sand' }),
    cyl(1.5, 0.25, [5, 0.125, 6], '#16a085', { material: 'metal', name: 'merry-go-round' }),
    ...tree(-9, -6), ...tree(9, -7, 3.5), ...tree(10, 8, 2.8),
  ],
  items: [{ kind: 'beachBall', position: [-5, 0.12, 5], rotationY: 0 }],
});

{
  const objects = [
    box([12, 3, 0.2], [0, 1.5, -5.1], '#e8dcc8', { name: 'back wall' }),
    box([0.2, 3, 10], [-6.1, 1.5, 0], '#efe6d6', { name: 'left wall' }),
    box([12, 0.04, 10], [0, 0.02, 0], '#a47551', { material: 'wood', name: 'floor' }),
    box([3, 0.02, 2.2], [-1.5, 0.05, -1.8], '#9b2d30', { name: 'rug' }),
    { type: 'stairs', steps: 14, stepHeight: 0.2, stepDepth: 0.28, width: 1, position: [-5.5, 0.04, 4], color: '#7b5a3c', material: 'wood' },
    box([3, 0.2, 5], [-4.5, 2.74, -2.5], '#7b5a3c', { material: 'wood', name: 'loft' }),
    cyl(0.08, 2.64, [-3.1, 1.36, -0.1], '#5d4037'), cyl(0.08, 2.64, [-3.1, 1.36, -4.9], '#5d4037'),
    // Sofa
    box([2.4, 0.45, 0.9], [-1.5, 0.265, -3.6], '#4a6fa5', { name: 'sofa' }),
    box([2.4, 0.55, 0.22], [-1.5, 0.76, -4.04], '#3d5d8c'),
    box([0.22, 0.65, 0.9], [-2.8, 0.365, -3.6], '#3d5d8c'), box([0.22, 0.65, 0.9], [-0.2, 0.365, -3.6], '#3d5d8c'),
    // Coffee table
    box([1.2, 0.05, 0.6], [-1.5, 0.465, -1.8], '#6d4c41', { material: 'wood' }),
    ...[[-2.05, -2.05], [-0.95, -2.05], [-2.05, -1.55], [-0.95, -1.55]].map(([x, z]) => cyl(0.03, 0.42, [x, 0.25, z], '#4e342e')),
    // TV
    box([2, 0.5, 0.45], [-1.5, 0.29, 2.2], '#37474f', { name: 'tv stand' }),
    box([1.6, 0.9, 0.08], [-1.5, 0.99, 2.2], '#111111', { dynamic: true, mass: 12, name: 'tv' }),
    // Bookshelf
    box([0.05, 2, 0.35], [2.2, 1.04, -4.8], '#8d6e63'), box([0.05, 2, 0.35], [3.8, 1.04, -4.8], '#8d6e63'),
    cyl(0.04, 1.6, [4.8, 0.84, -3.8], '#cfd8dc', { dynamic: true, mass: 3, name: 'floor lamp' }),
    sphere(0.22, [4.8, 1.86, -3.8], '#fff3c4', { dynamic: true, mass: 0.5, name: 'lamp shade' }),
  ];
  const bookColors = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#2c3e50'];
  for (const [si, h] of [0.06, 0.66, 1.26, 1.86].entries()) {
    objects.push(box([1.55, 0.04, 0.35], [3, h + 0.04, -4.8], '#8d6e63', { material: 'wood' }));
    if (si === 3) continue;
    for (let i = 0; i < 8; i++) {
      objects.push(box([0.12, 0.28, 0.22], [2.35 + i * 0.18, h + 0.06 + 0.14 + 0.005, -4.8], bookColors[(i + si) % 8], { dynamic: true, mass: 0.6, name: 'book' }));
    }
  }
  preset('living-room', {
    name: 'Living Room Loft',
    description: 'A cozy living room with stairs up to a loft, a sofa to fall onto, a TV and a bookshelf full of loose books.',
    environment: { sky: '#d9cbb8', ground: '#8a7a66', fog: 0.02, sunIntensity: 1.8 },
    spawn: { position: [-3.6, 2.84, -2.5], rotationY: 90 },
    camera: { position: [5, 4.2, 5.5], target: [-1.5, 1.2, -1.5] },
    objects,
  });
}

{
  const objects = [
    box([8, 0.02, 60], [0, 0.01, 0], '#3b3b3b', { material: 'concrete', name: 'road' }),
    box([3, 0.15, 60], [5.5, 0.075, 0], '#b5b5b5', { material: 'concrete', name: 'sidewalk' }),
    box([3, 0.15, 60], [-5.5, 0.075, 0], '#b5b5b5', { material: 'concrete' }),
    ...[-20, -10, 0, 10, 20].map((z) => box([0.2, 0.01, 3], [0, 0.025, z], '#f1f1f1')),
    // Car
    box([1.8, 0.7, 4.2], [-1.5, 0.65, 0], '#2962ff', { material: 'metal', name: 'car' }),
    box([1.6, 0.6, 2.2], [-1.5, 1.3, -0.2], '#1e4bd8', { material: 'metal' }),
    ...[[-2.45, -1.4], [-0.55, -1.4], [-2.45, 1.4], [-0.55, 1.4]].map(([x, z]) => cyl(0.33, 0.25, [x, 0.33, z], '#1a1a1a', { rotation: [0, 0, 90], material: 'rubber' })),
    // Bus stop
    box([3, 0.1, 1.5], [5.6, 2.6, -4], '#455a64', { material: 'metal', name: 'bus stop roof' }),
    box([3, 2.45, 0.05], [5.6, 1.375, -4.7], '#b3e5fc', { name: 'glass' }),
    cyl(0.05, 2.45, [4.15, 1.375, -3.3], '#455a64'), cyl(0.05, 2.45, [7.05, 1.375, -3.3], '#455a64'),
    box([2.4, 0.08, 0.45], [5.6, 0.6, -4.4], '#795548', { material: 'wood', name: 'bench' }),
    cyl(0.18, 0.7, [4.5, 0.5, 3], '#d32f2f', { material: 'metal', name: 'hydrant' }),
    box([0.5, 1.1, 0.45], [4.5, 0.7, 8], '#1565c0', { material: 'metal', name: 'mailbox' }),
    cyl(0.3, 0.9, [4.6, 0.6, -8], '#2e7d32', { dynamic: true, mass: 8, name: 'trash bin' }),
    cyl(0.3, 0.9, [4.6, 0.6, -9], '#2e7d32', { dynamic: true, mass: 8 }),
  ];
  for (let i = 0; i < 5; i++) objects.push(cyl(0.14, 0.6, [1.6, 0.31, 4 + i * 1.2], '#ff6d00', { dynamic: true, mass: 1.5, material: 'rubber', name: 'cone' }));
  for (const z of [-15, 0, 15]) {
    objects.push(cyl(0.08, 5, [6.6, 2.65, z], '#424242', { material: 'metal', name: 'street lamp' }));
    objects.push(box([1.4, 0.15, 0.3], [6, 5.1, z], '#424242'));
  }
  const facades = ['#d7ccc8', '#bcaaa4', '#90a4ae', '#cfd8dc', '#a1887f', '#b0bec5'];
  for (let i = 0; i < 6; i++) {
    const h = 8 + ((i * 7) % 5) * 3;
    objects.push(box([8, h, 9.6], [11, h / 2, -25 + i * 10], facades[i], { material: 'concrete' }));
    objects.push(box([8, h, 9.6], [-11, h / 2, -25 + i * 10], facades[(i + 3) % 6], { material: 'concrete' }));
  }
  preset('city-street', {
    name: 'City Street',
    description: 'A downtown street with a parked car, bus stop, traffic cones, bins and curbs to trip over.',
    environment: { sky: '#b7c9d9', ground: '#6b6b6b', fog: 0.012 },
    spawn: { position: [-1.5, 1.6, -0.2], rotationY: 90 },
    camera: { position: [-2, 5, 10], target: [1.5, 1, -1] },
    objects,
    items: [{ kind: 'barrels', position: [5.5, 0.15, 12], rotationY: 0 }, { kind: 'human', position: [5.2, 0.15, -3.4], rotationY: 0 }],
  });
}

{
  const objects = [
    box([10, 3, 0.4], [0, 1.5, -15], '#263238', { name: 'back wall' }),
    box([10, 0.02, 8], [0, 0.01, 11], '#5d4037', { material: 'wood', name: 'approach' }),
  ];
  for (const lx of [-3, 0, 3]) {
    objects.push(box([1.6, 0.1, 22], [lx, 0.05, -3], '#e0b77a', { material: 'ice', name: 'lane' }));
    objects.push(box([0.3, 0.02, 22], [lx - 0.95, 0.01, -3], '#424242'), box([0.3, 0.02, 22], [lx + 0.95, 0.01, -3], '#424242'));
    let n = 0;
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i <= row; i++) {
        const x = lx + (i - row / 2) * 0.42;
        const z = -10 - row * 0.38;
        objects.push(cyl(0.11, 0.75, [x, 0.1 + 0.375, z], n % 2 ? '#fafafa' : '#f5f5f5', { dynamic: true, mass: 1.6, name: 'pin' }));
        n++;
      }
    }
  }
  for (const x of [-4.6, 4.6]) objects.push(box([0.2, 1.2, 30], [x, 0.6, -1], '#37474f'));
  preset('bowling-alley', {
    name: 'Giant Bowling Alley',
    description: 'Three polished (very slippery) lanes with oversized pins. Push the ragdoll down the lane for a strike.',
    environment: { sky: '#1b1f3a', ground: '#2b2b40', fog: 0.02, sunIntensity: 1.6 },
    spawn: { position: [0, 0.1, 6], rotationY: 180 },
    camera: { position: [3, 3, 11], target: [0, 0.4, -2] },
    objects,
  });
}

{
  const objects = [];
  for (const y of [3, 6, 9]) {
    objects.push(box([8, 0.25, 8], [0, y, 0], '#9e9e9e', { material: 'concrete', name: 'floor slab' }));
    for (const [x, z] of [[-3.7, -3.7], [3.7, -3.7], [-3.7, 3.7], [3.7, 3.7], [0, -3.7]]) {
      objects.push(cyl(0.2, 3, [x, y - 1.5, z], '#bdbdbd', { material: 'concrete' }));
    }
  }
  objects.push({ type: 'stairs', steps: 12, stepHeight: 0.26, stepDepth: 0.3, width: 1.2, position: [7.6, 0, 2], rotation: [0, 90, 0], color: '#757575', material: 'metal' });
  objects.push(box([1, 25, 1], [-9, 12.5, -6], '#fbc02d', { material: 'metal', name: 'crane tower' }));
  objects.push(box([20, 0.8, 0.8], [-3, 24.6, -6], '#fbc02d', { material: 'metal', name: 'crane jib' }));
  objects.push(box([1.4, 1.4, 1.4], [5, 23.5, -6], '#616161', { material: 'metal', name: 'counterweight' }));
  objects.push({ type: 'sphere', radius: 4, position: [-6, -2.6, 9], color: '#8d6e63', material: 'grass', name: 'dirt mound' });
  objects.push(cyl(0.8, 1.6, [7, 1.02, -5], '#ff7043', { rotation: [0, 0, 70], material: 'metal', name: 'mixer drum' }));
  for (let i = 0; i < 4; i++) objects.push(box([4, 0.3, 0.2], [-2, 0.15 + i * 0.3, 8 + (i % 2) * 0.05], '#b71c1c', { dynamic: true, mass: 30, material: 'metal', name: 'steel beam' }));
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 5 - r; i++) {
      objects.push(box([0.4, 0.2, 0.2], [2 + (i - (4 - r) / 2) * 0.42, 0.1 + r * 0.2, 7], '#c62828', { dynamic: true, mass: 2.5, name: 'brick' }));
    }
  }
  preset('construction-site', {
    name: 'Construction Site',
    description: 'An unfinished three-floor concrete frame, a tower crane, steel beams, a brick pile and a dirt mound.',
    environment: { sky: '#cfd8dc', ground: '#a1887f', fog: 0.01 },
    spawn: { position: [0, 9.13, 3.5], rotationY: 0 },
    camera: { position: [14, 10, 17], target: [0, 5, 3] },
    objects,
  });
}

preset('ski-jump', {
  name: 'Ski Jump',
  description: 'An icy 12 m in-run with a kicker at the bottom and a snowy landing hill. Pure arcade launch material.',
  environment: { sky: '#cfe8ff', ground: '#f4f8fb', fog: 0.01, sunIntensity: 2.6 },
  spawn: { position: [0, 12, -19.4], rotationY: 0 },
  camera: { position: [26, 13, -2], target: [0, 4, -4] },
  objects: [
    box([3, 12, 3], [0, 6, -20], '#8d6e63', { material: 'wood', name: 'start tower' }),
    { type: 'ramp', size: [3, 12, 16], position: [0, 0, -10.5], color: '#e3f2fd', material: 'ice', name: 'in-run' },
    { type: 'ramp', size: [3, 1.2, 3], position: [0, 0, -1], rotation: [0, 180, 0], color: '#bbdefb', material: 'ice', name: 'kicker' },
    { type: 'ramp', size: [10, 1.2, 14], position: [0, 0, 7.5], color: '#ffffff', material: 'ice', name: 'landing hill' },
    ...[-12, -6, 0].map((z) => box([0.6, 0.6, 0.6], [-4, 0.3, z], '#e53935', { name: 'marker' })),
    ...tree(-7, -12, 5, '#1b5e20'), ...tree(-8, 2, 4, '#2e7d32'), ...tree(-7, -24, 4.5, '#1b5e20'), ...tree(12, 26, 4, '#2e7d32'), ...tree(-9, 18, 5, '#1b5e20'),
  ],
  items: [{ kind: 'snowman', position: [-5, 0, 24], rotationY: 0 }],
});

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const useAi = process.argv.includes('--ai');
  let generateScene, stopClient;
  if (useAi) ({ generateScene, stopClient } = await import('../lib/scene-generator.js'));

  for (const [order, def] of PRESETS.entries()) {
    const meta = { id: def.id, source: 'preset', createdAt: CREATED };
    let scene;
    if (useAi) {
      process.stdout.write(`Generating ${def.name} with AI... `);
      scene = await generateScene(`${def.name}: ${def.description}`, { meta });
    } else {
      scene = normalizeScene(def, meta);
    }
    scene.order = order;
    await fs.writeFile(path.join(OUT, `${def.id}.json`), JSON.stringify(scene, null, 2));
    console.log(`${useAi ? '' : 'Built '}${def.id} (${scene.objects.length} objects)`);
  }
  if (stopClient) await stopClient();
}

await main();
