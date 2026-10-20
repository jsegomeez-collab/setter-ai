import { isSendsLocked } from './sends-lock.js';
import { loadKnowledge } from './setter/knowledge-source.js';
import { linksComplete, readSetterLinks } from './setter/links.js';
import { readSetterMode } from './setter/service.js';
import type { Store } from './store.js';

/**
 * Primeros pasos de un cliente nuevo (Fase 7.5f): lo que le falta para que su setter funcione, en el orden en que
 * se hace. Cada paso se marca solo cuando de verdad está hecho (se mira en su base, no se apunta a mano). El último
 * ("envíos activados") lo hace Jose.
 */

export type OnboardingStepId = 'instagram' | 'links' | 'document' | 'setter' | 'sends';

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly done: boolean;
}

const NO_LINKS = { agenda: '', membership: '', contactEmail: '' };

export async function onboardingSteps(store: Store, hasInstagram: boolean): Promise<OnboardingStep[]> {
  const [links, knowledge, mode, locked] = await Promise.all([readSetterLinks(store, NO_LINKS), loadKnowledge(store), readSetterMode(store), isSendsLocked(store)]);
  return [
    { id: 'instagram', done: hasInstagram },
    { id: 'links', done: links.source === 'saved' && linksComplete(links.links) },
    { id: 'document', done: knowledge !== null },
    { id: 'setter', done: mode !== 'off' },
    { id: 'sends', done: !locked },
  ];
}

export function onboardingProgress(steps: readonly OnboardingStep[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.done).length, total: steps.length };
}
