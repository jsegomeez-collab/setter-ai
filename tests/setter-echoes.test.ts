import { describe, expect, it } from 'vitest';
import type { InstagramEvent } from '../src/meta/parse.js';
import { EchoWatcher, HUMAN_PAUSE_REASON } from '../src/setter/echoes.js';
import { ACCOUNT_ID, STRANGER_ID, createMemoryStore } from './helpers.js';

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;

function echo(mid: string, text: string | null = 'hola, soy Jose'): MessageEvent {
  return { kind: 'message', accountId: ACCOUNT_ID, senderId: ACCOUNT_ID, recipientId: STRANGER_ID, mid, text, isEcho: true };
}

function setup() {
  const store = createMemoryStore();
  const timers: { fn: () => void; ms: number }[] = [];
  const watcher = new EchoWatcher({ store, checksMs: [5000, 10000, 15000], setTimer: (fn, ms) => timers.push({ fn, ms }) });
  /** Ejecuta la siguiente comprobación pendiente y espera a que termine. */
  const tick = async () => {
    timers.shift()?.fn();
    await watcher.idle();
  };
  return { store, timers, watcher, tick };
}

async function sentByUs(store: ReturnType<typeof createMemoryStore>, dedupKey: string, messageId: string) {
  await store.claimAction(dedupKey, 'send_message', {});
  await store.finishAction(dedupKey, true, { recipientId: STRANGER_ID, messageId });
}

describe('EchoWatcher', () => {
  it('eco de un mensaje de la IA: no para nada ni duplica el mensaje', async () => {
    const { store, watcher, tick } = setup();
    await sentByUs(store, 'ai:m-1', 'm-out-1');
    watcher.onEcho(echo('m-out-1', 'respuesta de la IA'));
    await tick();
    await tick();
    await tick();
    expect(store.messages).toHaveLength(0);
    expect(await store.getContact(STRANGER_ID)).toBeNull();
  });

  it('eco de un mensaje del flujo: se guarda en el historial como del flujo', async () => {
    const { store, watcher, tick } = setup();
    await sentByUs(store, 'private:c-1', 'm-flow-1');
    watcher.onEcho(echo('m-flow-1', null));
    await tick();
    expect(store.messages).toEqual([expect.objectContaining({ direction: 'out', source: 'flow', mid: 'm-flow-1', dedupKey: 'private:c-1' })]);
  });

  it('si el envío termina después del eco, lo reconoce en la segunda mirada (no para la IA)', async () => {
    const { store, watcher, tick } = setup();
    watcher.onEcho(echo('m-out-1'));
    await tick(); // a los 5 s todavía no está
    await sentByUs(store, 'ai:m-1', 'm-out-1');
    await tick();
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBeUndefined();
  });

  it('eco que no es nuestro tras todas las miradas → Jose escribió a mano → la IA se para', async () => {
    const { store, timers, watcher, tick } = setup();
    watcher.onEcho(echo('m-jose-1', 'Hola, te escribo yo'));
    expect(timers.map((t) => t.ms)).toEqual([5000]);
    await tick();
    await tick();
    expect(await store.getContact(STRANGER_ID)).toBeNull(); // aún no decide
    await tick();
    expect(store.messages).toEqual([expect.objectContaining({ direction: 'out', source: 'human', text: 'Hola, te escribo yo', mid: 'm-jose-1' })]);
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: HUMAN_PAUSE_REASON });
  });

  it('un eco sin destinatario se ignora', async () => {
    const { timers, watcher } = setup();
    watcher.onEcho({ ...echo('m-1'), recipientId: '' });
    expect(timers).toHaveLength(0);
  });
});
