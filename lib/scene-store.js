import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Scenes are append-only: user scenes are written with the 'wx' flag so an existing file is never
// overwritten, and there is intentionally no delete operation.
export class SceneStore {
  constructor(rootDir) {
    this.presetDir = path.join(rootDir, 'presets');
    this.userDir = path.join(rootDir, 'scenes');
  }

  async init() {
    await fs.mkdir(this.presetDir, { recursive: true });
    await fs.mkdir(this.userDir, { recursive: true });
  }

  static isValidId(id) {
    return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(id);
  }

  async _readDir(dir) {
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
    const scenes = [];
    for (const f of files) {
      try {
        scenes.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
      } catch {
        // Skip unreadable files rather than failing the whole listing.
      }
    }
    return scenes;
  }

  async list() {
    const presets = await this._readDir(this.presetDir);
    const user = await this._readDir(this.userDir);
    presets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    user.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const summary = (s) => ({
      id: s.id, name: s.name, description: s.description, source: s.source, createdAt: s.createdAt, prompt: s.prompt, basedOn: s.basedOn,
    });
    return { presets: presets.map(summary), user: user.map(summary) };
  }

  async get(id) {
    if (!SceneStore.isValidId(id)) return null;
    for (const dir of [this.userDir, this.presetDir]) {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    return null;
  }

  newUserId(name) {
    const slug = String(name || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scene';
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `user-${stamp}-${slug}-${crypto.randomBytes(3).toString('hex')}`;
  }

  async saveUserScene(scene) {
    if (!SceneStore.isValidId(scene.id)) throw new Error('Invalid scene id');
    await fs.writeFile(path.join(this.userDir, `${scene.id}.json`), JSON.stringify(scene, null, 2), { flag: 'wx' });
    return scene;
  }
}
