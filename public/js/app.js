import * as THREE from 'three';
import { PhysicsSim, PHYSICS_MODES, ITEM_LABELS, CANNON } from './sim/physics.js';
import { Renderer } from './render/renderer.js';

const $ = (sel) => document.querySelector(sel);

const TOOLS = {
  place: { label: '📍 Place item', hint: 'Click a surface to place the selected item.' },
  push: { label: '👉 Push', hint: 'Click an object to shove it away from you.' },
  snowball: { label: '❄️ Snowball', hint: 'Click (or hold) to throw snowballs at what you aim at.' },
  bowling: { label: '🎳 Bowling ball', hint: 'Click to hurl a heavy 7 kg ball.' },
  blower: { label: '💨 Air blower', hint: 'Hold the mouse to blast a cone of air pressure.' },
  explosion: { label: '💥 Shockwave', hint: 'Click a point to release a radial blast.' },
  grab: { label: '✋ Grab & drag', hint: 'Drag an object around with a spring. Release to let go (or fling!).' },
  camera: { label: '🎥 Camera', hint: 'Left-drag to turn, Shift+left-drag or middle-drag to pan, wheel to zoom.' },
};

const state = {
  tool: 'push',
  item: 'ragdoll',
  strength: 4,
  timeScale: 1,
  paused: false,
  scene: null,
  scenes: { presets: [], user: [] },
  chat: false,
  statusLoaded: false,
  pointerDown: false,
  pointer: new THREE.Vector2(),
  lastFire: 0,
  dragPlane: new THREE.Plane(),
};

const sim = new PhysicsSim();
const renderer = new Renderer($('#viewport'), sim);
const canvas = renderer.renderer.domElement;
sim.on('knockout', ({ reason }) => toast(`💫 Human ${reason}!`));

// ---------------- UI construction ----------------
function buildButtons(container, entries, current, onClick) {
  container.innerHTML = '';
  for (const [key, label] of entries) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.key = key;
    if (key === current) b.classList.add('active');
    b.addEventListener('click', () => {
      container.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onClick(key);
    });
    container.appendChild(b);
  }
}

buildButtons($('#item-grid'), Object.entries(ITEM_LABELS), state.item, (k) => { state.item = k; setTool('place'); });
buildButtons($('#tool-grid'), Object.entries(TOOLS).map(([k, t]) => [k, t.label]), state.tool, (k) => setTool(k));
buildButtons($('#mode-grid'), Object.entries(PHYSICS_MODES).map(([k, m]) => [k, m.label]), 'realistic', (k) => setMode(k));

function setTool(tool) {
  state.tool = tool;
  $('#tool-grid').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === tool));
  renderer.controls.mouseButtons.LEFT = tool === 'camera' ? THREE.MOUSE.ROTATE : null;
  const extra = tool === 'place' ? ` (${ITEM_LABELS[state.item]})` : '';
  $('#hint').textContent = `${TOOLS[tool].hint}${extra}  ·  WASD move · Q/E turn · right-drag look around · wheel zoom`;
}

function setMode(mode) {
  sim.setMode(mode);
  $('#mode-grid').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === mode));
  $('#mode-desc').textContent = PHYSICS_MODES[mode].description;
  updateWind();
}

$('#strength').addEventListener('input', (e) => {
  state.strength = Number(e.target.value);
  $('#strength-out').textContent = e.target.value;
  updateWind();
});
$('#timescale').addEventListener('input', (e) => {
  state.timeScale = Number(e.target.value);
  $('#timescale-out').textContent = `${state.timeScale.toFixed(1)}×`;
});
$('#wind').addEventListener('change', updateWind);

function updateWind() {
  if (!$('#wind').checked) return sim.setWind(null);
  const dir = new THREE.Vector3();
  renderer.camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize().multiplyScalar(state.strength * 1.5);
  sim.setWind([dir.x, 0, dir.z]);
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------------- actions ----------------
function dropRagdoll() {
  if (!state.scene) return null;
  const s = state.scene.spawn;
  const item = sim.addItem('ragdoll', s.position, s.rotationY);
  toast('Ragdoll dropped');
  return item;
}

function latestRagdoll() {
  const r = sim.ragdolls();
  return r[r.length - 1];
}

function kick(strength = state.strength) {
  const doll = latestRagdoll() ?? dropRagdoll();
  if (!doll) return;
  const torso = doll.parts.torso;
  const facing = torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
  const dir = [facing.x, 0.25, facing.z];
  sim.push(torso, [torso.position.x, torso.position.y, torso.position.z], dir, 75 * strength);
  renderer.spawnPushMarker(new THREE.Vector3().copy(torso.position), new THREE.Vector3(...dir));
}

function togglePause() {
  state.paused = !state.paused;
  $('#btn-pause').textContent = state.paused ? '▶ Resume' : '⏸ Pause';
}

$('#btn-drop').addEventListener('click', dropRagdoll);
$('#btn-kick').addEventListener('click', () => kick());
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-reset').addEventListener('click', () => state.scene && applyScene(state.scene));
$('#btn-clear').addEventListener('click', () => sim.clearItems());

// ---------------- camera navigation ----------------
const heldKeys = new Set();
const CAMERA_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyT', 'KeyG', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);

function setFollow(on) {
  $('#follow').checked = on;
  toast(on ? 'Following the ragdoll' : 'Free camera');
}
$('#follow').addEventListener('change', (e) => setFollow(e.target.checked));

function focusRagdoll() {
  const doll = latestRagdoll();
  if (!doll) return;
  const p = doll.parts.torso.position;
  const offset = renderer.camera.position.clone().sub(renderer.controls.target).setLength(6);
  renderer.controls.target.set(p.x, p.y, p.z);
  renderer.camera.position.copy(renderer.controls.target).add(offset);
}

$('#view-grid').addEventListener('click', (e) => {
  const view = e.target.closest('button')?.dataset.view;
  if (!view) return;
  if (view === 'reset') state.scene && renderer.setCamera(state.scene.camera.position, state.scene.camera.target);
  else if (view === 'ragdoll') focusRagdoll();
  else renderer.viewFrom(view);
});

function updateCameraKeys(dt) {
  if (!heldKeys.size) return;
  const k = (...codes) => (codes.some((c) => heldKeys.has(c)) ? 1 : 0);
  const fast = k('ShiftLeft', 'ShiftRight') ? 3 : 1;
  // Move faster when zoomed out so large scenes stay navigable.
  const dist = renderer.camera.position.distanceTo(renderer.controls.target);
  const speed = Math.max(4, dist * 0.8) * fast * dt;
  const forward = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  const right = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  const up = k('KeyX') - k('KeyZ');
  if (forward || right || up) renderer.moveCamera(forward * speed, right * speed, up * speed);
  const yaw = k('KeyQ') - k('KeyE');
  const pitch = k('KeyG') - k('KeyT');
  if (yaw || pitch) renderer.orbitCamera(yaw * 1.6 * fast * dt, pitch * 1.0 * fast * dt);
  const zoom = k('Minus', 'NumpadSubtract') - k('Equal', 'NumpadAdd');
  if (zoom) renderer.zoomCamera(Math.exp(zoom * 1.5 * fast * dt));
}

window.addEventListener('keyup', (e) => heldKeys.delete(e.code));
window.addEventListener('blur', () => heldKeys.clear());

window.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea, input[type="text"]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (CAMERA_CODES.has(e.code) || e.code.startsWith('Shift')) {
    heldKeys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  const toolKeys = Object.keys(TOOLS);
  if (e.key >= '1' && e.key <= String(toolKeys.length)) setTool(toolKeys[Number(e.key) - 1]);
  else if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.code === 'Backspace') { e.preventDefault(); state.scene && applyScene(state.scene); }
  else if (e.code === 'KeyK') kick();
  else if (e.code === 'KeyN') dropRagdoll();
  else if (e.code === 'KeyF') setFollow(!$('#follow').checked);
  else if (e.code === 'KeyC') focusRagdoll();
});

// ---------------- pointer tools ----------------
function updatePointer(e) {
  const r = canvas.getBoundingClientRect();
  state.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
const isDynamic = (body) => body && body.type === CANNON.Body.DYNAMIC;
const v3 = (v) => [v.x, v.y, v.z];

function throwFrom(kind, hit) {
  const origin = renderer.camera.position.clone().add(new THREE.Vector3(0, -0.3, 0));
  // Aim at the center of a movable object, otherwise at the clicked surface point.
  const target = isDynamic(hit.body) ? new THREE.Vector3().copy(hit.body.position) : (hit.point ?? hit.ray.at(30, new THREE.Vector3()));
  const v = sim.projectileSpeed(kind, 12 + state.strength * 3);
  const g = Math.abs(sim.world.gravity.y);
  const delta = target.clone().sub(origin);
  const horiz = new THREE.Vector3(delta.x, 0, delta.z);
  const dx = horiz.length();
  let dir = delta.clone().normalize();
  if (g > 0 && dx > 0.01) {
    // Exact low-arc ballistic launch angle; falls back to a straight shot when out of range.
    const disc = v ** 4 - g * (g * dx * dx + 2 * delta.y * v * v);
    if (disc >= 0) {
      const angle = Math.atan((v * v - Math.sqrt(disc)) / (g * dx));
      horiz.normalize();
      dir = new THREE.Vector3(horiz.x * Math.cos(angle), Math.sin(angle), horiz.z * Math.cos(angle));
    }
  }
  sim.throwProjectile(kind, v3(origin), v3(dir), 12 + state.strength * 3);
}

function primaryAction(hit, initial) {
  const now = performance.now();
  switch (state.tool) {
    case 'place':
      if (!initial || !hit.point) return;
      {
        const cam = renderer.camera.position;
        const rotY = (Math.atan2(cam.x - hit.point.x, cam.z - hit.point.z) * 180) / Math.PI;
        sim.addItem(state.item, v3(hit.point), rotY);
      }
      break;
    case 'push': {
      if (!initial || !isDynamic(hit.body)) return;
      // Shove mostly horizontally with a little lift, instead of pressing the object into the floor.
      const dir = hit.ray.direction.clone();
      dir.y = Math.max(dir.y, 0.2);
      dir.normalize();
      sim.push(hit.body, v3(hit.point), v3(dir), 80 * state.strength);
      renderer.spawnPushMarker(hit.point, dir);
      break;
    }
    case 'snowball':
      if (!initial && now - state.lastFire < 130) return;
      state.lastFire = now;
      throwFrom('snowball', hit);
      break;
    case 'bowling':
      if (!initial) return;
      throwFrom('bowling', hit);
      break;
    case 'blower': {
      const origin = renderer.camera.position.clone();
      sim.blow(v3(origin), v3(hit.ray.direction), 8 * state.strength, 0.06);
      renderer.spawnAirParticles(origin, hit.ray.direction, state.strength);
      break;
    }
    case 'explosion':
      if (!initial || !hit.point) return;
      sim.explode(v3(hit.point), 3 + state.strength * 0.6, 8 * state.strength);
      renderer.spawnExplosion(hit.point, 3 + state.strength * 0.6);
      break;
    case 'grab':
      if (!initial || !isDynamic(hit.body)) return;
      sim.grab(hit.body, v3(hit.point));
      state.dragPlane.setFromNormalAndCoplanarPoint(renderer.camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point);
      break;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.tool === 'camera') return;
  updatePointer(e);
  state.pointerDown = true;
  canvas.setPointerCapture(e.pointerId);
  primaryAction(renderer.pick(state.pointer), true);
});
canvas.addEventListener('pointermove', (e) => {
  updatePointer(e);
  if (state.pointerDown && state.tool === 'grab' && sim.grabbed) {
    renderer.raycaster.setFromCamera(state.pointer, renderer.camera);
    const p = renderer.raycaster.ray.intersectPlane(state.dragPlane, new THREE.Vector3());
    if (p) sim.moveGrab(v3(p));
  }
});
const endPointer = () => {
  state.pointerDown = false;
  sim.release();
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------- scenes ----------------
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function renderSceneLists() {
  const fill = (ul, list, emptyText) => {
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = `<li class="empty">${emptyText}</li>`;
      return;
    }
    for (const s of list) {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      li.title = s.prompt ? `Prompt: ${s.prompt}` : s.description;
      li.innerHTML = `<span></span><small></small>`;
      li.firstChild.textContent = s.name;
      li.lastChild.textContent = s.prompt ? `“${s.prompt}”` : s.description;
      li.classList.toggle('active', state.scene?.id === s.id);
      li.addEventListener('click', () => loadSceneById(s.id));
      ul.appendChild(li);
    }
  };
  fill($('#preset-list'), state.scenes.presets, 'No presets — run npm run build');
  fill($('#user-list'), state.scenes.user, state.chat ? 'Describe a place in the chat →' : 'No generated scenes yet');
  $('#user-count').textContent = state.scenes.user.length;
}

async function refreshScenes() {
  state.scenes = await fetchJson('/api/scenes');
  renderSceneLists();
}

function applyScene(scene) {
  state.scene = scene;
  sim.loadScene(scene);
  renderer.applyEnvironment(scene.environment);
  renderer.setCamera(scene.camera.position, scene.camera.target);
  $('#scene-title').textContent = scene.name;
  $('#scene-desc').textContent = scene.description;
  document.querySelectorAll('.scene-list li').forEach((li) => li.classList.toggle('active', li.dataset.id === scene.id));
  if (location.hash !== `#${scene.id}`) history.replaceState(null, '', `#${scene.id}`);
  if (!scene.items.some((i) => i.kind === 'ragdoll')) dropRagdoll();
  updateWind();
}

async function loadSceneById(id) {
  const scene = await fetchJson(`/api/scenes/${encodeURIComponent(id)}`);
  applyScene(scene);
  return scene;
}

// ---------------- chat ----------------
// The chat is only shown when the server reports that GitHub Copilot is enabled and available.
function applyStatus(status) {
  state.chat = !!status.chat?.available;
  $('#chat').hidden = !state.chat;
  document.body.classList.toggle('chat-on', state.chat);
  $('#model-name').textContent = `Copilot SDK · ${status.model}`;
  renderSceneLists();
}

function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return div;
}

async function generate(prompt, modifyCurrent) {
  addMessage(prompt, 'user');
  const pending = addMessage('Designing your scene…', 'bot pending');
  $('#chat-send').disabled = true;
  const started = performance.now();
  const timer = setInterval(() => {
    const secs = Math.round((performance.now() - started) / 1000);
    pending.dataset.secs = secs;
    pending.textContent = `${pending.dataset.status ?? 'Designing your scene…'} (${secs}s)`;
  }, 1000);
  try {
    const res = await fetch('/api/scenes/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, baseSceneId: modifyCurrent ? state.scene?.id : undefined }),
    });
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    let scene = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const evt = JSON.parse(line);
        if (evt.type === 'status') pending.dataset.status = evt.message;
        else if (evt.type === 'progress') pending.dataset.status = `Writing scene JSON… ${evt.chars} chars`;
        else if (evt.type === 'error') throw new Error(evt.message);
        else if (evt.type === 'scene') scene = evt.scene;
      }
    }
    if (!scene) throw new Error('No scene received');
    clearInterval(timer);
    pending.classList.remove('pending');
    pending.textContent = `✅ ${scene.name} — ${scene.description}\n(${scene.objects.length} objects, saved permanently)`;
    await refreshScenes();
    applyScene(scene);
  } catch (err) {
    clearInterval(timer);
    pending.classList.remove('pending');
    pending.classList.add('error');
    pending.textContent = `⚠️ ${err.message}`;
  } finally {
    $('#chat-send').disabled = false;
  }
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = '';
  generate(prompt, $('#modify-current').checked);
});
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#chat-form').requestSubmit();
  }
});

// ---------------- main loop ----------------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.pointerDown && ['snowball', 'blower'].includes(state.tool)) primaryAction(renderer.pick(state.pointer), false);
  if (!state.paused) sim.step(dt * state.timeScale);
  updateCameraKeys(dt);
  if ($('#follow').checked) {
    const doll = latestRagdoll();
    if (doll) renderer.follow(doll.parts.torso.position, dt);
  }
  if ($('#wind').checked) updateWind();
  renderer.update(dt);
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) {
    fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0; fpsFrames = 0;
    $('#stats').textContent = `${fps} fps · ${sim.world.bodies.length} bodies · ${PHYSICS_MODES[sim.modeName].label}${state.paused ? ' · PAUSED' : ''}`;
  }
  requestAnimationFrame(frame);
}

async function init() {
  setTool(state.tool);
  setMode('realistic');
  fetchJson('/api/status').then(applyStatus).catch(() => {}).finally(() => (state.statusLoaded = true));
  await refreshScenes();
  const wanted = decodeURIComponent(location.hash.slice(1));
  const first = wanted || state.scenes.presets[0]?.id;
  if (first) await loadSceneById(first).catch(() => state.scenes.presets[0] && loadSceneById(state.scenes.presets[0].id));
  requestAnimationFrame(frame);
}

// Exposed for automated testing and console tinkering.
window.app = { sim, renderer, state, loadSceneById, dropRagdoll, kick, setMode, setTool, refreshScenes, focusRagdoll, ready: init() };
