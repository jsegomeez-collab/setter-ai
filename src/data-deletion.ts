import { normalize, type Action } from './flows/engine.js';
import type { InstagramEvent } from './meta/parse.js';
import type { Store } from './store.js';

/**
 * "BORRAR" por DM: lo que promete /data-deletion. Decisiones de Jose (2026-10-17): se borra todo lo de esa persona,
 * también el texto en los registros técnicos, y se le confirma con un texto corto por DM.
 * Un minuto después se hace un segundo barrido: borra el rastro técnico de la propia confirmación (su eco de Meta).
 */

export const DELETE_CONFIRMATION = 'Listo, he borrado tus datos de nuestro sistema 🙏 Si vuelves a escribir o comentar, empezaremos de cero.';
/** Tiempo para que llegue y se procese el eco de la confirmación antes del segundo barrido. */
const PURGE_AGAIN_MS = 60_000;

/** Solo la palabra "BORRAR" (sin importar mayúsculas, tildes, signos ni emojis). "No quiero borrar nada" no cuenta. */
export function isDeleteRequest(text: string | null): boolean {
  if (!text) return false;
  return normalize(text).replace(/[^a-z]+/g, ' ').trim() === 'borrar';
}

type MessageEvent = Extract<InstagramEvent, { kind: 'message' }>;

export interface DeleteRequestDeps {
  readonly store: Store;
  readonly sender: { enqueue(actions: readonly Action[]): Promise<void> };
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

export async function handleDeleteRequest(event: MessageEvent, deps: DeleteRequestDeps): Promise<void> {
  const { store, sender } = deps;
  const igId = event.senderId;
  await store.deletePersonData(igId);
  // Sin su id: lo que queda es solo que hubo un borrado.
  await store.logEvent('borrado', 'Datos de una persona borrados a petición suya (BORRAR). Se le confirma por DM.', null);
  await sender.enqueue([
    {
      type: 'send_message',
      dedupKey: `borrar:${event.mid ?? igId}`,
      recipientId: igId,
      message: { text: DELETE_CONFIRMATION, buttons: [], flowId: 'borrado', nodeId: 'confirmacion', recipientId: igId },
    },
  ]);
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  setTimer(() => {
    store.deletePersonData(igId).catch((error: unknown) =>
      store
        .logEvent('error', 'Fallo en el segundo barrido del borrado.', { message: error instanceof Error ? error.message : String(error) })
        .catch(() => undefined),
    );
  }, PURGE_AGAIN_MS);
}
