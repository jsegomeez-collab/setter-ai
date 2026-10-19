import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { reelLabel } from './contacts.js';
import { newFlowId } from './flows/form.js';
import { validateFlow, type Flow } from './flows/types.js';
import type { MediaLoader } from './media-catalog.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { SETTINGS, type Store } from './store.js';
import type { UserStore } from './users.js';

/**
 * API de Flujos del constructor visual (Fase 6.5a). Solo admin (decisión de Jose: el equipo no toca los flujos).
 * Guardar NUNCA cambia si el flujo está activo: eso solo se hace con /enable, escribiendo ACTIVAR (manda DMs a gente real).
 */

export interface FlowsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly media: MediaLoader;
}

const MAX_NAME = 80;
const COPY_SUFFIX = ' (copia)';
const nameSchema = z.object({ name: z.string().trim().min(1).max(MAX_NAME) });
const enableSchema = z.object({ enabled: z.boolean(), confirm: z.string().optional() });
const deleteSchema = z.object({ confirm: z.literal('BORRAR') });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Flujo nuevo: un solo mensaje, desactivado. El disparador se elige en el constructor antes de activarlo. */
function starterFlow(name: string): Flow {
  return {
    id: newFlowId(),
    name,
    enabled: false,
    trigger: { mediaIds: 'all', keywords: [] },
    publicReplies: [],
    dmFailedReplies: [],
    startNodeId: 'inicio',
    nodes: [{ id: 'inicio', type: 'message', text: '¡Hola! 👋 Aquí tienes lo que pediste.', buttons: [] }],
    testUsernames: [],
    oncePerUser: true,
    onceScope: 'media',
    template: 'builder',
  };
}

export function createFlowsApi(deps: FlowsApiDeps): Hono<ApiEnv> {
  const { store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));
  api.use('*', requireAdmin);

  const findFlow = async (id: string) => (await store.listFlows()).find((flow) => flow.id === id);
  const who = (c: Context<ApiEnv>) => c.get('user').name;

  api.get('/', async (c) => {
    const [flows, media, blockedUntil] = await Promise.all([store.listFlows(), deps.media(), store.getSetting(SETTINGS.sendsBlockedUntil)]);
    return c.json({
      flows: flows.map((flow) => ({ id: flow.id, name: flow.name, enabled: flow.enabled, steps: flow.nodes.length, trigger: flow.trigger, testUsernames: flow.testUsernames })),
      reels: media.map((m) => ({ mediaId: m.id, label: reelLabel(m) })),
      sendsBlockedUntil: blockedUntil && Date.parse(blockedUntil) > Date.now() ? blockedUntil : null,
    });
  });

  api.post('/', async (c) => {
    const parsed = nameSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `Ponle un nombre (1-${MAX_NAME} caracteres).` }, 400);
    const flow = starterFlow(parsed.data.name);
    await store.saveFlow(flow);
    await store.logEvent('flujo', `${who(c)} creó el flujo "${flow.name}" (desactivado).`, { id: flow.id });
    return c.json({ flow }, 201);
  });

  api.get('/:id', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    return flow ? c.json({ flow }) : c.json({ error: 'Ese flujo no existe' }, 404);
  });

  api.post('/:id', async (c) => {
    const current = await findFlow(c.req.param('id'));
    if (!current) return c.json({ error: 'Ese flujo no existe' }, 404);
    const body = await readJson(c);
    if (!body || typeof body !== 'object') return c.json({ errors: ['No llegó el flujo.'] }, 400);
    const result = validateFlow({ ...body, id: current.id, enabled: current.enabled, template: 'builder' });
    if (!result.ok) return c.json({ errors: result.errors }, 400);
    await store.saveFlow(result.flow);
    await store.logEvent('flujo', `${who(c)} guardó el flujo "${result.flow.name}" desde el constructor.`, { id: current.id });
    return c.json({ flow: result.flow });
  });

  api.post('/:id/duplicate', async (c) => {
    const source = await findFlow(c.req.param('id'));
    if (!source) return c.json({ error: 'Ese flujo no existe' }, 404);
    const name = `${source.name.slice(0, MAX_NAME - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
    const flow: Flow = { ...source, id: newFlowId(), name, enabled: false, template: 'builder' };
    await store.saveFlow(flow);
    await store.logEvent('flujo', `${who(c)} duplicó "${source.name}" (copia desactivada).`, { from: source.id, id: flow.id });
    return c.json({ flow }, 201);
  });

  api.post('/:id/enable', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.json({ error: 'Ese flujo no existe' }, 404);
    const parsed = enableSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Petición no válida.' }, 400);
    if (parsed.data.enabled && parsed.data.confirm !== 'ACTIVAR') return c.json({ error: 'Para activar, escribe ACTIVAR (mandará DMs a personas reales).' }, 400);
    const result = validateFlow({ ...flow, enabled: parsed.data.enabled });
    if (!result.ok) return c.json({ error: `No se puede activar: ${result.errors.join('; ')}` }, 400);
    await store.saveFlow(result.flow);
    await store.logEvent('flujo', `${who(c)} ${parsed.data.enabled ? 'activó' : 'desactivó'} el flujo "${flow.name}".`, { id: flow.id });
    return c.json({ flow: result.flow });
  });

  api.post('/:id/delete', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.json({ error: 'Ese flujo no existe' }, 404);
    if (!deleteSchema.safeParse(await readJson(c)).success) return c.json({ error: 'Para borrar, escribe BORRAR.' }, 400);
    await store.deleteFlow(flow.id);
    // Se guarda el flujo entero en el registro: si se borra por error, se puede recuperar de ahí.
    await store.logEvent('flujo', `${who(c)} borró el flujo "${flow.name}".`, flow);
    return c.json({ ok: true });
  });

  return api;
}
