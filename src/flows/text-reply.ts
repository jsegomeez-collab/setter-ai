import type { InstagramEvent } from '../meta/parse.js';
import type { Store } from '../store.js';
import { normalize, planNode, type Plan } from './engine.js';
import { findNode, type Button } from './types.js';

/**
 * "Sí" escrito en vez de pulsar el botón (caso real @mg_grela, 2026-10-16: escribió "si" tres veces y se quedó sin recurso).
 * Decisión de Jose (2026-10-17): si lo último que recibió la persona es un mensaje del flujo con UN botón de acción
 * y contesta con un "sí" corto, cuenta como pulsar ese botón. Varios "sí" al mismo mensaje cuentan una sola vez
 * (las acciones llevan la clave de ese mensaje y el emisor no repite claves).
 */

/** Palabras que bastan para decir "sí" (lista aprobada por Jose). */
const YES_WORDS = new Set(['si', 'dale', 'ok', 'vale', 'listo', 'ya', 'quiero', 'porfa', 'mandamelo', 'segui', 'sigo']);
/** Palabras de relleno: valen acompañando a un "sí" ("ya te sigo", "si por favor"), nunca solas. */
const FILLER_WORDS = new Set(['te', 'lo', 'por', 'favor']);
const MAX_WORDS = 5;
/** Mensajes recientes en los que se busca el último que se le mandó a la persona. */
const RECENT_MESSAGES = 20;

/** Minúsculas, sin tildes, solo letras y sin letras repetidas ("Síiii!!" → "si"). */
function words(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .split(' ')
    .filter((word) => word.length > 0);
}

export function isAffirmativeReply(text: string, buttonTitle: string): boolean {
  const said = words(text);
  if (said.length === 0 || said.length > MAX_WORDS) return false;
  const titleWords = words(buttonTitle).filter((word) => !FILLER_WORDS.has(word));
  const isYes = (word: string) => YES_WORDS.has(word) || titleWords.includes(word);
  return said.every((word) => isYes(word) || FILLER_WORDS.has(word)) && said.some(isYes);
}

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;
type PostbackButton = Extract<Button, { type: 'postback' }>;

/** Flujo y paso del mensaje que se envió (el emisor guarda la acción entera como `request`). */
function sentFlowStep(request: unknown): { flowId: string; nodeId: string } | null {
  const message = (request as { message?: { flowId?: unknown; nodeId?: unknown } } | null)?.message;
  return typeof message?.flowId === 'string' && typeof message.nodeId === 'string' ? { flowId: message.flowId, nodeId: message.nodeId } : null;
}

/** Plan del flujo para un DM de texto, o null si el texto es para el setter. */
export async function planTextReply(event: MessageEvent, store: Pick<Store, 'listMessages' | 'getAction' | 'listFlows'>): Promise<Plan | null> {
  if (!event.text) return null;
  const recent = await store.listMessages(event.senderId, RECENT_MESSAGES);
  const lastOut = [...recent].reverse().find((message) => message.direction === 'out');
  if (lastOut?.source !== 'flow' || !lastOut.dedupKey) return null;
  const step = sentFlowStep((await store.getAction(lastOut.dedupKey))?.request);
  if (!step) return null;
  const flow = (await store.listFlows()).find((candidate) => candidate.id === step.flowId);
  if (!flow?.enabled) return null;
  const node = findNode(flow, step.nodeId);
  if (node?.type !== 'message') return null;
  const actionButtons = node.buttons.filter((button): button is PostbackButton => button.type === 'postback');
  const button = actionButtons.length === 1 ? actionButtons[0] : undefined;
  if (!button || !isAffirmativeReply(event.text, button.title)) return null;
  const actions = planNode(flow, button.next, event.senderId, `txt:${lastOut.dedupKey}`);
  if (actions.length === 0) return null;
  return { actions, note: `Flujo "${flow.name}": texto como botón ("${event.text}" = "${button.title}") → paso ${button.next}.`, flowId: flow.id };
}
