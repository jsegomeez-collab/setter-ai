import type { InstagramEvent } from '../meta/parse.js';
import type { Store } from '../store.js';
import { planNode, type Plan } from './engine.js';
import { findNode } from './types.js';
import { sentFlowStep } from './text-reply.js';

/**
 * Rescate por DM (plan B, decisión de Jose 2026-10-17): si Meta rechazó el DM al comentario de esta persona
 * (error 2534025: le pasa a parte de la gente) y en los 7 días siguientes nos escribe, el flujo le manda su
 * primer mensaje. Ahora sí se puede: es ella quien ha escrito. Una sola vez por DM fallido (las acciones
 * llevan su clave y el emisor no repite claves). Si desde el fallo ya le mandamos algo, no se rescata.
 */

/** Mismo plazo que Meta da para responder a un comentario. */
const RESCUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_MESSAGES = 20;

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;

type RescueStore = Pick<Store, 'failedPrivateReply' | 'listMessages' | 'listFlows'>;

export async function planDmRescue(event: MessageEvent, store: RescueStore, now: Date = new Date()): Promise<Plan | null> {
  return planDmRescueFor(event.senderId, store, now);
}

/** Meta solo deja contestar dentro de las 24 h desde el último mensaje de la persona. */
const META_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DmRescueCandidate {
  readonly igId: string;
  readonly plan: Plan;
}

/**
 * Rescate de una vez (decisión de Jose 2026-10-17): quien tuvo el DM rechazado y YA escribió antes de que existiera
 * el rescate automático. Debe haber escrito en las últimas 24 h y no haber recibido nada desde el fallo. Sin repetir.
 */
export async function findDmRescueCandidates(
  store: RescueStore & Pick<Store, 'pendingConversations' | 'getAction'>,
  now: Date = new Date(),
): Promise<DmRescueCandidate[]> {
  const candidates: DmRescueCandidate[] = [];
  for (const igId of await store.pendingConversations(new Date(now.getTime() - META_REPLY_WINDOW_MS))) {
    const plan = await planDmRescueFor(igId, store, now);
    const first = plan?.actions[0];
    if (plan && first && !(await store.getAction(first.dedupKey))) candidates.push({ igId, plan });
  }
  return candidates;
}

/** El botón del panel: manda el primer mensaje del flujo a cada candidato (por la cola, con el anti-ban de siempre). */
export async function rescuePendingDms(
  deps: { readonly store: Parameters<typeof findDmRescueCandidates>[0] & Pick<Store, 'logEvent'>; readonly sender: { enqueue(actions: Plan['actions']): Promise<void> } },
  now: Date = new Date(),
): Promise<{ queued: number }> {
  const candidates = await findDmRescueCandidates(deps.store, now);
  for (const candidate of candidates) {
    await deps.store.logEvent('rescate', `Rescate de una vez por DM: ${candidate.plan.note}`, { igId: candidate.igId });
    await deps.sender.enqueue(candidate.plan.actions);
  }
  return { queued: candidates.length };
}

async function planDmRescueFor(igId: string, store: RescueStore, now: Date): Promise<Plan | null> {
  const failed = await store.failedPrivateReply(igId, new Date(now.getTime() - RESCUE_WINDOW_MS));
  if (!failed) return null;
  const recent = await store.listMessages(igId, RECENT_MESSAGES);
  if (recent.some((message) => message.direction === 'out' && message.createdAt >= failed.createdAt)) return null;
  const step = sentFlowStep(failed.request);
  if (!step) return null;
  const flow = (await store.listFlows()).find((candidate) => candidate.id === step.flowId);
  if (!flow?.enabled || !findNode(flow, step.nodeId)) return null;
  const actions = planNode(flow, step.nodeId, igId, `rescate-dm:${failed.dedupKey}`);
  if (actions.length === 0) return null;
  return { actions, note: `Flujo "${flow.name}": rescate por DM (su DM al comentario no salió) → paso ${step.nodeId}.`, flowId: flow.id };
}
