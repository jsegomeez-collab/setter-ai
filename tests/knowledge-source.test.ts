import { describe, expect, it } from 'vitest';
import { loadKnowledge } from '../src/setter/knowledge-source.js';
import { SETTINGS } from '../src/store.js';
import { createMemoryStore } from './helpers.js';

/**
 * Qué conocimiento recibe la IA (Fase 7.2). Mientras Jose no elija "documentos separados", sigue el documento único
 * de siempre (nada cambia en producción hasta que él lo decida).
 */

describe('loadKnowledge', () => {
  it('por defecto: el documento único de siempre (o nada si no hay)', async () => {
    const store = createMemoryStore();
    expect(await loadKnowledge(store)).toBeNull();
    await store.saveKnowledge('DOCUMENTO ÚNICO');
    expect(await loadKnowledge(store)).toEqual({ text: 'DOCUMENTO ÚNICO', source: 'single' });
  });

  it('con "documentos separados": los activos con texto, por secciones y en su orden', async () => {
    const store = createMemoryStore();
    await store.saveKnowledge('DOCUMENTO ÚNICO');
    await store.saveKnowledgeDoc({ slug: 'oferta', title: 'Oferta y precios', position: 2, active: true, builtin: true });
    await store.saveKnowledgeDoc({ slug: 'cliente-ideal', title: 'Cliente ideal', position: 1, active: true, builtin: true });
    await store.saveKnowledgeDoc({ slug: 'casos', title: 'Casos de éxito', position: 3, active: false, builtin: true });
    await store.saveKnowledge('997 $', 'doc:oferta');
    await store.saveKnowledge('Dueños de negocio', 'doc:cliente-ideal');
    await store.saveKnowledge('Ana facturó…', 'doc:casos');
    await store.setSetting(SETTINGS.knowledgeMode, 'docs');
    expect(await loadKnowledge(store)).toEqual({
      text: '# CONOCIMIENTO DEL NEGOCIO (por temas)\n\n## Cliente ideal\nDueños de negocio\n\n## Oferta y precios\n997 $',
      source: 'docs',
    });
  });

  it('con "documentos separados" pero ninguno activo con texto: nada (la IA no responde a ciegas)', async () => {
    const store = createMemoryStore();
    await store.saveKnowledge('DOCUMENTO ÚNICO');
    await store.saveKnowledgeDoc({ slug: 'oferta', title: 'Oferta y precios', position: 1, active: true, builtin: true });
    await store.setSetting(SETTINGS.knowledgeMode, 'docs');
    expect(await loadKnowledge(store)).toBeNull();
  });
});
