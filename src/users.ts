import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { StoreOptions } from './store.js';

/**
 * Usuarios y sesiones del frontend (Fase 6). Aparte de store.ts (que ya roza el máximo de tamaño) y con su propia
 * conexión pequeña. Roles (decisión de Jose 2026-10-17): admin = todo; team = conversaciones, contactos y métricas.
 */

export type Role = 'admin' | 'team';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly createdAt: Date;
}

export interface StoredUser extends User {
  readonly passwordHash: string;
}

export interface NewUser {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly passwordHash: string;
}

export interface UserStore {
  countUsers(): Promise<number>;
  /** Crea el primer admin solo si no hay ningún usuario (en una sola consulta: dos altas a la vez no crean dos). */
  createFirstAdmin(input: Omit<NewUser, 'role'>): Promise<User | null>;
  createUser(input: NewUser): Promise<User>;
  /** Incluye el hash de la contraseña: solo para comprobar el login. */
  findUserByEmail(email: string): Promise<StoredUser | null>;
  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** Usuario de una sesión no caducada (sin el hash de la contraseña). */
  findSession(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'team')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON app_sessions (expires_at);
`;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  created_at: Date;
}

const toUser = (row: UserRow): User => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at });

export async function createPostgresUserStore(databaseUrl: string, options: StoreOptions = {}): Promise<UserStore & { close(): Promise<void> }> {
  const sql = postgres(databaseUrl, {
    ssl: options.ssl === false ? false : 'require',
    max: options.maxConnections ?? 2,
    onnotice: () => undefined,
  });
  await sql.unsafe(SCHEMA);

  return {
    async countUsers() {
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM app_users`;
      return row?.n ?? 0;
    },
    async createFirstAdmin(input) {
      const rows = await sql<UserRow[]>`
        INSERT INTO app_users (id, email, name, role, password_hash)
        SELECT ${randomUUID()}, ${input.email.toLowerCase()}, ${input.name}, 'admin', ${input.passwordHash}
        WHERE NOT EXISTS (SELECT 1 FROM app_users)
        RETURNING *`;
      return rows[0] ? toUser(rows[0]) : null;
    },
    async createUser(input) {
      const [row] = await sql<UserRow[]>`
        INSERT INTO app_users (id, email, name, role, password_hash)
        VALUES (${randomUUID()}, ${input.email.toLowerCase()}, ${input.name}, ${input.role}, ${input.passwordHash})
        RETURNING *`;
      if (!row) throw new Error('No se pudo crear el usuario');
      return toUser(row);
    },
    async findUserByEmail(email) {
      const [row] = await sql<UserRow[]>`SELECT * FROM app_users WHERE email = ${email.toLowerCase()}`;
      return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
    },
    async createSession(tokenHash, userId, expiresAt) {
      // De paso se limpian las sesiones caducadas (no hace falta una tarea aparte).
      await sql`DELETE FROM app_sessions WHERE expires_at < now()`;
      await sql`INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${userId}, ${expiresAt})`;
    },
    async findSession(tokenHash) {
      const [row] = await sql<UserRow[]>`
        SELECT u.* FROM app_sessions s JOIN app_users u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()`;
      return row ? toUser(row) : null;
    },
    async deleteSession(tokenHash) {
      await sql`DELETE FROM app_sessions WHERE token_hash = ${tokenHash}`;
    },
    async close() {
      await sql.end();
    },
  };
}
