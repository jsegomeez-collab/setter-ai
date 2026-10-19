import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/**
 * Usuarios (Fase 6.7). Decisión de Jose: el admin crea al usuario y la web da una CLAVE TEMPORAL (se ve una vez);
 * al entrar la primera vez tiene que cambiarla, y hasta entonces el servidor no le deja usar nada más.
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
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users });
  let ip = 0;
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      // Cada petición con otra IP: así el límite de intentos de login no interfiere entre pruebas.
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const admin = cookieOf(await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' }));
  const login = async (email: string, password: string) => cookieOf(await send('POST', '/api/login', '', { email, password }));
  const create = async (email: string, role: 'admin' | 'team' = 'team') =>
    (await send('POST', '/api/users', admin, { email, name: 'Laura', role })).json() as Promise<{ user: { id: string; mustChangePassword: boolean }; tempPassword: string }>;
  return { send, admin, login, create, users };
}

describe('API Usuarios (Fase 6.7)', () => {
  it('el admin crea un usuario: la clave temporal se ve una vez; correo repetido o mal escrito, error; el equipo no puede', async () => {
    const { send, admin, create } = await setup();
    const created = await create('laura@x.com');
    expect(created.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(created.user).toMatchObject({ mustChangePassword: true });
    const list = (await (await send('GET', '/api/users', admin)).json()).users;
    expect(list.map((u: { email: string }) => u.email)).toEqual(['jose@x.com', 'laura@x.com']);
    expect(JSON.stringify(list)).not.toContain(created.tempPassword);
    expect((await send('POST', '/api/users', admin, { email: 'laura@x.com', name: 'Otra', role: 'team' })).status).toBe(409);
    expect((await send('POST', '/api/users', admin, { email: 'no-es-correo', name: 'X', role: 'team' })).status).toBe(400);
  });

  it('con clave temporal solo puede cambiarla: el resto de la API da 403 hasta que lo haga; después entra normal', async () => {
    const { send, create, login } = await setup();
    const { tempPassword } = await create('laura@x.com');
    const laura = await login('laura@x.com', tempPassword);
    expect((await (await send('GET', '/api/session', laura)).json()).user).toMatchObject({ mustChangePassword: true });
    const blocked = await send('GET', '/api/contacts', laura);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ mustChangePassword: true });

    expect((await send('POST', '/api/me/password', laura, { current: 'mala-clave-123', next: 'mi-clave-nueva-larga' })).status).toBe(400);
    expect((await send('POST', '/api/me/password', laura, { current: tempPassword, next: 'corta' })).status).toBe(400);
    expect((await send('POST', '/api/me/password', laura, { current: tempPassword, next: tempPassword })).status).toBe(400);
    expect((await send('POST', '/api/me/password', laura, { current: tempPassword, next: 'mi-clave-nueva-larga' })).status).toBe(200);
    expect((await send('GET', '/api/contacts', laura)).status).toBe(200);
    expect(await login('laura@x.com', 'mi-clave-nueva-larga')).not.toBe('');
  });

  it('nueva clave temporal: cierra sus sesiones y le obliga a cambiarla otra vez; a uno mismo no', async () => {
    const { send, admin, create, login, users } = await setup();
    const { user, tempPassword } = await create('laura@x.com');
    const laura = await login('laura@x.com', tempPassword);
    await send('POST', '/api/me/password', laura, { current: tempPassword, next: 'mi-clave-nueva-larga' });
    const reset = await (await send('POST', `/api/users/${user.id}/reset-password`, admin)).json();
    expect(reset.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect((await send('GET', '/api/contacts', laura)).status).toBe(401);
    expect((await users.findUserById(user.id))?.mustChangePassword).toBe(true);
    const me = (await users.findUserByEmail('jose@x.com'))!;
    expect((await send('POST', `/api/users/${me.id}/reset-password`, admin)).status).toBe(400);
  });

  it('rol y quitar acceso: nunca a uno mismo; quitar pide BORRAR y cierra su sesión', async () => {
    const { send, admin, create, login, users } = await setup();
    const { user, tempPassword } = await create('laura@x.com');
    const me = (await users.findUserByEmail('jose@x.com'))!;
    expect((await send('POST', `/api/users/${user.id}/role`, admin, { role: 'admin' })).status).toBe(200);
    expect((await users.findUserById(user.id))?.role).toBe('admin');
    expect((await send('POST', `/api/users/${me.id}/role`, admin, { role: 'team' })).status).toBe(400);

    const laura = await login('laura@x.com', tempPassword);
    expect((await send('POST', `/api/users/${user.id}/delete`, admin, {})).status).toBe(400);
    expect((await send('POST', `/api/users/${me.id}/delete`, admin, { confirm: 'BORRAR' })).status).toBe(400);
    expect((await send('POST', `/api/users/${user.id}/delete`, admin, { confirm: 'BORRAR' })).status).toBe(200);
    expect(await (await send('GET', '/api/session', laura)).json()).toMatchObject({ user: null });
    expect((await send('POST', '/api/users/no-existe/delete', admin, { confirm: 'BORRAR' })).status).toBe(404);
  });
});
