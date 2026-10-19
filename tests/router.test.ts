import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, hashToken } from '../src/auth.js';
import { createLinkToken } from '../src/links.js';
import { createRouter } from '../src/router.js';
import { WorkspaceManager } from '../src/workspace-manager.js';
import type { WorkspaceRuntime } from '../src/workspace-runtime.js';
import type { Workspace, WorkspaceRegistry } from '../src/workspaces.js';
import { createMemoryStore } from './helpers.js';
import { createMemoryUserStore } from './users-memory.js';

/** Fase 7.5a: cada petición, aviso de Meta y clic va a su espacio. Para Jose (principal) todo sigue igual. */

function fakeRuntime(id: string | null): WorkspaceRuntime & { processed: unknown[] } {
  const app = new Hono();
  app.all('*', (c) => c.text(`espacio:${id ?? 'principal'}`));
  const processed: unknown[] = [];
  return { id, store: createMemoryStore(), app, processed, process: (payload) => processed.push(payload), close: vi.fn().mockResolvedValue(undefined) };
}

function memoryRegistry(initial: Workspace[] = []): WorkspaceRegistry {
  let rows = [...initial];
  return {
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

async function setup() {
  const users = createMemoryUserStore();
  const jose = await users.createUser({ email: 'jose@x.com', name: 'Jose', role: 'admin', passwordHash: 'h' });
  const socio = await users.createUser({ email: 'socio@x.com', name: 'Socio', role: 'admin', passwordHash: 'h', workspaceId: SOCIO.id });
  await users.createSession(hashToken('tok-jose'), jose.id, new Date(Date.now() + 60_000));
  await users.createSession(hashToken('tok-socio'), socio.id, new Date(Date.now() + 60_000));
  const principal = fakeRuntime(null);
  const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
  const manager = new WorkspaceManager({
    registry: memoryRegistry([SOCIO]),
    principal,
    start: async (ws) => {
      const runtime = fakeRuntime(ws.id);
      runtimes.set(ws.id, runtime);
      return runtime;
    },
    provision: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
  });
  await manager.boot();
  const router = createRouter({ users, manager, linkSecret: 'secreto' });
  const get = (path: string, cookie = '') => router.request(`https://app.test${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
  return { manager, router, get, principal, runtimes };
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
});
