import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { chatEntrySchema, EMPTY_CHAT_ENTRY, readLiveProfile, referencedFlows, toMessengerProfile, type ChatEntry } from './chat-entry.js';
import { MetaApiError, type InstagramClient } from './meta/client.js';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { SETTINGS, type Store } from './store.js';
import type { UserStore } from './users.js';

/**
 * API de rompehielos y menú fijo (Fase 7.3c). Solo admin. Guardar el borrador no toca Instagram; publicar sí
 * (lo ve todo el que abra el chat) y por eso pide escribir PUBLICAR y que todos los flujos usados estén activos.
 */

export interface ChatEntryApiDeps {
  readonly store: Store;
  readonly users: UserStore;
  readonly client: InstagramClient | null;
}

const publishSchema = z.object({ confirm: z.literal('PUBLICAR') });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): ChatEntry {
  if (!raw) return EMPTY_CHAT_ENTRY;
  try {
    const parsed = chatEntrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CHAT_ENTRY;
  } catch {
    return EMPTY_CHAT_ENTRY;
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createChatEntryApi(deps: ChatEntryApiDeps): Hono<ApiEnv> {
  const { store, client } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users));
  api.use('*', requireAdmin);

  const readDraft = async () => parseStored(await store.getSetting(SETTINGS.chatEntry));

  api.get('/', async (c) => {
    const [draft, published] = await Promise.all([readDraft(), store.getSetting(SETTINGS.chatEntryPublished)]);
    let live: ReturnType<typeof readLiveProfile> | null = null;
    let liveError: string | null = client ? null : 'Falta el token de Instagram';
    if (client) {
      try {
        live = readLiveProfile(await client.getMessengerProfile(['ice_breakers', 'persistent_menu']));
      } catch (error) {
        liveError = errorText(error);
      }
    }
    return c.json({ draft, published: published ? (JSON.parse(published) as unknown) : null, live, liveError });
  });

  api.post('/', async (c) => {
    const parsed = chatEntrySchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `No se puede guardar: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` }, 400);
    const flows = await store.listFlows();
    const missing = referencedFlows(parsed.data).filter((id) => !flows.some((flow) => flow.id === id));
    if (missing.length > 0) return c.json({ error: `Estos flujos no existen: ${missing.join(', ')}` }, 400);
    await store.setSetting(SETTINGS.chatEntry, JSON.stringify(parsed.data));
    return c.json({ draft: parsed.data });
  });

  api.post('/publish', async (c) => {
    if (!publishSchema.safeParse(await readJson(c)).success) return c.json({ error: 'Para publicar en Instagram, escribe PUBLICAR.' }, 400);
    if (!client) return c.json({ error: 'Falta el token de Instagram.' }, 400);
    const draft = await readDraft();
    const flows = await store.listFlows();
    const off = referencedFlows(draft).flatMap((id) => {
      const flow = flows.find((candidate) => candidate.id === id);
      return flow?.enabled ? [] : [flow ? `"${flow.name}"` : id];
    });
    // Si un flujo está apagado, quien pulse esa opción no recibiría nada: mejor no publicarlo así.
    if (off.length > 0) return c.json({ error: `Activa antes estos flujos (si no, quien pulse esa opción no recibirá nada): ${off.join(', ')}` }, 400);
    const { profile, remove } = toMessengerProfile(draft);
    const who = c.get('user').name;
    try {
      if (profile) await client.setMessengerProfile(profile);
      if (remove.length > 0) await client.deleteMessengerProfile(remove);
    } catch (error) {
      await store.logEvent('chat', `${who} intentó publicar rompehielos y menú: Meta lo rechazó.`, { error: errorText(error), body: error instanceof MetaApiError ? error.body : null });
      return c.json({ error: `Meta no lo aceptó: ${errorText(error)}` }, 502);
    }
    const published = { at: new Date().toISOString(), by: who, entry: draft };
    await store.setSetting(SETTINGS.chatEntryPublished, JSON.stringify(published));
    await store.logEvent('chat', `${who} publicó en Instagram ${draft.iceBreakers.length} rompehielos y ${draft.menu.length} opción(es) de menú.`, { profile, remove });
    return c.json({ published });
  });

  return api;
}
