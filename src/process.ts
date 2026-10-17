import { planComment, planPostback, type Plan } from './flows/engine.js';
import { handleDeleteRequest, isDeleteRequest } from './data-deletion.js';
import { planDmRescue } from './flows/dm-rescue.js';
import { planTextReply } from './flows/text-reply.js';
import { MetaApiError } from './meta/client.js';
import { parseWebhook, type InstagramEvent } from './meta/parse.js';
import type { Sender } from './sender.js';
import type { EchoWatcher } from './setter/echoes.js';
import { FLOW_HANDLED_NOTE, type SetterService } from './setter/service.js';
import type { Store } from './store.js';

export interface ProcessDeps {
  readonly store: Store;
  readonly sender: Sender;
  readonly random?: () => number;
  /** Setter IA: recibe los DMs de las personas (Fase 3). `record` solo los guarda (cuando responde el flujo). */
  readonly setter?: Pick<SetterService, 'onIncoming' | 'record'>;
  /** Ecos de lo que sale de la cuenta: si no es nuestro, Jose escribió a mano y la IA se para. */
  readonly echoes?: Pick<EchoWatcher, 'onEcho'>;
  /** Para el segundo barrido del borrado (pruebas). Por defecto setTimeout. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof MetaApiError) return { message: error.message, status: error.status, body: error.body };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

function logOnly(event: InstagramEvent): string {
  switch (event.kind) {
    case 'message':
      return event.isEcho || event.senderId === event.accountId
        ? 'Mensaje enviado desde tu cuenta (eco).'
        : 'DM recibido: pasa al setter IA (responde solo si está activo para esta persona).';
    case 'standby':
      return 'STANDBY: otra app (p. ej. ManyChat) es dueña de esta conversación. Solo registro.';
    case 'receipt':
      return event.receipt === 'read' ? 'Aviso de "leído". Solo registro.' : 'Reacción a un mensaje. Solo registro.';
    case 'other':
      return `Aviso de tipo "${event.field}". Solo registro.`;
    default:
      return 'Solo registro.';
  }
}

async function planFor(event: InstagramEvent, deps: ProcessDeps): Promise<Plan | null> {
  if (event.kind === 'comment') return planComment(await deps.store.listFlows(), event, deps.random);
  if (event.kind === 'postback') return planPostback(await deps.store.listFlows(), event);
  // DM de una persona: un "sí" al mensaje del flujo cuenta como pulsar su botón; si su DM al comentario
  // no salió, el flujo le manda su primer mensaje (plan B); cualquier otro texto es para el setter.
  if (event.kind === 'message' && !event.isEcho && event.senderId !== event.accountId) {
    return (await planTextReply(event, deps.store)) ?? (await planDmRescue(event, deps.store));
  }
  return null;
}

/** Guarda o actualiza a la persona en contactos (base de la Fase 4). Nunca la propia cuenta. */
async function touchContact(event: InstagramEvent, store: Store): Promise<void> {
  if (event.kind === 'comment' && event.fromId !== event.accountId) {
    // Se apunta de qué reel viene cada persona, aunque ningún flujo salte.
    await store.touchContact(event.fromId, event.fromUsername, event.mediaId);
    await store.recordComment({
      commentId: event.commentId,
      igId: event.fromId,
      username: event.fromUsername,
      mediaId: event.mediaId,
      text: event.text,
    });
  } else if ((event.kind === 'postback' || (event.kind === 'message' && !event.isEcho)) && event.senderId !== event.accountId) {
    await store.touchContact(event.senderId, null);
  }
}

/** DM de una persona → setter IA. Eco de la cuenta → vigilante de ecos. Los botones (postback) son del flujo. */
async function routeMessage(event: InstagramEvent, deps: ProcessDeps): Promise<void> {
  if (event.kind !== 'message') return;
  if (event.isEcho) {
    deps.echoes?.onEcho(event);
    return;
  }
  if (event.senderId === event.accountId) return;
  await deps.setter?.onIncoming(event);
}

async function handleEvent(event: InstagramEvent, deps: ProcessDeps): Promise<void> {
  // "BORRAR" va antes que nada: no se guarda, no responde el setter y se borra todo lo de esa persona.
  if (event.kind === 'message' && !event.isEcho && event.senderId !== event.accountId && isDeleteRequest(event.text)) {
    await handleDeleteRequest(event, deps);
    return;
  }
  await touchContact(event, deps.store);
  const plan = await planFor(event, deps);
  if (!plan) {
    await deps.store.logEvent(event.kind, logOnly(event), event);
    await routeMessage(event, deps);
    return;
  }
  await deps.store.logEvent(event.kind, plan.note, event);
  // Respondió el flujo: el DM se guarda en la conversación, pero el setter no contesta.
  if (event.kind === 'message') await deps.setter?.record(event, FLOW_HANDLED_NOTE);
  if (plan.actions.length === 0) return;
  const commentId = event.kind === 'comment' ? event.commentId : null;
  if (!(await claimOnce(plan, deps.store, commentId))) return;
  await deps.sender.enqueue(plan.actions);
}

/**
 * "Una vez por persona": reserva la clave (guardando qué comentario la usó).
 * Devuelve false si la persona ya recibió este flujo por OTRO comentario.
 * Si la clave es de este mismo comentario (p. ej. su DM nunca salió), deja reintentar.
 */
async function claimOnce(plan: Plan, store: Store, commentId: string | null): Promise<boolean> {
  if (!plan.onceKey) return true;
  if (await store.claimAction(plan.onceKey, 'once', { flowId: plan.flowId, commentId })) {
    // Se marca como hecha para que no aparezca "en curso" en el panel.
    await store.finishAction(plan.onceKey, true, { flowId: plan.flowId, commentId });
    return true;
  }
  const existing = await store.getAction(plan.onceKey);
  const sameComment = commentId !== null && (existing?.request as { commentId?: unknown } | null)?.commentId === commentId;
  if (sameComment) return true;
  await store.logEvent('duplicado', 'Esta persona ya recibió este flujo: no se repite (una vez por persona).', { onceKey: plan.onceKey });
  return false;
}

/** Meta permite la respuesta privada hasta 7 días después del comentario. Margen de 1 hora. */
const RESCUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

type CommentEvent = Extract<InstagramEvent, { kind: 'comment' }>;

function isCommentEvent(value: unknown): value is CommentEvent {
  const v = value as Partial<CommentEvent> | null;
  return !!v && v.kind === 'comment' && typeof v.commentId === 'string' && typeof v.fromId === 'string' && typeof v.accountId === 'string';
}

export interface RescueResult {
  readonly queued: number;
  readonly skipped: number;
  readonly since: string;
}

/**
 * Rescate: a los comentarios desde `since` que no recibieron respuesta privada, se les aplica el flujo
 * que corresponda ahora (respuesta pública + DM), con la cola y las protecciones anti-ban de siempre.
 */
export async function rescueComments(since: Date, deps: ProcessDeps, now: Date = new Date()): Promise<RescueResult> {
  const oldest = new Date(now.getTime() - RESCUE_MAX_AGE_MS);
  const from = since < oldest ? oldest : since;
  const [rows, flows] = await Promise.all([deps.store.unansweredCommentEvents(from), deps.store.listFlows()]);
  let queued = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!isCommentEvent(row)) {
      skipped += 1;
      continue;
    }
    const plan = planComment(flows, row, deps.random);
    if (plan.actions.length === 0 || !(await claimOnce(plan, deps.store, row.commentId))) {
      skipped += 1;
      continue;
    }
    await deps.store.logEvent('rescate', `Rescate: ${plan.note}`, { commentId: row.commentId, from: row.fromUsername });
    void deps.sender.enqueue(plan.actions);
    queued += 1;
  }
  return { queued, skipped, since: from.toISOString() };
}

/** Procesa un evento suelto (p. ej. un comentario recuperado tras un reinicio) igual que si viniera en un aviso de Meta. */
export async function processEvent(event: InstagramEvent, deps: ProcessDeps): Promise<void> {
  await handleEvent(event, deps);
}

export async function processWebhook(payload: unknown, deps: ProcessDeps): Promise<void> {
  const events = parseWebhook(payload);
  if (events.length === 0) {
    await deps.store.logEvent('vacio', 'Aviso sin eventos reconocibles.', payload);
    return;
  }
  for (const event of events) {
    await handleEvent(event, deps);
  }
}

/** Versión segura para lanzar sin esperar: nunca deja un error sin registrar. */
export function processInBackground(payload: unknown, deps: ProcessDeps): void {
  processWebhook(payload, deps).catch(async (error: unknown) => {
    try {
      await deps.store.logEvent('error', 'Fallo procesando el aviso.', describeError(error));
    } catch (logError) {
      process.stderr.write(`[setter-ai] No se pudo registrar el error: ${String(logError)} | original: ${String(error)}\n`);
    }
  });
}
