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

  it('contactos: alta, username que no se pierde y etiquetas sin repetir', async () => {
    await store.touchContact('777', 'josegomezlife');
    await store.touchContact('777', null);
    await store.addContactTags('777', ['biblioteca']);
    await store.addContactTags('777', ['Grupo WhatsApp', 'biblioteca']);
    await store.addContactTags('888', ['solo-etiqueta']);
    await store.addContactTags('777', []);
    const contacts = await store.listContacts(10);
    expect(contacts.find((c) => c.igId === '777')).toMatchObject({ username: 'josegomezlife', tags: ['Grupo WhatsApp', 'biblioteca'] });
    expect(contacts.find((c) => c.igId === '888')?.tags).toEqual(['solo-etiqueta']);
  });

  it('pausas programadas: guardar, no duplicar, coger una sola vez y terminar', async () => {
    const runAt = new Date('2026-10-16T12:02:00.000Z');
    const id = await store.scheduleJob('job:a', runAt, { flowId: 'f', nodeId: 'n', recipientId: '1', dedupKey: 'a', depth: 1 });
    expect(id).toEqual(expect.any(Number));
    expect(await store.scheduleJob('job:a', runAt, {})).toBeNull();
    const pending = await store.pendingJobs();
    expect(pending).toEqual([{ id, runAt, payload: { flowId: 'f', nodeId: 'n', recipientId: '1', dedupKey: 'a', depth: 1 } }]);
    expect(await store.claimJob(id as number)).toBe(true);
    expect(await store.claimJob(id as number)).toBe(false);
    await store.finishJob(id as number, 'done', { ok: true });
    expect(await store.pendingJobs()).toEqual([]);
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
