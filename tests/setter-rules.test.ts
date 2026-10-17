import { describe, expect, it, vi } from 'vitest';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { decideChecked } from '../src/setter/reply.js';
import { enforceLinkRules, ruleIssues, type RuleContext } from '../src/setter/rules.js';
import { TEST_SETTER_LINKS, sampleOutput } from './helpers.js';

const links = { agenda: TEST_SETTER_LINKS.agenda, membership: TEST_SETTER_LINKS.membership };
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ previous: [], userTurns: ['hola'], links, lead: { puede_invertir: 'si', tipo_lead: 'formacion' }, ...over });
const reasons = (messages: string[], c: RuleContext): string[] => ruleIssues(messages, c).map((i) => i.reason);

describe('reglas de conversación en código (Haiku se las saltaba en las simulaciones del 17-10)', () => {
  it('membresía: solo si no puede invertir o la persona habla de precio, de la membresía o de no tener dinero', () => {
    const offer = [`mira la membresía: ${links.membership}`];
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'si', tipo_lead: 'formacion' } }))).toHaveLength(1);
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'duda', tipo_lead: 'formacion' } }))).toHaveLength(1);
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'no', tipo_lead: 'formacion' } }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['uf, me parece caro'] }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['ahora no tengo plata'] }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['qué incluye la membresía?'] }))).toEqual([]);
  });

  it('membresía: tampoco mencionarla ni decir "$47" sin motivo; sí si pregunta el precio', () => {
    expect(reasons(['si quieres algo chico, hay una membresía de $47 al mes'], ctx())).toHaveLength(1);
    expect(reasons(['hay opciones desde $47 al mes hasta acompañamiento 1:1'], ctx({ userTurns: ['cuánto cuesta?'] }))).toEqual([]);
    expect(reasons(['hay opciones desde $47 al mes hasta acompañamiento 1:1'], ctx({ userTurns: ['y el precio?'] }))).toEqual([]);
  });

  it('a un lead de empresa (DFY) nunca se le habla de la membresía: es de la formación', () => {
    const dfy = ctx({ lead: { puede_invertir: 'no', tipo_lead: 'empresa_dfy' }, userTurns: ['cuánto cuesta?'] });
    expect(reasons(['hay una membresía de $47 al mes'], dfy)).toHaveLength(1);
    expect(enforceLinkRules(['el precio lo ve el equipo contigo', 'también hay una membresía de $47 al mes'], dfy)).toEqual(['el precio lo ve el equipo contigo']);
  });

  it('agenda una sola vez (también si antes salió como botón), salvo que la pida', () => {
    const agenda = [`elige aquí el hueco: ${links.agenda}`];
    expect(reasons(agenda, ctx())).toEqual([]);
    expect(reasons(agenda, ctx({ previous: ['mira\n[Botón: Agendar llamada]'] }))).toHaveLength(1);
    expect(reasons(agenda, ctx({ previous: [`aquí: ${links.agenda}`] }))).toHaveLength(1);
    expect(reasons(agenda, ctx({ previous: ['[Botón: Agendar llamada]'], userTurns: ['me pasas otra vez el enlace?'] }))).toEqual([]);
    expect(reasons(agenda, ctx({ previous: ['[Botón: Agendar llamada]'], userTurns: ['dónde reservo?'] }))).toEqual([]);
  });

  it('nombrar la agenda o decir "reservo" no es pedirla (simulación: la pasó 3 veces al nivel 2)', () => {
    const agenda = [`el enlace es el mismo: ${links.agenda}`];
    const sent = ['[Botón: Agendar llamada]'];
    expect(reasons(agenda, ctx({ previous: sent, userTurns: ['la agenda la miro y te digo'] }))).toHaveLength(1);
    expect(reasons(agenda, ctx({ previous: sent, userTurns: ['si no hay compromiso, reservo esta semana'] }))).toHaveLength(1);
  });

  it('seco: con 3 respuestas de 3 palabras o menos seguidas, no más preguntas', () => {
    const dry = ['no se', 'nada', 'ok'];
    expect(reasons(['a qué te dedicas?'], ctx({ userTurns: dry }))).toHaveLength(1);
    expect(reasons(['aquí estoy cuando quieras 🙌'], ctx({ userTurns: dry }))).toEqual([]);
    expect(reasons(['a qué te dedicas?'], ctx({ userTurns: ['trabajo en una tienda de ropa', 'nada', 'ok'] }))).toEqual([]);
  });

  it('no puede inventar qué huecos tiene la agenda', () => {
    expect(reasons(['la agenda tiene huecos entre semana por la tarde'], ctx())).toHaveLength(1);
    expect(reasons(['hay huecos esta semana'], ctx())).toHaveLength(1);
    expect(reasons(['elige el hueco que te venga bien'], ctx())).toEqual([]);
  });

  it('como mucho 3 mensajitos', () => {
    expect(reasons(['a', 'b', 'c', 'd'], ctx())).toHaveLength(1);
    expect(reasons(['a', 'b', 'c'], ctx())).toEqual([]);
  });

  it('si aun así repite la agenda o mete la membresía, el código quita ese mensajito (sin dejar la respuesta vacía)', () => {
    const c = ctx({ previous: ['[Botón: Agendar llamada]'] });
    expect(enforceLinkRules(['perfecto, ya lo tienes', `reserva aquí: ${links.agenda}`], c)).toEqual(['perfecto, ya lo tienes']);
    expect(enforceLinkRules([`reserva aquí: ${links.agenda}`], c)).toEqual([`reserva aquí: ${links.agenda}`]);
    expect(enforceLinkRules(['qué bien', `membresía: ${links.membership}`], ctx())).toEqual(['qué bien']);
  });
});

describe('decideChecked con las reglas', () => {
  const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const allowed = { urls: [links.agenda, links.membership], emails: [TEST_SETTER_LINKS.contactEmail] };
  const ok = (messages: string[], puede_invertir: 'si' | 'no' | 'duda' = 'duda'): BrainResult => ({ kind: 'ok', output: sampleOutput({ messages }, { puede_invertir }), usage: USAGE });

  it('pide otro intento explicando la regla y, si repite, envía sin el mensajito de la membresía', async () => {
    const offer = ['entiendo', `si quieres algo mensual, la membresía: ${links.membership}`];
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok(offer));
    const result = await decideChecked({ decide }, 'SYS', [{ role: 'user', content: 'el 1:1 es mensual?' }], allowed, links);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[1]?.at(-1)).toEqual({ role: 'system', content: expect.stringContaining('membresía') });
    expect(result).toMatchObject({ kind: 'ok', guard: { ok: true }, messages: ['entiendo'] });
  });

  it('sin enlaces (llamadas antiguas) no aplica estas reglas', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok([`membresía: ${links.membership}`]));
    const result = await decideChecked({ decide }, 'SYS', [{ role: 'user', content: 'hola' }], allowed);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ messages: [`membresía: ${links.membership}`] });
  });
});
