import { SETTINGS, type Store } from '../store.js';
import { assembleKnowledge, docKind } from './knowledge-docs.js';

/**
 * Qué conocimiento del negocio recibe la IA (Fase 7.2). Lo usan el setter real y los dos simuladores, para que los
 * tres vean siempre lo mismo. Por defecto, el documento único de siempre: los documentos por tema solo entran cuando
 * Jose elige "Usar documentos separados" (SETTINGS.knowledgeMode = 'docs').
 */

export interface LoadedKnowledge {
  readonly text: string;
  readonly source: 'single' | 'docs';
}

type KnowledgeStore = Pick<Store, 'getSetting' | 'getKnowledge' | 'listKnowledgeDocs'>;

export async function loadKnowledge(store: KnowledgeStore): Promise<LoadedKnowledge | null> {
  if ((await store.getSetting(SETTINGS.knowledgeMode)) === 'docs') {
    const docs = await store.listKnowledgeDocs();
    const texts = await Promise.all(docs.map((doc) => store.getKnowledge(docKind(doc.slug))));
    const text = assembleKnowledge(docs.map((doc, i) => ({ title: doc.title, text: texts[i]?.text ?? '', active: doc.active, position: doc.position })));
    return text ? { text, source: 'docs' } : null;
  }
  const single = await store.getKnowledge();
  return single ? { text: single.text, source: 'single' } : null;
}
