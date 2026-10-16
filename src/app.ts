import { Hono, type Context } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { csrf } from 'hono/csrf';
import type { Config } from './config.js';
import { EMPTY_FORM, flowToForm, formToFlow, readForm } from './flows/form.js';
import { validateFlow } from './flows/types.js';
import { InstagramClient, MetaApiError, type Account, type Media } from './meta/client.js';
import { isValidSignature } from './meta/signature.js';
import type { TokenManager } from './meta/token.js';
import { flowFormPage, flowReadOnlyPage, flowsListPage } from './pages-flows.js';
import { dashboardPage, legalPage } from './pages.js';
import { SETTINGS, type Store } from './store.js';

const ADMIN_USER = 'jose';
const DASHBOARD_ROWS = 60;
const MEDIA_FOR_FORM = 25;
const HOUR_MS = 60 * 60 * 1000;

export interface AppDeps {
  readonly config: Config;
  readonly store: Store;
  readonly client: InstagramClient | null;
  readonly tokens: TokenManager;
  /** Procesa un aviso de Meta en segundo plano. */
  readonly processPayload: (payload: unknown) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof MetaApiError) return `${error.message} (HTTP ${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

const withMsg = (path: string, message: string) => `${path}?msg=${encodeURIComponent(message)}`;

async function loadMedia(client: InstagramClient | null, limit: number): Promise<Media[]> {
  if (!client) return [];
  try {
    return await client.listMedia(limit);
  } catch {
    return [];
  }
}

function registerWebhook(app: Hono, deps: AppDeps): void {
  const { config, store, processPayload } = deps;

  // Verificación del webhook: Meta llama una vez con hub.challenge al guardar la URL.
  app.get('/webhooks/instagram', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    if (mode === 'subscribe' && token === config.webhookVerifyToken) return c.text(c.req.query('hub.challenge') ?? '');
    return c.text('Token de verificación incorrecto', 403);
  });

  // Avisos de Meta: se comprueba la firma, se guardan, se responde 200 rápido y se procesan después.
  app.post('/webhooks/instagram', async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    const signatureOk = isValidSignature(raw, c.req.header('x-hub-signature-256'), config.appSecrets);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      payload = { invalidJson: raw.toString('utf8').slice(0, 1000) };
    }
    await store.recordRequest(signatureOk, payload);
    if (!signatureOk) return c.text('Firma no válida', 403);
    processPayload(payload);
    return c.text('EVENT_RECEIVED');
  });
}

function registerDashboard(app: Hono, deps: AppDeps): void {
  const { config, store, client, tokens } = deps;

  app.get('/eventos', async (c) => {
    let account: Account | null = null;
    let accountError: string | null = client ? null : 'Falta el token de Instagram';
    if (client) {
      try {
        account = await client.getAccount();
      } catch (error) {
        accountError = errorMessage(error);
      }
    }
    const [token, pausedRaw, pauseReason, sendsLastHour, flows, events, actions] = await Promise.all([
      tokens.status(),
      store.getSetting(SETTINGS.pausedUntil),
      store.getSetting(SETTINGS.pauseReason),
      store.countSendsSince(new Date(Date.now() - HOUR_MS)),
      store.listFlows(),
      store.recentEvents(DASHBOARD_ROWS),
      store.recentActions(DASHBOARD_ROWS),
    ]);
    const pausedUntil = pausedRaw && new Date(pausedRaw).getTime() > Date.now() ? pausedRaw : null;
    return c.html(
      dashboardPage({
        account,
        accountError,
        secretConfigured: config.appSecrets.length > 0,
        token,
        pausedUntil,
        pauseReason,
        sendsLastHour,
        limitPerHour: config.sendLimitPerHour,
        activeFlows: flows.filter((flow) => flow.enabled).length,
        totalFlows: flows.length,
        events,
        actions,
        flash: c.req.query('msg') ?? null,
      }),
    );
  });

  app.post('/eventos/suscribir', async (c) => {
    if (!client) return c.redirect(withMsg('/eventos', 'Falta el token de Instagram.'), 303);
    try {
      return c.redirect(withMsg('/eventos', `Suscripción: ${JSON.stringify(await client.subscribe())}`), 303);
    } catch (error) {
      return c.redirect(withMsg('/eventos', `Error al suscribir: ${errorMessage(error)}`), 303);
    }
  });

  app.post('/eventos/renovar-token', async (c) => c.redirect(withMsg('/eventos', await tokens.refreshIfDue(true)), 303));

  app.post('/eventos/reanudar', async (c) => {
    await store.setSetting(SETTINGS.pausedUntil, null);
    await store.setSetting(SETTINGS.pauseReason, null);
    await store.logEvent('reanudado', 'Jose reanudó los envíos manualmente desde el panel.', null);
    return c.redirect(withMsg('/eventos', 'Envíos reanudados.'), 303);
  });
}

async function renderFlowForm(c: Context, deps: AppDeps, form: typeof EMPTY_FORM, errors: string[], isNew: boolean) {
  const media = await loadMedia(deps.client, MEDIA_FOR_FORM);
  const preview = errors.length === 0 && !isNew ? (await deps.store.listFlows()).find((flow) => flow.id === form.id) ?? null : null;
  return c.html(flowFormPage({ form, media, errors, isNew, preview }), errors.length ? 400 : 200);
}

function registerFlows(app: Hono, deps: AppDeps): void {
  const { store, client } = deps;
  const findFlow = async (id: string) => (await store.listFlows()).find((flow) => flow.id === id);

  app.get('/flujos', async (c) => {
    const [flows, media] = await Promise.all([store.listFlows(), loadMedia(client, MEDIA_FOR_FORM)]);
    return c.html(flowsListPage(flows, media, c.req.query('msg') ?? null));
  });

  app.get('/flujos/nuevo', (c) => renderFlowForm(c, deps, EMPTY_FORM, [], true));

  const save = async (c: Context, isNew: boolean) => {
    const form = { ...readForm(await c.req.parseBody({ all: true })), id: isNew ? '' : (c.req.param('id') ?? '') };
    const result = formToFlow(form);
    if (!result.ok) return renderFlowForm(c, deps, form, result.errors, isNew);
    await store.saveFlow(result.flow);
    await store.logEvent('flujo', `Flujo "${result.flow.name}" guardado (${result.flow.enabled ? 'activo' : 'inactivo'}).`, result.flow);
    return c.redirect(withMsg('/flujos', `Flujo "${result.flow.name}" guardado.`), 303);
  };

  app.post('/flujos/nuevo', (c) => save(c, true));

  app.get('/flujos/:id', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.redirect(withMsg('/flujos', 'Ese flujo no existe.'), 303);
    const form = flowToForm(flow);
    return form ? renderFlowForm(c, deps, form, [], false) : c.html(flowReadOnlyPage(flow));
  });

  app.post('/flujos/:id', (c) => save(c, false));

  app.post('/flujos/:id/activar', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.redirect(withMsg('/flujos', 'Ese flujo no existe.'), 303);
    const form = await c.req.parseBody();
    const result = validateFlow({ ...flow, enabled: form.enabled === 'true' });
    if (!result.ok) return c.redirect(withMsg('/flujos', `No se pudo cambiar: ${result.errors.join('; ')}`), 303);
    await store.saveFlow(result.flow);
    await store.logEvent('flujo', `Flujo "${flow.name}" ${result.flow.enabled ? 'activado' : 'desactivado'}.`, { id: flow.id });
    return c.redirect(withMsg('/flujos', `Flujo "${flow.name}" ${result.flow.enabled ? 'activado' : 'desactivado'}.`), 303);
  });

  app.post('/flujos/:id/borrar', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.redirect(withMsg('/flujos', 'Ese flujo no existe.'), 303);
    await store.deleteFlow(flow.id);
    await store.logEvent('flujo', `Flujo "${flow.name}" borrado.`, flow);
    return c.redirect(withMsg('/flujos', `Flujo "${flow.name}" borrado.`), 303);
  });
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/', (c) => c.text('setter-ai en marcha'));
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/privacy', (c) => c.html(legalPage('privacy')));
  app.get('/terms', (c) => c.html(legalPage('terms')));
  app.get('/data-deletion', (c) => c.html(legalPage('data-deletion')));

  registerWebhook(app, deps);

  // Panel privado: contraseña + protección contra formularios enviados desde otras webs.
  const auth = basicAuth({ username: ADMIN_USER, password: deps.config.adminPassword });
  for (const path of ['/eventos', '/eventos/*', '/flujos', '/flujos/*']) app.use(path, auth);
  app.use('/eventos/*', csrf());
  app.use('/flujos/*', csrf());

  registerDashboard(app, deps);
  registerFlows(app, deps);
  return app;
}
