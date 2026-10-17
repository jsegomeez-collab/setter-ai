import { describe, expect, it, vi } from 'vitest';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { decideChecked } from '../src/setter/reply.js';
import { enforceLinkRules, ruleIssues, type RuleContext } from '../src/setter/rules.js';
import { TEST_SETTER_LINKS, sampleOutput } from './helpers.js';

const links = { agenda: TEST_SETTER_LINKS.agenda, membership: TEST_SETTER_LINKS.membership };
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ previous: [], userTurns: ['hola'], links, lead: { puede_invertir: 'si' }, ...over });
const reasons = (messages: string[], c: RuleContext): string[] => ruleIssues(messages, c).map((i) => i.reason);

describe('reglas de conversación en código (Haiku se las saltaba en las simulaciones del 17-10)', () => {
  it('membresía: solo si no puede invertir o la persona habla de precio, de la membresía o de no tener dinero', () => {
    const offer = [`mira la membresía: ${links.membership}`];
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'si' } }))).toHaveLength(1);
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'duda' } }))).toHaveLength(1);
    expect(reasons(offer, ctx({ lead: { puede_invertir: 'no' } }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['uf, me parece caro'] }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['ahora no tengo plata'] }))).toEqual([]);
    expect(reasons(offer, ctx({ userTurns: ['qué incluye la membresía?'] }))).toEqual([]);
  });

  it('agenda una sola vez (también si antes salió como botón), salvo que la pida', () => {
    const agenda = [`elige aquí el hueco: ${links.agenda}`];
    expect(reasons(agenda, ctx())).toEqual([]);
    expect(reasons(agenda, ctx({ previous: ['mira\n[Botón: Agendar llamada]'] }))).toHaveLength(1);
    expect(reasons(agenda, ctx({ previous: [`aquí: ${links.agenda}`] }))).toHaveLength(1);
    expect(reasons(agenda, ctx({ previous: ['[Botón: Agendar llamada]'], userTurns: ['me pasas otra vez el enlace?'] }))).toEqual([]);
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
