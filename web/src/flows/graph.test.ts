import { describe, expect, it } from 'vitest';
import { addStep, autoLayout, connect, disconnect, missingConnections, outputsOf, removeStep, setStart, toCanvas } from './graph';
import type { Flow } from './types';

/** Lienzo del constructor (Fase 6.5b): pasar un flujo a cajas y flechas y editarlo sin mutar nada. */

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
    { id: 'gate', type: 'follow_gate', ifFollowing: 'ok', ifNotFollowing: 'follow', ifUnknown: 'ok' },
    { id: 'ok', type: 'message', text: 'Aquí tienes', buttons: [{ type: 'url', title: 'Abrir', url: 'https://x.com', tags: [] }], next: 'wait' },
    { id: 'follow', type: 'message', text: 'Sígueme', buttons: [{ type: 'postback', title: 'Ya te sigo', next: 'gate' }] },
    { id: 'wait', type: 'delay', seconds: 900, next: 'ai' },
    { id: 'ai', type: 'setter_opener', texts: ['¿a qué te dedicas?'] },
  ],
  testUsernames: [],
  oncePerUser: true,
  onceScope: 'media',
};

describe('toCanvas', () => {
  it('una caja por paso y una flecha por salida conectada, con su texto', () => {
    const { nodes, edges } = toCanvas(flow);
    expect(nodes.map((n) => [n.id, n.isStart])).toEqual([
      ['start', true],
      ['gate', false],
      ['ok', false],
      ['follow', false],
      ['wait', false],
      ['ai', false],
    ]);
    expect(edges.map((e) => [e.source, e.sourceHandle, e.target, e.label])).toEqual([
      ['start', 'btn-0', 'gate', 'Lo quiero'],
      ['gate', 'yes', 'ok', 'Sí sigue'],
      ['gate', 'no', 'follow', 'No sigue'],
      ['gate', 'unknown', 'ok', 'No se sabe'],
      ['ok', 'next', 'wait', 'Después'],
      ['follow', 'btn-0', 'gate', 'Ya te sigo'],
      ['wait', 'next', 'ai', 'Después'],
    ]);
  });

  it('usa las posiciones guardadas; si faltan, las calcula por columnas desde el inicio', () => {
    const positioned = toCanvas({ ...flow, layout: { start: { x: 5, y: 6 } } });
    expect(positioned.nodes[0]?.position).toEqual({ x: 5, y: 6 });
    const layout = autoLayout(flow);
    expect(layout.start?.x).toBeLessThan(layout.gate?.x ?? 0);
    expect(layout.gate?.x).toBeLessThan(layout.ok?.x ?? 0);
    expect(layout.ok?.y).not.toBe(layout.follow?.y);
  });
});

describe('outputsOf', () => {
  it('mensaje: un botón de acción = una salida (los de enlace no) + "después"; condición: 3; inicio del setter: ninguna', () => {
    const [start, gate, ok, , wait, ai] = flow.nodes;
    expect(outputsOf(start!).map((o) => o.handle)).toEqual(['btn-0', 'next']);
    expect(outputsOf(ok!).map((o) => o.handle)).toEqual(['next']);
    expect(outputsOf(gate!).map((o) => o.handle)).toEqual(['yes', 'no', 'unknown']);
    expect(outputsOf(wait!).map((o) => o.handle)).toEqual(['next']);
    expect(outputsOf(ai!)).toEqual([]);
  });
});

describe('missingConnections', () => {
  it('dice en español qué salida de qué paso falta por conectar (el "después" de un mensaje es opcional)', () => {
    expect(missingConnections(flow)).toEqual([]);
    const { flow: added } = addStep(flow, 'follow_gate', { x: 0, y: 0 });
    expect(missingConnections(added)).toEqual(['«¿Me sigue?» (paso-7): falta a dónde va «Sí sigue», «No sigue» y «No se sabe».']);
    expect(missingConnections(disconnect(flow, 'start', 'btn-0'))).toEqual(['«Mensaje: Hola» (start): falta a dónde va «Lo quiero».']);
  });
});

describe('editar', () => {
  it('conectar y desconectar cambian solo el campo de esa salida, sin tocar el original', () => {
    const connected = connect(flow, 'gate', 'unknown', 'follow');
    expect(connected.nodes[1]).toMatchObject({ ifUnknown: 'follow', ifFollowing: 'ok' });
    expect(flow.nodes[1]).toMatchObject({ ifUnknown: 'ok' });
    const cut = disconnect(connected, 'ok', 'next');
    expect(cut.nodes[2]).not.toHaveProperty('next');
    expect(disconnect(flow, 'start', 'btn-0').nodes[0]).toMatchObject({ buttons: [{ title: 'Lo quiero', next: '' }] });
  });

  it('añadir un paso le da un id libre y su posición; quitarlo limpia las flechas que llegaban a él', () => {
    const { flow: added, id } = addStep(flow, 'message', { x: 100, y: 200 });
    expect(added.nodes).toHaveLength(7);
    expect(flow.nodes.map((n) => n.id)).not.toContain(id);
    expect(added.layout?.[id]).toEqual({ x: 100, y: 200 });

    const removed = removeStep(flow, 'ok');
    expect(removed.nodes.map((n) => n.id)).not.toContain('ok');
    expect(removed.nodes.find((n) => n.id === 'gate')).toMatchObject({ ifFollowing: '', ifUnknown: '' });
    expect(removeStep(flow, 'start')).toBe(flow);
  });

  it('cambiar el primer mensaje: solo a un mensaje y le quita el "después" automático (Meta no lo permite)', () => {
    const changed = setStart(flow, 'ok');
    expect(changed.startNodeId).toBe('ok');
    expect(changed.nodes[2]).not.toHaveProperty('next');
    expect(setStart(flow, 'gate')).toBe(flow);
  });
});
