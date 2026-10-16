import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../src/flows/engine.js';
import { MetaApiError, type InstagramClient } from '../src/meta/client.js';
import { Sender, toApiMessage, toPlainFallback } from '../src/sender.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, createMemoryStore, followFlow } from './helpers.js';

const NOW = new Date('2026-10-16T12:00:00Z');

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    replyToComment: vi.fn().mockResolvedValue({ id: 'r1' }),
    sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm1' }),
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
    ...overrides,
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
}

function setup(client = fakeClient(), limitPerHour = 100) {
  const store = createMemoryStore();
  const sleep = vi.fn().mockResolvedValue(undefined);
  const flow = followFlow();
  const sender = new Sender(
    { store, client, limitPerHour, minDelayMs: 2000, maxDelayMs: 5000, sleep, random: () => 0.5, now: () => NOW },
    async (id) => (id === flow.id ? flow : undefined),
  );
  return { store, client, sleep, sender };
}

const msg = { text: 'Hola', buttons: [{ type: 'url' as const, title: 'Abrir', url: 'https://e.com' }], flowId: 'flow1' };
const reply: Action = { type: 'reply_comment', dedupKey: 'reply:c1', commentId: 'c1', text: 'Te escribí' };
const privateReply: Action = { type: 'private_reply', dedupKey: 'private:c1', commentId: 'c1', message: msg };

describe('formato de mensajes', () => {
  it('con botones usa la plantilla de botones; los postback llevan flujo:nodo', () => {
    expect(toApiMessage({ text: 'Hola', buttons: [], flowId: 'f' })).toEqual({ text: 'Hola' });
    const api = toApiMessage({ text: 'Hola', buttons: [{ type: 'postback', title: 'Ya', next: 'gate' }, msg.buttons[0] as never], flowId: 'flow1' });
    expect(api).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Hola',
          buttons: [
            { type: 'postback', payload: 'F:flow1:gate', title: 'Ya' },
            { type: 'web_url', url: 'https://e.com', title: 'Abrir' },
          ],
        },
      },
    });
  });
  it('el respaldo de solo texto incluye los enlaces', () => {
    expect(toPlainFallback(msg)).toBe('Hola\n\nAbrir: https://e.com');
  });
});

describe('Sender', () => {
  it('envía en orden, con espera aleatoria de 2-5 s antes de cada envío', async () => {
    const { store, client, sleep, sender } = setup();
    await sender.enqueue([reply, privateReply]);
    expect(client.replyToComment).toHaveBeenCalledWith('c1', 'Te escribí');
    expect(client.sendPrivateReply).toHaveBeenCalledWith('c1', toApiMessage(msg));
    expect(sleep).toHaveBeenCalledWith(3500);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect([...store.actions.values()].map((a) => a.ok)).toEqual([true, true]);
  });

  it('nunca envía dos veces la misma acción', async () => {
    const { client, sender, store } = setup();
    await sender.enqueue([reply]);
    await sender.enqueue([reply]);
    expect(client.replyToComment).toHaveBeenCalledTimes(1);
    expect(store.events.some((e) => e.kind === 'duplicado')).toBe(true);
  });

  it('respeta el límite por hora', async () => {
    const { client, sender, store } = setup(fakeClient(), 1);
    await sender.enqueue([reply, privateReply]);
    expect(client.replyToComment).toHaveBeenCalledTimes(1);
    expect(client.sendPrivateReply).not.toHaveBeenCalled();
    expect(store.actions.get('private:c1')?.response).toMatchObject({ skipped: expect.stringContaining('Límite') });
  });

  it('error 368 de Meta → pausa todo 24 h y no envía nada más', async () => {
    const blocked = new MetaApiError('Policy block', 400, { error: { code: 368 } });
    const { client, sender, store } = setup(fakeClient({ replyToComment: vi.fn().mockRejectedValue(blocked) }));
    await sender.enqueue([reply, privateReply]);
    expect(store.settings.get(SETTINGS.pausedUntil)).toBe('2026-10-17T12:00:00.000Z');
    expect(client.sendPrivateReply).not.toHaveBeenCalled();
    expect(store.events.filter((e) => e.kind === 'pausado').length).toBeGreaterThanOrEqual(2);
  });

  it('si Meta rechaza los botones en la respuesta privada, manda solo texto con los enlaces', async () => {
    const rejected = new MetaApiError('Invalid parameter', 400, { error: { code: 100 } });
    const sendPrivateReply = vi.fn().mockRejectedValueOnce(rejected).mockResolvedValueOnce({ recipientId: STRANGER_ID, messageId: 'm9' });
    const { sender, store } = setup(fakeClient({ sendPrivateReply }));
    await sender.enqueue([privateReply]);
    expect(sendPrivateReply).toHaveBeenLastCalledWith('c1', 'Hola\n\nAbrir: https://e.com');
    expect(store.actions.get('private:c1')).toMatchObject({ ok: true, response: { fallback: expect.any(String) } });
  });

  it('otros errores se guardan en la acción sin romper la cola', async () => {
    const { sender, store, client } = setup(fakeClient({ replyToComment: vi.fn().mockRejectedValue(new Error('red caída')) }));
    await sender.enqueue([reply, privateReply]);
    expect(store.actions.get('reply:c1')).toMatchObject({ ok: false, response: { message: 'red caída' } });
    expect(client.sendPrivateReply).toHaveBeenCalled();
  });

  it('condición de seguir: consulta a Meta y encola el siguiente mensaje', async () => {
    const { sender, client, store } = setup(fakeClient({ getFollowStatus: vi.fn().mockResolvedValue({ status: 'no', detail: 'false' }) }));
    await sender.enqueue([{ type: 'check_follow', dedupKey: 'pb:1:gate', recipientId: STRANGER_ID, flowId: 'flow1', nodeId: 'gate', depth: 0 }]);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledWith(STRANGER_ID, expect.objectContaining({ attachment: expect.anything() }));
    expect(store.actions.get('pb:1:gate')?.response).toMatchObject({ follow: 'no' });
  });

  it('sin cliente o pausado: no envía y lo registra', async () => {
    const store = createMemoryStore();
    const noClient = new Sender({ store, client: null, limitPerHour: 10, minDelayMs: 0, maxDelayMs: 0 }, async () => undefined);
    await noClient.enqueue([reply]);
    expect(store.events[0]?.kind).toBe('error');

    const { sender, client, store: s2 } = setup();
    s2.settings.set(SETTINGS.pausedUntil, '2026-10-16T13:00:00.000Z');
    await sender.enqueue([reply]);
    expect(client.replyToComment).not.toHaveBeenCalled();
  });
});
