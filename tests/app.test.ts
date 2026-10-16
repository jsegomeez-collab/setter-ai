import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { SETTINGS } from '../src/store.js';
import { TEST_MEDIA_ID, commentPayload, createMemoryStore } from './helpers.js';

const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: 'contraseña-larga-123',
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  allowedSenderIds: [],
};

const auth = `Basic ${Buffer.from(`jose:${config.adminPassword}`).toString('base64')}`;
const HOST = 'http://localhost';

function setup(client: InstagramClient | null = null) {
  const store = createMemoryStore();
  const processPayload = vi.fn();
  const app = createApp({ config, store, client, processPayload });
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

function formPost(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: {
      authorization: auth,
      origin: HOST,
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('verificación del webhook (GET)', () => {
  it('devuelve el challenge con el token correcto', async () => {
    const { app } = setup();
    const res = await app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=token-verificacion&hub.challenge=1158201444');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
  });

  it('rechaza un token incorrecto', async () => {
    const { app } = setup();
    const res = await app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1');
    expect(res.status).toBe(403);
  });
});

describe('avisos de Meta (POST)', () => {
  it('con firma válida: guarda, responde 200 y manda a procesar', async () => {
    const { app, store, processPayload } = setup();
    const res = await app.request(signedPost(JSON.stringify(commentPayload())));
    expect(res.status).toBe(200);
    expect(store.requests[0]?.signatureOk).toBe(true);
    expect(processPayload).toHaveBeenCalledWith(commentPayload());
  });

  it('con firma falsa: lo guarda para depurar, responde 403 y NO procesa', async () => {
    const { app, store, processPayload } = setup();
    const res = await app.request(signedPost(JSON.stringify(commentPayload()), 'secreto-falso'));
    expect(res.status).toBe(403);
    expect(store.requests[0]?.signatureOk).toBe(false);
    expect(processPayload).not.toHaveBeenCalled();
  });

  it('JSON roto con firma válida: no rompe el servidor', async () => {
    const { app, store } = setup();
    const res = await app.request(signedPost('{roto'));
    expect(res.status).toBe(200);
    expect(store.requests[0]?.payload).toEqual({ invalidJson: '{roto' });
  });
});

describe('páginas públicas', () => {
  it.each(['/privacy', '/terms', '/data-deletion', '/healthz', '/'])('%s responde 200', async (path) => {
    const { app } = setup();
    expect((await app.request(path)).status).toBe(200);
  });
});

describe('panel /eventos', () => {
  it('pide contraseña', async () => {
    const { app } = setup();
    expect((await app.request('/eventos')).status).toBe(401);
  });

  it('con contraseña muestra el estado y escapa el contenido de Instagram', async () => {
    const { app, store } = setup();
    await store.logEvent('comment', 'nota', { text: '<script>alert(1)</script>' });
    const res = await app.request('/eventos', { headers: { authorization: auth } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Falta IG_ACCESS_TOKEN');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('muestra la cuenta y los reels cuando hay token', async () => {
    const client = {
      getAccount: vi.fn().mockResolvedValue({ userId: '178', username: 'jose' }),
      listMedia: vi.fn().mockResolvedValue([
        { id: TEST_MEDIA_ID, caption: 'Mi reel', permalink: 'https://instagram.com/r/1', timestamp: '2026-10-01T00:00:00+0000', mediaProductType: 'REELS' },
      ]),
    } as unknown as InstagramClient;
    const { app } = setup(client);
    const html = await (await app.request('/eventos', { headers: { authorization: auth } })).text();
    expect(html).toContain('@jose');
    expect(html).toContain('Mi reel');
  });

  it('guarda el reel de prueba y rechaza IDs raros', async () => {
    const { app, store } = setup();
    const ok = await app.request(formPost('/eventos/reel-prueba', { mediaId: TEST_MEDIA_ID }));
    expect(ok.status).toBe(303);
    expect(store.settings.get(SETTINGS.testMediaId)).toBe(TEST_MEDIA_ID);

    await app.request(formPost('/eventos/reel-prueba', { mediaId: "1; DROP TABLE" }));
    expect(store.settings.get(SETTINGS.testMediaId)).toBe(TEST_MEDIA_ID);
  });

  it('activa y desactiva las respuestas por DM', async () => {
    const { app, store } = setup();
    await app.request(formPost('/eventos/dms', { enabled: 'true' }));
    expect(store.settings.get(SETTINGS.dmRepliesEnabled)).toBe('true');
    await app.request(formPost('/eventos/dms', { enabled: 'false' }));
    expect(store.settings.get(SETTINGS.dmRepliesEnabled)).toBe('false');
  });

  it('bloquea formularios enviados desde otra web (CSRF)', async () => {
    const { app, store } = setup();
    const res = await app.request(formPost('/eventos/dms', { enabled: 'true' }, { origin: 'https://malicioso.com' }));
    expect(res.status).toBe(403);
    expect(store.settings.get(SETTINGS.dmRepliesEnabled)).toBeUndefined();
  });

  it('suscribir: avisa si falta token y llama a Meta si lo hay', async () => {
    const sinToken = setup();
    const res = await sinToken.app.request(formPost('/eventos/suscribir', {}));
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('Falta IG_ACCESS_TOKEN');

    const client = { subscribe: vi.fn().mockResolvedValue({ success: true }) } as unknown as InstagramClient;
    const conToken = setup(client);
    const res2 = await conToken.app.request(formPost('/eventos/suscribir', {}));
    expect(decodeURIComponent(res2.headers.get('location') ?? '')).toContain('"success":true');
  });
});
