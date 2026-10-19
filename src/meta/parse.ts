/**
 * Convierte el JSON que manda Meta en eventos simples.
 * Es defensivo a propósito: Meta usa formatos distintos según el tipo de aviso
 * (comentarios con `field/value` o con `changes[]`, DMs en `messaging[]`, DMs de otra app dueña en `standby[]`).
 */

export type InstagramEvent =
  | {
      readonly kind: 'comment';
      readonly accountId: string;
      readonly commentId: string;
      readonly text: string;
      readonly fromId: string;
      readonly fromUsername: string | null;
      readonly mediaId: string | null;
      readonly parentId: string | null;
    }
  | {
      readonly kind: 'message';
      readonly accountId: string;
      readonly senderId: string;
      readonly recipientId: string;
      readonly mid: string;
      readonly text: string | null;
      readonly isEcho: boolean;
      /** Fase 7.3a (solo vienen si existen): respuesta rápida pulsada, respuesta a historia, mención, ref de ig.me. */
      readonly quickReplyPayload?: string;
      readonly storyReply?: true;
      readonly storyMention?: true;
      readonly ref?: string;
    }
  | {
      /** Abrió el chat desde un enlace ig.me con ?ref= (aviso messaging_referral). */
      readonly kind: 'referral';
      readonly accountId: string;
      readonly senderId: string;
      readonly ref: string;
      /** Hora del aviso: sirve de clave para no repetirlo si Meta lo reenvía. */
      readonly timestamp: string;
    }
  | {
      readonly kind: 'postback';
      readonly accountId: string;
      readonly senderId: string;
      readonly mid: string | null;
      readonly title: string | null;
      readonly payload: string | null;
    }
  | {
      readonly kind: 'standby';
      readonly accountId: string;
      readonly senderId: string | null;
      readonly mid: string | null;
      readonly text: string | null;
    }
  | {
      /** Avisos informativos: "leído" (read) o reacción con emoji (reaction). */
      readonly kind: 'receipt';
      readonly accountId: string;
      readonly senderId: string;
      readonly receipt: 'read' | 'reaction';
    }
  | {
      readonly kind: 'other';
      readonly accountId: string;
      readonly field: string;
    };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function parseComment(accountId: string, value: Json): InstagramEvent | null {
  const commentId = str(value.id);
  const from = isObject(value.from) ? value.from : null;
  const fromId = from ? str(from.id) : null;
  if (!commentId || !fromId) return null;
  const media = isObject(value.media) ? value.media : null;
  return {
    kind: 'comment',
    accountId,
    commentId,
    text: str(value.text) ?? '',
    fromId,
    fromUsername: from ? str(from.username) : null,
    mediaId: media ? str(media.id) : null,
    parentId: str(value.parent_id),
  };
}

function parseMessaging(accountId: string, item: Json): InstagramEvent | null {
  const sender = isObject(item.sender) ? str(item.sender.id) : null;
  const recipient = isObject(item.recipient) ? str(item.recipient.id) : null;
  // Los avisos de "leído" pueden venir sin remitente: se reconocen antes de exigirlo.
  if (isObject(item.read)) return { kind: 'receipt', accountId, senderId: sender ?? '', receipt: 'read' };
  if (isObject(item.reaction)) return { kind: 'receipt', accountId, senderId: sender ?? '', receipt: 'reaction' };
  if (!sender) return null;

  if (isObject(item.postback)) {
    return {
      kind: 'postback',
      accountId,
      senderId: sender,
      mid: str(item.postback.mid),
      title: str(item.postback.title),
      payload: str(item.postback.payload),
    };
  }

  if (isObject(item.message)) {
    const message = item.message;
    const mid = str(message.mid);
    if (!mid) return null;
    const quickReplyPayload = isObject(message.quick_reply) ? str(message.quick_reply.payload) : null;
    const storyReply = isObject(message.reply_to) && isObject(message.reply_to.story);
    const storyMention = list(message.attachments).some((attachment) => attachment.type === 'story_mention');
    const ref = isObject(message.referral) ? str(message.referral.ref) : null;
    return {
      kind: 'message',
      accountId,
      senderId: sender,
      recipientId: recipient ?? '',
      mid,
      text: str(message.text),
      isEcho: message.is_echo === true,
      ...(quickReplyPayload ? { quickReplyPayload } : {}),
      ...(storyReply ? { storyReply: true as const } : {}),
      ...(storyMention ? { storyMention: true as const } : {}),
      ...(ref ? { ref } : {}),
    };
  }

  if (isObject(item.referral)) {
    const ref = str(item.referral.ref);
    if (ref) return { kind: 'referral', accountId, senderId: sender, ref, timestamp: str(item.timestamp) ?? '' };
  }

  return { kind: 'other', accountId, field: 'messaging' };
}

function parseStandby(accountId: string, item: Json): InstagramEvent {
  const message = isObject(item.message) ? item.message : null;
  return {
    kind: 'standby',
    accountId,
    senderId: isObject(item.sender) ? str(item.sender.id) : null,
    mid: message ? str(message.mid) : null,
    text: message ? str(message.text) : null,
  };
}

function parseChange(accountId: string, field: string, value: unknown): InstagramEvent | null {
  if (!isObject(value)) return { kind: 'other', accountId, field };
  if (field === 'comments' || field === 'live_comments') return parseComment(accountId, value);
  // El botón "Test" del panel de Meta manda los DMs como change con field "messages".
  if (field === 'messages' && isObject(value.sender)) return parseMessaging(accountId, value);
  return { kind: 'other', accountId, field };
}

export function parseWebhook(body: unknown): InstagramEvent[] {
  if (!isObject(body)) return [];
  const events: InstagramEvent[] = [];

  for (const entry of list(body.entry)) {
    const accountId = str(entry.id) ?? '';

    const field = str(entry.field);
    if (field) {
      const event = parseChange(accountId, field, entry.value);
      if (event) events.push(event);
    }

    for (const change of list(entry.changes)) {
      const changeField = str(change.field) ?? 'desconocido';
      const event = parseChange(accountId, changeField, change.value);
      if (event) events.push(event);
    }

    for (const item of list(entry.messaging)) {
      const event = parseMessaging(accountId, item);
      if (event) events.push(event);
    }

    for (const item of list(entry.standby)) {
      events.push(parseStandby(accountId, item));
    }
  }

  return events;
}
