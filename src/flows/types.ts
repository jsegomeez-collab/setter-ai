import { z } from 'zod';
import { autoEdges, isSending, MAX_TEMPLATE_TEXT, nodeId, nodeSchema, tapEdges, type FlowNode } from './nodes.js';

/**
 * Formato de un flujo: cómo empieza (disparador), respuestas públicas (solo comentarios) y una lista de pasos
 * conectados por id. Los pasos y sus límites están en nodes.ts.
 *
 * Formas de empezar (Fase 7.3a):
 *  - comment:       comentario en todos los reels o en reels elegidos, con o sin palabras clave.
 *  - dm_keyword:    DM con alguna palabra clave.
 *  - story_reply:   respuesta a una historia (con o sin palabras clave).
 *  - story_mention: la persona menciona la cuenta en su historia.
 *  - ref:           abre el chat desde un enlace ig.me/m/<cuenta>?ref=<ref>.
 *  - manual:        solo desde otro flujo, un rompehielos o el menú fijo.
 */

export { MAX_BUTTONS, MAX_DELAY_SECONDS, MAX_PLAIN_TEXT, MAX_TEMPLATE_TEXT, nodeSchema } from './nodes.js';
export type { Button, Card, ConditionRule, FlowNode, MessageNode, QuickReply } from './nodes.js';

const keywordList = z.array(z.string().trim().min(1).max(50)).max(30);

export const triggerSchema = z.preprocess(
  // Los flujos guardados antes de la 7.3 no tienen "type": eran todos de comentarios.
  (value) => (value && typeof value === 'object' && !('type' in value) ? { ...value, type: 'comment' } : value),
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('comment'),
      mediaIds: z.union([z.literal('all'), z.array(z.string().regex(/^\d{5,30}$/)).min(1)]),
      /** Vacío = cualquier comentario. */
      keywords: keywordList,
    }),
    z.object({ type: z.literal('dm_keyword'), keywords: keywordList.min(1), exact: z.boolean().default(false) }),
    z.object({ type: z.literal('story_reply'), keywords: keywordList }),
    z.object({ type: z.literal('story_mention') }),
    z.object({ type: z.literal('ref'), ref: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'el ref solo admite letras, números, - y _ (máx. 40)') }),
    z.object({ type: z.literal('manual') }),
  ]),
);

/** Detecta bucles automáticos (A → B → A sin que la persona pulse nada), que harían cosas sin fin. */
function findAutoCycle(nodes: readonly FlowNode[]): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): string | null => {
    if (state.get(id) === 'open') return id;
    if (state.get(id) === 'done') return null;
    const node = byId.get(id);
    if (!node) return null;
    state.set(id, 'open');
    for (const next of autoEdges(node)) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    state.set(id, 'done');
    return null;
  };
  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Primer paso que enviaría algo solo (sin que la persona pulse) desde las salidas automáticas de `startId`. */
function findAutoSend(nodes: readonly FlowNode[], startId: string): FlowNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const start = byId.get(startId);
  if (!start) return null;
  const seen = new Set<string>();
  const queue = autoEdges(start);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (isSending(node)) return node;
    queue.push(...autoEdges(node));
  }
  return null;
}

export const flowSchema = z
  .object({
    id: nodeId,
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    trigger: triggerSchema,
    /** Solo comentarios: respuestas públicas (una al azar), si el DM salió bien. */
    publicReplies: z.array(z.string().trim().min(1).max(300)).max(20),
    /**
     * Plan B (solo comentarios): respuestas públicas cuando Meta rechaza el DM al comentario, pidiendo que nos escriban.
     * Si esa persona escribe en los 7 días siguientes, el flujo le manda su primer mensaje. Vacío = sin plan B.
     */
    dmFailedReplies: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    startNodeId: nodeId,
    nodes: z.array(nodeSchema).min(1).max(50),
    /** Si tiene usuarios, el flujo SOLO responde a ellos (modo prueba). */
    testUsernames: z.array(z.string().trim().min(1).max(30)).max(20),
    oncePerUser: z.boolean(),
    /**
     * Alcance de "una vez por persona" en comentarios: "media" = una vez por persona y por reel; "flow" = una sola vez
     * por persona en todo el flujo. En las demás formas de empezar es siempre por persona y flujo.
     */
    onceScope: z.enum(['media', 'flow']).default('media'),
    /** "basic" = creado con el formulario del panel; otro valor = creado por el constructor o en JSON. */
    template: z.string().max(30).optional(),
    /** Posición de cada paso en el lienzo del constructor visual (Fase 6.5). El motor no la usa. */
    layout: z.record(nodeId, z.object({ x: z.number().finite(), y: z.number().finite() })).optional(),
  })
  .superRefine((flow, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const ids = new Set<string>();
    for (const node of flow.nodes) {
      if (ids.has(node.id)) issue(`Nodo repetido: ${node.id}`);
      ids.add(node.id);
    }
    const mustExist = (target: string, where: string) => {
      if (!ids.has(target)) issue(`${where} apunta a un nodo que no existe: ${target}`);
    };
    mustExist(flow.startNodeId, 'El inicio');

    if (flow.trigger.type === 'comment') {
      const start = flow.nodes.find((node) => node.id === flow.startNodeId);
      if (start && start.type !== 'message') issue('El primer paso tiene que ser un mensaje (es el DM al comentario).');
      if (start?.type === 'message' && start.quickReplies.length > 0) {
        issue('El DM al comentario no puede llevar respuestas rápidas: usa botones (es lo que Meta acepta en la respuesta al comentario).');
      }
      const autoSend = start ? findAutoSend(flow.nodes, start.id) : null;
      if (autoSend) {
        issue(
          `Tras el DM al comentario, el paso ${autoSend.id} enviaría algo sin que la persona responda: Meta solo deja seguir escribiendo cuando la persona responde o pulsa un botón.`,
        );
      }
    }

    for (const node of flow.nodes) {
      for (const edge of tapEdges(node)) mustExist(edge.target, edge.label);
      for (const next of autoEdges(node)) mustExist(next, `Siguiente paso de ${node.id}`);
      if (node.type === 'message') {
        if (node.buttons.length > 0 && node.text.length > MAX_TEMPLATE_TEXT) {
          issue(`Nodo ${node.id}: con botones el texto no puede pasar de ${MAX_TEMPLATE_TEXT} caracteres.`);
        }
        if (node.buttons.length > 0 && node.quickReplies.length > 0) issue(`Nodo ${node.id}: no se pueden poner botones y respuestas rápidas a la vez.`);
      }
      if (node.type === 'goto' && node.flowId === flow.id) issue(`Nodo ${node.id}: un flujo no puede ir a sí mismo.`);
    }
    const cycle = findAutoCycle(flow.nodes);
    if (cycle) issue(`Bucle automático en el paso ${cycle}: haría cosas sin fin.`);
  });

export type Flow = z.infer<typeof flowSchema>;
export type FlowTrigger = Flow['trigger'];
/** Lo que se puede escribir (los campos con valor por defecto son opcionales). */
export type FlowInput = z.input<typeof flowSchema>;

export type ValidationResult = { ok: true; flow: Flow } | { ok: false; errors: string[] };

export function validateFlow(input: unknown): ValidationResult {
  const result = flowSchema.safeParse(input);
  if (result.success) return { ok: true, flow: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)),
  };
}

export function findNode(flow: Flow, nodeId: string): FlowNode | undefined {
  return flow.nodes.find((node) => node.id === nodeId);
}
