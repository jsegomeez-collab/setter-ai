import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../src/flows/engine.js';
import type { InstagramEvent } from '../src/meta/parse.js';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { NO_TEXT_PLACEHOLDER } from '../src/setter/prompt.js';
import { FLOW_HANDLED_NOTE, SetterService, parseUsernames, typingDelayMs } from '../src/setter/service.js';
import { SETTINGS } from '../src/store.js';
import { ACCOUNT_ID, STRANGER_ID, TEST_SETTER_LINKS, createMemoryStore, sampleOutput } from './helpers.js';

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;
const USAGE = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };
const ok = (output = sampleOutput()): BrainResult => ({ kind: 'ok', output, usage: USAGE });

function dm(text: string | null, mid: string): MessageEvent {
  return { kind: 'message', accountId: ACCOUNT_ID, senderId: STRANGER_ID, recipientId: ACCOUNT_ID, mid, text, isEcho: false };
}

interface SetupOptions {
  readonly mode?: string | null;
  readonly brain?: SetterBrain | null;
  readonly sendOk?: boolean;
  readonly username?: string | null;
}

async function setup(options: SetupOptions = {}) {
  const store = createMemoryStore();
  store.settings.set(SETTINGS.setterMode, options.mode === undefined ? 'test' : options.mode);
  store.settings.set(SETTINGS.setterTestUsernames, '@JoseGomezLife, otra_cuenta');
  await store.saveKnowledge('Eres el setter de Jose. Agenda: [LINK AGENDA]');
  const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok());
  // Cola falsa: hace lo mismo que Sender (reserva la acción y la termina con la respuesta de Meta).
  const enqueue = vi.fn(async (actions: readonly Action[]) => {
    for (const action of actions) {
      await store.claimAction(action.dedupKey, action.type, action);
      await store.finishAction(action.dedupKey, options.sendOk ?? true, options.sendOk === false ? { error: 'x' } : { recipientId: STRANGER_ID, messageId: `out-${action.dedupKey}` });
    }
  });
  const getUsername = vi.fn().mockResolvedValue(options.username === undefined ? 'josegomezlife' : options.username);
  const showTyping = vi.fn().mockResolvedValue(undefined);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const timers: (() => void)[] = [];
  const service = new SetterService({
    store,
    brain: options.brain === undefined ? { decide } : options.brain,
    links: TEST_SETTER_LINKS,
    enqueue,
    getUsername,
    showTyping,
    sleep,
    random: () => 0,
    setTimer: (fn) => timers.push(fn) - 1,
    clearTimer: (handle) => {
      timers[handle as number] = () => undefined;
    },
  });
  /** Hace como si pasaran los 8 segundos y espera a que termine la respuesta. */
  const flush = async () => {
    timers.splice(0).forEach((fn) => fn());
    await service.idle();
  };
  return { store, decide, enqueue, getUsername, showTyping, sleep, service, flush };
}

describe('SetterService', () => {
  it('responde en varios mensajitos por la cola, cada uno con "escribiendo…" y pausa, y guarda la ficha', async () => {
    const { store, decide, enqueue, showTyping, sleep, service, flush } = await setup();
    await service.onIncoming(dm('hola, quiero info', 'm-1'));
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    const [system, messages] = decide.mock.calls[0] ?? [];
    expect(system).toContain(`Agenda: ${TEST_SETTER_LINKS.agenda}`);
    expect(messages).toEqual([{ role: 'user', content: 'hola, quiero info' }]);
    const [first, second] = sampleOutput().messages;
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual([
      [expect.objectContaining({ type: 'send_message', dedupKey: 'ai:m-1:1', recipientId: STRANGER_ID, message: expect.objectContaining({ text: first, buttons: [] }) })],
      [expect.objectContaining({ type: 'send_message', dedupKey: 'ai:m-1:2', recipientId: STRANGER_ID, message: expect.objectContaining({ text: second, buttons: [] }) })],
    ]);
    expect(showTyping).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([typingDelayMs(first ?? '', 0), typingDelayMs(second ?? '', 0)]);
    expect(store.messages.map((m) => [m.direction, m.source, m.status, m.mid])).toEqual([
      ['in', 'user', 'sent', 'm-1'],
      ['out', 'ai', 'sent', 'out-ai:m-1:1'],
      ['out', 'ai', 'sent', 'out-ai:m-1:2'],
    ]);
    expect((await store.getContact(STRANGER_ID))?.lead).toEqual(sampleOutput().lead);
  });

  it('espera por si la persona escribe varios mensajes y responde una sola vez a todos', async () => {
    const { decide, service, flush } = await setup();
    await service.onIncoming(dm('hola', 'm-1'));
    await service.onIncoming(dm('vi tu reel', 'm-2'));
    await service.idle();
    expect(decide).not.toHaveBeenCalled(); // todavía no han pasado los 8 s
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]?.[1]).toEqual([{ role: 'user', content: 'hola\nvi tu reel' }]);
  });

  it('no responde dos veces al mismo mensaje', async () => {
    const { decide, enqueue, service, flush } = await setup();
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    await service.replyNow(STRANGER_ID);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(sampleOutput().messages.length); // una vez cada mensajito, ninguno repetido
  });

  it('apagado: guarda el DM pero no llama a Claude', async () => {
    const { store, decide, service, flush } = await setup({ mode: null });
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(store.messages).toHaveLength(1);
    expect(decide).not.toHaveBeenCalled();
  });

  it('modo prueba: solo responde a los usuarios de la lista (busca el username en Meta y lo guarda)', async () => {
    const allowed = await setup({ username: 'JoseGomezLife' });
    await allowed.service.onIncoming(dm('hola', 'm-1'));
    await allowed.flush();
    expect(allowed.decide).toHaveBeenCalledTimes(1);
    expect((await allowed.store.getContact(STRANGER_ID))?.username).toBe('JoseGomezLife');

    const stranger = await setup({ username: 'desconocida' });
    await stranger.service.onIncoming(dm('hola', 'm-1'));
    await stranger.flush();
    expect(stranger.decide).not.toHaveBeenCalled();
    expect(stranger.store.events.at(-1)?.note).toContain('@desconocida no está en la lista');
  });

  it('modo público: responde a cualquiera sin mirar el username', async () => {
    const { decide, getUsername, service, flush } = await setup({ mode: 'live', username: null });
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(getUsername).not.toHaveBeenCalled();
  });

  it('si la IA está parada en esa conversación, no responde', async () => {
    const { store, decide, service, flush } = await setup();
    await store.setAiPaused(STRANGER_ID, true, 'Jose escribió a mano');
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(decide).not.toHaveBeenCalled();
  });

  it('un enlace no permitido NO sale: se retiene y la IA se para para Jose', async () => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: ['Paga aquí: https://otro-pago.com/vip'] })));
    await service.onIncoming(dm('quiero el vip', 'm-1'));
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.messages.at(-1)).toMatchObject({ direction: 'out', status: 'held', note: expect.stringContaining('Enlace no permitido') });
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: expect.stringContaining('Respuesta retenida') });
  });

  it('si la primera respuesta lleva un enlace prohibido pero el segundo intento es bueno, sale el bueno y la IA sigue activa', async () => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValueOnce(ok(sampleOutput({ messages: ['paga en https://otro.com'] }))).mockResolvedValueOnce(ok(sampleOutput({ messages: ['te paso la agenda y lo vemos'] })));
    await service.onIncoming(dm('quiero pagar', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(store.messages.at(-1)).toMatchObject({ text: 'te paso la agenda y lo vemos', status: 'sent' });
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBeFalsy();
  });

  it('el enlace de agenda permitido sí sale', async () => {
    const { enqueue, service, decide, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: [`Agenda tu llamada aquí: ${TEST_SETTER_LINKS.agenda}`] })));
    await service.onIncoming(dm('vale, agendo', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rechazo', { kind: 'refusal', detail: 'Claude rechazó responder' } as BrainResult, 'Claude rechazó responder'],
    ['fallo', { kind: 'failed', detail: 'sin conexión' } as BrainResult, 'Fallo al llamar a Claude'],
  ])('si Claude da %s, no se envía nada y la conversación queda parada para Jose', async (_name, result, reason) => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValue(result);
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: expect.stringContaining(reason) });
  });

  it('si la IA pide a Jose, envía su respuesta corta y se para', async () => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: ['Le paso tu mensaje al equipo.'], needs_human: true, needs_human_reason: 'Queja por un pago' })));
    await service.onIncoming(dm('me cobraron dos veces', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: expect.stringContaining('Queja por un pago') });
  });

  it('posible menor de edad: la IA se para', async () => {
    const { store, decide, service, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: ['Gracias por escribir, ¡mucho ánimo con tus estudios!'] }, { es_menor: 'si' })));
    await service.onIncoming(dm('tengo 15 años', 'm-1'));
    await flush();
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: 'Posible menor de edad.' });
  });

  it('modo borrador: la respuesta se retiene para aprobar, sin enviar y sin parar la IA', async () => {
    const { store, enqueue, service, flush } = await setup();
    store.settings.set(SETTINGS.setterDraft, 'true');
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.messages.at(-1)).toMatchObject({ status: 'held', note: 'Modo borrador: pendiente de aprobar' });
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(false);
  });

  it('modo borrador con varios mensajitos: se retienen todos, cada uno con su clave', async () => {
    const { store, service, flush } = await setup();
    store.settings.set(SETTINGS.setterDraft, 'true');
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(store.messages.filter((m) => m.direction === 'out').map((m) => [m.status, m.dedupKey])).toEqual([
      ['held', 'ai:m-1:1'],
      ['held', 'ai:m-1:2'],
    ]);
  });

  it('si Instagram no acepta un mensajito, queda como fallido y NO salen los siguientes', async () => {
    const { store, enqueue, service, flush } = await setup({ sendOk: false });
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(store.messages.filter((m) => m.direction === 'out')).toEqual([expect.objectContaining({ status: 'failed', dedupKey: 'ai:m-1:1' })]);
  });

  it('si falla el "escribiendo…", el mensaje sale igual (y queda registrado)', async () => {
    const { store, enqueue, showTyping, service, flush } = await setup();
    showTyping.mockRejectedValue(new Error('Meta no lo admite'));
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(store.events.some((e) => e.note.includes('No se pudo mostrar "escribiendo…"'))).toBe(true);
  });

  it('más de 4 mensajitos: junta los sobrantes en el último y los envía (no retiene)', async () => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: ['uno', 'dos', 'tres', 'cuatro', 'cinco'] })));
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).toHaveBeenCalledTimes(4);
    expect(store.messages.at(-1)).toMatchObject({ text: 'cuatro cinco', status: 'sent' });
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBeFalsy();
  });

  it.each([
    ['un mensajito larguísimo', ['a'.repeat(301)], 'demasiado largo'],
    ['el precio del VIP', ['el VIP son $4.997 por 6 meses'], 'precio del grupal o del VIP'],
  ])('%s: no sale nada, se retiene y la IA se para', async (_name, bubbles, reason) => {
    const { store, decide, enqueue, service, flush } = await setup();
    decide.mockResolvedValue(ok(sampleOutput({ messages: bubbles })));
    await service.onIncoming(dm('hola', 'm-1'));
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.messages.at(-1)).toMatchObject({ status: 'held', note: expect.stringContaining(reason) });
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(true);
  });

  it('la pausa entre mensajitos es de unos 3-4 s según lo largo', () => {
    expect(typingDelayMs('ok', 0)).toBe(3020);
    expect(typingDelayMs('a'.repeat(100), 0)).toBe(4000);
    expect(typingDelayMs('a'.repeat(300), 0.99)).toBeLessThanOrEqual(4400);
  });

  it('sin clave de Anthropic o sin documento: guarda el DM, no responde y lo deja registrado', async () => {
    const noKey = await setup({ brain: null });
    await noKey.service.onIncoming(dm('hola', 'm-1'));
    await noKey.flush();
    expect(noKey.store.events.at(-1)?.note).toContain('sin ANTHROPIC_API_KEY');

    const noDoc = await setup();
    noDoc.store.knowledge.splice(0);
    await noDoc.service.onIncoming(dm('hola', 'm-1'));
    await noDoc.flush();
    expect(noDoc.decide).not.toHaveBeenCalled();
    expect(noDoc.store.events.at(-1)?.note).toContain('No hay documento');
  });

  it('al arrancar contesta las conversaciones que esperan respuesta y son recientes (no las viejas ni las ya contestadas)', async () => {
    // Caso: el servidor se reinicia (despliegue) durante la espera de 8 s y el DM queda sin respuesta.
    const { store, decide, service } = await setup();
    await service.record(dm('hola, quiero info', 'm-1'));
    await store.addMessage({ igId: 'viejo', direction: 'in', source: 'user', text: 'hace horas', mid: 'm-v', status: 'sent', dedupKey: null });
    const old = store.messages.find((m) => m.mid === 'm-v');
    if (old) store.messages[store.messages.indexOf(old)] = { ...old, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) };
    await store.addMessage({ igId: 'contestado', direction: 'in', source: 'user', text: 'hola', mid: 'm-c', status: 'sent', dedupKey: null });
    await store.addMessage({ igId: 'contestado', direction: 'out', source: 'ai', text: 'hey', mid: 'm-c2', status: 'sent', dedupKey: 'ai:m-c' });
    expect(await service.resumePending(new Date(Date.now() - 60 * 60 * 1000))).toBe(1);
    await service.idle();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('un "sí" que contestó el flujo NO lo contesta el setter (ni al arrancar ni al reanudar)', async () => {
    const { decide, service } = await setup();
    await service.record(dm('si', 'm-si'), FLOW_HANDLED_NOTE);
    await service.resumePending(new Date(Date.now() - 60 * 60 * 1000));
    await service.replyNow(STRANGER_ID);
    expect(decide).not.toHaveBeenCalled();
  });

  it('al apagarse (SIGTERM del despliegue) contesta ya lo que esperaba los 8 s en vez de perderlo', async () => {
    const { decide, service } = await setup();
    await service.onIncoming(dm('hola', 'm-1'));
    service.flushPending(); // sin que pasen los 8 s
    await service.idle();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('al arrancar con el setter apagado no contesta nada', async () => {
    const { decide, service } = await setup({ mode: 'off' });
    await service.record(dm('hola', 'm-1'));
    await service.resumePending(new Date(Date.now() - 60 * 60 * 1000));
    await service.idle();
    expect(decide).not.toHaveBeenCalled();
  });

  it('un DM sin texto (audio, foto) se guarda con un aviso que Claude entiende', async () => {
    const { store, service } = await setup();
    await service.onIncoming(dm(null, 'm-1'));
    expect(store.messages[0]?.text).toBe(NO_TEXT_PLACEHOLDER);
  });
});

describe('parseUsernames', () => {
  it('acepta comas, espacios, @ y mayúsculas', () => {
    expect(parseUsernames(' @JoseGomezLife, otra_cuenta ,, ')).toEqual(['josegomezlife', 'otra_cuenta']);
    expect(parseUsernames(null)).toEqual([]);
  });
});
