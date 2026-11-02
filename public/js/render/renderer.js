import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CANNON } from '../sim/physics.js';

const SHAPE = CANNON.Shape.types;

export class Renderer {
  constructor(container, sim) {
    this.sim = sim;
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1000);
    this.camera.position.set(8, 6, 10);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 250;
    this.controls.minPolarAngle = 0.01;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -30; sc.right = sc.top = 30; sc.near = 1; sc.far = 150;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.body = sim.ground;
    this.scene.add(this.ground);

    this.meshes = new Map();
    this.materials = new Map();
    this.effects = [];
    this.pickables = [this.ground];

    this.blackHole = makeBlackHole();
    this.blackHole.visible = false;
    this.scene.add(this.blackHole);

    sim.on('add', (b) => this.addBody(b));
    sim.on('remove', (b) => this.removeBody(b));
    for (const b of sim.world.bodies) this.addBody(b);

    this.raycaster = new THREE.Raycaster();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyEnvironment(env) {
    const sky = new THREE.Color(env.sky);
    this.scene.background = sky;
    this.scene.fog = env.fog > 0 ? new THREE.FogExp2(sky, env.fog) : null;
    this.ground.material.color.set(env.ground);
    this.sun.intensity = env.sunIntensity;
    this.hemi.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.5);
  }

  setCamera(position, target) {
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
  }

  /** Walks the camera and its orbit target together. forward/right are along the ground, up is vertical. */
  moveCamera(forward, right, up) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
    const delta = dir.multiplyScalar(forward).addScaledVector(side, right);
    delta.y += up;
    // Keep the camera above the ground.
    const minY = 0.3;
    if (this.camera.position.y + delta.y < minY) delta.y = minY - this.camera.position.y;
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    if (this.controls.target.y < 0) this.controls.target.y = 0;
  }

  /** Orbits the camera around its target (radians). */
  orbitCamera(yaw, pitch) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi + pitch, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    offset.setFromSpherical(sph);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  /** Changes the camera distance to the target by a factor (<1 zooms in). */
  zoomCamera(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(len));
  }

  /** Places the camera at a named viewpoint around the current target, keeping the distance. */
  viewFrom(name) {
    const t = this.controls.target;
    const d = Math.max(4, this.camera.position.distanceTo(t));
    const views = {
      front: [0, 0.35, 1], back: [0, 0.35, -1], left: [-1, 0.35, 0], right: [1, 0.35, 0],
      top: [0, 1, 0.02], low: [0.7, 0.08, 0.7],
    };
    const v = new THREE.Vector3(...(views[name] ?? views.front)).normalize().multiplyScalar(d);
    this.camera.position.copy(t).add(v);
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;
    this.controls.update();
  }

  /** Smoothly moves the orbit target (and camera with it) towards a point. */
  follow(point, dt) {
    const k = 1 - Math.exp(-dt * 4);
    const delta = new THREE.Vector3(point.x, point.y, point.z).sub(this.controls.target).multiplyScalar(k);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  material(color, kind) {
    const key = `${color}|${kind}`;
    if (!this.materials.has(key)) {
      const opts = { color, roughness: 0.75, metalness: 0 };
      if (kind === 'metal') Object.assign(opts, { roughness: 0.35, metalness: 0.6 });
      if (kind === 'ice') Object.assign(opts, { roughness: 0.08, metalness: 0.1 });
      if (kind === 'rubber') Object.assign(opts, { roughness: 0.5 });
      if (kind === 'snow') Object.assign(opts, { roughness: 1 });
      this.materials.set(key, new THREE.MeshStandardMaterial(opts));
    }
    return this.materials.get(key);
  }

  addBody(body) {
    if (body === this.sim.ground || this.meshes.has(body) || body.collisionFilterGroup === 0) return;
    const ud = body.userData ?? {};
    const group = new THREE.Group();
    const mat = this.material(ud.color ?? '#cccccc', ud.material ?? (ud.projectile === 'snowball' ? 'snow' : 'default'));
    body.shapes.forEach((shape, i) => {
      const geom = geometryForShape(shape);
      if (!geom) return;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(body.shapeOffsets[i]);
      mesh.quaternion.copy(body.shapeOrientations[i]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.body = body;
      group.add(mesh);
      this.pickables.push(mesh);
    });
    decorate(group, body, this);
    group.position.copy(body.position);
    group.quaternion.copy(body.quaternion);
    this.scene.add(group);
    this.meshes.set(body, group);
  }

  removeBody(body) {
    const group = this.meshes.get(body);
    if (!group) return;
    this.scene.remove(group);
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        const i = this.pickables.indexOf(o);
        if (i >= 0) this.pickables.splice(i, 1);
      }
    });
    this.meshes.delete(body);
  }

  /** Raycast from normalized device coords. Returns { body, point, normal, ray } or { ray } when nothing is hit. */
  pick(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray.clone();
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return { ray };
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { body: hit.object.userData.body, point: hit.point, normal, ray };
  }

  // ---------------- effects ----------------
  spawnAirParticles(origin, dir, strength) {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(AIR_GEOM, AIR_MAT);
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25);
      const v = dir.clone().add(spread).normalize().multiplyScalar(14 + strength);
      m.position.copy(origin).addScaledVector(dir, 1.2);
      this.scene.add(m);
      this.effects.push({ obj: m, life: 0.9, age: 0, update: (e, dt) => { e.obj.position.addScaledVector(v, dt); e.obj.scale.setScalar(1 + e.age * 4); } });
    }
  }

  spawnExplosion(point, radius) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8 }));
    m.position.copy(point);
    this.scene.add(m);
    this.effects.push({
      obj: m, life: 0.5, age: 0,
      update: (e) => { const k = e.age / e.life; e.obj.scale.setScalar(0.2 + k * radius); e.obj.material.opacity = 0.8 * (1 - k); },
      dispose: () => { m.geometry.dispose(); m.material.dispose(); },
    });
  }

  spawnPushMarker(point, dir) {
    const arrow = new THREE.ArrowHelper(dir.clone().normalize(), point.clone().addScaledVector(dir, -1.2), 1.2, 0xff3366, 0.35, 0.2);
    this.scene.add(arrow);
    this.effects.push({ obj: arrow, life: 0.4, age: 0, update: () => {}, dispose: () => arrow.dispose?.() });
  }

  update(dt) {
    for (const [body, group] of this.meshes) {
      group.position.copy(body.position);
      group.quaternion.copy(body.quaternion);
    }
    for (const e of this.effects) {
      e.age += dt;
      e.update(e, dt);
    }
    for (const e of this.effects.filter((x) => x.age >= x.life)) {
      this.scene.remove(e.obj);
      e.dispose?.();
    }
    this.effects = this.effects.filter((x) => x.age < x.life);

    const bh = this.sim.mode.attractor;
    this.blackHole.visible = !!bh;
    if (bh) {
      this.blackHole.position.copy(this.sim.attractorPos);
      this.blackHole.children[1].rotation.z += dt * 2;
    }

    // Keep the shadow frustum centered on what the user is looking at.
    const t = this.controls.target;
    this.sun.position.set(t.x + 18, t.y + 30, t.z + 12);
    this.sun.target.position.copy(t);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

const AIR_GEOM = new THREE.SphereGeometry(0.05, 6, 4);
const AIR_MAT = new THREE.MeshBasicMaterial({ color: 0xe0f4ff, transparent: true, opacity: 0.55 });

function geometryForShape(shape) {
  switch (shape.type) {
    case SHAPE.BOX: {
      const h = shape.halfExtents;
      return new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
    }
    case SHAPE.SPHERE:
      return new THREE.SphereGeometry(shape.radius, 28, 18);
    case SHAPE.CYLINDER:
      return new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, 24);
    case SHAPE.CONVEXPOLYHEDRON: {
      const pos = [];
      for (const face of shape.faces) {
        for (let i = 1; i < face.length - 1; i++) {
          for (const idx of [face[0], face[i], face[i + 1]]) {
            const v = shape.vertices[idx];
            pos.push(v.x, v.y, v.z);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    }
  }
  return null;
}

const EYE_GEOM = new THREE.SphereGeometry(0.022, 10, 8);
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x111111 });
const NOSE_GEOM = new THREE.ConeGeometry(0.04, 0.22, 10);
const NOSE_MAT = new THREE.MeshStandardMaterial({ color: 0xff7f1a });
const HAIR_MAT = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.9 });

function decorate(group, body, renderer) {
  const ud = body.userData ?? {};
  if (ud.part === 'head') {
    for (const x of [-0.045, 0.045]) {
      const eye = new THREE.Mesh(EYE_GEOM, EYE_MAT);
      eye.position.set(x, 0.025, 0.105);
      group.add(eye);
    }
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), HAIR_MAT);
    hair.position.y = 0.01;
    hair.castShadow = true;
    group.add(hair);
  } else if (ud.part === 'snowHead') {
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(EYE_GEOM, EYE_MAT);
      eye.scale.setScalar(1.6);
      eye.position.set(x, 0.06, 0.19);
      group.add(eye);
    }
    const nose = new THREE.Mesh(NOSE_GEOM, NOSE_MAT);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, 0.3);
    group.add(nose);
  } else if (ud.part === 'lowerLeg' && ud.shoes) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), renderer.material(ud.shoes, 'default'));
    shoe.position.set(0, -0.19, 0.04);
    shoe.castShadow = true;
    group.add(shoe);
  } else if (ud.part === 'beachBall') {
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.405, 24, 12, 0, Math.PI / 3), renderer.material('#ffffff', 'rubber'));
    const stripe2 = stripe.clone();
    stripe2.rotation.y = Math.PI;
    group.add(stripe, stripe2);
  }
}

function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, 128, 128);
  g.fillRect(128, 128, 128, 128);
  g.strokeStyle = '#cfcfcf';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(250, 250);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeBlackHole() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.12, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0xb36bff, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = Math.PI / 2.4;
  g.add(ring);
  const glow = new THREE.PointLight(0xa060ff, 30, 12);
  g.add(glow);
  return g;
}
