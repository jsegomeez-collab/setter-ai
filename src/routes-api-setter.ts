import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Config } from './config.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import {
  VERSIONS_LIMIT,
  findOpeners,
  frameView,
  resetFrame,
  restoreVersion,
  saveSettings,
  saveVersion,
  updateOpener,
  versionSummary,
  type AdminResult,
} from './setter/admin.js';
import type { SetterBrain } from './setter/brain.js';
import { SCENARIOS, findScenario, type Scenario } from './setter/scenarios.js';
import { parseUsernames, readSetterMode } from './setter/service.js';
import { estimateCostUsd, runSimulation, verdict, type LeadPlayer } from './setter/simulator.js';
import { SETTINGS, type KnowledgeKind, type Store } from './store.js';
import type { UserStore } from './users.js';

/** API del módulo Setter IA del frontend (Fase 6.1). Solo admin (decisión de Jose). */

export interface SetterApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly config: Config;
  readonly simulator: { readonly brain: SetterBrain; readonly lead: LeadPlayer } | null;
}

const MAX_PERSONA_CHARS = 2000;
const MAX_TEST_USERNAMES = 50;
const MAX_OPENER_TEXTS = 40;

const textSchema = z.object({ text: z.string().max(200_000) });
const settingsSchema = z.object({ mode: z.string(), draft: z.boolean(), testUsernames: z.array(z.string().max(60)).max(MAX_TEST_USERNAMES) });
const openerSchema = z.object({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
  texts: z.array(z.string().max(2000)).max(MAX_OPENER_TEXTS),
  delaySeconds: z.number().int().optional(),
});
const simulateSchema = z.object({ scenarioId: z.string().max(80).optional(), persona: z.string().max(MAX_PERSONA_CHARS).optional() });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function reply(c: Context, result: AdminResult) {
  return result.ok ? c.json(result) : c.json({ error: result.error }, result.status);
}

const BAD_REQUEST = { error: 'Datos no válidos' };

export function createSetterApi(deps: SetterApiDeps): Hono<ApiEnv> {
  const { store, config } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users), requireAdmin);

  const simulatorProblem = async (): Promise<string | null> => {
    if (!deps.simulator) return 'Falta ANTHROPIC_API_KEY en Render: el simulador no puede llamar a Claude.';
    return (await store.getKnowledge()) ? null : 'No hay documento del setter cargado: guárdalo antes de simular.';
  };

  api.get('/', async (c) => {
    const [mode, draft, usernames, knowledge, knowledgeVersions, frame, frameVersions, flows, problem] = await Promise.all([
      readSetterMode(store),
      store.getSetting(SETTINGS.setterDraft),
      store.getSetting(SETTINGS.setterTestUsernames),
      store.getKnowledge(),
      store.listKnowledgeVersions(VERSIONS_LIMIT),
      store.getKnowledge('frame'),
      store.listKnowledgeVersions(VERSIONS_LIMIT, 'frame'),
      store.listFlows(),
      simulatorProblem(),
    ]);
    return c.json({
      mode,
      draft: draft === 'true',
      testUsernames: parseUsernames(usernames),
      model: config.setter.model,
      knowledge,
      knowledgeVersions: knowledgeVersions.map((v) => versionSummary(v, 'document')),
      frame: frameView(frame),
      frameVersions: frameVersions.map((v) => versionSummary(v, 'frame')),
      openers: findOpeners(flows),
      scenarios: SCENARIOS.map((s) => ({ id: s.id, group: s.group, title: s.title, persona: s.persona, check: s.check, opener: s.opener ?? null })),
      simulator: { available: problem === null, reason: problem },
    });
  });

  const saveText = (kind: KnowledgeKind) => async (c: Context) => {
    const parsed = textSchema.safeParse(await readJson(c));
    return parsed.success ? reply(c, await saveVersion(store, kind, parsed.data.text)) : c.json(BAD_REQUEST, 400);
  };
  const restore = (kind: KnowledgeKind) => async (c: Context) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) ? reply(c, await restoreVersion(store, kind, id)) : c.json(BAD_REQUEST, 400);
  };
  api.post('/knowledge', saveText('document'));
  api.post('/knowledge/:id/restore', restore('document'));
  api.post('/frame', saveText('frame'));
  api.post('/frame/reset', async (c) => reply(c, await resetFrame(store)));
  api.post('/frame/:id/restore', restore('frame'));

  api.post('/settings', async (c) => {
    const parsed = settingsSchema.safeParse(await readJson(c));
    return parsed.success ? reply(c, await saveSettings(store, parsed.data)) : c.json(BAD_REQUEST, 400);
  });

  api.post('/opener', async (c) => {
    const parsed = openerSchema.safeParse(await readJson(c));
    return parsed.success ? reply(c, await updateOpener(store, parsed.data)) : c.json(BAD_REQUEST, 400);
  });

  api.post('/simulate', async (c) => {
    const parsed = simulateSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json(BAD_REQUEST, 400);
    const { scenarioId, persona } = parsed.data;
    const custom: Omit<Scenario, 'group'> | null = persona?.trim()
      ? { id: 'personalizado', title: 'Perfil personalizado', persona: persona.trim(), check: 'Lo que tú decidas al leerlo.' }
      : null;
    const scenario = scenarioId ? findScenario(scenarioId) : custom;
    if (!scenario) return c.json({ error: scenarioId ? 'Ese escenario no existe.' : 'Elige un escenario o escribe un perfil.' }, scenarioId ? 404 : 400);
    const problem = await simulatorProblem();
    const [knowledge, frame] = await Promise.all([store.getKnowledge(), store.getKnowledge('frame')]);
    if (problem || !deps.simulator || !knowledge) return c.json({ error: problem ?? 'El simulador no está disponible.' }, 409);
    try {
      const result = await runSimulation({ ...deps.simulator, knowledge: knowledge.text, links: config.setter.links, frame: frame?.text ?? null }, scenario);
      const setterCost = estimateCostUsd(result.usage, config.setter.model);
      const leadCost = result.leadUsage ? estimateCostUsd(result.leadUsage) : 0;
      await store.logEvent('simulacion', `Simulación "${scenario.title}": ${result.endReason}.`, { scenario: scenario.id, turns: result.turns.length, usage: result.usage });
      return c.json({
        scenario: { id: scenario.id, title: scenario.title, persona: scenario.persona, check: scenario.check },
        turns: result.turns,
        lead: result.lead,
        endReason: result.endReason,
        stopped: result.stopped,
        verdict: verdict(scenario, result),
        cost: { setter: setterCost, lead: leadCost, total: setterCost + leadCost },
        model: config.setter.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.logEvent('error', `Fallo en la simulación "${scenario.title}".`, { error: message });
      return c.json({ error: `La simulación falló: ${message}` }, 500);
    }
  });

  return api;
}
