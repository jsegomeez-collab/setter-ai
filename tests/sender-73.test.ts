import { describe, expect, it, vi } from 'vitest';
import type { Action, OutMessage } from '../src/flows/engine.js';
import { validateFlow, type Flow } from '../src/flows/types.js';
import type { InstagramClient } from '../src/meta/client.js';
import { Sender, toApiMessage } from '../src/sender.js';
import { STRANGER_ID, createMemoryStore } from './helpers.js';

/** Fase 7.3a: formatos de envío nuevos (doc oficial de Meta) y pasos de "hacer" en la cola. */

const base: OutMessage = { text: 'Hola', buttons: [], flowId: 'f', nodeId: 'n', recipientId: STRANGER_ID };
const signer = { baseUrl: 'https://app.test', secret: 's' };

describe('formato de los mensajes nuevos', () => {
  it('respuestas rápidas: texto + quick_replies con flujo:paso en el payload', () => {
    expect(toApiMessage({ ...base, quickReplies: [{ title: 'Vídeo', next: 'v' }] })).toEqual({
      text: 'Hola',
      quick_replies: [{ content_type: 'text', title: 'Vídeo', payload: 'F:f:v' }],
    });
  });

  it('carrusel: plantilla generic con foto, enlace al tocar y botones (los de enlace, con seguimiento)', () => {
    const api = toApiMessage(
      {
        ...base,
        cards: [
          {
            title: 'Curso',
            subtitle: 'Paso a paso',
            imageUrl: 'https://e.com/a.png',
            url: 'https://e.com/curso',
            buttons: [
              { type: 'url', title: 'Ver', url: 'https://e.com/ver', tags: ['vio-curso'] },
              { type: 'postback', title: 'Más', next: 'mas' },
            ],
          },
        ],
      },
      signer,
    ) as unknown as { attachment: { payload: { template_type: string; elements: { buttons: { type: string; url?: string; payload?: string }[]; default_action: unknown }[] } } };
    expect(api.attachment.payload.template_type).toBe('generic');
    const [card] = api.attachment.payload.elements;
    expect(card).toMatchObject({ title: 'Curso', subtitle: 'Paso a paso', image_url: 'https://e.com/a.png', default_action: { type: 'web_url', url: expect.stringMatching(/^https:\/\/app\.test\/l\//) } });
    expect(card?.buttons[0]?.url).toMatch(/^https:\/\/app\.test\/l\//);
    expect(card?.buttons[1]).toEqual({ type: 'postback', title: 'Más', payload: 'F:f:mas' });
  });

  it('archivos: imagen en "attachments" (lista); vídeo, audio y PDF en "attachment"', () => {
    expect(toApiMessage({ ...base, text: '', media: { kind: 'image', url: 'https://e.com/a.png' } })).toEqual({
      attachments: [{ type: 'image', payload: { url: 'https://e.com/a.png' } }],
    });
    expect(toApiMessage({ ...base, text: '', media: { kind: 'file', url: 'https://e.com/a.pdf' } })).toEqual({
      attachment: { type: 'file', payload: { url: 'https://e.com/a.pdf' } },
    });
  });
});

function flowWith(): Flow {
  const result = validateFlow({
    id: 'f',
    name: 'Flujo',
    enabled: true,
    trigger: { type: 'manual' },
    publicReplies: [],
    startNodeId: 't',
    nodes: [
      { id: 't', type: 'tag', op: 'add', tag: 'paso-1', next: 'm' },
      { id: 'm', type: 'message', text: 'Listo', buttons: [] },
    ],
    testUsernames: [],
    oncePerUser: false,
  });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.flow;
}

function setup() {
  const store = createMemoryStore();
  const client = {
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'out-1' }),
    sendReaction: vi.fn().mockResolvedValue({}),
    getProfile: vi.fn().mockResolvedValue(null),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const flow = flowWith();
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined, random: () => 0 },
    async (id) => (id === flow.id ? flow : undefined),
  );
  return { store, client, sender };
}

describe('pasos nuevos en la cola', () => {
  it('un paso de "hacer" se ejecuta y encola lo siguiente', async () => {
    const { store, client, sender } = setup();
    const step: Action = { type: 'flow_step', dedupKey: 'x:t', recipientId: STRANGER_ID, flowId: 'f', nodeId: 't', depth: 0 };
    await sender.enqueue([step]);
    await sender.idle();
    expect((await store.getContact(STRANGER_ID))?.tags).toEqual(['paso-1']);
    expect(client.sendMessage).toHaveBeenCalledWith(STRANGER_ID, { text: 'Listo' });
    expect((await store.getAction('x:t'))?.ok).toBe(true);
  });

  it('la reacción va al último mensaje de la persona; sin mensaje suyo, no se envía', async () => {
    const { store, client, sender } = setup();
    await sender.enqueue([{ type: 'react', dedupKey: 'r:1', recipientId: STRANGER_ID, emoji: '🔥' }]);
    await sender.idle();
    expect(client.sendReaction).not.toHaveBeenCalled();
    expect((await store.getAction('r:1'))?.response).toMatchObject({ skipped: expect.any(String) });
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola', mid: 'in-7', status: 'sent', dedupKey: null });
    await sender.enqueue([{ type: 'react', dedupKey: 'r:2', recipientId: STRANGER_ID, emoji: '🔥' }]);
    await sender.idle();
    expect(client.sendReaction).toHaveBeenCalledWith(STRANGER_ID, 'in-7', '🔥');
  });
});
