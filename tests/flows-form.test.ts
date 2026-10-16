import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, flowToForm, formToFlow, newFlowId, readForm, type FlowForm } from '../src/flows/form.js';
import { TEST_MEDIA_ID, followFlow } from './helpers.js';

const form = (overrides: Partial<FlowForm> = {}): FlowForm => ({
  ...EMPTY_FORM,
  name: 'Reel n8n',
  enabled: true,
  mediaIds: [TEST_MEDIA_ID],
  resourceUrl: 'https://example.com/recurso',
  ...overrides,
});

describe('formulario → flujo', () => {
  it('modo "condición de seguir" crea 4 nodos conectados y válidos', () => {
    const result = formToFlow(form(), () => 'abc123');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flow.id).toBe('abc123');
    expect(result.flow.nodes.map((n) => n.id)).toEqual(['start', 'gate', 'resource', 'notfollow']);
    expect(result.flow.publicReplies).toHaveLength(3);
    expect(result.flow.template).toBe('basic');
  });

  it('modo "enlace directo" crea un solo mensaje con botón de enlace', () => {
    const result = formToFlow(form({ mode: 'link', linkUrl: 'https://example.com/x', keywords: 'info, guía ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flow.nodes).toEqual([
      { id: 'start', type: 'message', text: EMPTY_FORM.startText, buttons: [{ type: 'url', title: 'Ver recurso', url: 'https://example.com/x', tags: [] }] },
    ]);
    expect(result.flow.trigger.keywords).toEqual(['info', 'guía']);
  });

  it('exige elegir reel o "todos", y quita la @ de los usuarios de prueba', () => {
    expect(formToFlow(form({ mediaIds: [] })).ok).toBe(false);
    const result = formToFlow(form({ allMedia: true, mediaIds: [], testUsernames: '@josegomezlife, otra' }));
    expect(result.ok && result.flow.trigger.mediaIds === 'all' && result.flow.testUsernames).toEqual(['josegomezlife', 'otra']);
  });

  it('devuelve los errores de validación (URL mala)', () => {
    const result = formToFlow(form({ resourceUrl: 'no-es-url' }));
    expect(result.ok).toBe(false);
  });

  it('ida y vuelta: flujo → formulario → flujo da lo mismo', () => {
    const first = formToFlow(form(), () => 'abc123');
    if (!first.ok) throw new Error('debería ser válido');
    const back = flowToForm(first.flow);
    expect(back).not.toBeNull();
    const second = formToFlow(back as FlowForm);
    expect(second.ok && second.flow).toEqual(first.flow);
  });

  it('flujos del constructor (no "basic") no se abren en el formulario', () => {
    expect(flowToForm(followFlow({ template: 'builder' }))).toBeNull();
  });

  it('lee el formulario HTML (casillas, listas y radios)', () => {
    const read = readForm({ name: ' X ', enabled: 'on', mediaIds: ['1', '2', ''], mode: 'link', keywords: 'a' });
    expect(read).toMatchObject({ name: 'X', enabled: true, mediaIds: ['1', '2'], mode: 'link', oncePerUser: false, allMedia: false });
    expect(readForm({ mediaIds: '9' }).mediaIds).toEqual(['9']);
  });

  it('genera ids cortos y válidos', () => {
    expect(newFlowId()).toMatch(/^[A-Za-z0-9]{8}$/);
  });
});
