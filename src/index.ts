import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { deriveLinkSecret } from './links.js';
import { InstagramClient } from './meta/client.js';
import { TokenManager } from './meta/token.js';
import { processInBackground, rescueComments } from './process.js';
import { Scheduler } from './scheduler.js';
import { Sender } from './sender.js';
import { ClaudeBrain } from './setter/brain.js';
import { EchoWatcher } from './setter/echoes.js';
import { SetterService } from './setter/service.js';
import { createPostgresStore } from './store.js';

const TOKEN_CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_TOKEN_CHECK_MS = 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createPostgresStore(config.databaseUrl);
  const tokens = new TokenManager({ store, envToken: config.igAccessToken, encryptionKey: config.tokenEncryptionKey });
  const hasToken = (await tokens.get()) !== null;
  const client = hasToken ? new InstagramClient(() => tokens.get(), config.igApiVersion) : null;

  // Enlaces con seguimiento: necesitan URL pública + clave. Si falta algo, los botones llevan la URL real.
  const linkSecret = config.tokenEncryptionKey ? deriveLinkSecret(config.tokenEncryptionKey) : null;
  const linkSigner = linkSecret && config.publicBaseUrl ? { baseUrl: config.publicBaseUrl, secret: linkSecret } : null;

  // El programador avisa al emisor cuando vence una pausa; el emisor programa pausas en el programador.
  let sender: Sender | null = null;
  const scheduler = new Scheduler({ store, onDue: (payload) => (sender ? sender.continueFlow(payload) : Promise.resolve({ skipped: 'sin emisor' })) });
  sender = new Sender(
    {
      store,
      client,
      limits: config.limits,
      delays: config.delays,
      linkSigner,
      schedule: (payload, delaySeconds) => scheduler.add(payload, delaySeconds),
    },
    async (flowId) => (await store.listFlows()).find((flow) => flow.id === flowId),
  );
  const activeSender = sender;
  const recovered = await scheduler.start();
  if (recovered > 0) await store.logEvent('pausas', `Recuperadas ${recovered} pausas pendientes tras el arranque.`, null);
  const resumed = await activeSender.recover();
  if (resumed > 0) await store.logEvent('cola', `Retomados ${resumed} envíos pendientes tras el arranque.`, null);

  // Setter IA (Fase 3). Sin ANTHROPIC_API_KEY los DMs se guardan pero no se responde. Arranca apagado (modo en /setter).
  const { anthropicApiKey, model, links } = config.setter;
  const brain = anthropicApiKey ? new ClaudeBrain(new Anthropic({ apiKey: anthropicApiKey }), model) : null;
  const setter = new SetterService({
    store,
    brain,
    links,
    enqueue: (actions) => activeSender.enqueue(actions),
    getUsername: async (igId) => (client ? client.getUsername(igId) : null),
  });
  const echoes = new EchoWatcher({ store });

  const app = createApp({
    config,
    store,
    client,
    tokens,
    linkSecret: linkSigner ? linkSecret : null,
    processPayload: (payload) => processInBackground(payload, { store, sender: activeSender, setter, echoes }),
    rescue: (since) => rescueComments(since, { store, sender: activeSender }),
  });

  const checkToken = () => {
    tokens
      .refreshIfDue()
      .then((result) => store.logEvent('token', result, null))
      .catch((error: unknown) => process.stderr.write(`[setter-ai] Error renovando token: ${String(error)}\n`));
  };
  const firstCheck = setTimeout(checkToken, FIRST_TOKEN_CHECK_MS);
  const periodicCheck = setInterval(checkToken, TOKEN_CHECK_EVERY_MS);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    process.stdout.write(`[setter-ai] Escuchando en el puerto ${info.port}\n`);
  });

  const shutdown = () => {
    clearTimeout(firstCheck);
    clearInterval(periodicCheck);
    scheduler.stop();
    server.close();
    Promise.all([setter.idle(), echoes.idle()])
      .then(() => activeSender.idle())
      .then(() => store.close())
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`[setter-ai] No se pudo arrancar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
