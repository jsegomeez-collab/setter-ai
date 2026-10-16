import { planComment, planPostback, type Plan } from './flows/engine.js';
import { MetaApiError } from './meta/client.js';
import { parseWebhook, type InstagramEvent } from './meta/parse.js';
import type { Sender } from './sender.js';
import type { Store } from './store.js';

export interface ProcessDeps {
  readonly store: Store;
  readonly sender: Sender;
  readonly random?: () => number;
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
        : 'DM recibido. Solo registro (el setter IA llega en la Fase 3).';
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
  return null;
}

async function handleEvent(event: InstagramEvent, deps: ProcessDeps): Promise<void> {
  const plan = await planFor(event, deps);
  if (!plan) {
    await deps.store.logEvent(event.kind, logOnly(event), event);
    return;
  }
  await deps.store.logEvent(event.kind, plan.note, event);
  if (plan.actions.length === 0) return;
  if (plan.onceKey && !(await deps.store.claimAction(plan.onceKey, 'once', { flowId: plan.flowId }))) {
    await deps.store.logEvent('duplicado', 'Esta persona ya recibió este flujo: no se repite (una vez por persona).', { onceKey: plan.onceKey });
    return;
  }
  await deps.sender.enqueue(plan.actions);
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
