/**
 * Documentos del setter (Fase 7.2). Petición de Jose (2026-10-19): en vez de un texto fusionado ("un cristo"), un
 * documento por tema, porque así la IA lo interpreta mejor. Decisión: lista base + poder crear más.
 * Cada documento guarda sus versiones en `knowledge_versions` con el tipo `doc:<slug>`.
 */

export interface BaseDoc {
  readonly slug: string;
  readonly title: string;
  /** Qué poner (se enseña en la web al editarlo). */
  readonly hint: string;
}

export const BASE_DOCS: readonly BaseDoc[] = [
  { slug: 'cliente-ideal', title: 'Cliente ideal', hint: 'Quién es tu cliente: a qué se dedica, de dónde es, qué le duele, qué quiere conseguir, señales de que encaja (y de que no).' },
  { slug: 'oferta', title: 'Oferta y precios', hint: 'Qué vendes, qué incluye, precios, formas de pago, garantías y para quién es cada opción.' },
  { slug: 'faqs', title: 'Preguntas frecuentes', hint: 'Las preguntas que más te hacen, con la respuesta tal cual la darías tú.' },
  { slug: 'objeciones', title: 'Objeciones y respuestas', hint: 'Lo que frena a la gente ("es caro", "no tengo tiempo", "¿es una estafa?") y cómo responder a cada cosa.' },
  { slug: 'tono', title: 'Tono y estilo', hint: 'Cómo escribe la IA: cercana o formal, tuteo, emojis, largo de los mensajes, expresiones tuyas.' },
  { slug: 'casos', title: 'Casos de éxito', hint: 'Resultados reales de alumnos o clientes que la IA puede contar (con lo que se puede y no se puede decir).' },
  { slug: 'prohibido', title: 'Lo que nunca debe decir', hint: 'Promesas de ingresos, temas prohibidos, datos que no se dan… Reglas que la IA no puede saltarse.' },
];

export interface DocForPrompt {
  readonly title: string;
  readonly text: string;
  readonly active: boolean;
  readonly position: number;
}

export const docKind = (slug: string): `doc:${string}` => `doc:${slug}`;

/** "Guion de llamada ¿Qué decir?" → "guion-de-llamada-que-decir" (vacío si no queda nada). */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Lo que recibe la IA: un bloque por documento activo con texto, con su título, en su orden. */
export function assembleKnowledge(docs: readonly DocForPrompt[]): string {
  const sections = [...docs]
    .filter((doc) => doc.active && doc.text.trim() !== '')
    .sort((a, b) => a.position - b.position)
    .map((doc) => `## ${doc.title}\n${doc.text.trim()}`);
  return sections.length > 0 ? `# CONOCIMIENTO DEL NEGOCIO (por temas)\n\n${sections.join('\n\n')}` : '';
}
