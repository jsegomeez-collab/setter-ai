/** El formato de un flujo, igual que en el servidor (src/flows/nodes.ts y types.ts). El servidor lo valida al guardar. */

export type Button =
  | { readonly type: 'url'; readonly title: string; readonly url: string; readonly tags: readonly string[] }
  | { readonly type: 'postback'; readonly title: string; readonly next: string };

export interface QuickReply {
  readonly title: string;
  readonly next: string;
}

export interface Card {
  readonly title: string;
  readonly subtitle?: string;
  readonly imageUrl?: string;
  readonly url?: string;
  readonly buttons: readonly Button[];
}

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export type ConditionRule =
  | { readonly kind: 'has_tag'; readonly tag: string }
  | { readonly kind: 'field'; readonly field: string; readonly op: 'equals' | 'contains' | 'set'; readonly value: string }
  | { readonly kind: 'keyword'; readonly keywords: readonly string[] }
  | { readonly kind: 'verified' }
  | { readonly kind: 'followers'; readonly min: number }
  | { readonly kind: 'hours'; readonly from: string; readonly to: string; readonly days: readonly number[]; readonly timeZone: string }
  | { readonly kind: 'random'; readonly percent: number };

export type FlowStep =
  | { readonly id: string; readonly type: 'message'; readonly text: string; readonly buttons: readonly Button[]; readonly quickReplies?: readonly QuickReply[]; readonly next?: string }
  | { readonly id: string; readonly type: 'carousel'; readonly cards: readonly Card[]; readonly next?: string }
  | { readonly id: string; readonly type: 'media'; readonly kind: MediaKind; readonly url: string; readonly next?: string }
  | { readonly id: string; readonly type: 'react'; readonly emoji: string; readonly next?: string }
  | { readonly id: string; readonly type: 'follow_gate'; readonly ifFollowing: string; readonly ifNotFollowing: string; readonly ifUnknown: string }
  | { readonly id: string; readonly type: 'delay'; readonly seconds: number; readonly next: string }
  | { readonly id: string; readonly type: 'setter_opener'; readonly texts: readonly string[] }
  | { readonly id: string; readonly type: 'tag'; readonly op: 'add' | 'remove'; readonly tag: string; readonly next?: string }
  | { readonly id: string; readonly type: 'field'; readonly field: string; readonly value: string; readonly next?: string }
  | { readonly id: string; readonly type: 'ai'; readonly paused: boolean; readonly next?: string }
  | { readonly id: string; readonly type: 'notify'; readonly text: string; readonly next?: string }
  | { readonly id: string; readonly type: 'goto'; readonly flowId: string }
  | { readonly id: string; readonly type: 'condition'; readonly rule: ConditionRule; readonly ifTrue: string; readonly ifFalse: string };

export type StepType = FlowStep['type'];
export type Position = { readonly x: number; readonly y: number };

/** Cómo empieza el flujo (Fase 7.3). */
export type Trigger =
  | { readonly type: 'comment'; readonly mediaIds: 'all' | readonly string[]; readonly keywords: readonly string[] }
  | { readonly type: 'dm_keyword'; readonly keywords: readonly string[]; readonly exact: boolean }
  | { readonly type: 'story_reply'; readonly keywords: readonly string[] }
  | { readonly type: 'story_mention' }
  | { readonly type: 'ref'; readonly ref: string }
  | { readonly type: 'manual' };

export type TriggerType = Trigger['type'];

export interface Flow {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: Trigger;
  readonly publicReplies: readonly string[];
  readonly dmFailedReplies: readonly string[];
  readonly startNodeId: string;
  readonly nodes: readonly FlowStep[];
  readonly testUsernames: readonly string[];
  readonly oncePerUser: boolean;
  readonly onceScope: 'media' | 'flow';
  readonly template?: string;
  readonly layout?: Readonly<Record<string, Position>>;
}

export interface FlowSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly steps: number;
  readonly trigger: Trigger;
  readonly testUsernames: readonly string[];
}

export interface FlowsResponse {
  readonly flows: readonly FlowSummary[];
  readonly reels: readonly { readonly mediaId: string; readonly label: string }[];
  /** Bloqueo de envíos vigente (p. ej. el de Meta), o null. */
  readonly sendsBlockedUntil: string | null;
  /** Usuario de Instagram conectado (para el enlace ig.me), o null si no se pudo leer. */
  readonly account?: string | null;
}

/** Límites de Meta (los mismos que valida el servidor). */
export const MAX_BUTTONS = 3;
export const MAX_TEMPLATE_TEXT = 640;
export const MAX_PLAIN_TEXT = 1000;
export const MAX_DELAY_SECONDS = 23 * 60 * 60;
export const MAX_STEPS = 50;
export const MAX_QUICK_REPLIES = 13;
export const MAX_QUICK_REPLY_TITLE = 20;
export const MAX_CARDS = 10;
export const MAX_CARD_TEXT = 80;

export const TRIGGER_LABEL: Readonly<Record<TriggerType, string>> = {
  comment: 'Comentario en un reel',
  dm_keyword: 'Palabra clave por DM',
  story_reply: 'Respuesta a una historia',
  story_mention: 'Mención en una historia',
  ref: 'Enlace ig.me',
  manual: 'Solo desde otro flujo, rompehielos o menú',
};

/** Resumen de una línea de cómo empieza (lista de flujos y aviso al activar). */
export function triggerSummary(trigger: Trigger): string {
  const words = (keywords: readonly string[], none: string) => (keywords.length ? `palabras: ${keywords.join(', ')}` : none);
  switch (trigger.type) {
    case 'comment':
      return `${trigger.mediaIds === 'all' ? 'Todos los reels' : `${trigger.mediaIds.length} reel(s)`} · ${words(trigger.keywords, 'cualquier comentario')}`;
    case 'dm_keyword':
      return `DM con ${trigger.exact ? 'exactamente' : ''} ${words(trigger.keywords, '')}`.replace(/\s+/g, ' ');
    case 'story_reply':
      return `Respuesta a una historia · ${words(trigger.keywords, 'cualquier respuesta')}`;
    case 'story_mention':
      return 'Te mencionan en una historia';
    case 'ref':
      return `Abren el chat desde el enlace ig.me con ref "${trigger.ref}"`;
    case 'manual':
      return 'Solo desde otro flujo, un rompehielos o el menú';
  }
}
