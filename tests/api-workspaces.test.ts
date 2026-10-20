import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import type { Workspace } from '../src/workspaces.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/**
 * Espacios (Fase 7.5b). Decisión de Jose: altas solo por invitación suya. Desde su espacio (principal), un admin crea
 * un espacio y a quien lo lleva; la web da una clave temporal (se ve una vez) que hay que cambiar al entrar.
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

const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function setup() {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const created: Workspace[] = [];
  // Cerrojo de envíos de cada espacio: nace puesto (lo pone su arranque).
  const locks = new Map<string, boolean>();
  const workspaces = {
    list: vi.fn(async () => created),
    create: vi.fn(async (name: string) => {
      const ws = { id: `ws_${name.toLowerCase()}_0001`, name, igUserId: null, igUsername: null, createdAt: new Date() };
      created.push(ws);
      locks.set(ws.id, true);
      return ws;
    }),
    sendsLocked: vi.fn(async (id: string) => locks.get(id) ?? null),
    progress: vi.fn(async (id: string) => (locks.has(id) ? { done: 0, total: 5 } : null)),
    setSendsLock: vi.fn(async (id: string, locked: boolean) => {
      locks.set(id, locked);
    }),
    remove: vi.fn(async (id: string) => {
      created.splice(
        created.findIndex((ws) => ws.id === id),
        1,
      );
    }),
    users,
  };
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users, workspaces });
  let ip = 0;
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${++ip}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const admin = cookieOf(await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' }));
  return { send, admin, users, workspaces, store };
}

describe('API Espacios (Fase 7.5b)', () => {
  it('crear un espacio da la clave temporal de quien lo lleva (admin de ese espacio, debe cambiarla)', async () => {
    const { send, admin, users, workspaces, store } = await setup();
    const res = await send('POST', '/api/workspaces', admin, { name: 'Socio', adminEmail: 'Socio@X.com', adminName: 'Pedro' });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.workspace).toMatchObject({ id: 'ws_socio_0001', name: 'Socio' });
    expect(data.tempPassword).toMatch(/^\S{16}$/);
    const socio = await users.findUserByEmail('socio@x.com');
    expect(socio).toMatchObject({ role: 'admin', workspaceId: 'ws_socio_0001', mustChangePassword: true, name: 'Pedro' });
    expect(workspaces.create).toHaveBeenCalledWith('Socio');
    expect(store.events.some((e) => e.kind === 'espacios' && e.note.includes('Socio'))).toBe(true);
    // La lista trae a quién lleva cada espacio.
    const list = await (await send('GET', '/api/workspaces', admin)).json();
    expect(list.workspaces).toEqual([expect.objectContaining({ id: 'ws_socio_0001', name: 'Socio', people: [{ name: 'Pedro', email: 'socio@x.com', role: 'admin' }] })]);
  });

  it('los envíos de un espacio nuevo salen bloqueados y solo Jose (admin del principal) los activa o los vuelve a bloquear', async () => {
    const { send, admin, workspaces, store } = await setup();
    await send('POST', '/api/workspaces', admin, { name: 'Socio', adminEmail: 'socio@x.com', adminName: 'Pedro' });
    const before = await (await send('GET', '/api/workspaces', admin)).json();
    expect(before.workspaces[0].sendsLocked).toBe(true);
    // 7.5f: la lista trae el avance de sus primeros pasos.
    expect(before.workspaces[0].progress).toEqual({ done: 0, total: 5 });

    expect((await send('POST', '/api/workspaces/ws_socio_0001/sends', admin, { locked: false })).status).toBe(200);
    expect(workspaces.setSendsLock).toHaveBeenCalledWith('ws_socio_0001', false, 'Jose');
    expect((await (await send('GET', '/api/workspaces', admin)).json()).workspaces[0].sendsLocked).toBe(false);
    expect(store.events.some((e) => e.kind === 'espacios' && /activ/i.test(e.note) && e.note.includes('Socio'))).toBe(true);

    expect((await send('POST', '/api/workspaces/ws_socio_0001/sends', admin, { locked: true })).status).toBe(200);
    expect((await send('POST', '/api/workspaces/ws_socio_0001/sends', admin, { locked: 'no' })).status).toBe(400);
    expect((await send('POST', '/api/workspaces/ws_no_existe_0000/sends', admin, { locked: false })).status).toBe(404);
  });

  it('borrar un espacio pide escribir su nombre; lo borra todo y quita a sus usuarios (Jose sigue)', async () => {
    const { send, admin, users, workspaces, store } = await setup();
    await send('POST', '/api/workspaces', admin, { name: 'Socio', adminEmail: 'socio@x.com', adminName: 'Pedro' });
    const wrong = await send('POST', '/api/workspaces/ws_socio_0001/delete', admin, { confirm: 'socio' });
    expect(wrong.status).toBe(400);
    expect(workspaces.remove).not.toHaveBeenCalled();

    expect((await send('POST', '/api/workspaces/ws_socio_0001/delete', admin, { confirm: 'Socio' })).status).toBe(200);
    expect(workspaces.remove).toHaveBeenCalledWith('ws_socio_0001');
    expect(await users.findUserByEmail('socio@x.com')).toBeNull();
    expect(await users.findUserByEmail('jose@x.com')).not.toBeNull();
    expect((await (await send('GET', '/api/workspaces', admin)).json()).workspaces).toEqual([]);
    expect(store.events.some((e) => e.kind === 'espacios' && /borr/i.test(e.note) && e.note.includes('Socio'))).toBe(true);
    expect((await send('POST', '/api/workspaces/ws_socio_0001/delete', admin, { confirm: 'Socio' })).status).toBe(404);
  });

  it('si el borrado falla, no se quita a nadie y se dice por qué', async () => {
    const { send, admin, users, workspaces } = await setup();
    await send('POST', '/api/workspaces', admin, { name: 'Socio', adminEmail: 'socio@x.com', adminName: 'Pedro' });
    workspaces.remove.mockRejectedValueOnce(new Error('Neon no responde'));
    const res = await send('POST', '/api/workspaces/ws_socio_0001/delete', admin, { confirm: 'Socio' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('Neon no responde');
    expect(await users.findUserByEmail('socio@x.com')).not.toBeNull();
  });

  it('un correo que ya tiene cuenta se rechaza ANTES de crear nada', async () => {
    const { send, admin, workspaces } = await setup();
    const res = await send('POST', '/api/workspaces', admin, { name: 'Repetido', adminEmail: 'jose@x.com', adminName: 'Jose' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ya tiene cuenta');
    expect(workspaces.create).not.toHaveBeenCalled();
  });

  it('datos que faltan: 400; sin sesión: 401; alguien del equipo: 403', async () => {
    const { send, admin, users } = await setup();
    expect((await send('POST', '/api/workspaces', admin, { name: '', adminEmail: 'x@x.com', adminName: 'X' })).status).toBe(400);
    expect((await send('GET', '/api/workspaces', '')).status).toBe(401);
    await users.createUser({ email: 'equipo@x.com', name: 'Equipo', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
    const team = cookieOf(await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' }));
    expect((await send('GET', '/api/workspaces', team)).status).toBe(403);
  });
});

describe('la sesión dice en qué espacio estás', () => {
  it('en el principal, ningún espacio; en otro espacio, su nombre', async () => {
    const { send, admin } = await setup();
    expect((await (await send('GET', '/api/session', admin)).json()).workspace).toBeNull();
    const store = createMemoryStore();
    const app = createApp({
      config,
      store,
      client: null,
      tokens: new TokenManager({ store, envToken: null, encryptionKey: null }),
      processPayload: vi.fn(),
      linkSecret: null,
      users: createMemoryUserStore(),
      workspace: { id: 'ws_socio_0001', name: 'Socio' },
    });
    expect((await (await app.request(`${HOST}/api/session`)).json()).workspace).toEqual({ id: 'ws_socio_0001', name: 'Socio' });
  });

  it('primeros pasos (7.5f): en un cliente, su dueño ve lo que le falta; en el de Jose no existen', async () => {
    const store = createMemoryStore();
    const users = createMemoryUserStore();
    await users.createUser({ email: 'ana@x.com', name: 'Ana', role: 'admin', passwordHash: await hashPassword('clave-de-ana-12345'), workspaceId: 'ws_ana_0001' });
    const app = createApp({
      config,
      store,
      client: null,
      tokens: new TokenManager({ store, envToken: null, encryptionKey: null }),
      processPayload: vi.fn(),
      linkSecret: null,
      users,
      workspace: { id: 'ws_ana_0001', name: 'Ana' },
    });
    const headers = { origin: HOST, 'content-type': 'application/json' };
    expect((await app.request(`${HOST}/api/onboarding`)).status).toBe(401);
    const login = await app.request(`${HOST}/api/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'ana@x.com', password: 'clave-de-ana-12345' }) });
    const res = await app.request(`${HOST}/api/onboarding`, { headers: { cookie: cookieOf(login) } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps.map((s: { id: string }) => s.id)).toEqual(['instagram', 'links', 'document', 'setter', 'sends']);
    expect(data.progress).toEqual({ done: 1, total: 5 });

    const { send, admin } = await setup();
    expect((await send('GET', '/api/onboarding', admin)).status).toBe(404);
  });

  it('la ruta de espacios no existe fuera del principal', async () => {
    const store = createMemoryStore();
    const app = createApp({ config, store, client: null, tokens: new TokenManager({ store, envToken: null, encryptionKey: null }), processPayload: vi.fn(), linkSecret: null, users: createMemoryUserStore() });
    expect((await app.request(`${HOST}/api/workspaces`)).status).toBe(404);
  });
});
