import { describe, expect, it } from 'vitest';
import { onboardingSteps, onboardingProgress } from '../src/onboarding.js';
import { unlockSends, lockSends } from '../src/sends-lock.js';
import { saveSetterLinks } from '../src/setter/links.js';
import { SETTINGS } from '../src/store.js';
import { createMemoryStore } from './helpers.js';

/** 7.5f: primeros pasos de un cliente nuevo (lo que le falta para que su setter funcione) y su avance para Jose. */

const LINKS = { agenda: 'https://cal.com/ana', membership: 'https://ana.com/membresia', contactEmail: 'ana@x.com' };

describe('primeros pasos de un cliente', () => {
  it('un cliente recién creado tiene los 5 pasos pendientes, en orden', async () => {
    const store = createMemoryStore();
    await lockSends(store);
    expect(await onboardingSteps(store, false)).toEqual([
      { id: 'instagram', done: false },
      { id: 'links', done: false },
      { id: 'document', done: false },
      { id: 'setter', done: false },
      { id: 'sends', done: false },
    ]);
    expect(onboardingProgress(await onboardingSteps(store, false))).toEqual({ done: 0, total: 5 });
  });

  it('cada paso se marca solo cuando de verdad está hecho', async () => {
    const store = createMemoryStore();
    await lockSends(store);
    await saveSetterLinks(store, LINKS);
    await store.saveKnowledge('Soy el setter de Ana.');
    store.settings.set(SETTINGS.setterMode, 'test');
    const steps = await onboardingSteps(store, true);
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['instagram', 'links', 'document', 'setter']);
    await unlockSends(store);
    expect(onboardingProgress(await onboardingSteps(store, true))).toEqual({ done: 5, total: 5 });
  });

  it('el setter apagado no cuenta como encendido', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.setterMode, 'off');
    expect((await onboardingSteps(store, false)).find((s) => s.id === 'setter')?.done).toBe(false);
  });
});
