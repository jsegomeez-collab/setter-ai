import { describe, expect, it, vi } from 'vitest';
import { catchUpComments } from '../src/catch-up.js';
import type { MediaComment } from '../src/meta/client.js';
import { createMemoryStore } from './helpers.js';

/**
 * Comentarios perdidos al desplegar (Fase 4, paso 4.5): el 2026-10-17 se vieron ~30-45 s de 502 en un despliegue.
 * Al rato de arrancar se piden a Instagram los comentarios recientes y se atienden los que no nos llegaron.
 */

const ACCOUNT = '17841438323050307';
const SINCE = new Date('2026-10-17T00:45:00Z');
const comment = (id: string, timestamp: string, fromId = '9', parentId: string | null = null): MediaComment => ({
  id,
  text: 'Bolsa',
  timestamp,
  fromId,
  fromUsername: `u${fromId}`,
  parentId,
});

function setup(byMedia: Record<string, MediaComment[] | Error>) {
  const store = createMemoryStore();
  const client = {
    getAccount: vi.fn().mockResolvedValue({ userId: ACCOUNT, username: 'josenews.ai' }),
    listMedia: vi.fn().mockResolvedValue(Object.keys(byMedia).map((id) => ({ id, caption: null, permalink: null, timestamp: null, mediaProductType: 'REELS' }))),
    listComments: vi.fn(async (mediaId: string) => {
      const value = byMedia[mediaId];
      if (value instanceof Error) throw value;
      return value ?? [];
    }),
  };
  const processEvent = vi.fn().mockResolvedValue(undefined);
  return { store, client, processEvent };
}

describe('catchUpComments', () => {
  it('atiende solo los comentarios recientes que no nos llegaron (no los viejos, ni respuestas, ni los de tu cuenta)', async () => {
    const { store, client, processEvent } = setup({
      m1: [
        comment('nuevo', '2026-10-17T00:50:00+0000'),
        comment('ya-llego', '2026-10-17T00:49:00+0000'),
        comment('respuesta', '2026-10-17T00:48:00+0000', '9', 'otro'),
        comment('mio', '2026-10-17T00:47:00+0000', ACCOUNT),
        comment('viejo', '2026-10-17T00:30:00+0000'),
      ],
      m2: [comment('nuevo-2', '2026-10-17T00:46:00+0000', '7')],
    });
    await store.recordComment({ commentId: 'ya-llego', igId: '9', username: 'u9', mediaId: 'm1', text: 'Bolsa' });

    const result = await catchUpComments({ store, client, processEvent }, SINCE);

    expect(processEvent.mock.calls.map(([event]) => event.commentId)).toEqual(['nuevo', 'nuevo-2']);
    expect(processEvent).toHaveBeenCalledWith({
      kind: 'comment',
      accountId: ACCOUNT,
      commentId: 'nuevo',
      text: 'Bolsa',
      fromId: '9',
      fromUsername: 'u9',
      mediaId: 'm1',
      parentId: null,
    });
    expect(result).toEqual({ media: 2, recovered: 2, failedMedia: 0 });
  });

  it('se salta los comentarios de quien pidió BORRAR anteriores al borrado; los posteriores sí (actividad nueva)', async () => {
    const { store, client, processEvent } = setup({
      m1: [comment('antes', '2026-10-17T00:50:00+0000', '9'), comment('despues', '2026-10-17T01:10:00+0000', '9')],
    });
    store.deletedAt = vi.fn(async (igId: string) => (igId === '9' ? new Date('2026-10-17T01:00:00Z') : null));
    await catchUpComments({ store, client, processEvent }, SINCE);
    expect(processEvent.mock.calls.map(([event]) => event.commentId)).toEqual(['despues']);
  });

  it('si falla un reel, sigue con los demás', async () => {
    const { store, client, processEvent } = setup({ m1: new Error('Meta caída'), m2: [comment('nuevo', '2026-10-17T00:50:00+0000')] });
    const result = await catchUpComments({ store, client, processEvent }, SINCE);
    expect(result).toEqual({ media: 2, recovered: 1, failedMedia: 1 });
  });

  it('pide los 25 reels más recientes', async () => {
    const { store, client, processEvent } = setup({});
    await catchUpComments({ store, client, processEvent }, SINCE);
    expect(client.listMedia).toHaveBeenCalledWith(25);
  });
});
