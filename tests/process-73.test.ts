import { describe, expect, it, vi } from 'vitest';
import { encodePayload, encodeStartPayload } from '../src/flows/engine.js';
import { validateFlow, type Flow, type FlowInput } from '../src/flows/types.js';
import type { InstagramClient } from '../src/meta/client.js';
import { processWebhook } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { ACCOUNT_ID, STRANGER_ID, createMemoryStore, messagePayload, postbackPayload } from './helpers.js';

/** Fase 7.3a: avisos que llegan por DM y hacen saltar flujos (palabra clave, historia, mención, ig.me, respuesta rápida). */

function flow(overrides: Partial<FlowInput>): Flow {
  const result = validateFlow({
    id: 'guia',
    name: 'Palabra GUIA',
    enabled: true,
    trigger: { type: 'dm_keyword', keywords: ['guia'] },
    publicReplies: [],
    startNodeId: 'm',
    nodes: [
      { id: 'm', type: 'message', text: 'Aquí tienes la guía', buttons: [], quickReplies: [{ title: 'Más', next: 'mas' }] },
      { id: 'mas', type: 'message', text: 'Más cosas', buttons: [] },
    ],
    testUsernames: [],
    oncePerUser: true,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.flow;
}

function setup(flows: Flow[]) {
  const store = createMemoryStore();
  for (const item of flows) store.flows.set(item.id, item);
  const client = {
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'out' }),
    getProfile: vi.fn().mockResolvedValue(null),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined },
    async (id) => store.flows.get(id),
  );
  const setter = { onIncoming: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined) };
  return { store, client, sender, setter, deps: { store, sender, setter, random: () => 0 } };
}

const dm = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  object: 'instagram',
  entry: [{ id: ACCOUNT_ID, time: 1, messaging: [{ sender: { id: STRANGER_ID }, recipient: { id: ACCOUNT_ID }, timestamp: 1760000000000, message, ...extra }] }],
});

const sentTexts = (client: Record<string, ReturnType<typeof vi.fn>>) => (client.sendMessage?.mock.calls ?? []).map((call) => (call[1] as { text?: string }).text);

describe('flujos que empiezan por DM', () => {
  it('palabra clave → responde el flujo y el setter solo lo guarda', async () => {
    const { client, sender, setter, deps } = setup([flow({})]);
    await processWebhook(messagePayload('Hola, quiero la GUÍA', { mid: 'in-1' }), deps);
    await sender.idle();
    expect(sentTexts(client)).toEqual(['Aquí tienes la guía']);
    expect(setter.record).toHaveBeenCalledTimes(1);
    expect(setter.onIncoming).not.toHaveBeenCalled();
  });

  it('sin palabra clave → el DM es para el setter', async () => {
    const { client, setter, deps } = setup([flow({})]);
    await processWebhook(messagePayload('hola'), deps);
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
  });

  it('"una vez por persona": la segunda vez no repite el flujo y el mensaje pasa al setter', async () => {
    const { client, sender, setter, deps } = setup([flow({})]);
    await processWebhook(messagePayload('guia', { mid: 'in-1' }), deps);
    await processWebhook(messagePayload('guia otra vez', { mid: 'in-2' }), deps);
    await sender.idle();
    expect(sentTexts(client)).toEqual(['Aquí tienes la guía']);
    expect(setter.onIncoming).toHaveBeenCalledTimes(1);
  });

  it('pulsar una respuesta rápida lleva a su paso', async () => {
    const { client, sender, setter, deps } = setup([flow({})]);
    await processWebhook(dm({ mid: 'qr-1', text: 'Más', quick_reply: { payload: encodePayload('guia', 'mas') } }), deps);
    await sender.idle();
    expect(sentTexts(client)).toEqual(['Más cosas']);
    expect(setter.onIncoming).not.toHaveBeenCalled();
  });

  it('mención en una historia y respuesta a una historia', async () => {
    const mention = flow({ id: 'mencion', trigger: { type: 'story_mention' }, oncePerUser: false });
    const story = flow({ id: 'historia', trigger: { type: 'story_reply', keywords: [] }, oncePerUser: false });
    const { client, sender, deps } = setup([mention, story]);
    await processWebhook(dm({ mid: 'sm-1', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/x' } }] }), deps);
    await processWebhook(dm({ mid: 'sr-1', text: '🔥', reply_to: { story: { id: '1', url: 'https://cdn/y' } } }), deps);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('abrir el chat desde ig.me con ref → empieza su flujo (una vez por aviso)', async () => {
    const { client, sender, setter, deps } = setup([flow({ id: 'ref', trigger: { type: 'ref', ref: 'guia_n8n' } })]);
    const referral = {
      object: 'instagram',
      entry: [{ id: ACCOUNT_ID, time: 1, messaging: [{ sender: { id: STRANGER_ID }, recipient: { id: ACCOUNT_ID }, timestamp: 1760000000123, referral: { ref: 'guia_n8n', type: 'OPEN_THREAD' } }] }],
    };
    await processWebhook(referral, deps);
    await processWebhook(referral, deps);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(setter.onIncoming).not.toHaveBeenCalled();
  });

  it('rompehielos / menú: el botón S:<flujo> empieza el flujo', async () => {
    const { client, sender, deps } = setup([flow({ id: 'menu', trigger: { type: 'manual' } })]);
    await processWebhook(postbackPayload(encodeStartPayload('menu')), deps);
    await sender.idle();
    expect(sentTexts(client)).toEqual(['Aquí tienes la guía']);
  });

  it('modo prueba: solo salta para los usuarios de la lista (el usuario sale de su contacto)', async () => {
    const { client, store, sender, deps } = setup([flow({ testUsernames: ['josegomezlife'] })]);
    await processWebhook(messagePayload('guia', { mid: 'in-1' }), deps);
    await sender.idle();
    expect(client.sendMessage).not.toHaveBeenCalled();
    await store.touchContact(STRANGER_ID, 'josegomezlife');
    await processWebhook(messagePayload('guia', { mid: 'in-2' }), deps);
    await sender.idle();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
});
