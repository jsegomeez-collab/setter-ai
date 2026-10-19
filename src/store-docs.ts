import type { Sql } from './store-sql.js';

/**
 * Documentos del setter (Fase 7.2): título, orden y si están activos. El texto y sus versiones van en
 * `knowledge_versions` con el tipo `doc:<slug>`. Archivo aparte para que store.ts no pase de 800 líneas.
 */

export const DOCS_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_docs (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  builtin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export interface KnowledgeDocRow {
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly active: boolean;
  /** De la lista base (no se puede borrar, solo desactivar). */
  readonly builtin: boolean;
}

export function docsMethods(sql: Sql) {
  return {
    async listKnowledgeDocs(): Promise<KnowledgeDocRow[]> {
      const rows = await sql<KnowledgeDocRow[]>`SELECT slug, title, position, active, builtin FROM knowledge_docs ORDER BY position, created_at`;
      return rows.map((r) => ({ slug: r.slug, title: r.title, position: r.position, active: r.active, builtin: r.builtin }));
    },
    async saveKnowledgeDoc(doc: KnowledgeDocRow): Promise<void> {
      await sql`
        INSERT INTO knowledge_docs (slug, title, position, active, builtin)
        VALUES (${doc.slug}, ${doc.title}, ${doc.position}, ${doc.active}, ${doc.builtin})
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position, active = EXCLUDED.active`;
    },
    /** Borra el documento y todas sus versiones. */
    async deleteKnowledgeDoc(slug: string): Promise<void> {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM knowledge_versions WHERE kind = ${`doc:${slug}`}`;
        await tx`DELETE FROM knowledge_docs WHERE slug = ${slug}`;
      });
    },
  };
}
