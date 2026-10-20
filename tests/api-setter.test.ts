import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { Flow } from '../src/flows/types.js';
import { TokenManager } from '../src/meta/token.js';
import type { BrainResult, SetterBrain } from '../src/setter/brain.js';
import type { LeadPlayer } from '../src/setter/simulator.js';
import { SETTINGS } from '../src/store.js';
import { TEST_SETTER_CONFIG, createMemoryStore, followFlow, sampleOutput } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API del módulo Setter IA del frontend (Fase 6.1). Solo admin. */

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

const OPENERS = ['oye! ¿a qué te dedicas?', 'ey! ¿ya usas la IA?'];
function openerFlow(): Flow {
  const base = followFlow({ id: 'manychat', name: 'Réplica ManyChat' });
  return {
    ...base,
    nodes: [
      ...base.nodes.map((n) => (n.id === 'resource' && n.type === 'message' ? { ...n, next: 'espera_setter' } : n)),
      { id: 'espera_setter', type: 'delay', seconds: 900, next: 'inicio_setter' },
      { id: 'inicio_setter', type: 'setter_opener', texts: OPENERS },
    ],
  };
}

const USAGE = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };

async function setup(options: { simulator?: boolean } = {}) {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  await store.saveFlow(openerFlow());
  store.settings.set(SETTINGS.setterMode, 'test');
  store.settings.set(SETTINGS.setterTestUsernames, 'josegomezlife');
  const decide = vi.fn<SetterBrain['decide']>().mockResolvedValue({ kind: 'ok', output: sampleOutput(), usage: USAGE } satisfies BrainResult);
  const lines: (string | null)[] = ['hola, vi tu reel', null];
  const lead: LeadPlayer = { next: vi.fn(async () => lines.shift() ?? null), takeUsage: () => USAGE };
  const simulator = options.simulator === false ? null : { brain: { decide }, lead };
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users, simulator });

  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setupRes = await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' });
  const admin = (setupRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Equipo', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const loginRes = await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' });
  const team = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { store, decide, send, admin, team };
}

describe('API Setter IA (Fase 6.1)', () => {
  it('solo el admin: sin sesión 401 y el equipo 403', async () => {
    const { send, team } = await setup();
    expect((await send('GET', '/api/setter', '')).status).toBe(401);
    expect((await send('GET', '/api/setter', team)).status).toBe(403);
    expect((await send('POST', '/api/setter/knowledge', team, { text: 'x' })).status).toBe(403);
  });

  it('GET da todo lo del módulo: modo, documento, marco (original con huecos), textos de inicio y escenarios', async () => {
    const { send, admin, store } = await setup();
    await store.saveKnowledge('DOC v1');
    const data = await (await send('GET', '/api/setter', admin)).json();
    expect(data).toMatchObject({ mode: 'test', draft: false, testUsernames: ['josegomezlife'], model: TEST_SETTER_CONFIG.model });
    expect(data.knowledge).toMatchObject({ text: 'DOC v1' });
    expect(data.knowledgeVersions).toHaveLength(1);
    expect(data.frame.isDefault).toBe(true);
    expect(data.frame.text).toContain('INSTRUCCIONES TÉCNICAS');
    expect(data.frame.text).toContain('[CORREO]');
    expect(data.openers).toEqual([{ flowId: 'manychat', flowName: 'Réplica ManyChat', nodeId: 'inicio_setter', texts: OPENERS, delayNodeId: 'espera_setter', delaySeconds: 900 }]);
    expect(data.scenarios.length).toBeGreaterThan(5);
    expect(data.simulator).toEqual({ available: true, reason: null });
  });

  it('documento: guarda versión nueva, no duplica si no cambia, rechaza vacío y restaura una anterior', async () => {
    const { send, admin, store } = await setup();
    const first = await (await send('POST', '/api/setter/knowledge', admin, { text: 'DOC v1\r\n' })).json();
    expect(first).toMatchObject({ ok: true });
    expect((await store.getKnowledge())?.text).toBe('DOC v1');
    expect(await (await send('POST', '/api/setter/knowledge', admin, { text: 'DOC v1' })).json()).toMatchObject({ unchanged: true });
    expect((await send('POST', '/api/setter/knowledge', admin, { text: '   ' })).status).toBe(400);
    await send('POST', '/api/setter/knowledge', admin, { text: 'DOC v2' });
    expect((await send('POST', `/api/setter/knowledge/${first.id}/restore`, admin, {})).status).toBe(200);
    expect((await store.getKnowledge())?.text).toBe('DOC v1');
    expect((await send('POST', '/api/setter/knowledge/9999/restore', admin, {})).status).toBe(404);
  });

  it('marco técnico: se cambia, queda en el historial y "volver al original" lo deja como al principio', async () => {
    const { send, admin } = await setup();
    await send('POST', '/api/setter/frame', admin, { text: '---\nMARCO PROPIO [CORREO]' });
    let data = await (await send('GET', '/api/setter', admin)).json();
    expect(data.frame).toMatchObject({ isDefault: false, text: '---\nMARCO PROPIO [CORREO]' });
    expect((await send('POST', '/api/setter/frame/reset', admin, {})).status).toBe(200);
    data = await (await send('GET', '/api/setter', admin)).json();
    expect(data.frame.isDefault).toBe(true);
    expect(data.frame.text).toContain('INSTRUCCIONES TÉCNICAS');
    expect(data.frameVersions.map((v: { isDefault: boolean }) => v.isDefault)).toEqual([true, false]);
  });

  it('ajustes: modo, borrador y usuarios de prueba (rechaza un modo inventado)', async () => {
    const { send, admin, store } = await setup();
    expect((await send('POST', '/api/setter/settings', admin, { mode: 'raro', draft: false, testUsernames: [] })).status).toBe(400);
    const res = await send('POST', '/api/setter/settings', admin, { mode: 'off', draft: true, testUsernames: ['@JoseGomezLife', ' otra '] });
    expect(res.status).toBe(200);
    expect(store.settings.get(SETTINGS.setterMode)).toBe('off');
    expect(store.settings.get(SETTINGS.setterDraft)).toBe('true');
    expect(store.settings.get(SETTINGS.setterTestUsernames)).toBe('josegomezlife,otra');
  });

  it('textos de inicio y espera: se guardan en el flujo; lo que no vale (sin textos, más de 23 h) no lo toca', async () => {
    const { send, admin, store } = await setup();
    const update = { flowId: 'manychat', nodeId: 'inicio_setter', texts: ['nuevo texto 1', '  ', 'nuevo texto 2'], delaySeconds: 60 };
    expect((await send('POST', '/api/setter/opener', admin, update)).status).toBe(200);
    const flow = (await store.listFlows()).find((f) => f.id === 'manychat');
    expect(flow?.nodes.find((n) => n.id === 'inicio_setter')).toMatchObject({ texts: ['nuevo texto 1', 'nuevo texto 2'] });
    expect(flow?.nodes.find((n) => n.id === 'espera_setter')).toMatchObject({ seconds: 60 });
    expect((await send('POST', '/api/setter/opener', admin, { ...update, texts: [' '] })).status).toBe(400);
    expect((await send('POST', '/api/setter/opener', admin, { ...update, delaySeconds: 24 * 3600 })).status).toBe(400);
    expect((await send('POST', '/api/setter/opener', admin, { ...update, flowId: 'no-existe' })).status).toBe(404);
    const after = (await store.listFlows()).find((f) => f.id === 'manychat');
    expect(after?.nodes.find((n) => n.id === 'espera_setter')).toMatchObject({ seconds: 60 });
  });

  it('simulador: corre un escenario y devuelve la conversación, la comprobación y el coste', async () => {
    const { send, admin, store } = await setup();
    await store.saveKnowledge('DOC');
    const res = await send('POST', '/api/setter/simulate', admin, { scenarioId: 'inicio-curioso' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.turns.map((t: { who: string }) => t.who)).toEqual(['setter', 'lead', 'setter']);
    expect(data.scenario).toMatchObject({ id: 'inicio-curioso' });
    expect(data.cost.setter).toBeGreaterThan(0);
    expect(data.cost.total).toBeGreaterThanOrEqual(data.cost.setter);
    expect(data.model).toBe(TEST_SETTER_CONFIG.model);
    expect((await send('POST', '/api/setter/simulate', admin, { scenarioId: 'no-existe' })).status).toBe(404);
  });

  it('simulador: también con un perfil escrito a mano; sin documento o sin clave de Claude lo dice claro', async () => {
    const withDoc = await setup();
    await withDoc.store.saveKnowledge('DOC');
    const custom = await withDoc.send('POST', '/api/setter/simulate', withDoc.admin, { persona: 'Tengo una tienda y quiero info' });
    expect((await custom.json()).turns.map((t: { who: string }) => t.who)).toEqual(['lead', 'setter']);
    const noDoc = await setup();
    const res = await noDoc.send('POST', '/api/setter/simulate', noDoc.admin, { persona: 'x' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('documento');
    const noKey = await setup({ simulator: false });
    const data = await (await noKey.send('GET', '/api/setter', noKey.admin)).json();
    expect(data.simulator.available).toBe(false);
  });
});

describe('API Setter IA · enlaces del espacio (Fase 7.5c)', () => {
  it('sin guardar, enseña los de reserva; se pueden guardar los suyos (validados) y desde entonces mandan', async () => {
    const { send, admin } = await setup();
    const before = await (await send('GET', '/api/setter', admin)).json();
    expect(before.links).toEqual({ ...config.setter.links, source: 'default' });
    const mine = { agenda: 'https://cal.com/pedro', membership: 'https://pedro.com/m', contactEmail: 'pedro@x.com' };
    expect((await send('POST', '/api/setter/links', admin, mine)).status).toBe(200);
    expect((await (await send('GET', '/api/setter', admin)).json()).links).toEqual({ ...mine, source: 'saved' });
    expect((await send('POST', '/api/setter/links', admin, { ...mine, agenda: 'no-es-un-enlace' })).status).toBe(400);
  });
});
