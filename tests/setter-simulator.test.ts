import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import { NO_TEXT_PLACEHOLDER } from '../src/setter/prompt.js';
import { SCENARIOS } from '../src/setter/scenarios.js';
import { ClaudeLeadPlayer, estimateCostUsd, runSimulation, verdict, type LeadPlayer } from '../src/setter/simulator.js';
import { TEST_SETTER_CONFIG, TEST_SETTER_LINKS, createMemoryStore, sampleOutput } from './helpers.js';

const USAGE = { inputTokens: 100, outputTokens: 200, cacheReadTokens: 5000, cacheCreationTokens: 0 };
const ok = (output = sampleOutput()): BrainResult => ({ kind: 'ok', output, usage: USAGE });

function fakes(leadLines: (string | null)[]) {
  const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue(ok());
  const lines = [...leadLines];
  const next = vi.fn<LeadPlayer['next']>().mockImplementation(async () => (lines.length ? (lines.shift() ?? null) : null));
  return { decide, next, deps: { brain: { decide }, lead: { next }, knowledge: 'DOC [LINK AGENDA]', links: TEST_SETTER_LINKS } };
}

describe('simulación con texto de inicio (la IA escribe primero, Fase 5.4)', () => {
  const OPENER = 'oye! espero que te sirva la biblioteca 🙌 por curiosidad, ¿a qué te dedicas ahora mismo?';

  it('empieza con el texto de inicio, el lead contesta y el setter lo ve como en producción (mensaje previo de la cuenta)', async () => {
    const { decide, next, deps } = fakes(['trabajo en una tienda de ropa', null]);
    const result = await runSimulation(deps, { persona: 'x', opener: OPENER });
    expect(result.turns.map((t) => t.who)).toEqual(['setter', 'lead', 'setter']);
    expect(result.turns[0]).toMatchObject({ who: 'setter', texts: [OPENER] });
    expect(next.mock.calls[0]?.[1][0]).toMatchObject({ who: 'setter', texts: [OPENER] }); // el lead ve primero el inicio
    expect(decide.mock.calls[0]?.[0]).toContain(OPENER); // va en el system como en producción
    expect(decide.mock.calls[0]?.[1]).toEqual([{ role: 'user', content: 'trabajo en una tienda de ropa' }]);
  });

  it('si el lead no contesta al inicio, termina sin gastar en el setter', async () => {
    const { decide, deps } = fakes([null]);
    const result = await runSimulation(deps, { persona: 'x', opener: OPENER });
    expect(decide).not.toHaveBeenCalled();
    expect(result.endReason).toBe('El lead dio la conversación por terminada');
  });

  it('suma también lo que gasta la IA que hace de lead (coste real completo)', async () => {
    const { deps } = fakes(['hola', null]);
    const leadUsage = { inputTokens: 300, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const result = await runSimulation({ ...deps, lead: { ...deps.lead, takeUsage: () => leadUsage } }, { persona: 'x' });
    expect(result.leadUsage).toEqual(leadUsage);
  });

  it('hay escenarios del grupo "Inicio", cada uno con uno de los textos de inicio', () => {
    const inicio = SCENARIOS.filter((s) => s.group === 'Inicio');
    expect(inicio.length).toBeGreaterThanOrEqual(6);
    expect(inicio.every((s) => typeof s.opener === 'string' && s.opener.length > 0)).toBe(true);
  });
});

describe('ClaudeLeadPlayer', () => {
  it('si la cuenta escribió primero, la conversación del lead empieza por ese mensaje y cuenta lo que gasta', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'trabajo en una tienda' }], usage: { input_tokens: 400, output_tokens: 15 } });
    const player = new ClaudeLeadPlayer({ messages: { create } } as never, 'claude-haiku-5-5');
    expect(await player.next('x', [{ who: 'setter', texts: ['oye! ¿a qué te dedicas?'] }])).toBe('trabajo en una tienda');
    expect(create.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'oye! ¿a qué te dedicas?' }]);
    await player.next('x', [{ who: 'setter', texts: ['oye!'] }, { who: 'lead', texts: ['hola'] }, { who: 'setter', texts: ['qué tal'] }]);
    expect(player.takeUsage()).toMatchObject({ inputTokens: 800, outputTokens: 30 });
    expect(player.takeUsage()).toMatchObject({ inputTokens: 0, outputTokens: 0 }); // se reinicia al leerlo
  });
});

describe('runSimulation', () => {
  it('alterna lead y setter; el setter recibe el documento y el historial con los roles bien', async () => {
    const { decide, deps } = fakes(['hola, vi tu reel', 'uso chatgpt', null]);
    const result = await runSimulation(deps, { persona: 'nivel 1' });
    expect(result.turns.map((t) => t.who)).toEqual(['lead', 'setter', 'lead', 'setter']);
    expect(result.endReason).toBe('El lead dio la conversación por terminada');
    expect(decide.mock.calls[0]?.[0]).toContain(TEST_SETTER_LINKS.agenda);
    expect(decide.mock.calls[1]?.[1]).toEqual([
      { role: 'user', content: 'hola, vi tu reel' },
      { role: 'assistant', content: sampleOutput().messages.join('\n') },
      { role: 'user', content: 'uso chatgpt' },
    ]);
    expect(result.usage.cacheReadTokens).toBe(10000);
    expect(result.stopped).toBe(false);
  });

  it('usa el primer mensaje fijo del escenario (p. ej. un audio)', async () => {
    const { next, deps } = fakes([null]);
    const result = await runSimulation(deps, { persona: 'x', firstMessage: NO_TEXT_PLACEHOLDER });
    expect(result.turns[0]).toEqual({ who: 'lead', texts: [NO_TEXT_PLACEHOLDER] });
    expect(next).toHaveBeenCalledTimes(1); // solo para la respuesta, no para el primer mensaje
  });

  it.each([
    ['pide a Jose', sampleOutput({ needs_human: true, needs_human_reason: 'queja' }), 'Pide que intervenga Jose'],
    ['posible menor', sampleOutput({}, { es_menor: 'si' }), 'Posible menor'],
    ['enlace prohibido', sampleOutput({ messages: ['paga aquí https://otro.com'] }), 'Respuesta retenida'],
    ['pide a Jose sin escribir nada', sampleOutput({ messages: [], needs_human: true, needs_human_reason: 'queja' }), 'Pide que intervenga Jose'],
  ])('termina y marca la IA como parada si %s (igual que en producción)', async (_name, output, reason) => {
    const { decide, deps } = fakes(['hola', 'sigo']);
    decide.mockResolvedValue(ok(output));
    const result = await runSimulation(deps, { persona: 'x' });
    expect(result.endReason).toContain(reason);
    expect(result.stopped).toBe(true);
    expect(result.turns).toHaveLength(2);
  });

  it('si Claude falla, termina parada', async () => {
    const { decide, deps } = fakes(['hola']);
    decide.mockResolvedValue({ kind: 'failed', detail: 'sin conexión' });
    const result = await runSimulation(deps, { persona: 'x' });
    expect(result).toMatchObject({ stopped: true, endReason: expect.stringContaining('Fallo de Claude') });
  });

  it('para en el límite de turnos', async () => {
    const { deps } = fakes(Array.from({ length: 20 }, (_, i) => `mensaje ${i}`));
    const result = await runSimulation({ ...deps, maxTurns: 3 }, { persona: 'x' });
    expect(result.turns).toHaveLength(6);
    expect(result.endReason).toBe('Límite de 3 turnos');
  });
});

describe('verdict y coste', () => {
  const base = { turns: [], endReason: '', usage: USAGE };
  it('comprueba el siguiente paso y si la IA se para', () => {
    expect(verdict({ expectStep: ['agendar_llamada'] }, { ...base, stopped: false, lead: sampleOutput({}, { siguiente_paso: 'agendar_llamada' }).lead })?.ok).toBe(true);
    expect(verdict({ expectStep: ['agendar_llamada'] }, { ...base, stopped: false, lead: sampleOutput().lead })?.ok).toBe(false);
    expect(verdict({ expectStop: true }, { ...base, stopped: false, lead: null })?.detail).toContain('✘');
    expect(verdict({}, { ...base, stopped: false, lead: null })).toBeNull();
  });

  it('coste con precios de Haiku 5.5 (entrada 0,10 $/M, salida 0,50 $/M, lectura de caché ×0,1, escritura ×1,25)', () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBeCloseTo(0.1);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 })).toBeCloseTo(0.5 + 0.01 + 0.125);
  });

  it('todos los escenarios tienen id único y perfil', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.every((s) => s.persona.length > 20 && s.check.length > 10)).toBe(true);
  });
});

describe('panel /setter/simulador', () => {
  const PASSWORD = 'contraseña-larga-123';
  const auth = `Basic ${Buffer.from(`jose:${PASSWORD}`).toString('base64')}`;
  const config: Config = {
    port: 3000, databaseUrl: 'x', adminPassword: PASSWORD, webhookVerifyToken: 't', appSecrets: ['s'], igAccessToken: null, igApiVersion: 'v25.0',
    tokenEncryptionKey: null, publicBaseUrl: null, limits: { privateReplies: 1, publicReplies: 1, followUps: 1 },
    delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, setter: TEST_SETTER_CONFIG,
  };
  function setup(withSimulator = true) {
    const store = createMemoryStore();
    const { deps } = fakes(['hola', null]);
    const app = createApp({ config, store, client: null, tokens: new TokenManager({ store, envToken: null, encryptionKey: null }), processPayload: vi.fn(), linkSecret: null, simulator: withSimulator ? { brain: deps.brain, lead: deps.lead } : null });
    const post = (path: string, fields: Record<string, string> = {}) =>
      app.request(`http://localhost${path}`, { method: 'POST', headers: { authorization: auth, origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    return { app, store, post };
  }

  it('lista los escenarios (con contraseña) y avisa si falta el documento', async () => {
    const { app } = setup();
    expect((await app.request('http://localhost/setter/simulador')).status).toBe(401);
    const page = await (await app.request('http://localhost/setter/simulador', { headers: { authorization: auth } })).text();
    expect(page).toContain('Menor de edad');
    expect(page).toContain('No hay documento del setter');
  });

  it('simula un escenario: enseña el hilo, la comprobación y el coste, y lo apunta en eventos', async () => {
    const { store, post } = setup();
    await store.saveKnowledge('DOC');
    const res = await post('/setter/simulador/nivel1-con-dinero');
    const page = await res.text();
    expect(res.status).toBe(200);
    expect(page).toContain('Nivel 1 con ahorros');
    expect(page).toContain('hola');
    expect(page).toContain('Comprobación automática');
    expect(page).toContain('<strong>Coste:</strong> setter');
    expect(store.events.at(-1)).toMatchObject({ kind: 'simulacion' });
    expect(store.messages).toHaveLength(0); // no se guarda como conversación real
  });

  it('perfil personalizado vacío vuelve a la lista; sin clave avisa', async () => {
    const { store, post } = setup(false);
    await store.saveKnowledge('DOC');
    expect((await post('/setter/simulador/personalizado', { persona: '  ' })).status).toBe(303);
    expect(await (await post('/setter/simulador/menor')).text()).toContain('Falta ANTHROPIC_API_KEY');
  });
});
