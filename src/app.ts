import { Hono, type Context } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { csrf } from 'hono/csrf';
import type { Config } from './config.js';
import { EMPTY_FORM, flowToForm, formToFlow, newFlowId, readForm } from './flows/form.js';
import { validateFlow } from './flows/types.js';
import { InstagramClient, MetaApiError, type Account, type Media } from './meta/client.js';
import { isValidSignature } from './meta/signature.js';
import type { TokenManager } from './meta/token.js';
import { readLinkToken } from './links.js';
import { buildFunnel } from './funnel.js';
import { flowFormPage, flowJsonPage, flowsListPage } from './pages-flows.js';
import { metricsPage, parsePeriod, periodStart } from './pages-metrics.js';
import { contactsPage, dashboardPage, legalPage } from './pages.js';
import { registerSetter } from './routes-setter.js';
import type { SetterBrain } from './setter/brain.js';
import type { DiscardResult, DraftResult } from './setter/service.js';
import type { LeadPlayer } from './setter/simulator.js';
import { SETTINGS, type Store } from './store.js';

const ADMIN_USER = 'jose';
const DASHBOARD_ROWS = 60;
const MEDIA_FOR_FORM = 25;
const HOUR_MS = 60 * 60 * 1000;
const CONTACTS_ROWS = 200;
/** Reels recientes que se cargan para poner nombre a los IDs en Contactos (los más antiguos salen por ID). */
const MEDIA_FOR_STATS = 50;

/** Ejemplo que aparece al crear un flujo avanzado: mensaje con botón → mensaje con enlace con etiqueta → pausa → mensaje. */
const EXAMPLE_JSON_FLOW = {
  name: 'Mi flujo avanzado',
  enabled: false,
  trigger: { mediaIds: 'all', keywords: [] },
  publicReplies: ['¡Te escribí por DM! 📩'],
  startNodeId: 'inicio',
  nodes: [
    { id: 'inicio', type: 'message', text: '¡Hola! ¿Te mando el recurso?', buttons: [{ type: 'postback', title: 'Sí, mándamelo', next: 'recurso' }] },
    {
      id: 'recurso',
      type: 'message',
      text: 'Aquí lo tienes 👇',
      buttons: [{ type: 'url', title: 'Abrir', url: 'https://example.com', tags: ['recurso'] }],
      next: 'espera',
    },
    { id: 'espera', type: 'delay', seconds: 120, next: 'extra' },
    { id: 'extra', type: 'message', text: 'Por cierto…', buttons: [] },
  ],
  testUsernames: [],
  oncePerUser: true,
};

export interface AppDeps {
  readonly config: Config;
  readonly store: Store;
  readonly client: InstagramClient | null;
  readonly tokens: TokenManager;
  /** Clave para verificar los enlaces con seguimiento. null = desactivados. */
  readonly linkSecret: string | null;
  /** Procesa un aviso de Meta en segundo plano. */
  readonly processPayload: (payload: unknown) => void;
  /** Rescata comentarios sin respuesta desde una fecha (pone en cola sus DMs). */
  readonly rescue?: (since: Date) => Promise<{ queued: number; skipped: number; since: string }>;
  /** Rescate de una vez por DM (botón de /conversaciones): manda el flujo a quien lo necesita. */
  readonly rescueDms?: () => Promise<{ queued: number }>;
  /** Borradores del setter (modo borrador): enviar tal cual o descartar desde la conversación. */
  readonly drafts?: { approve(igId: string): Promise<DraftResult>; discard(igId: string): Promise<DiscardResult> };
  /** Contesta ya si el último mensaje de esa persona está sin responder (al reanudar la IA). */
  readonly replyPending?: (igId: string) => Promise<void>;
  /** Simulador del setter (null = sin ANTHROPIC_API_KEY). */
  readonly simulator?: { readonly brain: SetterBrain; readonly lead: LeadPlayer } | null;
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

/** Enlaces con seguimiento: registra el clic, añade etiquetas y redirige al destino real. */
function registerLinks(app: Hono, deps: AppDeps): void {
  app.get('/l/:token', async (c) => {
    const data = deps.linkSecret ? readLinkToken(deps.linkSecret, c.req.param('token')) : null;
    if (!data) return c.text('Enlace no válido', 404);
    try {
      await deps.store.logEvent('click', `Clic en enlace del flujo ${data.f} (paso ${data.n}).`, data);
      await deps.store.addContactTags(data.r, data.t);
    } catch (error) {
      // Si falla el registro, la persona igualmente llega a su destino.
      process.stderr.write(`[setter-ai] No se pudo registrar el clic: ${String(error)}\n`);
    }
    return c.redirect(data.u, 302);
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
      Promise.all([
        store.countSendsSince(new Date(Date.now() - HOUR_MS), ['private_reply']),
        store.countSendsSince(new Date(Date.now() - HOUR_MS), ['reply_comment']),
        store.countSendsSince(new Date(Date.now() - HOUR_MS), ['send_message', 'send_dm']),
      ]),
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
        sends: { privateReplies: sendsLastHour[0], publicReplies: sendsLastHour[1], followUps: sendsLastHour[2] },
        limits: config.limits,
        activeFlows: flows.filter((flow) => flow.enabled).length,
        totalFlows: flows.length,
        linkTracking: deps.linkSecret !== null,
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

  app.post('/eventos/rescatar', async (c) => {
    if (!deps.rescue) return c.redirect(withMsg('/eventos', 'El rescate no está disponible.'), 303);
    const form = await c.req.parseBody();
    const since = new Date(typeof form.desde === 'string' ? form.desde : '');
    if (Number.isNaN(since.getTime())) return c.redirect(withMsg('/eventos', 'Fecha "desde" no válida.'), 303);
    const result = await deps.rescue(since);
    await store.logEvent('rescate', `Jose lanzó el rescate desde ${result.since}: ${result.queued} en cola, ${result.skipped} omitidos.`, result);
    return c.redirect(withMsg('/eventos', `Rescate: ${result.queued} comentarios en cola (${result.skipped} omitidos) desde ${result.since}.`), 303);
  });

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

  const renderJson = async (c: Context, json: string, errors: string[], flowId: string | null) =>
    c.html(flowJsonPage({ json, errors, flowId, media: await loadMedia(client, MEDIA_FOR_FORM) }), errors.length ? 400 : 200);

  const saveJson = async (c: Context, flowId: string | null) => {
    const body = await c.req.parseBody();
    const json = typeof body.json === 'string' ? body.json : '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      return renderJson(c, json, [`El JSON no es válido: ${error instanceof Error ? error.message : String(error)}`], flowId);
    }
    // El id lo manda la URL al editar; al crear, si no trae uno, se genera.
    const candidate = { ...(parsed as Record<string, unknown>), id: flowId ?? ((parsed as { id?: unknown })?.id || newFlowId()) };
    const result = validateFlow({ template: 'json', ...candidate });
    if (!result.ok) return renderJson(c, json, result.errors, flowId);
    if (!flowId && (await findFlow(result.flow.id))) return renderJson(c, json, [`Ya existe un flujo con id "${result.flow.id}".`], flowId);
    await store.saveFlow(result.flow);
    await store.logEvent('flujo', `Flujo avanzado "${result.flow.name}" guardado (${result.flow.enabled ? 'activo' : 'inactivo'}).`, result.flow);
    return c.redirect(withMsg('/flujos', `Flujo "${result.flow.name}" guardado.`), 303);
  };

  app.get('/flujos/nuevo-json', (c) => renderJson(c, JSON.stringify(EXAMPLE_JSON_FLOW, null, 2), [], null));
  app.post('/flujos/nuevo-json', (c) => saveJson(c, null));
  app.post('/flujos/:id/json', (c) => saveJson(c, c.req.param('id')));

  app.get('/flujos/:id', async (c) => {
    const flow = await findFlow(c.req.param('id'));
    if (!flow) return c.redirect(withMsg('/flujos', 'Ese flujo no existe.'), 303);
    const form = flowToForm(flow);
    return form ? renderFlowForm(c, deps, form, [], false) : renderJson(c, JSON.stringify(flow, null, 2), [], flow.id);
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
  registerLinks(app, deps);

  // Panel privado: contraseña + protección contra formularios enviados desde otras webs.
  const auth = basicAuth({ username: ADMIN_USER, password: deps.config.adminPassword });
  for (const path of ['/eventos', '/eventos/*', '/flujos', '/flujos/*', '/contactos', '/metricas', '/setter', '/setter/*', '/conversaciones', '/conversaciones/*']) {
    app.use(path, auth);
  }
  for (const path of ['/eventos/*', '/flujos/*', '/setter/*', '/conversaciones/*']) app.use(path, csrf());

  registerDashboard(app, deps);
  registerFlows(app, deps);
  registerSetter(app, deps);
  app.get('/contactos', async (c) => {
    const [contacts, stats, media] = await Promise.all([
      deps.store.listContacts(CONTACTS_ROWS),
      deps.store.reelStats(),
      loadMedia(deps.client, MEDIA_FOR_STATS),
    ]);
    return c.html(contactsPage(contacts, stats, media));
  });
  app.get('/metricas', async (c) => {
    const period = parsePeriod(c.req.query('dias'));
    const [rows, media, setter] = await Promise.all([
      deps.store.funnelRows(periodStart(period)),
      loadMedia(deps.client, MEDIA_FOR_STATS),
      deps.store.setterStageStats(),
    ]);
    return c.html(metricsPage(buildFunnel(rows), media, period, setter));
  });
  return app;
}
