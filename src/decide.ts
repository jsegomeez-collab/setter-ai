import type { InstagramEvent } from './meta/parse.js';

/**
 * Decide qué hacer con cada evento. Es una función pura (sin red ni base de datos) para poder probarla.
 *
 * SEGUROS DE LA FASE 1 (ManyChat está en vivo con tráfico real):
 * - Solo se actúa sobre comentarios del reel de prueba elegido en el panel.
 * - Solo se contesta por DM a remitentes autorizados y si los DMs están activados en el panel.
 * - Nunca se contesta a mensajes propios (ecos) ni a eventos "standby" (conversaciones de otra app, p. ej. ManyChat).
 */

export interface DecisionContext {
  readonly testMediaId: string | null;
  readonly dmRepliesEnabled: boolean;
  readonly allowedSenderIds: ReadonlySet<string>;
}

export type Action =
  | { readonly type: 'reply_comment'; readonly dedupKey: string; readonly commentId: string; readonly text: string }
  | { readonly type: 'private_reply'; readonly dedupKey: string; readonly commentId: string; readonly text: string }
  | { readonly type: 'send_dm'; readonly dedupKey: string; readonly recipientId: string; readonly text: string };

export interface Decision {
  readonly actions: readonly Action[];
  readonly note: string;
}

const MAX_QUOTE_LENGTH = 200;

export const TEXTS = {
  publicReply: '¡Te escribí por DM! 📩',
  privateReply: (comment: string) => `Prueba del sistema ✅ Recibido tu comentario: «${quote(comment)}». Respóndeme aquí.`,
  dmReply: (text: string) => `Prueba del sistema ✅ Recibido: «${quote(text)}»`,
} as const;

function quote(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > MAX_QUOTE_LENGTH ? `${singleLine.slice(0, MAX_QUOTE_LENGTH)}…` : singleLine;
}

const nothing = (note: string): Decision => ({ actions: [], note });

function decideComment(event: Extract<InstagramEvent, { kind: 'comment' }>, ctx: DecisionContext): Decision {
  if (event.fromId === event.accountId) return nothing('Ignorado: comentario de tu propia cuenta.');
  if (event.parentId) return nothing('Solo registro: es una respuesta a otro comentario.');
  if (!ctx.testMediaId) return nothing('Solo registro: no hay reel de prueba elegido.');
  if (event.mediaId !== ctx.testMediaId) return nothing('Solo registro: no es el reel de prueba.');
  return {
    note: 'Reel de prueba: respuesta pública + DM privado.',
    actions: [
      { type: 'reply_comment', dedupKey: `reply:${event.commentId}`, commentId: event.commentId, text: TEXTS.publicReply },
      {
        type: 'private_reply',
        dedupKey: `private:${event.commentId}`,
        commentId: event.commentId,
        text: TEXTS.privateReply(event.text),
      },
    ],
  };
}

function decideMessage(event: Extract<InstagramEvent, { kind: 'message' }>, ctx: DecisionContext): Decision {
  if (event.isEcho || event.senderId === event.accountId) return nothing('Ignorado: mensaje enviado desde tu cuenta.');
  if (!event.text) return nothing('Solo registro: mensaje sin texto.');
  if (!ctx.dmRepliesEnabled) return nothing('Solo registro: respuestas por DM desactivadas en el panel.');
  if (!ctx.allowedSenderIds.has(event.senderId)) return nothing('Solo registro: remitente no autorizado.');
  return {
    note: 'Remitente autorizado: respuesta de prueba.',
    actions: [{ type: 'send_dm', dedupKey: `dm:${event.mid}`, recipientId: event.senderId, text: TEXTS.dmReply(event.text) }],
  };
}

export function decide(event: InstagramEvent, ctx: DecisionContext): Decision {
  switch (event.kind) {
    case 'comment':
      return decideComment(event, ctx);
    case 'message':
      return decideMessage(event, ctx);
    case 'standby':
      return nothing('Solo registro: STANDBY (otra app, p. ej. ManyChat, es dueña de esta conversación).');
    case 'postback':
      return nothing('Solo registro: pulsación de botón.');
    case 'other':
      return nothing(`Solo registro: aviso de tipo "${event.field}".`);
  }
}
