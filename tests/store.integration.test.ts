import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planComment } from '../src/flows/engine.js';
import type { Flow } from '../src/flows/types.js';
import { createPostgresStore, SETTINGS, type Store } from '../src/store.js';
import { TEST_MEDIA_ID, followFlow } from './helpers.js';

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

  it('origen por reel: el primero se conserva, el último cambia, y el resumen por reel cuenta bien', async () => {
    await store.touchContact('500', 'ana', '1111111');
    await store.recordComment({ commentId: 'k1', igId: '500', username: 'ana', mediaId: '1111111', text: 'hola' });
    await store.recordComment({ commentId: 'k1', igId: '500', username: 'ana', mediaId: '1111111', text: 'hola' });
    await store.touchContact('500', 'ana', '2222222');
    await store.recordComment({ commentId: 'k2', igId: '500', username: 'ana', mediaId: '2222222', text: 'otra' });
    await store.touchContact('500', null);
    await store.touchContact('600', 'luis', '1111111');
    await store.recordComment({ commentId: 'k3', igId: '600', username: 'luis', mediaId: '1111111', text: '🔥' });
    await store.addContactTags('500', ['biblioteca']);
    const ana = (await store.listContacts(50)).find((c) => c.igId === '500');
    expect(ana).toMatchObject({ sourceMediaId: '1111111', lastMediaId: '2222222', username: 'ana' });
    const stats = await store.reelStats();
    expect(stats.find((s) => s.mediaId === '1111111')).toEqual({ mediaId: '1111111', comments: 2, people: 2, tagged: { biblioteca: 1 } });
    expect(stats.find((s) => s.mediaId === '2222222')).toMatchObject({ comments: 1, people: 1, tagged: {} });
  });

  it('comentarios sin respuesta privada (para el rescate)', async () => {
    const since = new Date(Date.now() - 60_000);
    await store.logEvent('comment', 'sin flujo', { kind: 'comment', commentId: 'r1', fromId: '1', accountId: '0' });
    await store.logEvent('comment', 'sin flujo', { kind: 'comment', commentId: 'r2', fromId: '2', accountId: '0' });
    await store.logEvent('postback', 'otra cosa', { kind: 'postback' });
    await store.claimAction('private:r2', 'private_reply', {});
    const pending = (await store.unansweredCommentEvents(since)) as { commentId: string }[];
    expect(pending.map((e) => e.commentId)).toEqual(['r1']);
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

  it('Fase 3 · mensajes: no duplica por mid, cambia estado y mid por clave, y lista en orden', async () => {
    await store.addMessage({ igId: 'p1', direction: 'in', source: 'user', text: 'hola', mid: 'mid-1', status: 'sent', dedupKey: null });
    await store.addMessage({ igId: 'p1', direction: 'in', source: 'user', text: 'hola (repetido)', mid: 'mid-1', status: 'sent', dedupKey: null });
    await store.addMessage({ igId: 'p1', direction: 'out', source: 'ai', text: 'respuesta', mid: null, status: 'queued', dedupKey: 'ai:mid-1' });
    await store.addMessage({ igId: 'p1', direction: 'out', source: 'flow', text: 'botones', mid: null, status: 'sent', dedupKey: null });
    await store.setMessageStatus('ai:mid-1', 'sent', 'mid-out-1');
    const messages = await store.listMessages('p1', 10);
    expect(messages.map((m) => [m.text, m.status, m.mid])).toEqual([
      ['hola', 'sent', 'mid-1'],
      ['respuesta', 'sent', 'mid-out-1'],
      ['botones', 'sent', null],
    ]);
    expect((await store.listMessages('p1', 2)).map((m) => m.text)).toEqual(['respuesta', 'botones']);
  });

  it('Fase 3 · conversaciones: último mensaje de cada persona, con username, pausa y ficha', async () => {
    await store.touchContact('p2', 'segunda');
    await store.addMessage({ igId: 'p2', direction: 'in', source: 'user', text: 'soy p2', mid: 'mid-p2', status: 'sent', dedupKey: null });
    await store.setAiPaused('p2', true, 'Jose escribió a mano');
    await store.saveLead('p2', { nivel: 'nivel_1', objeciones: ['es caro'] });
    const conversations = await store.listConversations(10);
    expect(conversations.map((c) => c.igId)).toEqual(['p2', 'p1']);
    expect(conversations[0]).toMatchObject({ username: 'segunda', lastText: 'soy p2', lastDirection: 'in', aiPaused: true, lead: { nivel: 'nivel_1', objeciones: ['es caro'] } });
    expect(conversations[1]).toMatchObject({ lastText: 'botones', aiPaused: false, lead: null });
    expect(await store.listConversations(1)).toHaveLength(1);
  });

  it('Fase 3 · contacto: pausa y ficha también para alguien nuevo; se puede reanudar', async () => {
    expect(await store.getContact('nadie')).toBeNull();
    await store.setAiPaused('p3', true, 'Posible menor de edad.');
    expect(await store.getContact('p3')).toMatchObject({ igId: 'p3', aiPaused: true, aiPausedReason: 'Posible menor de edad.', lead: null, tags: [] });
    await store.setAiPaused('p3', false, null);
    await store.saveLead('p3', { resumen: 'hola' });
    expect(await store.getContact('p3')).toMatchObject({ aiPaused: false, aiPausedReason: null, lead: { resumen: 'hola' } });
  });

  it('Fase 3 · acciones por message_id de Meta (para reconocer nuestros ecos) y getAction con respuesta', async () => {
    await store.claimAction('ai:mid-1', 'send_message', { type: 'send_message' });
    await store.finishAction('ai:mid-1', true, { recipientId: 'p1', messageId: 'mid-out-1' });
    await store.claimAction('private:c-9', 'private_reply', { type: 'private_reply' });
    await store.finishAction('private:c-9', true, { fallback: 'solo texto', result: { recipientId: 'p1', messageId: 'mid-out-2' } });
    expect(await store.findActionByMessageId('mid-out-1')).toMatchObject({ dedupKey: 'ai:mid-1' });
    expect(await store.findActionByMessageId('mid-out-2')).toMatchObject({ dedupKey: 'private:c-9' });
    expect(await store.findActionByMessageId('no-existe')).toBeNull();
    expect(await store.getAction('ai:mid-1')).toMatchObject({ ok: true, response: { messageId: 'mid-out-1' } });
  });

  it('un flujo guardado antes de existir un campo nuevo se lee con su valor por defecto (dmFailedReplies = [])', async () => {
    const old = { ...followFlow({ id: 'antiguo' }), dmFailedReplies: undefined } as unknown as Flow;
    await store.saveFlow(old);
    const read = (await store.listFlows()).find((flow) => flow.id === 'antiguo');
    expect(read?.dmFailedReplies).toEqual([]);
    expect(planComment([read as Flow], { kind: 'comment', commentId: 'c-x', fromId: 'p1', fromUsername: 'a', mediaId: TEST_MEDIA_ID, parentId: null, accountId: 'acc', text: 'hola' }).actions).toHaveLength(2);
    await store.deleteFlow('antiguo');
  });

  it('Plan B · último DM a comentario rechazado de una persona (solo fallidos, de esa persona y desde la fecha)', async () => {
    const reply = (recipientId: string) => ({ type: 'private_reply', message: { flowId: 'flow1', nodeId: 'start', recipientId } });
    await store.claimAction('private:f-1', 'private_reply', reply('p-fail'));
    await store.finishAction('private:f-1', false, { code: 100 });
    await store.claimAction('private:f-2', 'private_reply', reply('p-fail'));
    await store.finishAction('private:f-2', false, { code: 100 });
    await store.claimAction('private:ok-1', 'private_reply', reply('p-ok'));
    await store.finishAction('private:ok-1', true, { messageId: 'x' });
    const found = await store.failedPrivateReply('p-fail', new Date(Date.now() - 60_000));
    expect(found).toMatchObject({ dedupKey: 'private:f-2', request: { message: { nodeId: 'start' } } });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(await store.failedPrivateReply('p-ok', new Date(Date.now() - 60_000))).toBeNull();
    expect(await store.failedPrivateReply('p-fail', new Date(Date.now() + 60_000))).toBeNull();
  });

  it('Fase 3 · documento del setter: versiones, la última manda', async () => {
    expect(await store.getKnowledge()).toBeNull();
    const first = await store.saveKnowledge('versión 1');
    const second = await store.saveKnowledge('versión 2 con ñ y emojis 🚀');
    expect(second).toBeGreaterThan(first);
    expect(await store.getKnowledge()).toMatchObject({ id: second, text: 'versión 2 con ñ y emojis 🚀' });
    expect((await store.listKnowledgeVersions(10)).map((v) => v.id)).toEqual([second, first]);
  });
});
