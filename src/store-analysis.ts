import type postgres from 'postgres';
import type { AnalysisMessageRow } from './intelligence/input.js';
import { scrubPerson, type VerifiedAnalysis } from './intelligence/verify.js';
import type { MessageDirection, MessageSource } from './store.js';
import { toJson, type Sql } from './store-sql.js';

/**
 * Inteligencia (Fase 6.6): análisis guardados y los mensajes que se analizan. Archivo aparte para que store.ts no
 * pase de 800 líneas; los métodos se mezclan en createPostgresStore igual que los de contactos.
 */

export const ANALYSIS_SCHEMA = `
CREATE TABLE IF NOT EXISTS analysis_runs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  period TEXT NOT NULL,
  conversations INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd DOUBLE PRECISION NOT NULL,
  result JSONB NOT NULL
);
`;

export interface NewAnalysisRun {
  readonly createdBy: string;
  /** '7', '30' o 'all'. */
  readonly period: string;
  readonly conversations: number;
  readonly skipped: number;
  readonly chars: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly result: VerifiedAnalysis;
}

export interface AnalysisRunSummary {
  readonly id: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly period: string;
  readonly conversations: number;
  readonly costUsd: number;
  /** Hallazgos en total (todas las secciones). */
  readonly findings: number;
}

export interface AnalysisRun extends AnalysisRunSummary, Omit<NewAnalysisRun, 'createdBy' | 'period' | 'conversations' | 'costUsd'> {}

/** Tope de mensajes leídos para un análisis (de sobra: hoy hay ~55 mensajes de personas). */
const MAX_ANALYSIS_MESSAGES = 20_000;

type RunDbRow = {
  id: string;
  created_at: Date;
  created_by: string;
  period: string;
  conversations: number;
  skipped: number;
  chars: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  result: VerifiedAnalysis;
};

const countFindings = (result: VerifiedAnalysis): number => Object.values(result.sections).reduce((total, items) => total + items.length, 0);

const toSummary = (r: RunDbRow): AnalysisRunSummary => ({
  id: Number(r.id),
  createdAt: r.created_at,
  createdBy: r.created_by,
  period: r.period,
  conversations: r.conversations,
  costUsd: r.cost_usd,
  findings: countFindings(r.result),
});

/** BORRAR: quita a esa persona de todos los análisis guardados (dentro de la transacción del borrado). */
export async function scrubAnalyses(tx: postgres.TransactionSql, igId: string): Promise<number> {
  const runs = await tx<{ id: string; result: VerifiedAnalysis }[]>`SELECT id, result FROM analysis_runs WHERE result::text LIKE ${`%"${igId}"%`}`;
  for (const run of runs) {
    const clean = JSON.parse(JSON.stringify(scrubPerson(run.result, igId)));
    await tx`UPDATE analysis_runs SET result = ${tx.json(clean)} WHERE id = ${run.id}`;
  }
  return runs.length;
}

export function analysisMethods(sql: Sql) {
  return {
    /** Mensajes ENVIADOS desde una fecha (los borradores retenidos o fallidos no los vio la persona). */
    async analysisMessages(since: Date): Promise<AnalysisMessageRow[]> {
      const rows = await sql<{ ig_id: string; username: string | null; direction: MessageDirection; source: MessageSource; text: string; created_at: Date }[]>`
        SELECT m.ig_id, c.username, m.direction, m.source, m.text, m.created_at
        FROM messages m LEFT JOIN contacts c ON c.ig_id = m.ig_id
        WHERE m.created_at >= ${since} AND m.status = 'sent'
        ORDER BY m.ig_id, m.id LIMIT ${MAX_ANALYSIS_MESSAGES}`;
      return rows.map((r) => ({ igId: r.ig_id, username: r.username, direction: r.direction, source: r.source, text: r.text, createdAt: r.created_at }));
    },
    async saveAnalysisRun(run: NewAnalysisRun): Promise<number> {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO analysis_runs (created_by, period, conversations, skipped, chars, model, input_tokens, output_tokens, cost_usd, result)
        VALUES (${run.createdBy}, ${run.period}, ${run.conversations}, ${run.skipped}, ${run.chars}, ${run.model}, ${run.inputTokens}, ${run.outputTokens},
          ${run.costUsd}, ${toJson(sql, run.result)})
        RETURNING id`;
      return Number(row?.id);
    },
    async listAnalysisRuns(limit: number): Promise<AnalysisRunSummary[]> {
      const rows = await sql<RunDbRow[]>`SELECT * FROM analysis_runs ORDER BY id DESC LIMIT ${limit}`;
      return rows.map(toSummary);
    },
    async getAnalysisRun(id: number): Promise<AnalysisRun | null> {
      const [r] = await sql<RunDbRow[]>`SELECT * FROM analysis_runs WHERE id = ${id}`;
      if (!r) return null;
      return { ...toSummary(r), skipped: r.skipped, chars: r.chars, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, result: r.result };
    },
  };
}
