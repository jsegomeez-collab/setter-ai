import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import { SETTINGS } from '../src/store.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de los documentos del setter (Fase 7.2). Solo admin. Decisión de Jose: lista base + poder crear más. */

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
  await store.saveKnowledge('DOCUMENTO ÚNICO DE SIEMPRE');
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, { method, headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const admin = (await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' })).headers.get('set-cookie')?.split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const team = (await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' })).headers.get('set-cookie')?.split(';')[0] ?? '';
  const list = async () => (await send('GET', '/api/setter/docs', admin)).json();
  return { store, send, admin, team, list };
}

describe('API documentos del setter (Fase 7.2)', () => {
  it('solo admin; la lista base aparece sola (vacía) y el modo empieza en "documento único"', async () => {
    const { send, team, list } = await setup();
    expect((await send('GET', '/api/setter/docs', team)).status).toBe(403);
    const data = await list();
    expect(data.mode).toBe('single');
    expect(data.docs.map((d: { title: string }) => d.title)).toEqual(['Cliente ideal', 'Oferta y precios', 'Preguntas frecuentes', 'Objeciones y respuestas', 'Tono y estilo', 'Casos de éxito', 'Lo que nunca debe decir']);
    expect(data.docs[0]).toMatchObject({ slug: 'cliente-ideal', builtin: true, active: true, text: '', versions: [] });
    expect(data.docs[0].hint.length).toBeGreaterThan(10);
  });

  it('guardar crea versión (sin cambios no); volver a una versión; activar y mover', async () => {
    const { send, admin, list } = await setup();
    await list();
    expect((await send('POST', '/api/setter/docs/oferta', admin, { text: 'v1' })).status).toBe(200);
    await send('POST', '/api/setter/docs/oferta', admin, { text: 'v2' });
    expect(await (await send('POST', '/api/setter/docs/oferta', admin, { text: 'v2' })).json()).toMatchObject({ message: expect.stringContaining('Sin cambios') });
    let oferta = (await list()).docs.find((d: { slug: string }) => d.slug === 'oferta');
    expect(oferta.text).toBe('v2');
    expect(oferta.versions).toHaveLength(2);
    await send('POST', '/api/setter/docs/oferta/restore', admin, { versionId: oferta.versions[1].id });
    oferta = (await list()).docs.find((d: { slug: string }) => d.slug === 'oferta');
    expect(oferta.text).toBe('v1');

    await send('POST', '/api/setter/docs/oferta/meta', admin, { active: false });
    await send('POST', '/api/setter/docs/oferta/move', admin, { dir: 'up' });
    const docs = (await list()).docs;
    expect(docs.slice(0, 2).map((d: { slug: string; active: boolean }) => [d.slug, d.active])).toEqual([
      ['oferta', false],
      ['cliente-ideal', true],
    ]);
    expect((await send('POST', '/api/setter/docs/no-existe', admin, { text: 'x' })).status).toBe(404);
  });

  it('documentos propios: se crean con su título, se renombran y se borran con BORRAR; los base no se borran', async () => {
    const { send, admin, list } = await setup();
    await list();
    const created = await (await send('POST', '/api/setter/docs', admin, { title: 'Guion de llamada' })).json();
    expect(created.slug).toBe('guion-de-llamada');
    expect((await send('POST', '/api/setter/docs', admin, { title: '   ' })).status).toBe(400);
    const again = await (await send('POST', '/api/setter/docs', admin, { title: 'Guion de llamada' })).json();
    expect(again.slug).toBe('guion-de-llamada-2');
    await send('POST', '/api/setter/docs/guion-de-llamada/meta', admin, { title: 'Guion para la llamada' });
    expect((await list()).docs.at(-2).title).toBe('Guion para la llamada');
    expect((await send('POST', '/api/setter/docs/guion-de-llamada/delete', admin, {})).status).toBe(400);
    expect((await send('POST', '/api/setter/docs/guion-de-llamada/delete', admin, { confirm: 'BORRAR' })).status).toBe(200);
    expect((await send('POST', '/api/setter/docs/oferta/delete', admin, { confirm: 'BORRAR' })).status).toBe(400);
    expect((await list()).docs).toHaveLength(8);
  });

  it('pasar a "documentos separados" exige alguno activo con texto; se puede volver al documento único', async () => {
    const { store, send, admin, list } = await setup();
    await list();
    expect((await send('POST', '/api/setter/docs/mode', admin, { mode: 'docs' })).status).toBe(400);
    await send('POST', '/api/setter/docs/cliente-ideal', admin, { text: 'Dueños de negocio' });
    expect((await send('POST', '/api/setter/docs/mode', admin, { mode: 'docs' })).status).toBe(200);
    expect(await store.getSetting(SETTINGS.knowledgeMode)).toBe('docs');
    expect((await list()).mode).toBe('docs');
    await send('POST', '/api/setter/docs/mode', admin, { mode: 'single' });
    expect((await list()).mode).toBe('single');
  });
});
