import { Hono, type Context } from 'hono';
import type { Config } from './config.js';
import type { InstagramConnect } from './instagram-connect.js';
import { MetaApiError, type Account, type InstagramClient } from './meta/client.js';
import type { TokenManager } from './meta/token.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { SETTINGS, type Store } from './store.js';
import type { UserStore } from './users.js';

/**
 * Configuración · Instagram y envíos (Fase 6.7b). Solo admin. Sustituye a /eventos del panel antiguo (sin el rescate:
 * decisión de Jose). Los límites por hora solo se ven (se cambian en Render); la pausa del 368 se quita con REANUDAR.
 * El bloqueo largo de envíos se pone/quita con /api/conversations/sends-block (ya existía, Fase 6.2).
 */

export interface SettingsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly config: Config;
  readonly client: InstagramClient | null;
  readonly tokens: TokenManager;
  readonly linkTracking: boolean;
  /** Prueba de "Conectar Instagram" (antes de la 7.5). null si no hay dirección pública del servidor. */
  readonly connect?: InstagramConnect | null;
  /** Espacio de esta app (7.5c): va dentro del enlace de Conectar Instagram. null = el principal (solo prueba). */
  readonly workspaceId?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
/** Eventos que se leen para el registro (se filtran por tipo en memoria). */
const EVENTS_READ = 500;
const EVENTS_SHOWN = 200;

function errorMessage(error: unknown): string {
  if (error instanceof MetaApiError) return `${error.message} (HTTP ${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Fecha guardada solo si todavía no ha pasado. */
const stillActive = (iso: string | null): string | null => (iso && Date.parse(iso) > Date.now() ? iso : null);

export function createSettingsApi(deps: SettingsApiDeps): Hono<ApiEnv> {
  const { store, config, client, tokens } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));
  api.use('*', requireAdmin);

  api.get('/status', async (c) => {
    let account: Account | null = null;
    let accountError: string | null = client ? null : 'Falta el token de Instagram';
    if (client) {
      try {
        account = await client.getAccount();
      } catch (error) {
        accountError = errorMessage(error);
      }
    }
    const hourAgo = new Date(Date.now() - HOUR_MS);
    const [token, pausedUntil, pauseReason, blockedUntil, blockedReason, privateReplies, publicReplies, followUps, flows] = await Promise.all([
      tokens.status(),
      store.getSetting(SETTINGS.pausedUntil),
      store.getSetting(SETTINGS.pauseReason),
      store.getSetting(SETTINGS.sendsBlockedUntil),
      store.getSetting(SETTINGS.sendsBlockedReason),
      store.countSendsSince(hourAgo, ['private_reply']),
      store.countSendsSince(hourAgo, ['reply_comment']),
      store.countSendsSince(hourAgo, ['send_message', 'send_dm']),
      store.listFlows(),
    ]);
    const pause = stillActive(pausedUntil);
    const block = stillActive(blockedUntil);
    return c.json({
      account,
      accountError,
      secretConfigured: config.appSecrets.length > 0,
      linkTracking: deps.linkTracking,
      setterKey: config.setter.anthropicApiKey !== null,
      token,
      pause: pause ? { until: pause, reason: pauseReason } : null,
      block: block ? { until: block, reason: blockedReason } : null,
      sends: { privateReplies, publicReplies, followUps },
      limits: config.limits,
      flows: { active: flows.filter((flow) => flow.enabled).length, total: flows.length },
    });
  });

  api.post('/pause/clear', async (c) => {
    if (((await readJson(c)) as { confirm?: unknown } | null)?.confirm !== 'REANUDAR') return c.json({ error: 'Para reanudar los envíos, escribe REANUDAR.' }, 400);
    await store.setSetting(SETTINGS.pausedUntil, null);
    await store.setSetting(SETTINGS.pauseReason, null);
    await store.logEvent('reanudado', `${c.get('user').name} reanudó los envíos desde Configuración.`, null);
    return c.json({ ok: true });
  });

  api.post('/token/refresh', async (c) => {
    const message = await tokens.refreshIfDue(true);
    await store.logEvent('token', `${c.get('user').name} pidió renovar el token: ${message}`, null);
    return c.json({ message });
  });

  api.post('/subscribe', async (c) => {
    if (!client) return c.json({ error: 'Falta el token de Instagram.' }, 503);
    try {
      const result = await client.subscribe();
      await store.logEvent('suscripcion', `${c.get('user').name} volvió a suscribir los avisos de Meta.`, result);
      return c.json({ result });
    } catch (error) {
      return c.json({ error: `Error al suscribir: ${errorMessage(error)}` }, 502);
    }
  });

  api.get('/instagram/connect-url', (c) =>
    deps.connect ? c.json({ url: deps.connect.authorizeUrl(deps.workspaceId ?? null) }) : c.json({ error: 'Falta la dirección pública del servidor.' }, 503),
  );

  api.get('/events', async (c) => {
    const kind = c.req.query('kind') || null;
    const events = await store.recentEvents(EVENTS_READ);
    return c.json({
      kinds: [...new Set(events.map((e) => e.kind))].sort(),
      events: events.filter((e) => !kind || e.kind === kind).slice(0, EVENTS_SHOWN),
    });
  });

  return api;
}
