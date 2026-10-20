import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { SETTINGS } from '../src/store.js';
import { startWorkspaceRuntime } from '../src/workspace-runtime.js';
import { TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** Arranque de un espacio (7.5): lo que cambia entre el de Jose y uno nuevo. */

const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: 'clave-del-panel-actual',
  webhookVerifyToken: 'token-verificacion',
  appSecrets: ['secreto-ig'],
  igAccessToken: null,
  igApiVersion: 'v25.0',
  tokenEncryptionKey: null,
  publicBaseUrl: null,
  limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
  delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
  setter: TEST_SETTER_CONFIG,
};

async function start(workspaceId: string | null) {
  const store = Object.assign(createMemoryStore(), { close: async () => undefined });
  const runtime = await startWorkspaceRuntime({ config, workspaceId, store, users: createMemoryUserStore(), anthropic: null, envToken: null, linkSecret: null });
  await runtime.close();
  return store;
}

describe('arranque de un espacio', () => {
  it('un espacio nuevo arranca con los envíos bloqueados (los activa Jose) y lo apunta en su registro', async () => {
    const store = await start('ws_pedro_ab12');
    expect(await store.getSetting(SETTINGS.sendsLocked)).toBe('true');
    expect(await store.getSetting(SETTINGS.sendsBlockedUntil)).not.toBeNull();
    expect(store.events.some((e) => e.kind === 'pausado' && /Jose/.test(e.note))).toBe(true);
  });

  it('el espacio de Jose NO se bloquea solo', async () => {
    const store = await start(null);
    expect(await store.getSetting(SETTINGS.sendsLocked)).toBeNull();
    expect(await store.getSetting(SETTINGS.sendsBlockedUntil)).toBeNull();
  });
});
