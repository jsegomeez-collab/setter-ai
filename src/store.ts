import postgres from 'postgres';
import type { Flow } from './flows/types.js';

/** Todo lo que el servidor guarda o lee. La interfaz permite usar una versión en memoria en las pruebas. */
export interface Store {
  listFlows(): Promise<Flow[]>;
  saveFlow(flow: Flow): Promise<void>;
  deleteFlow(id: string): Promise<void>;
  /** Envíos a Instagram (acciones terminadas o en curso) desde una fecha. Para el límite por hora. */
  countSendsSince(since: Date): Promise<number>;
  /** Contactos: alta o actualización (username, última vez visto y, si viene de un comentario, el reel). */
  touchContact(igId: string, username: string | null, mediaId?: string | null): Promise<void>;
  /** Comentarios registrados desde una fecha que NO recibieron respuesta privada (para rescatarlos). */
  unansweredCommentEvents(since: Date): Promise<unknown[]>;
  /** Guarda cada comentario (de qué reel viene cada persona). Repetidos se ignoran. */
  recordComment(comment: CommentRecord): Promise<void>;
  /** Resumen por reel: comentarios, personas distintas y personas con cada etiqueta. */
  reelStats(): Promise<ReelStatsRow[]>;
  addContactTags(igId: string, tags: readonly string[]): Promise<void>;
  listContacts(limit: number): Promise<ContactRow[]>;
  /** Pausas programadas. Devuelve null si ya existía (misma clave). */
  scheduleJob(dedupKey: string, runAt: Date, payload: unknown): Promise<number | null>;
  pendingJobs(): Promise<JobRow[]>;
  /** Marca la tarea como en marcha. Devuelve false si otro ya la cogió. */
  claimJob(id: number): Promise<boolean>;
  finishJob(id: number, status: 'done' | 'failed', result: unknown): Promise<void>;
  recordRequest(signatureOk: boolean, payload: unknown): Promise<void>;
  logEvent(kind: string, note: string, data: unknown): Promise<void>;
  /** Reserva una acción. Devuelve false si ya existía (evita enviar dos veces lo mismo). */
  claimAction(dedupKey: string, type: string, request: unknown): Promise<boolean>;
  finishAction(dedupKey: string, ok: boolean, response: unknown): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  allowSender(igId: string): Promise<void>;
  listAllowedSenders(): Promise<string[]>;
  recentEvents(limit: number): Promise<EventRow[]>;
  recentActions(limit: number): Promise<ActionRow[]>;
}

export interface EventRow {
  readonly createdAt: Date;
  readonly kind: string;
  readonly note: string;
  readonly data: unknown;
}

export interface ActionRow {
  readonly createdAt: Date;
  readonly type: string;
  readonly dedupKey: string;
  readonly ok: boolean | null;
  readonly response: unknown;
}

export interface ContactRow {
  readonly igId: string;
  readonly username: string | null;
  readonly tags: readonly string[];
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  /** Reel del primer comentario (de dónde vino) y del último. */
  readonly sourceMediaId: string | null;
  readonly lastMediaId: string | null;
}

export interface CommentRecord {
  readonly commentId: string;
  readonly igId: string;
  readonly username: string | null;
  readonly mediaId: string | null;
  readonly text: string;
}

export interface ReelStatsRow {
  readonly mediaId: string;
  readonly comments: number;
  readonly people: number;
  /** Personas que vinieron de este reel (origen) y tienen cada etiqueta. */
  readonly tagged: Readonly<Record<string, number>>;
}

export interface JobRow {
  readonly id: number;
  readonly runAt: Date;
  readonly payload: unknown;
}

export const SETTINGS = {
  testMediaId: 'test_media_id',
  dmRepliesEnabled: 'dm_replies_enabled',
  /** Fecha ISO hasta la que los envíos están pausados (p. ej. tras un error 368 de Meta). */
  pausedUntil: 'paused_until',
  pauseReason: 'pause_reason',
  /** Token de Instagram cifrado y su información de renovación. */
  igToken: 'ig_token_encrypted',
  igTokenRefreshedAt: 'ig_token_refreshed_at',
  igTokenExpiresAt: 'ig_token_expires_at',
  igTokenLastError: 'ig_token_last_error',
} as const;

/** Tipos de acción que cuentan como envío a Instagram (para el límite por hora). */
export const SEND_ACTION_TYPES = ['reply_comment', 'private_reply', 'send_message', 'send_dm'] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS webhook_requests (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_ok BOOLEAN NOT NULL,
  payload JSONB
);
CREATE TABLE IF NOT EXISTS event_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  data JSONB
);
CREATE TABLE IF NOT EXISTS actions (
  id BIGSERIAL PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  request JSONB,
  response JSONB
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS allowed_senders (
  ig_id TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actions_created_at_idx ON actions (created_at);
CREATE TABLE IF NOT EXISTS contacts (
  ig_id TEXT PRIMARY KEY,
  username TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_media_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_media_id TEXT;
CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  ig_id TEXT NOT NULL,
  username TEXT,
  media_id TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_media_idx ON comments (media_id);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id BIGSERIAL PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  run_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_jobs_pending_idx ON scheduled_jobs (status, run_at);
`;

type Sql = ReturnType<typeof postgres>;

/** Pasa el valor por JSON para guardarlo siempre como JSON válido (sin undefined ni tipos raros). */
function toJson(sql: Sql, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value ?? null)));
}

export interface StoreOptions {
  /** En producción SIEMPRE con SSL. Solo las pruebas locales (PGlite) lo desactivan. */
  readonly ssl?: boolean;
  readonly maxConnections?: number;
}

export async function createPostgresStore(
  databaseUrl: string,
  options: StoreOptions = {},
): Promise<Store & { close(): Promise<void> }> {
  const sql = postgres(databaseUrl, {
    ssl: options.ssl === false ? false : 'require',
    max: options.maxConnections ?? 5,
    onnotice: () => undefined,
  });
  await sql.unsafe(SCHEMA);

  return {
    async listFlows() {
      const rows = await sql<{ data: Flow }[]>`SELECT data FROM flows ORDER BY updated_at DESC`;
      return rows.map((row) => row.data);
    },
    async saveFlow(flow) {
      await sql`
        INSERT INTO flows (id, data, updated_at) VALUES (${flow.id}, ${toJson(sql, flow)}, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    },
    async deleteFlow(id) {
      await sql`DELETE FROM flows WHERE id = ${id}`;
    },
    async countSendsSince(since) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM actions
        WHERE created_at >= ${since} AND type IN ${sql([...SEND_ACTION_TYPES])} AND ok IS DISTINCT FROM false`;
      return rows[0]?.n ?? 0;
    },
    async touchContact(igId, username, mediaId = null) {
      await sql`
        INSERT INTO contacts (ig_id, username, source_media_id, last_media_id) VALUES (${igId}, ${username}, ${mediaId}, ${mediaId})
        ON CONFLICT (ig_id) DO UPDATE SET
          username = COALESCE(EXCLUDED.username, contacts.username),
          source_media_id = COALESCE(contacts.source_media_id, EXCLUDED.source_media_id),
          last_media_id = COALESCE(EXCLUDED.last_media_id, contacts.last_media_id),
          last_seen = now()`;
    },
    async unansweredCommentEvents(since) {
      const rows = await sql<{ data: unknown }[]>`
        SELECT e.data FROM event_log e
        WHERE e.kind = 'comment' AND e.created_at >= ${since}
          AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.dedup_key = 'private:' || (e.data->>'commentId'))
        ORDER BY e.id`;
      return rows.map((row) => row.data);
    },
    async recordComment(comment) {
      await sql`
        INSERT INTO comments (comment_id, ig_id, username, media_id, text)
        VALUES (${comment.commentId}, ${comment.igId}, ${comment.username}, ${comment.mediaId}, ${comment.text})
        ON CONFLICT (comment_id) DO NOTHING`;
    },
    async reelStats() {
      const counts = await sql<{ media_id: string; comments: number; people: number }[]>`
        SELECT media_id, count(*)::int AS comments, count(DISTINCT ig_id)::int AS people
        FROM comments WHERE media_id IS NOT NULL GROUP BY media_id ORDER BY comments DESC`;
      const tags = await sql<{ media_id: string; tag: string; n: number }[]>`
        SELECT source_media_id AS media_id, tag, count(*)::int AS n
        FROM contacts, unnest(tags) AS tag WHERE source_media_id IS NOT NULL GROUP BY source_media_id, tag`;
      return counts.map((row) => ({
        mediaId: row.media_id,
        comments: row.comments,
        people: row.people,
        tagged: Object.fromEntries(tags.filter((t) => t.media_id === row.media_id).map((t) => [t.tag, t.n])),
      }));
    },
    async addContactTags(igId, tags) {
      if (tags.length === 0) return;
      await sql`
        INSERT INTO contacts (ig_id, tags) VALUES (${igId}, ${sql.array([...tags])})
        ON CONFLICT (ig_id) DO UPDATE SET
          tags = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags) ORDER BY 1),
          last_seen = now()`;
    },
    async listContacts(limit) {
      const rows = await sql<
        { ig_id: string; username: string | null; tags: string[]; first_seen: Date; last_seen: Date; source_media_id: string | null; last_media_id: string | null }[]
      >`SELECT ig_id, username, tags, first_seen, last_seen, source_media_id, last_media_id FROM contacts ORDER BY last_seen DESC LIMIT ${limit}`;
      return rows.map((row) => ({
        igId: row.ig_id,
        username: row.username,
        tags: row.tags,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        sourceMediaId: row.source_media_id,
        lastMediaId: row.last_media_id,
      }));
    },
    async scheduleJob(dedupKey, runAt, payload) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO scheduled_jobs (dedup_key, run_at, payload) VALUES (${dedupKey}, ${runAt}, ${toJson(sql, payload)})
        ON CONFLICT (dedup_key) DO NOTHING RETURNING id`;
      return rows[0] ? Number(rows[0].id) : null;
    },
    async pendingJobs() {
      const rows = await sql<{ id: string; run_at: Date; payload: unknown }[]>`
        SELECT id, run_at, payload FROM scheduled_jobs WHERE status = 'pending' ORDER BY run_at`;
      return rows.map((row) => ({ id: Number(row.id), runAt: row.run_at, payload: row.payload }));
    },
    async claimJob(id) {
      const rows = await sql`UPDATE scheduled_jobs SET status = 'running' WHERE id = ${id} AND status = 'pending' RETURNING id`;
      return rows.length > 0;
    },
    async finishJob(id, status, result) {
      await sql`UPDATE scheduled_jobs SET status = ${status}, result = ${toJson(sql, result)} WHERE id = ${id}`;
    },
    async recordRequest(signatureOk, payload) {
      await sql`INSERT INTO webhook_requests (signature_ok, payload) VALUES (${signatureOk}, ${toJson(sql, payload)})`;
    },
    async logEvent(kind, note, data) {
      await sql`INSERT INTO event_log (kind, note, data) VALUES (${kind}, ${note}, ${toJson(sql, data)})`;
    },
    async claimAction(dedupKey, type, request) {
      const rows = await sql`
        INSERT INTO actions (dedup_key, type, request) VALUES (${dedupKey}, ${type}, ${toJson(sql, request)})
        ON CONFLICT (dedup_key) DO NOTHING RETURNING id`;
      return rows.length > 0;
    },
    async finishAction(dedupKey, ok, response) {
      await sql`
        UPDATE actions SET ok = ${ok}, response = ${toJson(sql, response)}, finished_at = now()
        WHERE dedup_key = ${dedupKey}`;
    },
    async getSetting(key) {
      const rows = await sql<{ value: string | null }[]>`SELECT value FROM settings WHERE key = ${key}`;
      return rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    },
    async allowSender(igId) {
      await sql`INSERT INTO allowed_senders (ig_id) VALUES (${igId}) ON CONFLICT (ig_id) DO NOTHING`;
    },
    async listAllowedSenders() {
      const rows = await sql<{ ig_id: string }[]>`SELECT ig_id FROM allowed_senders ORDER BY added_at`;
      return rows.map((row) => row.ig_id);
    },
    async recentEvents(limit) {
      const rows = await sql<{ created_at: Date; kind: string; note: string; data: unknown }[]>`
        SELECT created_at, kind, note, data FROM event_log ORDER BY id DESC LIMIT ${limit}`;
      return rows.map((row) => ({ createdAt: row.created_at, kind: row.kind, note: row.note, data: row.data }));
    },
    async recentActions(limit) {
      const rows = await sql<{ created_at: Date; type: string; dedup_key: string; ok: boolean | null; response: unknown }[]>`
        SELECT created_at, type, dedup_key, ok, response FROM actions ORDER BY id DESC LIMIT ${limit}`;
      return rows.map((row) => ({
        createdAt: row.created_at,
        type: row.type,
        dedupKey: row.dedup_key,
        ok: row.ok,
        response: row.response,
      }));
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
