import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { TEST_SETTER_CONFIG, createMemoryStore, followFlow } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** Rompehielos y menú fijo del chat (Fase 7.3c). Solo admin. Publicar en Instagram pide escribir PUBLICAR. */

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
  await store.saveFlow(followFlow({ id: 'precios', name: 'Precios', enabled: true, trigger: { type: 'manual' } as never }));
  await store.saveFlow(followFlow({ id: 'apagado', name: 'Apagado', enabled: false }));
  const client = {
    listMedia: vi.fn().mockResolvedValue([]),
    getMedia: vi.fn().mockResolvedValue(null),
    setMessengerProfile: vi.fn().mockResolvedValue({ result: 'success' }),
    deleteMessengerProfile: vi.fn().mockResolvedValue({ result: 'success' }),
    getMessengerProfile: vi.fn().mockResolvedValue({ data: [{ ice_breakers: [{ call_to_actions: [{ question: '¿Precio?', payload: 'S:precios' }], locale: 'default' }] }] }),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
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
  return { store, client, send, admin };
}

const draft = {
  iceBreakers: [{ question: '¿Cuánto cuesta?', flowId: 'precios' }],
  menu: [
    { type: 'flow', title: 'Precios', flowId: 'precios' },
    { type: 'url', title: 'Mi web', url: 'https://example.com' },
  ],
};

describe('API rompehielos y menú (Fase 7.3c)', () => {
  it('guarda el borrador y lo devuelve junto a lo publicado en Instagram', async () => {
    const { send, admin } = await setup();
    expect((await send('GET', '/api/chat-entry', '')).status).toBe(401);
    expect((await send('POST', '/api/chat-entry', admin, draft)).status).toBe(200);
    const data = await (await send('GET', '/api/chat-entry', admin)).json();
    expect(data.draft).toEqual(draft);
    expect(data.published).toBeNull();
    // Lo que hay ahora en Instagram (lo devuelve Meta; aquí, el simulado del cliente).
    expect(data.live).toEqual({ iceBreakers: [{ question: '¿Precio?', payload: 'S:precios' }], menu: [] });
    // Y la respuesta tal cual (la doc no da su formato exacto: así se puede revisar qué devuelve Meta de verdad).
    expect(data.liveRaw).toEqual({ data: [{ ice_breakers: [{ call_to_actions: [{ question: '¿Precio?', payload: 'S:precios' }], locale: 'default' }] }] });
  });

  it('rechaza más de 4 rompehielos, flujos que no existen y enlaces que no son web', async () => {
    const { send, admin } = await setup();
    const many = { ...draft, iceBreakers: Array(5).fill({ question: 'x', flowId: 'precios' }) };
    expect((await send('POST', '/api/chat-entry', admin, many)).status).toBe(400);
    const missing = await send('POST', '/api/chat-entry', admin, { ...draft, iceBreakers: [{ question: 'x', flowId: 'no-existe' }] });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain('no-existe');
    expect((await send('POST', '/api/chat-entry', admin, { ...draft, menu: [{ type: 'url', title: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
  });

  it('publicar: pide PUBLICAR, exige flujos activos y manda a Meta el formato oficial', async () => {
    const { send, admin, client, store } = await setup();
    await send('POST', '/api/chat-entry', admin, draft);
    expect((await send('POST', '/api/chat-entry/publish', admin, {})).status).toBe(400);
    const res = await send('POST', '/api/chat-entry/publish', admin, { confirm: 'PUBLICAR' });
    expect(res.status).toBe(200);
    expect(client.setMessengerProfile).toHaveBeenCalledWith({
      platform: 'instagram',
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: '¿Cuánto cuesta?', payload: 'S:precios' }] }],
      persistent_menu: [
        {
          locale: 'default',
          call_to_actions: [
            { type: 'postback', title: 'Precios', payload: 'S:precios' },
            { type: 'web_url', title: 'Mi web', url: 'https://example.com' },
          ],
        },
      ],
    });
    expect((await (await send('GET', '/api/chat-entry', admin)).json()).published).toMatchObject({ by: 'Jose' });
    expect(store.events.some((e) => e.kind === 'chat' && e.note.includes('publicó'))).toBe(true);

    await send('POST', '/api/chat-entry', admin, { iceBreakers: [{ question: 'x', flowId: 'apagado' }], menu: [] });
    const off = await send('POST', '/api/chat-entry/publish', admin, { confirm: 'PUBLICAR' });
    expect(off.status).toBe(400);
    expect((await off.json()).error).toContain('Apagado');
  });

  it('si una lista queda vacía, se borra en Instagram en vez de publicarla vacía', async () => {
    const { send, admin, client } = await setup();
    await send('POST', '/api/chat-entry', admin, { iceBreakers: [{ question: '¿Precio?', flowId: 'precios' }], menu: [] });
    await send('POST', '/api/chat-entry/publish', admin, { confirm: 'PUBLICAR' });
    expect(client.setMessengerProfile).toHaveBeenCalledWith({ platform: 'instagram', ice_breakers: [{ locale: 'default', call_to_actions: [{ question: '¿Precio?', payload: 'S:precios' }] }] });
    expect(client.deleteMessengerProfile).toHaveBeenCalledWith(['persistent_menu']);
  });
});
