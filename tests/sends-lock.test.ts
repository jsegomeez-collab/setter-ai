import { describe, expect, it } from 'vitest';
import { ensureInitialLock, isSendsLocked, lockSends, unlockSends } from '../src/sends-lock.js';
import { SETTINGS } from '../src/store.js';
import { createMemoryStore } from './helpers.js';

/** Envíos de un espacio nuevo: nacen bloqueados y solo Jose los activa (decisión de Jose, 20-10). */

describe('cerrojo de envíos de un espacio', () => {
  it('un espacio que nunca tuvo cerrojo nace bloqueado, sin fecha de fin', async () => {
    const store = createMemoryStore();
    expect(await ensureInitialLock(store)).toBe(true);
    expect(await isSendsLocked(store)).toBe(true);
    const until = await store.getSetting(SETTINGS.sendsBlockedUntil);
    expect(Date.parse(until ?? '')).toBeGreaterThan(Date.now() + 50 * 365 * 24 * 60 * 60 * 1000);
    expect(await store.getSetting(SETTINGS.sendsBlockedReason)).toMatch(/Jose/);
  });

  it('si Jose ya los activó, al reiniciar NO se vuelve a bloquear', async () => {
    const store = createMemoryStore();
    await ensureInitialLock(store);
    await unlockSends(store);
    expect(await ensureInitialLock(store)).toBe(false);
    expect(await isSendsLocked(store)).toBe(false);
    expect(await store.getSetting(SETTINGS.sendsBlockedUntil)).toBeNull();
  });

  it('Jose puede volver a bloquearlos', async () => {
    const store = createMemoryStore();
    await unlockSends(store);
    await lockSends(store);
    expect(await isSendsLocked(store)).toBe(true);
    expect(await store.getSetting(SETTINGS.sendsBlockedUntil)).not.toBeNull();
  });
});
