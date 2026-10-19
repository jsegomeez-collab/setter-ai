import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { STRANGER_ID, TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de Métricas del frontend (Fase 6.4): la ven el admin y el equipo. */

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
  await store.recordComment({ commentId: 'c1', igId: STRANGER_ID, username: 'ana', mediaId: 'reel-1', text: 'Bolsa' });
  await store.recordComment({ commentId: 'c2', igId: 'otra-persona', username: 'luis', mediaId: 'reel-1', text: 'Link' });
  await store.recordComment({ commentId: 'c3', igId: 'tercera', username: 'eva', mediaId: 'reel-viejo', text: 'Info' });
  await store.saveLead(STRANGER_ID, { siguiente_paso: 'agendar_llamada' });
  const client = {
    listMedia: vi.fn().mockResolvedValue([{ id: 'reel-1', caption: 'Mi reel', permalink: null, timestamp: '2026-10-16T09:00:00+0000', mediaProductType: 'REELS' }]),
    // No está entre los últimos: se pide por su id.
    getMedia: vi.fn().mockImplementation(async (id: string) => (id === 'reel-viejo' ? { id, caption: 'Reel de septiembre', permalink: null, timestamp: '2026-09-01T09:00:00+0000', mediaProductType: 'REELS' } : null)),
  } as unknown as InstagramClient;
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client, tokens, processPayload: vi.fn(), linkSecret: null, users });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' });
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const loginRes = await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' });
  const team = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { send, team };
}

describe('API Métricas (Fase 6.4)', () => {
  it('sin sesión 401; el equipo ve el embudo total, por reel con título, por día, el setter y la agenda', async () => {
    const { send, team } = await setup();
    expect((await send('GET', '/api/metrics', '')).status).toBe(401);
    const data = await (await send('GET', '/api/metrics?days=30', team)).json();
    expect(data.period).toBe(30);
    expect(data.funnel.total).toMatchObject({ commented: 3 });
    expect(data.funnel.byReel).toEqual([
      expect.objectContaining({ key: 'reel-1', commented: 2, label: '2026-10-16 · Mi reel' }),
      expect.objectContaining({ key: 'reel-viejo', commented: 1, label: '2026-09-01 · Reel de septiembre' }),
    ]);
    expect(data.funnel.byDay).toEqual([expect.objectContaining({ commented: 3 })]);
    expect(data.setter.stages).toEqual([{ step: 'agendar_llamada', n: 1 }]);
    expect(data.agenda).toEqual({ offered: 0, clicked: 0 });
  });

  it('periodo: 7, 30 o todo (cualquier otra cosa = todo)', async () => {
    const { send, team } = await setup();
    expect((await (await send('GET', '/api/metrics?days=7', team)).json()).period).toBe(7);
    expect((await (await send('GET', '/api/metrics?days=raro', team)).json()).period).toBe('all');
  });
});
