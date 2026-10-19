import { DRAFT_NOTE } from './setter/service.js';
import type { ConversationRow, MessageDirection } from './store.js';

/** Bandeja de conversaciones del frontend (Fase 6.2): cada fila con su etapa y sus marcas, y los filtros. */

export interface InboxItem {
  readonly igId: string;
  readonly username: string | null;
  readonly lastText: string;
  readonly lastAt: Date;
  readonly lastDirection: MessageDirection;
  readonly aiPaused: boolean;
  /** Siguiente paso de la ficha (seguir_calificando, agendar_llamada…); null si no hay ficha. */
  readonly stage: string | null;
  readonly level: string | null;
  /** Lo último lo escribió la persona. */
  readonly unanswered: boolean;
  readonly hasDraft: boolean;
}

function leadField(lead: unknown, key: string): string | null {
  const value = lead && typeof lead === 'object' ? (lead as Record<string, unknown>)[key] : null;
  return typeof value === 'string' ? value : null;
}

export function toInboxItem(row: ConversationRow): InboxItem {
  return {
    igId: row.igId,
    username: row.username,
    lastText: row.lastText,
    lastAt: row.lastAt,
    lastDirection: row.lastDirection,
    aiPaused: row.aiPaused,
    stage: leadField(row.lead, 'siguiente_paso'),
    level: leadField(row.lead, 'nivel'),
    unanswered: row.lastDirection === 'in',
    hasDraft: row.lastDirection === 'out' && row.lastStatus === 'held' && row.lastNote === DRAFT_NOTE,
  };
}

const FILTERS: Record<string, (item: InboxItem) => boolean> = {
  unanswered: (item) => item.unanswered,
  draft: (item) => item.hasDraft,
  paused: (item) => item.aiPaused,
};

/** `filter`: all · unanswered · draft · paused · stage:<siguiente_paso>. Uno desconocido = todos. `q` busca en usuario e id. */
export function filterInbox(items: readonly InboxItem[], filter: string, q: string): InboxItem[] {
  const stage = filter.startsWith('stage:') ? filter.slice('stage:'.length) : null;
  const byFilter = stage ? (item: InboxItem) => item.stage === stage : (FILTERS[filter] ?? (() => true));
  const query = q.trim().toLowerCase().replace(/^@/, '');
  return items.filter((item) => byFilter(item) && (!query || (item.username ?? '').toLowerCase().includes(query) || item.igId.includes(query)));
}
