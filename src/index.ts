import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { InstagramClient } from './meta/client.js';
import { TokenManager } from './meta/token.js';
import { processInBackground } from './process.js';
import { Sender } from './sender.js';
import { createPostgresStore } from './store.js';

const TOKEN_CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_TOKEN_CHECK_MS = 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createPostgresStore(config.databaseUrl);
  const tokens = new TokenManager({ store, envToken: config.igAccessToken, encryptionKey: config.tokenEncryptionKey });
  const hasToken = (await tokens.get()) !== null;
  const client = hasToken ? new InstagramClient(() => tokens.get(), config.igApiVersion) : null;

  const sender = new Sender(
    {
      store,
      client,
      limitPerHour: config.sendLimitPerHour,
      minDelayMs: config.sendDelayMinMs,
      maxDelayMs: config.sendDelayMaxMs,
    },
    async (flowId) => (await store.listFlows()).find((flow) => flow.id === flowId),
  );

  const app = createApp({
    config,
    store,
    client,
    tokens,
    processPayload: (payload) => processInBackground(payload, { store, sender }),
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
    server.close();
    sender
      .idle()
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
