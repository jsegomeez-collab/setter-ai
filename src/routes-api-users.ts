import { randomInt } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { LoginLimiter, MIN_USER_PASSWORD_LENGTH, hashPassword, verifyPassword } from './auth.js';
import { publicUser, requireAdmin, requireUser, sessionTokenHash, type ApiEnv } from './routes-api.js';
import type { Store } from './store.js';
import type { UserStore } from './users.js';

/**
 * Usuarios (Fase 6.7). Decisión de Jose: el admin crea al usuario y la web da una CLAVE TEMPORAL (se enseña una vez,
 * no se guarda en claro); al entrar tiene que cambiarla (requireUser bloquea todo lo demás hasta entonces).
 * Nadie puede cambiarse el rol, quitarse el acceso ni resetearse la clave a sí mismo (así siempre queda un admin).
 */

export interface UsersApiDeps {
  readonly users: UserStore;
  readonly store: Pick<Store, 'logEvent'>;
  readonly limiter?: LoginLimiter;
}

const MAX_NAME = 60;
const MAX_PASSWORD = 200;
const TEMP_PASSWORD_LENGTH = 16;
/** Sin letras que se confunden al dictarlas o copiarlas (0/O, 1/l/I). */
const TEMP_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const roleSchema = z.enum(['admin', 'team']);
const createSchema = z.object({ email: z.email(), name: z.string().trim().min(1).max(MAX_NAME), role: roleSchema });
const passwordSchema = z.object({ current: z.string().min(1).max(MAX_PASSWORD), next: z.string().min(MIN_USER_PASSWORD_LENGTH).max(MAX_PASSWORD) });

export function newTempPassword(): string {
  return Array.from({ length: TEMP_PASSWORD_LENGTH }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join('');
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** /api/users: solo admin. */
export function createUsersApi(deps: UsersApiDeps): Hono<ApiEnv> {
  const { users, store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(users));
  api.use('*', requireAdmin);

  api.get('/', async (c) => c.json({ users: (await users.listUsers()).map((u) => ({ ...publicUser(u), createdAt: u.createdAt })) }));

  api.post('/', async (c) => {
    const parsed = createSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Revisa los datos: correo válido, nombre y rol.' }, 400);
    if (await users.findUserByEmail(parsed.data.email)) return c.json({ error: 'Ya hay un usuario con ese correo.' }, 409);
    const tempPassword = newTempPassword();
    const user = await users.createUser({ ...parsed.data, passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
    await store.logEvent('usuarios', `${c.get('user').name} dio acceso a ${user.name} (${user.role === 'admin' ? 'admin' : 'equipo'}).`, { userId: user.id });
    return c.json({ user: publicUser(user), tempPassword }, 201);
  });

  /** Busca al otro usuario; nunca uno mismo (respuesta de error si no vale). */
  const target = async (c: Context<ApiEnv>, what: string) => {
    const id = c.req.param('id') ?? '';
    if (id === c.get('user').id) return { error: c.json({ error: `No puedes ${what} a ti mismo.` }, 400) } as const;
    const user = await users.findUserById(id);
    if (!user) return { error: c.json({ error: 'Ese usuario no existe' }, 404) } as const;
    return { user } as const;
  };

  api.post('/:id/role', async (c) => {
    const role = roleSchema.safeParse(((await readJson(c)) as { role?: unknown } | null)?.role);
    if (!role.success) return c.json({ error: 'Rol no válido.' }, 400);
    const found = await target(c, 'cambiarte el rol');
    if ('error' in found) return found.error;
    await users.updateUserRole(found.user.id, role.data);
    await store.logEvent('usuarios', `${c.get('user').name} cambió el rol de ${found.user.name} a ${role.data === 'admin' ? 'admin' : 'equipo'}.`, { userId: found.user.id });
    return c.json({ ok: true });
  });

  api.post('/:id/reset-password', async (c) => {
    const found = await target(c, 'resetearte la clave');
    if ('error' in found) return found.error;
    const tempPassword = newTempPassword();
    await users.setPassword(found.user.id, await hashPassword(tempPassword), true);
    await users.deleteUserSessions(found.user.id);
    await store.logEvent('usuarios', `${c.get('user').name} dio una clave temporal nueva a ${found.user.name}.`, { userId: found.user.id });
    return c.json({ tempPassword });
  });

  api.post('/:id/delete', async (c) => {
    const found = await target(c, 'quitarte el acceso');
    if ('error' in found) return found.error;
    if (((await readJson(c)) as { confirm?: unknown } | null)?.confirm !== 'BORRAR') return c.json({ error: 'Para quitar el acceso, escribe BORRAR.' }, 400);
    await users.deleteUser(found.user.id);
    await store.logEvent('usuarios', `${c.get('user').name} quitó el acceso a ${found.user.name}.`, { userId: found.user.id });
    return c.json({ ok: true });
  });

  return api;
}

/** /api/me: lo de cada uno. Cambiar la clave también vale con la clave temporal sin cambiar. */
export function createMeApi(deps: UsersApiDeps): Hono<ApiEnv> {
  const { users, store } = deps;
  const limiter = deps.limiter ?? new LoginLimiter();
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(users, { allowPendingPassword: true }));

  api.post('/password', async (c) => {
    const me = c.get('user');
    const key = `password|${me.id}`;
    if (limiter.isBlocked(key)) return c.json({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
    const parsed = passwordSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `La clave nueva tiene que tener ${MIN_USER_PASSWORD_LENGTH} caracteres o más.` }, 400);
    if (parsed.data.next === parsed.data.current) return c.json({ error: 'La clave nueva tiene que ser distinta de la actual.' }, 400);
    const stored = await users.findUserById(me.id);
    if (!stored || !(await verifyPassword(parsed.data.current, stored.passwordHash))) {
      limiter.fail(key);
      return c.json({ error: 'La clave actual no es correcta.' }, 400);
    }
    limiter.succeed(key);
    await users.setPassword(me.id, await hashPassword(parsed.data.next), false);
    // Las demás sesiones abiertas se cierran (si alguien tenía la clave vieja, se queda fuera); esta sigue.
    await users.deleteUserSessions(me.id, sessionTokenHash(c) ?? undefined);
    await store.logEvent('usuarios', `${me.name} cambió su clave.`, { userId: me.id });
    return c.json({ ok: true });
  });

  return api;
}
