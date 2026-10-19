import type { Button, Flow } from './types';

/**
 * Probar un comentario (Fase 6.5c): qué le llega a la persona desde un paso, siguiendo los pasos automáticos
 * igual que el motor (src/flows/engine.ts → planNode): mensaje → su "después"; pausa → su siguiente.
 * Se para donde la persona tiene que hacer algo (botón) o en la condición "¿me sigue?". No envía nada.
 */

export type SimItem =
  | { readonly kind: 'message'; readonly stepId: string; readonly text: string; readonly buttons: readonly Button[] }
  | { readonly kind: 'wait'; readonly stepId: string; readonly seconds: number }
  | { readonly kind: 'gate'; readonly stepId: string }
  | { readonly kind: 'setter'; readonly stepId: string; readonly text: string }
  | { readonly kind: 'broken'; readonly text: string };

/** El mismo tope que el motor (MAX_DEPTH): corta flujos mal hechos. */
const MAX_DEPTH = 12;

export function walk(flow: Flow, stepId: string): SimItem[] {
  const items: SimItem[] = [];
  let current: string | undefined = stepId;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const step = flow.nodes.find((s) => s.id === current);
    if (!step) return [...items, { kind: 'broken', text: 'Este camino no lleva a ningún paso: conéctalo en el lienzo.' }];
    switch (step.type) {
      case 'message':
        items.push({ kind: 'message', stepId: step.id, text: step.text, buttons: step.buttons });
        if (!step.next) return items;
        current = step.next;
        break;
      case 'delay':
        items.push({ kind: 'wait', stepId: step.id, seconds: step.seconds });
        current = step.next;
        break;
      case 'follow_gate':
        return [...items, { kind: 'gate', stepId: step.id }];
      case 'setter_opener':
        return [...items, { kind: 'setter', stepId: step.id, text: step.texts[0] ?? '' }];
    }
  }
  return [...items, { kind: 'broken', text: 'Demasiados pasos seguidos sin que la persona haga nada (¿un bucle?).' }];
}
