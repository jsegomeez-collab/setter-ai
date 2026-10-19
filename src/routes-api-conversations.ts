import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { filterInbox, toInboxItem } from './inbox.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import type { DiscardResult, DraftResult, ManualResult } from './setter/service.js';
import { SETTINGS, type Store } from './store.js';
import type { UserStore } from './users.js';

/** API de Conversaciones del frontend (Fase 6.2). Admin y equipo; el bloqueo de envíos, solo admin. */

export interface ConversationsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly drafts?: { approve(igId: string): Promise<DraftResult>; discard(igId: string): Promise<DiscardResult> };
  readonly replyPending?: (igId: string) => Promise<void>;
  readonly sendManual?: (igId: string, text: string, author: string) => Promise<ManualResult>;
}

const LIST_LIMIT = 300;
const THREAD_MESSAGES = 300;
const LEAD_HISTORY = 50;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLY_CHARS = 1000;

const replySchema = z.object({ text: z.string().trim().min(1).max(MAX_REPLY_CHARS) });
const blockSchema = z.object({ until: z.iso.datetime().nullable(), reason: z.string().max(300).nullable() });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Bloqueo de envíos activo: el largo del admin o, si no, la pausa de 24 h tras un 368. null = se puede enviar. */
async function activeBlock(store: Store): Promise<{ until: string; reason: string | null } | null> {
  const now = Date.now();
  const [until, reason, pausedUntil, pauseReason] = await Promise.all([
    store.getSetting(SETTINGS.sendsBlockedUntil),
    store.getSetting(SETTINGS.sendsBlockedReason),
    store.getSetting(SETTINGS.pausedUntil),
    store.getSetting(SETTINGS.pauseReason),
  ]);
  if (until && new Date(until).getTime() > now) return { until, reason };
  if (pausedUntil && new Date(pausedUntil).getTime() > now) return { until: pausedUntil, reason: pauseReason };
  return null;
}

export function createConversationsApi(deps: ConversationsApiDeps): Hono<ApiEnv> {
  const { store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));

  api.get('/', async (c) => {
    const rows = await store.listConversations(LIST_LIMIT);
    const items = filterInbox(rows.map(toInboxItem), c.req.query('filter') ?? 'all', c.req.query('q') ?? '');
    return c.json({ items, sendsBlocked: await activeBlock(store) });
  });

  api.post('/sends-block', requireAdmin, async (c) => {
    const parsed = blockSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Fecha no válida' }, 400);
    const { until, reason } = parsed.data;
    await store.setSetting(SETTINGS.sendsBlockedUntil, until);
    await store.setSetting(SETTINGS.sendsBlockedReason, until ? reason : null);
    await store.logEvent('pausado', until ? `Envíos bloqueados a mano hasta ${until} por ${c.get('user').name}.` : `Bloqueo de envíos quitado por ${c.get('user').name}.`, { until, reason });
    return c.json({ ok: true });
  });

  api.get('/:igId', async (c) => {
    const igId = c.req.param('igId');
    const [contact, messages, leadHistory, block] = await Promise.all([
      store.getContact(igId),
      store.listMessages(igId, THREAD_MESSAGES),
      store.listLeadHistory(igId, LEAD_HISTORY),
      activeBlock(store),
    ]);
    if (!contact && messages.length === 0) return c.json({ error: 'Esa conversación no existe' }, 404);
    const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
    // Primero el bloqueo (es lo que más le interesa saber a quien mira la conversación).
    const canReply = block
      ? { ok: false, reason: `Envíos bloqueados hasta ${block.until}${block.reason ? ` (${block.reason})` : ''}.` }
      : !deps.sendManual
        ? { ok: false, reason: 'Responder a mano no está disponible.' }
        : !lastIn || Date.now() - lastIn.createdAt.getTime() > REPLY_WINDOW_MS
          ? { ok: false, reason: 'Han pasado más de 24 h desde su último mensaje: Instagram no deja escribirle.' }
          : { ok: true, reason: null };
    return c.json({
      igId,
      contact: {
        username: contact?.username ?? null,
        tags: contact?.tags ?? [],
        aiPaused: contact?.aiPaused ?? false,
        aiPausedReason: contact?.aiPausedReason ?? null,
        lead: contact?.lead ?? null,
        firstSeen: contact?.firstSeen ?? null,
      },
      messages: messages.map((m) => ({ id: m.id, direction: m.direction, source: m.source, text: m.text, status: m.status, note: m.note ?? null, createdAt: m.createdAt })),
      leadHistory,
      canReply,
    });
  });

  const setPaused = (paused: boolean) => async (c: Context<ApiEnv>) => {
    const igId = c.req.param('igId') ?? '';
    const who = c.get('user').name;
    await store.setAiPaused(igId, paused, paused ? `Parada a mano por ${who} desde el panel` : null);
    await store.logEvent('setter', `IA ${paused ? 'parada' : 'reanudada'} a mano por ${who}.`, { igId });
    // Al reanudar, si quedó un mensaje sin responder, la IA contesta ya (sin esperar; tarda unos segundos).
    if (!paused) void deps.replyPending?.(igId);
    return c.json({ ok: true });
  };
  api.post('/:igId/pause', setPaused(true));
  api.post('/:igId/resume', setPaused(false));

  const draft = (kind: 'approve' | 'discard') => async (c: Context<ApiEnv>) => {
    if (!deps.drafts) return c.json({ error: 'Los borradores no están disponibles.' }, 503);
    const igId = c.req.param('igId') ?? '';
    const result = kind === 'approve' ? await deps.drafts.approve(igId) : await deps.drafts.discard(igId);
    return result.ok ? c.json(result) : c.json({ error: result.reason }, 409);
  };
  api.post('/:igId/draft/approve', draft('approve'));
  api.post('/:igId/draft/discard', draft('discard'));

  api.post('/:igId/reply', async (c) => {
    const parsed = replySchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `Escribe un mensaje (máximo ${MAX_REPLY_CHARS} caracteres).` }, 400);
    const block = await activeBlock(store);
    if (block) return c.json({ error: `Envíos bloqueados hasta ${block.until}.` }, 423);
    if (!deps.sendManual) return c.json({ error: 'Responder a mano no está disponible.' }, 503);
    const result = await deps.sendManual(c.req.param('igId'), parsed.data.text, c.get('user').name);
    return result.ok ? c.json(result) : c.json({ error: result.reason }, 409);
  });

  return api;
}
