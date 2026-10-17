import { describe, expect, it, vi } from 'vitest';
import { DELETE_CONFIRMATION, isDeleteRequest } from '../src/data-deletion.js';
import type { InstagramClient } from '../src/meta/client.js';
import { processWebhook } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { STRANGER_ID, commentPayload, createMemoryStore, followFlow, messagePayload } from './helpers.js';

/**
 * "BORRAR" por DM (promesa de /data-deletion). Decisiones de Jose (2026-10-17): se borra lo personal y también
 * el texto en los registros técnicos; se confirma con un texto corto por DM.
 */

describe('isDeleteRequest', () => {
  it.each(['BORRAR', 'borrar', ' Borrar ', 'BORRAR.', 'borrar!!', 'BÓRRAR', 'borrar 🙏'])('"%s" pide el borrado', (text) => expect(isDeleteRequest(text)).toBe(true));

  it.each(['no quiero borrar nada', 'borrar mis datos', 'borra', '', null, 'hola'])('"%s" NO pide el borrado', (text) => expect(isDeleteRequest(text)).toBe(false));
});

function setup() {
  const store = createMemoryStore();
  store.flows.set('flow1', followFlow({ trigger: { mediaIds: 'all', keywords: [] } }));
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
  const setter = { onIncoming: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined) };
  const timers: (() => void)[] = [];
  const deps = { store, sender, setter, random: () => 0, setTimer: (fn: () => void) => timers.push(fn) };
  return { store, client, sender, setter, deps, timers };
}

describe('process.ts: BORRAR por DM', () => {
  it('borra los datos de esa persona, le confirma por DM y el setter no responde ni lo guarda', async () => {
    const { store, client, sender, setter, deps } = setup();
    await processWebhook(commentPayload(), deps); // comenta → contacto, comentario, DM del flujo
    await sender.idle();
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'me llamo Ana', mid: 'm-ana', status: 'sent', dedupKey: null });
    await store.saveLead(STRANGER_ID, { siguiente_paso: 'seguir_calificando' });
    const spy = vi.spyOn(store, 'deletePersonData');

    await processWebhook(messagePayload('BORRAR', { mid: 'm-borrar' }), deps);
    await sender.idle();

    expect(spy).toHaveBeenCalledWith(STRANGER_ID);
    expect(client.sendMessage).toHaveBeenCalledWith(STRANGER_ID, { text: DELETE_CONFIRMATION });
    expect(setter.onIncoming).not.toHaveBeenCalled();
    expect(setter.record).not.toHaveBeenCalled();
    expect(await store.getContact(STRANGER_ID)).toBeNull();
    expect(await store.listMessages(STRANGER_ID, 50)).toEqual([]);
    expect(await store.listLeadHistory(STRANGER_ID, 50)).toEqual([]);
    // Lo que queda registrado del borrado no lleva su id.
    expect(JSON.stringify(store.events.filter((e) => e.kind === 'borrado'))).not.toContain(STRANGER_ID);
  });

  it('al minuto hace un segundo barrido (borra también el rastro técnico de la propia confirmación)', async () => {
    const { store, sender, deps, timers } = setup();
    const spy = vi.spyOn(store, 'deletePersonData');
    await processWebhook(messagePayload('borrar', { mid: 'm-borrar' }), deps);
    await sender.idle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('un mensaje normal que contiene "borrar" sigue yendo al setter', async () => {
    const { setter, deps } = setup();
    await processWebhook(messagePayload('no quiero borrar nada'), deps);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
  });
});
