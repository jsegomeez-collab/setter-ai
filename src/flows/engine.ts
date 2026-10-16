import type { InstagramEvent } from '../meta/parse.js';
import { findNode, type Button, type Flow, type FlowNode } from './types.js';

/**
 * Motor de flujos. Funciones puras: reciben eventos y flujos y devuelven acciones.
 * El envío real (cola, esperas, límites, pausas programadas) lo hacen el emisor y el programador.
 */

export interface OutMessage {
  readonly text: string;
  readonly buttons: readonly Button[];
  readonly flowId: string;
  readonly nodeId: string;
  /** A quién va (para los enlaces con seguimiento). En la respuesta privada es quien comentó. */
  readonly recipientId: string;
}

export type Action =
  | { readonly type: 'reply_comment'; readonly dedupKey: string; readonly commentId: string; readonly text: string }
  | { readonly type: 'private_reply'; readonly dedupKey: string; readonly commentId: string; readonly message: OutMessage }
  | { readonly type: 'send_message'; readonly dedupKey: string; readonly recipientId: string; readonly message: OutMessage }
  | {
      readonly type: 'check_follow';
      readonly dedupKey: string;
      readonly recipientId: string;
      readonly flowId: string;
      readonly nodeId: string;
      readonly depth: number;
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

/** Máximo de pasos encadenados de una vez, para cortar flujos mal hechos. */
const MAX_DEPTH = 12;
const PAYLOAD_PREFIX = 'F';

const none = (note: string): Plan => ({ actions: [], note });

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^@/, '');
}

export function encodePayload(flowId: string, nodeId: string): string {
  return `${PAYLOAD_PREFIX}:${flowId}:${nodeId}`;
}

export function decodePayload(payload: string | null): { flowId: string; nodeId: string } | null {
  const parts = (payload ?? '').split(':');
  if (parts.length !== 3 || parts[0] !== PAYLOAD_PREFIX || !parts[1] || !parts[2]) return null;
  return { flowId: parts[1], nodeId: parts[2] };
}

type CommentEvent = Extract<InstagramEvent, { kind: 'comment' }>;

function commentMatches(flow: Flow, event: CommentEvent): boolean {
  if (!flow.enabled) return false;
  const { mediaIds, keywords } = flow.trigger;
  if (mediaIds !== 'all' && (!event.mediaId || !mediaIds.includes(event.mediaId))) return false;
  if (flow.testUsernames.length > 0) {
    const username = normalize(event.fromUsername ?? '');
    if (!flow.testUsernames.some((allowed) => normalize(allowed) === username)) return false;
  }
  if (keywords.length === 0) return true;
  const text = normalize(event.text);
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

/** Más específico primero: reel concreto antes que "todos"; con palabras clave antes que "cualquier comentario". */
function specificity(flow: Flow): number {
  return (flow.trigger.mediaIds === 'all' ? 0 : 2) + (flow.trigger.keywords.length > 0 ? 1 : 0);
}

export function findFlowForComment(flows: readonly Flow[], event: CommentEvent): Flow | null {
  const candidates = flows.filter((flow) => commentMatches(flow, event));
  candidates.sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

function toOutMessage(flow: Flow, node: Extract<FlowNode, { type: 'message' }>, recipientId: string): OutMessage {
  return { text: node.text, buttons: node.buttons, flowId: flow.id, nodeId: node.id, recipientId };
}

/** Clave de "una vez por persona": por persona y reel (por defecto) o por persona en todo el flujo. */
export function onceKeyFor(flow: Flow, event: CommentEvent): string {
  const base = `once:${flow.id}:${event.fromId}`;
  return flow.onceScope === 'flow' ? base : `${base}:${event.mediaId ?? 'sin-reel'}`;
}

export function planComment(flows: readonly Flow[], event: CommentEvent, random: () => number = Math.random): Plan {
  if (event.fromId === event.accountId) return none('Ignorado: comentario de tu propia cuenta.');
  if (event.parentId) return none('Solo registro: es una respuesta a otro comentario.');
  const flow = findFlowForComment(flows, event);
  if (!flow) return none('Solo registro: ningún flujo activo coincide con este comentario.');
  const start = findNode(flow, flow.startNodeId);
  if (!start || start.type !== 'message') return none(`Flujo "${flow.name}" mal configurado: el inicio no es un mensaje.`);

  const actions: Action[] = [];
  if (flow.publicReplies.length > 0) {
    const index = Math.min(flow.publicReplies.length - 1, Math.floor(random() * flow.publicReplies.length));
    actions.push({ type: 'reply_comment', dedupKey: `reply:${event.commentId}`, commentId: event.commentId, text: flow.publicReplies[index] as string });
  }
  actions.push({
    type: 'private_reply',
    dedupKey: `private:${event.commentId}`,
    commentId: event.commentId,
    message: toOutMessage(flow, start, event.fromId),
  });
  return {
    actions,
    note: `Flujo "${flow.name}": respuesta pública + DM.`,
    onceKey: flow.oncePerUser ? onceKeyFor(flow, event) : undefined,
    flowId: flow.id,
  };
}

/** Acciones para ejecutar un nodo (y sus "siguientes pasos" automáticos) a una persona. */
export function planNode(flow: Flow, nodeId: string, recipientId: string, dedupBase: string, depth = 0): Action[] {
  const node = findNode(flow, nodeId);
  if (!node || depth >= MAX_DEPTH) return [];
  const dedupKey = `${dedupBase}:${node.id}`;
  switch (node.type) {
    case 'message': {
      const send: Action = { type: 'send_message', dedupKey, recipientId, message: toOutMessage(flow, node, recipientId) };
      return node.next ? [send, ...planNode(flow, node.next, recipientId, dedupKey, depth + 1)] : [send];
    }
    case 'follow_gate':
      return [{ type: 'check_follow', dedupKey, recipientId, flowId: flow.id, nodeId: node.id, depth }];
    case 'delay':
      return [{ type: 'schedule', dedupKey, recipientId, flowId: flow.id, nodeId: node.next, delaySeconds: node.seconds, depth: depth + 1 }];
  }
}

type PostbackEvent = Extract<InstagramEvent, { kind: 'postback' }>;

export function planPostback(flows: readonly Flow[], event: PostbackEvent): Plan {
  const target = decodePayload(event.payload);
  if (!target) return none('Solo registro: botón que no es de nuestros flujos.');
  const flow = flows.find((candidate) => candidate.id === target.flowId);
  if (!flow) return none(`Botón de un flujo que ya no existe (${target.flowId}).`);
  if (!flow.enabled) return none(`Botón del flujo "${flow.name}", que está desactivado.`);
  const dedupBase = `pb:${event.mid ?? `${event.senderId}:${event.payload}`}`;
  const actions = planNode(flow, target.nodeId, event.senderId, dedupBase);
  if (actions.length === 0) return none(`Flujo "${flow.name}": el botón apunta a un paso que no existe.`);
  return { actions, note: `Flujo "${flow.name}": botón pulsado → paso ${target.nodeId}.`, flowId: flow.id };
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
