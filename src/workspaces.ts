import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { StoreOptions } from './store.js';

/**
 * Espacios (Fase 7.5a). El principal es el de Jose: sus datos se quedan en la base de siempre y no aparece aquí.
 * Cada espacio nuevo tiene su propia base de datos en el mismo Neon (CREATE DATABASE; límite 500 por rama, ver
 * PLAN.md) con las mismas tablas, así que todo el código de siempre sirve tal cual. Esta lista vive en la base
 * principal, igual que usuarios y sesiones.
 */

export interface Workspace {
  /** También es el nombre de su base de datos. */
  readonly id: string;
  readonly name: string;
  /** Cuenta de Instagram conectada (sus avisos de Meta vienen con este id). */
  readonly igUserId: string | null;
  readonly igUsername: string | null;
  readonly createdAt: Date;
}

export interface WorkspaceRegistry {
  list(): Promise<Workspace[]>;
  create(input: { readonly id: string; readonly name: string }): Promise<Workspace>;
  /** Falla si esa cuenta de Instagram ya está en otro espacio. */
  setInstagram(id: string, igUserId: string, igUsername: string | null): Promise<void>;
  findByIgUser(igUserId: string): Promise<Workspace | null>;
  /** Quita el espacio de la lista; su cuenta de Instagram queda como "quitada" (sus avisos se descartan). */
  remove(id: string): Promise<void>;
  /** Cuentas de Instagram de espacios borrados: sus avisos no deben ir al de Jose. */
  removedIgUsers(): Promise<string[]>;
}

/** Solo así se llaman las bases de los espacios: el nombre va dentro de un CREATE DATABASE. */
const WORKSPACE_ID = /^ws_[a-z0-9_]{1,50}$/;
const MAX_SLUG = 30;

const randomSuffix = (): string => randomBytes(2).toString('hex');

/** "Socio Pérez & Co" → "ws_socio_perez_co_a1b2". El final al azar evita choques entre nombres iguales. */
export function newWorkspaceId(name: string, suffix: () => string = randomSuffix): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, MAX_SLUG)
      .replace(/_+$/, '') || 'espacio';
  return `ws_${slug}_${suffix()}`;
}

/** La URL de la base de un espacio: la principal cambiando solo el nombre de la base. */
export function databaseUrlFor(mainUrl: string, workspaceId: string): string {
  const url = new URL(mainUrl);
  url.pathname = `/${workspaceId}`;
  return url.toString();
}

export function createDatabaseSql(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error(`Id de espacio no válido: ${workspaceId}`);
  return `CREATE DATABASE "${workspaceId}"`;
}

/** Crea la base vacía de un espacio (las tablas las crea su almacén al abrirse, como siempre). */
export async function provisionDatabase(sql: { unsafe(query: string): Promise<unknown> }, workspaceId: string): Promise<void> {
  await sql.unsafe(createDatabaseSql(workspaceId));
}

/** Borrar la base de un espacio: solo ids de espacio (nunca la principal). FORCE cierra las conexiones que queden. */
export function dropDatabaseSql(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error(`Id de espacio no válido: ${workspaceId}`);
  return `DROP DATABASE IF EXISTS "${workspaceId}" WITH (FORCE)`;
}

export async function dropDatabase(sql: { unsafe(query: string): Promise<unknown> }, workspaceId: string): Promise<void> {
  await sql.unsafe(dropDatabaseSql(workspaceId));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  ig_user_id text UNIQUE,
  ig_username text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS removed_ig_accounts (
  ig_user_id text PRIMARY KEY,
  removed_at timestamptz NOT NULL DEFAULT now()
);
`;

interface WorkspaceRow {
  id: string;
  name: string;
  ig_user_id: string | null;
  ig_username: string | null;
  created_at: Date;
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  igUserId: row.ig_user_id,
  igUsername: row.ig_username,
  createdAt: row.created_at,
});

export async function createPostgresWorkspaceRegistry(
  databaseUrl: string,
  options: StoreOptions = {},
): Promise<WorkspaceRegistry & { provision(workspaceId: string): Promise<void>; dropDatabase(workspaceId: string): Promise<void>; close(): Promise<void> }> {
  const sql = postgres(databaseUrl, { ssl: options.ssl === false ? false : 'require', max: options.maxConnections ?? 1, onnotice: () => undefined });
  await sql.unsafe(SCHEMA);
  return {
    async list() {
      return (await sql<WorkspaceRow[]>`SELECT * FROM workspaces ORDER BY created_at, id`).map(toWorkspace);
    },
    async create({ id, name }) {
      const [row] = await sql<WorkspaceRow[]>`INSERT INTO workspaces (id, name) VALUES (${id}, ${name}) RETURNING *`;
      if (!row) throw new Error('No se pudo guardar el espacio');
      return toWorkspace(row);
    },
    async setInstagram(id, igUserId, igUsername) {
      await sql`UPDATE workspaces SET ig_user_id = ${igUserId}, ig_username = ${igUsername} WHERE id = ${id}`;
      // Vuelve a estar en un espacio: sus avisos cuentan otra vez.
      await sql`DELETE FROM removed_ig_accounts WHERE ig_user_id = ${igUserId}`;
    },
    async findByIgUser(igUserId) {
      const [row] = await sql<WorkspaceRow[]>`SELECT * FROM workspaces WHERE ig_user_id = ${igUserId}`;
      return row ? toWorkspace(row) : null;
    },
    async remove(id) {
      await sql.begin(async (tx) => {
        const [row] = await tx<WorkspaceRow[]>`DELETE FROM workspaces WHERE id = ${id} RETURNING *`;
        if (row?.ig_user_id) await tx`INSERT INTO removed_ig_accounts (ig_user_id) VALUES (${row.ig_user_id}) ON CONFLICT DO NOTHING`;
      });
    },
    async removedIgUsers() {
      return (await sql<{ ig_user_id: string }[]>`SELECT ig_user_id FROM removed_ig_accounts ORDER BY removed_at`).map((row) => row.ig_user_id);
    },
    provision: (workspaceId) => provisionDatabase(sql, workspaceId),
    dropDatabase: (workspaceId) => dropDatabase(sql, workspaceId),
    async close() {
      await sql.end();
    },
  };
}
