import postgres from 'postgres';
import { flowSchema, type Flow } from './flows/types.js';
import type { FunnelPersonRow } from './funnel.js';

/** Todo lo que el servidor guarda o lee. La interfaz permite usar una versión en memoria en las pruebas. */
export interface Store {
  listFlows(): Promise<Flow[]>;
  saveFlow(flow: Flow): Promise<void>;
  deleteFlow(id: string): Promise<void>;
  /** Envíos a Instagram (terminados bien o en curso) desde una fecha, de los tipos indicados. Para los límites por hora. */
  countSendsSince(since: Date, types?: readonly string[]): Promise<number>;
  /** Estado de una acción (null si no existe). */
  getAction(dedupKey: string): Promise<{ readonly ok: boolean | null; readonly request: unknown; readonly response: unknown } | null>;
  /** Acciones reservadas que nunca terminaron (p. ej. por un reinicio). Para retomarlas al arrancar. */
  pendingActions(): Promise<unknown[]>;
  /** Contactos: alta o actualización (username, última vez visto y, si viene de un comentario, el reel). */
  touchContact(igId: string, username: string | null, mediaId?: string | null): Promise<void>;
  /** Conversaciones (Fase 3). */
  addMessage(message: NewMessage): Promise<void>;
  setMessageStatus(dedupKey: string, status: MessageStatus, mid?: string | null): Promise<void>;
  listMessages(igId: string, limit: number): Promise<MessageRow[]>;
  listConversations(limit: number): Promise<ConversationRow[]>;
  getContact(igId: string): Promise<ContactRow | null>;
  setAiPaused(igId: string, paused: boolean, reason: string | null): Promise<void>;
  /** Guarda la ficha y, si cambió respecto a la última, la apunta en el historial (Fase 4). */
  saveLead(igId: string, lead: unknown): Promise<void>;
  /** Historial de la ficha de una persona: las `limit` más recientes, de la más antigua a la más nueva. */
  listLeadHistory(igId: string, limit: number): Promise<LeadHistoryRow[]>;
  /** Setter IA: conversaciones en cada etapa (siguiente paso) y cambios de etapa según el historial. */
  setterStageStats(): Promise<SetterStageStats>;
  /** Último DM a un comentario de esta persona que Meta rechazó desde `since` (plan B: rescate por DM). */
  failedPrivateReply(igId: string, since: Date): Promise<{ readonly dedupKey: string; readonly request: unknown; readonly createdAt: Date } | null>;
  /** Acción que produjo un mensaje enviado (por su message_id de Meta), para distinguir ecos propios de mensajes a mano. */
  findActionByMessageId(mid: string): Promise<{ readonly dedupKey: string; readonly request: unknown } | null>;
  /** Base de conocimiento del setter, con historial de versiones. */
  saveKnowledge(text: string): Promise<number>;
  getKnowledge(): Promise<KnowledgeRow | null>;
  listKnowledgeVersions(limit: number): Promise<KnowledgeRow[]>;
  /** Comentarios registrados desde una fecha que NO recibieron respuesta privada (para rescatarlos). */
  unansweredCommentEvents(since: Date): Promise<unknown[]>;
  /** Guarda cada comentario (de qué reel viene cada persona). Repetidos se ignoran. */
  recordComment(comment: CommentRecord): Promise<void>;
  /** Resumen por reel: comentarios, personas distintas y personas con cada etiqueta. */
  reelStats(): Promise<ReelStatsRow[]>;
  /** Embudo (Fase 4): por persona y reel en que comentó desde `since`, qué pasos cumplió. */
  funnelRows(since: Date): Promise<FunnelPersonRow[]>;
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
  /** Setter IA parado en esta conversación (p. ej. porque Jose escribió a mano) y por qué. */
  readonly aiPaused?: boolean;
  readonly aiPausedReason?: string | null;
  /** Ficha del lead extraída por la IA. */
  readonly lead?: unknown;
}

export type MessageDirection = 'in' | 'out';
export type MessageSource = 'user' | 'flow' | 'ai' | 'human';
/** sent = enviado · queued = en cola · held = retenido para revisión de Jose (no enviado). */
export type MessageStatus = 'sent' | 'queued' | 'held' | 'failed';

export interface NewMessage {
  readonly igId: string;
  readonly direction: MessageDirection;
  readonly source: MessageSource;
  readonly text: string;
  readonly mid: string | null;
  readonly status: MessageStatus;
  readonly dedupKey: string | null;
  readonly note?: string | null;
}

export interface MessageRow extends NewMessage {
  readonly id: number;
  readonly createdAt: Date;
}

export interface ConversationRow {
  readonly igId: string;
  readonly username: string | null;
  readonly lastText: string;
  readonly lastAt: Date;
  readonly lastDirection: MessageDirection;
  readonly aiPaused: boolean;
  readonly lead: unknown;
}

export interface LeadHistoryRow {
  readonly lead: unknown;
  readonly createdAt: Date;
}

export interface SetterStageStats {
  readonly stages: readonly { readonly step: string; readonly n: number }[];
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly n: number }[];
}

export interface KnowledgeRow {
  readonly id: number;
  readonly text: string;
  readonly createdAt: Date;
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
  /** Setter IA: 'off' (apagado, por defecto) · 'test' (solo usuarios de prueba) · 'live' (todo el mundo). */
  setterMode: 'setter_mode',
  /** 'true' = la IA escribe pero no envía: todo queda retenido para que Jose lo apruebe. */
  setterDraft: 'setter_draft',
  /** Usernames de Instagram autorizados en modo prueba, separados por comas. */
  setterTestUsernames: 'setter_test_usernames',
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
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_paused_reason TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead JSONB;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_updated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  ig_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  mid TEXT UNIQUE,
  status TEXT NOT NULL,
  dedup_key TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages (ig_id, id);
CREATE INDEX IF NOT EXISTS messages_dedup_idx ON messages (dedup_key);
CREATE TABLE IF NOT EXISTS knowledge_versions (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
CREATE TABLE IF NOT EXISTS lead_history (
  id BIGSERIAL PRIMARY KEY,
  ig_id TEXT NOT NULL,
  lead JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_history_contact_idx ON lead_history (ig_id, id);
-- Fichas guardadas antes de existir el historial: su estado actual es el primer punto (una sola vez).
INSERT INTO lead_history (ig_id, lead, created_at)
SELECT c.ig_id, c.lead, coalesce(c.lead_updated_at, now()) FROM contacts c
WHERE c.lead IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lead_history h WHERE h.ig_id = c.ig_id);
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
      // Se pasan por el esquema para rellenar los campos nuevos con su valor por defecto (flujos guardados antes).
      // Si uno antiguo no pasara la validación, se devuelve tal cual (como antes) para no dejar de atender comentarios.
      return rows.map((row) => {
        const parsed = flowSchema.safeParse(row.data);
        return parsed.success ? parsed.data : row.data;
      });
    },
    async saveFlow(flow) {
      await sql`
        INSERT INTO flows (id, data, updated_at) VALUES (${flow.id}, ${toJson(sql, flow)}, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    },
    async deleteFlow(id) {
      await sql`DELETE FROM flows WHERE id = ${id}`;
    },
    async countSendsSince(since, types = SEND_ACTION_TYPES) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM actions
        WHERE created_at >= ${since} AND type IN ${sql([...types])} AND ok IS DISTINCT FROM false`;
      return rows[0]?.n ?? 0;
    },
    async getAction(dedupKey) {
      const rows = await sql<{ ok: boolean | null; request: unknown; response: unknown }[]>`SELECT ok, request, response FROM actions WHERE dedup_key = ${dedupKey}`;
      return rows[0] ?? null;
    },
    async pendingActions() {
      const rows = await sql<{ request: unknown }[]>`
        SELECT request FROM actions WHERE ok IS NULL AND type <> 'once' ORDER BY id`;
      return rows.map((row) => row.request);
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
    async addMessage(m) {
      await sql`
        INSERT INTO messages (ig_id, direction, source, text, mid, status, dedup_key, note)
        VALUES (${m.igId}, ${m.direction}, ${m.source}, ${m.text}, ${m.mid}, ${m.status}, ${m.dedupKey}, ${m.note ?? null})
        ON CONFLICT (mid) DO NOTHING`;
    },
    async setMessageStatus(dedupKey, status, mid = null) {
      await sql`UPDATE messages SET status = ${status}, mid = COALESCE(${mid}, mid) WHERE dedup_key = ${dedupKey}`;
    },
    async listMessages(igId, limit) {
      const rows = await sql<
        { id: string; ig_id: string; direction: MessageDirection; source: MessageSource; text: string; mid: string | null; status: MessageStatus; dedup_key: string | null; note: string | null; created_at: Date }[]
      >`SELECT * FROM (SELECT * FROM messages WHERE ig_id = ${igId} ORDER BY id DESC LIMIT ${limit}) m ORDER BY id`;
      return rows.map((r) => ({
        id: Number(r.id),
        igId: r.ig_id,
        direction: r.direction,
        source: r.source,
        text: r.text,
        mid: r.mid,
        status: r.status,
        dedupKey: r.dedup_key,
        note: r.note,
        createdAt: r.created_at,
      }));
    },
    async listConversations(limit) {
      const rows = await sql<
        { ig_id: string; username: string | null; text: string; created_at: Date; direction: MessageDirection; ai_paused: boolean | null; lead: unknown }[]
      >`SELECT DISTINCT ON (m.ig_id) m.ig_id, c.username, m.text, m.created_at, m.direction, c.ai_paused, c.lead
        FROM messages m LEFT JOIN contacts c ON c.ig_id = m.ig_id
        ORDER BY m.ig_id, m.id DESC`;
      return rows
        .map((r) => ({ igId: r.ig_id, username: r.username, lastText: r.text, lastAt: r.created_at, lastDirection: r.direction, aiPaused: r.ai_paused ?? false, lead: r.lead }))
        .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
        .slice(0, limit);
    },
    async getContact(igId) {
      const rows = await sql<
        { ig_id: string; username: string | null; tags: string[]; first_seen: Date; last_seen: Date; source_media_id: string | null; last_media_id: string | null; ai_paused: boolean; ai_paused_reason: string | null; lead: unknown }[]
      >`SELECT * FROM contacts WHERE ig_id = ${igId}`;
      const r = rows[0];
      return r
        ? {
            igId: r.ig_id,
            username: r.username,
            tags: r.tags,
            firstSeen: r.first_seen,
            lastSeen: r.last_seen,
            sourceMediaId: r.source_media_id,
            lastMediaId: r.last_media_id,
            aiPaused: r.ai_paused,
            aiPausedReason: r.ai_paused_reason,
            lead: r.lead,
          }
        : null;
    },
    async setAiPaused(igId, paused, reason) {
      await sql`
        INSERT INTO contacts (ig_id, ai_paused, ai_paused_reason) VALUES (${igId}, ${paused}, ${reason})
        ON CONFLICT (ig_id) DO UPDATE SET ai_paused = EXCLUDED.ai_paused, ai_paused_reason = EXCLUDED.ai_paused_reason`;
    },
    async saveLead(igId, lead) {
      const json = toJson(sql, lead);
      await sql`
        INSERT INTO contacts (ig_id, lead, lead_updated_at) VALUES (${igId}, ${json}, now())
        ON CONFLICT (ig_id) DO UPDATE SET lead = EXCLUDED.lead, lead_updated_at = now()`;
      // Solo si cambió (las respuestas de una misma persona van en fila, así que no se cruzan).
      await sql`
        INSERT INTO lead_history (ig_id, lead)
        SELECT ${igId}, ${json}
        WHERE (SELECT h.lead FROM lead_history h WHERE h.ig_id = ${igId} ORDER BY h.id DESC LIMIT 1) IS DISTINCT FROM ${json}::jsonb`;
    },
    async listLeadHistory(igId, limit) {
      const rows = await sql<{ lead: unknown; created_at: Date }[]>`
        SELECT lead, created_at FROM (
          SELECT id, lead, created_at FROM lead_history WHERE ig_id = ${igId} ORDER BY id DESC LIMIT ${limit}
        ) h ORDER BY id`;
      return rows.map((row) => ({ lead: row.lead, createdAt: row.created_at }));
    },
    async setterStageStats() {
      const stages = await sql<{ step: string; n: number }[]>`
        SELECT lead->>'siguiente_paso' AS step, count(*)::int AS n FROM contacts
        WHERE lead->>'siguiente_paso' IS NOT NULL GROUP BY 1 ORDER BY n DESC, step`;
      const transitions = await sql<{ from: string; to: string; n: number }[]>`
        WITH h AS (
          SELECT lead->>'siguiente_paso' AS step, lag(lead->>'siguiente_paso') OVER (PARTITION BY ig_id ORDER BY id) AS prev
          FROM lead_history
        )
        SELECT prev AS "from", step AS "to", count(*)::int AS n FROM h
        WHERE prev IS NOT NULL AND step IS NOT NULL AND prev <> step GROUP BY 1, 2 ORDER BY n DESC, 1, 2`;
      return { stages: [...stages], transitions: [...transitions] };
    },
    async failedPrivateReply(igId, since) {
      const rows = await sql<{ dedup_key: string; request: unknown; created_at: Date }[]>`
        SELECT dedup_key, request, created_at FROM actions
        WHERE type = 'private_reply' AND ok = false AND created_at >= ${since}
          AND request->'message'->>'recipientId' = ${igId}
        ORDER BY id DESC LIMIT 1`;
      return rows[0] ? { dedupKey: rows[0].dedup_key, request: rows[0].request, createdAt: rows[0].created_at } : null;
    },
    async findActionByMessageId(mid) {
      const rows = await sql<{ dedup_key: string; request: unknown }[]>`
        SELECT dedup_key, request FROM actions WHERE response->>'messageId' = ${mid}
           OR response->'result'->>'messageId' = ${mid} LIMIT 1`;
      return rows[0] ? { dedupKey: rows[0].dedup_key, request: rows[0].request } : null;
    },
    async saveKnowledge(text) {
      const rows = await sql<{ id: string }[]>`INSERT INTO knowledge_versions (text) VALUES (${text}) RETURNING id`;
      return Number(rows[0]?.id);
    },
    async getKnowledge() {
      const rows = await sql<{ id: string; text: string; created_at: Date }[]>`SELECT id, text, created_at FROM knowledge_versions ORDER BY id DESC LIMIT 1`;
      return rows[0] ? { id: Number(rows[0].id), text: rows[0].text, createdAt: rows[0].created_at } : null;
    },
    async listKnowledgeVersions(limit) {
      const rows = await sql<{ id: string; text: string; created_at: Date }[]>`SELECT id, text, created_at FROM knowledge_versions ORDER BY id DESC LIMIT ${limit}`;
      return rows.map((r) => ({ id: Number(r.id), text: r.text, createdAt: r.created_at }));
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
    async funnelRows(since) {
      // Cada paso se resume primero por comentario o por persona (una pasada por tabla) y luego se une.
      const rows = await sql<
        {
          media_id: string;
          ig_id: string;
          first_at: Date;
          dm_ok: boolean;
          dm_failed: boolean;
          plan_b: boolean;
          rescued: boolean;
          asked: boolean;
          follows: boolean;
          clicked: boolean;
          wrote: boolean;
          qualified: boolean;
        }[]
      >`
        WITH dm AS (
          SELECT request->>'commentId' AS comment_id, bool_or(ok IS TRUE) AS ok, bool_or(ok IS FALSE) AS failed
          FROM actions WHERE type = 'private_reply' GROUP BY 1
        ),
        plan_b AS (
          SELECT DISTINCT substr(dedup_key, length('reply-fail:') + 1) AS comment_id
          FROM actions WHERE type = 'reply_comment' AND ok IS TRUE AND dedup_key LIKE 'reply-fail:%'
        ),
        per_reel AS (
          SELECT c.media_id, c.ig_id, min(c.created_at) AS first_at,
                 coalesce(bool_or(dm.ok), false) AS dm_ok, coalesce(bool_or(dm.failed), false) AS dm_failed,
                 bool_or(p.comment_id IS NOT NULL) AS plan_b
          FROM comments c
          LEFT JOIN dm ON dm.comment_id = c.comment_id
          LEFT JOIN plan_b p ON p.comment_id = c.comment_id
          WHERE c.media_id IS NOT NULL AND c.created_at >= ${since}
          GROUP BY c.media_id, c.ig_id
        ),
        rescued AS (
          SELECT DISTINCT request->>'recipientId' AS ig_id
          FROM actions WHERE type = 'send_message' AND ok IS TRUE AND dedup_key LIKE 'rescate-dm:%'
        ),
        asked AS (
          SELECT request->>'recipientId' AS ig_id, bool_or(response->>'follow' = 'yes') AS follows
          FROM actions WHERE type = 'check_follow' GROUP BY 1
        ),
        clicked AS (SELECT DISTINCT data->>'r' AS ig_id FROM event_log WHERE kind = 'click'),
        wrote AS (SELECT DISTINCT ig_id FROM messages WHERE direction = 'in')
        SELECT r.media_id, r.ig_id, r.first_at, r.dm_ok, r.dm_failed, r.plan_b,
               (rs.ig_id IS NOT NULL) AS rescued, (a.ig_id IS NOT NULL) AS asked, coalesce(a.follows, false) AS follows,
               (k.ig_id IS NOT NULL) AS clicked, (w.ig_id IS NOT NULL) AS wrote,
               coalesce(ct.lead->>'siguiente_paso' = 'agendar_llamada', false) AS qualified
        FROM per_reel r
        LEFT JOIN rescued rs ON rs.ig_id = r.ig_id
        LEFT JOIN asked a ON a.ig_id = r.ig_id
        LEFT JOIN clicked k ON k.ig_id = r.ig_id
        LEFT JOIN wrote w ON w.ig_id = r.ig_id
        LEFT JOIN contacts ct ON ct.ig_id = r.ig_id`;
      return rows.map((row) => ({
        mediaId: row.media_id,
        igId: row.ig_id,
        firstAt: row.first_at,
        dmOk: row.dm_ok,
        dmFailed: row.dm_failed,
        planB: row.plan_b,
        rescued: row.rescued,
        asked: row.asked,
        follows: row.follows,
        clicked: row.clicked,
        wrote: row.wrote,
        qualified: row.qualified,
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
