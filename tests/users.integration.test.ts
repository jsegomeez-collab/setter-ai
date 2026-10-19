import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresUserStore, type UserStore } from '../src/users.js';

/** Usuarios y sesiones del frontend (Fase 6) contra un Postgres real (PGlite) en memoria. */

const PORT = 54331;
const URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
let db: PGlite;
let server: PGLiteSocketServer;
let users: UserStore & { close(): Promise<void> };

beforeAll(async () => {
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  users = await createPostgresUserStore(URL, { ssl: false, maxConnections: 1 });
}, 60_000);

afterAll(async () => {
  await users?.close();
  await server?.stop();
  await db?.close();
});

const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);

describe('createPostgresUserStore (Postgres real)', () => {
  it('se puede volver a arrancar sin error (tablas idempotentes) y empieza sin usuarios', async () => {
    await users.close();
    users = await createPostgresUserStore(URL, { ssl: false, maxConnections: 1 });
    expect(await users.countUsers()).toBe(0);
  });

  it('el primer admin solo se crea si no hay nadie (el alta no se puede repetir)', async () => {
    const admin = await users.createFirstAdmin({ email: 'Jose@Example.com', name: 'Jose', passwordHash: 'h1' });
    expect(admin).toMatchObject({ email: 'jose@example.com', name: 'Jose', role: 'admin' });
    expect(await users.createFirstAdmin({ email: 'otro@example.com', name: 'Otro', passwordHash: 'h2' })).toBeNull();
    expect(await users.countUsers()).toBe(1);
  });

  it('busca por correo sin distinguir mayúsculas y devuelve el hash para comprobar la contraseña', async () => {
    expect(await users.findUserByEmail('JOSE@example.com')).toMatchObject({ email: 'jose@example.com', passwordHash: 'h1' });
    expect(await users.findUserByEmail('nadie@example.com')).toBeNull();
  });

  it('crea usuarios del equipo y no deja repetir correo', async () => {
    expect(await users.createUser({ email: 'equipo@example.com', name: 'Equipo', role: 'team', passwordHash: 'h3' })).toMatchObject({ role: 'team' });
    await expect(users.createUser({ email: 'EQUIPO@example.com', name: 'X', role: 'team', passwordHash: 'h4' })).rejects.toThrow();
  });

  it('las sesiones caducan y se pueden cerrar; nunca devuelven el hash de la contraseña', async () => {
    const admin = await users.findUserByEmail('jose@example.com');
    await users.createSession('huella-ok', admin!.id, IN_ONE_HOUR());
    await users.createSession('huella-caducada', admin!.id, new Date(Date.now() - 1000));
    const user = await users.findSession('huella-ok');
    expect(user).toMatchObject({ email: 'jose@example.com', role: 'admin' });
    expect(user).not.toHaveProperty('passwordHash');
    expect(await users.findSession('huella-caducada')).toBeNull();
    await users.deleteSession('huella-ok');
    expect(await users.findSession('huella-ok')).toBeNull();
  });

  it('Fase 6.7 · clave temporal: el usuario nuevo debe cambiarla; cambiarla la quita y cierra las otras sesiones', async () => {
    const temp = await users.createUser({ email: 'nuevo@example.com', name: 'Nuevo', role: 'team', passwordHash: 'temp', mustChangePassword: true });
    expect(temp.mustChangePassword).toBe(true);
    await users.createSession('nuevo-a', temp.id, IN_ONE_HOUR());
    await users.createSession('nuevo-b', temp.id, IN_ONE_HOUR());
    expect((await users.findSession('nuevo-a'))?.mustChangePassword).toBe(true);

    await users.setPassword(temp.id, 'nueva', false);
    await users.deleteUserSessions(temp.id, 'nuevo-a');
    expect((await users.findUserById(temp.id))?.passwordHash).toBe('nueva');
    expect((await users.findSession('nuevo-a'))?.mustChangePassword).toBe(false);
    expect(await users.findSession('nuevo-b')).toBeNull();
  });

  it('Fase 6.7 · listar (sin hashes), cambiar rol y quitar el acceso (con sus sesiones)', async () => {
    const list = await users.listUsers();
    expect(list.map((u) => u.email)).toEqual(['jose@example.com', 'equipo@example.com', 'nuevo@example.com']);
    expect(list[0]).not.toHaveProperty('passwordHash');
    const nuevo = list[2]!;
    expect(await users.updateUserRole(nuevo.id, 'admin')).toMatchObject({ role: 'admin' });
    expect(await users.updateUserRole('no-existe', 'admin')).toBeNull();
    await users.createSession('nuevo-c', nuevo.id, IN_ONE_HOUR());
    expect(await users.deleteUser(nuevo.id)).toBe(true);
    expect(await users.findSession('nuevo-c')).toBeNull();
    expect(await users.deleteUser(nuevo.id)).toBe(false);
  });
  it('Fase 7.5a · cada usuario guarda su espacio (vacío = principal) y la sesión lo devuelve', async () => {
    const socio = await users.createUser({ email: 'socio75@x.com', name: 'Socio', role: 'admin', passwordHash: 'h', workspaceId: 'ws_socio' });
    expect(socio.workspaceId).toBe('ws_socio');
    await users.createSession('socio75-s', socio.id, new Date(Date.now() + 60_000));
    expect((await users.findSession('socio75-s'))?.workspaceId).toBe('ws_socio');
    const otro = await users.createUser({ email: 'principal75@x.com', name: 'P', role: 'team', passwordHash: 'h' });
    expect((await users.findUserById(otro.id))?.workspaceId).toBeNull();
  });
});
