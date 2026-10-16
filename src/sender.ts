import { planAfterFollowCheck, planNode, encodePayload, type Action, type OutMessage } from './flows/engine.js';
import type { Flow } from './flows/types.js';
import { buttonUrl, type LinkSigner } from './links.js';
import { MetaApiError, type ApiMessage, type InstagramClient } from './meta/client.js';
import type { JobPayload } from './scheduler.js';
import { SETTINGS, type Store } from './store.js';

/**
 * Ejecuta acciones contra Instagram con protecciones anti-ban:
 * - cola: un envío detrás de otro, nunca en paralelo;
 * - espera aleatoria entre envíos;
 * - límite propio de envíos por hora;
 * - si Meta responde con el error 368 (bloqueo por política), pausa TODO 24 h;
 * - cada acción se reserva antes de enviarse, así un aviso repetido nunca envía dos veces.
 */

const POLICY_BLOCK_CODE = 368;
const PAUSE_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SEND_TYPES = new Set<Action['type']>(['reply_comment', 'private_reply', 'send_message']);
// "schedule" y "check_follow" no envían nada a la persona: no cuentan para el límite ni esperan.

export interface SenderOptions {
  readonly store: Store;
  readonly client: InstagramClient | null;
  readonly limitPerHour: number;
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  /** Firma de enlaces con seguimiento. null = los botones llevan la URL real (sin registrar clics ni etiquetas). */
  readonly linkSigner?: LinkSigner | null;
  /** Programa una pausa (Scheduler.add). */
  readonly schedule?: (payload: JobPayload, delaySeconds: number) => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => Date;
}

export function toApiMessage(message: OutMessage, signer: LinkSigner | null = null): ApiMessage {
  if (message.buttons.length === 0) return { text: message.text };
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: message.text,
        buttons: message.buttons.map((button, index) =>
          button.type === 'url'
            ? { type: 'web_url' as const, url: buttonUrl(signer, message, index), title: button.title }
            : { type: 'postback' as const, payload: encodePayload(message.flowId, button.next), title: button.title },
        ),
      },
    },
  };
}

/** Versión solo texto (por si Meta no acepta botones en la respuesta privada): los enlaces van en el texto. */
export function toPlainFallback(message: OutMessage, signer: LinkSigner | null = null): string {
  const links = message.buttons.flatMap((button, index) => (button.type === 'url' ? [`${button.title}: ${buttonUrl(signer, message, index)}`] : []));
  return links.length > 0 ? `${message.text}\n\n${links.join('\n')}` : message.text;
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof MetaApiError) return { message: error.message, status: error.status, code: error.code, body: error.body };
  return { message: error instanceof Error ? error.message : String(error) };
}

export class Sender {
  private chain: Promise<void> = Promise.resolve();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => Date;

  constructor(
    private readonly options: SenderOptions,
    private readonly getFlow: (flowId: string) => Promise<Flow | undefined>,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  /** Añade acciones a la cola. Devuelve una promesa que se cumple cuando se han ejecutado. */
  enqueue(actions: readonly Action[]): Promise<void> {
    const run = this.chain.then(async () => {
      for (const action of actions) await this.runSafely(action);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Cuando vence una pausa: ejecuta el siguiente paso del flujo para esa persona. */
  async continueFlow(payload: JobPayload): Promise<unknown> {
    const flow = await this.getFlow(payload.flowId);
    if (!flow) return { skipped: 'El flujo ya no existe' };
    if (!flow.enabled) return { skipped: 'El flujo está desactivado' };
    const actions = planNode(flow, payload.nodeId, payload.recipientId, payload.dedupKey, payload.depth);
    void this.enqueue(actions);
    return { next: actions.map((action) => action.dedupKey) };
  }

  /** Espera a que la cola quede vacía (para pruebas y apagado ordenado). */
  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.chain;
      await current;
    } while (current !== this.chain);
  }

  private async runSafely(action: Action): Promise<void> {
    try {
      await this.run(action);
    } catch (error) {
      await this.options.store.logEvent('error', `Fallo inesperado ejecutando ${action.type}.`, describeError(error));
    }
  }

  private async pausedUntil(): Promise<Date | null> {
    const value = await this.options.store.getSetting(SETTINGS.pausedUntil);
    const date = value ? new Date(value) : null;
    return date && date.getTime() > this.now().getTime() ? date : null;
  }

  private async run(action: Action): Promise<void> {
    const { store, client } = this.options;
    if (!client) {
      await store.logEvent('error', 'No se envió nada: falta el token de Instagram.', action);
      return;
    }
    const paused = await this.pausedUntil();
    if (paused) {
      await store.logEvent('pausado', `Envíos pausados hasta ${paused.toISOString()}: no se envía ${action.type}.`, action);
      return;
    }
    if (!(await store.claimAction(action.dedupKey, action.type, action))) {
      await store.logEvent('duplicado', 'Acción ya hecha antes: no se repite.', action);
      return;
    }
    if (SEND_TYPES.has(action.type)) {
      // La acción actual ya está reservada y cuenta en el total.
      const sent = await store.countSendsSince(new Date(this.now().getTime() - HOUR_MS));
      if (sent > this.options.limitPerHour) {
        await store.finishAction(action.dedupKey, false, { skipped: `Límite de ${this.options.limitPerHour} envíos por hora alcanzado` });
        return;
      }
      const { minDelayMs, maxDelayMs } = this.options;
      await this.sleep(minDelayMs + Math.floor(this.random() * Math.max(0, maxDelayMs - minDelayMs)));
    }
    try {
      const result = await this.execute(action, client);
      await store.finishAction(action.dedupKey, true, result);
    } catch (error) {
      await store.finishAction(action.dedupKey, false, describeError(error));
      if (error instanceof MetaApiError && error.code === POLICY_BLOCK_CODE) {
        const until = new Date(this.now().getTime() + PAUSE_MS).toISOString();
        await store.setSetting(SETTINGS.pausedUntil, until);
        await store.setSetting(SETTINGS.pauseReason, `Error 368 de Meta: ${error.message}`);
        await store.logEvent('pausado', `Meta devolvió el error 368 (bloqueo por política). Todo pausado hasta ${until}.`, describeError(error));
      }
    }
  }

  private async execute(action: Action, client: InstagramClient): Promise<unknown> {
    switch (action.type) {
      case 'reply_comment':
        return client.replyToComment(action.commentId, action.text);
      case 'send_message':
        return client.sendMessage(action.recipientId, toApiMessage(action.message, this.signer));
      case 'private_reply':
        return this.privateReply(action, client);
      case 'check_follow':
        return this.checkFollow(action, client);
      case 'schedule':
        return this.schedule(action);
    }
  }

  private get signer(): LinkSigner | null {
    return this.options.linkSigner ?? null;
  }

  private async schedule(action: Extract<Action, { type: 'schedule' }>): Promise<unknown> {
    if (!this.options.schedule) throw new Error('No hay programador de pausas configurado');
    const { flowId, nodeId, recipientId, dedupKey, depth, delaySeconds } = action;
    const added = await this.options.schedule({ flowId, nodeId, recipientId, dedupKey, depth }, delaySeconds);
    return { scheduled: added, delaySeconds, next: nodeId };
  }

  private async privateReply(action: Extract<Action, { type: 'private_reply' }>, client: InstagramClient): Promise<unknown> {
    try {
      return await client.sendPrivateReply(action.commentId, toApiMessage(action.message, this.signer));
    } catch (error) {
      const canFallBack =
        action.message.buttons.length > 0 &&
        error instanceof MetaApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.code !== POLICY_BLOCK_CODE;
      if (!canFallBack) throw error;
      // Meta no aceptó los botones en la respuesta privada: se manda solo texto (con los enlaces) y se deja constancia.
      const result = await client.sendPrivateReply(action.commentId, toPlainFallback(action.message, this.signer));
      return { fallback: 'solo texto (Meta rechazó los botones)', firstError: describeError(error), result };
    }
  }

  private async checkFollow(action: Extract<Action, { type: 'check_follow' }>, client: InstagramClient): Promise<unknown> {
    const flow = await this.getFlow(action.flowId);
    if (!flow) return { skipped: 'El flujo ya no existe' };
    const follow = await client.getFollowStatus(action.recipientId);
    const next = planAfterFollowCheck(flow, action.nodeId, follow.status, action.recipientId, action.dedupKey, action.depth);
    // Se encola detrás (no se espera aquí, para no bloquear la cola dentro de sí misma).
    void this.enqueue(next);
    return { follow: follow.status, detail: follow.detail, next: next.map((item) => item.dedupKey) };
  }
}
