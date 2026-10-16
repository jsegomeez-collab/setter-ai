import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../src/flows/engine.js';
import { MetaApiError, type InstagramClient } from '../src/meta/client.js';
import { Sender, toApiMessage, toPlainFallback } from '../src/sender.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, createMemoryStore, followFlow } from './helpers.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const THROTTLE_MS = 30_000;
const LIMITS = { privateReplies: 100, publicReplies: 100, followUps: 100 };
const DELAYS = { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 };

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    replyToComment: vi.fn().mockResolvedValue({ id: 'r1' }),
    sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm1' }),
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
    ...overrides,
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
}

function setup(client = fakeClient(), limits = LIMITS) {
  const store = createMemoryStore();
  const sleep = vi.fn().mockResolvedValue(undefined);
  const flow = followFlow();
  const sender = new Sender(
    { store, client, limits, delays: DELAYS, sleep, random: () => 0.5, now: () => NOW, throttleCheckMs: THROTTLE_MS },
    async (id) => (id === flow.id ? flow : undefined),
  );
  return { store, client, sleep, sender };
}

const msg = { text: 'Hola', buttons: [{ type: 'url' as const, title: 'Abrir', url: 'https://e.com', tags: [] }], flowId: 'flow1', nodeId: 'n1', recipientId: STRANGER_ID };
const privateReply: Action = { type: 'private_reply', dedupKey: 'private:c1', commentId: 'c1', message: msg };
const reply: Action = { type: 'reply_comment', dedupKey: 'reply:c1', commentId: 'c1', text: 'Te escribí', requires: 'private:c1' };
const followUp: Action = { type: 'send_message', dedupKey: 'pb:1:n', recipientId: STRANGER_ID, message: msg };

describe('formato de mensajes', () => {
  it('con botones usa la plantilla de botones; los postback llevan flujo:nodo', () => {
    expect(toApiMessage({ ...msg, buttons: [] })).toEqual({ text: 'Hola' });
    const api = toApiMessage({ ...msg, buttons: [{ type: 'postback', title: 'Ya', next: 'gate' }, ...msg.buttons] });
    expect(api).toMatchObject({
      attachment: {
        payload: {
          template_type: 'button',
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
  it('primero el DM y luego la respuesta pública, con esperas de 1-2 s en comentarios', async () => {
    const { store, client, sleep, sender } = setup();
    await sender.enqueue([privateReply, reply]);
    expect(vi.mocked(client.sendPrivateReply).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.replyToComment).mock.invocationCallOrder[0] as number);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect([...store.actions.values()].map((a) => a.ok)).toEqual([true, true]);
  });

  it('si el DM falla (también como solo texto), NO se publica "mira tus DMs"', async () => {
    const invalid = new MetaApiError('Comentario no válido', 400, { error: { code: 100, error_subcode: 2534025 } });
    const { client, sender, store } = setup(fakeClient({ sendPrivateReply: vi.fn().mockRejectedValue(invalid) }));
    await sender.enqueue([privateReply, reply]);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2); // con botones y, de respaldo, solo texto
    // Queda constancia de que se intentó el texto (para medir cuántos se salvan con él).
    expect(store.events.some((e) => e.kind === 'respaldo' && e.note.includes('también'))).toBe(true);
    expect(client.replyToComment).not.toHaveBeenCalled();
    expect(store.actions.get('reply:c1')).toMatchObject({ ok: false, response: { skipped: expect.stringContaining('DM no salió') } });
  });

  it('2534025 con botones → se reintenta una vez con solo texto; si sale, se publica "mira tus DMs"', async () => {
    // Datos reales 2026-10-16: el mismo comentario ("Bolsa") y el mismo mensaje salen para unas personas y no para otras.
    const invalid = new MetaApiError('Comentario no válido', 400, { error: { code: 100, error_subcode: 2534025 } });
    const sendPrivateReply = vi.fn().mockRejectedValueOnce(invalid).mockResolvedValueOnce({ recipientId: STRANGER_ID, messageId: 'm-txt' });
    const { client, sender, store } = setup(fakeClient({ sendPrivateReply }));
    await sender.enqueue([privateReply, reply]);
    expect(sendPrivateReply).toHaveBeenLastCalledWith('c1', 'Hola\n\nAbrir: https://e.com');
    expect(store.actions.get('private:c1')).toMatchObject({ ok: true, response: { fallback: expect.any(String) } });
    expect(client.replyToComment).toHaveBeenCalledWith('c1', 'Te escribí');
  });

  it('los seguimientos usan esperas cortas (0,3-0,8 s)', async () => {
    const { sleep, sender } = setup();
    await sender.enqueue([followUp]);
    expect(sleep).toHaveBeenCalledWith(550);
  });

  it('nunca envía dos veces la misma acción', async () => {
    const { client, sender, store } = setup();
    await sender.enqueue([privateReply]);
    await sender.enqueue([privateReply]);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(store.events.some((e) => e.kind === 'duplicado')).toBe(true);
  });

  it('al llegar al límite por hora ESPERA (no descarta) y envía cuando hay hueco', async () => {
    const store = createMemoryStore();
    const client = fakeClient();
    // Al esperar el chequeo de límite, "pasa una hora": los envíos anteriores salen de la ventana.
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      if (ms === THROTTLE_MS) for (const [k, a] of store.actions) store.actions.set(k, { ...a, createdAt: new Date(a.createdAt.getTime() - 2 * 3600_000) });
    });
    const sender = new Sender(
      { store, client, limits: { ...LIMITS, privateReplies: 1 }, delays: DELAYS, sleep, random: () => 0, throttleCheckMs: THROTTLE_MS },
      async () => undefined,
    );
    const second: Action = { ...privateReply, dedupKey: 'private:c2', commentId: 'c2' };
    await sender.enqueue([privateReply, second]);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(THROTTLE_MS);
    expect(store.events.some((e) => e.kind === 'limite')).toBe(true);
  });

  it('un pico de comentarios no retrasa los seguimientos (colas separadas)', async () => {
    const store = createMemoryStore();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const client = fakeClient({ sendPrivateReply: vi.fn().mockImplementation(() => blocked.then(() => ({ recipientId: '1', messageId: 'm' }))) });
    const sender = new Sender({ store, client, limits: LIMITS, delays: DELAYS, sleep: async () => undefined }, async () => undefined);
    void sender.enqueue([privateReply]);
    await sender.enqueue([followUp]);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    release();
    await sender.idle();
  });

  it('error 368 de Meta → pausa 24 h; lo siguiente espera a que acabe la pausa', async () => {
    const blocked = new MetaApiError('Policy block', 400, { error: { code: 368 } });
    const client = fakeClient({ sendPrivateReply: vi.fn().mockRejectedValueOnce(blocked).mockResolvedValue({ recipientId: '1', messageId: 'm' }) });
    const store = createMemoryStore();
    let now = NOW;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      if (ms === THROTTLE_MS) now = new Date(now.getTime() + 25 * 3600_000); // pasa la pausa
    });
    const sender = new Sender({ store, client, limits: LIMITS, delays: DELAYS, sleep, random: () => 0, now: () => now, throttleCheckMs: THROTTLE_MS }, async () => undefined);
    const second: Action = { ...privateReply, dedupKey: 'private:c2', commentId: 'c2' };
    await sender.enqueue([privateReply, second]);
    expect(store.settings.get(SETTINGS.pausedUntil)).toBe('2026-10-17T12:00:00.000Z');
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(2);
    expect(store.actions.get('private:c2')?.ok).toBe(true);
    expect(store.events.filter((e) => e.kind === 'pausado').length).toBeGreaterThanOrEqual(2);
  });

  it('si Meta rechaza los botones (otro error 4xx), manda solo texto con los enlaces', async () => {
    const rejected = new MetaApiError('Invalid parameter', 400, { error: { code: 100 } });
    const sendPrivateReply = vi.fn().mockRejectedValueOnce(rejected).mockResolvedValueOnce({ recipientId: STRANGER_ID, messageId: 'm9' });
    const { sender, store } = setup(fakeClient({ sendPrivateReply }));
    await sender.enqueue([privateReply]);
    expect(sendPrivateReply).toHaveBeenLastCalledWith('c1', 'Hola\n\nAbrir: https://e.com');
    expect(store.actions.get('private:c1')).toMatchObject({ ok: true, response: { fallback: expect.any(String) } });
  });

  it('tras un reinicio retoma las acciones reservadas que no terminaron', async () => {
    const { store, sender, client } = setup();
    await store.claimAction('private:c1', 'private_reply', privateReply);
    await store.claimAction('once:x', 'once', {});
    expect(await sender.recover()).toBe(1);
    await sender.idle();
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(store.actions.get('private:c1')?.ok).toBe(true);
  });

  it('condición de seguir: consulta a Meta y encola el siguiente mensaje', async () => {
    const { sender, client, store } = setup(fakeClient({ getFollowStatus: vi.fn().mockResolvedValue({ status: 'no', detail: 'false' }) }));
    await sender.enqueue([{ type: 'check_follow', dedupKey: 'pb:1:gate', recipientId: STRANGER_ID, flowId: 'flow1', nodeId: 'gate', depth: 0 }]);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledWith(STRANGER_ID, expect.objectContaining({ attachment: expect.anything() }));
    expect(store.actions.get('pb:1:gate')?.response).toMatchObject({ follow: 'no' });
  });

  it('sin cliente: marca la acción como fallida y lo registra', async () => {
    const store = createMemoryStore();
    const sender = new Sender({ store, client: null, limits: LIMITS, delays: DELAYS }, async () => undefined);
    await sender.enqueue([privateReply]);
    expect(store.actions.get('private:c1')?.ok).toBe(false);
    expect(store.events.some((e) => e.kind === 'error')).toBe(true);
  });
});
