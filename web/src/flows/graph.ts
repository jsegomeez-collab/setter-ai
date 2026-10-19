import { STEP_META } from './steps-meta';
import type { Flow, FlowStep, Position, StepType } from './types';

/**
 * Lienzo del constructor (Fase 6.5b, ampliado en la 7.3b): funciones puras para pasar un flujo a cajas y flechas
 * y editarlo. Nunca mutan: devuelven un flujo nuevo. Las reglas de Meta las comprueba también el servidor al guardar.
 */

export interface Output {
  /**
   * Id de la salida en la caja: btn-N (botón de acción), qr-N (respuesta rápida), card-C-N (botón de una tarjeta),
   * next (después), yes / no / unknown (¿me sigue?), true / false (condición).
   */
  readonly handle: string;
  readonly label: string;
  readonly target: string | undefined;
  /** El "después" de los pasos que lo tienen es opcional (termina ahí); el resto de salidas tienen que ir a algún paso. */
  readonly optional: boolean;
}

export interface CanvasNode {
  readonly id: string;
  readonly position: Position;
  readonly step: FlowStep;
  readonly isStart: boolean;
}

export interface CanvasEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly label: string;
}

const COLUMN_WIDTH = 310;
const ROW_HEIGHT = 210;
const orNone = (target: string) => (target === '' ? undefined : target);
const required = (handle: string, label: string, target: string): Output => ({ handle, label, target: orNone(target), optional: false });
const after = (target: string | undefined): Output => ({ handle: 'next', label: 'Después', target, optional: true });

/** Las salidas de un paso (a dónde puede ir después). Los botones de enlace no tienen salida: abren una web. */
export function outputsOf(step: FlowStep): Output[] {
  switch (step.type) {
    case 'message':
      return [
        ...step.buttons.flatMap((button, i) => (button.type === 'postback' ? [required(`btn-${i}`, button.title, button.next)] : [])),
        ...(step.quickReplies ?? []).map((reply, i) => required(`qr-${i}`, reply.title, reply.next)),
        after(step.next),
      ];
    case 'carousel':
      return [
        ...step.cards.flatMap((card, c) => card.buttons.flatMap((button, i) => (button.type === 'postback' ? [required(`card-${c}-${i}`, button.title, button.next)] : []))),
        after(step.next),
      ];
    case 'media':
    case 'react':
    case 'tag':
    case 'field':
    case 'ai':
    case 'notify':
      return [after(step.next)];
    case 'follow_gate':
      return [required('yes', 'Sí sigue', step.ifFollowing), required('no', 'No sigue', step.ifNotFollowing), required('unknown', 'No se sabe', step.ifUnknown)];
    case 'condition':
      return [required('true', 'Sí', step.ifTrue), required('false', 'No', step.ifFalse)];
    case 'delay':
      return [required('next', 'Después', step.next)];
    case 'setter_opener':
    case 'goto':
      return [];
  }
}

/** Posiciones por columnas: el inicio a la izquierda y cada paso una columna más allá del que lleva a él. */
export function autoLayout(flow: Flow): Record<string, Position> {
  const byId = new Map(flow.nodes.map((step) => [step.id, step]));
  const depth = new Map<string, number>([[flow.startNodeId, 0]]);
  const queue = [flow.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const step = byId.get(id);
    if (!step) continue;
    for (const { target } of outputsOf(step)) {
      if (target && byId.has(target) && !depth.has(target)) {
        depth.set(target, (depth.get(id) ?? 0) + 1);
        queue.push(target);
      }
    }
  }
  const lastColumn = Math.max(0, ...depth.values()) + 1;
  const rows = new Map<number, number>();
  const layout: Record<string, Position> = {};
  for (const step of flow.nodes) {
    const column = depth.get(step.id) ?? lastColumn;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    layout[step.id] = { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT };
  }
  return layout;
}

export function toCanvas(flow: Flow): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const auto = autoLayout(flow);
  const ids = new Set(flow.nodes.map((step) => step.id));
  return {
    nodes: flow.nodes.map((step) => ({ id: step.id, position: flow.layout?.[step.id] ?? auto[step.id] ?? { x: 0, y: 0 }, step, isStart: step.id === flow.startNodeId })),
    edges: flow.nodes.flatMap((step) =>
      outputsOf(step).flatMap(({ handle, label, target }) =>
        target && ids.has(target) ? [{ id: `${step.id}:${handle}`, source: step.id, sourceHandle: handle, target, label }] : [],
      ),
    ),
  };
}

/** Quita o pone el "después" (opcional) de un paso. */
function withNext<T extends { readonly next?: string }>(step: T, target: string | undefined): T {
  const { next: _old, ...rest } = step;
  return (target ? { ...rest, next: target } : rest) as T;
}

/** Cambia a dónde va una salida (undefined = sin conectar). */
function withOutput(step: FlowStep, handle: string, target: string | undefined): FlowStep {
  const to = target ?? '';
  switch (step.type) {
    case 'message': {
      if (handle === 'next') return withNext(step, target);
      const [kind, index] = handle.split('-');
      if (kind === 'qr') return { ...step, quickReplies: (step.quickReplies ?? []).map((reply, i) => (i === Number(index) ? { ...reply, next: to } : reply)) };
      return { ...step, buttons: step.buttons.map((button, i) => (i === Number(index) && button.type === 'postback' ? { ...button, next: to } : button)) };
    }
    case 'carousel': {
      if (handle === 'next') return withNext(step, target);
      const [, card, index] = handle.split('-').map(Number);
      return {
        ...step,
        cards: step.cards.map((item, c) =>
          c === card ? { ...item, buttons: item.buttons.map((button, i) => (i === index && button.type === 'postback' ? { ...button, next: to } : button)) } : item,
        ),
      };
    }
    case 'media':
    case 'react':
    case 'tag':
    case 'field':
    case 'ai':
    case 'notify':
      return withNext(step, target);
    case 'follow_gate': {
      const field = handle === 'yes' ? 'ifFollowing' : handle === 'no' ? 'ifNotFollowing' : 'ifUnknown';
      return { ...step, [field]: to };
    }
    case 'condition':
      return { ...step, [handle === 'true' ? 'ifTrue' : 'ifFalse']: to };
    case 'delay':
      return { ...step, next: to };
    case 'setter_opener':
    case 'goto':
      return step;
  }
}

const mapStep = (flow: Flow, id: string, change: (step: FlowStep) => FlowStep): Flow => ({
  ...flow,
  nodes: flow.nodes.map((step) => (step.id === id ? change(step) : step)),
});

export const connect = (flow: Flow, source: string, handle: string, target: string): Flow => mapStep(flow, source, (step) => withOutput(step, handle, target));
export const disconnect = (flow: Flow, source: string, handle: string): Flow => mapStep(flow, source, (step) => withOutput(step, handle, undefined));
export const updateStep = (flow: Flow, updated: FlowStep): Flow => mapStep(flow, updated.id, () => updated);

/** Posiciones completas (las guardadas y, para el resto, las automáticas): al mover o añadir no salta nada. */
const fullLayout = (flow: Flow): Record<string, Position> => ({ ...autoLayout(flow), ...(flow.layout ?? {}) });

export const moveStep = (flow: Flow, id: string, position: Position): Flow => ({ ...flow, layout: { ...fullLayout(flow), [id]: position } });

/** Tamaño aproximado de una caja del lienzo (con margen) y cuánto se baja cada vez buscando hueco. */
const BOX = { width: 260, height: 170 };
const SPOT_STEP = 40;
const MAX_SPOT_TRIES = 60;

/** Primer hueco libre desde `position` hacia abajo, para que un paso nuevo no caiga encima de otro. */
export function freeSpot(flow: Flow, position: Position): Position {
  const taken = Object.values(fullLayout(flow));
  const collides = (spot: Position) => taken.some((box) => Math.abs(box.x - spot.x) < BOX.width && Math.abs(box.y - spot.y) < BOX.height);
  let spot = position;
  for (let i = 0; i < MAX_SPOT_TRIES && collides(spot); i++) spot = { x: position.x, y: spot.y + SPOT_STEP };
  return spot;
}

export function addStep(flow: Flow, type: StepType, position: Position): { flow: Flow; id: string } {
  const taken = new Set(flow.nodes.map((step) => step.id));
  let n = flow.nodes.length + 1;
  while (taken.has(`paso-${n}`)) n++;
  const id = `paso-${n}`;
  return { id, flow: { ...flow, nodes: [...flow.nodes, STEP_META[type].create(id)], layout: { ...fullLayout(flow), [id]: position } } };
}

/** Quita un paso y deja sin conectar las salidas que iban a él. El primer paso no se puede quitar. */
export function removeStep(flow: Flow, id: string): Flow {
  if (id === flow.startNodeId) return flow;
  const nodes = flow.nodes
    .filter((step) => step.id !== id)
    .map((step) => outputsOf(step).reduce((current, output) => (output.target === id ? withOutput(current, output.handle, undefined) : current), step));
  const { [id]: _removed, ...layout } = fullLayout(flow);
  return { ...flow, nodes, layout };
}

const SHORT_TEXT = 25;
const quoted = (items: readonly string[]) => {
  const parts = items.map((item) => `«${item}»`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : (parts[0] ?? '');
};

export const stepName = (step: FlowStep): string => (step.type === 'message' ? `Mensaje: ${step.text.slice(0, SHORT_TEXT).trim()}` : STEP_META[step.type].label);

/** Salidas sin conectar, explicadas en español (antes de mandar al servidor, que da los errores en formato técnico). */
export function missingConnections(flow: Flow): string[] {
  return flow.nodes.flatMap((step) => {
    const missing = outputsOf(step).filter((output) => !output.target && !output.optional);
    if (missing.length === 0) return [];
    return [`«${stepName(step)}» (${step.id}): falta a dónde va ${quoted(missing.map((output) => output.label))}.`];
  });
}

/** Pasos que mandan algo a la persona (o pueden hacerlo, como ir a otro flujo). Igual que en el servidor (isSending). */
const SENDING = new Set<StepType>(['message', 'carousel', 'media', 'react', 'setter_opener', 'goto']);

/** Salidas automáticas (sin que la persona pulse): las mismas que el motor (autoEdges). */
function autoTargets(step: FlowStep): string[] {
  return outputsOf(step)
    .filter((output) => !/^(btn|qr|card)-/.test(output.handle))
    .flatMap((output) => (output.target ? [output.target] : []));
}

/**
 * Avisos en vivo (Fase 7.3b): lo que el servidor rechazaría, dicho antes de guardar. Salidas sin conectar y, en los
 * flujos por comentario, las reglas de Meta: el primer paso es un mensaje (el DM al comentario) con botones (no
 * respuestas rápidas) y tras él nada se envía solo hasta que la persona responda.
 */
export function liveWarnings(flow: Flow): string[] {
  const warnings = missingConnections(flow);
  if (flow.trigger.type !== 'comment') return warnings;
  const byId = new Map(flow.nodes.map((step) => [step.id, step]));
  const start = byId.get(flow.startNodeId);
  if (start?.type !== 'message') return [...warnings, 'En un flujo por comentario, el primer paso tiene que ser un mensaje (es el DM al comentario).'];
  if ((start.quickReplies ?? []).length > 0) warnings.push('El DM al comentario no puede llevar respuestas rápidas: usa botones.');
  const seen = new Set<string>();
  const queue = autoTargets(start);
  while (queue.length > 0) {
    const step = byId.get(queue.shift() as string);
    if (!step || seen.has(step.id)) continue;
    seen.add(step.id);
    if (SENDING.has(step.type)) {
      warnings.push(`Tras el DM al comentario, «${stepName(step)}» se enviaría sin que la persona responda: Meta no lo permite. Ponlo detrás de un botón.`);
      break;
    }
    queue.push(...autoTargets(step));
  }
  return warnings;
}

/** Elige el primer paso. En los flujos por comentario tiene que ser un mensaje (el DM al comentario). */
export function setStart(flow: Flow, id: string): Flow {
  const step = flow.nodes.find((s) => s.id === id);
  if (!step || (flow.trigger.type === 'comment' && step.type !== 'message')) return flow;
  return { ...flow, startNodeId: id };
}
