import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { InstagramConnect } from '../src/instagram-connect.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { SETTINGS } from '../src/store.js';
import { TEST_SETTER_CONFIG, createMemoryStore, followFlow } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/**
 * Configuración · Instagram y envíos (Fase 6.7b). Solo admin. Decisiones de Jose: los límites se VEN (se cambian en
 * Render); la pausa del 368 y el bloqueo se pueden quitar escribiendo una palabra; registro de eventos y suscribir avisos.
 */

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

async function setup(withClient = true) {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  await store.saveFlow(followFlow({ id: 'a', enabled: true }));
  await store.saveFlow(followFlow({ id: 'b', enabled: false }));
  await store.logEvent('comment', 'Comentario recibido', { x: 1 });
  await store.logEvent('pausado', 'Meta devolvió 368', null);
  const client = withClient
    ? ({ getAccount: vi.fn().mockResolvedValue({ userId: '178', username: 'josenews.ai' }), subscribe: vi.fn().mockResolvedValue({ success: true }) } as unknown as InstagramClient)
    : null;
  const tokens = new TokenManager({ store, envToken: withClient ? 'token-de-prueba' : null, encryptionKey: null });
  const app = createApp({ config, store, client, tokens, processPayload: vi.fn(), linkSecret: null, users });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const admin = (await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' })).headers.get('set-cookie')?.split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const team = (await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' })).headers.get('set-cookie')?.split(';')[0] ?? '';
  return { store, send, admin, team, client };
}

describe('API Configuración · Instagram y envíos (Fase 6.7b)', () => {
  it('solo admin; el estado trae cuenta, firma, token, pausa, bloqueo, envíos de la última hora frente a los límites y flujos', async () => {
    const { store, send, admin, team } = await setup();
    expect((await send('GET', '/api/settings/status', team)).status).toBe(403);
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await store.setSetting(SETTINGS.pausedUntil, until);
    await store.setSetting(SETTINGS.pauseReason, 'Meta 368');
    const status = await (await send('GET', '/api/settings/status', admin)).json();
    expect(status).toMatchObject({
      account: { username: 'josenews.ai', userId: '178' },
      accountError: null,
      secretConfigured: true,
      token: { source: 'variable de entorno' },
      pause: { until, reason: 'Meta 368' },
      block: null,
      sends: { privateReplies: 0, publicReplies: 0, followUps: 0 },
      limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
      flows: { active: 1, total: 2 },
      setterKey: false,
    });
  });

  it('sin token: lo dice en vez de fallar; suscribir avisos da 503', async () => {
    const { send, admin } = await setup(false);
    const status = await (await send('GET', '/api/settings/status', admin)).json();
    expect(status).toMatchObject({ account: null, accountError: 'Falta el token de Instagram', token: { source: 'ninguno' } });
    expect((await send('POST', '/api/settings/subscribe', admin)).status).toBe(503);
  });

  it('quitar la pausa del 368 pide escribir REANUDAR; renovar token y suscribir avisos devuelven lo que pasó', async () => {
    const { store, send, admin, client } = await setup();
    await store.setSetting(SETTINGS.pausedUntil, new Date(Date.now() + 3_600_000).toISOString());
    expect((await send('POST', '/api/settings/pause/clear', admin, {})).status).toBe(400);
    expect((await send('POST', '/api/settings/pause/clear', admin, { confirm: 'REANUDAR' })).status).toBe(200);
    expect(await store.getSetting(SETTINGS.pausedUntil)).toBeNull();

    const refreshed = await (await send('POST', '/api/settings/token/refresh', admin)).json();
    expect(refreshed.message).toContain('TOKEN_ENCRYPTION_KEY');
    const sub = await (await send('POST', '/api/settings/subscribe', admin)).json();
    expect(sub).toEqual({ result: { success: true } });
    expect(client?.subscribe).toHaveBeenCalled();
  });

  it('prueba "Conectar Instagram": enlace solo para admin; la vuelta comprueba el state, apunta usuario y permisos y NUNCA el token', async () => {
    const store = createMemoryStore();
    const users = createMemoryUserStore();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'corto', user_id: 1, permissions: ['instagram_business_basic'] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'TOKEN-SECRETO-60D', expires_in: 5_184_000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: '1784', username: 'josegomezlife' })));
    const instagramConnect = new InstagramConnect({ appId: '1117985297673013', appSecrets: ['s'], redirectUri: `${HOST}/oauth/instagram/callback`, apiVersion: 'v25.0', fetchFn });
    const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
    const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users, instagramConnect });
    const send = (path: string, cookie = '', method: 'GET' | 'POST' = 'GET', body?: unknown) =>
      app.request(`${HOST}${path}`, { method, headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: body ? JSON.stringify(body) : undefined });
    const admin = (await send('/api/setup', '', 'POST', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' })).headers.get('set-cookie')?.split(';')[0] ?? '';

    expect((await send('/api/settings/instagram/connect-url')).status).toBe(401);
    const { url } = await (await send('/api/settings/instagram/connect-url', admin)).json();
    const state = new URL(url).searchParams.get('state') ?? '';
    expect((await send(`/oauth/instagram/callback?code=abc&state=otro`)).status).toBe(400);
    expect(await (await send('/oauth/instagram/callback?error=access_denied&state=x')).text()).toContain('cancel');

    const ok = await send(`/oauth/instagram/callback?code=abc%23_&state=${state}`);
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain('@josegomezlife');
    expect(html).not.toContain('TOKEN-SECRETO-60D');
    const events = await store.recentEvents(10);
    expect(events[0]).toMatchObject({ kind: 'instagram-conectar' });
    expect(JSON.stringify(events)).not.toContain('TOKEN-SECRETO-60D');
  });

  it('registro de eventos: lo más reciente primero, con la lista de tipos y filtro por tipo', async () => {
    const { send, admin } = await setup();
    const all = await (await send('GET', '/api/settings/events', admin)).json();
    expect(all.events.slice(0, 2).map((e: { kind: string }) => e.kind)).toEqual(['pausado', 'comment']);
    expect(all.kinds).toEqual(expect.arrayContaining(['comment', 'pausado']));
    const only = await (await send('GET', '/api/settings/events?kind=comment', admin)).json();
    expect(only.events.map((e: { kind: string; note: string }) => [e.kind, e.note])).toEqual([['comment', 'Comentario recibido']]);
  });
});
