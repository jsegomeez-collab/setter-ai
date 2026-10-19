import { z } from 'zod';

/**
 * Pasos de un flujo (Fase 7.3a). Tres grupos, como en ManyChat:
 *  - Enviar: message (texto + botones o respuestas rápidas), carousel, media, react, setter_opener.
 *  - Hacer: tag, field, ai, notify, goto, delay.
 *  - Condición: follow_gate (¿me sigue?, 3 salidas) y condition (sí / no).
 * Límites sacados de la doc oficial de Meta (enlaces en PLAN.md, Fase 7).
 */

export const MAX_BUTTONS = 3; // Button template.
export const MAX_TEMPLATE_TEXT = 640; // Texto máximo de un mensaje con botones.
export const MAX_PLAIN_TEXT = 1000; // Texto máximo de un mensaje sin botones (1000 bytes).
/** Meta solo deja escribir dentro de las 24 h desde el último mensaje de la persona. Margen de 1 h. */
export const MAX_DELAY_SECONDS = 23 * 60 * 60;
export const MAX_QUICK_REPLIES = 13;
export const MAX_QUICK_REPLY_TITLE = 20;
export const MAX_CARDS = 10;
export const MAX_CARD_TEXT = 80;
const MAX_BUTTON_TITLE = 40;
const MAX_FIELD_VALUE = 200;

export const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'id con letras, números, - o _ (máx. 32)');
const httpsUrl = z.url({ protocol: /^https?$/ });
export const tagName = z.string().trim().min(1).max(40);
const fieldName = z.string().trim().min(1).max(40);
const keywordList = z.array(z.string().trim().min(1).max(50)).max(30);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora en formato HH:MM');

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('es', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const buttonSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    title: z.string().trim().min(1).max(MAX_BUTTON_TITLE),
    url: httpsUrl,
    /** Etiquetas que se añaden al contacto cuando pulsa el enlace (como las "Acciones" de ManyChat). */
    tags: z.array(tagName).max(10).default([]),
  }),
  z.object({ type: z.literal('postback'), title: z.string().trim().min(1).max(MAX_BUTTON_TITLE), next: nodeId }),
]);

export const quickReplySchema = z.object({ title: z.string().trim().min(1).max(MAX_QUICK_REPLY_TITLE), next: nodeId });

export const messageNodeSchema = z.object({
  id: nodeId,
  type: z.literal('message'),
  text: z.string().trim().min(1).max(MAX_PLAIN_TEXT),
  buttons: z.array(buttonSchema).max(MAX_BUTTONS),
  /** Respuestas rápidas (no salen en el ordenador). No se pueden mezclar con botones. */
  quickReplies: z.array(quickReplySchema).max(MAX_QUICK_REPLIES).default([]),
  /** "Siguiente paso" automático tras enviar este mensaje. */
  next: nodeId.optional(),
});

export const cardSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_CARD_TEXT),
    subtitle: z.string().trim().max(MAX_CARD_TEXT).optional(),
    imageUrl: httpsUrl.optional(),
    /** Enlace al tocar la tarjeta. */
    url: httpsUrl.optional(),
    buttons: z.array(buttonSchema).max(MAX_BUTTONS).default([]),
  })
  .refine((card) => !!card.subtitle || !!card.imageUrl || !!card.url || card.buttons.length > 0, {
    message: 'Cada tarjeta necesita algo más que el título (subtítulo, foto, enlace o botón).',
  });

const carouselNodeSchema = z.object({ id: nodeId, type: z.literal('carousel'), cards: z.array(cardSchema).min(1).max(MAX_CARDS), next: nodeId.optional() });

/** Imagen (png/jpeg ≤ 8 MB), vídeo, audio o PDF (≤ 25 MB) desde un enlace público. */
const mediaNodeSchema = z.object({ id: nodeId, type: z.literal('media'), kind: z.enum(['image', 'video', 'audio', 'file']), url: httpsUrl, next: nodeId.optional() });

/** Reacción con un emoji al último mensaje de la persona. */
const reactNodeSchema = z.object({ id: nodeId, type: z.literal('react'), emoji: z.string().trim().min(1).max(16), next: nodeId.optional() });

export const followGateNodeSchema = z.object({
  id: nodeId,
  type: z.literal('follow_gate'),
  ifFollowing: nodeId,
  ifNotFollowing: nodeId,
  /** Cuando Meta no deja saber si sigue (falta de "consentimiento"). */
  ifUnknown: nodeId,
});

const delayNodeSchema = z.object({ id: nodeId, type: z.literal('delay'), seconds: z.number().int().min(1).max(MAX_DELAY_SECONDS), next: nodeId });

/**
 * Inicio del setter IA (Fase 5.4): la IA escribe primero uno de estos textos (al azar) y a partir de ahí conversa.
 * Va al final del flujo (sin siguiente paso). El setter comprueba antes sus reglas (modo, pausa, si ya están hablando).
 */
const setterOpenerNodeSchema = z.object({
  id: nodeId,
  type: z.literal('setter_opener'),
  texts: z.array(z.string().trim().min(1).max(MAX_PLAIN_TEXT)).min(1).max(20),
});

const tagNodeSchema = z.object({ id: nodeId, type: z.literal('tag'), op: z.enum(['add', 'remove']), tag: tagName, next: nodeId.optional() });
/** Guarda un dato en la ficha (campo propio). Valor vacío = borrar el dato. */
const fieldNodeSchema = z.object({ id: nodeId, type: z.literal('field'), field: fieldName, value: z.string().trim().max(MAX_FIELD_VALUE), next: nodeId.optional() });
/** Pausa (true) o vuelve a activar (false) el setter IA en esta conversación. */
const aiNodeSchema = z.object({ id: nodeId, type: z.literal('ai'), paused: z.boolean(), next: nodeId.optional() });
/** Aviso para Jose dentro de la app (Inicio). No escribe a nadie. */
const notifyNodeSchema = z.object({ id: nodeId, type: z.literal('notify'), text: z.string().trim().min(1).max(300), next: nodeId.optional() });
/** Salta al principio de otro flujo (tiene que estar activo). */
const gotoNodeSchema = z.object({ id: nodeId, type: z.literal('goto'), flowId: nodeId });

export const conditionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('has_tag'), tag: tagName }),
  z.object({ kind: z.literal('field'), field: fieldName, op: z.enum(['equals', 'contains', 'set']), value: z.string().trim().max(MAX_FIELD_VALUE).default('') }),
  /** Alguna de estas palabras en el último mensaje de la persona. */
  z.object({ kind: z.literal('keyword'), keywords: keywordList.min(1) }),
  /** Perfil de Instagram (solo si la persona ya escribió); si Meta no deja saberlo, cuenta como "no". */
  z.object({ kind: z.literal('verified') }),
  z.object({ kind: z.literal('followers'), min: z.number().int().min(0).max(1_000_000_000) }),
  /** Horario: días (0 = domingo … 6 = sábado) y horas en una zona horaria. "Desde" > "hasta" cruza la medianoche. */
  z.object({
    kind: z.literal('hours'),
    from: clock,
    to: clock,
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timeZone: z.string().refine(isTimeZone, 'No es una zona horaria válida (p. ej. Europe/Madrid).'),
  }),
  /** Prueba A/B: este % va por "sí", el resto por "no". */
  z.object({ kind: z.literal('random'), percent: z.number().int().min(1).max(99) }),
]);

const conditionNodeSchema = z.object({ id: nodeId, type: z.literal('condition'), rule: conditionRuleSchema, ifTrue: nodeId, ifFalse: nodeId });

export const nodeSchema = z.discriminatedUnion('type', [
  messageNodeSchema,
  carouselNodeSchema,
  mediaNodeSchema,
  reactNodeSchema,
  followGateNodeSchema,
  delayNodeSchema,
  setterOpenerNodeSchema,
  tagNodeSchema,
  fieldNodeSchema,
  aiNodeSchema,
  notifyNodeSchema,
  gotoNodeSchema,
  conditionNodeSchema,
]);

export type FlowNode = z.infer<typeof nodeSchema>;
export type Button = z.infer<typeof buttonSchema>;
export type QuickReply = z.infer<typeof quickReplySchema>;
export type Card = z.infer<typeof cardSchema>;
export type ConditionRule = z.infer<typeof conditionRuleSchema>;
export type MessageNode = z.infer<typeof messageNodeSchema>;

/** Pasos que mandan algo a la persona (o pueden hacerlo, como saltar a otro flujo). */
const SENDING_TYPES = new Set<FlowNode['type']>(['message', 'carousel', 'media', 'react', 'setter_opener', 'goto']);
export const isSending = (node: FlowNode): boolean => SENDING_TYPES.has(node.type);

/** Salidas automáticas (sin que la persona pulse nada): "siguiente paso", ramas de condiciones y pausas. */
export function autoEdges(node: FlowNode): string[] {
  switch (node.type) {
    case 'follow_gate':
      return [node.ifFollowing, node.ifNotFollowing, node.ifUnknown];
    case 'condition':
      return [node.ifTrue, node.ifFalse];
    case 'setter_opener':
    case 'goto':
      return [];
    default:
      return node.next ? [node.next] : [];
  }
}

/** Salidas que necesitan que la persona pulse (botones de acción y respuestas rápidas), con quién las pide. */
export function tapEdges(node: FlowNode): { readonly label: string; readonly target: string }[] {
  if (node.type === 'message') {
    return [
      ...node.buttons.flatMap((button) => (button.type === 'postback' ? [{ label: `Botón "${button.title}"`, target: button.next }] : [])),
      ...node.quickReplies.map((reply) => ({ label: `Respuesta rápida "${reply.title}"`, target: reply.next })),
    ];
  }
  if (node.type === 'carousel') {
    return node.cards.flatMap((card) => card.buttons.flatMap((button) => (button.type === 'postback' ? [{ label: `Botón "${button.title}"`, target: button.next }] : [])));
  }
  return [];
}
