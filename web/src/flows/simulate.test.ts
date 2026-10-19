import { describe, expect, it } from 'vitest';
import { walk } from './simulate';
import type { Flow } from './types';

/** Probar un comentario (Fase 6.5c): qué recibe la persona, paso a paso, sin enviar nada. */

const flow: Flow = {
  id: 'f1',
  name: 'Reel',
  enabled: false,
  trigger: { mediaIds: 'all', keywords: [] },
  publicReplies: [],
  dmFailedReplies: [],
  startNodeId: 'start',
  nodes: [
    { id: 'start', type: 'message', text: 'Hola', buttons: [{ type: 'postback', title: 'Lo quiero', next: 'gate' }] },
    { id: 'gate', type: 'follow_gate', ifFollowing: 'ok', ifNotFollowing: 'follow', ifUnknown: '' },
    { id: 'ok', type: 'message', text: 'Aquí tienes', buttons: [], next: 'wait' },
    { id: 'follow', type: 'message', text: 'Sígueme', buttons: [] },
    { id: 'wait', type: 'delay', seconds: 900, next: 'ai' },
    { id: 'ai', type: 'setter_opener', texts: ['¿a qué te dedicas?', 'otro'] },
  ],
  testUsernames: [],
  oncePerUser: true,
  onceScope: 'media',
};

describe('walk', () => {
  it('el DM inicial se para esperando a que pulse un botón', () => {
    expect(walk(flow, 'start')).toEqual([{ kind: 'message', stepId: 'start', text: 'Hola', buttons: flow.nodes[0]!.type === 'message' ? flow.nodes[0]!.buttons : [] }]);
  });

  it('la condición se para para elegir; los pasos automáticos (después, pausa) siguen solos hasta el setter', () => {
    expect(walk(flow, 'gate')).toEqual([{ kind: 'gate', stepId: 'gate' }]);
    expect(walk(flow, 'ok').map((item) => item.kind)).toEqual(['message', 'wait', 'setter']);
    expect(walk(flow, 'ok')[2]).toEqual({ kind: 'setter', stepId: 'ai', text: '¿a qué te dedicas?' });
  });

  it('un camino sin conectar o un bucle automático se avisan en vez de colgarse', () => {
    expect(walk(flow, '')).toEqual([{ kind: 'broken', text: 'Este camino no lleva a ningún paso: conéctalo en el lienzo.' }]);
    const loop: Flow = { ...flow, nodes: [...flow.nodes, { id: 'a', type: 'delay', seconds: 60, next: 'b' }, { id: 'b', type: 'delay', seconds: 60, next: 'a' }] };
    expect(walk(loop, 'a').at(-1)).toEqual({ kind: 'broken', text: 'Demasiados pasos seguidos sin que la persona haga nada (¿un bucle?).' });
  });
});
