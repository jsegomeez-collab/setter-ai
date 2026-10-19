import { describe, expect, it, vi } from 'vitest';
import { createMediaLoader } from '../src/media-catalog.js';
import type { InstagramClient, Media } from '../src/meta/client.js';

/** Títulos de reels (arreglo tras la 6.4): los últimos 50 en una llamada; los que falten, uno a uno por su id, y se recuerdan. */

const reel = (id: string, caption = `Reel ${id}`): Media => ({ id, caption, permalink: null, timestamp: '2026-10-01T10:00:00+0000', mediaProductType: 'REELS' });

function fakeClient(recent: Media[], byId: Record<string, Media | null | Error>) {
  return {
    listMedia: vi.fn().mockResolvedValue(recent),
    getMedia: vi.fn().mockImplementation(async (id: string) => {
      const value = byId[id];
      if (value instanceof Error) throw value;
      return value ?? null;
    }),
  };
}

describe('createMediaLoader', () => {
  it('sin ids → solo los últimos; con ids que no están → los pide por id y los añade', async () => {
    const client = fakeClient([reel('a')], { viejo: reel('viejo', 'Reel antiguo') });
    const load = createMediaLoader(client as unknown as InstagramClient, 50);
    expect((await load()).map((m) => m.id)).toEqual(['a']);
    expect((await load(['a', 'viejo', 'viejo'])).map((m) => m.id)).toEqual(['a', 'viejo']);
    expect(client.listMedia).toHaveBeenCalledWith(50);
    expect(client.getMedia).toHaveBeenCalledTimes(1);
  });

  it('recuerda lo encontrado y lo que no existe (no vuelve a preguntar); un error de Meta no se recuerda', async () => {
    const client = fakeClient([], { bueno: reel('bueno'), fallo: new Error('caído') });
    const load = createMediaLoader(client as unknown as InstagramClient, 50);
    expect((await load(['bueno', 'borrado', 'fallo'])).map((m) => m.id)).toEqual(['bueno']);
    await load(['bueno', 'borrado', 'fallo']);
    expect(client.getMedia.mock.calls.map(([id]) => id)).toEqual(['bueno', 'borrado', 'fallo', 'fallo']);
  });

  it('pregunta como mucho 40 reels por vez (el resto, en la siguiente carga)', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `r${i}`);
    const client = fakeClient([], Object.fromEntries(ids.map((id) => [id, reel(id)])));
    const load = createMediaLoader(client as unknown as InstagramClient, 50);
    expect(await load(ids)).toHaveLength(40);
    expect(await load(ids)).toHaveLength(45);
  });

  it('sin cliente o si Instagram no responde a la lista → vacío, sin romper la página', async () => {
    expect(await createMediaLoader(null, 50)(['x'])).toEqual([]);
    const client = fakeClient([], {});
    client.listMedia.mockRejectedValue(new Error('caído'));
    expect(await createMediaLoader(client as unknown as InstagramClient, 50)()).toEqual([]);
  });
});
