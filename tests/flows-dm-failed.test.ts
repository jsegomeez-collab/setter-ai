import { describe, expect, it, vi } from 'vitest';
import { findDmRescueCandidates, rescuePendingDms } from '../src/flows/dm-rescue.js';
import { planComment, type Action } from '../src/flows/engine.js';
import { MetaApiError, type InstagramClient } from '../src/meta/client.js';
import { processWebhook } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { FLOW_HANDLED_NOTE } from '../src/setter/service.js';
import { STRANGER_ID, createMemoryStore, followFlow, messagePayload } from './helpers.js';

/**
 * Plan B (decisión de Jose, 2026-10-17): si Meta rechaza el DM al comentario (también como solo texto),
 * respuesta pública pidiendo que nos escriban; y si esa persona nos escribe en los 7 días siguientes,
 * el flujo le manda su primer mensaje (una vez).
 */

const PLAN_B = ['No pude enviarte el DM 😕 escríbeme por mensaje y te lo paso'];
const INVALID = new MetaApiError('Comentario no válido', 400, { error: { code: 100, error_subcode: 2534025 } });
const comment = { kind: 'comment' as const, commentId: 'c-1', fromId: STRANGER_ID, fromUsername: 'ana', mediaId: '18000000000000001', parentId: null, accountId: 'acc', text: 'Bolsa' };

describe('planComment con plan B', () => {
  it('lleva el texto del plan B dentro de la respuesta privada (para usarlo solo si falla)', () => {
    const flow = followFlow({ trigger: { type: 'comment', mediaIds: 'all', keywords: [] }, dmFailedReplies: PLAN_B });
    const plan = planComment([flow], comment, () => 0);
    expect(plan.actions[0]).toMatchObject({ type: 'private_reply', failReply: PLAN_B[0] });
  });

  it('sin textos de plan B no lleva nada (como hasta ahora)', () => {
    const plan = planComment([followFlow({ trigger: { type: 'comment', mediaIds: 'all', keywords: [] } })], comment, () => 0);
    expect(plan.actions[0]).not.toHaveProperty('failReply');
  });
});

function setup(sendPrivateReply = vi.fn().mockRejectedValue(INVALID)) {
  const store = createMemoryStore();
  const flow = followFlow({ trigger: { type: 'comment', mediaIds: 'all', keywords: [] }, dmFailedReplies: PLAN_B });
  store.flows.set(flow.id, flow);
  const client = {
    replyToComment: vi.fn().mockResolvedValue({ id: 'r1' }),
    sendPrivateReply,
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined },
    async (id) => store.flows.get(id),
  );
  const setter = { onIncoming: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined) };
  return { store, client, sender, setter, flow, deps: { store, sender, setter, random: () => 0 } };
}

const privateReply = (failReply?: string): Action => ({
  type: 'private_reply',
  dedupKey: 'private:c-1',
  commentId: 'c-1',
  message: { text: 'Hola, pulsa el botón', buttons: [{ type: 'postback', title: 'Lo quiero', next: 'gate' }], flowId: 'flow1', nodeId: 'start', recipientId: STRANGER_ID },
  ...(failReply ? { failReply } : {}),
});

describe('Sender: plan B público', () => {
  it('si el DM falla (2534025, sin reintento con texto desde el bloqueo 368) → publica el plan B', async () => {
    const { client, sender } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(client.replyToComment).toHaveBeenCalledWith('c-1', PLAN_B[0]);
  });

  it('si el DM sale → no publica el plan B', async () => {
    const { client, sender } = setup(vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm1' }));
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    expect(client.replyToComment).not.toHaveBeenCalled();
  });

  it('error 368 (bloqueo de Meta) → nunca publica el plan B', async () => {
    const blocked = new MetaApiError('Bloqueado', 400, { error: { code: 368 } });
    const { client, sender } = setup(vi.fn().mockRejectedValue(blocked));
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    expect(client.replyToComment).not.toHaveBeenCalled();
  });

  it('el plan B se publica una sola vez por comentario', async () => {
    const { client, sender, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    store.actions.delete('private:c-1'); // como si se reintentara el mismo comentario (rescate)
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    expect(client.replyToComment).toHaveBeenCalledTimes(1);
  });
});

describe('rescate de una vez (quien ya escribió antes de que existiera el rescate automático)', () => {
  it('lista a quien tuvo el DM rechazado y escribió en las últimas 24 h sin recibir nada; el botón le manda el flujo', async () => {
    const { client, sender, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]); // DM rechazado
    await sender.idle();
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'No he recibido nada', mid: 'm-1', status: 'sent', dedupKey: null });

    const candidates = await findDmRescueCandidates(store);
    expect(candidates.map((c) => c.igId)).toEqual([STRANGER_ID]);

    expect(await rescuePendingDms({ store, sender })).toEqual({ queued: 1 });
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledWith(
      STRANGER_ID,
      expect.objectContaining({ attachment: expect.objectContaining({ payload: expect.objectContaining({ text: 'Hola, pulsa el botón' }) }) }),
    );
    // Una sola vez: pulsar otra vez el botón no repite.
    await rescuePendingDms({ store, sender });
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('no lista a quien escribió hace más de 24 h (Meta ya no deja contestar) ni a quien no tuvo el DM rechazado', async () => {
    const { sender, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola', mid: 'm-1', status: 'sent', dedupKey: null });
    const msg = store.messages.find((m) => m.mid === 'm-1');
    if (msg) store.messages[store.messages.indexOf(msg)] = { ...msg, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) };
    await store.addMessage({ igId: 'otra', direction: 'in', source: 'user', text: 'hola', mid: 'm-2', status: 'sent', dedupKey: null });
    expect(await findDmRescueCandidates(store)).toEqual([]);
  });
});

describe('process.ts: rescate por DM tras un DM fallido', () => {
  it('quien no recibió el DM y nos escribe → el flujo le manda su primer mensaje; el setter no contesta', async () => {
    const { client, sender, setter, deps, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    await processWebhook(messagePayload('Bolsa', { mid: 'm-in' }), deps);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledWith(
      STRANGER_ID,
      expect.objectContaining({ attachment: expect.objectContaining({ payload: expect.objectContaining({ text: 'Hola, pulsa el botón' }) }) }),
    );
    expect(setter.onIncoming).not.toHaveBeenCalled();
    expect(setter.record).toHaveBeenCalledWith(expect.objectContaining({ mid: 'm-in' }), FLOW_HANDLED_NOTE);
    expect(store.events.some((e) => e.note.includes('rescate por DM'))).toBe(true);
  });

  it('dos mensajes seguidos → el primer mensaje del flujo sale una sola vez', async () => {
    const { client, sender, deps } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    await processWebhook(messagePayload('hola', { mid: 'm-1' }), deps);
    await processWebhook(messagePayload('Bolsa', { mid: 'm-2' }), deps);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sin DM fallido → va al setter, como siempre', async () => {
    const { client, setter, deps } = setup();
    await processWebhook(messagePayload('hola'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('si después del fallo ya le mandamos algo (p. ej. por otro reel), no se rescata', async () => {
    const { client, sender, setter, deps, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    await store.addMessage({ igId: STRANGER_ID, direction: 'out', source: 'flow', text: '[botones]', mid: 'm-otro', status: 'sent', dedupKey: 'private:c-2' });
    await processWebhook(messagePayload('hola'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('si el DM fallido tiene más de 7 días, no se rescata', async () => {
    const { client, sender, setter, deps, store } = setup();
    await sender.enqueue([privateReply(PLAN_B[0])]);
    await sender.idle();
    const old = store.actions.get('private:c-1');
    if (old) store.actions.set('private:c-1', { ...old, createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
    await processWebhook(messagePayload('hola'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
