import { STEP_LABEL, type Flow, type FlowStep, type Position, type StepType } from './types';

/**
 * Lienzo del constructor (Fase 6.5b): funciones puras para pasar un flujo a cajas y flechas y editarlo.
 * Nunca mutan: devuelven un flujo nuevo. Las reglas de Meta las comprueba el servidor al guardar.
 */

export interface Output {
  /** Id de la salida en la caja: btn-N (botón de acción), next (después), yes / no / unknown (condición). */
  readonly handle: string;
  readonly label: string;
  readonly target: string | undefined;
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

/** Las salidas de un paso (a dónde puede ir después). Los botones de enlace no tienen salida: abren una web. */
export function outputsOf(step: FlowStep): Output[] {
  switch (step.type) {
    case 'message':
      return [
        ...step.buttons.flatMap((button, i) => (button.type === 'postback' ? [{ handle: `btn-${i}`, label: button.title, target: orNone(button.next) }] : [])),
        { handle: 'next', label: 'Después', target: step.next },
      ];
    case 'follow_gate':
      return [
        { handle: 'yes', label: 'Sí sigue', target: orNone(step.ifFollowing) },
        { handle: 'no', label: 'No sigue', target: orNone(step.ifNotFollowing) },
        { handle: 'unknown', label: 'No se sabe', target: orNone(step.ifUnknown) },
      ];
    case 'delay':
      return [{ handle: 'next', label: 'Después', target: orNone(step.next) }];
    case 'setter_opener':
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

/** Cambia a dónde va una salida (undefined = sin conectar). */
function withOutput(step: FlowStep, handle: string, target: string | undefined): FlowStep {
  switch (step.type) {
    case 'message': {
      if (handle === 'next') {
        const { next: _old, ...rest } = step;
        return target ? { ...rest, next: target } : rest;
      }
      const index = Number(handle.replace('btn-', ''));
      return { ...step, buttons: step.buttons.map((button, i) => (i === index && button.type === 'postback' ? { ...button, next: target ?? '' } : button)) };
    }
    case 'follow_gate': {
      const field = handle === 'yes' ? 'ifFollowing' : handle === 'no' ? 'ifNotFollowing' : 'ifUnknown';
      return { ...step, [field]: target ?? '' };
    }
    case 'delay':
      return { ...step, next: target ?? '' };
    case 'setter_opener':
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

const NEW_STEP: Readonly<Record<StepType, (id: string) => FlowStep>> = {
  message: (id) => ({ id, type: 'message', text: 'Escribe aquí el mensaje', buttons: [] }),
  follow_gate: (id) => ({ id, type: 'follow_gate', ifFollowing: '', ifNotFollowing: '', ifUnknown: '' }),
  delay: (id) => ({ id, type: 'delay', seconds: 15 * 60, next: '' }),
  setter_opener: (id) => ({ id, type: 'setter_opener', texts: ['¡Hola! ¿a qué te dedicas?'] }),
};

export function addStep(flow: Flow, type: StepType, position: Position): { flow: Flow; id: string } {
  const taken = new Set(flow.nodes.map((step) => step.id));
  let n = flow.nodes.length + 1;
  while (taken.has(`paso-${n}`)) n++;
  const id = `paso-${n}`;
  return { id, flow: { ...flow, nodes: [...flow.nodes, NEW_STEP[type](id)], layout: { ...fullLayout(flow), [id]: position } } };
}

/** Quita un paso y deja sin conectar las salidas que iban a él. El primer mensaje no se puede quitar. */
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

/** Salidas sin conectar, explicadas en español (antes de mandar al servidor, que da los errores en formato técnico). */
export function missingConnections(flow: Flow): string[] {
  return flow.nodes.flatMap((step) => {
    const missing = outputsOf(step).filter((output) => !output.target && !(step.type === 'message' && output.handle === 'next'));
    if (missing.length === 0) return [];
    const name = step.type === 'message' ? `Mensaje: ${step.text.slice(0, SHORT_TEXT).trim()}` : STEP_LABEL[step.type];
    return [`«${name}» (${step.id}): falta a dónde va ${quoted(missing.map((output) => output.label))}.`];
  });
}

/** Elige el primer mensaje (el DM al comentario). Meta no deja que tenga "después" automático: se le quita. */
export function setStart(flow: Flow, id: string): Flow {
  const step = flow.nodes.find((s) => s.id === id);
  if (!step || step.type !== 'message') return flow;
  return { ...mapStep(flow, id, (s) => withOutput(s, 'next', undefined)), startNodeId: id };
}
