import { normalizeScene, SCENE_FORMAT_DOC } from '../public/js/shared/scene-format.js';

export const MODEL = process.env.COPILOT_MODEL || 'claude-opus-5.5';

/** Chat (AI scene generation) is opt-in: set ENABLE_CHAT=true where GitHub Copilot is available. */
export const CHAT_ENABLED = /^(1|true|yes|on)$/i.test(process.env.ENABLE_CHAT ?? '');

const SYSTEM_PROMPT = `You are a 3D level designer for a ragdoll physics sandbox (like a toy box where users push, throw snowballs at and blow air on ragdoll humans).
The user describes a location; you answer with ONE JSON object describing the scene. Output ONLY raw JSON, no markdown fences, no comments, no prose.
Design guidelines:
- Recreate the described place recognizably with simple primitives, using 20-150 objects. Use believable real-world dimensions in meters (a door is 2 m tall, a stair step 0.18 m).
- Prefer the stairs / ramp / quarterPipe macros where they fit; build furniture, vehicles, trees, railings from boxes, cylinders and spheres.
- Make it a fun physics playground: heights to fall from, slopes to slide down, edges to tumble over, and some loose dynamic props (crates, balls, bins, cones) to knock over.
- Every static object must touch the ground or another object; compute y positions carefully from the anchor rules (box center vs. stairs/ramp base).
- Put "spawn" exactly on top of a surface at an exciting spot and aim "camera" so the spawn and the main features are visible.
- Pick pleasant, varied colors and a matching sky/ground color.
${SCENE_FORMAT_DOC}`;

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      // Imported lazily so the app still runs (without chat) where the Copilot SDK/CLI is not usable.
      const { CopilotClient } = await import('@github/copilot-sdk');
      const client = new CopilotClient();
      await client.start();
      return client;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

let availabilityPromise = null;

/**
 * Checks whether GitHub Copilot can be used for scene generation. The Copilot client is only started
 * when chat is enabled. Resolves to { enabled, available, reason? } and caches the result.
 */
export function checkCopilotAvailability({ timeoutMs = 30_000 } = {}) {
  if (!CHAT_ENABLED) return Promise.resolve({ enabled: false, available: false, reason: 'Chat is disabled (set ENABLE_CHAT=true to enable it).' });
  availabilityPromise ??= (async () => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });
    try {
      const status = await Promise.race([getClient().then((client) => client.getAuthStatus()), timeout]);
      if (!status?.isAuthenticated) {
        const detail = status?.statusMessage ? `: ${status.statusMessage}` : '';
        return { enabled: true, available: false, reason: `GitHub Copilot is not signed in${detail}` };
      }
      return { enabled: true, available: true };
    } catch (err) {
      return { enabled: true, available: false, reason: `GitHub Copilot is not available: ${err.message || err}` };
    } finally {
      clearTimeout(timer);
    }
  })();
  return availabilityPromise;
}

export async function stopClient() {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  await client?.stop();
}

export function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in the response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Generates a scene from a natural language description using the Copilot SDK.
 * @param {string} prompt user description
 * @param {{ baseScene?: object, onDelta?: (text: string) => void, meta?: object }} options
 */
export async function generateScene(prompt, { baseScene, onDelta, meta = {} } = {}) {
  const client = await getClient();
  const session = await client.createSession({
    model: MODEL,
    streaming: true,
    systemMessage: { mode: 'replace', content: SYSTEM_PROMPT },
    availableTools: [],
    onPermissionRequest: () => ({ kind: 'denied-interactively-by-user' }),
  });
  const unsubscribe = onDelta ? session.on('assistant.message_delta', (e) => onDelta(e.data?.deltaContent ?? '')) : null;
  try {
    let request = baseScene
      ? `Here is the current scene JSON:\n${JSON.stringify(stripMeta(baseScene))}\n\nModify it according to this request and return the complete new scene JSON:\n${prompt}`
      : `Create a scene for: ${prompt}`;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const reply = await session.sendAndWait({ prompt: request }, 300_000);
      const content = reply?.data?.content ?? '';
      try {
        const raw = extractJson(content);
        return normalizeScene(raw, meta);
      } catch (err) {
        lastError = err;
        request = `Your previous answer could not be used (${err.message}). Reply again with ONLY the complete, valid scene JSON object.`;
      }
    }
    throw new Error(`Model did not return a valid scene: ${lastError?.message}`);
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
    await session.disconnect().catch(() => {});
  }
}

function stripMeta(scene) {
  const { id, source, createdAt, prompt, basedOn, ...rest } = scene;
  return rest;
}
