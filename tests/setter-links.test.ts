import { describe, expect, it } from 'vitest';
import { linksComplete, readSetterLinks, saveSetterLinks } from '../src/setter/links.js';
import { TEST_SETTER_LINKS, createMemoryStore } from './helpers.js';

/** Fase 7.5c: enlaces del setter por espacio (agenda, membresía, correo). */

const NONE = { agenda: '', membership: '', contactEmail: '' };

describe('enlaces del setter por espacio', () => {
  it('sin nada guardado: los de reserva (Jose: los de Render; un espacio nuevo: ninguno)', async () => {
    const store = createMemoryStore();
    expect(await readSetterLinks(store, TEST_SETTER_LINKS)).toEqual({ links: TEST_SETTER_LINKS, source: 'default' });
    expect(await readSetterLinks(store, NONE)).toEqual({ links: NONE, source: 'default' });
  });

  it('guardados: mandan sobre los de reserva', async () => {
    const store = createMemoryStore();
    const mine = { agenda: 'https://cal.com/pedro', membership: 'https://pedro.com/membresia', contactEmail: 'pedro@x.com' };
    await saveSetterLinks(store, mine);
    expect(await readSetterLinks(store, TEST_SETTER_LINKS)).toEqual({ links: mine, source: 'saved' });
  });

  it('solo se guardan enlaces web y un correo válidos', async () => {
    const store = createMemoryStore();
    await expect(saveSetterLinks(store, { agenda: 'javascript:alert(1)', membership: 'https://a.com', contactEmail: 'a@b.com' })).rejects.toThrow();
    await expect(saveSetterLinks(store, { agenda: 'https://a.com', membership: 'https://a.com', contactEmail: 'no-es-correo' })).rejects.toThrow();
  });

  it('completos = los tres puestos (sin ellos el setter no responde)', () => {
    expect(linksComplete(TEST_SETTER_LINKS)).toBe(true);
    expect(linksComplete({ ...TEST_SETTER_LINKS, membership: '' })).toBe(false);
  });
});
