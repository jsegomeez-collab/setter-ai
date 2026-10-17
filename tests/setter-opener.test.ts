import { describe, expect, it, vi } from 'vitest';
import { planNode, type Action } from '../src/flows/engine.js';
import { validateFlow, type Flow } from '../src/flows/types.js';
import type { InstagramClient } from '../src/meta/client.js';
import { Sender } from '../src/sender.js';
import type { SetterBrain } from '../src/setter/brain.js';
import { FLOW_HANDLED_NOTE, SetterService } from '../src/setter/service.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, TEST_SETTER_LINKS, createMemoryStore, followFlow } from './helpers.js';

/**
 * Inicio del setter (Fase 5.4, decisión de Jose 2026-10-17): a quien pulsó el botón del flujo, 15 min después del
 * recurso la IA le escribe primero uno de los textos fijos (al azar), siempre con las reglas de siempre.
 */

const TEXTS = ['oye! ¿a qué te dedicas ahora mismo?', 'ey! ¿ya usas la IA para algo?'];

function flowWithOpener(): Flow {
  const base = followFlow();
  const nodes = base.nodes.map((n) => (n.id === 'resource' && n.type === 'message' ? { ...n, next: 'espera' } : n));
  return {
    ...base,
    nodes: [...nodes, { id: 'espera', type: 'delay', seconds: 900, next: 'inicio' }, { id: 'inicio', type: 'setter_opener', texts: TEXTS }],
  };
}

describe('nodo setter_opener (formato de flujo)', () => {
  it('un flujo con inicio del setter es válido; sin textos no', () => {
    expect(validateFlow(flowWithOpener()).ok).toBe(true);
    const bad = { ...flowWithOpener(), nodes: [...followFlow().nodes, { id: 'inicio', type: 'setter_opener', texts: [] }] };
    expect(validateFlow(bad).ok).toBe(false);
  });

  it('el motor lo convierte en una acción para el setter', () => {
    expect(planNode(flowWithOpener(), 'inicio', STRANGER_ID, 'job:1')).toEqual([{ type: 'setter_opener', dedupKey: 'job:1:inicio', recipientId: STRANGER_ID, texts: TEXTS }]);
  });
});

describe('Sender: setter_opener', () => {
  it('avisa al setter sin esperarle (si no, se bloquearía la cola) y lo da por hecho', async () => {
    const store = createMemoryStore();
    const openSetter = vi.fn().mockResolvedValue({ sent: true });
    const sender = new Sender(
      { store, client: {} as InstagramClient, limits: { privateReplies: 9, publicReplies: 9, followUps: 9 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined, openSetter },
      async () => undefined,
    );
    const action: Action = { type: 'setter_opener', dedupKey: 'job:1:inicio', recipientId: STRANGER_ID, texts: TEXTS };
    await sender.enqueue([action]);
    expect(openSetter).toHaveBeenCalledWith(STRANGER_ID, TEXTS, 'job:1:inicio');
    expect(store.actions.get('job:1:inicio')).toMatchObject({ ok: true });
  });
});

async function setter(mode: string | null = 'live') {
  const store = createMemoryStore();
  store.settings.set(SETTINGS.setterMode, mode);
  const enqueue = vi.fn(async (actions: readonly Action[]) => {
    for (const a of actions) {
      if (!(await store.claimAction(a.dedupKey, a.type, a))) continue;
      await store.finishAction(a.dedupKey, true, { recipientId: STRANGER_ID, messageId: `out-${a.dedupKey}` });
    }
  });
  const showTyping = vi.fn().mockResolvedValue(undefined);
  const decide = vi.fn<SetterBrain['decide']>();
  const service = new SetterService({
    store,
    brain: { decide },
    links: TEST_SETTER_LINKS,
    enqueue,
    getUsername: async () => 'alguien',
    showTyping,
    sleep: async () => undefined,
    random: () => 0,
  });
  return { store, enqueue, showTyping, decide, service };
}

describe('SetterService.openConversation', () => {
  it('le escribe uno de los textos, con "escribiendo…", y queda en la conversación como mensaje de la IA', async () => {
    const { store, enqueue, showTyping, decide, service } = await setter();
    expect(await service.openConversation(STRANGER_ID, TEXTS, 'job:1:inicio')).toEqual({ sent: true });
    expect(showTyping).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0][0]).toMatchObject({ type: 'send_message', message: { text: TEXTS[0] } });
    expect(store.messages.at(-1)).toMatchObject({ direction: 'out', source: 'ai', text: TEXTS[0] });
    expect(decide).not.toHaveBeenCalled(); // texto fijo: no se gasta en Claude
  });

  it('no repite si se lanza dos veces (p. ej. tras un reinicio)', async () => {
    const { enqueue, service } = await setter();
    await service.openConversation(STRANGER_ID, TEXTS, 'job:1:inicio');
    await service.openConversation(STRANGER_ID, TEXTS, 'job:1:inicio');
    expect(enqueue.mock.calls.filter(([actions]) => actions[0]?.type === 'send_message')).toHaveLength(1);
  });

  it('no le escribe si ya está hablando con el setter (escribió algo o la IA ya le respondió)', async () => {
    const { store, enqueue, service } = await setter();
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola, una duda', mid: 'm-1', status: 'sent', dedupKey: null });
    expect(await service.openConversation(STRANGER_ID, TEXTS, 'k')).toMatchObject({ skipped: expect.stringContaining('ya está hablando') });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('un "sí" que contestó el flujo no cuenta como estar hablando con el setter', async () => {
    const { store, enqueue, service } = await setter();
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'si', mid: 'm-1', status: 'sent', dedupKey: null, note: FLOW_HANDLED_NOTE });
    expect(await service.openConversation(STRANGER_ID, TEXTS, 'k')).toEqual({ sent: true });
    expect(enqueue).toHaveBeenCalled();
  });

  it('respeta las reglas de siempre: setter apagado, IA parada en esa conversación o modo prueba con otra persona', async () => {
    const off = await setter('off');
    expect(await off.service.openConversation(STRANGER_ID, TEXTS, 'k')).toMatchObject({ skipped: expect.any(String) });
    const paused = await setter('live');
    await paused.store.setAiPaused(STRANGER_ID, true, 'Jose escribió a mano');
    expect(await paused.service.openConversation(STRANGER_ID, TEXTS, 'k')).toMatchObject({ skipped: expect.stringContaining('parada') });
    const test = await setter('test');
    test.store.settings.set(SETTINGS.setterTestUsernames, 'josegomezlife');
    expect(await test.service.openConversation(STRANGER_ID, TEXTS, 'k')).toMatchObject({ skipped: expect.stringContaining('Modo prueba') });
    expect(off.enqueue).not.toHaveBeenCalled();
    expect(paused.enqueue).not.toHaveBeenCalled();
    expect(test.enqueue).not.toHaveBeenCalled();
  });
});
