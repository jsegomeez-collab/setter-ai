import { describe, expect, it } from 'vitest';
import {
  encodePayload,
  encodeStartPayload,
  explainComment,
  explainMessage,
  findFlowForMessage,
  planMessageTrigger,
  planNode,
  planPostback,
  planQuickReply,
  type MessageProbe,
} from '../src/flows/engine.js';
import { validateFlow, type Flow, type FlowInput } from '../src/flows/types.js';
import { ACCOUNT_ID, STRANGER_ID, followFlow } from './helpers.js';

/** Fase 7.3a: formas de empezar por DM y pasos nuevos en el motor (funciones puras). */

function flow(overrides: Partial<FlowInput>): Flow {
  const result = validateFlow({
    id: 'f',
    name: 'Flujo',
    enabled: true,
    trigger: { type: 'dm_keyword', keywords: ['guia'] },
    publicReplies: [],
    startNodeId: 'm',
    nodes: [{ id: 'm', type: 'message', text: 'Hola', buttons: [] }],
    testUsernames: [],
    oncePerUser: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.flow;
}

const probe = (overrides: Partial<MessageProbe> = {}): MessageProbe => ({ text: null, username: 'ana', storyReply: false, storyMention: false, ref: null, ...overrides });

describe('qué flujo salta con un DM', () => {
  it('palabra clave: contiene (sin tildes ni mayúsculas) o exacta', () => {
    const contains = flow({ id: 'contiene' });
    const exact = flow({ id: 'exacta', trigger: { type: 'dm_keyword', keywords: ['guia'], exact: true } });
    expect(explainMessage(contains, probe({ text: 'Quiero la GUÍA porfa' })).matches).toBe(true);
    expect(explainMessage(exact, probe({ text: 'Quiero la guía' })).matches).toBe(false);
    expect(explainMessage(exact, probe({ text: '¡Guía!' })).matches).toBe(true);
    expect(explainMessage(contains, probe({ text: 'hola' })).reasons.join(' ')).toContain('palabra clave');
  });

  it('respuesta a historia, mención y enlace ig.me solo saltan con su aviso', () => {
    const story = flow({ id: 's', trigger: { type: 'story_reply', keywords: [] } });
    const mention = flow({ id: 'm1', trigger: { type: 'story_mention' } });
    const ref = flow({ id: 'r', trigger: { type: 'ref', ref: 'guia_n8n' } });
    expect(explainMessage(story, probe({ text: '🔥', storyReply: true })).matches).toBe(true);
    expect(explainMessage(story, probe({ text: '🔥' })).matches).toBe(false);
    expect(explainMessage(mention, probe({ storyMention: true })).matches).toBe(true);
    expect(explainMessage(ref, probe({ ref: 'guia_n8n' })).matches).toBe(true);
    expect(explainMessage(ref, probe({ ref: 'otro' })).matches).toBe(false);
  });

  it('"solo desde otro flujo" y los de comentarios nunca saltan con un DM; y al revés', () => {
    expect(explainMessage(flow({ trigger: { type: 'manual' } }), probe({ text: 'guia' })).matches).toBe(false);
    expect(explainMessage(followFlow(), probe({ text: 'guia' })).matches).toBe(false);
    expect(explainComment(flow({}), { text: 'guia', username: 'ana', mediaId: null }).reasons.join(' ')).toContain('no empieza con comentarios');
  });

  it('modo prueba: solo las personas de la lista (y sin usuario conocido, no salta)', () => {
    const test = flow({ testUsernames: ['josegomezlife'] });
    expect(explainMessage(test, probe({ text: 'guia', username: 'JoseGomezLife' })).matches).toBe(true);
    expect(explainMessage(test, probe({ text: 'guia', username: null })).matches).toBe(false);
  });

  it('gana el más concreto: ig.me > mención > historia > palabra exacta > palabra que contiene', () => {
    const all = [
      flow({ id: 'a-contiene' }),
      flow({ id: 'b-exacta', trigger: { type: 'dm_keyword', keywords: ['guia'], exact: true } }),
      flow({ id: 'c-historia', trigger: { type: 'story_reply', keywords: [] } }),
      flow({ id: 'd-ref', trigger: { type: 'ref', ref: 'x' } }),
    ];
    expect(findFlowForMessage(all, probe({ text: 'guia' }))?.id).toBe('b-exacta');
    expect(findFlowForMessage(all, probe({ text: 'guia', storyReply: true }))?.id).toBe('c-historia');
    expect(findFlowForMessage(all, probe({ text: 'guia', ref: 'x' }))?.id).toBe('d-ref');
    expect(findFlowForMessage(all.map((f) => ({ ...f, enabled: false })), probe({ text: 'guia' }))).toBeNull();
  });

  it('el plan lleva clave por mensaje y, si es "una vez por persona", la clave de una vez', () => {
    const plan = planMessageTrigger([flow({ oncePerUser: true })], probe({ text: 'guia' }), STRANGER_ID, 'msg:mid-1');
    expect(plan?.actions[0]).toMatchObject({ type: 'send_message', dedupKey: 'msg:mid-1:m', recipientId: STRANGER_ID });
    expect(plan?.onceKey).toBe(`once:f:${STRANGER_ID}`);
    expect(planMessageTrigger([flow({})], probe({ text: 'hola' }), STRANGER_ID, 'msg:mid-2')).toBeNull();
  });
});

describe('pasos nuevos', () => {
  const rich = flow({
    startNodeId: 'q',
    nodes: [
      { id: 'q', type: 'message', text: '¿Qué prefieres?', buttons: [], quickReplies: [{ title: 'Vídeo', next: 'v' }], next: 't' },
      { id: 't', type: 'tag', op: 'add', tag: 'pregunto' },
      { id: 'v', type: 'media', kind: 'video', url: 'https://example.com/v.mp4', next: 'c' },
      { id: 'c', type: 'carousel', cards: [{ title: 'Uno', subtitle: 'a' }], next: 'r' },
      { id: 'r', type: 'react', emoji: '🔥', next: 'k' },
      { id: 'k', type: 'condition', rule: { kind: 'random', percent: 50 }, ifTrue: 'g', ifFalse: 't' },
      { id: 'g', type: 'goto', flowId: 'otro' },
    ],
  });

  it('un mensaje con respuestas rápidas se envía con ellas y sigue con los pasos de "hacer" en orden', () => {
    const actions = planNode(rich, 'q', STRANGER_ID, 'base');
    expect(actions.map((a) => a.type)).toEqual(['send_message', 'flow_step']);
    expect(actions[0]).toMatchObject({ message: { quickReplies: [{ title: 'Vídeo', next: 'v' }] } });
    expect(actions[1]).toMatchObject({ dedupKey: 'base:q:t', flowId: 'f', nodeId: 't', recipientId: STRANGER_ID });
  });

  it('archivo, carrusel y reacción se envían seguidos; la condición se decide al ejecutarse', () => {
    const actions = planNode(rich, 'v', STRANGER_ID, 'base');
    expect(actions.map((a) => a.type)).toEqual(['send_message', 'send_message', 'react', 'flow_step']);
    expect(actions[0]).toMatchObject({ message: { media: { kind: 'video', url: 'https://example.com/v.mp4' } } });
    expect(actions[1]).toMatchObject({ message: { cards: [{ title: 'Uno' }] } });
    expect(actions[2]).toMatchObject({ emoji: '🔥' });
  });

  it('rompehielos y menú (S:<flujo>) empiezan el flujo desde su primer paso', () => {
    const target = flow({ id: 'menu', trigger: { type: 'manual' } });
    const plan = planPostback([target], { kind: 'postback', accountId: ACCOUNT_ID, senderId: STRANGER_ID, mid: 'pb-9', title: 'Precios', payload: encodeStartPayload('menu') });
    expect(plan.actions[0]).toMatchObject({ type: 'send_message', dedupKey: 'pb:pb-9:m' });
    const off = planPostback([{ ...target, enabled: false }], { kind: 'postback', accountId: ACCOUNT_ID, senderId: STRANGER_ID, mid: 'pb-9', title: 'x', payload: encodeStartPayload('menu') });
    expect(off.actions).toEqual([]);
  });

  it('pulsar una respuesta rápida lleva a su paso (y la de otro sistema se ignora)', () => {
    const plan = planQuickReply([rich], encodePayload('f', 'v'), STRANGER_ID, 'qr-mid');
    expect(plan?.actions[0]).toMatchObject({ type: 'send_message', dedupKey: 'qr:qr-mid:v' });
    expect(planQuickReply([rich], 'MANYCHAT_1', STRANGER_ID, 'qr-mid')).toBeNull();
  });
});
