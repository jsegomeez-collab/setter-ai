import { Hono } from 'hono';
import { reelLabel } from './contacts.js';
import { buildFunnel, fillDays } from './funnel.js';
import type { MediaLoader } from './media-catalog.js';
import { parsePeriod, periodStart } from './pages-metrics.js';
import { requireUser, type ApiEnv } from './routes-api.js';
import type { Store } from './store.js';
import type { UserStore } from './users.js';

/** API de Métricas del frontend (Fase 6.4): embudo (total, por reel, por día), setter y agenda. Admin y equipo. */

export interface MetricsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  /** Reels de la cuenta (los últimos + los de estos ids) para el título de cada uno. Vacío si Instagram no responde. */
  readonly media: MediaLoader;
}

export function createMetricsApi(deps: MetricsApiDeps): Hono<ApiEnv> {
  const { store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));

  api.get('/', async (c) => {
    const period = parsePeriod(c.req.query('days'));
    const [rows, setter, agenda] = await Promise.all([store.funnelRows(periodStart(period)), store.setterStageStats(), store.agendaStats()]);
    const funnel = buildFunnel(rows);
    const media = await deps.media(funnel.byReel.map((reel) => reel.key));
    const byId = new Map(media.map((m) => [m.id, m]));
    return c.json({
      period,
      funnel: {
        total: funnel.total,
        byReel: funnel.byReel.map((reel) => ({
          ...reel,
          label: reelLabel(byId.get(reel.key), reel.key),
          permalink: byId.get(reel.key)?.permalink ?? null,
          // Portada (Fase 8.1).
          cover: byId.get(reel.key)?.cover ?? null,
        })),
        byDay: fillDays(funnel.byDay),
      },
      setter,
      agenda,
    });
  });

  return api;
}
