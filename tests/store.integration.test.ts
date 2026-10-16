import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresStore, SETTINGS, type Store } from '../src/store.js';
import { followFlow } from './helpers.js';

/** Prueba el SQL de verdad contra un Postgres real (PGlite) en memoria. */

const PORT = 54329;
let db: PGlite;
let server: PGLiteSocketServer;
let store: Store & { close(): Promise<void> };

beforeAll(async () => {
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  store = await createPostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { ssl: false, maxConnections: 1 });
}, 60_000);

afterAll(async () => {
  await store?.close();
  await server?.stop();
  await db?.close();
});

describe('createPostgresStore (Postgres real)', () => {
  it('crea las tablas y se puede volver a arrancar sin error (idempotente, como un reinicio)', async () => {
    // PGlite solo admite una conexión a la vez: se cierra y se vuelve a abrir.
    await store.close();
    store = await createPostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { ssl: false, maxConnections: 1 });
    expect(await store.listFlows()).toEqual([]);
  });

  it('guarda, actualiza, lista y borra flujos (JSONB)', async () => {
    await store.saveFlow(followFlow());
    await store.saveFlow(followFlow({ name: 'Renombrado' }));
    await store.saveFlow(followFlow({ id: 'flow2', name: 'Otro' }));
    const flows = await store.listFlows();
    expect(flows.map((f) => f.name).sort()).toEqual(['Otro', 'Renombrado']);
    expect(flows.find((f) => f.id === 'flow1')?.nodes).toHaveLength(4);
    await store.deleteFlow('flow2');
    expect((await store.listFlows()).map((f) => f.id)).toEqual(['flow1']);
  });

  it('reserva acciones una sola vez y cuenta los envíos de la última hora', async () => {
    const before = new Date(Date.now() - 60_000);
    expect(await store.claimAction('reply:c1', 'reply_comment', { a: 1 })).toBe(true);
    expect(await store.claimAction('reply:c1', 'reply_comment', { a: 1 })).toBe(false);
    await store.claimAction('private:c1', 'private_reply', {});
    await store.claimAction('once:flow1:9', 'once', {});
    await store.claimAction('fail:1', 'send_message', {});
    await store.finishAction('fail:1', false, { error: 'x' });
    await store.finishAction('reply:c1', true, { id: 'r' });
    // Cuenta reply + private (no "once", no los fallidos).
    expect(await store.countSendsSince(before)).toBe(2);
    const actions = await store.recentActions(10);
    expect(actions.find((a) => a.dedupKey === 'reply:c1')).toMatchObject({ ok: true, response: { id: 'r' } });
  });

  it('settings: guardar, sobrescribir y borrar (null)', async () => {
    await store.setSetting(SETTINGS.pausedUntil, '2026-10-17T00:00:00.000Z');
    await store.setSetting(SETTINGS.pausedUntil, '2026-10-18T00:00:00.000Z');
    expect(await store.getSetting(SETTINGS.pausedUntil)).toBe('2026-10-18T00:00:00.000Z');
    await store.setSetting(SETTINGS.pausedUntil, null);
    expect(await store.getSetting(SETTINGS.pausedUntil)).toBeNull();
    expect(await store.getSetting('no-existe')).toBeNull();
  });

  it('eventos, peticiones y remitentes', async () => {
    await store.recordRequest(true, { object: 'instagram' });
    await store.logEvent('comment', 'nota', { text: 'hola 👋' });
    expect((await store.recentEvents(5))[0]).toMatchObject({ kind: 'comment', note: 'nota', data: { text: 'hola 👋' } });
    await store.allowSender('9');
    await store.allowSender('9');
    expect(await store.listAllowedSenders()).toEqual(['9']);
  });
});
