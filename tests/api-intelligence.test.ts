import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { Analyzer } from '../src/intelligence/analyzer.js';
import type { InstagramClient } from '../src/meta/client.js';
import { TokenManager } from '../src/meta/token.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de Inteligencia (Fase 6.6). Solo admin. Analizar gasta dinero: pide escribir ANALIZAR. IA falsa: no gasta nada. */

const HOST = 'https://setter.test';
const SETUP_KEY = 'clave-del-panel-actual';
const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: SETUP_KEY,
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  tokenEncryptionKey: null,
  publicBaseUrl: null,
  limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
  delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
  setter: TEST_SETTER_CONFIG,
};

const fakeAnalyzer = (): Analyzer & { analyze: ReturnType<typeof vi.fn> } => ({
  model: 'claude-sonnet-5-5',
  analyze: vi.fn().mockResolvedValue({
    kind: 'ok',
    usage: { inputTokens: 1000, outputTokens: 500 },
    output: {
      resumen: 'Dueños de negocio pequeños.',
      objeciones: [{ titulo: 'Precio', detalle: '', evidencias: [{ conversacion: 'C1', cita: 'cuánto cuesta' }] }],
      dolores: [{ titulo: 'Inventado', detalle: '', evidencias: [{ conversacion: 'C1', cita: 'esto nadie lo dijo' }] }],
      lenguaje: [],
      ideas_reels: [],
      datos_mercado: [],
    },
  }),
});

async function setup(analyzer: Analyzer | null = fakeAnalyzer()) {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  await store.touchContact('p1', 'ana', '18000000000000001');
  await store.saveLead('p1', { tipo_lead: 'empresa_dfy', nivel: 'nivel_1', puede_invertir: 'si', siguiente_paso: 'agendar_llamada' });
  await store.addMessage({ igId: 'p1', direction: 'in', source: 'user', text: 'Tengo una clínica, ¿cuánto cuesta?', mid: 'm1', status: 'sent', dedupKey: null });
  await store.addMessage({ igId: 'p2', direction: 'in', source: 'user', text: 'ok', mid: 'm2', status: 'sent', dedupKey: null });
  const client = {
    listMedia: vi.fn().mockResolvedValue([{ id: '18000000000000001', caption: 'Mi reel', permalink: null, timestamp: '2026-10-16T09:00:00+0000', mediaProductType: 'REELS' }]),
    getMedia: vi.fn().mockResolvedValue(null),
  } as unknown as InstagramClient;
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client, tokens, processPayload: vi.fn(), linkSecret: null, users, analyzer });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setupRes = await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' });
  const admin = (setupRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const loginRes = await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' });
  const team = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { store, send, admin, team };
}

describe('API Inteligencia (Fase 6.6)', () => {
  it('solo admin; la estimación dice cuántas conversaciones sirven (sin los "ok") y el coste, sin gastar nada', async () => {
    const analyzer = fakeAnalyzer();
    const { send, admin, team } = await setup(analyzer);
    expect((await send('GET', '/api/intelligence/preview', '')).status).toBe(401);
    expect((await send('GET', '/api/intelligence/preview', team)).status).toBe(403);
    const preview = await (await send('GET', '/api/intelligence/preview?days=30', admin)).json();
    expect(preview).toMatchObject({ period: 30, conversations: 1, skipped: 0, available: true });
    expect(preview.estimatedCostUsd).toBeGreaterThan(0);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('analizar pide ANALIZAR; guarda solo los hallazgos con citas reales y el coste medido', async () => {
    const analyzer = fakeAnalyzer();
    const { send, admin } = await setup(analyzer);
    expect((await send('POST', '/api/intelligence/run', admin, { days: '30' })).status).toBe(400);
    expect(analyzer.analyze).not.toHaveBeenCalled();

    const res = await send('POST', '/api/intelligence/run', admin, { days: '30', confirm: 'ANALIZAR' });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(analyzer.analyze.mock.calls[0]?.[0]).toContain('Persona: Tengo una clínica');

    const { run } = await (await send('GET', `/api/intelligence/runs/${id}`, admin)).json();
    expect(run.result.sections.objeciones).toEqual([{ title: 'Precio', detail: null, count: 1, evidence: [{ igId: 'p1', username: 'ana', quote: 'cuánto cuesta' }] }]);
    expect(run.result.sections.dolores).toEqual([]);
    expect(run.result.dropped).toEqual({ findings: 1, quotes: 1 });
    expect(run.costUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1_000_000, 6);
    expect((await (await send('GET', '/api/intelligence/runs', admin)).json()).runs).toEqual([expect.objectContaining({ id, conversations: 1, findings: 1, createdBy: 'Jose' })]);
  });

  it('sin clave de Anthropic se avisa (503); si la IA falla no se guarda nada; sin conversaciones no se analiza', async () => {
    const off = await setup(null);
    expect((await (await off.send('GET', '/api/intelligence/preview', off.admin)).json()).available).toBe(false);
    expect((await off.send('POST', '/api/intelligence/run', off.admin, { days: '30', confirm: 'ANALIZAR' })).status).toBe(503);

    const failing = fakeAnalyzer();
    failing.analyze.mockResolvedValue({ kind: 'failed', detail: 'caído' });
    const broken = await setup(failing);
    const res = await broken.send('POST', '/api/intelligence/run', broken.admin, { days: '30', confirm: 'ANALIZAR' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('caído');
    expect(await broken.store.listAnalysisRuns(10)).toEqual([]);

    const empty = await setup();
    await empty.store.deletePersonData('p1');
    expect((await empty.send('POST', '/api/intelligence/run', empty.admin, { days: '30', confirm: 'ANALIZAR' })).status).toBe(400);
  });

  it('tráfico por reel (sin IA): fichas sumadas por reel de origen, con su título', async () => {
    const { send, admin } = await setup();
    const { reels } = await (await send('GET', '/api/intelligence/traffic', admin)).json();
    expect(reels).toEqual([expect.objectContaining({ mediaId: '18000000000000001', label: '2026-10-16 · Mi reel', people: 1, withLead: 1, tipo: { empresa_dfy: 1 } })]);
  });
});
