import { Hono, type Context } from 'hono';
import { readLinkToken } from './links.js';
import { currentUser } from './routes-api.js';
import type { UserStore } from './users.js';
import type { WorkspaceManager } from './workspace-manager.js';

/**
 * Reparto de peticiones entre espacios (Fase 7.5a). Cada espacio tiene su app completa (la de siempre); aquí solo se
 * decide a cuál va cada petición:
 *  - /api/*: al espacio de quien ha iniciado sesión (sin sesión, al principal: login, alta, sesión…).
 *  - /l/<enlace>: al espacio que envió el enlace (va dentro, firmado); los enlaces antiguos, al principal.
 *  - Todo lo demás (la web, /webhook, el panel antiguo, la vuelta de Conectar Instagram): al principal. Los avisos
 *    de Meta los reparte después el gestor por cuenta de Instagram (dispatchWebhook).
 */

export interface RouterDeps {
  readonly users: UserStore;
  readonly manager: WorkspaceManager;
  readonly linkSecret: string | null;
}

export function createRouter(deps: RouterDeps): Hono {
  const { manager } = deps;
  const router = new Hono();
  const principal = (c: Context) => manager.principal.app.fetch(c.req.raw);

  router.all('/api/*', async (c) => {
    const user = await currentUser(c, deps.users);
    const runtime = manager.get(user?.workspaceId ?? null);
    if (!runtime) return c.json({ error: 'Tu espacio no está disponible ahora mismo. Inténtalo en unos minutos.' }, 503);
    return runtime.app.fetch(c.req.raw);
  });

  router.get('/l/:token', (c) => {
    const data = deps.linkSecret ? readLinkToken(deps.linkSecret, c.req.param('token')) : null;
    const runtime = data?.w ? manager.get(data.w) : undefined;
    return (runtime ?? manager.principal).app.fetch(c.req.raw);
  });

  router.all('*', principal);
  return router;
}
