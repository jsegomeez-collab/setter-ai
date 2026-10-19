import type { Store } from '../store.js';
import { MAX_DEPTH, normalize, planNode, type Action } from './engine.js';
import type { ConditionRule } from './nodes.js';
import { findNode, type Flow } from './types.js';

/**
 * Pasos de "hacer" y condiciones (Fase 7.3a). El emisor los ejecuta cuando les llega el turno en la cola
 * (así una condición ve la etiqueta que puso el paso anterior) y encola lo siguiente.
 * Nada de aquí escribe a la persona: solo cambia su ficha, avisa a Jose o decide el camino.
 */

type StepAction = Extract<Action, { type: 'flow_step' }>;

/** Perfil de Instagram (User Profile API). null = Meta no deja verlo (la persona aún no ha escrito). */
export interface Profile {
  readonly followerCount: number | null;
  readonly isVerified: boolean | null;
}

export interface StepDeps {
  readonly store: Pick<Store, 'getContact' | 'addContactTags' | 'removeContactTag' | 'setContactField' | 'setAiPaused' | 'logEvent' | 'listMessages'>;
  readonly getFlow: (flowId: string) => Promise<Flow | undefined>;
  readonly getProfile: (igId: string) => Promise<Profile | null>;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface StepOutcome {
  /** Lo que se apunta en la acción (para el registro). */
  readonly result: Record<string, unknown>;
  /** Lo siguiente que hay que encolar. */
  readonly next: Action[];
}

/** Mensajes recientes en los que se busca el último de la persona. */
const RECENT_MESSAGES = 20;
const WEEKDAY: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fieldKey = (field: string): string => field.trim().toLowerCase();

/** ¿`now` cae dentro del horario (días y horas en su zona horaria)? "Desde" > "hasta" cruza la medianoche. */
export function isWithinHours(rule: Extract<ConditionRule, { kind: 'hours' }>, now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: rule.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const day = WEEKDAY[part('weekday')] ?? -1;
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const from = toMinutes(rule.from);
  const to = toMinutes(rule.to);
  if (from <= to) return rule.days.includes(day) && minutes >= from && minutes < to;
  // Cruza la medianoche: la parte de después de las 00:00 pertenece al día anterior.
  if (minutes >= from) return rule.days.includes(day);
  return minutes < to && rule.days.includes((day + 6) % 7);
}

async function lastIncomingText(deps: StepDeps, igId: string): Promise<string> {
  const recent = await deps.store.listMessages(igId, RECENT_MESSAGES);
  return [...recent].reverse().find((message) => message.direction === 'in')?.text ?? '';
}

/** Decide la rama de una condición. `detail` explica por qué (se ve en el registro). */
async function evaluate(rule: ConditionRule, igId: string, deps: StepDeps): Promise<{ yes: boolean; detail: string }> {
  switch (rule.kind) {
    case 'has_tag': {
      const tags = (await deps.store.getContact(igId))?.tags ?? [];
      const yes = tags.some((tag) => normalize(tag) === normalize(rule.tag));
      return { yes, detail: `etiqueta "${rule.tag}": ${yes ? 'la tiene' : 'no la tiene'}` };
    }
    case 'field': {
      const value = (await deps.store.getContact(igId))?.fields?.[fieldKey(rule.field)] ?? '';
      const yes =
        rule.op === 'set' ? value.trim() !== '' : rule.op === 'equals' ? normalize(value) === normalize(rule.value) : normalize(value).includes(normalize(rule.value));
      return { yes, detail: `dato "${rule.field}" = "${value}"` };
    }
    case 'keyword': {
      const text = normalize(await lastIncomingText(deps, igId));
      const yes = rule.keywords.some((keyword) => text.includes(normalize(keyword)));
      return { yes, detail: `palabras ${rule.keywords.join(', ')} en su último mensaje: ${yes ? 'sí' : 'no'}` };
    }
    case 'verified':
    case 'followers': {
      const profile = await deps.getProfile(igId);
      if (!profile) return { yes: false, detail: 'Meta no deja ver su perfil (aún no ha escrito): cuenta como "no"' };
      if (rule.kind === 'verified') return { yes: profile.isVerified === true, detail: `verificada: ${String(profile.isVerified)}` };
      return { yes: (profile.followerCount ?? -1) >= rule.min, detail: `seguidores: ${String(profile.followerCount)} (mínimo ${rule.min})` };
    }
    case 'hours': {
      const now = (deps.now ?? (() => new Date()))();
      return { yes: isWithinHours(rule, now), detail: `horario ${rule.from}-${rule.to} (${rule.timeZone})` };
    }
    case 'random': {
      const roll = (deps.random ?? Math.random)() * 100;
      return { yes: roll < rule.percent, detail: `A/B ${rule.percent} %` };
    }
  }
}

const skip = (reason: string): StepOutcome => ({ result: { skipped: reason }, next: [] });

export async function runFlowStep(action: StepAction, deps: StepDeps): Promise<StepOutcome> {
  const flow = await deps.getFlow(action.flowId);
  if (!flow) return skip('El flujo ya no existe');
  if (!flow.enabled) return skip('El flujo está desactivado');
  const node = findNode(flow, action.nodeId);
  if (!node) return skip(`El paso ${action.nodeId} ya no existe`);
  const igId = action.recipientId;
  const continueWith = (next: string | undefined, key = action.dedupKey): Action[] => (next ? planNode(flow, next, igId, key, action.depth + 1) : []);
  const { store } = deps;

  switch (node.type) {
    case 'tag':
      if (node.op === 'add') await store.addContactTags(igId, [node.tag]);
      else await store.removeContactTag(igId, node.tag);
      return { result: { tag: node.tag, op: node.op }, next: continueWith(node.next) };
    case 'field':
      await store.setContactField(igId, fieldKey(node.field), node.value);
      return { result: { field: fieldKey(node.field), value: node.value }, next: continueWith(node.next) };
    case 'ai':
      await store.setAiPaused(igId, node.paused, node.paused ? `Flujo "${flow.name}"` : null);
      return { result: { aiPaused: node.paused }, next: continueWith(node.next) };
    case 'notify':
      await store.logEvent('aviso', node.text, { igId, flowId: flow.id, flowName: flow.name });
      return { result: { notified: true }, next: continueWith(node.next) };
    case 'goto': {
      const target = await deps.getFlow(node.flowId);
      if (!target) return skip(`El flujo de destino (${node.flowId}) no existe`);
      if (!target.enabled) return skip(`El flujo de destino "${target.name}" está desactivado`);
      if (action.depth + 1 >= MAX_DEPTH) return skip('Demasiados pasos seguidos (posible bucle entre flujos)');
      return { result: { goto: target.id }, next: planNode(target, target.startNodeId, igId, `${action.dedupKey}:goto`, action.depth + 1) };
    }
    case 'condition': {
      const { yes, detail } = await evaluate(node.rule, igId, deps);
      const branch = yes ? 'yes' : 'no';
      return { result: { branch, detail }, next: continueWith(yes ? node.ifTrue : node.ifFalse, `${action.dedupKey}:${branch}`) };
    }
    default:
      return skip(`El paso ${node.id} (${node.type}) no es de "hacer" ni una condición`);
  }
}
