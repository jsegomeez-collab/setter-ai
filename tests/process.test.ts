import { describe, expect, it, vi } from 'vitest';
import { encodePayload } from '../src/flows/engine.js';
import type { InstagramClient } from '../src/meta/client.js';
import { processInBackground, processWebhook, rescueComments } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { STRANGER_ID, commentPayload, createMemoryStore, followFlow, messagePayload, postbackPayload } from './helpers.js';

function setup(flows = [followFlow()]) {
  const store = createMemoryStore();
  for (const flow of flows) store.flows.set(flow.id, flow);
  const client = {
    replyToComment: vi.fn().mockResolvedValue({ id: 'r1' }),
    sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm1' }),
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined },
    async (id) => store.flows.get(id),
  );
  return { store, client, sender, deps: { store, sender, random: () => 0 } };
}

describe('processWebhook con flujos', () => {
  it('comentario en el reel del flujo → respuesta pública + DM con botón', async () => {
    const { client, deps, store } = setup();
    await processWebhook(commentPayload(), deps);
    expect(client.replyToComment).toHaveBeenCalledWith('c-1', '¡Te escribí por DM! 📩');
    expect(client.sendPrivateReply).toHaveBeenCalledWith('c-1', expect.objectContaining({ attachment: expect.anything() }));
    expect(store.events[0]?.note).toContain('Reel n8n');
  });

  it('una sola vez por persona: el segundo comentario de la misma persona no recibe nada', async () => {
    const { client, deps, store } = setup();
    await processWebhook(commentPayload(), deps);
    await processWebhook(commentPayload({ id: 'c-2' }), deps);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(store.events.some((e) => e.note.includes('ya recibió este flujo'))).toBe(true);
  });

  it('opción B: la misma persona en OTRO reel sí recibe el DM; en el mismo reel no', async () => {
    const { client, deps } = setup([followFlow({ trigger: { type: 'comment', mediaIds: 'all', keywords: [] } })]);
    await processWebhook(commentPayload(), deps);
    await processWebhook(commentPayload({ id: 'c-2' }), deps);
    await processWebhook(commentPayload({ id: 'c-3', media: { id: '18000000000000002' } }), deps);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2);
  });

  it('pulsar "Lo quiero" → comprueba si sigue → manda el recurso', async () => {
    const { client, deps, sender } = setup();
    await processWebhook(postbackPayload(encodePayload('flow1', 'gate')), deps);
    await sender.idle();
    expect(client.getFollowStatus).toHaveBeenCalledWith(STRANGER_ID);
    expect(client.sendMessage).toHaveBeenCalledWith(
      STRANGER_ID,
      expect.objectContaining({ attachment: expect.objectContaining({ payload: expect.objectContaining({ text: 'Aquí lo tienes' }) }) }),
    );
  });

  it('comentario sin flujo, DMs, ecos y avisos "leído": solo se registran', async () => {
    const { client, deps, store } = setup([]);
    await processWebhook(commentPayload(), deps);
    await processWebhook(messagePayload('quiero info'), deps);
    await processWebhook(messagePayload('yo', { isEcho: true }), deps);
    await processWebhook({ entry: [{ id: '1', messaging: [{ read: { mid: 'x' }, timestamp: 1 }] }] }, deps);
    expect(client.replyToComment).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
    const notes = store.events.map((e) => e.note).join(' | ');
    expect(notes).toContain('ningún flujo');
    expect(notes).toContain('pasa al setter IA');
    expect(notes).toContain('eco');
    expect(notes).toContain('leído');
  });

  it('apunta de qué reel viene cada persona aunque ningún flujo salte', async () => {
    const { deps, store } = setup([]);
    await processWebhook(commentPayload(), deps);
    expect(store.contacts.get(STRANGER_ID)).toMatchObject({ username: 'cuenta_prueba', sourceMediaId: '18000000000000001' });
    expect(await store.reelStats()).toEqual([{ mediaId: '18000000000000001', comments: 1, people: 1, tagged: {} }]);
  });

  it('rescate: responde a los comentarios sin DM y nunca repite a quien ya lo recibió', async () => {
    const { client, deps, store, sender } = setup([]);
    // Llegan 2 comentarios cuando no había flujo activo (como el hueco del 16/10).
    await processWebhook(commentPayload({ id: 'h1' }), deps);
    await processWebhook(commentPayload({ id: 'h2', from: { id: '777', username: 'otra' } }), deps);
    // Comentario propio: nunca se rescata.
    await processWebhook(commentPayload({ id: 'h3', from: { id: '17841400000000001', username: 'josenews.ai' } }), deps);
    expect(client.sendPrivateReply).not.toHaveBeenCalled();
    // Se activa el flujo y se rescata.
    store.flows.set('flow1', followFlow({ trigger: { type: 'comment', mediaIds: 'all', keywords: [] } }));
    const first = await rescueComments(new Date(Date.now() - 3600_000), deps);
    await sender.idle();
    expect(first).toMatchObject({ queued: 2, skipped: 1 });
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2);
    expect(client.replyToComment).toHaveBeenCalledTimes(2);
    // Lanzarlo otra vez no manda nada nuevo.
    const second = await rescueComments(new Date(Date.now() - 3600_000), deps);
    await sender.idle();
    expect(second.queued).toBe(0);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2);
  });

  it('rescate: nunca más allá de 7 días (regla de Meta)', async () => {
    const { deps } = setup([]);
    const now = new Date('2026-10-20T12:00:00Z');
    const result = await rescueComments(new Date('2026-01-01T00:00:00Z'), deps, now);
    expect(result.since).toBe('2026-10-13T13:00:00.000Z');
  });

  it('aviso vacío → "vacio"', async () => {
    const { deps, store } = setup();
    await processWebhook({ object: 'instagram', entry: [] }, deps);
    expect(store.events[0]?.kind).toBe('vacio');
  });
});

describe('processInBackground', () => {
  it('registra el error si algo falla dentro', async () => {
    const { deps, store } = setup();
    store.listFlows = vi.fn().mockRejectedValue(new Error('BD caída'));
    processInBackground(commentPayload(), deps);
    await vi.waitFor(() => expect(store.events.some((event) => event.kind === 'error')).toBe(true));
    expect(store.events.find((event) => event.kind === 'error')?.data).toEqual({ message: 'BD caída' });
  });
});
