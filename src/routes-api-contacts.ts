import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { contactsCsv, filterContacts, reelLabel, toContactItem, type ContactFilters } from './contacts.js';
import type { MediaLoader } from './media-catalog.js';
import type { Media } from './meta/client.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import type { Store } from './store.js';
import type { UserStore } from './users.js';

/** API de Contactos del frontend (Fase 6.3). Ver y etiquetar: admin y equipo. Exportar y borrar: solo admin. */

export interface ContactsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  /** Reels de la cuenta (los últimos + los de estos ids) para el título de cada uno. Vacío si Instagram no responde. */
  readonly media: MediaLoader;
}

const CONTACTS_LIMIT = 5000;
const LIST_SHOWN = 300;
const COMMENTS_SHOWN = 100;
const LEAD_HISTORY = 50;

const tagName = z.string().trim().min(1).max(40).regex(/^[^,]+$/);
const fieldSchema = z.object({ field: z.string().trim().min(1).max(40), value: z.string().trim().max(200) });
const tagsSchema = z.object({ add: tagName.optional(), remove: z.string().max(40).optional() }).refine((v) => v.add !== undefined || v.remove !== undefined);
const deleteSchema = z.object({ confirm: z.literal('BORRAR') });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function filtersOf(c: Context): ContactFilters {
  return { q: c.req.query('q'), tag: c.req.query('tag') || undefined, media: c.req.query('media') || undefined, stage: c.req.query('stage') || undefined };
}

export function createContactsApi(deps: ContactsApiDeps): Hono<ApiEnv> {
  const { store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));

  const titles = async (ids: readonly (string | null | undefined)[]): Promise<{ label: (id: string) => string; media: Media[] }> => {
    const media = await deps.media(ids.filter((id): id is string => Boolean(id)));
    const byId = new Map(media.map((m) => [m.id, m]));
    return { media, label: (id: string) => reelLabel(byId.get(id), id) };
  };

  api.get('/', async (c) => {
    const all = (await store.listContacts(CONTACTS_LIMIT)).map(toContactItem);
    const sources = new Set(all.map((item) => item.sourceMediaId).filter((id): id is string => id !== null));
    const { media, label } = await titles([...sources]);
    const items = filterContacts(all, filtersOf(c));
    const counts = all.flatMap((item) => item.tags).reduce((map, tag) => map.set(tag, (map.get(tag) ?? 0) + 1), new Map<string, number>());
    return c.json({
      items: items.slice(0, LIST_SHOWN).map((item) => ({ ...item, sourceLabel: item.sourceMediaId ? label(item.sourceMediaId) : null })),
      total: items.length,
      tags: [...counts.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
      reels: media.filter((m) => sources.has(m.id)).map((m) => ({ mediaId: m.id, label: reelLabel(m) })),
    });
  });

  api.get('/export.csv', requireAdmin, async (c) => {
    const items = filterContacts((await store.listContacts(CONTACTS_LIMIT)).map(toContactItem), filtersOf(c));
    const { label } = await titles(items.map((item) => item.sourceMediaId));
    await store.logEvent('contactos', `${c.get('user').name} exportó ${items.length} contacto(s) a CSV.`, null);
    const day = new Date().toISOString().slice(0, 10);
    return c.body(contactsCsv(items, label), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contactos-${day}.csv"`,
      'cache-control': 'no-store',
    });
  });

  api.get('/reels', async (c) => {
    const stats = await store.reelStats();
    const media = await deps.media(stats.map((s) => s.mediaId));
    const byId = new Map(media.map((m) => [m.id, m]));
    return c.json({
      reels: stats.map((s) => ({ ...s, label: reelLabel(byId.get(s.mediaId), s.mediaId), permalink: byId.get(s.mediaId)?.permalink ?? null })),
    });
  });

  api.get('/:igId', async (c) => {
    const igId = c.req.param('igId');
    const [contact, comments, leadHistory, messages] = await Promise.all([
      store.getContact(igId),
      store.listPersonComments(igId, COMMENTS_SHOWN),
      store.listLeadHistory(igId, LEAD_HISTORY),
      store.listMessages(igId, 1),
    ]);
    if (!contact) return c.json({ error: 'Ese contacto no existe' }, 404);
    const item = toContactItem(contact);
    const { label } = await titles([item.sourceMediaId, item.lastMediaId, ...comments.map((comment) => comment.mediaId)]);
    return c.json({
      contact: { ...item, lead: contact.lead ?? null, sourceLabel: item.sourceMediaId ? label(item.sourceMediaId) : null, lastLabel: item.lastMediaId ? label(item.lastMediaId) : null },
      comments: comments.map((comment) => ({ ...comment, reelLabel: comment.mediaId ? label(comment.mediaId) : null })),
      leadHistory,
      hasConversation: messages.length > 0,
    });
  });

  api.post('/:igId/tags', async (c) => {
    const parsed = tagsSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Etiqueta no válida (1-40 caracteres, sin comas).' }, 400);
    const igId = c.req.param('igId');
    if (!(await store.getContact(igId))) return c.json({ error: 'Ese contacto no existe' }, 404);
    if (parsed.data.add) await store.addContactTags(igId, [parsed.data.add]);
    if (parsed.data.remove) await store.removeContactTag(igId, parsed.data.remove);
    await store.logEvent('contactos', `Etiquetas cambiadas a mano por ${c.get('user').name}.`, { igId, ...parsed.data });
    return c.json({ ok: true });
  });

  /** Campo propio a mano (Fase 7.4): mismo dato que guarda el paso "Guardar un dato". Valor vacío = borrarlo. */
  api.post('/:igId/fields', async (c) => {
    const parsed = fieldSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Dato no válido: nombre de 1-40 caracteres y valor de hasta 200.' }, 400);
    const igId = c.req.param('igId');
    if (!(await store.getContact(igId))) return c.json({ error: 'Ese contacto no existe' }, 404);
    const field = parsed.data.field.toLowerCase();
    await store.setContactField(igId, field, parsed.data.value);
    await store.logEvent('contactos', `Dato "${field}" cambiado a mano por ${c.get('user').name}.`, { igId, field, value: parsed.data.value });
    return c.json({ ok: true });
  });

  api.post('/:igId/delete', requireAdmin, async (c) => {
    if (!deleteSchema.safeParse(await readJson(c)).success) return c.json({ error: 'Para borrar, escribe BORRAR.' }, 400);
    const igId = c.req.param('igId');
    const deleted = await store.deletePersonData(igId);
    // Huella de 24 h: la recuperación de comentarios no vuelve a meter a esta persona (igual que con "BORRAR" por DM).
    await store.markDeleted(igId);
    // Sin el id: el registro de eventos no debe guardar datos de quien pidió borrarlos.
    await store.logEvent('borrado', `${c.get('user').name} borró los datos de una persona desde el panel.`, { deleted });
    return c.json({ ok: true, deleted });
  });

  return api;
}
