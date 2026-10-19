import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { STRANGER_ID, TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de Contactos del frontend (Fase 6.3). Ver y etiquetar: admin y equipo. Exportar y borrar: solo admin. */

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
  await store.touchContact(STRANGER_ID, 'ana_ventas', 'reel-1');
  await store.addContactTags(STRANGER_ID, ['biblioteca']);
  await store.recordComment({ commentId: 'c1', igId: STRANGER_ID, username: 'ana_ventas', mediaId: 'reel-1', text: 'Bolsa' });
  await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola', mid: 'm1', status: 'sent', dedupKey: null });
  const client = { listMedia: vi.fn().mockResolvedValue([{ id: 'reel-1', caption: 'Mi reel de prueba', permalink: 'https://instagram.com/p/x', timestamp: '2026-10-16T09:00:00+0000', mediaProductType: 'REELS' }]) } as unknown as InstagramClient;
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
  return { store, send, admin, team };
}

describe('API Contactos (Fase 6.3)', () => {
  it('lista con filtros, las etiquetas que hay (con cuántos) y los reels para filtrar; el equipo también la ve', async () => {
    const { send, team } = await setup();
    expect((await send('GET', '/api/contacts', '')).status).toBe(401);
    const data = await (await send('GET', '/api/contacts?tag=biblioteca', team)).json();
    expect(data.items).toEqual([expect.objectContaining({ igId: STRANGER_ID, username: 'ana_ventas', tags: ['biblioteca'] })]);
    expect(data.total).toBe(1);
    expect(data.tags).toEqual([{ tag: 'biblioteca', n: 1 }]);
    expect(data.reels).toEqual([{ mediaId: 'reel-1', label: '2026-10-16 · Mi reel de prueba' }]);
    expect((await (await send('GET', '/api/contacts?tag=otra', team)).json()).items).toEqual([]);
  });

  it('la ficha trae sus comentarios con el reel, el historial y si tiene conversación', async () => {
    const { send, team } = await setup();
    const data = await (await send('GET', `/api/contacts/${STRANGER_ID}`, team)).json();
    expect(data.contact).toMatchObject({ username: 'ana_ventas', tags: ['biblioteca'], sourceLabel: '2026-10-16 · Mi reel de prueba' });
    expect(data.comments).toEqual([expect.objectContaining({ text: 'Bolsa', reelLabel: '2026-10-16 · Mi reel de prueba' })]);
    expect(data.hasConversation).toBe(true);
    expect((await send('GET', '/api/contacts/no-existe', team)).status).toBe(404);
  });

  it('etiquetas a mano: añadir y quitar (admin y equipo); valida el nombre', async () => {
    const { send, team, store } = await setup();
    expect((await send('POST', `/api/contacts/${STRANGER_ID}/tags`, team, { add: ' cliente ' })).status).toBe(200);
    expect((await store.getContact(STRANGER_ID))?.tags).toEqual(['biblioteca', 'cliente']);
    await send('POST', `/api/contacts/${STRANGER_ID}/tags`, team, { remove: 'biblioteca' });
    expect((await store.getContact(STRANGER_ID))?.tags).toEqual(['cliente']);
    expect((await send('POST', `/api/contacts/${STRANGER_ID}/tags`, team, { add: 'a,b' })).status).toBe(400);
    expect((await send('POST', `/api/contacts/${STRANGER_ID}/tags`, team, { add: '' })).status).toBe(400);
  });

  it('exportar CSV: solo admin, con los filtros aplicados', async () => {
    const { send, admin, team } = await setup();
    expect((await send('GET', '/api/contacts/export.csv', team)).status).toBe(403);
    const res = await send('GET', '/api/contacts/export.csv?tag=biblioteca', admin);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="contactos-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(await res.text()).toContain('"ana_ventas"');
  });

  it('borrar los datos de una persona: solo admin y escribiendo BORRAR', async () => {
    const { send, admin, team, store } = await setup();
    expect((await send('POST', `/api/contacts/${STRANGER_ID}/delete`, team, { confirm: 'BORRAR' })).status).toBe(403);
    expect((await send('POST', `/api/contacts/${STRANGER_ID}/delete`, admin, { confirm: 'si' })).status).toBe(400);
    const res = await send('POST', `/api/contacts/${STRANGER_ID}/delete`, admin, { confirm: 'BORRAR' });
    expect(res.status).toBe(200);
    expect(await store.getContact(STRANGER_ID)).toBeNull();
    expect(await store.listMessages(STRANGER_ID, 10)).toEqual([]);
    expect(await store.deletedAt(STRANGER_ID)).not.toBeNull();
  });

  it('por reel: comentarios, personas y etiquetas con el título del reel', async () => {
    const { send, team } = await setup();
    const data = await (await send('GET', '/api/contacts/reels', team)).json();
    expect(data.reels).toEqual([expect.objectContaining({ mediaId: 'reel-1', label: '2026-10-16 · Mi reel de prueba', comments: 1, people: 1, permalink: 'https://instagram.com/p/x' })]);
  });
});
