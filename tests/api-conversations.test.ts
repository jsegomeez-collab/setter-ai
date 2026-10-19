import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, TEST_SETTER_CONFIG, createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** API de Conversaciones del frontend (Fase 6.2): admin y equipo. El bloqueo de envíos, solo admin. */

const HOST = 'https://setter.test';
const SETUP_KEY = 'clave-del-panel-actual';
const config: Config = {
  port: 3000,
  databaseUrl: 'postgres://no-se-usa',
  adminPassword: SETUP_KEY,
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

async function setup() {
  const store = createMemoryStore();
  const users = createMemoryUserStore();
  await store.touchContact(STRANGER_ID, 'ana_ventas');
  await store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola, quiero info', mid: 'm1', status: 'sent', dedupKey: null });
  const sendManual = vi.fn().mockResolvedValue({ ok: true });
  const drafts = { approve: vi.fn().mockResolvedValue({ ok: true, sent: 1 }), discard: vi.fn().mockResolvedValue({ ok: true, discarded: 1 }) };
  const replyPending = vi.fn().mockResolvedValue(undefined);
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config, store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, users, drafts, replyPending, conversations: { sendManual } });
  const send = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
    app.request(`${HOST}${path}`, {
      method,
      headers: { cookie, origin: HOST, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setupRes = await send('POST', '/api/setup', '', { setupKey: SETUP_KEY, email: 'jose@x.com', name: 'Jose', password: 'una-clave-muy-larga' });
  const admin = (setupRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await users.createUser({ email: 'equipo@x.com', name: 'Laura', role: 'team', passwordHash: await hashPassword('clave-del-equipo-1') });
  const loginRes = await send('POST', '/api/login', '', { email: 'equipo@x.com', password: 'clave-del-equipo-1' });
  const team = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { store, send, admin, team, sendManual, drafts, replyPending };
}

describe('API Conversaciones (Fase 6.2)', () => {
  it('sin sesión 401; el equipo sí puede verlas', async () => {
    const { send, team } = await setup();
    expect((await send('GET', '/api/conversations', '')).status).toBe(401);
    expect((await send('GET', '/api/conversations', team)).status).toBe(200);
  });

  it('la bandeja trae las filas con su etapa, los filtros y si los envíos están bloqueados', async () => {
    const { send, admin, store } = await setup();
    store.settings.set(SETTINGS.sendsBlockedUntil, '2099-11-18T00:00:00.000Z');
    store.settings.set(SETTINGS.sendsBlockedReason, 'Bloqueo de Meta (30 días)');
    const data = await (await send('GET', '/api/conversations?filter=unanswered', admin)).json();
    expect(data.items).toEqual([expect.objectContaining({ igId: STRANGER_ID, username: 'ana_ventas', unanswered: true })]);
    expect(data.sendsBlocked).toEqual({ until: '2099-11-18T00:00:00.000Z', reason: 'Bloqueo de Meta (30 días)' });
    expect((await (await send('GET', '/api/conversations?filter=paused', admin)).json()).items).toEqual([]);
  });

  it('el detalle trae los mensajes, la ficha, su historial y si se puede responder', async () => {
    const { send, team } = await setup();
    const data = await (await send('GET', `/api/conversations/${STRANGER_ID}`, team)).json();
    expect(data.contact).toMatchObject({ username: 'ana_ventas', aiPaused: false });
    expect(data.messages).toEqual([expect.objectContaining({ direction: 'in', text: 'hola, quiero info' })]);
    expect(data.canReply).toEqual({ ok: true, reason: null });
    expect((await send('GET', '/api/conversations/no-existe', team)).status).toBe(404);
  });

  it('parar y reanudar la IA (al reanudar contesta lo pendiente); aprobar y descartar borradores', async () => {
    const { send, team, store, replyPending, drafts } = await setup();
    expect((await send('POST', `/api/conversations/${STRANGER_ID}/pause`, team, {})).status).toBe(200);
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(true);
    await send('POST', `/api/conversations/${STRANGER_ID}/resume`, team, {});
    expect((await store.getContact(STRANGER_ID))?.aiPaused).toBe(false);
    expect(replyPending).toHaveBeenCalledWith(STRANGER_ID);
    expect(await (await send('POST', `/api/conversations/${STRANGER_ID}/draft/approve`, team, {})).json()).toMatchObject({ ok: true, sent: 1 });
    expect(await (await send('POST', `/api/conversations/${STRANGER_ID}/draft/discard`, team, {})).json()).toMatchObject({ ok: true, discarded: 1 });
    expect(drafts.approve).toHaveBeenCalledWith(STRANGER_ID);
  });

  it('responder a mano: con los envíos bloqueados no se envía (423); sin bloqueo se envía con el nombre de quien escribe', async () => {
    const { send, team, store, sendManual } = await setup();
    store.settings.set(SETTINGS.sendsBlockedUntil, '2099-11-18T00:00:00.000Z');
    const blocked = await send('POST', `/api/conversations/${STRANGER_ID}/reply`, team, { text: 'hola' });
    expect(blocked.status).toBe(423);
    expect(sendManual).not.toHaveBeenCalled();
    store.settings.delete(SETTINGS.sendsBlockedUntil);
    expect((await send('POST', `/api/conversations/${STRANGER_ID}/reply`, team, { text: 'hola, soy Laura' })).status).toBe(200);
    expect(sendManual).toHaveBeenCalledWith(STRANGER_ID, 'hola, soy Laura', 'Laura');
    expect((await send('POST', `/api/conversations/${STRANGER_ID}/reply`, team, { text: '' })).status).toBe(400);
  });

  it('el bloqueo de envíos lo pone y lo quita solo el admin', async () => {
    const { send, admin, team, store } = await setup();
    const body = { until: '2026-11-18T00:00:00.000Z', reason: 'Bloqueo de Meta (30 días)' };
    expect((await send('POST', '/api/conversations/sends-block', team, body)).status).toBe(403);
    expect((await send('POST', '/api/conversations/sends-block', admin, body)).status).toBe(200);
    expect(store.settings.get(SETTINGS.sendsBlockedUntil)).toBe('2026-11-18T00:00:00.000Z');
    await send('POST', '/api/conversations/sends-block', admin, { until: null, reason: null });
    expect(store.settings.get(SETTINGS.sendsBlockedUntil) ?? null).toBeNull();
    expect((await send('POST', '/api/conversations/sends-block', admin, { until: 'no-es-fecha', reason: 'x' })).status).toBe(400);
  });
});
