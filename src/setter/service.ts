import type { Action } from '../flows/engine.js';
import type { Button } from '../flows/types.js';
import type { InstagramEvent } from '../meta/parse.js';
import { SETTINGS, type MessageRow, type Store } from '../store.js';
import type { SetterBrain } from './brain.js';
import { decideChecked, type CheckedReply } from './reply.js';
import { AGENDA_BUTTON_TITLE } from './rules.js';
import { NO_TEXT_PLACEHOLDER, buildSystemPrompt, toClaudeTurns, type SetterLinks } from './prompt.js';

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
/** Nota de un DM que ya contestó el flujo ("sí" escrito o rescate por DM): el setter no lo responde. */
export const FLOW_HANDLED_NOTE = 'Lo contestó el flujo';
/** Nota de los mensajitos retenidos en modo borrador (los únicos que Jose puede enviar desde el panel). */
export const DRAFT_NOTE = 'Modo borrador: pendiente de aprobar';
/** Meta solo deja escribir dentro de las 24 h desde el último mensaje de la persona (doc, Fase 2). */
const META_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DraftResult = { readonly ok: true; readonly sent: number } | { readonly ok: false; readonly reason: string };
export type OpenResult = { readonly sent: boolean } | { readonly skipped: string };
export type DiscardResult = { readonly ok: true; readonly discarded: number } | { readonly ok: false; readonly reason: string };

/** El borrador pendiente: los mensajitos retenidos en modo borrador después del último mensaje de la persona. */
export function trailingDrafts(messages: readonly MessageRow[]): MessageRow[] {
  const lastIn = messages.map((m) => m.direction).lastIndexOf('in');
  return messages.slice(lastIn + 1).filter((m) => m.status === 'held' && m.note === DRAFT_NOTE && m.dedupKey !== null);
}
const NO_DRAFT = 'No hay ningún borrador pendiente en esta conversación.';
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
  /** Muestra "escribiendo…" (InstagramClient.sendTypingOn). Sin él, solo se espera. */
  readonly showTyping?: (igId: string) => Promise<void>;
  readonly debounceMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

/**
 * La agenda va en un BOTÓN, nunca como enlace en el texto (Fase 5, idea de Jose 2026-10-17): Meta rechazó un mensaje
 * con el enlace en texto (508/2534122 "Link can't be shared") mientras los botones con enlace salían bien.
 * El botón pasa por el seguimiento de siempre (clic + etiqueta "agenda").
 */

const MEMBERSHIP_BUTTON_TITLE = 'Ver membresía';
const AGENDA_ONLY_TEXT = 'Aquí puedes elegir el hueco que mejor te venga 👇';
const MEMBERSHIP_ONLY_TEXT = 'Aquí tienes la membresía 👇';

/** La agenda y la membresía (Stripe) salen como botones; el resto del mensajito, como texto. */
export function withLinkButtons(text: string, links: Pick<SetterLinks, 'agenda' | 'membership'>): { text: string; buttons: Button[]; stored: string } {
  const candidates: Button[] = [
    { type: 'url', title: AGENDA_BUTTON_TITLE, url: links.agenda, tags: ['agenda'] },
    { type: 'url', title: MEMBERSHIP_BUTTON_TITLE, url: links.membership, tags: ['membresia'] },
  ];
  const buttons = candidates.filter((b) => b.type === 'url' && text.includes(b.url));
  if (buttons.length === 0) return { text, buttons: [], stored: text };
  const rest = buttons.reduce((t, b) => (b.type === 'url' ? t.split(b.url).join(' ') : t), text).replace(/[ \t]+/g, ' ').trim();
  const body = rest.length > 0 ? rest : buttons[0]?.title === AGENDA_BUTTON_TITLE ? AGENDA_ONLY_TEXT : MEMBERSHIP_ONLY_TEXT;
  return { text: body, buttons, stored: `${body}\n${buttons.map((b) => `[Botón: ${b.title}]`).join(' ')}` };
}

/** Pausa antes de cada mensajito: unos 3-4 s según lo largo que sea, con algo de azar (lo pidió Jose). */
const TYPING_BASE_MS = 3000;
const TYPING_MS_PER_CHAR = 10;
const TYPING_MAX_EXTRA_MS = 1000;
const TYPING_JITTER_MS = 400;

export function typingDelayMs(text: string, random: number): number {
  return TYPING_BASE_MS + Math.min(text.length * TYPING_MS_PER_CHAR, TYPING_MAX_EXTRA_MS) + Math.floor(random * TYPING_JITTER_MS);
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
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: SetterServiceOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** DM de una persona (no eco). Se guarda siempre; la respuesta espera por si escribe más. */
  async onIncoming(event: MessageEvent): Promise<void> {
    await this.record(event);
    this.scheduleReply(event.senderId);
  }

  /**
   * Al arrancar: contesta las conversaciones cuyo último mensaje es de la persona y es de después de `since`
   * (p. ej. el servidor se reinició durante la espera de 8 s). Pasa por las mismas reglas que siempre. Devuelve cuántas.
   */
  async resumePending(since: Date): Promise<number> {
    const igIds = await this.options.store.pendingConversations(since);
    for (const igId of igIds) void this.replyNow(igId);
    return igIds.length;
  }

  /** Solo guarda el DM en la conversación, sin responder (p. ej. cuando el "sí" lo contesta el flujo: `FLOW_HANDLED_NOTE`). */
  async record(event: MessageEvent, note: string | null = null): Promise<void> {
    await this.options.store.addMessage({
      igId: event.senderId,
      direction: 'in',
      source: 'user',
      text: event.text ?? NO_TEXT_PLACEHOLDER,
      mid: event.mid,
      status: 'sent',
      dedupKey: null,
      note,
    });
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

  /** Jose aprueba el borrador desde el panel: se envía tal cual, mensajito a mensajito. Va en fila con las respuestas. */
  approveDraft(igId: string): Promise<DraftResult> {
    const run = (this.chains.get(igId) ?? Promise.resolve()).then(() => this.sendDraft(igId));
    this.chains.set(igId, run.then(() => undefined, () => undefined));
    return run;
  }

  /**
   * Inicio del setter (paso del flujo, Fase 5.4): la IA escribe primero uno de los textos fijos que aprobó Jose
   * (sin gastar en Claude). Mismas reglas que siempre y nunca a quien ya está hablando con el setter. Va en fila.
   */
  openConversation(igId: string, texts: readonly string[], key: string): Promise<OpenResult> {
    const run = (this.chains.get(igId) ?? Promise.resolve()).then(() => this.open(igId, texts, key));
    this.chains.set(igId, run.then(() => undefined, () => undefined));
    return run;
  }

  private async open(igId: string, texts: readonly string[], key: string): Promise<OpenResult> {
    const blocked = await this.blockedReason(igId);
    if (blocked) {
      if (blocked !== 'off') await this.log(`Inicio del setter omitido: ${blocked}`, { igId });
      return { skipped: blocked === 'off' ? 'Setter apagado.' : blocked };
    }
    const since = Date.now() - META_REPLY_WINDOW_MS;
    const talking = (await this.options.store.listMessages(igId, HISTORY_LIMIT)).some(
      (m) => m.createdAt.getTime() >= since && ((m.direction === 'out' && m.source === 'ai') || (m.direction === 'in' && m.note !== FLOW_HANDLED_NOTE)),
    );
    if (talking) {
      const reason = 'Inicio del setter omitido: ya está hablando con el setter (escribió o la IA le respondió en las últimas 24 h).';
      await this.log(reason, { igId });
      return { skipped: reason };
    }
    const text = texts[Math.min(texts.length - 1, Math.floor(this.random() * texts.length))] as string;
    await this.typeLikeHuman(igId, text);
    const sent = await this.send(igId, `opener:${key}`, text);
    await this.log(sent ? 'Inicio del setter enviado.' : 'Inicio del setter: Instagram no lo aceptó.', { igId });
    return { sent };
  }

  /** Jose descarta el borrador: no se envía. */
  async discardDraft(igId: string): Promise<DiscardResult> {
    const drafts = trailingDrafts(await this.options.store.listMessages(igId, HISTORY_LIMIT));
    if (drafts.length === 0) return { ok: false, reason: NO_DRAFT };
    for (const draft of drafts) await this.options.store.setMessageStatus(draft.dedupKey as string, 'discarded');
    await this.log('Borrador descartado por Jose.', { igId, messages: drafts.length });
    return { ok: true, discarded: drafts.length };
  }

  private async sendDraft(igId: string): Promise<DraftResult> {
    const history = await this.options.store.listMessages(igId, HISTORY_LIMIT);
    const drafts = trailingDrafts(history);
    if (drafts.length === 0) return { ok: false, reason: NO_DRAFT };
    const lastIn = [...history].reverse().find((m) => m.direction === 'in');
    if (!lastIn || Date.now() - lastIn.createdAt.getTime() > META_REPLY_WINDOW_MS) {
      return { ok: false, reason: 'Han pasado más de 24 h desde su último mensaje: Instagram no deja enviarlo. Descártalo.' };
    }
    for (const [i, draft] of drafts.entries()) {
      await this.typeLikeHuman(igId, draft.text);
      if (!(await this.send(igId, draft.dedupKey as string, draft.text, true))) {
        return { ok: false, reason: `Instagram no aceptó el mensajito ${i + 1}; los siguientes no se enviaron.` };
      }
    }
    await this.log('Borrador aprobado por Jose y enviado.', { igId, messages: drafts.length });
    return { ok: true, sent: drafts.length };
  }

  /** Al apagarse (SIGTERM del despliegue): contesta ya lo que esperaba los 8 s; si no, se perdería con el reinicio. */
  flushPending(): void {
    for (const [igId, handle] of this.timers) {
      this.clearTimer(handle);
      this.timers.delete(igId);
      void this.replyNow(igId);
    }
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
    if (!last || last.direction !== 'in' || last.note === FLOW_HANDLED_NOTE) return;
    const dedupKey = `ai:${last.mid ?? last.id}`;
    const turns = toClaudeTurns(history);
    const frame = await store.getKnowledge('frame');
    const system = buildSystemPrompt(knowledge.text, links, turns.earlyAccountMessages, frame?.text ?? null);
    const result = await decideChecked(brain, system, turns.messages, { urls: [links.agenda, links.membership], emails: [links.contactEmail] }, links);
    if (result.kind !== 'ok') {
      return this.stop(igId, `${result.kind === 'refusal' ? 'Claude rechazó responder' : 'Fallo al llamar a Claude'}: ${result.detail}`);
    }
    await store.saveLead(igId, result.output.lead);
    // Dueño de negocio que quiere implementación (DFY): etiqueta para que Jose lo identifique (decisión 2026-10-17).
    if (result.output.lead.tipo_lead === 'empresa_dfy') await store.addContactTags(igId, ['EMPRESA DFY']);
    await this.deliver(igId, dedupKey, result);
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

  private async deliver(igId: string, dedupKey: string, reply: Extract<CheckedReply, { kind: 'ok' }>): Promise<void> {
    const { store } = this.options;
    const { output, usage, messages, guard, retried } = reply;
    const facts = { igId, usage, messages: messages.length, retried, siguientePaso: output.lead.siguiente_paso, needsHuman: output.needs_human };
    if (messages.length === 0) {
      await this.log('La IA decidió no responder.', facts);
    } else {
      if (!guard.ok) {
        const note = guard.reasons.join(' · ');
        await store.addMessage({ igId, direction: 'out', source: 'ai', text: messages.join('\n'), mid: null, status: 'held', dedupKey, note });
        return this.stop(igId, `Respuesta retenida: ${note}`);
      }
      if ((await store.getSetting(SETTINGS.setterDraft)) === 'true') {
        for (const [i, text] of messages.entries()) {
          await store.addMessage({ igId, direction: 'out', source: 'ai', text, mid: null, status: 'held', dedupKey: `${dedupKey}:${i + 1}`, note: DRAFT_NOTE });
        }
        await this.log('Modo borrador: respuesta retenida para aprobar.', facts);
      } else {
        await this.log('Respuesta de la IA en cola.', facts);
        await this.sendAll(igId, dedupKey, messages);
      }
    }
    if (output.needs_human) await this.stop(igId, `La IA pide que intervenga Jose: ${output.needs_human_reason ?? 'sin motivo'}`);
    else if (output.lead.es_menor === 'si') await this.stop(igId, 'Posible menor de edad.');
  }

  /** Mensajito a mensajito, como una persona: "escribiendo…", pausa según lo largo, envío. Si uno falla, no salen los siguientes. */
  private async sendAll(igId: string, dedupKey: string, messages: readonly string[]): Promise<void> {
    for (const [i, text] of messages.entries()) {
      await this.typeLikeHuman(igId, text);
      if (!(await this.send(igId, `${dedupKey}:${i + 1}`, text))) return;
    }
  }

  private async typeLikeHuman(igId: string, text: string): Promise<void> {
    if (this.options.showTyping) {
      try {
        await this.options.showTyping(igId);
      } catch (error) {
        // Sin "escribiendo…" el mensaje sale igual.
        await this.log('No se pudo mostrar "escribiendo…".', { igId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await this.sleep(typingDelayMs(text, this.random()));
  }

  /**
   * Envía un mensajito por la cola y apunta cómo terminó. Devuelve true si Instagram lo aceptó.
   * `saved`: el mensajito ya está guardado (borrador aprobado) y solo cambia su estado, sin duplicar la fila.
   */
  private async send(igId: string, dedupKey: string, original: string, saved = false): Promise<boolean> {
    const { store } = this.options;
    const out = withLinkButtons(original, this.options.links);
    if (saved) await store.setMessageStatus(dedupKey, 'queued');
    else await store.addMessage({ igId, direction: 'out', source: 'ai', text: out.stored, mid: null, status: 'queued', dedupKey });
    const action: Action = {
      type: 'send_message',
      dedupKey,
      recipientId: igId,
      message: { text: out.text, buttons: out.buttons, flowId: SETTER_FLOW_ID, nodeId: 'reply', recipientId: igId },
    };
    await this.options.enqueue([action]);
    const done = await store.getAction(dedupKey);
    if (done?.ok === true) await store.setMessageStatus(dedupKey, 'sent', messageIdOf(done.response));
    else if (done?.ok === false) await store.setMessageStatus(dedupKey, 'failed');
    return done?.ok === true;
  }

  private async stop(igId: string, reason: string): Promise<void> {
    await this.options.store.setAiPaused(igId, true, reason);
    await this.log(`IA parada en esta conversación. ${reason}`, { igId });
  }

  private async log(note: string, data: unknown): Promise<void> {
    await this.options.store.logEvent(LOG_KIND, note, data);
  }
}
