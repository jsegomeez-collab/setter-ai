import { describe, expect, it, vi } from 'vitest';
import { InstagramClient, MetaApiError } from '../src/meta/client.js';
import { processInBackground, processWebhook } from '../src/process.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, TEST_MEDIA_ID, commentPayload, createMemoryStore, messagePayload } from './helpers.js';

function fakeClient(overrides: Partial<Record<'replyToComment' | 'sendPrivateReply' | 'sendText', unknown>> = {}) {
  return {
    replyToComment: vi.fn().mockResolvedValue({ id: 'reply-1' }),
    sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: 'igsid-77', messageId: 'mid-1' }),
    sendText: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'mid-2' }),
    ...overrides,
  } as unknown as InstagramClient & {
    replyToComment: ReturnType<typeof vi.fn>;
    sendPrivateReply: ReturnType<typeof vi.fn>;
    sendText: ReturnType<typeof vi.fn>;
  };
}

describe('processWebhook', () => {
  it('comentario en el reel de prueba: responde en público, manda DM y autoriza al que comentó', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.testMediaId, TEST_MEDIA_ID);
    const client = fakeClient();

    await processWebhook(commentPayload(), { store, client, envAllowedSenderIds: [] });

    expect(client.replyToComment).toHaveBeenCalledWith('c-1', expect.any(String));
    expect(client.sendPrivateReply).toHaveBeenCalledWith('c-1', expect.stringContaining('info'));
    expect([...store.actions.values()].every((action) => action.ok === true)).toBe(true);
    expect(store.allowed).toEqual([STRANGER_ID, 'igsid-77']);
  });

  it('no repite envíos si Meta manda el mismo aviso dos veces', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.testMediaId, TEST_MEDIA_ID);
    const client = fakeClient();

    await processWebhook(commentPayload(), { store, client, envAllowedSenderIds: [] });
    await processWebhook(commentPayload(), { store, client, envAllowedSenderIds: [] });

    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(store.events.some((event) => event.kind === 'duplicado')).toBe(true);
  });

  it('guarda el error de Meta en la acción sin romper el resto', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.testMediaId, TEST_MEDIA_ID);
    const error = new MetaApiError('(#10) Application does not have permission', 400, { error: { code: 10 } });
    const client = fakeClient({ replyToComment: vi.fn().mockRejectedValue(error) });

    await processWebhook(commentPayload(), { store, client, envAllowedSenderIds: [] });

    expect(store.actions.get('reply:c-1')).toMatchObject({ ok: false, response: { status: 400 } });
    expect(store.actions.get('private:c-1')).toMatchObject({ ok: true });
  });

  it('sin token: registra que no pudo enviar', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.testMediaId, TEST_MEDIA_ID);

    await processWebhook(commentPayload(), { store, client: null, envAllowedSenderIds: [] });

    expect(store.events.filter((event) => event.kind === 'error')).toHaveLength(2);
    expect(store.actions.size).toBe(0);
  });

  it('DM de remitente autorizado por variable de entorno con DMs activados: contesta', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.dmRepliesEnabled, 'true');
    const client = fakeClient();

    await processWebhook(messagePayload('hola'), { store, client, envAllowedSenderIds: [STRANGER_ID] });

    expect(client.sendText).toHaveBeenCalledWith(STRANGER_ID, expect.stringContaining('hola'));
  });

  it('DM de un cliente real (no autorizado): solo se registra', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.dmRepliesEnabled, 'true');
    const client = fakeClient();

    await processWebhook(messagePayload('quiero info', { sender: '555' }), { store, client, envAllowedSenderIds: [] });

    expect(client.sendText).not.toHaveBeenCalled();
    expect(store.events[0]?.note).toContain('no autorizado');
  });

  it('aviso vacío: lo registra como "vacio"', async () => {
    const store = createMemoryStore();
    await processWebhook({ object: 'instagram', entry: [] }, { store, client: null, envAllowedSenderIds: [] });
    expect(store.events[0]?.kind).toBe('vacio');
  });
});

describe('processInBackground', () => {
  it('registra el error si algo falla dentro', async () => {
    const store = createMemoryStore();
    store.getSetting = vi.fn().mockRejectedValue(new Error('BD caída'));

    processInBackground(messagePayload('hola'), { store, client: null, envAllowedSenderIds: [] });
    await vi.waitFor(() => expect(store.events.some((event) => event.kind === 'error')).toBe(true));

    expect(store.events.find((event) => event.kind === 'error')?.data).toEqual({ message: 'BD caída' });
  });
});
