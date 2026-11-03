import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhysicsSim, PHYSICS_MODES } from '../public/js/sim/physics.js';
import { normalizeScene, expandScene } from '../public/js/shared/scene-format.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'presets');
const presets = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));

const run = (sim, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60); };
const facing = (deg) => [Math.sin((deg * Math.PI) / 180), 0.15, Math.cos((deg * Math.PI) / 180)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Scene-specific outcomes that guard against unrealistic friction (cannon-es friction calibration).
const EXPECTATIONS = {
  'preset-ski-jump': { text: 'ragdoll should slide down the icy in-run and fly past the kicker', check: (p) => p.z > 2 },
  'preset-staircase': { text: 'ragdoll should tumble down to the bottom of the stairs', check: (p) => p.y < 1.2 },
  'preset-office-building': { text: 'ragdoll should fall off the roof', check: (p) => p.y < 6 },
  'preset-bowling-alley': { text: 'ragdoll should slide down the polished lane', check: (p) => p.z < 0 },
};

function assertRagdollIntact(item, label) {
  const p = item.parts;
  for (const [a, b, max] of [['head', 'torso', 0.55], ['torso', 'pelvis', 0.5], ['pelvis', 'upperLegL', 0.45], ['upperLegL', 'lowerLegL', 0.6], ['torso', 'upperArmR', 0.55]]) {
    const d = dist(p[a].position, p[b].position);
    assert.ok(d < max, `${label}: joint ${a}-${b} stretched to ${d.toFixed(2)} m`);
  }
  for (const b of item.bodies) assert.ok(b.position.y > -0.3, `${label}: ${b.userData.part} fell through the ground (y=${b.position.y.toFixed(2)})`);
}

test('there are at least 10 preset scenes', () => {
  assert.ok(presets.length >= 10, `found ${presets.length}`);
});

for (const scene of presets) {
  test(`push ragdoll in "${scene.name}"`, () => {
    assert.deepEqual(normalizeScene(scene, { id: scene.id, source: scene.source, createdAt: scene.createdAt }).objects.length, scene.objects.length);
    const sim = new PhysicsSim();
    sim.loadScene(scene);
    const doll = sim.addItem('ragdoll', scene.spawn.position, scene.spawn.rotationY);
    run(sim, 0.5);
    const torso = doll.parts.torso;
    const spawn = { x: scene.spawn.position[0], y: scene.spawn.position[1] + 1.33, z: scene.spawn.position[2] };
    assert.ok(dist(torso.position, spawn) < 1.2, `ragdoll spawn is blocked: torso moved ${dist(torso.position, spawn).toFixed(2)} m before any push`);
    const before = torso.position.clone();
    sim.push(torso, [torso.position.x, torso.position.y, torso.position.z], facing(scene.spawn.rotationY), 300);
    run(sim, 6);
    assert.ok(sim.isFinite(), 'simulation produced NaN');
    const moved = dist(torso.position, before);
    assert.ok(moved > 0.5, `push only moved the torso ${moved.toFixed(2)} m`);
    assertRagdollIntact(doll, scene.name);
    const expect = EXPECTATIONS[scene.id];
    if (expect) assert.ok(expect.check(torso.position), `${scene.name}: ${expect.text} (torso at ${torso.position.toString()})`);
    console.log(`  ${scene.name}: torso travelled ${moved.toFixed(1)} m, now at y=${torso.position.y.toFixed(2)}`);
  });
}

for (const mode of Object.keys(PHYSICS_MODES)) {
  test(`physics mode "${mode}" with all force types`, () => {
    const scene = presets.find((s) => s.id === 'preset-staircase');
    const sim = new PhysicsSim();
    sim.setMode(mode);
    sim.loadScene(scene);
    const doll = sim.addItem('ragdoll', scene.spawn.position, 0);
    for (const kind of ['cratePyramid', 'tower', 'dominoes', 'beachBall', 'barrels', 'snowman']) sim.addItem(kind, [6, 0, 6], 0);
    run(sim, 0.5);
    const t = doll.parts.torso.position;
    sim.push(doll.parts.head, [t.x, t.y + 0.4, t.z], [0, 0, 1], 200);
    sim.throwProjectile('snowball', [t.x, t.y, t.z + 6], [0, 0, -1], 30);
    sim.throwProjectile('bowling', [t.x, t.y, t.z + 6], [0, 0, -1], 30);
    sim.explode([6, 0.2, 6], 6, 40);
    for (let i = 0; i < 60; i++) { sim.blow([t.x, t.y, t.z - 5], [0, 0, 1], 40); sim.step(1 / 60); }
    sim.setWind([3, 0, 0]);
    run(sim, 3);
    assert.ok(sim.isFinite(), 'simulation produced NaN');
    if (PHYSICS_MODES[mode].gravity[1] !== 0) assertRagdollIntact(doll, mode);
  });
}

test('scene normalization rejects junk and clamps values', () => {
  assert.throws(() => normalizeScene({ objects: [{ type: 'teapot' }] }));
  const s = normalizeScene({ objects: [{ type: 'box', size: [1e9, -1, 'x'], position: [0, 0, 0], color: 'red' }] });
  assert.equal(s.objects[0].color, '#b0a89a');
  assert.deepEqual(s.objects[0].size, [1, 1, 1]);
  const prims = expandScene(normalizeScene({ objects: [{ type: 'stairs', steps: 5 }, { type: 'quarterPipe' }, { type: 'ramp' }] }));
  assert.ok(prims.length > 10);
});

// ---------------- balancing human ----------------
const FLAT = { spawn: { position: [0, 0, 0], rotationY: 0 }, objects: [], items: [] };

function standingHuman(scene = FLAT, mode = 'realistic') {
  const sim = new PhysicsSim();
  sim.setMode(mode);
  sim.loadScene(scene);
  const h = sim.addItem('human', scene.spawn.position, scene.spawn.rotationY);
  return { sim, h };
}

test('balancing human stands perfectly still on flat ground', () => {
  const { sim, h } = standingHuman();
  run(sim, 2);
  const p0 = h.parts.head.position.clone();
  run(sim, 20);
  assert.ok(h.balance.active, `fell over: ${h.balance.reason}`);
  assert.ok(h.parts.head.position.y > 1.7, `head at ${h.parts.head.position.y.toFixed(2)} m`);
  assert.ok(dist(h.parts.head.position, p0) < 0.01, `drifted ${dist(h.parts.head.position, p0).toFixed(3)} m in 20 s`);
});

for (const scene of presets) {
  test(`balancing human stands at the spawn of "${scene.name}"`, () => {
    const { sim, h } = standingHuman(scene);
    run(sim, 8);
    assert.ok(h.balance.active, `fell over: ${h.balance.reason}`);
    assert.ok(h.parts.head.position.y - scene.spawn.position[1] > 1.7, 'head is not at standing height');
  });
}

for (const mode of ['realistic', 'arcade', 'moon', 'bouncy']) {
  test(`balancing human stands in "${mode}" mode`, () => {
    const { sim, h } = standingHuman(FLAT, mode);
    run(sim, 8);
    assert.ok(h.balance.active, `fell over: ${h.balance.reason}`);
  });
}

test('balancing human recovers from small pushes and topples from big ones', () => {
  for (const [impulse, shouldStand] of [[60, true], [150, true], [400, false]]) {
    const { sim, h } = standingHuman();
    run(sim, 2);
    const t = h.parts.torso.position;
    sim.push(h.parts.torso, [t.x, t.y, t.z], [0, 0, 1], impulse);
    let maxTilt = 0;
    for (let i = 0; i < 360; i++) {
      sim.step(1 / 60);
      const up = h.parts.pelvis.quaternion.vmult(new h.parts.pelvis.position.constructor(0, 1, 0));
      maxTilt = Math.max(maxTilt, (Math.acos(Math.min(1, up.y)) * 180) / Math.PI);
    }
    assert.equal(h.balance.active, shouldStand, `push ${impulse}: standing=${h.balance.active} (${h.balance.reason ?? ''}), max tilt ${maxTilt.toFixed(1)}°`);
    if (shouldStand) assert.ok(maxTilt > 1, `push ${impulse} should visibly sway the body`);
    else assert.ok(h.parts.head.position.y < 0.6, 'knocked-out human should end up on the ground');
  }
});

test('balancing human wakes and reacts when a sleeping body part is hit', () => {
  const { sim, h } = standingHuman();
  run(sim, 5);
  assert.ok(h.bodies.every((b) => b.sleepState === 2), 'settled human should be asleep');
  const head = h.parts.head.position;
  sim.throwProjectile('bowling', [head.x, head.y, head.z - 4], [0, 0, 1], 40);
  run(sim, 4);
  assert.equal(h.balance.active, false, 'a 7 kg ball to the head should knock the human over');
});

for (const kind of ['human', 'ragdoll']) {
  test(`grabbing a leg of a sleeping ${kind} drags the whole body`, () => {
    const sim = new PhysicsSim();
    sim.loadScene(FLAT);
    const item = sim.addItem(kind, FLAT.spawn.position, 0);
    run(sim, 15);
    assert.ok(item.bodies.some((b) => b.sleepState === 2), `settled ${kind} should have sleeping parts`);
    const { lowerLegL: leg, torso } = item.parts;
    const t0 = torso.position.clone();
    const start = [leg.position.x, leg.position.y, leg.position.z];
    assert.ok(sim.grab(leg, start));
    for (let i = 1; i <= 120; i++) {
      sim.moveGrab([start[0] + (3 * i) / 120, start[1] + 0.5, start[2]]);
      sim.step(1 / 60);
    }
    run(sim, 1);
    const moved = torso.position.x - t0.x;
    sim.release();
    assert.ok(moved > 2, `torso only moved ${moved.toFixed(2)} m while the leg was dragged 3 m`);
    assert.ok(sim.isFinite());
  });
}
