import type { CommentRecord, CommentRow, ContactRow, ReelStatsRow } from './store.js';
import { toJson, type Sql } from './store-sql.js';

/**
 * Contactos y comentarios del almacén de Postgres. Salió de store.ts (que rozaba el máximo de 800 líneas) al empezar
 * la Fase 6.3; los métodos son los mismos y se mezclan en el objeto de createPostgresStore.
 */

type ContactDbRow = {
  ig_id: string;
  username: string | null;
  tags: string[];
  first_seen: Date;
  last_seen: Date;
  source_media_id: string | null;
  last_media_id: string | null;
  ai_paused: boolean;
  ai_paused_reason: string | null;
  lead: unknown;
  fields: Record<string, string> | null;
};

const toContact = (r: ContactDbRow): ContactRow => ({
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
  fields: r.fields ?? {},
});

export function contactMethods(sql: Sql) {
  return {
    async touchContact(igId: string, username: string | null, mediaId: string | null = null): Promise<void> {
      await sql`
        INSERT INTO contacts (ig_id, username, source_media_id, last_media_id) VALUES (${igId}, ${username}, ${mediaId}, ${mediaId})
        ON CONFLICT (ig_id) DO UPDATE SET
          username = COALESCE(EXCLUDED.username, contacts.username),
          source_media_id = COALESCE(contacts.source_media_id, EXCLUDED.source_media_id),
          last_media_id = COALESCE(EXCLUDED.last_media_id, contacts.last_media_id),
          last_seen = now()`;
    },
    async getContact(igId: string): Promise<ContactRow | null> {
      const rows = await sql<ContactDbRow[]>`SELECT * FROM contacts WHERE ig_id = ${igId}`;
      return rows[0] ? toContact(rows[0]) : null;
    },
    async setAiPaused(igId: string, paused: boolean, reason: string | null): Promise<void> {
      await sql`
        INSERT INTO contacts (ig_id, ai_paused, ai_paused_reason) VALUES (${igId}, ${paused}, ${reason})
        ON CONFLICT (ig_id) DO UPDATE SET ai_paused = EXCLUDED.ai_paused, ai_paused_reason = EXCLUDED.ai_paused_reason`;
    },
    async saveLead(igId: string, lead: unknown): Promise<void> {
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
    async recordComment(comment: CommentRecord): Promise<void> {
      await sql`
        INSERT INTO comments (comment_id, ig_id, username, media_id, text)
        VALUES (${comment.commentId}, ${comment.igId}, ${comment.username}, ${comment.mediaId}, ${comment.text})
        ON CONFLICT (comment_id) DO NOTHING`;
    },
    async listPersonComments(igId: string, limit: number): Promise<CommentRow[]> {
      const rows = await sql<{ comment_id: string; media_id: string | null; text: string; created_at: Date }[]>`
        SELECT comment_id, media_id, text, created_at FROM comments WHERE ig_id = ${igId} ORDER BY created_at DESC LIMIT ${limit}`;
      return rows.map((r) => ({ commentId: r.comment_id, mediaId: r.media_id, text: r.text, createdAt: r.created_at }));
    },
    async reelStats(): Promise<ReelStatsRow[]> {
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
    async addContactTags(igId: string, tags: readonly string[]): Promise<void> {
      if (tags.length === 0) return;
      await sql`
        INSERT INTO contacts (ig_id, tags) VALUES (${igId}, ${sql.array([...tags])})
        ON CONFLICT (ig_id) DO UPDATE SET
          tags = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags) ORDER BY 1),
          last_seen = now()`;
    },
    async removeContactTag(igId: string, tag: string): Promise<void> {
      await sql`UPDATE contacts SET tags = array_remove(tags, ${tag}) WHERE ig_id = ${igId}`;
    },
    async setContactField(igId: string, field: string, value: string): Promise<void> {
      if (value === '') {
        await sql`UPDATE contacts SET fields = fields - ${field} WHERE ig_id = ${igId}`;
        return;
      }
      const json = toJson(sql, { [field]: value });
      await sql`
        INSERT INTO contacts (ig_id, fields) VALUES (${igId}, ${json})
        ON CONFLICT (ig_id) DO UPDATE SET fields = contacts.fields || EXCLUDED.fields`;
    },
    /** Lo más reciente primero; incluye la ficha para poder filtrar por etapa. */
    async listContacts(limit: number): Promise<ContactRow[]> {
      const rows = await sql<ContactDbRow[]>`SELECT * FROM contacts ORDER BY last_seen DESC LIMIT ${limit}`;
      return rows.map(toContact);
    },
  };
}
