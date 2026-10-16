import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { SETTINGS } from '../src/store.js';
import { TEST_MEDIA_ID, commentPayload, createMemoryStore, followFlow } from './helpers.js';

const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: 'contraseña-larga-123',
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  tokenEncryptionKey: null,
  publicBaseUrl: null,
  limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
  delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
};

const auth = `Basic ${Buffer.from(`jose:${config.adminPassword}`).toString('base64')}`;
const HOST = 'http://localhost';
const media = [{ id: TEST_MEDIA_ID, caption: 'Cómo crear tu primer agente', permalink: 'https://instagram.com/p/1', timestamp: '2026-10-11T00:00:00+0000', mediaProductType: 'FEED' }];

function setup(client: InstagramClient | null = null) {
  const store = createMemoryStore();
  const processPayload = vi.fn();
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client, tokens, processPayload, linkSecret: null });
  return { app, store, processPayload };
}

function signedPost(body: string, secret = 'secreto-ig') {
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return new Request(`${HOST}/webhooks/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  });
}

function formPost(path: string, fields: Record<string, string | string[]>, headers: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  return new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: { authorization: auth, origin: HOST, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: params.toString(),
  });
}

const validForm = {
  name: 'Reel n8n',
  enabled: 'on',
  oncePerUser: 'on',
  mediaIds: [TEST_MEDIA_ID],
  keywords: '',
  publicReplies: '¡Te escribí!\n¡Mira tu DM!',
  testUsernames: 'josegomezlife',
  mode: 'follow',
  startText: 'Hola',
  startButtonTitle: 'Lo quiero',
  resourceText: 'Aquí lo tienes',
  resourceButtonTitle: 'Abrir',
  resourceUrl: 'https://example.com/r',
  notFollowingText: 'Sígueme',
  retryButtonTitle: 'Ya te sigo',
};

describe('webhook', () => {
  it('verificación GET: challenge con el token correcto, 403 si no', async () => {
    const { app } = setup();
    const ok = await app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=token-verificacion&hub.challenge=42');
    expect(await ok.text()).toBe('42');
    expect((await app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1')).status).toBe(403);
  });

  it('POST con firma válida se procesa; con firma falsa no', async () => {
    const { app, store, processPayload } = setup();
    expect((await app.request(signedPost(JSON.stringify(commentPayload())))).status).toBe(200);
    expect(processPayload).toHaveBeenCalledTimes(1);
    expect((await app.request(signedPost('{}', 'falso'))).status).toBe(403);
    expect(processPayload).toHaveBeenCalledTimes(1);
    expect(store.requests.map((r) => r.signatureOk)).toEqual([true, false]);
  });

  it('JSON roto con firma válida no rompe el servidor', async () => {
    const { app, store } = setup();
    expect((await app.request(signedPost('{roto'))).status).toBe(200);
    expect(store.requests[0]?.payload).toEqual({ invalidJson: '{roto' });
  });
});

describe('páginas públicas', () => {
  it.each(['/privacy', '/terms', '/data-deletion', '/healthz', '/'])('%s responde 200', async (path) => {
    expect((await setup().app.request(path)).status).toBe(200);
  });
});

describe('panel', () => {
  it('pide contraseña en /eventos y /flujos', async () => {
    const { app } = setup();
    expect((await app.request('/eventos')).status).toBe(401);
    expect((await app.request('/flujos')).status).toBe(401);
  });

  it('estado: escapa el contenido de Instagram y muestra pausa y límites', async () => {
    const { app, store } = setup();
    await store.logEvent('comment', 'nota', { text: '<script>alert(1)</script>' });
    store.settings.set(SETTINGS.pausedUntil, new Date(Date.now() + 3600_000).toISOString());
    const html = await (await app.request('/eventos', { headers: { authorization: auth } })).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('PAUSADO');
    expect(html).toContain('/700');
  });

  it('reanudar quita la pausa; suscribir sin token avisa', async () => {
    const { app, store } = setup();
    store.settings.set(SETTINGS.pausedUntil, new Date(Date.now() + 3600_000).toISOString());
    await app.request(formPost('/eventos/reanudar', {}));
    expect(store.settings.get(SETTINGS.pausedUntil)).toBeNull();
    const res = await app.request(formPost('/eventos/suscribir', {}));
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('Falta el token');
    const renew = await app.request(formPost('/eventos/renovar-token', {}));
    expect(decodeURIComponent(renew.headers.get('location') ?? '')).toContain('TOKEN_ENCRYPTION_KEY');
  });

  it('muestra la cuenta cuando hay cliente', async () => {
    const client = { getAccount: vi.fn().mockResolvedValue({ userId: '178', username: 'josenews.ai' }) } as unknown as InstagramClient;
    const html = await (await setup(client).app.request('/eventos', { headers: { authorization: auth } })).text();
    expect(html).toContain('@josenews.ai');
  });

  it('bloquea formularios enviados desde otra web (CSRF)', async () => {
    const { app, store } = setup();
    const res = await app.request(formPost('/eventos/reanudar', {}, { origin: 'https://malicioso.com' }));
    expect(res.status).toBe(403);
    expect(store.events).toHaveLength(0);
  });
});

describe('flujos en el panel', () => {
  const client = { listMedia: vi.fn().mockResolvedValue(media) } as unknown as InstagramClient;

  it('formulario de nuevo flujo muestra los reels', async () => {
    const html = await (await setup(client).app.request('/flujos/nuevo', { headers: { authorization: auth } })).text();
    expect(html).toContain('Cómo crear tu primer agente');
  });

  it('crear → aparece en la lista; editar → se guarda con el mismo id', async () => {
    const { app, store } = setup(client);
    const res = await app.request(formPost('/flujos/nuevo', validForm));
    expect(res.status).toBe(303);
    const [flow] = await store.listFlows();
    expect(flow).toMatchObject({ name: 'Reel n8n', enabled: true, testUsernames: ['josegomezlife'] });
    const list = await (await app.request('/flujos', { headers: { authorization: auth } })).text();
    expect(list).toContain('PRUEBA: solo josegomezlife');
    await app.request(formPost(`/flujos/${flow?.id}`, { ...validForm, name: 'Renombrado' }));
    expect((await store.listFlows()).map((f) => [f.id, f.name])).toEqual([[flow?.id, 'Renombrado']]);
    const edit = await (await app.request(`/flujos/${flow?.id}`, { headers: { authorization: auth } })).text();
    expect(edit).toContain('formato de nodos');
  });

  it('formulario con errores → 400 y no guarda', async () => {
    const { app, store } = setup(client);
    const res = await app.request(formPost('/flujos/nuevo', { ...validForm, resourceUrl: 'no-url' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Revisa esto');
    expect(store.flows.size).toBe(0);
  });

  it('activar/desactivar y borrar', async () => {
    const { app, store } = setup(client);
    store.flows.set('flow1', followFlow());
    await app.request(formPost('/flujos/flow1/activar', { enabled: 'false' }));
    expect(store.flows.get('flow1')?.enabled).toBe(false);
    await app.request(formPost('/flujos/flow1/borrar', {}));
    expect(store.flows.size).toBe(0);
    const missing = await app.request(formPost('/flujos/nada/borrar', {}));
    expect(decodeURIComponent(missing.headers.get('location') ?? '')).toContain('no existe');
  });

  it('flujos del constructor se muestran solo en lectura', async () => {
    const { app, store } = setup(client);
    store.flows.set('flow1', followFlow({ template: 'builder' }));
    const html = await (await app.request('/flujos/flow1', { headers: { authorization: auth } })).text();
    expect(html).toContain('constructor visual');
  });
});
