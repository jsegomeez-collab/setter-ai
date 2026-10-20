import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { InstagramConnect } from './instagram-connect.js';
import { deriveLinkSecret } from './links.js';
import { createRouter } from './router.js';
import { createPostgresStore } from './store.js';
import { createPostgresUserStore } from './users.js';
import { WorkspaceManager } from './workspace-manager.js';
import { startWorkspaceRuntime } from './workspace-runtime.js';
import { createPostgresWorkspaceRegistry, databaseUrlFor } from './workspaces.js';

/** ID de la app de Instagram "AI Setter-IG" (panel de Meta, 2026-10-19). Público: aparece en el enlace de inicio de sesión. */
const INSTAGRAM_APP_ID = '1117985297673013';
/** Conexiones a la base de cada espacio nuevo (el de Jose sigue con las de siempre). */
const WORKSPACE_DB_CONNECTIONS = 2;

/**
 * Arranque (Fase 7.5a): primero el espacio de Jose (principal, exactamente igual que antes), luego los demás espacios
 * guardados, cada uno con su base; un solo servidor reparte peticiones y avisos de Meta entre ellos (router.ts).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const users = await createPostgresUserStore(config.databaseUrl);
  const registry = await createPostgresWorkspaceRegistry(config.databaseUrl);
  const anthropic = config.setter.anthropicApiKey ? new Anthropic({ apiKey: config.setter.anthropicApiKey }) : null;
  // Enlaces con seguimiento: necesitan URL pública + clave. Si falta algo, los botones llevan la URL real.
  const linkSecret = config.tokenEncryptionKey ? deriveLinkSecret(config.tokenEncryptionKey) : null;

  // El principal reparte los avisos de Meta entre espacios; el gestor existe justo después (se enlaza aquí).
  let manager: WorkspaceManager | null = null;
  const principal = await startWorkspaceRuntime({
    config,
    workspaceId: null,
    store: await createPostgresStore(config.databaseUrl),
    users,
    anthropic,
    envToken: config.igAccessToken,
    linkSecret,
    webhookPayload: (payload) => (manager ? manager.dispatchWebhook(payload) : principal.process(payload)),
    // Crear espacios e invitar (7.5b): solo desde el de Jose. El gestor existe justo después.
    workspaces: {
      users,
      list: () => (manager ? manager.list() : Promise.resolve([])),
      create: (name) => {
        if (!manager) throw new Error('Los espacios aún están arrancando');
        return manager.create(name);
      },
    },
    // "Conectar Instagram". El ID de la app de Instagram es público (va en el enlace).
    instagramConnect: config.publicBaseUrl
      ? new InstagramConnect({
          appId: process.env.INSTAGRAM_APP_ID?.trim() || INSTAGRAM_APP_ID,
          appSecrets: config.appSecrets,
          redirectUri: `${config.publicBaseUrl.replace(/\/$/, '')}/oauth/instagram/callback`,
          apiVersion: config.igApiVersion,
        })
      : null,
  });

  manager = new WorkspaceManager({
    registry,
    principal,
    provision: (workspaceId) => registry.provision(workspaceId),
    start: async (workspace) =>
      startWorkspaceRuntime({
        config,
        workspaceId: workspace.id,
        store: await createPostgresStore(databaseUrlFor(config.databaseUrl, workspace.id), { maxConnections: WORKSPACE_DB_CONNECTIONS }),
        users,
        anthropic,
        envToken: null,
        linkSecret,
        workspace: { id: workspace.id, name: workspace.name },
      }),
    log: (message) => {
      process.stderr.write(`[setter-ai] ${message}\n`);
      principal.store.logEvent('espacios', message, null).catch(() => undefined);
    },
  });
  const activeManager = manager;
  await activeManager.boot();

  const router = createRouter({ users, manager: activeManager, linkSecret });
  const server = serve({ fetch: router.fetch, port: config.port }, (info) => {
    process.stdout.write(`[setter-ai] Escuchando en el puerto ${info.port}\n`);
  });

  const shutdown = () => {
    server.close();
    Promise.all([activeManager.closeAll(), principal.close()])
      .then(() => Promise.all([users.close(), registry.close()]))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`[setter-ai] No se pudo arrancar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
