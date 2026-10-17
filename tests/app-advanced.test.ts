import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createLinkToken, deriveLinkSecret } from '../src/links.js';
import { TokenManager } from '../src/meta/token.js';
import { JOSE_FLOW } from './fixtures.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';

const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: 'contraseña-larga-123',
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  tokenEncryptionKey: 'clave-de-cifrado-larga-123',
  limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
  delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
  publicBaseUrl: 'https://setter.example.com',
  setter: TEST_SETTER_CONFIG,
};
const SECRET = deriveLinkSecret(config.tokenEncryptionKey as string);
const auth = `Basic ${Buffer.from(`jose:${config.adminPassword}`).toString('base64')}`;
const HOST = 'http://localhost';

function setup(linkSecret: string | null = SECRET) {
  const store = createMemoryStore();
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client: null, tokens, linkSecret, processPayload: vi.fn() });
  return { app, store };
}

const jsonPost = (path: string, json: string, origin = HOST) =>
  new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: { authorization: auth, origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ json }).toString(),
  });

describe('enlaces con seguimiento /l/:token', () => {
  it('registra el clic, añade las etiquetas al contacto y redirige al destino real', async () => {
    const { app, store } = setup();
    const token = createLinkToken(SECRET, { f: 'manychat1', n: 'biblioteca', b: 0, r: '9', u: 'https://biblioteca.example.com', t: ['biblioteca'] });
    const res = await app.request(`/l/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://biblioteca.example.com');
    expect(store.contacts.get('9')?.tags).toEqual(['biblioteca']);
    expect(store.events[0]?.kind).toBe('click');
  });

  it('enlace falso o seguimiento desactivado → 404 (nunca redirige a sitios no firmados)', async () => {
    expect((await setup().app.request('/l/falso.falso')).status).toBe(404);
    const token = createLinkToken(SECRET, { f: 'f', n: 'n', b: 0, r: '9', u: 'https://a.com', t: [] });
    expect((await setup(null).app.request(`/l/${token}`)).status).toBe(404);
  });

  it('si falla el registro, la persona igualmente llega a su destino', async () => {
    const { app, store } = setup();
    store.logEvent = vi.fn().mockRejectedValue(new Error('BD caída'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const token = createLinkToken(SECRET, { f: 'f', n: 'n', b: 0, r: '9', u: 'https://a.com', t: [] });
    expect((await app.request(`/l/${token}`)).status).toBe(302);
    stderr.mockRestore();
  });
});

describe('editor JSON de flujos avanzados', () => {
  it('muestra un ejemplo al crear y guarda un flujo válido', async () => {
    const { app, store } = setup();
    const page = await (await app.request('/flujos/nuevo-json', { headers: { authorization: auth } })).text();
    expect(page).toContain('Mi flujo avanzado');
    const res = await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(JOSE_FLOW)));
    expect(res.status).toBe(303);
    expect(store.flows.get('manychat1')).toMatchObject({ name: 'Réplica ManyChat', template: 'json' });
  });

  it('JSON roto, flujo inválido o id repetido → 400 con explicación', async () => {
    const { app, store } = setup();
    expect(await (await app.request(jsonPost('/flujos/nuevo-json', '{roto'))).text()).toContain('no es válido');
    const bad = { ...JOSE_FLOW, startNodeId: 'nada' };
    const res = await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(bad)));
    expect(res.status).toBe(400);
    await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(JOSE_FLOW)));
    expect(await (await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(JOSE_FLOW)))).text()).toContain('Ya existe');
    expect(store.flows.size).toBe(1);
  });

  it('editar: la URL manda el id; un flujo avanzado se abre en el editor JSON', async () => {
    const { app, store } = setup();
    await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(JOSE_FLOW)));
    await app.request(jsonPost('/flujos/manychat1/json', JSON.stringify({ ...JOSE_FLOW, id: 'otro', name: 'Cambiado' })));
    expect([...store.flows.keys()]).toEqual(['manychat1']);
    expect(store.flows.get('manychat1')?.name).toBe('Cambiado');
    const page = await (await app.request('/flujos/manychat1', { headers: { authorization: auth } })).text();
    expect(page).toContain('Editar flujo avanzado');
  });

  it('crear sin id genera uno; CSRF bloquea envíos desde otra web', async () => {
    const { app, store } = setup();
    const { id: _ignored, ...withoutId } = JOSE_FLOW;
    await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(withoutId)));
    expect([...store.flows.keys()][0]).toMatch(/^[A-Za-z0-9]{8}$/);
    expect((await app.request(jsonPost('/flujos/nuevo-json', JSON.stringify(JOSE_FLOW), 'https://malicioso.com'))).status).toBe(403);
  });
});

describe('rescate desde el panel', () => {
  it('lanza el rescate con la fecha indicada y rechaza fechas inválidas', async () => {
    const store = createMemoryStore();
    const rescue = vi.fn().mockResolvedValue({ queued: 3, skipped: 1, since: '2026-10-16T13:46:00.000Z' });
    const app = createApp({ config, store, client: null, tokens: new TokenManager({ store, envToken: null, encryptionKey: null }), linkSecret: null, processPayload: vi.fn(), rescue });
    const post = (desde: string) =>
      app.request(
        new Request(`${HOST}/eventos/rescatar`, {
          method: 'POST',
          headers: { authorization: auth, origin: HOST, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ desde }).toString(),
        }),
      );
    const ok = await post('2026-10-16T13:46:00Z');
    expect(rescue).toHaveBeenCalledWith(new Date('2026-10-16T13:46:00Z'));
    expect(decodeURIComponent(ok.headers.get('location') ?? '')).toContain('3 comentarios en cola');
    const bad = await post('ayer');
    expect(decodeURIComponent(bad.headers.get('location') ?? '')).toContain('no válida');
    expect(rescue).toHaveBeenCalledTimes(1);
  });
});

describe('contactos y estado', () => {
  it('lista contactos con sus etiquetas (pide contraseña)', async () => {
    const { app, store } = setup();
    expect((await app.request('/contactos')).status).toBe(401);
    await store.touchContact('9', 'josegomezlife');
    await store.addContactTags('9', ['biblioteca']);
    const html = await (await app.request('/contactos', { headers: { authorization: auth } })).text();
    expect(html).toContain('@josegomezlife');
    expect(html).toContain('biblioteca');
  });

  it('contactos muestra el reel de origen y el resumen por reel', async () => {
    const { app, store } = setup();
    await store.touchContact('9', 'josegomezlife', '18094491215151712');
    await store.recordComment({ commentId: 'c1', igId: '9', username: 'josegomezlife', mediaId: '18094491215151712', text: '🔥' });
    await store.addContactTags('9', ['biblioteca']);
    const html = await (await app.request('/contactos', { headers: { authorization: auth } })).text();
    expect(html).toContain('Por reel');
    expect(html).toContain('18094491215151712');
    expect(html).toContain('biblioteca: <strong>1</strong>');
  });

  it('métricas: embudo por reel, total y por día (pide contraseña; periodo 7/30 días o todo)', async () => {
    const { app, store } = setup();
    expect((await app.request('/metricas')).status).toBe(401);
    await store.recordComment({ commentId: 'c1', igId: '9', username: 'ana', mediaId: '18094491215151712', text: 'Bolsa' });
    await store.claimAction('private:c1', 'private_reply', { type: 'private_reply', commentId: 'c1', message: { recipientId: '9' } });
    await store.finishAction('private:c1', true, { messageId: 'm1' });
    const html = await (await app.request('/metricas', { headers: { authorization: auth } })).text();
    expect(html).toContain('Embudo');
    expect(html).toContain('18094491215151712');
    expect(html).toContain('TOTAL');
    expect(html).toContain('Por día');
    expect(html).toContain('100 %'); // 1 de 1 le llegó el DM
    const week = await app.request('/metricas?dias=7', { headers: { authorization: auth } });
    expect(week.status).toBe(200);
    expect(await week.text()).toContain('últimos 7 días');
    expect((await app.request('/metricas?dias=abc', { headers: { authorization: auth } })).status).toBe(200); // periodo raro → todo
  });

  it('métricas: bloque del setter IA con conversaciones por etapa y cambios de etapa', async () => {
    const { app, store } = setup();
    await store.saveLead('9', { siguiente_paso: 'seguir_calificando' });
    await store.saveLead('9', { siguiente_paso: 'agendar_llamada' });
    const html = await (await app.request('/metricas', { headers: { authorization: auth } })).text();
    expect(html).toContain('Setter IA');
    expect(html).toContain('agendar_llamada');
    expect(html).toContain('seguir_calificando → agendar_llamada');
  });

  it('métricas: agenda ofrecida a N personas → clic de M', async () => {
    const { app, store } = setup();
    for (const r of ['9', '8']) {
      await store.claimAction(`ai:${r}:1`, 'send_message', { type: 'send_message', recipientId: r, message: { buttons: [{ type: 'url', tags: ['agenda'] }] } });
      await store.finishAction(`ai:${r}:1`, true, {});
    }
    await app.request(`/l/${createLinkToken(SECRET, { f: 'setter', n: 'reply', b: 0, r: '9', u: 'https://a.com', t: ['agenda'] })}`);
    const html = await (await app.request('/metricas', { headers: { authorization: auth } })).text();
    expect(html).toContain('Agenda ofrecida');
    expect(html).toMatch(/Agenda ofrecida<\/td><td>2<\/td>/);
    expect(html).toMatch(/Clic en la agenda<\/td><td>1 <small>\(50 %\)<\/small><\/td>/);
  });

  it('el estado indica si los enlaces con seguimiento están activos', async () => {
    const on = await (await setup().app.request('/eventos', { headers: { authorization: auth } })).text();
    expect(on).toContain('✔ activos');
    const off = await (await setup(null).app.request('/eventos', { headers: { authorization: auth } })).text();
    expect(off).toContain('desactivados');
  });
});
