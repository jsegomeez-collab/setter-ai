import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/flows/types.js';
import { followFlow } from './helpers.js';

describe('validateFlow', () => {
  it('acepta un flujo correcto con condición de seguir', () => {
    expect(validateFlow(followFlow()).ok).toBe(true);
  });

  it('rechaza botones que apuntan a pasos inexistentes', () => {
    const flow = followFlow();
    const broken = { ...flow, nodes: flow.nodes.map((n) => (n.id === 'start' ? { ...n, buttons: [{ type: 'postback', title: 'X', next: 'nada' }] } : n)) };
    const result = validateFlow(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('nada');
  });

  it('rechaza que el primer paso sea una condición (el DM al comentario tiene que ser un mensaje)', () => {
    const result = validateFlow(followFlow({ startNodeId: 'gate' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('primer paso');
  });

  it('rechaza más de 3 botones, URLs no válidas y nodos repetidos', () => {
    const base = followFlow();
    const many = { ...base, nodes: [{ id: 'start', type: 'message', text: 'x', buttons: Array(4).fill({ type: 'url', title: 'a', url: 'https://a.com' }) }] };
    expect(validateFlow(many).ok).toBe(false);
    const badUrl = { ...base, nodes: [{ id: 'start', type: 'message', text: 'x', buttons: [{ type: 'url', title: 'a', url: 'javascript:alert(1)' }] }] };
    expect(validateFlow(badUrl).ok).toBe(false);
    const repeated = { ...base, nodes: [...base.nodes, base.nodes[0]] };
    expect(validateFlow(repeated).ok).toBe(false);
  });

  it('rechaza texto con botones de más de 640 caracteres', () => {
    const base = followFlow();
    const long = { ...base, nodes: base.nodes.map((n) => (n.id === 'resource' ? { ...n, text: 'a'.repeat(700) } : n)) };
    expect(validateFlow(long).ok).toBe(false);
  });

  it('rechaza IDs de reel que no son números y basura', () => {
    expect(validateFlow(followFlow({ trigger: { mediaIds: ['abc'], keywords: [] } })).ok).toBe(false);
    expect(validateFlow(null).ok).toBe(false);
  });
});
