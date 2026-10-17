import type { SendDelays, SendLimits } from './config.js';
import { planAfterFollowCheck, planNode, encodePayload, type Action, type OutMessage } from './flows/engine.js';
import type { Flow } from './flows/types.js';
import { buttonUrl, type LinkSigner } from './links.js';
import { MetaApiError, type ApiMessage, type InstagramClient } from './meta/client.js';
import type { JobPayload } from './scheduler.js';
import { SETTINGS, type Store } from './store.js';

/**
 * Ejecuta acciones contra Instagram con protecciones anti-ban y sin perder a nadie:
 * - dos colas: "comments" (respuesta pública + primer DM) y "followups" (botones, condiciones, pausas),
 *   para que un pico de comentarios no retrase las respuestas a quien pulsa un botón;
 * - cada acción se RESERVA en la base de datos al encolarla (no se envía dos veces y, si el servidor
 *   se reinicia, las pendientes se retoman con recover());
 * - límites por hora por tipo (pegados a los de Meta) → si se alcanzan, la cola ESPERA, no descarta;
 * - esperas aleatorias entre envíos;
 * - error 368 de Meta (bloqueo por política) → pausa TODO 24 h (la cola espera, no descarta);
 * - la respuesta pública solo se publica si el DM salió bien (campo `requires`).
 */

const POLICY_BLOCK_CODE = 368;
const PAUSE_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_THROTTLE_CHECK_MS = 30_000;

type Lane = 'comments' | 'followups';
const COMMENT_TYPES = new Set<Action['type']>(['reply_comment', 'private_reply']);
const laneOf = (action: Action): Lane => (COMMENT_TYPES.has(action.type) ? 'comments' : 'followups');

export interface SenderOptions {
  readonly store: Store;
  readonly client: InstagramClient | null;
  readonly limits: SendLimits;
  readonly delays: SendDelays;
  /** Firma de enlaces con seguimiento. null = los botones llevan la URL real (sin registrar clics ni etiquetas). */
  readonly linkSigner?: LinkSigner | null;
  /** Inicio del setter (SetterService.openConversation). Sin él, el paso se omite. */
  readonly openSetter?: (recipientId: string, texts: readonly string[], dedupKey: string) => Promise<unknown>;
  /** Programa una pausa (Scheduler.add). */
  readonly schedule?: (payload: JobPayload, delaySeconds: number) => Promise<boolean>;
  /** Cada cuánto se vuelve a mirar si ya hay hueco (límite por hora o pausa). */
  readonly throttleCheckMs?: number;
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

function isAction(value: unknown): value is Action {
  const v = value as Partial<Action> | null;
  return !!v && typeof v.type === 'string' && typeof v.dedupKey === 'string';
}

export class Sender {
  private readonly chains: Record<Lane, Promise<void>> = { comments: Promise.resolve(), followups: Promise.resolve() };
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly throttleCheckMs: number;

  constructor(
    private readonly options: SenderOptions,
    private readonly getFlow: (flowId: string) => Promise<Flow | undefined>,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.throttleCheckMs = options.throttleCheckMs ?? DEFAULT_THROTTLE_CHECK_MS;
  }

  /** Reserva y encola acciones. Se cumple cuando se han ejecutado todas. */
  async enqueue(actions: readonly Action[]): Promise<void> {
    const runs: Promise<void>[] = [];
    for (const action of actions) {
      if (!(await this.options.store.claimAction(action.dedupKey, action.type, action))) {
        await this.options.store.logEvent('duplicado', 'Acción ya hecha antes: no se repite.', action);
        continue;
      }
      runs.push(this.push(action));
    }
    await Promise.all(runs);
  }

  /** Retoma acciones reservadas que no llegaron a terminar (p. ej. por un reinicio). */
  async recover(): Promise<number> {
    const pending = (await this.options.store.pendingActions()).filter(isAction);
    for (const action of pending) void this.push(action);
    return pending.length;
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

  /** Espera a que las dos colas queden vacías (para pruebas y apagado ordenado). */
  async idle(): Promise<void> {
    let snapshot: Promise<void>[];
    do {
      snapshot = [this.chains.comments, this.chains.followups];
      await Promise.all(snapshot);
    } while (snapshot[0] !== this.chains.comments || snapshot[1] !== this.chains.followups);
  }

  private push(action: Action): Promise<void> {
    const lane = laneOf(action);
    const run = this.chains[lane].then(() => this.runSafely(action));
    this.chains[lane] = run.catch(() => undefined);
    return run;
  }

  private async runSafely(action: Action): Promise<void> {
    try {
      await this.run(action);
    } catch (error) {
      await this.options.store.finishAction(action.dedupKey, false, describeError(error)).catch(() => undefined);
      await this.options.store.logEvent('error', `Fallo inesperado ejecutando ${action.type}.`, describeError(error));
    }
  }

  private async pausedUntil(): Promise<Date | null> {
    const value = await this.options.store.getSetting(SETTINGS.pausedUntil);
    const date = value ? new Date(value) : null;
    return date && date.getTime() > this.now().getTime() ? date : null;
  }

  /** Si hay pausa (error 368), espera a que termine. No descarta nada. */
  private async waitWhilePaused(action: Action): Promise<void> {
    let logged = false;
    for (let paused = await this.pausedUntil(); paused; paused = await this.pausedUntil()) {
      if (!logged) {
        await this.options.store.logEvent('pausado', `Envíos pausados hasta ${paused.toISOString()}: ${action.type} espera.`, { dedupKey: action.dedupKey });
        logged = true;
      }
      await this.sleep(this.throttleCheckMs);
    }
  }

  private limitFor(type: Action['type']): { readonly types: readonly string[]; readonly limit: number } | null {
    const { limits } = this.options;
    if (type === 'private_reply') return { types: ['private_reply'], limit: limits.privateReplies };
    if (type === 'reply_comment') return { types: ['reply_comment'], limit: limits.publicReplies };
    if (type === 'send_message') return { types: ['send_message', 'send_dm'], limit: limits.followUps };
    return null;
  }

  /** Si se alcanzó el límite por hora de este tipo, espera a que haya hueco. No descarta nada. */
  private async waitForCapacity(action: Action): Promise<void> {
    const rule = this.limitFor(action.type);
    if (!rule) return;
    let logged = false;
    // La acción actual ya está reservada y cuenta en el total: hay hueco mientras total <= límite.
    while ((await this.options.store.countSendsSince(new Date(this.now().getTime() - HOUR_MS), rule.types)) > rule.limit) {
      if (!logged) {
        await this.options.store.logEvent('limite', `Límite de ${rule.limit}/h de ${action.type} alcanzado: en espera (no se pierde).`, { dedupKey: action.dedupKey });
        logged = true;
      }
      await this.sleep(this.throttleCheckMs);
    }
  }

  private async randomDelay(action: Action): Promise<void> {
    if (!this.limitFor(action.type)) return; // condiciones y pausas no envían nada a la persona
    const { delays } = this.options;
    const [min, max] = laneOf(action) === 'comments' ? [delays.commentMin, delays.commentMax] : [delays.followUpMin, delays.followUpMax];
    await this.sleep(min + Math.floor(this.random() * Math.max(0, max - min)));
  }

  private async run(action: Action): Promise<void> {
    const { store, client } = this.options;
    if (!client) {
      await store.finishAction(action.dedupKey, false, { error: 'Falta el token de Instagram' });
      await store.logEvent('error', 'No se envió nada: falta el token de Instagram.', action);
      return;
    }
    await this.waitWhilePaused(action);
    if (action.type === 'reply_comment' && action.requires) {
      const required = await store.getAction(action.requires);
      if (required?.ok !== true) {
        await store.finishAction(action.dedupKey, false, { skipped: 'El DM no salió: no se publica "mira tus DMs".' });
        return;
      }
    }
    await this.waitForCapacity(action);
    await this.randomDelay(action);
    try {
      const result = await this.execute(action, client);
      await store.finishAction(action.dedupKey, true, result);
    } catch (error) {
      await store.finishAction(action.dedupKey, false, describeError(error));
      const policyBlock = error instanceof MetaApiError && error.code === POLICY_BLOCK_CODE;
      if (action.type === 'private_reply' && action.failReply && !policyBlock) {
        // Plan B: el DM no salió (ni como texto) → respuesta pública pidiendo que nos escriban. Una vez por comentario.
        // Se encola detrás (no se espera aquí, para no bloquear la cola dentro de sí misma).
        void this.enqueue([{ type: 'reply_comment', dedupKey: `reply-fail:${action.commentId}`, commentId: action.commentId, text: action.failReply }]);
      }
      if (policyBlock && error instanceof MetaApiError) {
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
      case 'setter_opener':
        return this.openSetter(action);
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
        // 2534025 también se reintenta: con datos reales (2026-10-16) el mismo comentario y el mismo mensaje
        // salen para unas personas y no para otras, así que no está demostrado que el texto también falle.
        error.code !== POLICY_BLOCK_CODE;
      if (!canFallBack) throw error;
      // Meta no aceptó los botones en la respuesta privada: se manda solo texto (con los enlaces) y se deja constancia.
      try {
        const result = await client.sendPrivateReply(action.commentId, toPlainFallback(action.message, this.signer));
        return { fallback: 'solo texto (Meta rechazó los botones)', firstError: describeError(error), result };
      } catch (fallbackError) {
        await this.options.store.logEvent('respaldo', 'Reintento con solo texto: Meta también lo rechazó.', {
          commentId: action.commentId,
          firstError: describeError(error),
          fallbackError: describeError(fallbackError),
        });
        throw fallbackError;
      }
    }
  }

  private openSetter(action: Extract<Action, { type: 'setter_opener' }>): unknown {
    const { openSetter } = this.options;
    if (!openSetter) return { skipped: 'Setter sin conectar' };
    // No se espera: el setter envía por esta misma cola y esperarle aquí la bloquearía (igual que checkFollow).
    void openSetter(action.recipientId, action.texts, action.dedupKey).catch((error: unknown) =>
      this.options.store.logEvent('error', 'Fallo en el inicio del setter.', { message: error instanceof Error ? error.message : String(error) }).catch(() => undefined),
    );
    return { started: true };
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
