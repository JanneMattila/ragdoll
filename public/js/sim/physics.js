import * as CANNON from 'cannon-es';
import { expandScene, wedgeGeometry } from '../shared/scene-format.js';

export { CANNON };

export const PHYSICS_MODES = {
  realistic: {
    label: 'Realistic', description: 'Earth gravity, real friction and joint limits.',
    gravity: [0, -9.82, 0], frictionScale: 1, restitutionBonus: 0, forceScale: 1, dampingScale: 1,
  },
  arcade: {
    label: 'Arcade', description: 'Snappy gravity, bouncy surfaces and 2.5x forces.',
    gravity: [0, -16, 0], frictionScale: 0.7, restitutionBonus: 0.45, forceScale: 2.5, dampingScale: 0.6,
  },
  moon: {
    label: 'Moon', description: 'One sixth gravity, long floaty arcs.',
    gravity: [0, -1.62, 0], frictionScale: 0.8, restitutionBonus: 0.05, forceScale: 0.8, dampingScale: 0.3,
  },
  zeroG: {
    label: 'Zero-G', description: 'Outer space: no gravity, things drift forever.',
    gravity: [0, 0, 0], frictionScale: 0.5, restitutionBonus: 0.3, forceScale: 0.5, dampingScale: 0.05,
  },
  blackHole: {
    label: 'Black hole', description: 'No gravity, but a tiny black hole pulls everything into orbit.',
    gravity: [0, 0, 0], frictionScale: 0.5, restitutionBonus: 0.2, forceScale: 0.7, dampingScale: 0.05, attractor: 140,
  },
  bouncy: {
    label: 'Bouncy castle', description: 'Everything is made of rubber.',
    gravity: [0, -9.82, 0], frictionScale: 0.9, restitutionBonus: 0.85, forceScale: 1.5, dampingScale: 0.5,
  },
};

const MATERIAL_BASE = {
  default: { friction: 0.7, restitution: 0.15 },
  wood: { friction: 0.75, restitution: 0.2 },
  metal: { friction: 0.45, restitution: 0.25 },
  concrete: { friction: 0.9, restitution: 0.1 },
  grass: { friction: 0.95, restitution: 0.05 },
  ice: { friction: 0.04, restitution: 0.1 },
  rubber: { friction: 0.9, restitution: 0.95 },
  ragdoll: { friction: 0.8, restitution: 0.1 },
  snow: { friction: 0.9, restitution: 0.02 },
  // cannon-es limits friction by each body's own mass, not by the load on it. Feet carry ~20x their
  // own weight while standing, so their grip is scaled up to match (still slips on ice).
  shoe: { friction: 18, restitution: 0.05 },
};

const GROUP_STATIC = 1, GROUP_DYNAMIC = 2, GROUP_PROJECTILE = 4;
const RAGDOLL_FIRST_BIT = 3, RAGDOLL_BITS = 27;

export const ITEM_LABELS = {
  ragdoll: '🧍 Ragdoll human',
  cratePyramid: '📦 Crate pyramid',
  tower: '🧱 Block tower',
  dominoes: '🁢 Dominoes',
  beachBall: '🏐 Beach ball',
  barrels: '🛢️ Barrel stack',
  snowman: '⛄ Snowman',
  human: '🕴️ Balancing human',
};

// Kinds built from a humanoid skeleton (pushes spread over the body, camera follows them, etc.).
export const HUMANOID_KINDS = ['ragdoll', 'human'];

const UP = new CANNON.Vec3(0, 1, 0);

const rotY = (deg) => new CANNON.Quaternion().setFromEuler(0, (deg * Math.PI) / 180, 0);

export class PhysicsSim {
  constructor() {
    const world = new CANNON.World();
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.solver.iterations = 20;
    world.solver.tolerance = 0.0001;
    world.defaultContactMaterial.contactEquationStiffness = 1e8;
    world.defaultContactMaterial.contactEquationRelaxation = 3;
    this.world = world;
    this.materials = {};
    for (const name of Object.keys(MATERIAL_BASE)) this.materials[name] = new CANNON.Material(name);
    this.items = [];
    this.projectiles = [];
    this.blasts = [];
    this.sceneBodies = [];
    this.listeners = { add: [], remove: [], knockout: [] };
    this.nextItemId = 1;
    this.ragdollCounter = 0;
    this.attractorPos = new CANNON.Vec3(0, 6, 0);
    this.time = 0;
    this.fixedStep = 1 / 120;
    this.setMode('realistic');

    const ground = new CANNON.Body({ mass: 0, material: this.materials.grass, collisionFilterGroup: GROUP_STATIC });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.userData = { kind: 'ground' };
    this.ground = ground;
    world.addBody(ground);

    world.addEventListener('preStep', () => this._preStep());
    world.addEventListener('postStep', () => this._projectileCcd());
  }

  // Minimal continuous collision detection: fast projectiles that crossed a body during the step are
  // moved back to the touching point so the next step resolves a proper collision instead of tunneling.
  _projectileCcd() {
    const result = new CANNON.RaycastResult();
    for (const p of this.projectiles) {
      const prev = p.userData.prevPos;
      p.userData.prevPos = p.position.clone();
      if (!prev || p.velocity.length() < 6) continue;
      const r = p.shapes[0].radius;
      const dir = p.position.vsub(prev);
      const len = dir.length();
      if (len < 1e-6) continue;
      dir.scale(1 / len, dir);
      result.reset();
      p.collisionFilterGroup = 0;
      this.world.raycastClosest(prev, p.position.vadd(dir.scale(r)), { skipBackfaces: true }, result);
      p.collisionFilterGroup = GROUP_PROJECTILE;
      if (result.hasHit && result.body !== p && result.distance > 0) {
        p.position.copy(result.hitPointWorld.vsub(dir.scale(r * 1.02)));
        p.userData.prevPos = p.position.clone();
      }
      // Sleeping bodies are immovable during the step they are hit, so wake whatever is just ahead.
      const ahead = p.velocity.scale(this.fixedStep * 3);
      result.reset();
      p.collisionFilterGroup = 0;
      this.world.raycastClosest(p.position, p.position.vadd(ahead).vadd(dir.scale(r * 2)), {}, result);
      p.collisionFilterGroup = GROUP_PROJECTILE;
      const target = result.hasHit ? result.body : null;
      if (target && target.type === CANNON.Body.DYNAMIC && target.sleepState === CANNON.Body.SLEEPING) {
        const item = this.items.find((i) => i.id === target.userData?.itemId);
        for (const b of item ? item.bodies : [target]) b.wakeUp();
      }
    }
  }

  on(evt, fn) { this.listeners[evt].push(fn); }
  _emit(evt, arg) { for (const fn of this.listeners[evt]) fn(arg); }

  _addBody(body) {
    this.world.addBody(body);
    this._applyDamping(body);
    this._emit('add', body);
    return body;
  }
  _removeBody(body) {
    this.world.removeBody(body);
    this._emit('remove', body);
  }

  // ---------------- modes ----------------
  setMode(name) {
    const mode = PHYSICS_MODES[name] ?? PHYSICS_MODES.realistic;
    this.modeName = PHYSICS_MODES[name] ? name : 'realistic';
    this.mode = mode;
    this.world.gravity.set(...mode.gravity);
    // cannon-es clamps friction impulses with a force limit (mu * |g| * m), making friction ~1/h too strong
    // and also zero in zero-G. frictionGravity rescales it to realistic values (calibrated for box contacts).
    const gLen = Math.max(3, Math.hypot(...mode.gravity));
    this.world.frictionGravity = new CANNON.Vec3(0, gLen * this.fixedStep * 0.3, 0);
    for (const [key, mat] of Object.entries(this.materials)) {
      const base = MATERIAL_BASE[key];
      mat.friction = base.friction * mode.frictionScale;
      mat.restitution = Math.min(0.98, base.restitution + mode.restitutionBonus);
    }
    this.world.allowSleep = !mode.attractor && mode.gravity[1] !== 0;
    for (const body of this.world.bodies) {
      this._applyDamping(body);
      if (body.type === CANNON.Body.DYNAMIC) body.wakeUp();
    }
  }
  _applyDamping(body) {
    if (body.type !== CANNON.Body.DYNAMIC) return;
    const base = body.userData?.damping ?? [0.01, 0.05];
    body.linearDamping = Math.min(0.99, base[0] * this.mode.dampingScale);
    body.angularDamping = Math.min(0.99, base[1] * this.mode.dampingScale);
  }

  // ---------------- scene ----------------
  loadScene(scene) {
    this.clearItems();
    for (const b of this.sceneBodies) this._removeBody(b);
    this.sceneBodies = [];
    this.scene = scene;
    for (const p of expandScene(scene)) {
      const dynamic = p.dynamic && p.mass > 0;
      const body = new CANNON.Body({
        mass: dynamic ? p.mass : 0,
        type: dynamic ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
        material: this.materials[p.material] ?? this.materials.default,
        collisionFilterGroup: dynamic ? GROUP_DYNAMIC : GROUP_STATIC,
        position: new CANNON.Vec3(...p.position),
        quaternion: new CANNON.Quaternion(...p.quaternion),
      });
      body.addShape(...makeShape(p));
      body.userData = { kind: dynamic ? 'prop' : 'static', color: p.color, material: p.material, name: p.name, damping: [0.02, 0.1] };
      if (dynamic) body.sleep();
      this._addBody(body);
      this.sceneBodies.push(body);
    }
    // Attractor sits above the scene's center of interest.
    const s = scene.spawn.position;
    this.attractorPos.set(s[0], s[1] + 5, s[2]);
    for (const it of scene.items) this.addItem(it.kind, it.position, it.rotationY);
  }

  // ---------------- items ----------------
  addItem(kind, position, rotationYDeg = 0) {
    const builder = ITEM_BUILDERS[kind];
    if (!builder) throw new Error(`Unknown item kind: ${kind}`);
    const origin = new CANNON.Vec3(position[0], position[1] + 0.02, position[2]);
    const q = rotY(rotationYDeg);
    const item = { id: this.nextItemId++, kind, bodies: [], constraints: [] };
    builder.call(this, item, origin, q);
    for (const b of item.bodies) {
      b.userData.itemId = item.id;
      this._addBody(b);
    }
    for (const c of item.constraints) this.world.addConstraint(c);
    this.items.push(item);
    return item;
  }

  removeItem(item) {
    if (this.grabbed && item.bodies.includes(this.grabbed.body)) this.release();
    for (const c of item.constraints) this.world.removeConstraint(c);
    for (const b of item.bodies) this._removeBody(b);
    this.items = this.items.filter((i) => i !== item);
  }

  clearItems() {
    this.release();
    for (const item of [...this.items]) this.removeItem(item);
    for (const p of this.projectiles) this._removeBody(p);
    this.projectiles = [];
    this.blasts = [];
  }

  _dynBody(item, shape, localPos, origin, q, mass, opts = {}) {
    const pos = origin.vadd(q.vmult(localPos));
    const body = new CANNON.Body({
      mass,
      material: this.materials[opts.material ?? 'wood'],
      position: pos,
      quaternion: opts.quaternion ? q.mult(opts.quaternion) : q.clone(),
      collisionFilterGroup: opts.group ?? GROUP_DYNAMIC,
      collisionFilterMask: opts.mask ?? -1,
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 1,
    });
    body.addShape(shape);
    body.userData = { kind: item.kind, color: opts.color ?? '#c8a165', part: opts.part, damping: opts.damping ?? [0.02, 0.1] };
    item.bodies.push(body);
    return body;
  }

  // ---------------- forces ----------------
  get forceScale() { return this.mode.forceScale; }

  /** Instant impulse at a world point on a body (push / kick / punch). */
  push(body, point, direction, strength) {
    if (!body || body.type !== CANNON.Body.DYNAMIC) return;
    const dir = new CANNON.Vec3(...direction); dir.normalize();
    const impulse = dir.scale(strength * this.forceScale);
    const item = this.items.find((i) => i.id === body.userData.itemId);
    if (item && HUMANOID_KINDS.includes(item.kind)) {
      // A real push moves the whole body: half of it hits the touched part, the rest spreads by mass.
      body.wakeUp();
      body.applyImpulse(impulse.scale(0.5), new CANNON.Vec3(...point).vsub(body.position));
      for (const b of item.bodies) {
        b.wakeUp();
        b.applyImpulse(impulse.scale((0.5 * b.mass) / item.totalMass));
      }
      return;
    }
    body.wakeUp();
    body.applyImpulse(impulse, new CANNON.Vec3(...point).vsub(body.position));
  }

  /** Actual launch speed for a projectile kind (used for aiming). */
  projectileSpeed(kind, speed) {
    const spec = PROJECTILES[kind] ?? PROJECTILES.snowball;
    return speed * spec.speedScale * Math.sqrt(this.forceScale);
  }

  /** Throws a projectile (snowball, bowling ball, ...) from origin along velocity. */
  throwProjectile(kind, origin, direction, speed) {
    const spec = PROJECTILES[kind] ?? PROJECTILES.snowball;
    const body = new CANNON.Body({
      mass: spec.mass,
      material: this.materials[spec.material],
      position: new CANNON.Vec3(...origin),
      collisionFilterGroup: GROUP_PROJECTILE,
      collisionFilterMask: -1,
      linearDamping: 0.01,
      angularDamping: 0.1,
    });
    body.addShape(new CANNON.Sphere(spec.radius));
    const dir = new CANNON.Vec3(...direction); dir.normalize();
    body.velocity.copy(dir.scale(this.projectileSpeed(kind, speed)));
    body.userData = { kind: 'projectile', projectile: kind, color: spec.color, born: this.time, damping: [0.01, 0.1] };
    body.allowSleep = false;
    this._addBody(body);
    this.projectiles.push(body);
    while (this.projectiles.length > 80) this._removeBody(this.projectiles.shift());
    return body;
  }

  /** Radial explosion impulse. */
  explode(center, radius, strength) {
    const c = new CANNON.Vec3(...center);
    for (const body of this.world.bodies) {
      if (body.type !== CANNON.Body.DYNAMIC) continue;
      const d = body.position.vsub(c);
      const dist = d.length();
      if (dist > radius) continue;
      d.y += 0.5 * Math.max(dist, 0.3);
      d.normalize();
      const falloff = 1 - dist / radius;
      body.wakeUp();
      body.applyImpulse(d.scale(strength * falloff * body.mass * 0.25 * this.forceScale));
    }
  }

  /** Starts a cone-shaped stream of air (leaf blower / air cannon). Re-called each frame while held. */
  blow(origin, direction, strength, duration = 0.05) {
    const dir = new CANNON.Vec3(...direction); dir.normalize();
    this.blasts.push({ origin: new CANNON.Vec3(...origin), dir, strength, until: this.time + duration });
  }

  /** Global wind (air pressure) that pushes everything in a direction. */
  setWind(vec) { this.wind = vec ? new CANNON.Vec3(...vec) : null; }

  /** Grab a body at a world point with a spring-like point constraint (mouse drag). */
  grab(body, point) {
    this.release();
    if (!body || body.type !== CANNON.Body.DYNAMIC) return false;
    const p = new CANNON.Vec3(...point);
    const anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, position: p, collisionFilterGroup: 0, collisionFilterMask: 0 });
    this.world.addBody(anchor);
    const local = body.pointToLocalFrame(p);
    const c = new CANNON.PointToPointConstraint(body, local, anchor, new CANNON.Vec3(0, 0, 0), 4000);
    this.world.addConstraint(c);
    // Sleeping bodies don't move in the solver, so wake the whole item (e.g. every limb of a human)
    // or the grabbed part would be pulled out of its joints instead of dragging the body along.
    const item = this.items.find((i) => i.id === body.userData?.itemId);
    this.grabbed = { body, anchor, constraint: c, bodies: item ? item.bodies : [body] };
    this._wakeGrabbed();
    return true;
  }
  moveGrab(point) {
    if (!this.grabbed) return;
    this.grabbed.anchor.position.set(...point);
    this._wakeGrabbed();
  }
  _wakeGrabbed() {
    for (const b of this.grabbed.bodies) b.wakeUp();
  }
  release() {
    if (!this.grabbed) return;
    this.world.removeConstraint(this.grabbed.constraint);
    this.world.removeBody(this.grabbed.anchor);
    this.grabbed = null;
  }

  _preStep() {
    if (this.grabbed) this._wakeGrabbed();
    this._balance();
    const fs = this.forceScale;
    this.blasts = this.blasts.filter((b) => b.until > this.time);
    const dyn = this.world.bodies.filter((b) => b.type === CANNON.Body.DYNAMIC);
    for (const blast of this.blasts) {
      for (const body of dyn) {
        const rel = body.position.vsub(blast.origin);
        const dist = rel.length();
        if (dist < 0.01 || dist > 30) continue;
        const along = rel.dot(blast.dir);
        if (along <= 0) continue;
        const cos = along / dist;
        if (cos < 0.93) continue; // ~21 degree cone
        const falloff = (1 - dist / 30) * ((cos - 0.93) / 0.07);
        // Air pressure scales with exposed area, roughly mass^(2/3).
        const f = blast.dir.scale(blast.strength * fs * falloff * Math.pow(body.mass, 0.66) * 2.5);
        body.wakeUp();
        body.applyForce(f);
      }
    }
    if (this.wind) {
      for (const body of dyn) {
        body.wakeUp();
        body.applyForce(this.wind.scale(Math.pow(body.mass, 0.66) * fs));
      }
    }
    if (this.mode.attractor) {
      for (const body of dyn) {
        const d = this.attractorPos.vsub(body.position);
        const r2 = Math.max(d.lengthSquared(), 1);
        d.normalize();
        // Tangential swirl makes things orbit instead of just colliding in the middle.
        const swirl = new CANNON.Vec3(-d.z, 0, d.x).scale(0.35);
        const f = d.vadd(swirl).scale((this.mode.attractor * body.mass) / Math.sqrt(r2));
        body.wakeUp();
        body.applyForce(f);
      }
    }
  }

  step(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.world.step(this.fixedStep, dt, 12);
    // Cleanup: old projectiles and things lost in space.
    for (const p of [...this.projectiles]) {
      if (this.time - p.userData.born > 15 || p.position.y < -50) {
        this._removeBody(p);
        this.projectiles = this.projectiles.filter((x) => x !== p);
      }
    }
    for (const item of [...this.items]) {
      if (item.bodies.every((b) => b.position.length() > 400 || b.position.y < -100)) this.removeItem(item);
    }
  }

  /** All humanoids (limp ragdolls and balancing humans), oldest first. */
  ragdolls() { return this.items.filter((i) => HUMANOID_KINDS.includes(i.kind)); }

  // ---------------- balancing human ----------------
  // The body above the ankles is held in a standing pose by lock constraints ("muscles"), and an
  // ankle-strategy PD controller tilts it back over the feet. The corrective torque acts on the body
  // and, with equal and opposite reaction, on the feet, so balance is only possible while the feet
  // press on something and is limited by the foot's grip and size, like a real person.
  _balance() {
    const humans = this.items.filter((i) => i.balance?.active);
    if (!humans.length) return;
    const touching = new Set();
    for (const c of this.world.contacts) { touching.add(c.bi); touching.add(c.bj); }
    const h = this.fixedStep;
    for (const item of humans) {
      const b = item.balance;
      const { pelvis, footL, footR } = item.parts;
      // Sleep together: a hit on one sleeping part (e.g. by a snowball) must wake the whole body,
      // while a calm body whose first parts dozed off goes to sleep as a whole.
      const asleep = item.bodies.filter((x) => x.sleepState === CANNON.Body.SLEEPING).length;
      if (asleep === item.bodies.length) continue;
      if (asleep > 0) {
        const moving = item.bodies.some((x) => x.sleepState !== CANNON.Body.SLEEPING
          && x.velocity.lengthSquared() + x.angularVelocity.lengthSquared() > 0.04);
        for (const x of item.bodies) moving ? x.wakeUp() : x.sleep();
        if (!moving) continue;
      }
      const up = pelvis.quaternion.vmult(UP);
      const tilt = Math.acos(Math.max(-1, Math.min(1, up.y)));
      if (tilt > b.maxTilt) { this.knockOut(item, 'lost balance'); continue; }
      const grounded = touching.has(footL) || touching.has(footR);
      b.airTime = grounded ? 0 : b.airTime + h;
      if (b.airTime > 0.35) { this.knockOut(item, 'swept off its feet'); continue; }
      if (!grounded || this.world.gravity.length() < 0.5) continue;
      // Relaxed stance: the posed body is statically stable on its feet, so muscles only engage on a
      // real disturbance and relax again once upright and calm (hysteresis avoids jitter from noise).
      const w = pelvis.angularVelocity;
      const spin = w.x * w.x + w.z * w.z;
      if (!b.engaged && (tilt > 0.035 || spin > 0.09)) b.engaged = true;
      else if (b.engaged && tilt < 0.005 && spin < 0.0025) b.engaged = false;
      if (!b.engaged) continue;

      const target = UP;
      const err = up.cross(target);
      const g = this.world.gravity.length() / 9.82;
      const torque = new CANNON.Vec3(
        err.x * b.kp * g - w.x * b.kd * Math.sqrt(g),
        -w.y * b.kd * 0.2,
        err.z * b.kp * g - w.z * b.kd * Math.sqrt(g),
      );
      const max = b.maxTorque * g;
      const mag = torque.length();
      if (mag > max) torque.scale(max / mag, torque);
      // Ankle torque only works while the centre of mass is above the feet: outside the support
      // area the feet would roll onto their edges, so the human topples like a real person.
      const pivot = footL.position.vadd(footR.position).scale(0.5);
      const com = new CANNON.Vec3();
      for (const part of item.bodies) com.vadd(part.position.scale(part.mass), com);
      com.scale(1 / item.totalMass, com);
      const fwd = footL.quaternion.vmult(new CANNON.Vec3(0, 0, 1)).vadd(footR.quaternion.vmult(new CANNON.Vec3(0, 0, 1)));
      fwd.y = 0;
      fwd.normalize();
      const rel = com.vsub(pivot);
      const along = rel.x * fwd.x + rel.z * fwd.z;
      const side = rel.x * fwd.z - rel.z * fwd.x;
      const halfWidth = Math.abs((footL.position.x - footR.position.x) * fwd.z - (footL.position.z - footR.position.z) * fwd.x) / 2 + 0.06;
      b.supported = Math.abs(side) < halfWidth && along > -0.1 && along < 0.14;
      if (!b.supported) continue;
      // Turn the torque into forces on every body part that rotate the locked body rigidly about the
      // ankles (so the lock constraints don't have to transmit it). The ground carries the reaction.
      let inertia = 0;
      for (const part of b.upper) inertia += part.mass * part.position.vsub(pivot).lengthSquared();
      const alpha = torque.scale(1 / inertia);
      const total = new CANNON.Vec3();
      for (const part of b.upper) {
        const f = alpha.cross(part.position.vsub(pivot)).scale(part.mass);
        part.force.vadd(f, part.force);
        total.vadd(f, total);
      }
      const reactionForce = total.scale(-0.5);
      footL.force.vadd(reactionForce, footL.force);
      footR.force.vadd(reactionForce, footR.force);
    }
  }

  /** Relaxes a balancing human's muscles so it collapses like a ragdoll. */
  knockOut(item, reason = 'knocked out') {
    if (!item.balance?.active) return;
    item.balance.active = false;
    item.balance.reason = reason;
    for (const c of item.locks) this.world.removeConstraint(c);
    item.constraints = item.constraints.filter((c) => !item.locks.includes(c));
    item.locks = [];
    for (const body of item.bodies) { body.sleepSpeedLimit = 0.15; body.sleepTimeLimit = 1; body.wakeUp(); }
    for (const foot of [item.parts.footL, item.parts.footR]) foot.material = this.materials.ragdoll;
    this._emit('knockout', { item, reason });
  }

  isFinite() {
    return this.world.bodies.every((b) => [b.position.x, b.position.y, b.position.z].every(Number.isFinite));
  }
}

const PROJECTILES = {
  snowball: { radius: 0.11, mass: 1.2, color: '#f4f8ff', material: 'snow', speedScale: 1 },
  bowling: { radius: 0.11, mass: 7, color: '#202040', material: 'metal', speedScale: 1 },
  beach: { radius: 0.35, mass: 0.4, color: '#ff5050', material: 'rubber', speedScale: 0.8 },
};
export const PROJECTILE_KINDS = Object.keys(PROJECTILES);

function makeShape(p) {
  switch (p.shape) {
    case 'box': return [new CANNON.Box(new CANNON.Vec3(...p.halfExtents))];
    case 'sphere': return [new CANNON.Sphere(p.radius)];
    case 'cylinder': return [new CANNON.Cylinder(p.radius, p.radius, p.height, 16)];
    case 'wedge': {
      // cannon-es convex collision expects the shape origin inside the hull, so center it on the centroid.
      const g = wedgeGeometry(p.size);
      const c = new CANNON.Vec3(0, p.size[1] / 3, -p.size[2] / 6);
      const shape = new CANNON.ConvexPolyhedron({ vertices: g.vertices.map((v) => new CANNON.Vec3(...v).vsub(c)), faces: g.faces });
      return [shape, c];
    }
  }
  throw new Error(`Unknown shape ${p.shape}`);
}

// ---------------- item builders (called with `this` = PhysicsSim) ----------------
const V = (x, y, z) => new CANNON.Vec3(x, y, z);

const SHIRT_COLORS = ['#e05a47', '#3d7be0', '#3fae5a', '#e0b13d', '#9b59d0', '#e07bb5', '#2bb5b5'];

const ITEM_BUILDERS = {
  ragdoll(item, o, q) {
    const bit = 1 << (RAGDOLL_FIRST_BIT + (this.ragdollCounter % RAGDOLL_BITS));
    const shirt = SHIRT_COLORS[this.ragdollCounter % SHIRT_COLORS.length];
    this.ragdollCounter++;
    const opts = (part, color, extra = {}) => ({
      part, color, material: 'ragdoll', group: bit, mask: ~bit, damping: [0.02, 0.35], ...extra,
    });
    const skin = '#f2c29b', pants = '#2f3e5c', shoes = '#3a2a20';
    const box = (x, y, z) => new CANNON.Box(V(x, y, z));
    const b = {};
    // Dimensions for a ~1.85 m human, feet on the ground (y = 0 at origin).
    b.lowerLegL = this._dynBody(item, box(0.065, 0.22, 0.07), V(-0.1, 0.22, 0), o, q, 4, opts('lowerLeg', pants));
    b.lowerLegR = this._dynBody(item, box(0.065, 0.22, 0.07), V(0.1, 0.22, 0), o, q, 4, opts('lowerLeg', pants));
    b.upperLegL = this._dynBody(item, box(0.08, 0.22, 0.08), V(-0.1, 0.66, 0), o, q, 8, opts('upperLeg', pants));
    b.upperLegR = this._dynBody(item, box(0.08, 0.22, 0.08), V(0.1, 0.66, 0), o, q, 8, opts('upperLeg', pants));
    b.pelvis = this._dynBody(item, box(0.17, 0.1, 0.11), V(0, 0.98, 0), o, q, 10, opts('pelvis', pants));
    b.torso = this._dynBody(item, box(0.2, 0.25, 0.12), V(0, 1.33, 0), o, q, 20, opts('torso', shirt));
    b.head = this._dynBody(item, new CANNON.Sphere(0.12), V(0, 1.74, 0), o, q, 5, opts('head', skin));
    b.upperArmL = this._dynBody(item, box(0.05, 0.15, 0.05), V(-0.27, 1.4, 0), o, q, 3, opts('upperArm', shirt));
    b.upperArmR = this._dynBody(item, box(0.05, 0.15, 0.05), V(0.27, 1.4, 0), o, q, 3, opts('upperArm', shirt));
    b.lowerArmL = this._dynBody(item, box(0.045, 0.15, 0.045), V(-0.27, 1.1, 0), o, q, 2, opts('lowerArm', skin));
    b.lowerArmR = this._dynBody(item, box(0.045, 0.15, 0.045), V(0.27, 1.1, 0), o, q, 2, opts('lowerArm', skin));
    b.lowerLegL.userData.shoes = shoes; b.lowerLegR.userData.shoes = shoes;

    const Y = CANNON.Vec3.UNIT_Y;
    const joint = (A, B, pA, pB, angle, twist) =>
      item.constraints.push(new CANNON.ConeTwistConstraint(A, B, { pivotA: pA, pivotB: pB, axisA: Y, axisB: Y, angle, twistAngle: twist }));
    const P = Math.PI;
    joint(b.head, b.torso, V(0, -0.16, 0), V(0, 0.25, 0), P / 5, P / 6);
    joint(b.torso, b.pelvis, V(0, -0.25, 0), V(0, 0.1, 0), P / 8, P / 8);
    joint(b.pelvis, b.upperLegL, V(-0.1, -0.1, 0), V(0, 0.22, 0), P / 2.5, P / 8);
    joint(b.pelvis, b.upperLegR, V(0.1, -0.1, 0), V(0, 0.22, 0), P / 2.5, P / 8);
    joint(b.upperLegL, b.lowerLegL, V(0, -0.22, 0), V(0, 0.22, 0), P / 3, P / 16);
    joint(b.upperLegR, b.lowerLegR, V(0, -0.22, 0), V(0, 0.22, 0), P / 3, P / 16);
    joint(b.torso, b.upperArmL, V(-0.27, 0.22, 0), V(0, 0.15, 0), P / 2, P / 4);
    joint(b.torso, b.upperArmR, V(0.27, 0.22, 0), V(0, 0.15, 0), P / 2, P / 4);
    joint(b.upperArmL, b.lowerArmL, V(0, -0.15, 0), V(0, 0.15, 0), P / 3, P / 16);
    joint(b.upperArmR, b.lowerArmR, V(0, -0.15, 0), V(0, 0.15, 0), P / 3, P / 16);
    item.parts = b;
    item.totalMass = item.bodies.reduce((s, x) => s + x.mass, 0);
  },

  human(item, o, q) {
    const bit = 1 << (RAGDOLL_FIRST_BIT + (this.ragdollCounter % RAGDOLL_BITS));
    const shirt = SHIRT_COLORS[(this.ragdollCounter + 3) % SHIRT_COLORS.length];
    this.ragdollCounter++;
    const opts = (part, color, extra = {}) => ({
      part, color, material: 'ragdoll', group: bit, mask: ~bit, damping: [0.02, 0.35], ...extra,
    });
    const skin = '#e8b48a', pants = '#4a4a52', shoes = '#222222';
    const box = (x, y, z) => new CANNON.Box(V(x, y, z));
    const b = {};
    // ~1.85 m human standing with feet on the ground (y = 0 at origin), real feet for a support base.
    b.footL = this._dynBody(item, box(0.06, 0.04, 0.13), V(-0.1, 0.04, 0.05), o, q, 2.5, opts('foot', shoes, { material: 'shoe', damping: [0.3, 0.95] }));
    b.footR = this._dynBody(item, box(0.06, 0.04, 0.13), V(0.1, 0.04, 0.05), o, q, 2.5, opts('foot', shoes, { material: 'shoe', damping: [0.3, 0.95] }));
    b.lowerLegL = this._dynBody(item, box(0.065, 0.2, 0.07), V(-0.1, 0.29, 0), o, q, 4, opts('lowerLeg', pants));
    b.lowerLegR = this._dynBody(item, box(0.065, 0.2, 0.07), V(0.1, 0.29, 0), o, q, 4, opts('lowerLeg', pants));
    b.upperLegL = this._dynBody(item, box(0.08, 0.21, 0.08), V(-0.1, 0.71, 0), o, q, 8, opts('upperLeg', pants));
    b.upperLegR = this._dynBody(item, box(0.08, 0.21, 0.08), V(0.1, 0.71, 0), o, q, 8, opts('upperLeg', pants));
    b.pelvis = this._dynBody(item, box(0.17, 0.1, 0.11), V(0, 1.02, 0), o, q, 10, opts('pelvis', pants));
    b.torso = this._dynBody(item, box(0.2, 0.25, 0.12), V(0, 1.37, 0), o, q, 20, opts('torso', shirt));
    b.head = this._dynBody(item, new CANNON.Sphere(0.12), V(0, 1.78, 0), o, q, 5, opts('head', skin));
    b.upperArmL = this._dynBody(item, box(0.05, 0.15, 0.05), V(-0.27, 1.44, 0), o, q, 3, opts('upperArm', shirt));
    b.upperArmR = this._dynBody(item, box(0.05, 0.15, 0.05), V(0.27, 1.44, 0), o, q, 3, opts('upperArm', shirt));
    b.lowerArmL = this._dynBody(item, box(0.045, 0.15, 0.045), V(-0.27, 1.14, 0), o, q, 2, opts('lowerArm', skin));
    b.lowerArmR = this._dynBody(item, box(0.045, 0.15, 0.045), V(0.27, 1.14, 0), o, q, 2, opts('lowerArm', skin));

    const Y = CANNON.Vec3.UNIT_Y;
    const P = Math.PI;
    const joint = (A, B, pA, pB, angle, twist) =>
      item.constraints.push(new CANNON.ConeTwistConstraint(A, B, { pivotA: pA, pivotB: pB, axisA: Y, axisB: Y, angle, twistAngle: twist }));
    joint(b.lowerLegL, b.footL, V(0, -0.205, 0), V(0, 0.045, -0.05), P / 6, P / 16);
    joint(b.lowerLegR, b.footR, V(0, -0.205, 0), V(0, 0.045, -0.05), P / 6, P / 16);
    joint(b.upperLegL, b.lowerLegL, V(0, -0.215, 0), V(0, 0.205, 0), P / 3, P / 16);
    joint(b.upperLegR, b.lowerLegR, V(0, -0.215, 0), V(0, 0.205, 0), P / 3, P / 16);
    joint(b.pelvis, b.upperLegL, V(-0.1, -0.1, 0), V(0, 0.21, 0), P / 2.5, P / 8);
    joint(b.pelvis, b.upperLegR, V(0.1, -0.1, 0), V(0, 0.21, 0), P / 2.5, P / 8);
    joint(b.torso, b.pelvis, V(0, -0.25, 0), V(0, 0.1, 0), P / 8, P / 8);
    joint(b.head, b.torso, V(0, -0.16, 0), V(0, 0.25, 0), P / 5, P / 6);
    joint(b.torso, b.upperArmL, V(-0.27, 0.22, 0), V(0, 0.15, 0), P / 2, P / 4);
    joint(b.torso, b.upperArmR, V(0.27, 0.22, 0), V(0, 0.15, 0), P / 2, P / 4);
    joint(b.upperArmL, b.lowerArmL, V(0, -0.15, 0), V(0, 0.15, 0), P / 3, P / 16);
    joint(b.upperArmR, b.lowerArmR, V(0, -0.15, 0), V(0, 0.15, 0), P / 3, P / 16);

    // Muscles: lock every joint above the ankles in the standing pose until the human is knocked out.
    item.locks = [];
    const lock = (A, B) => {
      const c = new CANNON.LockConstraint(A, B, { maxForce: 1e6 });
      item.locks.push(c);
      item.constraints.push(c);
    };
    lock(b.pelvis, b.torso);
    lock(b.lowerLegL, b.footL); lock(b.lowerLegR, b.footR);
    lock(b.torso, b.head);
    lock(b.pelvis, b.upperLegL); lock(b.pelvis, b.upperLegR);
    lock(b.upperLegL, b.lowerLegL); lock(b.upperLegR, b.lowerLegR);
    lock(b.torso, b.upperArmL); lock(b.torso, b.upperArmR);
    lock(b.upperArmL, b.lowerArmL); lock(b.upperArmR, b.lowerArmR);

    item.parts = b;
    item.totalMass = item.bodies.reduce((s, x) => s + x.mass, 0);
    // Gains for a ~68 kg body pivoting ~1 m above the ankles (gravity torque is ~670 Nm/rad).
    item.balance = {
      active: true, kp: 2400, kd: 520, maxTorque: 900, maxTilt: (32 * Math.PI) / 180, airTime: 0,
      upper: item.bodies.filter((x) => x !== b.footL && x !== b.footR),
    };
    // Settled humans sleep so they stand perfectly still (cannon-es friction creeps otherwise).
    for (const body of item.bodies) { body.sleepSpeedLimit = 0.05; body.sleepTimeLimit = 1.5; }
  },

  cratePyramid(item, o, q) {
    const s = 0.5, rows = 4;
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * (s + 0.01);
        const color = (r + i) % 2 ? '#b8874a' : '#c99a5b';
        this._dynBody(item, new CANNON.Box(V(s / 2, s / 2, s / 2)), V(x, s / 2 + r * s, 0), o, q, 6, { color });
      }
    }
  },

  tower(item, o, q) {
    const L = 1.2, W = 0.38, H = 0.22;
    for (let layer = 0; layer < 8; layer++) {
      for (let i = -1; i <= 1; i++) {
        const off = i * (W + 0.01);
        // Even layers: planks along x, offset in z. Odd layers: planks along z, offset in x.
        const local = layer % 2 ? V(off, H / 2 + layer * H, 0) : V(0, H / 2 + layer * H, off);
        const shape = new CANNON.Box(V(layer % 2 ? W / 2 : L / 2, H / 2, layer % 2 ? L / 2 : W / 2));
        this._dynBody(item, shape, local, o, q, 3, { color: layer % 2 ? '#e6c690' : '#d4ae6e' });
      }
    }
  },

  dominoes(item, o, q) {
    for (let i = 0; i < 14; i++) {
      const color = i % 2 ? '#f5f5f0' : '#222222';
      this._dynBody(item, new CANNON.Box(V(0.3, 0.45, 0.06)), V(0, 0.45, -i * 0.5), o, q, 2, { color, damping: [0.01, 0.05] });
    }
  },

  beachBall(item, o, q) {
    this._dynBody(item, new CANNON.Sphere(0.4), V(0, 0.4, 0), o, q, 0.5, { color: '#ff5a5a', material: 'rubber', part: 'beachBall' });
  },

  barrels(item, o, q) {
    const r = 0.3, h = 0.9;
    const cyl = () => new CANNON.Cylinder(r, r, h, 16);
    this._dynBody(item, cyl(), V(-0.32, h / 2, 0), o, q, 15, { color: '#c0392b', material: 'metal' });
    this._dynBody(item, cyl(), V(0.32, h / 2, 0), o, q, 15, { color: '#2980b9', material: 'metal' });
    this._dynBody(item, cyl(), V(0, h * 1.5 + 0.01, 0), o, q, 15, { color: '#27ae60', material: 'metal' });
  },

  snowman(item, o, q) {
    const opts = { color: '#fbfdff', material: 'snow', damping: [0.05, 0.3] };
    this._dynBody(item, new CANNON.Sphere(0.45), V(0, 0.45, 0), o, q, 20, opts);
    this._dynBody(item, new CANNON.Sphere(0.32), V(0, 1.2, 0), o, q, 8, opts);
    this._dynBody(item, new CANNON.Sphere(0.22), V(0, 1.73, 0), o, q, 3, { ...opts, part: 'snowHead' });
  },
};
