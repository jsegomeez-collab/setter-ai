import type { InstagramEvent } from '../meta/parse.js';
import type { Store } from '../store.js';
import { readSetterMode } from './service.js';

/**
 * "Si Jose escribe a mano, la IA se calla" (decisión de Jose: hasta que la reanude en el panel).
 * Meta manda un eco (is_echo) por cada mensaje que sale de la cuenta (doc Webhooks: "is_echo set to true
 * is included when the message was sent by your app user"). Si el id del eco es de un envío nuestro
 * (flujo o IA) → no es Jose. Si no aparece → lo escribió Jose a mano → se para la IA en esa conversación.
 * El envío y su eco pueden cruzarse, así que se mira varias veces antes de decidir.
 */

export const DEFAULT_ECHO_CHECKS_MS: readonly number[] = [5_000, 10_000, 15_000];
export const HUMAN_PAUSE_REASON = 'Jose escribió a mano';
const NO_TEXT_FLOW = '[Mensaje del flujo sin texto (botones o adjunto)]';
const NO_TEXT_HUMAN = '[Jose envió algo sin texto (foto, audio o adjunto)]';

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;

export interface EchoWatcherOptions {
  readonly store: Store;
  /** Esperas antes de cada comprobación (por defecto 5 s, luego 10 s y 15 s más). */
  readonly checksMs?: readonly number[];
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

export class EchoWatcher {
  private readonly checksMs: readonly number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: EchoWatcherOptions) {
    this.checksMs = options.checksMs ?? DEFAULT_ECHO_CHECKS_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  /** Eco de un mensaje que salió de la cuenta hacia `recipientId`. */
  onEcho(event: MessageEvent): void {
    if (!event.recipientId) return;
    this.later(event, 0);
  }

  /** Espera a las comprobaciones ya lanzadas (pruebas). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private later(event: MessageEvent, attempt: number): void {
    this.setTimer(() => {
      const run = this.check(event, attempt)
        .catch((error: unknown) =>
          this.options.store.logEvent('error', 'Fallo revisando un eco.', { mid: event.mid, error: error instanceof Error ? error.message : String(error) }),
        )
        .catch(() => undefined)
        .finally(() => this.pending.delete(run));
      this.pending.add(run);
    }, this.checksMs[attempt] ?? 0);
  }

  private async check(event: MessageEvent, attempt: number): Promise<void> {
    const { store } = this.options;
    const igId = event.recipientId;
    const action = await store.findActionByMessageId(event.mid);
    if (action) {
      // Lo de la IA ya está guardado (con su id). Lo del flujo se guarda aquí para tener el historial completo.
      if (action.dedupKey.startsWith('ai:')) return;
      await store.addMessage({ igId, direction: 'out', source: 'flow', text: event.text ?? NO_TEXT_FLOW, mid: event.mid, status: 'sent', dedupKey: action.dedupKey });
      return;
    }
    if (attempt + 1 < this.checksMs.length) return this.later(event, attempt + 1);
    await store.addMessage({ igId, direction: 'out', source: 'human', text: event.text ?? NO_TEXT_HUMAN, mid: event.mid, status: 'sent', dedupKey: null });
    // Con el setter apagado no se para nada: mientras ManyChat siga conectado, sus mensajes también
    // llegan como ecos ajenos y dejarían paradas conversaciones que la IA nunca tocó (decisión de Jose).
    if ((await readSetterMode(store)) === 'off') return;
    await store.setAiPaused(igId, true, HUMAN_PAUSE_REASON);
    await store.logEvent('setter', `IA parada en esta conversación: ${HUMAN_PAUSE_REASON}.`, { igId, mid: event.mid });
  }
}
