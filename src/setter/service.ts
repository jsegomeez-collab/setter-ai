import type { Action } from '../flows/engine.js';
import type { InstagramEvent } from '../meta/parse.js';
import { SETTINGS, type Store } from '../store.js';
import type { BrainUsage, SetterBrain } from './brain.js';
import { checkReply } from './guards.js';
import { NO_TEXT_PLACEHOLDER, buildSystemPrompt, toClaudeTurns, type SetterLinks } from './prompt.js';
import type { SetterOutput } from './schema.js';

/**
 * El setter IA de cada conversación:
 * 1. guarda cada DM entrante;
 * 2. espera unos segundos por si la persona manda varios mensajes seguidos;
 * 3. comprueba que puede responder (modo, pausa de esa conversación, usuarios de prueba);
 * 4. pide a Claude respuesta + ficha, guarda la ficha y envía por la cola de seguimientos
 *    (mismos límites anti-ban que los flujos). Si algo falla, NO envía: retiene y para la IA para Jose.
 */

export const DEFAULT_DEBOUNCE_MS = 8000;
const HISTORY_LIMIT = 40;
export const SETTER_FLOW_ID = 'setter';
const LOG_KIND = 'setter';

export type SetterMode = 'off' | 'test' | 'live';
type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;

export interface SetterServiceOptions {
  readonly store: Store;
  /** null = falta ANTHROPIC_API_KEY: se guardan los mensajes pero no se responde. */
  readonly brain: SetterBrain | null;
  readonly links: SetterLinks;
  /** Sender.enqueue: se cumple cuando el envío terminó (bien o mal). */
  readonly enqueue: (actions: readonly Action[]) => Promise<void>;
  readonly getUsername: (igId: string) => Promise<string | null>;
  readonly debounceMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export function parseUsernames(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((name) => name.trim().replace(/^@/, '').toLowerCase())
    .filter((name) => name.length > 0);
}

export async function readSetterMode(store: Store): Promise<SetterMode> {
  const value = await store.getSetting(SETTINGS.setterMode);
  return value === 'test' || value === 'live' ? value : 'off';
}

function messageIdOf(response: unknown): string | null {
  const id = (response as { messageId?: unknown } | null)?.messageId;
  return typeof id === 'string' ? id : null;
}

export class SetterService {
  private readonly timers = new Map<string, unknown>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly debounceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: SetterServiceOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** DM de una persona (no eco). Se guarda siempre; la respuesta espera por si escribe más. */
  async onIncoming(event: MessageEvent): Promise<void> {
    await this.options.store.addMessage({
      igId: event.senderId,
      direction: 'in',
      source: 'user',
      text: event.text ?? NO_TEXT_PLACEHOLDER,
      mid: event.mid,
      status: 'sent',
      dedupKey: null,
    });
    this.scheduleReply(event.senderId);
  }

  /** Responde ya. Va en fila por persona: nunca dos respuestas a la vez en la misma conversación. */
  replyNow(igId: string): Promise<void> {
    const previous = this.chains.get(igId) ?? Promise.resolve();
    const run = previous
      .then(() => this.reply(igId))
      .catch((error: unknown) => this.log('Fallo inesperado del setter.', { igId, error: error instanceof Error ? error.message : String(error) }))
      .catch(() => undefined);
    this.chains.set(igId, run);
    return run;
  }

  /** Espera a que terminen las respuestas en curso (pruebas y apagado). */
  async idle(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  private scheduleReply(igId: string): void {
    const existing = this.timers.get(igId);
    if (existing !== undefined) this.clearTimer(existing);
    const handle = this.setTimer(() => {
      this.timers.delete(igId);
      void this.replyNow(igId);
    }, this.debounceMs);
    this.timers.set(igId, handle);
  }

  private async reply(igId: string): Promise<void> {
    const { store, brain, links } = this.options;
    if (!brain) return this.log('Setter sin ANTHROPIC_API_KEY: el mensaje se guarda pero no se responde.', { igId });
    const blocked = await this.blockedReason(igId);
    if (blocked) return blocked === 'off' ? undefined : this.log(blocked, { igId });
    const knowledge = await store.getKnowledge();
    if (!knowledge) return this.log('No hay documento del setter cargado: no se responde.', { igId });
    const history = await store.listMessages(igId, HISTORY_LIMIT);
    const last = history.at(-1);
    // Ya se contestó (o escribió Jose) después. La respuesta se guarda antes de enviarse, así que esto
    // evita contestar dos veces; además la cola nunca envía dos veces la misma clave ai:<mid>.
    if (!last || last.direction !== 'in') return;
    const dedupKey = `ai:${last.mid ?? last.id}`;
    const turns = toClaudeTurns(history);
    const result = await brain.decide(buildSystemPrompt(knowledge.text, links, turns.earlyAccountMessages), turns.messages);
    if (result.kind !== 'ok') {
      return this.stop(igId, `${result.kind === 'refusal' ? 'Claude rechazó responder' : 'Fallo al llamar a Claude'}: ${result.detail}`);
    }
    await store.saveLead(igId, result.output.lead);
    await this.deliver(igId, dedupKey, result.output, result.usage);
  }

  /** Motivo por el que NO se responde (null = se puede). 'off' = apagado, sin registrar nada. */
  private async blockedReason(igId: string): Promise<string | null> {
    const { store } = this.options;
    const mode = await readSetterMode(store);
    if (mode === 'off') return 'off';
    const contact = await store.getContact(igId);
    if (contact?.aiPaused) return `IA parada en esta conversación: ${contact.aiPausedReason ?? 'sin motivo'}.`;
    if (mode === 'live') return null;
    const allowed = parseUsernames(await store.getSetting(SETTINGS.setterTestUsernames));
    const username = contact?.username ?? (await this.lookupUsername(igId));
    if (username && allowed.includes(username.toLowerCase())) return null;
    return `Modo prueba: @${username ?? 'desconocido'} no está en la lista de usuarios de prueba.`;
  }

  private async lookupUsername(igId: string): Promise<string | null> {
    const username = await this.options.getUsername(igId);
    if (username) await this.options.store.touchContact(igId, username);
    return username;
  }

  private async deliver(igId: string, dedupKey: string, output: SetterOutput, usage: BrainUsage): Promise<void> {
    const { store, links } = this.options;
    const text = output.reply.trim();
    const facts = { igId, usage, siguientePaso: output.lead.siguiente_paso, needsHuman: output.needs_human };
    if (text.length === 0) {
      await this.log('La IA decidió no responder.', facts);
    } else {
      const guard = checkReply(text, { urls: [links.agenda, links.membership], emails: [links.contactEmail] });
      if (!guard.ok) {
        await store.addMessage({ igId, direction: 'out', source: 'ai', text, mid: null, status: 'held', dedupKey, note: guard.reasons.join(' · ') });
        return this.stop(igId, `Respuesta retenida: ${guard.reasons.join(' · ')}`);
      }
      if ((await store.getSetting(SETTINGS.setterDraft)) === 'true') {
        await store.addMessage({ igId, direction: 'out', source: 'ai', text, mid: null, status: 'held', dedupKey, note: 'Modo borrador: pendiente de aprobar' });
        await this.log('Modo borrador: respuesta retenida para aprobar.', facts);
      } else {
        await this.log('Respuesta de la IA en cola.', facts);
        await this.send(igId, dedupKey, text);
      }
    }
    if (output.needs_human) await this.stop(igId, `La IA pide que intervenga Jose: ${output.needs_human_reason ?? 'sin motivo'}`);
    else if (output.lead.es_menor === 'si') await this.stop(igId, 'Posible menor de edad.');
  }

  private async send(igId: string, dedupKey: string, text: string): Promise<void> {
    const { store } = this.options;
    await store.addMessage({ igId, direction: 'out', source: 'ai', text, mid: null, status: 'queued', dedupKey });
    const action: Action = {
      type: 'send_message',
      dedupKey,
      recipientId: igId,
      message: { text, buttons: [], flowId: SETTER_FLOW_ID, nodeId: 'reply', recipientId: igId },
    };
    await this.options.enqueue([action]);
    const done = await store.getAction(dedupKey);
    if (done?.ok === true) await store.setMessageStatus(dedupKey, 'sent', messageIdOf(done.response));
    else if (done?.ok === false) await store.setMessageStatus(dedupKey, 'failed');
  }

  private async stop(igId: string, reason: string): Promise<void> {
    await this.options.store.setAiPaused(igId, true, reason);
    await this.log(`IA parada en esta conversación. ${reason}`, { igId });
  }

  private async log(note: string, data: unknown): Promise<void> {
    await this.options.store.logEvent(LOG_KIND, note, data);
  }
}
