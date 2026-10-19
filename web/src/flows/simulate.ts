import { outputsOf } from './graph';
import { stepSummary } from './steps-meta';
import type { Button, Card, Flow, MediaKind, QuickReply } from './types';

/**
 * Probar (Fase 6.5c, ampliado en la 7.3b): qué le llega a la persona desde un paso, siguiendo los pasos automáticos
 * igual que el motor (src/flows/engine.ts → planNode y steps.ts). Se para donde la persona tiene que hacer algo
 * (botón o respuesta rápida), en una condición (eliges tú la rama) o al saltar a otro flujo. No envía nada.
 */

export type SimItem =
  | { readonly kind: 'message'; readonly stepId: string; readonly text: string; readonly buttons: readonly Button[]; readonly quickReplies: readonly QuickReply[] }
  | { readonly kind: 'carousel'; readonly stepId: string; readonly cards: readonly Card[] }
  | { readonly kind: 'media'; readonly stepId: string; readonly mediaKind: MediaKind; readonly url: string }
  | { readonly kind: 'react'; readonly stepId: string; readonly emoji: string }
  /** Paso de "hacer" (etiqueta, dato, IA, aviso): no le llega nada a la persona; se cuenta lo que pasa. */
  | { readonly kind: 'action'; readonly stepId: string; readonly text: string }
  | { readonly kind: 'wait'; readonly stepId: string; readonly seconds: number }
  | { readonly kind: 'gate'; readonly stepId: string }
  | { readonly kind: 'condition'; readonly stepId: string; readonly text: string }
  | { readonly kind: 'goto'; readonly stepId: string; readonly flowId: string }
  | { readonly kind: 'setter'; readonly stepId: string; readonly text: string }
  | { readonly kind: 'broken'; readonly text: string };

/** Lo que la persona puede pulsar (o tú elegir, en una condición) al final del camino. */
export interface Choice {
  readonly label: string;
  readonly target: string;
}

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
        items.push({ kind: 'message', stepId: step.id, text: step.text, buttons: step.buttons, quickReplies: step.quickReplies ?? [] });
        break;
      case 'carousel':
        items.push({ kind: 'carousel', stepId: step.id, cards: step.cards });
        break;
      case 'media':
        items.push({ kind: 'media', stepId: step.id, mediaKind: step.kind, url: step.url });
        break;
      case 'react':
        items.push({ kind: 'react', stepId: step.id, emoji: step.emoji });
        break;
      case 'tag':
      case 'field':
      case 'ai':
      case 'notify':
        items.push({ kind: 'action', stepId: step.id, text: stepSummary(step) });
        break;
      case 'delay':
        items.push({ kind: 'wait', stepId: step.id, seconds: step.seconds });
        break;
      case 'follow_gate':
        return [...items, { kind: 'gate', stepId: step.id }];
      case 'condition':
        return [...items, { kind: 'condition', stepId: step.id, text: stepSummary(step) }];
      case 'goto':
        return [...items, { kind: 'goto', stepId: step.id, flowId: step.flowId }];
      case 'setter_opener':
        return [...items, { kind: 'setter', stepId: step.id, text: step.texts[0] ?? '' }];
    }
    current = step.next;
    if (!current) return items;
  }
  return [...items, { kind: 'broken', text: 'Demasiados pasos seguidos sin que la persona haga nada (¿un bucle?).' }];
}

/** Qué se puede pulsar tras el último paso del camino: botones de acción, respuestas rápidas o las ramas de la condición. */
export function choicesAfter(flow: Flow, item: SimItem | undefined): Choice[] {
  if (!item || !('stepId' in item)) return [];
  const step = flow.nodes.find((s) => s.id === item.stepId);
  if (!step) return [];
  const taps = (handles: RegExp) =>
    outputsOf(step)
      .filter((output) => handles.test(output.handle))
      .map((output) => ({ label: output.label, target: output.target ?? '' }));
  if (item.kind === 'message' || item.kind === 'carousel') return taps(/^(btn|qr|card)-/);
  if (item.kind === 'gate' || item.kind === 'condition') return taps(/^(yes|no|unknown|true|false)$/);
  return [];
}
