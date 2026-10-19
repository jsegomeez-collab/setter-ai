import { describe, expect, it } from 'vitest';
import type { Action } from '../src/flows/engine.js';
import { isWithinHours, runFlowStep, type Profile } from '../src/flows/steps.js';
import { validateFlow, type Flow, type FlowInput } from '../src/flows/types.js';
import { STRANGER_ID, createMemoryStore } from './helpers.js';

/** Fase 7.3a: pasos de "hacer" y condiciones, ejecutados en la cola. */

type StepAction = Extract<Action, { type: 'flow_step' }>;

function flow(nodes: FlowInput['nodes'], overrides: Partial<FlowInput> = {}): Flow {
  const result = validateFlow({
    id: 'f',
    name: 'Flujo',
    enabled: true,
    trigger: { type: 'manual' },
    publicReplies: [],
    startNodeId: nodes[0]?.id ?? 'x',
    nodes: [...nodes, { id: 'yes', type: 'message', text: 'Sí', buttons: [] }, { id: 'no', type: 'message', text: 'No', buttons: [] }],
    testUsernames: [],
    oncePerUser: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.flow;
}

const step = (nodeId: string, flowId = 'f'): StepAction => ({ type: 'flow_step', dedupKey: `k:${nodeId}`, recipientId: STRANGER_ID, flowId, nodeId, depth: 0 });

function setup(flows: Flow[], options: { profile?: Profile | null; now?: Date; random?: number } = {}) {
  const store = createMemoryStore();
  const deps = {
    store,
    getFlow: async (id: string) => flows.find((candidate) => candidate.id === id),
    getProfile: async () => options.profile ?? null,
    now: () => options.now ?? new Date('2026-10-19T10:00:00Z'),
    random: () => options.random ?? 0.5,
  };
  return { store, deps };
}

/** A qué paso lleva lo siguiente que se encola. */
const nextNode = (next: readonly Action[]): string | undefined => (next[0] && 'message' in next[0] ? next[0].message.nodeId : undefined);

describe('pasos de "hacer"', () => {
  it('pone y quita etiquetas y sigue con el siguiente paso', async () => {
    const f = flow([
      { id: 'add', type: 'tag', op: 'add', tag: 'interesado', next: 'rm' },
      { id: 'rm', type: 'tag', op: 'remove', tag: 'frio', next: 'yes' },
    ]);
    const { store, deps } = setup([f]);
    await store.addContactTags(STRANGER_ID, ['frio']);
    const first = await runFlowStep(step('add'), deps);
    expect((await store.getContact(STRANGER_ID))?.tags).toEqual(['frio', 'interesado']);
    expect(first.next).toMatchObject([{ type: 'flow_step', nodeId: 'rm', dedupKey: 'k:add:rm' }]);
    const second = await runFlowStep(step('rm'), deps);
    expect((await store.getContact(STRANGER_ID))?.tags).toEqual(['interesado']);
    expect(nextNode(second.next)).toBe('yes');
  });

  it('guarda y borra un dato de la ficha', async () => {
    const f = flow([
      { id: 'set', type: 'field', field: 'Ciudad', value: 'Miami' },
      { id: 'clear', type: 'field', field: 'ciudad', value: '' },
    ]);
    const { store, deps } = setup([f]);
    await runFlowStep(step('set'), deps);
    expect((await store.getContact(STRANGER_ID))?.fields).toEqual({ ciudad: 'Miami' });
    await runFlowStep(step('clear'), deps);
    expect((await store.getContact(STRANGER_ID))?.fields).toEqual({});
  });

  it('pausa y reactiva la IA en la conversación', async () => {
    const f = flow([
      { id: 'pause', type: 'ai', paused: true },
      { id: 'resume', type: 'ai', paused: false },
    ]);
    const { store, deps } = setup([f]);
    await runFlowStep(step('pause'), deps);
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(true);
    expect((await store.getContact(STRANGER_ID))?.aiPausedReason).toContain('Flujo');
    await runFlowStep(step('resume'), deps);
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(false);
  });

  it('avisa a Jose con un aviso en la app (no escribe a nadie)', async () => {
    const { store, deps } = setup([flow([{ id: 'n', type: 'notify', text: 'Quiere llamada' }])]);
    const out = await runFlowStep(step('n'), deps);
    expect(out.next).toEqual([]);
    expect(store.events.find((e) => e.kind === 'aviso')).toMatchObject({ note: 'Quiere llamada', data: { igId: STRANGER_ID, flowId: 'f' } });
  });

  it('ir a otro flujo empieza ese flujo; si está desactivado o no existe, se para y lo explica', async () => {
    const target = flow([{ id: 'hola', type: 'message', text: 'Otro flujo', buttons: [] }], { id: 'otro' });
    const f = flow([{ id: 'g', type: 'goto', flowId: 'otro' }]);
    const { deps } = setup([f, target]);
    expect(nextNode((await runFlowStep(step('g'), deps)).next)).toBe('hola');
    const off = setup([f, { ...target, enabled: false }]);
    expect(await runFlowStep(step('g'), off.deps)).toMatchObject({ next: [], result: { skipped: expect.stringContaining('desactivado') } });
    const gone = setup([f]);
    expect(await runFlowStep(step('g'), gone.deps)).toMatchObject({ next: [], result: { skipped: expect.stringContaining('no existe') } });
  });

  it('si el flujo se desactivó mientras esperaba en la cola, no hace nada', async () => {
    const f = flow([{ id: 'add', type: 'tag', op: 'add', tag: 'x' }]);
    const { store, deps } = setup([{ ...f, enabled: false }]);
    expect((await runFlowStep(step('add'), deps)).result).toMatchObject({ skipped: expect.any(String) });
    expect(await store.getContact(STRANGER_ID)).toBeNull();
  });
});

describe('condiciones', () => {
  const cond = (rule: unknown) => flow([{ id: 'c', type: 'condition', rule, ifTrue: 'yes', ifFalse: 'no' } as FlowInput['nodes'][number]]);

  it('tiene etiqueta (sin distinguir mayúsculas)', async () => {
    const { store, deps } = setup([cond({ kind: 'has_tag', tag: 'VIP' })]);
    expect(nextNode((await runFlowStep(step('c'), deps)).next)).toBe('no');
    await store.addContactTags(STRANGER_ID, ['vip']);
    expect(nextNode((await runFlowStep(step('c'), deps)).next)).toBe('yes');
  });

  it('dato de la ficha: igual, contiene y "tiene valor"', async () => {
    const { store, deps } = setup([cond({ kind: 'field', field: 'ciudad', op: 'equals', value: 'miami' })]);
    await store.setContactField(STRANGER_ID, 'ciudad', 'Miami');
    expect(nextNode((await runFlowStep(step('c'), deps)).next)).toBe('yes');
    const contains = setup([cond({ kind: 'field', field: 'ciudad', op: 'contains', value: 'york' })]);
    await contains.store.setContactField(STRANGER_ID, 'ciudad', 'Nueva York');
    expect(nextNode((await runFlowStep(step('c'), contains.deps)).next)).toBe('yes');
    const set = setup([cond({ kind: 'field', field: 'email', op: 'set' })]);
    expect(nextNode((await runFlowStep(step('c'), set.deps)).next)).toBe('no');
  });

  it('palabra en su último mensaje', async () => {
    const { store, deps } = setup([cond({ kind: 'keyword', keywords: ['precio'] })]);
    await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: '¿Cuál es el PRECIO?', mid: 'm1', status: 'sent', dedupKey: null });
    expect(nextNode((await runFlowStep(step('c'), deps)).next)).toBe('yes');
  });

  it('verificado y seguidores salen del perfil; si Meta no deja saberlo, cuenta como "no"', async () => {
    const verified = setup([cond({ kind: 'verified' })], { profile: { isVerified: true, followerCount: 50 } });
    expect(nextNode((await runFlowStep(step('c'), verified.deps)).next)).toBe('yes');
    const followers = setup([cond({ kind: 'followers', min: 1000 })], { profile: { isVerified: false, followerCount: 50 } });
    expect(nextNode((await runFlowStep(step('c'), followers.deps)).next)).toBe('no');
    const unknown = setup([cond({ kind: 'followers', min: 0 })], { profile: null });
    expect(await runFlowStep(step('c'), unknown.deps)).toMatchObject({ result: { branch: 'no', detail: expect.stringContaining('Meta') } });
  });

  it('horario en su zona horaria, también cruzando la medianoche', () => {
    const office = { kind: 'hours' as const, from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5], timeZone: 'Europe/Madrid' };
    // Lunes 19-10-2026 10:00 UTC = 12:00 en Madrid (horario de verano).
    expect(isWithinHours(office, new Date('2026-10-19T10:00:00Z'))).toBe(true);
    expect(isWithinHours(office, new Date('2026-10-19T17:00:00Z'))).toBe(false);
    // Domingo 18-10-2026.
    expect(isWithinHours(office, new Date('2026-10-18T10:00:00Z'))).toBe(false);
    const night = { ...office, from: '22:00', to: '06:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isWithinHours(night, new Date('2026-10-19T23:30:00Z'))).toBe(true);
    expect(isWithinHours(night, new Date('2026-10-19T12:00:00Z'))).toBe(false);
  });

  it('prueba A/B: el % va por "sí"', async () => {
    const low = setup([cond({ kind: 'random', percent: 30 })], { random: 0.29 });
    expect(nextNode((await runFlowStep(step('c'), low.deps)).next)).toBe('yes');
    const high = setup([cond({ kind: 'random', percent: 30 })], { random: 0.3 });
    expect(nextNode((await runFlowStep(step('c'), high.deps)).next)).toBe('no');
  });
});
