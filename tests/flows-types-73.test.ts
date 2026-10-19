import { describe, expect, it } from 'vitest';
import { validateFlow, type FlowInput } from '../src/flows/types.js';
import { followFlow } from './helpers.js';

/** Fase 7.3a: formas de empezar nuevas, pasos nuevos y sus reglas. */

function dmFlow(overrides: Partial<FlowInput> = {}): FlowInput {
  return {
    id: 'dm1',
    name: 'Palabra GUIA',
    enabled: true,
    trigger: { type: 'dm_keyword', keywords: ['guia'] },
    publicReplies: [],
    startNodeId: 'tag',
    nodes: [
      { id: 'tag', type: 'tag', op: 'add', tag: 'pidio-guia', next: 'msg' },
      { id: 'msg', type: 'message', text: 'Aquí tienes la guía', buttons: [], quickReplies: [{ title: 'Más info', next: 'cond' }] },
      { id: 'cond', type: 'condition', rule: { kind: 'has_tag', tag: 'vip' }, ifTrue: 'vip', ifFalse: 'normal' },
      { id: 'vip', type: 'media', kind: 'image', url: 'https://example.com/a.png' },
      { id: 'normal', type: 'carousel', cards: [{ title: 'Tarjeta', subtitle: 'Sub', buttons: [{ type: 'url', title: 'Ver', url: 'https://example.com' }] }], next: 'notify' },
      { id: 'notify', type: 'notify', text: 'Alguien pidió la guía', next: 'ai' },
      { id: 'ai', type: 'ai', paused: true, next: 'field' },
      { id: 'field', type: 'field', field: 'interes', value: 'guia', next: 'react' },
      { id: 'react', type: 'react', emoji: '❤️', next: 'goto' },
      { id: 'goto', type: 'goto', flowId: 'otro' },
    ],
    testUsernames: [],
    oncePerUser: false,
    ...overrides,
  };
}

const errorsOf = (input: unknown): string => {
  const result = validateFlow(input);
  return result.ok ? '' : result.errors.join(' | ');
};

describe('flujos antiguos', () => {
  it('un flujo guardado sin "type" en el disparador se lee como de comentarios', () => {
    const { trigger, ...rest } = followFlow();
    const legacy = { ...rest, trigger: { mediaIds: trigger.type === 'comment' ? trigger.mediaIds : 'all', keywords: [] } };
    const result = validateFlow(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.flow.trigger.type).toBe('comment');
  });

  it('los mensajes antiguos salen sin respuestas rápidas', () => {
    const result = validateFlow(followFlow());
    expect(result.ok && result.flow.nodes[0]?.type === 'message' && result.flow.nodes[0].quickReplies).toEqual([]);
  });
});

describe('formas de empezar nuevas', () => {
  it('acepta un flujo por palabra clave en DM con todos los pasos nuevos', () => {
    expect(errorsOf(dmFlow())).toBe('');
  });

  it('acepta historia, mención, ig.me y "solo desde otro flujo"', () => {
    for (const trigger of [{ type: 'story_reply', keywords: [] }, { type: 'story_mention' }, { type: 'ref', ref: 'guia_n8n' }, { type: 'manual' }]) {
      expect(errorsOf(dmFlow({ trigger: trigger as FlowInput['trigger'] }))).toBe('');
    }
  });

  it('la palabra clave por DM necesita al menos una palabra', () => {
    expect(errorsOf(dmFlow({ trigger: { type: 'dm_keyword', keywords: [] } }))).not.toBe('');
  });

  it('el ref de ig.me solo admite letras, números, - y _', () => {
    expect(errorsOf(dmFlow({ trigger: { type: 'ref', ref: 'hola mundo' } }))).not.toBe('');
  });
});

describe('reglas de Meta en los flujos por comentario', () => {
  it('tras el DM al comentario puede seguir solo con pasos que no envían (etiqueta, dato, aviso)', () => {
    const flow = followFlow();
    const nodes = [
      ...flow.nodes.map((n) => (n.id === 'start' ? { ...n, next: 'tag' } : n)),
      { id: 'tag', type: 'tag' as const, op: 'add' as const, tag: 'comento', next: 'note' },
      { id: 'note', type: 'notify' as const, text: 'Comentó' },
    ];
    expect(errorsOf({ ...flow, nodes })).toBe('');
  });

  it('rechaza que tras el DM al comentario se envíe algo solo (aunque sea tras una condición o una pausa)', () => {
    const flow = followFlow();
    const nodes = [
      ...flow.nodes.map((n) => (n.id === 'start' ? { ...n, next: 'tag' } : n)),
      { id: 'tag', type: 'tag' as const, op: 'add' as const, tag: 'comento', next: 'wait' },
      { id: 'wait', type: 'delay' as const, seconds: 60, next: 'resource' },
    ];
    expect(errorsOf({ ...flow, nodes })).toContain('Meta solo deja');
  });

  it('el DM al comentario no puede llevar respuestas rápidas (no está comprobado que Meta las acepte ahí)', () => {
    const flow = followFlow();
    const nodes = flow.nodes.map((n) => (n.id === 'start' ? { ...n, buttons: [], quickReplies: [{ title: 'Sí', next: 'gate' }] } : n));
    expect(errorsOf({ ...flow, nodes })).toContain('respuestas rápidas');
  });
});

describe('límites de cada paso', () => {
  it('respuestas rápidas: máximo 13, título de 20, y no a la vez que botones', () => {
    const qr = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Op ${i}`, next: 'cond' }));
    const withQr = (quickReplies: unknown, buttons: unknown = []) =>
      dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'msg' ? { ...n, quickReplies, buttons } : n)) as FlowInput['nodes'] });
    expect(errorsOf(withQr(qr(14)))).not.toBe('');
    expect(errorsOf(withQr([{ title: 'a'.repeat(21), next: 'cond' }]))).not.toBe('');
    expect(errorsOf(withQr(qr(1), [{ type: 'url', title: 'x', url: 'https://a.com' }]))).toContain('a la vez');
  });

  it('carrusel: de 1 a 10 tarjetas y cada una con algo más que el título', () => {
    const withCards = (cards: unknown) => dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'normal' ? { ...n, cards } : n)) as FlowInput['nodes'] });
    expect(errorsOf(withCards([]))).not.toBe('');
    expect(errorsOf(withCards(Array(11).fill({ title: 'a', subtitle: 'b' })))).not.toBe('');
    expect(errorsOf(withCards([{ title: 'Solo título' }]))).toContain('algo más que el título');
  });

  it('archivo: solo enlaces http(s) y tipos de Meta', () => {
    const withMedia = (media: object) => dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'vip' ? { ...n, ...media } : n)) as FlowInput['nodes'] });
    expect(errorsOf(withMedia({ url: 'javascript:alert(1)' }))).not.toBe('');
    expect(errorsOf(withMedia({ kind: 'gif' }))).not.toBe('');
  });

  it('condiciones: horario con horas válidas y zona horaria real; A/B entre 1 y 99 %', () => {
    const withRule = (rule: unknown) => dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'cond' ? { ...n, rule } : n)) as FlowInput['nodes'] });
    expect(errorsOf(withRule({ kind: 'hours', from: '09:00', to: '18:30', days: [1, 2, 3, 4, 5], timeZone: 'Europe/Madrid' }))).toBe('');
    expect(errorsOf(withRule({ kind: 'hours', from: '25:00', to: '18:00', days: [1], timeZone: 'Europe/Madrid' }))).not.toBe('');
    expect(errorsOf(withRule({ kind: 'hours', from: '09:00', to: '18:00', days: [1], timeZone: 'Marte/Olympus' }))).toContain('zona horaria');
    expect(errorsOf(withRule({ kind: 'random', percent: 100 }))).not.toBe('');
    expect(errorsOf(withRule({ kind: 'random', percent: 50 }))).toBe('');
  });

  it('las condiciones tienen que apuntar a pasos que existen', () => {
    const broken = dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'cond' ? { ...n, ifFalse: 'nada' } : n)) as FlowInput['nodes'] });
    expect(errorsOf(broken)).toContain('nada');
  });

  it('un flujo no puede ir a sí mismo', () => {
    const self = dmFlow({ nodes: dmFlow().nodes.map((n) => (n.id === 'goto' ? { ...n, flowId: 'dm1' } : n)) as FlowInput['nodes'] });
    expect(errorsOf(self)).toContain('sí mismo');
  });

  it('detecta bucles automáticos también a través de condiciones', () => {
    const nodes = [
      { id: 'a', type: 'tag', op: 'add', tag: 'x', next: 'b' },
      { id: 'b', type: 'condition', rule: { kind: 'random', percent: 50 }, ifTrue: 'a', ifFalse: 'c' },
      { id: 'c', type: 'notify', text: 'fin' },
    ];
    expect(errorsOf(dmFlow({ startNodeId: 'a', nodes: nodes as FlowInput['nodes'] }))).toContain('Bucle');
  });
});
