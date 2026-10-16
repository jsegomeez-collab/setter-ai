import postgres from 'postgres';

/** Todo lo que el servidor guarda o lee. La interfaz permite usar una versión en memoria en las pruebas. */
export interface Store {
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

export const SETTINGS = {
  testMediaId: 'test_media_id',
  dmRepliesEnabled: 'dm_replies_enabled',
} as const;

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
`;

type Sql = ReturnType<typeof postgres>;

/** Pasa el valor por JSON para guardarlo siempre como JSON válido (sin undefined ni tipos raros). */
function toJson(sql: Sql, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value ?? null)));
}

export async function createPostgresStore(databaseUrl: string): Promise<Store & { close(): Promise<void> }> {
  const sql = postgres(databaseUrl, { ssl: 'require', max: 5, onnotice: () => undefined });
  await sql.unsafe(SCHEMA);

  return {
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
