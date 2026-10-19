import type { InstagramEvent } from '../meta/parse.js';
import type { Card } from './nodes.js';
import { findNode, type Button, type Flow, type FlowNode, type QuickReply } from './types.js';

/**
 * Motor de flujos. Funciones puras: reciben eventos y flujos y devuelven acciones.
 * El envío real (cola, esperas, límites, pausas programadas) lo hacen el emisor y el programador.
 * Los pasos de "hacer" y las condiciones (Fase 7.3a) salen como `flow_step`: se ejecutan en la cola, en orden,
 * para que una condición vea las etiquetas que puso el paso anterior (steps.ts).
 */

export interface OutMessage {
  readonly text: string;
  readonly buttons: readonly Button[];
  /** Respuestas rápidas (Fase 7.3a). */
  readonly quickReplies?: readonly QuickReply[];
  /** Carrusel (Fase 7.3a). Si existe, `text` es solo un resumen para el historial. */
  readonly cards?: readonly Card[];
  /** Imagen, vídeo, audio o PDF por enlace (Fase 7.3a). */
  readonly media?: { readonly kind: 'image' | 'video' | 'audio' | 'file'; readonly url: string };
  readonly flowId: string;
  readonly nodeId: string;
  /** A quién va (para los enlaces con seguimiento). En la respuesta privada es quien comentó. */
  readonly recipientId: string;
}

export type Action =
  | {
      readonly type: 'reply_comment';
      readonly dedupKey: string;
      readonly commentId: string;
      readonly text: string;
      /** Solo se publica si esta otra acción (el DM) salió bien: así nunca decimos "mira tus DMs" sin DM. */
      readonly requires?: string;
    }
  | {
      readonly type: 'private_reply';
      readonly dedupKey: string;
      readonly commentId: string;
      readonly message: OutMessage;
      /** Plan B: respuesta pública que se publica SOLO si Meta rechaza este DM (también como solo texto). */
      readonly failReply?: string;
    }
  | { readonly type: 'send_message'; readonly dedupKey: string; readonly recipientId: string; readonly message: OutMessage }
  /** Reacción con un emoji al último mensaje de la persona (Fase 7.3a). */
  | { readonly type: 'react'; readonly dedupKey: string; readonly recipientId: string; readonly emoji: string }
  | {
      readonly type: 'check_follow';
      readonly dedupKey: string;
      readonly recipientId: string;
      readonly flowId: string;
      readonly nodeId: string;
      readonly depth: number;
    }
  | {
      /** Paso de "hacer" o condición (Fase 7.3a): se ejecuta al llegarle el turno en la cola y sigue con el siguiente. */
      readonly type: 'flow_step';
      readonly dedupKey: string;
      readonly recipientId: string;
      readonly flowId: string;
      readonly nodeId: string;
      readonly depth: number;
    }
  | {
      /** Inicio del setter (Fase 5.4): la IA escribe primero uno de estos textos, si sus reglas lo permiten. */
      readonly type: 'setter_opener';
      readonly dedupKey: string;
      readonly recipientId: string;
      readonly texts: readonly string[];
    }
  | {
      /** Pausa: dentro de `delaySeconds`, ejecutar el nodo `nodeId` para esta persona. */
      readonly type: 'schedule';
      readonly dedupKey: string;
      readonly recipientId: string;
      readonly flowId: string;
      readonly nodeId: string;
      readonly delaySeconds: number;
      readonly depth: number;
    };

export interface Plan {
  readonly actions: readonly Action[];
  readonly note: string;
  /** Si existe, el ejecutor debe reservar esta clave antes de actuar (una vez por persona y flujo). */
  readonly onceKey?: string;
  readonly flowId?: string;
}

export type FollowStatus = 'yes' | 'no' | 'unknown';

/** Máximo de pasos encadenados de una vez, para cortar flujos mal hechos (también entre flujos con "ir a otro flujo"). */
export const MAX_DEPTH = 12;
const PAYLOAD_PREFIX = 'F';
/** Rompehielos y menú fijo: empezar un flujo desde su primer paso. */
const START_PREFIX = 'S';

const none = (note: string): Plan => ({ actions: [], note });

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^@/, '');
}

/** Solo letras y números separados por un espacio ("¡Guía!" → "guia"), para comparar palabras exactas. */
const plain = (text: string): string => normalize(text).replace(/[^a-z0-9]+/g, ' ').trim();

export function encodePayload(flowId: string, nodeId: string): string {
  return `${PAYLOAD_PREFIX}:${flowId}:${nodeId}`;
}

export function decodePayload(payload: string | null): { flowId: string; nodeId: string } | null {
  const parts = (payload ?? '').split(':');
  if (parts.length !== 3 || parts[0] !== PAYLOAD_PREFIX || !parts[1] || !parts[2]) return null;
  return { flowId: parts[1], nodeId: parts[2] };
}

export function encodeStartPayload(flowId: string): string {
  return `${START_PREFIX}:${flowId}`;
}

function decodeStartPayload(payload: string | null): string | null {
  const parts = (payload ?? '').split(':');
  return parts.length === 2 && parts[0] === START_PREFIX && parts[1] ? parts[1] : null;
}

type CommentEvent = Extract<InstagramEvent, { kind: 'comment' }>;

export interface CommentProbe {
  readonly text: string;
  readonly username: string | null;
  readonly mediaId: string | null;
}

function testModeReason(flow: Flow, username: string | null): string | null {
  if (flow.testUsernames.length === 0) return null;
  const name = normalize(username ?? '');
  if (name && flow.testUsernames.some((allowed) => normalize(allowed) === name)) return null;
  return `El flujo está en modo prueba y @${name || '(sin usuario)'} no está en la lista.`;
}

const containsKeyword = (keywords: readonly string[], text: string): boolean => keywords.some((keyword) => normalize(text).includes(normalize(keyword)));

/**
 * Si un comentario hace saltar el flujo (sin mirar si está activo) y, si no, por qué. Es LA regla del motor:
 * commentMatches la usa, así que "probar un comentario" (Fase 6.5c) nunca puede decir algo distinto de lo que pasará.
 */
export function explainComment(flow: Flow, probe: CommentProbe): { matches: boolean; reasons: string[] } {
  const { trigger } = flow;
  if (trigger.type !== 'comment') return { matches: false, reasons: ['Este flujo no empieza con comentarios.'] };
  const reasons: string[] = [];
  if (trigger.mediaIds !== 'all' && (!probe.mediaId || !trigger.mediaIds.includes(probe.mediaId))) reasons.push('Ese reel no está entre los elegidos del flujo.');
  const testReason = testModeReason(flow, probe.username);
  if (testReason) reasons.push(testReason);
  if (trigger.keywords.length > 0 && !containsKeyword(trigger.keywords, probe.text)) {
    reasons.push(`El comentario no tiene ninguna palabra clave (${trigger.keywords.join(', ')}).`);
  }
  return { matches: reasons.length === 0, reasons };
}

function commentMatches(flow: Flow, event: CommentEvent): boolean {
  return flow.enabled && explainComment(flow, { text: event.text, username: event.fromUsername, mediaId: event.mediaId }).matches;
}

/** Más específico primero: reel concreto antes que "todos"; con palabras clave antes que "cualquier comentario". */
function specificity(flow: Flow): number {
  const { trigger } = flow;
  if (trigger.type !== 'comment') return -1;
  return (trigger.mediaIds === 'all' ? 0 : 2) + (trigger.keywords.length > 0 ? 1 : 0);
}

export function findFlowForComment(flows: readonly Flow[], event: CommentEvent): Flow | null {
  const candidates = flows.filter((flow) => commentMatches(flow, event));
  candidates.sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** Lo que trae un DM para decidir si salta un flujo (Fase 7.3a). */
export interface MessageProbe {
  readonly text: string | null;
  readonly username: string | null;
  /** Responde a una historia (`message.reply_to.story`). */
  readonly storyReply: boolean;
  /** Menciona la cuenta en su historia (adjunto `story_mention`). */
  readonly storyMention: boolean;
  /** `ref` del enlace ig.me por el que abrió el chat. */
  readonly ref: string | null;
}

/** Igual que explainComment, para las formas de empezar por DM. */
export function explainMessage(flow: Flow, probe: MessageProbe): { matches: boolean; reasons: string[] } {
  const { trigger } = flow;
  const reasons: string[] = [];
  const text = probe.text ?? '';
  switch (trigger.type) {
    case 'comment':
      return { matches: false, reasons: ['Este flujo empieza con comentarios, no con DMs.'] };
    case 'manual':
      return { matches: false, reasons: ['Este flujo solo empieza desde otro flujo, un rompehielos o el menú.'] };
    case 'dm_keyword': {
      const hit = trigger.exact ? trigger.keywords.some((keyword) => plain(keyword) === plain(text)) : containsKeyword(trigger.keywords, text);
      if (!hit) reasons.push(`El mensaje no tiene ninguna palabra clave${trigger.exact ? ' (exacta)' : ''} (${trigger.keywords.join(', ')}).`);
      break;
    }
    case 'story_reply':
      if (!probe.storyReply) reasons.push('No es una respuesta a una historia.');
      else if (trigger.keywords.length > 0 && !containsKeyword(trigger.keywords, text)) reasons.push(`La respuesta no tiene ninguna palabra clave (${trigger.keywords.join(', ')}).`);
      break;
    case 'story_mention':
      if (!probe.storyMention) reasons.push('No es una mención en una historia.');
      break;
    case 'ref':
      if (probe.ref !== trigger.ref) reasons.push(`No viene del enlace ig.me con ref "${trigger.ref}".`);
      break;
  }
  const testReason = testModeReason(flow, probe.username);
  if (testReason) reasons.push(testReason);
  return { matches: reasons.length === 0, reasons };
}

/** Más concreto primero: ig.me > mención > historia (con palabras antes que sin) > palabra exacta > palabra que contiene. */
function messageSpecificity(flow: Flow): number {
  const { trigger } = flow;
  switch (trigger.type) {
    case 'ref':
      return 6;
    case 'story_mention':
      return 5;
    case 'story_reply':
      return trigger.keywords.length > 0 ? 4 : 3;
    case 'dm_keyword':
      return trigger.exact ? 2 : 1;
    default:
      return 0;
  }
}

export function findFlowForMessage(flows: readonly Flow[], probe: MessageProbe): Flow | null {
  const candidates = flows.filter((flow) => flow.enabled && explainMessage(flow, probe).matches);
  candidates.sort((a, b) => messageSpecificity(b) - messageSpecificity(a) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** Plan para un DM que hace saltar un flujo (palabra clave, historia, mención, ig.me), o null si ninguno salta. */
export function planMessageTrigger(flows: readonly Flow[], probe: MessageProbe, senderId: string, dedupBase: string): Plan | null {
  const flow = findFlowForMessage(flows, probe);
  if (!flow) return null;
  const actions = planNode(flow, flow.startNodeId, senderId, dedupBase);
  if (actions.length === 0) return null;
  return {
    actions,
    note: `Flujo "${flow.name}": empieza por ${TRIGGER_LABEL[flow.trigger.type]}.`,
    onceKey: flow.oncePerUser ? `once:${flow.id}:${senderId}` : undefined,
    flowId: flow.id,
  };
}

const TRIGGER_LABEL: Readonly<Record<Flow['trigger']['type'], string>> = {
  comment: 'comentario',
  dm_keyword: 'palabra clave en DM',
  story_reply: 'respuesta a una historia',
  story_mention: 'mención en una historia',
  ref: 'enlace ig.me',
  manual: 'otro flujo',
};

function toOutMessage(flow: Flow, node: Extract<FlowNode, { type: 'message' }>, recipientId: string): OutMessage {
  return { text: node.text, buttons: node.buttons, quickReplies: node.quickReplies, flowId: flow.id, nodeId: node.id, recipientId };
}

/** Clave de "una vez por persona": por persona y reel (por defecto) o por persona en todo el flujo. */
export function onceKeyFor(flow: Flow, event: CommentEvent): string {
  const base = `once:${flow.id}:${event.fromId}`;
  return flow.onceScope === 'flow' ? base : `${base}:${event.mediaId ?? 'sin-reel'}`;
}

/** Una al azar (respuestas públicas variadas). undefined si la lista está vacía o no existe (flujo antiguo). */
function pickOne(options: readonly string[] | undefined, random: () => number): string | undefined {
  if (!options || options.length === 0) return undefined;
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

export function planComment(flows: readonly Flow[], event: CommentEvent, random: () => number = Math.random): Plan {
  if (event.fromId === event.accountId) return none('Ignorado: comentario de tu propia cuenta.');
  if (event.parentId) return none('Solo registro: es una respuesta a otro comentario.');
  const flow = findFlowForComment(flows, event);
  if (!flow) return none('Solo registro: ningún flujo activo coincide con este comentario.');
  const start = findNode(flow, flow.startNodeId);
  if (!start || start.type !== 'message') return none(`Flujo "${flow.name}" mal configurado: el inicio no es un mensaje.`);

  // Primero el DM; la respuesta pública solo si el DM salió bien (y la del plan B solo si falló).
  const privateKey = `private:${event.commentId}`;
  const failReply = pickOne(flow.dmFailedReplies, random);
  const actions: Action[] = [
    {
      type: 'private_reply',
      dedupKey: privateKey,
      commentId: event.commentId,
      message: toOutMessage(flow, start, event.fromId),
      ...(failReply ? { failReply } : {}),
    },
  ];
  const publicReply = pickOne(flow.publicReplies, random);
  if (publicReply) {
    actions.push({ type: 'reply_comment', dedupKey: `reply:${event.commentId}`, commentId: event.commentId, text: publicReply, requires: privateKey });
  }
  // Tras el DM solo pueden ir pasos que no envían (lo comprueba validateFlow): etiquetas, datos, avisos…
  if (start.next) actions.push(...planNode(flow, start.next, event.fromId, privateKey, 1));
  return {
    actions,
    note: `Flujo "${flow.name}": respuesta pública + DM.`,
    onceKey: flow.oncePerUser ? onceKeyFor(flow, event) : undefined,
    flowId: flow.id,
  };
}

const sendNext = (flow: Flow, next: string | undefined, recipientId: string, dedupKey: string, depth: number): Action[] =>
  next ? planNode(flow, next, recipientId, dedupKey, depth + 1) : [];

/** Acciones para ejecutar un nodo (y sus "siguientes pasos" automáticos de envío) a una persona. */
export function planNode(flow: Flow, nodeId: string, recipientId: string, dedupBase: string, depth = 0): Action[] {
  const node = findNode(flow, nodeId);
  if (!node || depth >= MAX_DEPTH) return [];
  const dedupKey = `${dedupBase}:${node.id}`;
  const base = { flowId: flow.id, nodeId: node.id, recipientId };
  switch (node.type) {
    case 'message':
      return [{ type: 'send_message', dedupKey, recipientId, message: toOutMessage(flow, node, recipientId) }, ...sendNext(flow, node.next, recipientId, dedupKey, depth)];
    case 'carousel': {
      const message: OutMessage = { ...base, text: node.cards.map((card) => card.title).join(' · '), buttons: [], cards: node.cards };
      return [{ type: 'send_message', dedupKey, recipientId, message }, ...sendNext(flow, node.next, recipientId, dedupKey, depth)];
    }
    case 'media': {
      const message: OutMessage = { ...base, text: '', buttons: [], media: { kind: node.kind, url: node.url } };
      return [{ type: 'send_message', dedupKey, recipientId, message }, ...sendNext(flow, node.next, recipientId, dedupKey, depth)];
    }
    case 'react':
      return [{ type: 'react', dedupKey, recipientId, emoji: node.emoji }, ...sendNext(flow, node.next, recipientId, dedupKey, depth)];
    case 'follow_gate':
      return [{ type: 'check_follow', dedupKey, recipientId, flowId: flow.id, nodeId: node.id, depth }];
    case 'delay':
      return [{ type: 'schedule', dedupKey, recipientId, flowId: flow.id, nodeId: node.next, delaySeconds: node.seconds, depth: depth + 1 }];
    case 'setter_opener':
      return [{ type: 'setter_opener', dedupKey, recipientId, texts: node.texts }];
    case 'tag':
    case 'field':
    case 'ai':
    case 'notify':
    case 'goto':
    case 'condition':
      return [{ type: 'flow_step', dedupKey, recipientId, flowId: flow.id, nodeId: node.id, depth }];
  }
}

type PostbackEvent = Extract<InstagramEvent, { kind: 'postback' }>;

export function planPostback(flows: readonly Flow[], event: PostbackEvent): Plan {
  const dedupBase = `pb:${event.mid ?? `${event.senderId}:${event.payload}`}`;
  const startFlowId = decodeStartPayload(event.payload);
  if (startFlowId) {
    const flow = flows.find((candidate) => candidate.id === startFlowId);
    if (!flow) return none(`Rompehielos o menú de un flujo que ya no existe (${startFlowId}).`);
    if (!flow.enabled) return none(`Rompehielos o menú del flujo "${flow.name}", que está desactivado.`);
    return { actions: planNode(flow, flow.startNodeId, event.senderId, dedupBase), note: `Flujo "${flow.name}": empieza desde un rompehielos o el menú.`, flowId: flow.id };
  }
  const target = decodePayload(event.payload);
  if (!target) return none('Solo registro: botón que no es de nuestros flujos.');
  const flow = flows.find((candidate) => candidate.id === target.flowId);
  if (!flow) return none(`Botón de un flujo que ya no existe (${target.flowId}).`);
  if (!flow.enabled) return none(`Botón del flujo "${flow.name}", que está desactivado.`);
  const actions = planNode(flow, target.nodeId, event.senderId, dedupBase);
  if (actions.length === 0) return none(`Flujo "${flow.name}": el botón apunta a un paso que no existe.`);
  return { actions, note: `Flujo "${flow.name}": botón pulsado → paso ${target.nodeId}.`, flowId: flow.id };
}

/** Respuesta rápida pulsada (llega como DM con `quick_reply.payload`). null si no es de nuestros flujos. */
export function planQuickReply(flows: readonly Flow[], payload: string, senderId: string, mid: string): Plan | null {
  const target = decodePayload(payload);
  if (!target) return null;
  const flow = flows.find((candidate) => candidate.id === target.flowId);
  if (!flow?.enabled) return null;
  const actions = planNode(flow, target.nodeId, senderId, `qr:${mid}`);
  if (actions.length === 0) return null;
  return { actions, note: `Flujo "${flow.name}": respuesta rápida → paso ${target.nodeId}.`, flowId: flow.id };
}

/** Tras consultar a Meta si la persona sigue la cuenta, elige la rama de la condición. */
export function planAfterFollowCheck(
  flow: Flow,
  gateNodeId: string,
  status: FollowStatus,
  recipientId: string,
  dedupBase: string,
  depth: number,
): Action[] {
  const gate = findNode(flow, gateNodeId);
  if (!gate || gate.type !== 'follow_gate') return [];
  const next = status === 'yes' ? gate.ifFollowing : status === 'no' ? gate.ifNotFollowing : gate.ifUnknown;
  return planNode(flow, next, recipientId, `${dedupBase}:${status}`, depth + 1);
}
