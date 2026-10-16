import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { InstagramClient } from './meta/client.js';
import { createPostgresStore } from './store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createPostgresStore(config.databaseUrl);
  const client = config.igAccessToken ? new InstagramClient(config.igAccessToken, config.igApiVersion) : null;
  const app = createApp({ config, store, client });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    process.stdout.write(`[setter-ai] Escuchando en el puerto ${info.port}\n`);
  });

  const shutdown = () => {
    server.close();
    store.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`[setter-ai] No se pudo arrancar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
