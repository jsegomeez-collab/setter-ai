import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { reelLabel } from './contacts.js';
import type { Analyzer } from './intelligence/analyzer.js';
import { buildAnalysisInput, estimateAnalysisCost } from './intelligence/input.js';
import { reelTraffic } from './intelligence/traffic.js';
import { verifyFindings } from './intelligence/verify.js';
import type { MediaLoader } from './media-catalog.js';
import { parsePeriod, periodStart } from './pages-metrics.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { estimateCostUsd } from './setter/simulator.js';
import type { Store } from './store.js';
import type { UserStore } from './users.js';

/**
 * API de Inteligencia (Fase 6.6). Solo admin. El análisis con IA es MANUAL y cuesta dinero (decisión de Jose:
 * él controla el gasto): primero se ve la estimación y luego se confirma escribiendo ANALIZAR. Una a la vez.
 */

export interface IntelligenceApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly media: MediaLoader;
  /** null si no hay ANTHROPIC_API_KEY. */
  readonly analyzer: Analyzer | null;
}

/** ~100.000 tokens de conversaciones como mucho por análisis (≈0,26 $ con Sonnet 5.5). */
const MAX_INPUT_CHARS = 300_000;
const RUNS_SHOWN = 30;
const CONTACTS_LIMIT = 5000;
const runSchema = z.object({ days: z.string().optional(), confirm: z.literal('ANALIZAR') });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function createIntelligenceApi(deps: IntelligenceApiDeps): Hono<ApiEnv> {
  const { store, analyzer } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));
  api.use('*', requireAdmin);
  let running = false;

  const inputFor = async (days: string | undefined) => {
    const period = parsePeriod(days);
    const rows = await store.analysisMessages(periodStart(period));
    return { period, input: buildAnalysisInput(rows, { maxChars: MAX_INPUT_CHARS }) };
  };

  api.get('/preview', async (c) => {
    const { period, input } = await inputFor(c.req.query('days'));
    return c.json({
      period,
      conversations: input.conversations.length,
      skipped: input.skipped,
      chars: input.chars,
      estimatedCostUsd: estimateAnalysisCost(input.chars),
      available: analyzer !== null,
      running,
    });
  });

  api.post('/run', async (c) => {
    const parsed = runSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Para analizar (cuesta dinero), escribe ANALIZAR.' }, 400);
    if (!analyzer) return c.json({ error: 'Falta la clave de Anthropic (ANTHROPIC_API_KEY) en el servidor.' }, 503);
    if (running) return c.json({ error: 'Ya hay un análisis en marcha.' }, 409);
    const { period, input } = await inputFor(parsed.data.days);
    if (input.conversations.length === 0) return c.json({ error: 'No hay conversaciones con algo que analizar en ese periodo.' }, 400);
    running = true;
    try {
      const result = await analyzer.analyze(input.text);
      if (result.kind === 'failed') {
        await store.logEvent('inteligencia', `El análisis falló: ${result.detail}`, null);
        return c.json({ error: `El análisis falló: ${result.detail}` }, 502);
      }
      const usage = { ...result.usage, cacheReadTokens: 0, cacheCreationTokens: 0 };
      const costUsd = estimateCostUsd(usage, analyzer.model);
      const id = await store.saveAnalysisRun({
        createdBy: c.get('user').name,
        period: String(period),
        conversations: input.conversations.length,
        skipped: input.skipped,
        chars: input.chars,
        model: analyzer.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        result: verifyFindings(result.output, input.conversations),
      });
      await store.logEvent('inteligencia', `${c.get('user').name} analizó ${input.conversations.length} conversación(es) (${costUsd.toFixed(4)} $).`, { id });
      return c.json({ id });
    } finally {
      running = false;
    }
  });

  api.get('/runs', async (c) => c.json({ runs: await store.listAnalysisRuns(RUNS_SHOWN) }));

  api.get('/runs/:id', async (c) => {
    const run = await store.getAnalysisRun(Number(c.req.param('id')));
    return run ? c.json({ run }) : c.json({ error: 'Ese análisis no existe' }, 404);
  });

  api.get('/traffic', async (c) => {
    const contacts = await store.listContacts(CONTACTS_LIMIT);
    const traffic = reelTraffic(contacts.map((contact) => ({ sourceMediaId: contact.sourceMediaId, lead: (contact.lead as Record<string, unknown> | null) ?? null })));
    const media = await deps.media(traffic.map((reel) => reel.mediaId));
    const byId = new Map(media.map((m) => [m.id, m]));
    return c.json({ reels: traffic.map((reel) => ({ ...reel, label: reelLabel(byId.get(reel.mediaId), reel.mediaId) })) });
  });

  return api;
}
