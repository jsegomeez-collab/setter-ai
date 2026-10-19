import { describe, expect, it } from 'vitest';
import { BASE_DOCS, assembleKnowledge, docKind, slugify } from '../src/setter/knowledge-docs.js';

/**
 * Documentos del setter (Fase 7.2). Petición de Jose: en vez de un texto fusionado, un documento por tema
 * (cliente ideal, oferta…). La IA los recibe por secciones con su título.
 */

describe('documentos del setter', () => {
  it('la lista base son los 7 temas acordados, en este orden', () => {
    expect(BASE_DOCS.map((d) => d.title)).toEqual([
      'Cliente ideal',
      'Oferta y precios',
      'Preguntas frecuentes',
      'Objeciones y respuestas',
      'Tono y estilo',
      'Casos de éxito',
      'Lo que nunca debe decir',
    ]);
    expect(new Set(BASE_DOCS.map((d) => d.slug)).size).toBe(7);
  });

  it('se juntan por secciones con su título, en su orden, solo los activos y con texto', () => {
    const text = assembleKnowledge([
      { title: 'Oferta y precios', text: 'Código Maestría: 997 $', active: true, position: 2 },
      { title: 'Cliente ideal', text: '  Dueño de negocio en LATAM  ', active: true, position: 1 },
      { title: 'Casos de éxito', text: '', active: true, position: 3 },
      { title: 'Lo que nunca debe decir', text: 'Prometer ingresos', active: false, position: 4 },
    ]);
    expect(text).toBe('# CONOCIMIENTO DEL NEGOCIO (por temas)\n\n## Cliente ideal\nDueño de negocio en LATAM\n\n## Oferta y precios\nCódigo Maestría: 997 $');
    expect(assembleKnowledge([])).toBe('');
  });

  it('cada documento guarda sus versiones con su propio tipo; los títulos propios dan un identificador limpio', () => {
    expect(docKind('cliente-ideal')).toBe('doc:cliente-ideal');
    expect(slugify('  Guion de llamada ¿Qué decir? ')).toBe('guion-de-llamada-que-decir');
    expect(slugify('¡¡!!')).toBe('');
  });
});
