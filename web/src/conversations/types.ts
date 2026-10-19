/** Lo que devuelve la API de Conversaciones (src/routes-api-conversations.ts). */

export interface InboxItem {
  readonly igId: string;
  readonly username: string | null;
  readonly lastText: string;
  readonly lastAt: string;
  readonly lastDirection: 'in' | 'out';
  readonly aiPaused: boolean;
  readonly stage: string | null;
  readonly level: string | null;
  readonly unanswered: boolean;
  readonly hasDraft: boolean;
}

export interface SendsBlock {
  readonly until: string;
  readonly reason: string | null;
}

export interface InboxResponse {
  readonly items: readonly InboxItem[];
  readonly sendsBlocked: SendsBlock | null;
}

export interface ThreadMessage {
  readonly id: number;
  readonly direction: 'in' | 'out';
  readonly source: 'user' | 'flow' | 'ai' | 'human';
  readonly text: string;
  readonly status: 'sent' | 'queued' | 'held' | 'failed' | 'discarded';
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ConversationDetail {
  readonly igId: string;
  readonly contact: {
    readonly username: string | null;
    readonly tags: readonly string[];
    readonly aiPaused: boolean;
    readonly aiPausedReason: string | null;
    readonly lead: Record<string, unknown> | null;
    readonly firstSeen: string | null;
  };
  readonly messages: readonly ThreadMessage[];
  readonly leadHistory: readonly { readonly lead: Record<string, unknown> | null; readonly createdAt: string }[];
  readonly canReply: { readonly ok: boolean; readonly reason: string | null };
}

/** Siguiente paso de la ficha → etiqueta corta. */
export const STAGE_LABEL: Record<string, string> = {
  seguir_calificando: 'Calificando',
  agendar_llamada: 'Agendar',
  ofrecer_membresia: 'Membresía',
  descartar: 'Descartado',
  derivar_a_jose: 'Pasar a Jose',
};

export const DRAFT_NOTE = 'Modo borrador: pendiente de aprobar';

export const timeAgo = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
};

export const handle = (username: string | null, igId: string): string => (username ? `@${username}` : `id ${igId}`);
