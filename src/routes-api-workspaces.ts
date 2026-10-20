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
  /** ¿Envíos con el cerrojo de Jose? null = ese espacio no está en marcha. */
  sendsLocked(id: string): Promise<boolean | null>;
  /** Jose activa (false) o vuelve a bloquear (true) los envíos de un espacio. */
  setSendsLock(id: string, locked: boolean, who: string): Promise<void>;
  /** Borra el espacio para siempre: lo para, borra su base y lo quita de la lista (workspace-manager.ts). */
  remove(id: string): Promise<void>;
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
const sendsSchema = z.object({ locked: z.boolean() });

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
    const locks = await Promise.all(workspaces.map((ws) => admin.sendsLocked(ws.id)));
    return c.json({
      workspaces: workspaces.map((ws, i) => ({
        ...ws,
        sendsLocked: locks[i] ?? null,
        people: everyone.filter((user) => user.workspaceId === ws.id).map((user) => ({ name: user.name, email: user.email, role: user.role })),
      })),
    });
  });

  // Envíos de un espacio: nacen bloqueados y solo Jose los activa o los vuelve a bloquear (decisión de Jose, 20-10).
  api.post('/:id/sends', async (c) => {
    const parsed = sendsSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Indica si los envíos quedan bloqueados (sí o no).' }, 400);
    const workspace = (await admin.list()).find((ws) => ws.id === c.req.param('id'));
    if (!workspace) return c.json({ error: 'Ese espacio no existe' }, 404);
    const who = c.get('user').name;
    try {
      await admin.setSendsLock(workspace.id, parsed.data.locked, who);
    } catch (error) {
      return c.json({ error: `No se pudo cambiar: ${errorText(error)}` }, 500);
    }
    await store.logEvent('espacios', `${who} ${parsed.data.locked ? 'bloqueó' : 'activó'} los envíos del espacio "${workspace.name}".`, { workspaceId: workspace.id, locked: parsed.data.locked });
    return c.json({ ok: true });
  });

  // Borrar un espacio para siempre (decisión de Jose, 20-10): hay que escribir su nombre tal cual. Primero se borra
  // el espacio (base incluida); solo si sale bien se quita a sus usuarios, para no dejar un espacio sin nadie.
  api.post('/:id/delete', async (c) => {
    const workspace = (await admin.list()).find((ws) => ws.id === c.req.param('id'));
    if (!workspace) return c.json({ error: 'Ese espacio no existe' }, 404);
    const confirm = ((await readJson(c)) as { confirm?: unknown } | null)?.confirm;
    if (confirm !== workspace.name) return c.json({ error: `Para borrarlo, escribe su nombre tal cual: ${workspace.name}` }, 400);
    const who = c.get('user').name;
    try {
      await admin.remove(workspace.id);
    } catch (error) {
      await store.logEvent('espacios', `${who} intentó borrar el espacio "${workspace.name}" y falló.`, { workspaceId: workspace.id, error: errorText(error) });
      return c.json({ error: `No se pudo borrar: ${errorText(error)}` }, 500);
    }
    const people = (await admin.users.listUsers()).filter((user) => user.workspaceId === workspace.id);
    for (const person of people) await admin.users.deleteUser(person.id);
    await store.logEvent('espacios', `${who} borró el espacio "${workspace.name}" (su base de datos y ${people.length} usuario(s)).`, {
      workspaceId: workspace.id,
      igUsername: workspace.igUsername,
    });
    return c.json({ ok: true });
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
