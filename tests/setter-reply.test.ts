import { describe, expect, it, vi } from 'vitest';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { checkReply, limitEmojis, styleIssues } from '../src/setter/guards.js';
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

describe('muletillas (segundo intento de estilo, nunca retiene)', () => {
  it('detecta "vale" y "no pasa nada"; deja "vale la pena"', () => {
    expect(styleIssues(['vale, no pasa nada 😊'])).toHaveLength(2);
    expect(styleIssues(['Vale. cuéntame más'])).toHaveLength(1);
    expect(styleIssues(['eso vale la pena', 'qué tal te fue?'])).toEqual([]);
  });

  it('pilla las variantes de la simulación del seco: "tampoco pasa nada", "no hay problema", "tranquilo/a"', () => {
    expect(styleIssues(['ok, tampoco pasa nada'])).toHaveLength(1);
    expect(styleIssues(['ok, no hay problema'])).toHaveLength(1);
    expect(styleIssues(['tranquila, sin prisa'])).toHaveLength(1);
    expect(styleIssues(['me tranquiliza saberlo'])).toEqual([]);
  });

  it('pilla que empiece igual que alguno de sus 2 mensajes anteriores ("entiendo… / entiendo…")', () => {
    const previous = ['entiendo, a veces cuesta arrancar\n¿estás trabajando?', 'perfecto, cuéntame más'];
    expect(styleIssues(['Entiendo, a veces uno no tiene respuesta'], previous)).toHaveLength(1);
    expect(styleIssues(['claro, sin prisa'], previous)).toEqual([]);
    expect(styleIssues(['entiendo'], ['entiendo', 'b', 'c'])).toEqual([]);
  });

  it('usa los 2 últimos mensajes de la cuenta del historial para ver si empieza igual', async () => {
    const turns = [
      { role: 'user' as const, content: 'no se' },
      { role: 'assistant' as const, content: 'entiendo, cuesta arrancar' },
      { role: 'user' as const, content: 'nada' },
    ];
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['entiendo, está bien'])).mockResolvedValueOnce(ok(['sin prisa, cuando quieras']));
    expect(await decideChecked({ decide }, 'SYS', turns, allowed)).toMatchObject({ retried: true, messages: ['sin prisa, cuando quieras'] });
  });

  it('pilla "ningún problema" y "nos vemos" (el setter no está en la llamada)', () => {
    expect(styleIssues(['ningún problema, sin prisa'])).toHaveLength(1);
    expect(styleIssues(['genial, nos vemos en la llamada'])).toHaveLength(1);
  });

  it('si el segundo intento tiene más muletillas que el primero, se envía el primero', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['vale!'])).mockResolvedValueOnce(ok(['vale, no pasa nada']));
    expect(await decideChecked({ decide }, 'SYS', TURNS, allowed)).toMatchObject({ guard: { ok: true }, messages: ['vale!'] });
  });

  it('con una muletilla pide otra respuesta una vez y se queda con la segunda', async () => {
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['vale, no pasa nada'])).mockResolvedValueOnce(ok(['tranqui, a qué te dedicas?']));
    const result = await decideChecked({ decide }, 'SYS', TURNS, allowed);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[1]?.at(-1)).toEqual({ role: 'system', content: expect.stringContaining('"vale"') });
    expect(result).toMatchObject({ kind: 'ok', retried: true, guard: { ok: true }, messages: ['tranqui, a qué te dedicas?'] });
  });

  it('si el segundo intento no llega o no pasa el filtro, se envía el primero (la muletilla no es un riesgo)', async () => {
    const failed = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['vale!'])).mockResolvedValueOnce({ kind: 'failed', detail: 'x' });
    expect(await decideChecked({ decide: failed }, 'SYS', TURNS, allowed)).toMatchObject({ guard: { ok: true }, messages: ['vale!'] });
    const blocked = vi.fn<SetterBrain['decide']>().mockResolvedValueOnce(ok(['vale!'])).mockResolvedValueOnce(ok(['mira https://otro.com']));
    expect(await decideChecked({ decide: blocked }, 'SYS', TURNS, allowed)).toMatchObject({ guard: { ok: true }, messages: ['vale!'] });
  });
});

describe('emojis (como mucho uno por respuesta y no en dos seguidas)', () => {
  it('deja solo el primero de la respuesta', () => {
    expect(limitEmojis(['qué bueno 🙌', 'y tú a qué te dedicas? 😊'], [])).toEqual(['qué bueno 🙌', 'y tú a qué te dedicas?']);
  });

  it('si el mensaje anterior de la cuenta ya llevaba emoji, los quita todos (también con tono de piel)', () => {
    expect(limitEmojis(['dale, sin prisa 🙂', 'hola 👍🏽 qué tal?'], ['buenas! 😊'])).toEqual(['dale, sin prisa', 'hola qué tal?']);
  });

  it('nunca deja la respuesta vacía: un mensaje que solo es un emoji se queda si es el único', () => {
    expect(limitEmojis(['🙌'], ['buenas! 😊'])).toEqual(['🙌']);
    expect(limitEmojis(['🙌', 'cuéntame más'], ['buenas! 😊'])).toEqual(['cuéntame más']);
  });

  it('decideChecked envía los mensajitos ya sin el emoji de más', async () => {
    const turns = [
      { role: 'user' as const, content: 'hola' },
      { role: 'assistant' as const, content: 'buenas! 😊' },
      { role: 'user' as const, content: 'trabajo' },
    ];
    const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok(['qué bien 🙂', 'en qué trabajas?']));
    expect(await decideChecked({ decide }, 'SYS', turns, allowed)).toMatchObject({ retried: false, messages: ['qué bien', 'en qué trabajas?'] });
  });
});

describe('filtro de alfabetos', () => {
  it('bloquea cirílico, chino, árabe…; deja español con tildes, ñ, ¿¡ y emojis', () => {
    for (const text of ['te молча', '你好', 'مرحبا', 'こんにちは']) expect(checkReply(text, allowed).ok).toBe(false);
    for (const text of ['¿qué tal? ¡genial! año, acción, pingüino 🙌💪', 'hey, thanks for reaching out!']) expect(checkReply(text, allowed).ok).toBe(true);
  });
});
