import { decide, type Action, type DecisionContext } from './decide.js';
import { InstagramClient, MetaApiError } from './meta/client.js';
import { parseWebhook } from './meta/parse.js';
import { SETTINGS, type Store } from './store.js';

export interface ProcessDeps {
  readonly store: Store;
  readonly client: InstagramClient | null;
  /** Remitentes autorizados desde la variable de entorno ALLOWED_SENDER_IDS. */
  readonly envAllowedSenderIds: readonly string[];
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof MetaApiError) return { message: error.message, status: error.status, body: error.body };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

async function loadContext(store: Store, envAllowed: readonly string[]): Promise<DecisionContext> {
  const [testMediaId, dmEnabled, allowed] = await Promise.all([
    store.getSetting(SETTINGS.testMediaId),
    store.getSetting(SETTINGS.dmRepliesEnabled),
    store.listAllowedSenders(),
  ]);
  return {
    testMediaId,
    dmRepliesEnabled: dmEnabled === 'true',
    allowedSenderIds: new Set([...envAllowed, ...allowed]),
  };
}

async function runAction(action: Action, client: InstagramClient): Promise<unknown> {
  switch (action.type) {
    case 'reply_comment':
      return client.replyToComment(action.commentId, action.text);
    case 'private_reply':
      return client.sendPrivateReply(action.commentId, action.text);
    case 'send_dm':
      return client.sendText(action.recipientId, action.text);
  }
}

async function executeAction(action: Action, deps: ProcessDeps): Promise<void> {
  const { store, client } = deps;
  if (!client) {
    await store.logEvent('error', 'No se envió nada: falta IG_ACCESS_TOKEN.', action);
    return;
  }
  const claimed = await store.claimAction(action.dedupKey, action.type, action);
  if (!claimed) {
    await store.logEvent('duplicado', 'Acción ya hecha antes (aviso repetido de Meta): no se repite.', action);
    return;
  }
  try {
    const result = await runAction(action, client);
    await store.finishAction(action.dedupKey, true, result);
    // Quien recibe nuestro DM privado queda autorizado para que la prueba de respuesta por DM funcione.
    const recipientId = (result as { recipientId?: string | null } | null)?.recipientId;
    if (action.type === 'private_reply' && recipientId) {
      await store.allowSender(recipientId);
    }
  } catch (error) {
    await store.finishAction(action.dedupKey, false, describeError(error));
  }
}

export async function processWebhook(payload: unknown, deps: ProcessDeps): Promise<void> {
  const events = parseWebhook(payload);
  if (events.length === 0) {
    await deps.store.logEvent('vacio', 'Aviso sin eventos reconocibles.', payload);
    return;
  }
  for (const event of events) {
    const ctx = await loadContext(deps.store, deps.envAllowedSenderIds);
    const decision = decide(event, ctx);
    await deps.store.logEvent(event.kind, decision.note, event);
    if (event.kind === 'comment' && decision.actions.length > 0) {
      await deps.store.allowSender(event.fromId);
    }
    for (const action of decision.actions) {
      await executeAction(action, deps);
    }
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
