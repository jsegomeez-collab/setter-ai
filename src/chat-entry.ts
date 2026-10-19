import { z } from 'zod';
import { encodeStartPayload } from './flows/engine.js';
import type { MessengerProfile } from './meta/client.js';

/**
 * Rompehielos y menú fijo del chat (Fase 7.3c). Jose los edita como borrador en la web y los publica en Instagram
 * con un botón (escribiendo PUBLICAR). Cada opción empieza un flujo (botón "S:<flujo>", ver engine.ts) o abre una web.
 * Límites: 4 rompehielos (doc de Meta). Menú: Meta recomienda 5 como máximo; lo dejamos en 5. Meta no publica un
 * largo máximo para la pregunta ni el título en Instagram: ponemos 80 y 30 (los de Messenger), por prudencia.
 */

export const MAX_ICE_BREAKERS = 4;
export const MAX_MENU_ITEMS = 5;
const MAX_QUESTION = 80;
const MAX_MENU_TITLE = 30;
const LOCALE = 'default';

const flowId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const chatEntrySchema = z.object({
  iceBreakers: z.array(z.object({ question: z.string().trim().min(1).max(MAX_QUESTION), flowId })).max(MAX_ICE_BREAKERS),
  menu: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('flow'), title: z.string().trim().min(1).max(MAX_MENU_TITLE), flowId }),
        z.object({ type: z.literal('url'), title: z.string().trim().min(1).max(MAX_MENU_TITLE), url: z.url({ protocol: /^https?$/ }) }),
      ]),
    )
    .max(MAX_MENU_ITEMS),
});

export type ChatEntry = z.infer<typeof chatEntrySchema>;

export const EMPTY_CHAT_ENTRY: ChatEntry = { iceBreakers: [], menu: [] };

/** Flujos a los que apunta (para comprobar que existen y están activos). */
export function referencedFlows(entry: ChatEntry): string[] {
  return [...new Set([...entry.iceBreakers.map((item) => item.flowId), ...entry.menu.flatMap((item) => (item.type === 'flow' ? [item.flowId] : []))])];
}

/** Lo que se manda a Meta y qué listas hay que borrar (una lista vacía se borra en vez de publicarse vacía). */
export function toMessengerProfile(entry: ChatEntry): { profile: MessengerProfile | null; remove: ('ice_breakers' | 'persistent_menu')[] } {
  const iceBreakers = entry.iceBreakers.map((item) => ({ question: item.question, payload: encodeStartPayload(item.flowId) }));
  const menu = entry.menu.map((item) =>
    item.type === 'flow' ? { type: 'postback' as const, title: item.title, payload: encodeStartPayload(item.flowId) } : { type: 'web_url' as const, title: item.title, url: item.url },
  );
  const remove: ('ice_breakers' | 'persistent_menu')[] = [];
  if (iceBreakers.length === 0) remove.push('ice_breakers');
  if (menu.length === 0) remove.push('persistent_menu');
  if (remove.length === 2) return { profile: null, remove };
  return {
    profile: {
      platform: 'instagram',
      ...(iceBreakers.length > 0 ? { ice_breakers: [{ locale: LOCALE, call_to_actions: iceBreakers }] } : {}),
      ...(menu.length > 0 ? { persistent_menu: [{ locale: LOCALE, call_to_actions: menu }] } : {}),
    },
    remove,
  };
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** Las opciones de un campo (rompehielos o menú), venga como venga (la doc no da el formato exacto de la respuesta). */
function actionsOf(container: Json, field: string): Json[] {
  return list(container[field]).flatMap((item) => (Array.isArray(item.call_to_actions) ? list(item.call_to_actions) : [item]));
}

/** Lo que hay publicado ahora en Instagram (respuesta de GET /me/messenger_profile), leído a la defensiva. */
export function readLiveProfile(response: unknown): { iceBreakers: { question: string; payload: string }[]; menu: { title: string; target: string }[] } {
  const root = isObject(response) ? response : {};
  const containers = [root, ...list(root.data)];
  const iceBreakers = containers.flatMap((c) => actionsOf(c, 'ice_breakers')).map((a) => ({ question: String(a.question ?? ''), payload: String(a.payload ?? '') }));
  const menu = containers.flatMap((c) => actionsOf(c, 'persistent_menu')).map((a) => ({ title: String(a.title ?? ''), target: String(a.payload ?? a.url ?? '') }));
  return { iceBreakers, menu };
}
