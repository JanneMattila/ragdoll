// End-to-end browser test: starts the server, loads every scene in headless Chromium, pushes the ragdoll,
// exercises each force tool with real mouse input and saves screenshots to test/screenshots.
// Usage: node test/e2e.mjs [--generate "prompt"]   (--generate also tests AI scene generation through the chat UI)
// The chat is disabled (ENABLE_CHAT=false) unless --generate is given, which enables it.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'test', 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 3123;
const genIdx = process.argv.indexOf('--generate');
const generatePrompt = genIdx > 0 ? process.argv[genIdx + 1] : null;

const env = { ...process.env, PORT: String(PORT), ENABLE_CHAT: generatePrompt ? 'true' : 'false' };
const server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('running at') && resolve());
  server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
});

const failures = [];
// Headless WebGL is slow, so wait for simulated seconds rather than wall-clock time.
async function waitSim(page, seconds) {
  const t0 = await page.evaluate(() => window.app.sim.time);
  await page.waitForFunction((t) => window.app.sim.time >= t, t0 + seconds, { timeout: 180000, polling: 50 });
}
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.app && window.app.sim.items.length > 0, null, { timeout: 30000 });
  await page.evaluate(() => window.app.ready);

  if (generatePrompt) {
    await page.waitForFunction(() => window.app.state.chat, null, { timeout: 60000 }).catch(() => {});
    check(await page.isVisible('#chat'), 'chat is shown when ENABLE_CHAT=true and GitHub Copilot is available');
  } else {
    await page.waitForFunction(() => window.app.state.statusLoaded, null, { timeout: 30000 });
    check(!(await page.isVisible('#chat')), 'chat is hidden when ENABLE_CHAT is not set');
    const res = await fetch(`http://localhost:${PORT}/api/scenes/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"prompt":"x"}' });
    check(res.status === 503, 'generate API is unavailable when chat is disabled');
  }

  const presets = await page.evaluate(() => window.app.state.scenes.presets.map((s) => ({ id: s.id, name: s.name })));
  check(presets.length >= 10, `${presets.length} preset scenes listed in the UI`);

  for (const { id, name } of presets) {
    console.log(`Scene: ${name}`);
    await page.evaluate((sid) => window.app.loadSceneById(sid), id);
    await waitSim(page, 0.8);
    const before = await page.evaluate(() => {
      const d = window.app.sim.ragdolls().at(-1);
      const p = d.parts.torso.position;
      return { x: p.x, y: p.y, z: p.z };
    });
    await page.evaluate(() => window.app.kick(6));
    await waitSim(page, 1.5);
    await page.screenshot({ path: path.join(shots, `${id}-action.png`) });
    await waitSim(page, 3);
    const after = await page.evaluate(() => {
      const d = window.app.sim.ragdolls().at(-1);
      const p = d.parts.torso.position;
      return { x: p.x, y: p.y, z: p.z, finite: window.app.sim.isFinite(), meshes: window.app.renderer.meshes.size };
    });
    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    check(after.finite && moved > 0.5, `${name}: kicked ragdoll moved ${moved.toFixed(1)} m (now y=${after.y.toFixed(2)}), ${after.meshes} meshes rendered`);
    await page.screenshot({ path: path.join(shots, `${id}.png`) });
  }

  // Exercise every tool with real mouse input on the staircase scene.
  console.log('Tools (mouse input)');
  await page.evaluate(() => window.app.loadSceneById('preset-staircase'));
  await waitSim(page, 0.5);
  const box = await page.locator('#viewport canvas').boundingBox();
  const torsoScreen = () => page.evaluate(() => {
    const { renderer, sim } = window.app;
    const p = sim.ragdolls().at(-1).parts.torso.position;
    const v = renderer.camera.position.clone().set(p.x, p.y, p.z).project(renderer.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  });
  const torsoPos = () => page.evaluate(() => window.app.sim.ragdolls().at(-1).bodies.map((b) => [b.position.x, b.position.y, b.position.z]));
  const dist = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2])));

  for (const tool of ['push', 'snowball', 'bowling', 'blower', 'explosion', 'grab']) {
    await page.evaluate(() => window.app.loadSceneById('preset-staircase'));
    // Projectiles are aimed at the standing ragdoll; other tools act on it after it collapsed and settled.
    const projectile = tool === 'snowball' || tool === 'bowling';
    await waitSim(page, projectile ? 0.05 : 2.5);
    await page.click(`#tool-grid button[data-key="${tool}"]`);
    const s = await torsoScreen();
    const x = box.x + s.x * box.width, y = box.y + s.y * box.height;
    const start = await torsoPos();
    await page.evaluate(() => {
      window.__projectileHit = false;
      for (const b of window.app.sim.ragdolls().at(-1).bodies) {
        b.addEventListener('collide', (e) => { if (e.body.userData?.kind === 'projectile') window.__projectileHit = true; });
      }
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    if (tool === 'blower' || tool === 'snowball') await waitSim(page, 1.2);
    if (tool === 'grab') { await page.mouse.move(x + 150, y - 120, { steps: 10 }); await waitSim(page, 0.4); }
    await page.mouse.up();
    await waitSim(page, 1.5);
    const end = await torsoPos();
    check(dist(start, end) > 0.3, `tool ${tool}: ragdoll parts moved up to ${dist(start, end).toFixed(2)} m`);
    if (projectile) {
      const hitRagdoll = await page.evaluate(() => window.__projectileHit === true);
      check(hitRagdoll, `tool ${tool}: projectile collided with the ragdoll`);
    }
  }

  // Camera navigation: keyboard movement, mouse orbit/pan/zoom, view presets and follow mode.
  console.log('Camera navigation');
  await page.evaluate(() => window.app.loadSceneById('preset-city-street'));
  await waitSim(page, 0.3);
  const cam = () => page.evaluate(() => {
    const { camera, controls } = window.app.renderer;
    const dir = camera.getWorldDirection(camera.position.clone());
    return { p: camera.position.toArray(), t: controls.target.toArray(), yaw: Math.atan2(dir.x, dir.z), pitch: Math.asin(dir.y) };
  });
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const holdKey = async (key, ms) => { await page.keyboard.down(key); await waitSim(page, ms / 1000); await page.keyboard.up(key); };

  let c0 = await cam();
  await holdKey('w', 600);
  let c1 = await cam();
  check(d3(c0.p, c1.p) > 1 && Math.abs(c1.p[1] - c0.p[1]) < 0.01, `W moves forward along the ground (${d3(c0.p, c1.p).toFixed(1)} m)`);
  check(Math.abs(d3(c0.p, c0.t) - d3(c1.p, c1.t)) < 0.01, 'camera target moves with the camera (walking, not zooming)');
  c0 = c1; await holdKey('a', 500); c1 = await cam();
  check(d3(c0.p, c1.p) > 1, `A strafes left (${d3(c0.p, c1.p).toFixed(1)} m)`);
  c0 = c1; await holdKey('ArrowDown', 500); c1 = await cam();
  check(d3(c0.p, c1.p) > 1, `Arrow down moves backward (${d3(c0.p, c1.p).toFixed(1)} m)`);
  c0 = c1; await holdKey('x', 500); c1 = await cam();
  check(c1.p[1] - c0.p[1] > 1, `X raises the camera (${(c1.p[1] - c0.p[1]).toFixed(1)} m)`);
  c0 = c1; await holdKey('q', 500); c1 = await cam();
  check(Math.abs(c1.yaw - c0.yaw) > 0.3, `Q turns the view (${(((c1.yaw - c0.yaw) * 180) / Math.PI).toFixed(0)}°)`);
  c0 = c1; await holdKey('t', 400); c1 = await cam();
  check(Math.abs(c1.pitch - c0.pitch) > 0.1, `T tilts the view (${(((c1.pitch - c0.pitch) * 180) / Math.PI).toFixed(0)}°)`);
  c0 = c1; await holdKey('Minus', 400); c1 = await cam();
  check(d3(c1.p, c1.t) > d3(c0.p, c0.t) * 1.3, 'minus key zooms out');
  await holdKey('z', 4000);
  c1 = await cam();
  check(c1.p[1] >= 0.29, `camera cannot go below the ground (y=${c1.p[1].toFixed(2)})`);
  await page.screenshot({ path: path.join(shots, 'camera-keyboard.png') });

  // Mouse: right-drag orbits, ctrl+right-drag pans, wheel zooms.
  await page.click('#view-grid button[data-view="reset"]');
  await waitSim(page, 0.2);
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  c0 = await cam();
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(mid.x + 250, mid.y + 60, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await waitSim(page, 0.5);
  c1 = await cam();
  check(Math.abs(c1.yaw - c0.yaw) > 0.3 && d3(c0.t, c1.t) < 0.01, `right-drag orbits around the target (${(((c1.yaw - c0.yaw) * 180) / Math.PI).toFixed(0)}°)`);
  await page.screenshot({ path: path.join(shots, 'camera-orbit.png') });
  c0 = c1;
  await page.keyboard.down('Control');
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(mid.x - 200, mid.y, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Control');
  await waitSim(page, 0.5);
  c1 = await cam();
  check(d3(c0.t, c1.t) > 1, `ctrl+right-drag pans (${d3(c0.t, c1.t).toFixed(1)} m)`);
  c0 = c1;
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
  await waitSim(page, 0.5);
  c1 = await cam();
  check(d3(c1.p, c1.t) < d3(c0.p, c0.t) * 0.8, `mouse wheel zooms in (${d3(c0.p, c0.t).toFixed(1)} → ${d3(c1.p, c1.t).toFixed(1)} m)`);

  // Camera tool: left-drag orbits.
  await page.click('#tool-grid button[data-key="camera"]');
  c0 = await cam();
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x - 220, mid.y, { steps: 12 });
  await page.mouse.up();
  await waitSim(page, 0.5);
  c1 = await cam();
  check(Math.abs(c1.yaw - c0.yaw) > 0.3, 'camera tool: left-drag orbits');
  await page.click('#tool-grid button[data-key="push"]');

  // View presets.
  for (const view of ['front', 'back', 'left', 'right', 'top', 'low', 'ragdoll', 'reset']) {
    c0 = await cam();
    await page.click(`#view-grid button[data-view="${view}"]`);
    await waitSim(page, 0.4);
    c1 = await cam();
    const ok = view === 'top' ? c1.pitch < -1.4 : view === 'low' ? c1.pitch > -0.3 : d3(c0.p, c1.p) > 0.5 || view === 'reset';
    check(ok, `view "${view}" (camera at ${c1.p.map((v) => v.toFixed(1)).join(', ')}, pitch ${((c1.pitch * 180) / Math.PI).toFixed(0)}°)`);
    await page.screenshot({ path: path.join(shots, `view-${view}.png`) });
  }

  // Follow mode keeps the ragdoll at the orbit target while it flies.
  await page.evaluate(() => window.app.loadSceneById('preset-office-building'));
  await page.keyboard.press('f');
  await page.evaluate(() => window.app.kick(6));
  await waitSim(page, 4);
  const gap = await page.evaluate(() => {
    const p = window.app.sim.ragdolls().at(-1).parts.torso.position;
    return window.app.renderer.controls.target.distanceTo(p);
  });
  check(gap < 1.5, `follow mode tracks the falling ragdoll (target ${gap.toFixed(2)} m from torso)`);
  await page.screenshot({ path: path.join(shots, 'camera-follow.png') });
  await page.keyboard.press('f');

  // Balancing human: place it with the mouse, verify it keeps standing, then shove it over.
  console.log('Balancing human');
  await page.evaluate(() => window.app.loadSceneById('preset-skate-park'));
  await page.evaluate(() => window.app.sim.clearItems());
  await page.click('#item-grid button[data-key="human"]');
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.85);
  const humanInfo = () => page.evaluate(() => {
    const h = window.app.sim.items.find((i) => i.kind === 'human');
    if (!h) return null;
    const p = h.parts.head.position;
    return { standing: h.balance.active, reason: h.balance.reason, headY: p.y, head: [p.x, p.y, p.z], torso: h.parts.torso.position.toArray?.() ?? [h.parts.torso.position.x, h.parts.torso.position.y, h.parts.torso.position.z] };
  });
  const placed = await humanInfo();
  check(!!placed, 'place tool adds a balancing human');
  await waitSim(page, 6);
  const settled = await humanInfo();
  check(settled.standing && settled.headY > 1.7, `human keeps standing on its own (head at ${settled.headY.toFixed(2)} m)`);
  check(d3(placed.head, settled.head) < 0.1, `human stands still (moved ${d3(placed.head, settled.head).toFixed(3)} m)`);
  await page.evaluate(() => window.app.focusRagdoll());
  await waitSim(page, 0.3);
  await page.screenshot({ path: path.join(shots, 'human-standing.png') });
  await page.click('#tool-grid button[data-key="push"]');
  const torsoPx = await page.evaluate(() => {
    const { renderer, sim } = window.app;
    const p = sim.items.find((i) => i.kind === 'human').parts.torso.position;
    const v = renderer.camera.position.clone().set(p.x, p.y, p.z).project(renderer.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  });
  await page.mouse.click(box.x + torsoPx.x * box.width, box.y + torsoPx.y * box.height);
  await waitSim(page, 0.6);
  await page.screenshot({ path: path.join(shots, 'human-falling.png') });
  await waitSim(page, 3);
  const fallen = await humanInfo();
  check(!fallen.standing && fallen.headY < 0.8, `strong push knocks the human over (${fallen.reason}, head at ${fallen.headY.toFixed(2)} m)`);
  const toastText = await page.evaluate(() => document.querySelector('#toast').textContent);
  check(toastText.includes('Human'), `knockout toast shown ("${toastText}")`);

  // Place items with the place tool.
  await page.evaluate(() => window.app.loadSceneById('preset-staircase'));
  await waitSim(page, 0.3);
  await page.click('#item-grid button[data-key="cratePyramid"]');
  const itemsBefore = await page.evaluate(() => window.app.sim.items.length);
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.8);
  await waitSim(page, 0.3);
  check((await page.evaluate(() => window.app.sim.items.length)) === itemsBefore + 1, 'place tool adds an item on click');

  // Physics modes.
  for (const mode of ['realistic', 'arcade', 'moon', 'zeroG', 'blackHole', 'bouncy']) {
    await page.evaluate(() => window.app.loadSceneById('preset-skate-park'));
    await page.click(`#mode-grid button[data-key="${mode}"]`);
    await page.evaluate(() => window.app.kick(5));
    await waitSim(page, 2.5);
    const ok = await page.evaluate(() => window.app.sim.isFinite() && window.app.sim.modeName);
    check(ok === mode, `mode ${mode} runs without NaNs`);
    await page.screenshot({ path: path.join(shots, `mode-${mode}.png`) });
  }
  await page.click('#mode-grid button[data-key="realistic"]');

  if (generatePrompt) {
    console.log(`AI generation: "${generatePrompt}"`);
    const userBefore = await page.evaluate(() => window.app.state.scenes.user.length);
    await page.fill('#chat-input', generatePrompt);
    await page.click('#chat-send');
    await page.waitForFunction((n) => window.app.state.scenes.user.length > n || document.querySelector('.msg.error'), userBefore, { timeout: 600000 });
    const err = await page.evaluate(() => document.querySelector('.msg.error')?.textContent);
    check(!err, `chat generated a scene${err ? `: ${err}` : ''}`);
    if (!err) {
      await waitSim(page, 1);
      await page.evaluate(() => window.app.kick(6));
      await waitSim(page, 3);
      const info = await page.evaluate(() => ({ name: window.app.state.scene.name, n: window.app.state.scene.objects.length, finite: window.app.sim.isFinite() }));
      check(info.finite, `generated scene "${info.name}" (${info.n} objects) simulates`);
      await page.screenshot({ path: path.join(shots, 'generated.png') });
    }
  }

  check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll e2e checks passed');
process.exit(failures.length ? 1 : 0);
