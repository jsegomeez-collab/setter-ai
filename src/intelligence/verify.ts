import { normalize } from '../flows/engine.js';
import type { AnalysisConversation } from './input.js';
import type { AnalysisOutput } from './schema.js';

/**
 * Nada inventado (Fase 6.6): una cita solo vale si aparece de verdad en lo que escribió la PERSONA en esa conversación
 * (sin mirar mayúsculas, tildes, signos ni espacios). Un hallazgo sin ninguna cita válida se descarta.
 */

export interface Evidence {
  readonly igId: string;
  readonly username: string | null;
  readonly quote: string;
}

export interface Finding {
  readonly title: string;
  readonly detail: string | null;
  /** Solo en ideas de reels. */
  readonly hook?: string;
  /** En cuántas conversaciones distintas aparece. */
  readonly count: number;
  readonly evidence: readonly Evidence[];
}

export interface VerifiedAnalysis {
  readonly summary: string;
  readonly sections: {
    readonly objeciones: readonly Finding[];
    readonly dolores: readonly Finding[];
    readonly lenguaje: readonly Finding[];
    readonly ideas: readonly Finding[];
    readonly mercado: readonly Finding[];
  };
  readonly dropped: { readonly findings: number; readonly quotes: number };
}

const MIN_QUOTE_CHARS = 3;
const comparable = (text: string): string =>
  normalize(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** BORRAR (derecho de supresión): quita a esa persona de un análisis guardado; los hallazgos sin citas se descartan. */
export function scrubPerson(analysis: VerifiedAnalysis, igId: string): VerifiedAnalysis {
  const clean = (items: readonly Finding[]): Finding[] =>
    items.flatMap((item) => {
      const evidence = item.evidence.filter((e) => e.igId !== igId);
      return evidence.length === 0 ? [] : [{ ...item, evidence, count: new Set(evidence.map((e) => e.igId)).size }];
    });
  const { sections } = analysis;
  return {
    ...analysis,
    sections: {
      objeciones: clean(sections.objeciones),
      dolores: clean(sections.dolores),
      lenguaje: clean(sections.lenguaje),
      ideas: clean(sections.ideas),
      mercado: clean(sections.mercado),
    },
  };
}

type RawFinding =AnalysisOutput['objeciones'][number] & { gancho?: string };

export function verifyFindings(output: AnalysisOutput, conversations: readonly AnalysisConversation[]): VerifiedAnalysis {
  const byCode = new Map(conversations.map((c) => [c.code, { ...c, comparable: comparable(c.personText) }]));
  const dropped = { findings: 0, quotes: 0 };

  const check = (items: readonly RawFinding[]): Finding[] =>
    items.flatMap((item) => {
      const evidence = item.evidencias.flatMap((e) => {
        const conversation = byCode.get(e.conversacion.trim().toUpperCase());
        const quote = comparable(e.cita);
        if (conversation && quote.length >= MIN_QUOTE_CHARS && conversation.comparable.includes(quote)) {
          return [{ igId: conversation.igId, username: conversation.username, quote: e.cita.trim() }];
        }
        dropped.quotes++;
        return [];
      });
      if (evidence.length === 0) {
        dropped.findings++;
        return [];
      }
      const count = new Set(evidence.map((e) => e.igId)).size;
      return [{ title: item.titulo.trim(), detail: item.detalle.trim() || null, ...(item.gancho ? { hook: item.gancho.trim() } : {}), count, evidence }];
    });

  const byCount = (items: Finding[]) => [...items].sort((a, b) => b.count - a.count);
  return {
    summary: output.resumen.trim(),
    sections: {
      objeciones: byCount(check(output.objeciones)),
      dolores: byCount(check(output.dolores)),
      lenguaje: byCount(check(output.lenguaje)),
      ideas: byCount(check(output.ideas_reels)),
      mercado: byCount(check(output.datos_mercado)),
    },
    dropped,
  };
}
