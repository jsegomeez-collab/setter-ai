import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { csrf } from 'hono/csrf';
import type { Config } from './config.js';
import { InstagramClient, MetaApiError, type Account, type Media } from './meta/client.js';
import { isValidSignature } from './meta/signature.js';
import { dashboardPage, legalPage } from './pages.js';
import { processInBackground } from './process.js';
import { SETTINGS, type Store } from './store.js';

const ADMIN_USER = 'jose';
const DASHBOARD_ROWS = 60;
const MEDIA_ID_PATTERN = /^\d{5,30}$/;

export interface AppDeps {
  readonly config: Config;
  readonly store: Store;
  readonly client: InstagramClient | null;
  /** Se inyecta en las pruebas; por defecto procesa el aviso en segundo plano. */
  readonly processPayload?: (payload: unknown) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof MetaApiError) return `${error.message} (HTTP ${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

export function createApp(deps: AppDeps): Hono {
  const { config, store, client } = deps;
  const processPayload =
    deps.processPayload ??
    ((payload: unknown) =>
      processInBackground(payload, { store, client, envAllowedSenderIds: config.allowedSenderIds }));

  const app = new Hono();

  app.get('/', (c) => c.text('setter-ai en marcha'));
  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/privacy', (c) => c.html(legalPage('privacy')));
  app.get('/terms', (c) => c.html(legalPage('terms')));
  app.get('/data-deletion', (c) => c.html(legalPage('data-deletion')));

  // Verificación del webhook: Meta llama una vez con hub.challenge al guardar la URL.
  app.get('/webhooks/instagram', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge') ?? '';
    if (mode === 'subscribe' && token === config.webhookVerifyToken) {
      return c.text(challenge);
    }
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
    if (!signatureOk) {
      return c.text('Firma no válida', 403);
    }
    processPayload(payload);
    return c.text('EVENT_RECEIVED');
  });

  // Panel privado.
  app.use('/eventos', basicAuth({ username: ADMIN_USER, password: config.adminPassword }));
  app.use('/eventos/*', basicAuth({ username: ADMIN_USER, password: config.adminPassword }));
  app.use('/eventos/*', csrf());

  app.get('/eventos', async (c) => {
    let account: Account | null = null;
    let accountError: string | null = client ? null : 'Falta IG_ACCESS_TOKEN';
    let media: Media[] = [];
    if (client) {
      try {
        account = await client.getAccount();
        media = await client.listMedia();
      } catch (error) {
        accountError = errorMessage(error);
      }
    }
    const [testMediaId, dmEnabled, allowed, events, actions] = await Promise.all([
      store.getSetting(SETTINGS.testMediaId),
      store.getSetting(SETTINGS.dmRepliesEnabled),
      store.listAllowedSenders(),
      store.recentEvents(DASHBOARD_ROWS),
      store.recentActions(DASHBOARD_ROWS),
    ]);
    return c.html(
      dashboardPage({
        account,
        accountError,
        tokenConfigured: client !== null,
        secretConfigured: config.appSecrets.length > 0,
        testMediaId,
        dmRepliesEnabled: dmEnabled === 'true',
        allowedSenders: [...config.allowedSenderIds, ...allowed],
        media,
        events,
        actions,
        flash: c.req.query('msg') ?? null,
      }),
    );
  });

  const back = (message: string) => `/eventos?msg=${encodeURIComponent(message)}`;

  app.post('/eventos/reel-prueba', async (c) => {
    const form = await c.req.parseBody();
    const mediaId = typeof form.mediaId === 'string' ? form.mediaId.trim() : '';
    if (!MEDIA_ID_PATTERN.test(mediaId)) {
      return c.redirect(back('ID de reel no válido.'), 303);
    }
    await store.setSetting(SETTINGS.testMediaId, mediaId);
    return c.redirect(back(`Reel de prueba guardado: ${mediaId}`), 303);
  });

  app.post('/eventos/dms', async (c) => {
    const form = await c.req.parseBody();
    const enabled = form.enabled === 'true';
    await store.setSetting(SETTINGS.dmRepliesEnabled, enabled ? 'true' : 'false');
    return c.redirect(back(enabled ? 'Respuestas por DM activadas.' : 'Respuestas por DM desactivadas.'), 303);
  });

  app.post('/eventos/suscribir', async (c) => {
    if (!client) return c.redirect(back('Falta IG_ACCESS_TOKEN.'), 303);
    try {
      const result = await client.subscribe();
      return c.redirect(back(`Suscripción: ${JSON.stringify(result)}`), 303);
    } catch (error) {
      return c.redirect(back(`Error al suscribir: ${errorMessage(error)}`), 303);
    }
  });

  return app;
}
