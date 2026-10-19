import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { TEST_SETTER_CONFIG, createMemoryStore, followFlow } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de Flujos del constructor visual (Fase 6.5a). Solo admin. Activar pide escribir ACTIVAR; borrar, BORRAR. */

const HOST = 'https://setter.test';
const SETUP_KEY = 'clave-del-panel-actual';
const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: SETUP_KEY,
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  tokenEncryptionKey: null,
  publicBaseUrl: null,
  limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
  delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
  setter: TEST_SETTER_CONFIG,
};

async function setup() {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  await store.saveFlow(followFlow({ id: 'manychat', name: 'Réplica ManyChat', enabled: false }));
  const client = {
    listMedia: vi.fn().mockResolvedValue([{ id: '18000000000000001', caption: 'Mi reel', permalink: null, timestamp: '2026-10-16T09:00:00+0000', mediaProductType: 'REELS' }]),
    getMedia: vi.fn().mockResolvedValue(null),
  } as unknown as InstagramClient;
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client, tokens, processPayload: vi.fn(), linkSecret: null, users });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setupRes = await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' });
  const admin = (setupRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const loginRes = await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' });
  const team = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const getFlow = async (id: string) => (await store.listFlows()).find((flow) => flow.id === id);
  return { store, send, admin, team, getFlow };
}

describe('API Flujos (Fase 6.5a)', () => {
  it('solo admin: sin sesión 401, equipo 403; la lista trae cada flujo y los reels para elegir', async () => {
    const { send, admin, team } = await setup();
    expect((await send('GET', '/api/flows', '')).status).toBe(401);
    expect((await send('GET', '/api/flows', team)).status).toBe(403);
    const data = await (await send('GET', '/api/flows', admin)).json();
    expect(data.flows).toEqual([expect.objectContaining({ id: 'manychat', name: 'Réplica ManyChat', enabled: false, steps: 4 })]);
    expect(data.reels).toEqual([{ mediaId: '18000000000000001', label: '2026-10-16 · Mi reel' }]);
    expect((await (await send('GET', '/api/flows/manychat', admin)).json()).flow).toMatchObject({ id: 'manychat', nodes: expect.any(Array) });
    expect((await send('GET', '/api/flows/no-existe', admin)).status).toBe(404);
  });

  it('guardar: valida con las mismas reglas, guarda las posiciones del lienzo y NO cambia si está activo', async () => {
    const { send, admin, getFlow } = await setup();
    const flow = (await (await send('GET', '/api/flows/manychat', admin)).json()).flow;
    const edited = { ...flow, name: 'Reel n8n v2', enabled: true, layout: { start: { x: 10, y: 20 } } };
    const res = await send('POST', '/api/flows/manychat', admin, edited);
    expect(res.status).toBe(200);
    expect(await getFlow('manychat')).toMatchObject({ name: 'Reel n8n v2', enabled: false, template: 'builder', layout: { start: { x: 10, y: 20 } } });

    const broken = { ...flow, startNodeId: 'no-existe' };
    const bad = await send('POST', '/api/flows/manychat', admin, broken);
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors).toEqual(expect.arrayContaining([expect.stringContaining('no existe')]));
    expect((await getFlow('manychat'))?.name).toBe('Reel n8n v2');
  });

  it('crear y duplicar: nacen desactivados y válidos; el duplicado lleva "(copia)" y otro id', async () => {
    const { send, admin, getFlow } = await setup();
    const created = await (await send('POST', '/api/flows', admin, { name: 'Reel nuevo' })).json();
    expect(await getFlow(created.flow.id)).toMatchObject({ name: 'Reel nuevo', enabled: false, template: 'builder' });
    expect((await send('POST', '/api/flows', admin, { name: '' })).status).toBe(400);

    const copy = await (await send('POST', '/api/flows/manychat/duplicate', admin)).json();
    expect(copy.flow.id).not.toBe('manychat');
    expect(await getFlow(copy.flow.id)).toMatchObject({ name: 'Réplica ManyChat (copia)', enabled: false });
  });

  it('probar un comentario (6.5c): con el borrador sin guardar, dice si salta, por qué no, y si otro flujo activo se lo quitaría', async () => {
    const { store, send, admin } = await setup();
    const flow = (await (await send('GET', '/api/flows/manychat', admin)).json()).flow;
    const probe = (draft: unknown, comment: Record<string, unknown>) => send('POST', '/api/flows/manychat/test', admin, { draft, comment });

    const ok = await (await probe({ ...flow, trigger: { mediaIds: 'all', keywords: ['info'] } }, { text: 'Quiero INFO', username: 'ana', mediaId: '18000000000000001' })).json();
    expect(ok).toEqual({ matches: true, reasons: [], enabled: false, takenBy: null });

    const no = await (await probe({ ...flow, trigger: { mediaIds: 'all', keywords: ['info'] } }, { text: 'qué bonito', username: 'ana', mediaId: null })).json();
    expect(no).toMatchObject({ matches: false, reasons: ['El comentario no tiene ninguna palabra clave (info).'] });

    // Otro flujo ACTIVO más específico (reel concreto + palabra) gana al de "todos los reels".
    await store.saveFlow(followFlow({ id: 'otro', name: 'Reel concreto', enabled: true, trigger: { mediaIds: ['18000000000000001'], keywords: ['info'] } }));
    const taken = await (await probe({ ...flow, trigger: { mediaIds: 'all', keywords: ['info'] } }, { text: 'info', username: 'ana', mediaId: '18000000000000001' })).json();
    expect(taken.takenBy).toEqual({ id: 'otro', name: 'Reel concreto' });

    expect((await probe({ nada: true }, { text: 'x' })).status).toBe(400);
  });

  it('activar pide escribir ACTIVAR; desactivar no; borrar pide BORRAR', async () => {
    const { send, admin, getFlow } = await setup();
    expect((await send('POST', '/api/flows/manychat/enable', admin, { enabled: true })).status).toBe(400);
    expect((await getFlow('manychat'))?.enabled).toBe(false);
    expect((await send('POST', '/api/flows/manychat/enable', admin, { enabled: true, confirm: 'ACTIVAR' })).status).toBe(200);
    expect((await getFlow('manychat'))?.enabled).toBe(true);
    expect((await send('POST', '/api/flows/manychat/enable', admin, { enabled: false })).status).toBe(200);
    expect((await getFlow('manychat'))?.enabled).toBe(false);

    expect((await send('POST', '/api/flows/manychat/delete', admin, {})).status).toBe(400);
    expect((await send('POST', '/api/flows/manychat/delete', admin, { confirm: 'BORRAR' })).status).toBe(200);
    expect(await getFlow('manychat')).toBeUndefined();
  });
});
