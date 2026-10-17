import type { InstagramClient } from './meta/client.js';
import type { InstagramEvent } from './meta/parse.js';
import type { Store } from './store.js';

/**
 * Comentarios perdidos (Fase 4, paso 4.5). El 2026-10-17 se vieron ~30-45 s de 502 durante un despliegue: si Meta
 * avisa de un comentario en ese rato, puede que no nos llegue (sus reintentos son "inmediatos", doc de Webhooks).
 * Al rato de arrancar se piden a Instagram los comentarios recientes de los últimos reels y los que no tenemos
 * guardados pasan por el mismo camino que un aviso de Meta (flujo, una vez por persona y reel, anti-ban).
 * Repetir es seguro: el DM de cada comentario tiene una clave única y nunca sale dos veces.
 */

/** Reels que se miran (los comentarios de reels más antiguos casi siempre llegan bien por aviso). */
const MEDIA_TO_CHECK = 25;

type CommentEvent = Extract<InstagramEvent, { kind: 'comment' }>;

export interface CatchUpDeps {
  readonly store: Pick<Store, 'existingCommentIds'>;
  readonly client: Pick<InstagramClient, 'getAccount' | 'listMedia' | 'listComments'>;
  /** El mismo procesamiento que un aviso de Meta (process.ts → processEvent). */
  readonly processEvent: (event: CommentEvent) => Promise<void>;
}

export interface CatchUpResult {
  readonly media: number;
  readonly recovered: number;
  readonly failedMedia: number;
}

function isRecent(timestamp: string | null, since: Date): boolean {
  const time = timestamp ? Date.parse(timestamp) : Number.NaN;
  return !Number.isNaN(time) && time >= since.getTime();
}

export async function catchUpComments(deps: CatchUpDeps, since: Date): Promise<CatchUpResult> {
  const { store, client, processEvent } = deps;
  const account = await client.getAccount();
  const media = await client.listMedia(MEDIA_TO_CHECK);
  let recovered = 0;
  let failedMedia = 0;
  for (const item of media) {
    try {
      const recent = (await client.listComments(item.id)).filter(
        (c) => isRecent(c.timestamp, since) && c.fromId !== null && c.fromId !== account.userId && c.parentId === null,
      );
      const known = await store.existingCommentIds(recent.map((c) => c.id));
      for (const c of recent.filter((candidate) => !known.has(candidate.id))) {
        await processEvent({
          kind: 'comment',
          accountId: account.userId,
          commentId: c.id,
          text: c.text,
          fromId: c.fromId as string,
          fromUsername: c.fromUsername,
          mediaId: item.id,
          parentId: null,
        });
        recovered += 1;
      }
    } catch {
      // Un reel que falla no impide revisar los demás (se cuenta y se deja constancia en el resumen).
      failedMedia += 1;
    }
  }
  return { media: media.length, recovered, failedMedia };
}
