import type { InstagramClient, Media } from './meta/client.js';

/**
 * Títulos de los reels para la web (arreglo tras la 6.4): antes solo se pedían los últimos 50 y los reels más
 * antiguos salían con su número. Ahora los que falten se piden uno a uno por su id y se recuerdan en memoria
 * (el título de un reel no cambia). Lo que Meta dice que no existe se recuerda 1 h; un error de Meta no se recuerda.
 */

const LOOKUPS_PER_LOAD = 40;
const PARALLEL_LOOKUPS = 5;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;

export type MediaLoader = (ids?: readonly string[]) => Promise<Media[]>;

export function createMediaLoader(client: InstagramClient | null, recentLimit: number, now: () => number = Date.now): MediaLoader {
  const found = new Map<string, Media>();
  const notFoundAt = new Map<string, number>();

  const known = (id: string) => found.has(id) || now() - (notFoundAt.get(id) ?? -Infinity) < NOT_FOUND_TTL_MS;

  const lookUp = async (ids: readonly string[]) => {
    for (let i = 0; i < ids.length; i += PARALLEL_LOOKUPS) {
      await Promise.all(
        ids.slice(i, i + PARALLEL_LOOKUPS).map(async (id) => {
          try {
            const media = await client?.getMedia(id);
            if (media) found.set(id, media);
            else notFoundAt.set(id, now());
          } catch {
            // Fallo de Meta (token, caída): no se recuerda; se vuelve a intentar en la próxima carga.
          }
        }),
      );
    }
  };

  return async (ids = []) => {
    if (!client) return [];
    let recent: Media[];
    try {
      recent = await client.listMedia(recentLimit);
    } catch {
      return [];
    }
    const inRecent = new Set(recent.map((m) => m.id));
    const wanted = [...new Set(ids)].filter((id) => id && !inRecent.has(id));
    await lookUp(wanted.filter((id) => !known(id)).slice(0, LOOKUPS_PER_LOAD));
    return [...recent, ...wanted.flatMap((id) => found.get(id) ?? [])];
  };
}
