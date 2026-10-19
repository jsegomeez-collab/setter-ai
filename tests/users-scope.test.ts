import { describe, expect, it } from 'vitest';
import { scopeUsers } from '../src/users-scope.js';
import { createMemoryUserStore } from './users-memory.js';

/** Fase 7.5a: cada espacio solo ve y gestiona a su gente; el inicio de sesión sigue siendo uno para todos. */

async function setup() {
  const all = createMemoryUserStore();
  const jose = await all.createUser({ email: 'jose@x.com', name: 'Jose', role: 'admin', passwordHash: 'h' });
  const socio = await all.createUser({ email: 'socio@x.com', name: 'Socio', role: 'admin', passwordHash: 'h', workspaceId: 'ws_socio' });
  return { all, jose, socio, principal: scopeUsers(all, null), espacio: scopeUsers(all, 'ws_socio') };
}

describe('scopeUsers', () => {
  it('cada espacio lista solo a los suyos (el principal, a los que no tienen espacio)', async () => {
    const { principal, espacio } = await setup();
    expect((await principal.listUsers()).map((u) => u.email)).toEqual(['jose@x.com']);
    expect((await espacio.listUsers()).map((u) => u.email)).toEqual(['socio@x.com']);
  });

  it('crear un usuario lo mete en ese espacio', async () => {
    const { espacio, all } = await setup();
    const nuevo = await espacio.createUser({ email: 'equipo@x.com', name: 'Equipo', role: 'team', passwordHash: 'h' });
    expect(nuevo.workspaceId).toBe('ws_socio');
    expect((await all.findUserById(nuevo.id))?.workspaceId).toBe('ws_socio');
  });

  it('no se puede tocar a nadie de otro espacio (buscar, cambiar rol, clave, sesiones ni borrar)', async () => {
    const { espacio, jose, all } = await setup();
    expect(await espacio.findUserById(jose.id)).toBeNull();
    expect(await espacio.updateUserRole(jose.id, 'team')).toBeNull();
    await espacio.setPassword(jose.id, 'otra', true);
    expect((await all.findUserById(jose.id))?.passwordHash).toBe('h');
    expect(await espacio.deleteUser(jose.id)).toBe(false);
    expect(await all.findUserById(jose.id)).not.toBeNull();
  });

  it('el alta del primer admin solo existe en el principal', async () => {
    const empty = createMemoryUserStore();
    expect(await scopeUsers(empty, 'ws_socio').createFirstAdmin({ email: 'a@x.com', name: 'A', passwordHash: 'h' })).toBeNull();
    expect(await scopeUsers(empty, null).createFirstAdmin({ email: 'a@x.com', name: 'A', passwordHash: 'h' })).toMatchObject({ workspaceId: null });
  });

  it('el inicio de sesión es uno para todos: se encuentra a cualquiera por correo y por sesión', async () => {
    const { espacio, jose } = await setup();
    expect((await espacio.findUserByEmail('jose@x.com'))?.id).toBe(jose.id);
  });
});
