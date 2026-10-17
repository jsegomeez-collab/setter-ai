import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

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

function setup() {
  const store = createMemoryStore();
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const users = createMemoryUserStore();
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users });
  return { app, users };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: HOST, 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const ADMIN = { setupKey: SETUP_KEY, email: 'jsegomeez@gmail.com', name: 'Jose', password: 'una-clave-muy-larga' };

describe('API de acceso (Fase 6.0)', () => {
  it('sin usuarios pide el alta del primer admin', async () => {
    const { app } = setup();
    const res = await app.request(`${HOST}/api/session`);
    expect(await res.json()).toEqual({ needsSetup: true, user: null });
  });

  it('el alta exige la clave actual del panel, crea al admin y deja la sesión abierta (cookie segura)', async () => {
    const { app } = setup();
    expect((await app.request(post('/api/setup', { ...ADMIN, setupKey: 'mala' }))).status).toBe(401);
    const res = await app.request(post('/api/setup', ADMIN));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ user: { email: 'jsegomeez@gmail.com', role: 'admin' } });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const session = await app.request(`${HOST}/api/session`, { headers: { cookie: cookieOf(res) } });
    expect(await session.json()).toMatchObject({ needsSetup: false, user: { name: 'Jose', role: 'admin' } });
  });

  it('el alta no se puede repetir y valida los datos (contraseña de 12+ caracteres, correo válido)', async () => {
    const { app } = setup();
    expect((await app.request(post('/api/setup', { ...ADMIN, password: 'corta' }))).status).toBe(400);
    expect((await app.request(post('/api/setup', { ...ADMIN, email: 'no-es-correo' }))).status).toBe(400);
    expect((await app.request(post('/api/setup', ADMIN))).status).toBe(201);
    expect((await app.request(post('/api/setup', { ...ADMIN, email: 'otro@x.com' }))).status).toBe(409);
  });

  it('login: acierta con la contraseña buena; con la mala da un error que no dice qué falló', async () => {
    const { app } = setup();
    await app.request(post('/api/setup', ADMIN));
    const bad = await app.request(post('/api/login', { email: ADMIN.email, password: 'otra-clave-larga' }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'Correo o contraseña incorrectos' });
    const unknown = await app.request(post('/api/login', { email: 'nadie@x.com', password: 'otra-clave-larga' }));
    expect(await unknown.json()).toEqual({ error: 'Correo o contraseña incorrectos' });
    const ok = await app.request(post('/api/login', { email: 'JSEGOMEEZ@gmail.com', password: ADMIN.password }));
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toMatch(/^sai_session=/);
  });

  it('5 fallos seguidos bloquean el login (429) aunque luego pongas la buena', async () => {
    const { app } = setup();
    await app.request(post('/api/setup', ADMIN));
    for (let i = 0; i < 5; i += 1) await app.request(post('/api/login', { email: ADMIN.email, password: 'mala-mala-mala' }));
    expect((await app.request(post('/api/login', { email: ADMIN.email, password: ADMIN.password }))).status).toBe(429);
  });

  it('logout cierra la sesión', async () => {
    const { app } = setup();
    const cookie = cookieOf(await app.request(post('/api/setup', ADMIN)));
    expect((await app.request(post('/api/logout', {}, { cookie }))).status).toBe(200);
    const session = await app.request(`${HOST}/api/session`, { headers: { cookie } });
    expect(await session.json()).toMatchObject({ user: null });
  });

  it('rechaza peticiones que cambian algo si vienen de otra web (Origin distinto) o sin Origin', async () => {
    const { app } = setup();
    expect((await app.request(post('/api/setup', ADMIN, { origin: 'https://malo.example' }))).status).toBe(403);
    const noOrigin = new Request(`${HOST}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ADMIN) });
    expect((await app.request(noOrigin)).status).toBe(403);
  });
});
