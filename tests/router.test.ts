import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, hashToken } from '../src/auth.js';
import { createLinkToken } from '../src/links.js';
import { createRouter } from '../src/router.js';
import { lockSends } from '../src/sends-lock.js';
import { SETTINGS } from '../src/store.js';
import { WorkspaceManager } from '../src/workspace-manager.js';
import type { WorkspaceRuntime } from '../src/workspace-runtime.js';
import type { Workspace, WorkspaceRegistry } from '../src/workspaces.js';
import { createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** Fase 7.5a: cada petición, aviso de Meta y clic va a su espacio. Para Jose (principal) todo sigue igual. */

function fakeRuntime(id: string | null): WorkspaceRuntime & { processed: unknown[]; saveToken: ReturnType<typeof vi.fn> } {
  const app = new Hono();
  app.all('*', (c) => c.text(`espacio:${id ?? 'principal'}`));
  const processed: unknown[] = [];
  return { id, store: createMemoryStore(), app, processed, process: (payload) => processed.push(payload), close: vi.fn().mockResolvedValue(undefined), saveToken: vi.fn().mockResolvedValue(undefined), accountId: async () => null };
}

function memoryRegistry(initial: Workspace[] = [], removedAccounts: string[] = []): WorkspaceRegistry {
  let rows = [...initial];
  let removed = [...removedAccounts];
  return {
    remove: async (id) => {
      const account = rows.find((w) => w.id === id)?.igUserId;
      rows = rows.filter((w) => w.id !== id);
      if (account) removed = [...removed, account];
    },
    removedIgUsers: async () => removed,
    list: async () => rows,
    create: async ({ id, name }) => {
      const ws = { id, name, igUserId: null, igUsername: null, createdAt: new Date() };
      rows = [...rows, ws];
      return ws;
    },
    setInstagram: async (id, igUserId, igUsername) => {
      if (rows.some((w) => w.igUserId === igUserId && w.id !== id)) throw new Error('repetida');
      rows = rows.map((w) => (w.id === id ? { ...w, igUserId, igUsername } : w));
    },
    findByIgUser: async (igUserId) => rows.find((w) => w.igUserId === igUserId) ?? null,
  };
}

const SOCIO: Workspace = { id: 'ws_socio_a1b2', name: 'Socio', igUserId: '1784140000000099', igUsername: 'socio_ig', createdAt: new Date() };

async function setup(removedAccounts: string[] = []) {
  const users = createMemoryUserStore();
  const jose = await users.createUser({ email: 'jose@x.com', name: 'Jose', role: 'admin', passwordHash: 'h' });
  const socio = await users.createUser({ email: 'socio@x.com', name: 'Socio', role: 'admin', passwordHash: 'h', workspaceId: SOCIO.id });
  await users.createSession(hashToken('tok-jose'), jose.id, new Date(Date.now() + 60_000));
  await users.createSession(hashToken('tok-socio'), socio.id, new Date(Date.now() + 60_000));
  const principal = fakeRuntime(null);
  const subscribe = vi.fn().mockResolvedValue(undefined);
  const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
  const dropDatabase = vi.fn().mockResolvedValue(undefined);
  const manager = new WorkspaceManager({
    registry: memoryRegistry([SOCIO], removedAccounts),
    principal,
    dropDatabase,
    start: async (ws) => {
      const runtime = fakeRuntime(ws.id);
      runtimes.set(ws.id, runtime);
      return runtime;
    },
    provision: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    subscribe,
    principalAccountId: async () => 'cuenta-de-jose',
  });
  await manager.boot();
  const router = createRouter({ users, manager, linkSecret: 'secreto' });
  const get = (path: string, cookie = '') => router.request(`https://app.test${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
  return { manager, router, get, principal, runtimes, subscribe, dropDatabase };
}

describe('reparto por espacio', () => {
  it('la API va al espacio de quien ha iniciado sesión; sin sesión, al principal (login, alta…)', async () => {
    const { get } = await setup();
    expect(await (await get('/api/flows', 'tok-socio')).text()).toBe(`espacio:${SOCIO.id}`);
    expect(await (await get('/api/flows', 'tok-jose')).text()).toBe('espacio:principal');
    expect(await (await get('/api/session')).text()).toBe('espacio:principal');
  });

  it('el resto (web, avisos, panel antiguo) lo atiende el principal', async () => {
    const { get } = await setup();
    expect(await (await get('/app/flujos', 'tok-socio')).text()).toBe('espacio:principal');
    expect(await (await get('/webhook')).text()).toBe('espacio:principal');
  });

  it('los clics de enlaces van al espacio que los envió (los antiguos, sin espacio, al principal)', async () => {
    const { get } = await setup();
    const link = (w?: string) => createLinkToken('secreto', { f: 'f', n: 'n', b: 0, r: '9', u: 'https://e.com', t: [], ...(w ? { w } : {}) });
    expect(await (await get(`/l/${link(SOCIO.id)}`)).text()).toBe(`espacio:${SOCIO.id}`);
    expect(await (await get(`/l/${link()}`)).text()).toBe('espacio:principal');
    expect(await (await get('/l/token-falso')).text()).toBe('espacio:principal');
  });

  it('los avisos de Meta se reparten por la cuenta de Instagram que los envía', async () => {
    const { manager, principal, runtimes } = await setup();
    manager.dispatchWebhook({ object: 'instagram', entry: [{ id: '1784140000000099', messaging: [] }, { id: 'cuenta-de-jose', changes: [] }, { id: '1784140000000099', changes: [] }] });
    expect(runtimes.get(SOCIO.id)?.processed).toEqual([{ object: 'instagram', entry: [{ id: '1784140000000099', messaging: [] }, { id: '1784140000000099', changes: [] }] }]);
    expect(principal.processed).toEqual([{ object: 'instagram', entry: [{ id: 'cuenta-de-jose', changes: [] }] }]);
    manager.dispatchWebhook('basura');
    expect(principal.processed.at(-1)).toBe('basura');
  });

  it('crear un espacio: crea su base, lo guarda y lo arranca', async () => {
    const { manager, runtimes } = await setup();
    const ws = await manager.create('Cliente Uno');
    expect(ws.id).toMatch(/^ws_cliente_uno_[0-9a-f]{4}$/);
    expect(runtimes.has(ws.id)).toBe(true);
    expect((await manager.list()).map((w) => w.name)).toEqual(['Socio', 'Cliente Uno']);
  });

  it('conectar Instagram en un espacio hace que sus avisos le lleguen a él', async () => {
    const { manager, runtimes } = await setup();
    const ws = await manager.create('Cliente Dos');
    await manager.setInstagram(ws.id, '1784149999999999', 'cliente_ig');
    manager.dispatchWebhook({ entry: [{ id: '1784149999999999' }] });
    expect(runtimes.get(ws.id)?.processed).toHaveLength(1);
  });

  it('conectar Instagram de verdad: guarda el token en su espacio, suscribe sus avisos, apunta la cuenta y reinicia el espacio', async () => {
    const { manager, runtimes, subscribe } = await setup();
    const before = runtimes.get(SOCIO.id);
    await manager.connectInstagram(SOCIO.id, { accessToken: 'tok-del-socio', expiresInDays: 60, userId: '1784140000000555', username: 'socio_nuevo' });
    expect(before?.saveToken).toHaveBeenCalledWith('tok-del-socio', 60 * 24 * 60 * 60);
    expect(subscribe).toHaveBeenCalledWith('tok-del-socio');
    expect(before?.close).toHaveBeenCalled();
    const after = runtimes.get(SOCIO.id);
    expect(after).not.toBe(before);
    manager.dispatchWebhook({ entry: [{ id: '1784140000000555' }] });
    expect(after?.processed).toHaveLength(1);
    expect((await manager.list()).find((w) => w.id === SOCIO.id)?.igUsername).toBe('socio_nuevo');
  });

  it('nunca deja conectar la cuenta de Jose en otro espacio (se llevaría sus avisos)', async () => {
    const { manager, subscribe, runtimes } = await setup();
    await expect(manager.connectInstagram(SOCIO.id, { accessToken: 't', expiresInDays: 60, userId: 'cuenta-de-jose', username: 'josenews.ai' })).rejects.toThrow('cuenta principal');
    expect(subscribe).not.toHaveBeenCalled();
    expect(runtimes.get(SOCIO.id)?.saveToken).not.toHaveBeenCalled();
  });

  it('Jose activa o vuelve a bloquear los envíos de un espacio (en su base) y queda en el registro del espacio', async () => {
    const { manager, runtimes } = await setup();
    const store = runtimes.get(SOCIO.id)?.store;
    await lockSends(store as NonNullable<typeof store>);
    expect(await manager.sendsLocked(SOCIO.id)).toBe(true);
    await manager.setSendsLock(SOCIO.id, false, 'Jose');
    expect(await manager.sendsLocked(SOCIO.id)).toBe(false);
    expect(await store?.getSetting(SETTINGS.sendsBlockedUntil)).toBeNull();
    expect((await store?.recentEvents(5))?.some((e) => e.kind === 'pausado' && e.note.includes('Jose'))).toBe(true);
    await manager.setSendsLock(SOCIO.id, true, 'Jose');
    expect(await manager.sendsLocked(SOCIO.id)).toBe(true);
    expect(await manager.sendsLocked('ws_no_existe_0000')).toBeNull();
    await expect(manager.setSendsLock('ws_no_existe_0000', false, 'Jose')).rejects.toThrow('no está en marcha');
  });

  it('el avance de un cliente (7.5f) sale de su base y de si tiene Instagram; null si no está en marcha', async () => {
    const { manager, runtimes } = await setup();
    await lockSends(runtimes.get(SOCIO.id)?.store as NonNullable<ReturnType<typeof runtimes.get>>['store']);
    // SOCIO tiene Instagram apuntado: 1 de 5.
    expect(await manager.progress(SOCIO.id)).toEqual({ done: 1, total: 5 });
    expect(await manager.progress('ws_no_existe_0000')).toBeNull();
  });

  it('borrar un espacio: lo para, borra su base, lo quita de la lista y sus avisos ya NO van al de Jose', async () => {
    const { manager, runtimes, principal, dropDatabase } = await setup();
    const runtime = runtimes.get(SOCIO.id);
    await manager.remove(SOCIO.id);
    expect(runtime?.close).toHaveBeenCalled();
    expect(dropDatabase).toHaveBeenCalledWith(SOCIO.id);
    expect(await manager.list()).toEqual([]);
    expect(manager.get(SOCIO.id)).toBeUndefined();
    manager.dispatchWebhook({ entry: [{ id: '1784140000000099', messaging: [] }, { id: 'cuenta-de-jose', changes: [] }] });
    expect(principal.processed).toEqual([{ entry: [{ id: 'cuenta-de-jose', changes: [] }] }]);
    expect(runtime?.processed).toEqual([]);
  });

  it('si no se puede borrar su base, el espacio sigue como estaba (vuelve a arrancar) y avisa del error', async () => {
    const { manager, runtimes, dropDatabase } = await setup();
    dropDatabase.mockRejectedValueOnce(new Error('Neon no responde'));
    await expect(manager.remove(SOCIO.id)).rejects.toThrow('Neon no responde');
    expect((await manager.list()).map((w) => w.id)).toEqual([SOCIO.id]);
    manager.dispatchWebhook({ entry: [{ id: '1784140000000099' }] });
    expect(runtimes.get(SOCIO.id)?.processed).toHaveLength(1);
  });

  it('tras reiniciar el servidor, los avisos de cuentas de espacios borrados se siguen descartando', async () => {
    const { manager, principal } = await setup(['1784140000000777']);
    manager.dispatchWebhook({ entry: [{ id: '1784140000000777' }] });
    expect(principal.processed).toEqual([]);
    await expect(manager.remove('ws_no_existe_0000')).rejects.toThrow('no existe');
  });
});
