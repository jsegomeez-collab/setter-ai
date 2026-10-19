import { isAffirmativeReply } from '../flows/text-reply.js';
import type { MessageDirection, MessageSource } from '../store.js';

/**
 * Qué se manda a la IA en el análisis (Fase 6.6). Decisión de Jose (2026-10-17): solo la parte de cualificación,
 * es decir, lo que escribe la persona y lo que le responde el setter (o Jose a mano). Fuera: los mensajes del flujo
 * y los "sí / dale / mándamelo" para pedir el recurso. Las conversaciones más recientes primero, hasta un tope.
 */

export interface AnalysisMessageRow {
  readonly igId: string;
  readonly username: string | null;
  readonly direction: MessageDirection;
  readonly source: MessageSource;
  readonly text: string;
  readonly createdAt: Date;
}

export interface AnalysisConversation {
  /** C1, C2…: así la nombra la IA (no ve los ids de Instagram). */
  readonly code: string;
  readonly igId: string;
  readonly username: string | null;
  /** Solo lo que escribió la persona: contra esto se comprueban las citas. */
  readonly personText: string;
  readonly lastAt: Date;
}

export interface AnalysisInput {
  readonly conversations: readonly AnalysisConversation[];
  readonly text: string;
  readonly chars: number;
  /** Conversaciones que no cupieron en el tope. */
  readonly skipped: number;
}

/** Hay alguna letra y no es un "sí" corto para pedir el recurso. */
const isRealText = (text: string): boolean => /\p{L}/u.test(text) && !isAffirmativeReply(text, '');

export function buildAnalysisInput(rows: readonly AnalysisMessageRow[], options: { maxChars: number }): AnalysisInput {
  const byPerson = new Map<string, AnalysisMessageRow[]>();
  for (const row of rows) byPerson.set(row.igId, [...(byPerson.get(row.igId) ?? []), row]);

  const candidates = [...byPerson.values()]
    .map((messages) => {
      const lines = messages.flatMap((m) => {
        if (m.direction === 'in' && m.source === 'user' && isRealText(m.text)) return [{ who: 'Persona', text: m.text.trim() }];
        if (m.direction === 'out' && (m.source === 'ai' || m.source === 'human')) return [{ who: 'Setter', text: m.text.trim() }];
        return [];
      });
      const first = messages[0] as AnalysisMessageRow;
      return { igId: first.igId, username: first.username, lines, lastAt: messages[messages.length - 1]?.createdAt ?? first.createdAt };
    })
    .filter((c) => c.lines.some((line) => line.who === 'Persona'))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());

  const conversations: AnalysisConversation[] = [];
  const blocks: string[] = [];
  let chars = 0;
  for (const c of candidates) {
    const code = `C${conversations.length + 1}`;
    const block = `### ${code} (@${c.username ?? 'sin_usuario'})\n${c.lines.map((line) => `${line.who}: ${line.text}`).join('\n')}\n`;
    if (chars + block.length > options.maxChars) break;
    chars += block.length;
    blocks.push(block);
    const personText = c.lines.filter((line) => line.who === 'Persona').map((line) => line.text).join('\n');
    conversations.push({ code, igId: c.igId, username: c.username, personText, lastAt: c.lastAt });
  }
  return { conversations, text: blocks.join('\n'), chars, skipped: candidates.length - conversations.length };
}

/** Sonnet 5.5 (precios oficiales 2026-10-17): 2 $ / millón de entrada, 10 $ / millón de salida. */
const SONNET_INPUT_PER_MILLION = 2;
const SONNET_OUTPUT_PER_MILLION = 10;
/** En español sale ~3,5-4 caracteres por token: se usa 3 para no quedarse corto. */
const CHARS_PER_TOKEN = 3;
const PROMPT_TOKENS = 1500;
const OUTPUT_TOKENS = 6000;

/** Coste estimado (por arriba) de analizar `chars` caracteres. 0 si no hay nada que analizar. */
export function estimateAnalysisCost(chars: number): number {
  if (chars <= 0) return 0;
  const input = Math.ceil(chars / CHARS_PER_TOKEN) + PROMPT_TOKENS;
  return (input * SONNET_INPUT_PER_MILLION + OUTPUT_TOKENS * SONNET_OUTPUT_PER_MILLION) / 1_000_000;
}
