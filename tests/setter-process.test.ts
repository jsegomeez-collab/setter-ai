import { describe, expect, it, vi } from 'vitest';
import { processWebhook } from '../src/process.js';
import type { Sender } from '../src/sender.js';
import { ACCOUNT_ID, STRANGER_ID, createMemoryStore, messagePayload, postbackPayload } from './helpers.js';

/** process.ts reparte los DMs: persona → setter IA; eco de la cuenta → vigilante de ecos; botones → flujo. */

function setup() {
  const store = createMemoryStore();
  const sender = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as Sender;
  const setter = { onIncoming: vi.fn().mockResolvedValue(undefined) };
  const echoes = { onEcho: vi.fn() };
  return { store, setter, echoes, deps: { store, sender, setter, echoes } };
}

describe('process.ts → setter IA', () => {
  it('un DM de una persona va al setter (y queda registrado)', async () => {
    const { store, setter, echoes, deps } = setup();
    await processWebhook(messagePayload('quiero info', { mid: 'm-1' }), deps);
    expect(setter.onIncoming).toHaveBeenCalledWith(expect.objectContaining({ kind: 'message', senderId: STRANGER_ID, mid: 'm-1', text: 'quiero info' }));
    expect(echoes.onEcho).not.toHaveBeenCalled();
    expect(store.events[0]?.note).toContain('pasa al setter IA');
  });

  it('un eco de la cuenta va al vigilante de ecos, no al setter', async () => {
    const { setter, echoes, deps } = setup();
    await processWebhook(messagePayload('hola, soy Jose', { mid: 'm-eco', sender: ACCOUNT_ID, recipient: STRANGER_ID, isEcho: true }), deps);
    expect(echoes.onEcho).toHaveBeenCalledWith(expect.objectContaining({ mid: 'm-eco', recipientId: STRANGER_ID, isEcho: true }));
    expect(setter.onIncoming).not.toHaveBeenCalled();
  });

  it('un mensaje de la propia cuenta sin marca de eco no llega a nadie', async () => {
    const { setter, echoes, deps } = setup();
    await processWebhook(messagePayload('raro', { sender: ACCOUNT_ID }), deps);
    expect(setter.onIncoming).not.toHaveBeenCalled();
    expect(echoes.onEcho).not.toHaveBeenCalled();
  });

  it('pulsar un botón (postback) es cosa del flujo: el setter no responde', async () => {
    const { setter, deps } = setup();
    await processWebhook(postbackPayload('F:flow1:gate'), deps);
    expect(setter.onIncoming).not.toHaveBeenCalled();
  });

  it('sin setter conectado (como antes de la Fase 3) un DM solo se registra', async () => {
    const { store, deps } = setup();
    await processWebhook(messagePayload('hola'), { store: deps.store, sender: deps.sender });
    expect(store.events).toHaveLength(1);
  });
});
