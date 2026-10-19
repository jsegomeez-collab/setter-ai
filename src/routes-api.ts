import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  LoginLimiter,
  MIN_USER_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_DAYS,
  hashPassword,
  hashToken,
  newSessionToken,
  sameSecret,
  verifyPassword,
} from './auth.js';
import type { User, UserStore } from './users.js';

/**
 * API JSON del frontend (Fase 6) en /api. Sesión en cookie HttpOnly + Secure + SameSite=Lax; las peticiones que
 * cambian algo solo se aceptan desde la propia web (Origin = este servidor).
 */

export interface ApiDeps {
  readonly users: UserStore;
  /** Clave que pide el alta del primer admin: la contraseña actual del panel (ADMIN_PASSWORD). */
  readonly setupKey: string;
  readonly limiter?: LoginLimiter;
}

export type ApiEnv = { Variables: { user: User } };

const DAY_SECONDS = 24 * 60 * 60;
const MAX_NAME = 60;
const MAX_PASSWORD = 200;
const WRONG_LOGIN = 'Correo o contraseña incorrectos';
const BLOCKED = 'Demasiados intentos. Espera 15 minutos y vuelve a probar.';
/** Hash de mentira: si el correo no existe se compara igual, para que tarde lo mismo y no revele qué correos hay. */
const DUMMY_HASH = hashPassword('contraseña-de-relleno');

const setupSchema = z.object({
  setupKey: z.string().min(1),
  email: z.email(),
  name: z.string().trim().min(1).max(MAX_NAME),
  password: z.string().min(MIN_USER_PASSWORD_LENGTH).max(MAX_PASSWORD),
});
const loginSchema = z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(MAX_PASSWORD) });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Solo acepta cambios que vengan de esta misma web (protege la cookie de sesión de otras webs). */
const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header('origin');
  try {
    if (origin && new URL(origin).host === new URL(c.req.url).host) return next();
  } catch {
    // Origin mal formado: se rechaza abajo.
  }
  return c.json({ error: 'Origen no permitido' }, 403);
};

function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export const publicUser = (user: User) => ({ id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function startSession(c: Context, users: UserStore, user: User): Promise<void> {
  const token = newSessionToken();
  await users.createSession(hashToken(token), user.id, new Date(Date.now() + SESSION_DAYS * DAY_SECONDS * 1000));
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * DAY_SECONDS });
}

/** Huella de la sesión de esta petición (la cookie nunca se guarda tal cual). */
export function sessionTokenHash(c: Context): string | null {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? hashToken(token) : null;
}

/** Usuario de la sesión de esta petición (también lo usa el reparto entre espacios, Fase 7.5a). */
export async function currentUser(c: Context, users: UserStore): Promise<User | null> {
  const tokenHash = sessionTokenHash(c);
  return tokenHash ? users.findSession(tokenHash) : null;
}

/**
 * Para las rutas privadas de /api: sin sesión, 401. Deja el usuario en c.get('user').
 * Con clave temporal sin cambiar (Fase 6.7), 403 en todo salvo en la ruta de cambiarla (`allowPendingPassword`).
 */
export function requireUser(users: UserStore, options: { allowPendingPassword?: boolean } = {}): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const user = await currentUser(c, users);
    if (!user) return c.json({ error: 'Inicia sesión' }, 401);
    if (user.mustChangePassword && !options.allowPendingPassword) {
      return c.json({ error: 'Cambia tu clave temporal para continuar.', mustChangePassword: true }, 403);
    }
    c.set('user', user);
    return next();
  };
}

/** Solo admin (setter, flujos, configuración, usuarios). Va después de requireUser. */
export const requireAdmin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Solo el administrador puede hacer esto' }, 403);
  return next();
};

export function createApiRoutes(deps: ApiDeps): Hono<ApiEnv> {
  const { users } = deps;
  const limiter = deps.limiter ?? new LoginLimiter();
  const api = new Hono<ApiEnv>();
  api.use('*', sameOrigin);

  api.get('/session', async (c) => {
    const user = await currentUser(c, users);
    const needsSetup = user ? false : (await users.countUsers()) === 0;
    return c.json({ needsSetup, user: user ? publicUser(user) : null });
  });

  api.post('/setup', async (c) => {
    const parsed = setupSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `Revisa los datos: correo válido, nombre y contraseña de ${MIN_USER_PASSWORD_LENGTH}+ caracteres` }, 400);
    const key = `setup|${clientIp(c)}`;
    if (limiter.isBlocked(key)) return c.json({ error: BLOCKED }, 429);
    if ((await users.countUsers()) > 0) return c.json({ error: 'Ya hay un administrador. Inicia sesión.' }, 409);
    if (!sameSecret(parsed.data.setupKey, deps.setupKey)) {
      limiter.fail(key);
      return c.json({ error: 'La clave del panel no es correcta' }, 401);
    }
    const { email, name, password } = parsed.data;
    const user = await users.createFirstAdmin({ email, name, passwordHash: await hashPassword(password) });
    if (!user) return c.json({ error: 'Ya hay un administrador. Inicia sesión.' }, 409);
    limiter.succeed(key);
    await startSession(c, users, user);
    return c.json({ user: publicUser(user) }, 201);
  });

  api.post('/login', async (c) => {
    const parsed = loginSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: WRONG_LOGIN }, 400);
    const key = `${clientIp(c)}|${parsed.data.email.toLowerCase()}`;
    if (limiter.isBlocked(key)) return c.json({ error: BLOCKED }, 429);
    const stored = await users.findUserByEmail(parsed.data.email);
    const ok = await verifyPassword(parsed.data.password, stored?.passwordHash ?? (await DUMMY_HASH));
    if (!stored || !ok) {
      limiter.fail(key);
      return c.json({ error: WRONG_LOGIN }, 401);
    }
    limiter.succeed(key);
    await startSession(c, users, stored);
    return c.json({ user: publicUser(stored) });
  });

  api.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await users.deleteSession(hashToken(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ ok: true });
  });

  return api;
}
