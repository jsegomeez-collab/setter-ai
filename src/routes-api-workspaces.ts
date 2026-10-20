import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { hashPassword } from './auth.js';
import { publicUser, requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { newTempPassword } from './routes-api-users.js';
import type { Store } from './store.js';
import type { UserStore } from './users.js';
import type { Workspace } from './workspaces.js';

/**
 * Espacios (Fase 7.5b). Solo existe en el espacio de Jose (principal) y solo para admins: decisión de Jose, altas
 * solo por invitación suya. Crear un espacio crea su base, lo arranca y da de alta a quien lo lleva con una clave
 * temporal (se ve una vez; al entrar tiene que cambiarla, como en la 6.7).
 */

export interface WorkspacesAdmin {
  list(): Promise<Workspace[]>;
  create(name: string): Promise<Workspace>;
  /** Usuarios de TODOS los espacios: para dar de alta a quien lleva el nuevo y ver quién lleva cada uno. */
  readonly users: UserStore;
}

export interface WorkspacesApiDeps {
  readonly store: Store;
  /** Los del principal (para la sesión y los permisos). */
  readonly users: UserStore;
  readonly admin: WorkspacesAdmin;
}

const MAX_NAME = 60;
const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  adminEmail: z.email(),
  adminName: z.string().trim().min(1).max(MAX_NAME),
});

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createWorkspacesApi(deps: WorkspacesApiDeps): Hono<ApiEnv> {
  const { store, admin } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));
  api.use('*', requireAdmin);

  api.get('/', async (c) => {
    const [workspaces, everyone] = await Promise.all([admin.list(), admin.users.listUsers()]);
    return c.json({
      workspaces: workspaces.map((ws) => ({
        ...ws,
        people: everyone.filter((user) => user.workspaceId === ws.id).map((user) => ({ name: user.name, email: user.email, role: user.role })),
      })),
    });
  });

  api.post('/', async (c) => {
    const parsed = createSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `Pon el nombre del espacio y el correo y nombre de quien lo lleva (hasta ${MAX_NAME} caracteres).` }, 400);
    const { name, adminEmail, adminName } = parsed.data;
    // Antes de crear nada: si el correo ya tiene cuenta, el espacio quedaría sin nadie que lo lleve.
    if (await admin.users.findUserByEmail(adminEmail)) return c.json({ error: `${adminEmail} ya tiene cuenta. Usa otro correo.` }, 400);
    const who = c.get('user').name;
    let workspace: Workspace;
    try {
      workspace = await admin.create(name);
    } catch (error) {
      await store.logEvent('espacios', `${who} intentó crear el espacio "${name}" y falló.`, { error: errorText(error) });
      return c.json({ error: `No se pudo crear el espacio: ${errorText(error)}` }, 500);
    }
    const tempPassword = newTempPassword();
    try {
      const user = await admin.users.createUser({
        email: adminEmail,
        name: adminName,
        role: 'admin',
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        workspaceId: workspace.id,
      });
      await store.logEvent('espacios', `${who} creó el espacio "${workspace.name}" y dio acceso a ${user.name}.`, { workspaceId: workspace.id, userId: user.id });
      return c.json({ workspace, admin: publicUser(user), tempPassword }, 201);
    } catch (error) {
      await store.logEvent('espacios', `${who} creó el espacio "${workspace.name}", pero no se pudo dar de alta a ${adminName}.`, { workspaceId: workspace.id, error: errorText(error) });
      return c.json({ error: `El espacio se creó, pero no se pudo dar de alta a ${adminName}: ${errorText(error)}`, workspace }, 500);
    }
  });

  return api;
}
