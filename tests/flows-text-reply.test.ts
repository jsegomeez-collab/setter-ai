import { describe, expect, it, vi } from 'vitest';
import { isAffirmativeReply } from '../src/flows/text-reply.js';
import type { InstagramClient } from '../src/meta/client.js';
import { processWebhook } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { STRANGER_ID, createMemoryStore, followFlow, messagePayload } from './helpers.js';

/**
 * Caso real (@mg_grela, 2026-10-16): escribió "si" en vez de pulsar el botón del flujo y se quedó sin recurso.
 * Decisión de Jose (2026-10-17): un "sí" corto al mensaje del flujo con UN botón de acción cuenta como pulsarlo,
 * y varios "sí" seguidos al mismo mensaje cuentan una sola vez.
 */

describe('isAffirmativeReply', () => {
  it.each(['si', 'Sí', 'SIIII', 'si!!', 'dale', 'ok', 'vale', 'listo', 'ya', 'quiero', 'porfa', 'Mándamelo', 'ya te seguí', 'Ya te sigo 🙌', 'si por favor', 'sí, mándamelo'])(
    '"%s" cuenta como sí',
    (text) => expect(isAffirmativeReply(text, 'si, mándamelo')).toBe(true),
  );

  it.each(['no', 'no gracias', 'ya no', 'si pero tengo una duda', 'cuánto cuesta?', '', '👍', 'te', 'si si si si si si'])('"%s" NO cuenta como sí', (text) =>
    expect(isAffirmativeReply(text, 'si, mándamelo')).toBe(false),
  );

  it('el texto del propio botón también cuenta', () => {
    expect(isAffirmativeReply('Lo quiero', 'Lo quiero')).toBe(true);
    expect(isAffirmativeReply('lo quiero!', 'Lo quiero')).toBe(true);
  });
});

const FLOW_KEY = 'private:c-1';

function setup(lastOut: 'flow' | 'ai' | 'none' = 'flow', nodeId = 'start') {
  const store = createMemoryStore();
  const flow = followFlow();
  store.flows.set(flow.id, flow);
  const client = {
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined },
    async (id) => store.flows.get(id),
  );
  const setter = { onIncoming: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined) };
  return {
    store,
    client,
    sender,
    setter,
    deps: { store, sender, setter },
    /** Simula que el flujo ya mandó su mensaje (acción guardada + eco guardado en el historial). */
    async sentFlowMessage() {
      const node = flow.nodes.find((n) => n.id === nodeId);
      const message = { text: 'x', buttons: node?.type === 'message' ? node.buttons : [], flowId: flow.id, nodeId, recipientId: STRANGER_ID };
      await store.claimAction(FLOW_KEY, 'private_reply', { type: 'private_reply', dedupKey: FLOW_KEY, commentId: 'c-1', message });
      await store.finishAction(FLOW_KEY, true, { messageId: 'm-flow' });
      await store.addMessage({ igId: STRANGER_ID, direction: 'out', source: 'flow', text: '[botones]', mid: 'm-flow', status: 'sent', dedupKey: FLOW_KEY });
      if (lastOut === 'ai') {
        await store.addMessage({ igId: STRANGER_ID, direction: 'out', source: 'ai', text: 'hola!', mid: 'm-ai', status: 'sent', dedupKey: 'ai:1' });
      }
    },
  };
}

describe('process.ts: "si" escrito al mensaje del flujo', () => {
  it('cuenta como pulsar el botón: comprueba si sigue y manda el recurso; el setter no responde pero lo guarda', async () => {
    const { client, sender, setter, deps, sentFlowMessage, store } = setup();
    await sentFlowMessage();
    await processWebhook(messagePayload('si', { mid: 'm-si' }), deps);
    await sender.idle();
    expect(client.getFollowStatus).toHaveBeenCalledWith(STRANGER_ID);
    expect(client.sendMessage).toHaveBeenCalledWith(
      STRANGER_ID,
      expect.objectContaining({ attachment: expect.objectContaining({ payload: expect.objectContaining({ text: 'Aquí lo tienes' }) }) }),
    );
    expect(setter.onIncoming).not.toHaveBeenCalled();
    expect(setter.record).toHaveBeenCalledWith(expect.objectContaining({ mid: 'm-si', text: 'si' }));
    expect(store.events.some((e) => e.note.includes('texto como botón'))).toBe(true);
  });

  it('tres "si" seguidos al mismo mensaje → el flujo responde una sola vez', async () => {
    const { client, sender, setter, deps, sentFlowMessage } = setup();
    await sentFlowMessage();
    await processWebhook(messagePayload('si', { mid: 'm-si-1' }), deps);
    await processWebhook(messagePayload('si', { mid: 'm-si-2' }), deps);
    await processWebhook(messagePayload('si', { mid: 'm-si-3' }), deps);
    await sender.idle();
    expect(client.getFollowStatus).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(setter.onIncoming).not.toHaveBeenCalled();
    expect(setter.record).toHaveBeenCalledTimes(3);
  });

  it('también en el mensaje "sígueme primero" (botón "Ya te sigo")', async () => {
    const { client, sender, deps, sentFlowMessage } = setup('flow', 'notfollow');
    await sentFlowMessage();
    await processWebhook(messagePayload('ya te sigo'), deps);
    await sender.idle();
    expect(client.getFollowStatus).toHaveBeenCalledTimes(1);
  });

  it('un texto que no es un "sí" va al setter, como siempre', async () => {
    const { client, sender, setter, deps, sentFlowMessage } = setup();
    await sentFlowMessage();
    await processWebhook(messagePayload('tengo una duda'), deps);
    await sender.idle();
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.getFollowStatus).not.toHaveBeenCalled();
  });

  it('si lo último que se le mandó fue de la IA, el "si" es para el setter', async () => {
    const { client, sender, setter, deps, sentFlowMessage } = setup('ai');
    await sentFlowMessage();
    await processWebhook(messagePayload('si'), deps);
    await sender.idle();
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.getFollowStatus).not.toHaveBeenCalled();
  });

  it('si el último mensaje del flujo no tiene botón de acción (p. ej. el del recurso), va al setter', async () => {
    const { client, sender, setter, deps, sentFlowMessage } = setup('flow', 'resource');
    await sentFlowMessage();
    await processWebhook(messagePayload('si'), deps);
    await sender.idle();
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('sin mensajes previos del flujo, va al setter', async () => {
    const { setter, deps } = setup('none');
    await processWebhook(messagePayload('si'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
  });

  it('si el flujo está desactivado, va al setter', async () => {
    const { store, setter, deps, sentFlowMessage } = setup();
    await sentFlowMessage();
    store.flows.set('flow1', followFlow({ enabled: false }));
    await processWebhook(messagePayload('si'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
  });
});
