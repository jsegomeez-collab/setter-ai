import { SETTINGS, type Store } from './store.js';

/**
 * Cerrojo de envíos de un espacio (decisión de Jose, 20-10): un espacio nuevo nace con los envíos bloqueados, sin
 * fecha de fin, y solo Jose los activa (desde Configuración → Espacios). Por dentro es el mismo bloqueo de siempre
 * (sends_blocked_until, que ya miran el emisor, el setter y las respuestas a mano) más una marca que impide que
 * quien lleva el espacio lo quite. La marca vale 'true' o 'false'; sin marca = nunca se puso (espacio recién creado).
 */

/** "Sin fecha de fin": muy lejos en el futuro. */
export const LOCKED_UNTIL = '2100-01-01T00:00:00.000Z';
export const LOCK_REASON = 'Espacio nuevo: los envíos los activa Jose.';

type SettingsStore = Pick<Store, 'getSetting' | 'setSetting'>;

export async function isSendsLocked(store: Pick<Store, 'getSetting'>): Promise<boolean> {
  return (await store.getSetting(SETTINGS.sendsLocked)) === 'true';
}

export async function lockSends(store: SettingsStore): Promise<void> {
  await store.setSetting(SETTINGS.sendsLocked, 'true');
  await store.setSetting(SETTINGS.sendsBlockedUntil, LOCKED_UNTIL);
  await store.setSetting(SETTINGS.sendsBlockedReason, LOCK_REASON);
}

export async function unlockSends(store: SettingsStore): Promise<void> {
  await store.setSetting(SETTINGS.sendsLocked, 'false');
  await store.setSetting(SETTINGS.sendsBlockedUntil, null);
  await store.setSetting(SETTINGS.sendsBlockedReason, null);
}

/** Al arrancar un espacio: si nunca tuvo cerrojo, se pone. true = lo acaba de poner. */
export async function ensureInitialLock(store: SettingsStore): Promise<boolean> {
  if ((await store.getSetting(SETTINGS.sendsLocked)) !== null) return false;
  await lockSends(store);
  return true;
}
