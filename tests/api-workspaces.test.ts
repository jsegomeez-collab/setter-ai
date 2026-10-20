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
  const workspaces = {
    list: vi.fn(async () => created),
    create: vi.fn(async (name: string) => {
      const ws = { id: `ws_${name.toLowerCase()}_0001`, name, igUserId: null, igUsername: null, createdAt: new Date() };
      created.push(ws);
      return ws;
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

  it('la ruta de espacios no existe fuera del principal', async () => {
    const store = createMemoryStore();
    const app = createApp({ config, store, client: null, tokens: new TokenManager({ store, envToken: null, encryptionKey: null }), processPayload: vi.fn(), linkSecret: null, users: createMemoryUserStore() });
    expect((await app.request(`${HOST}/api/workspaces`)).status).toBe(404);
  });
});
