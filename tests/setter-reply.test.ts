import { describe, expect, it, vi } from 'vitest';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { checkReply } from '../src/setter/guards.js';
import { decideChecked } from '../src/setter/reply.js';
import { TEST_SETTER_LINKS, sampleOutput } from './helpers.js';

const allowed = { urls: [TEST_SETTER_LINKS.agenda, TEST_SETTER_LINKS.membership], emails: [TEST_SETTER_LINKS.contactEmail] };
const USAGE = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 0 };
const ok = (messages: string[]): BrainResult => ({ kind: 'ok', output: sampleOutput({ messages }), usage: USAGE });
const TURNS = [{ role: 'user' as const, content: 'hola' }];

describe('decideChecked (segundo intento)', () => {
  it('si la primera respuesta pasa el filtro, no repite', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok(['hola!', 'ya usas alguna IA?']));
    const result = await decideChecked({ decide }, 'SYS', TURNS, allowed);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'ok', retried: false, guard: { ok: true }, messages: ['hola!', 'ya usas alguna IA?'] });
  });

  it('si no pasa, le explica a Claude por qué y se queda con el segundo intento (sumando el coste)', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['para nada te молча'])).mockResolvedValueOnce(ok(['para nada, te entiendo']));
    const result = await decideChecked({ decide }, 'SYS', TURNS, allowed);
    expect(decide).toHaveBeenCalledTimes(2);
    const [, retryTurns] = decide.mock.calls[1] ?? [];
    expect(retryTurns?.at(-1)).toEqual({ role: 'system', content: expect.stringContaining('otro alfabeto') });
    expect(retryTurns?.slice(0, -1)).toEqual(TURNS);
    expect(result).toMatchObject({ kind: 'ok', retried: true, guard: { ok: true }, messages: ['para nada, te entiendo'], usage: { inputTokens: 20, outputTokens: 40 } });
  });

  it('si el segundo intento tampoco pasa, devuelve el fallo para retener', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok(['paga en https://otro.com']));
    const result = await decideChecked({ decide }, 'SYS', TURNS, allowed);
    expect(result).toMatchObject({ kind: 'ok', retried: true, guard: { ok: false } });
  });

  it('si el segundo intento falla al llamar a Claude, se queda el primero (que se retendrá)', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['paga en https://otro.com'])).mockResolvedValueOnce({ kind: 'failed', detail: 'x' });
    const result = await decideChecked({ decide }, 'SYS', TURNS, allowed);
    expect(result).toMatchObject({ kind: 'ok', retried: true, guard: { ok: false }, messages: ['paga en https://otro.com'] });
  });

  it('un rechazo o fallo en el primer intento se devuelve tal cual (sin segundo intento)', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue({ kind: 'refusal', detail: 'no' });
    expect(await decideChecked({ decide }, 'SYS', TURNS, allowed)).toEqual({ kind: 'refusal', detail: 'no' });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('sin mensajitos no hay filtro ni segundo intento (la IA decidió no responder)', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok([]));
    expect(await decideChecked({ decide }, 'SYS', TURNS, allowed)).toMatchObject({ retried: false, guard: { ok: true }, messages: [] });
  });
});

describe('filtro de alfabetos', () => {
  it('bloquea cirílico, chino, árabe…; deja español con tildes, ñ, ¿¡ y emojis', () => {
    for (const text of ['te молча', '你好', 'مرحبا', 'こんにちは']) expect(checkReply(text, allowed).ok).toBe(false);
    for (const text of ['¿qué tal? ¡genial! año, acción, pingüino 🙌💪', 'hey, thanks for reaching out!']) expect(checkReply(text, allowed).ok).toBe(true);
  });
});
