import { describe, expect, it } from 'vitest';
import { encodePayload, planAfterFollowCheck, planNode, planPostback } from '../src/flows/engine.js';
import { validateFlow, type FlowInput } from '../src/flows/types.js';
import { JOSE_FLOW } from './fixtures.js';
import { STRANGER_ID, TEST_MEDIA_ID, ACCOUNT_ID } from './helpers.js';

function valid(input: FlowInput) {
  const result = validateFlow(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.flow;
}

describe('validación de nodos avanzados', () => {
  it('la réplica del flujo de ManyChat de Jose es válida', () => {
    expect(valid(JOSE_FLOW).nodes).toHaveLength(6);
  });

  it('los botones de enlace sin etiquetas quedan con etiquetas vacías', () => {
    const flow = valid({ ...JOSE_FLOW, nodes: JOSE_FLOW.nodes.map((n) => (n.id === 'grupo' ? { ...n, buttons: [{ type: 'url', title: 'X', url: 'https://a.com' }] } : n)) });
    const grupo = flow.nodes.find((n) => n.id === 'grupo');
    expect(grupo?.type === 'message' && grupo.buttons[0]).toEqual({ type: 'url', title: 'X', url: 'https://a.com', tags: [] });
  });

  it('rechaza bucles automáticos, "siguiente paso" en el primer mensaje y pausas de más de 23 h', () => {
    const loop = { ...JOSE_FLOW, nodes: JOSE_FLOW.nodes.map((n) => (n.id === 'grupo' ? { ...n, next: 'biblioteca' } : n)) };
    expect(validateFlow(loop)).toMatchObject({ ok: false, errors: [expect.stringContaining('Bucle')] });
    const startNext = { ...JOSE_FLOW, nodes: JOSE_FLOW.nodes.map((n) => (n.id === 'inicio' ? { ...n, next: 'grupo' } : n)) };
    expect(validateFlow(startNext)).toMatchObject({ ok: false, errors: [expect.stringContaining('Meta solo deja')] });
    const longDelay = { ...JOSE_FLOW, nodes: JOSE_FLOW.nodes.map((n) => (n.id === 'espera' ? { ...n, seconds: 24 * 3600 } : n)) };
    expect(validateFlow(longDelay).ok).toBe(false);
    const missing = { ...JOSE_FLOW, nodes: JOSE_FLOW.nodes.map((n) => (n.id === 'espera' ? { ...n, next: 'nada' } : n)) };
    expect(validateFlow(missing).ok).toBe(false);
  });
});

describe('motor con siguiente paso y pausas', () => {
  const flow = valid(JOSE_FLOW);

  it('"si, mándamelo" → condición', () => {
    const plan = planPostback([flow], { kind: 'postback', accountId: ACCOUNT_ID, senderId: STRANGER_ID, mid: 'm1', title: 'x', payload: encodePayload('manychat1', 'sigue') });
    expect(plan.actions.map((a) => a.type)).toEqual(['check_follow']);
  });

  it('sigue → biblioteca (con etiqueta en el botón) + pausa de 2 min → grupo', () => {
    const actions = planAfterFollowCheck(flow, 'sigue', 'yes', STRANGER_ID, 'pb:m1:sigue', 0);
    expect(actions.map((a) => a.type)).toEqual(['send_message', 'schedule']);
    expect(actions[0]).toMatchObject({ message: { nodeId: 'biblioteca', recipientId: STRANGER_ID } });
    expect(actions[1]).toMatchObject({ type: 'schedule', nodeId: 'grupo', delaySeconds: 120, flowId: 'manychat1' });
  });

  it('no sigue → mensaje "sígueme" (sin pausa)', () => {
    const actions = planAfterFollowCheck(flow, 'sigue', 'no', STRANGER_ID, 'pb:m1:sigue', 0);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ message: { nodeId: 'nosigue' } });
  });

  it('al vencer la pausa se manda el mensaje del grupo', () => {
    expect(planNode(flow, 'grupo', STRANGER_ID, 'job', 3)[0]).toMatchObject({ type: 'send_message', message: { nodeId: 'grupo' } });
  });

  it('la réplica salta en cualquier reel (mediaIds "all")', () => {
    expect(flow.trigger).toMatchObject({ type: 'comment', mediaIds: 'all' });
    expect(TEST_MEDIA_ID).toBeTruthy();
  });
});
