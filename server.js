import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SceneStore } from './lib/scene-store.js';
import { generateScene, stopClient, checkCopilotAvailability, MODEL } from './lib/scene-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const store = new SceneStore(path.join(__dirname, 'data'));
await store.init();

// Started in the background so the server is reachable while Copilot is being checked.
const chatStatus = checkCopilotAvailability();
chatStatus.then((s) => console.log(s.available ? `Scene designer chat enabled (model: ${MODEL})` : `Scene designer chat hidden: ${s.reason}`));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
app.use('/vendor/cannon-es', express.static(path.join(__dirname, 'node_modules/cannon-es/dist')));

app.get('/api/status', async (_req, res) => {
  const { enabled, available } = await chatStatus;
  res.json({ model: MODEL, chat: { enabled, available } });
});

app.get('/api/scenes', async (_req, res, next) => {
  try {
    res.json(await store.list());
  } catch (err) {
    next(err);
  }
});

app.get('/api/scenes/:id', async (req, res, next) => {
  try {
    const scene = await store.get(req.params.id);
    if (!scene) return res.status(404).json({ error: 'Scene not found' });
    res.json(scene);
  } catch (err) {
    next(err);
  }
});

// Generates a new scene with Copilot and stores it permanently. Streams NDJSON progress events.
app.post('/api/scenes/generate', async (req, res) => {
  if (!(await chatStatus).available) return res.status(503).json({ error: 'Scene generation is not available (GitHub Copilot chat is disabled).' });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 2000) : '';
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const baseId = req.body?.baseSceneId;
  const baseScene = baseId ? await store.get(baseId) : null;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');
  send({ type: 'status', message: `Asking ${MODEL} to design the scene...` });

  let chars = 0;
  let lastReport = 0;
  try {
    const scene = await generateScene(prompt, {
      baseScene,
      meta: { source: 'user', prompt, basedOn: baseScene?.id },
      onDelta: (text) => {
        chars += text.length;
        if (chars - lastReport > 400) {
          lastReport = chars;
          send({ type: 'progress', chars });
        }
      },
    });
    scene.id = store.newUserId(scene.name);
    scene.createdAt = new Date().toISOString();
    await store.saveUserScene(scene);
    send({ type: 'scene', scene });
  } catch (err) {
    console.error('Scene generation failed:', err);
    send({ type: 'error', message: err.message || String(err) });
  }
  res.end();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, () => console.log(`Ragdoll playground running at http://localhost:${PORT}`));

const shutdown = async () => {
  server.close();
  await stopClient().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
