import { z } from 'zod';

/**
 * Formato genérico de un flujo. Es el contrato que usará el constructor visual (Fase 6):
 * un disparador, respuestas públicas y una lista de nodos conectados por id.
 */

export const MAX_BUTTONS = 3; // Límite de Meta para el button template.
export const MAX_TEMPLATE_TEXT = 640; // Texto máximo de un mensaje con botones (doc de Meta).
export const MAX_PLAIN_TEXT = 1000; // Texto máximo de un mensaje sin botones (doc de Meta: 1000 bytes).
const MAX_BUTTON_TITLE = 40;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'id con letras, números, - o _ (máx. 32)');
const httpsUrl = z.url({ protocol: /^https?$/ });

export const buttonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), title: z.string().trim().min(1).max(MAX_BUTTON_TITLE), url: httpsUrl }),
  z.object({ type: z.literal('postback'), title: z.string().trim().min(1).max(MAX_BUTTON_TITLE), next: id }),
]);

export const messageNodeSchema = z.object({
  id,
  type: z.literal('message'),
  text: z.string().trim().min(1).max(MAX_PLAIN_TEXT),
  buttons: z.array(buttonSchema).max(MAX_BUTTONS),
});

export const followGateNodeSchema = z.object({
  id,
  type: z.literal('follow_gate'),
  ifFollowing: id,
  ifNotFollowing: id,
  /** Cuando Meta no deja saber si sigue (falta de "consentimiento"). */
  ifUnknown: id,
});

export const nodeSchema = z.discriminatedUnion('type', [messageNodeSchema, followGateNodeSchema]);

export const flowSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    trigger: z.object({
      mediaIds: z.union([z.literal('all'), z.array(z.string().regex(/^\d{5,30}$/)).min(1)]),
      /** Vacío = cualquier comentario. */
      keywords: z.array(z.string().trim().min(1).max(50)).max(30),
    }),
    publicReplies: z.array(z.string().trim().min(1).max(300)).max(20),
    startNodeId: id,
    nodes: z.array(nodeSchema).min(1).max(50),
    /** Si tiene usuarios, el flujo SOLO responde a ellos (modo prueba). */
    testUsernames: z.array(z.string().trim().min(1).max(30)).max(20),
    oncePerUser: z.boolean(),
    /** "basic" = creado con el formulario del panel; otro valor = creado por el constructor. */
    template: z.string().max(30).optional(),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    for (const node of flow.nodes) {
      if (ids.has(node.id)) ctx.addIssue({ code: 'custom', message: `Nodo repetido: ${node.id}` });
      ids.add(node.id);
    }
    const mustExist = (target: string, where: string) => {
      if (!ids.has(target)) ctx.addIssue({ code: 'custom', message: `${where} apunta a un nodo que no existe: ${target}` });
    };
    mustExist(flow.startNodeId, 'El inicio');
    const start = flow.nodes.find((node) => node.id === flow.startNodeId);
    if (start && start.type !== 'message') {
      ctx.addIssue({ code: 'custom', message: 'El primer paso tiene que ser un mensaje (es el DM al comentario).' });
    }
    for (const node of flow.nodes) {
      if (node.type === 'message') {
        if (node.buttons.length > 0 && node.text.length > MAX_TEMPLATE_TEXT) {
          ctx.addIssue({ code: 'custom', message: `Nodo ${node.id}: con botones el texto no puede pasar de ${MAX_TEMPLATE_TEXT} caracteres.` });
        }
        for (const button of node.buttons) if (button.type === 'postback') mustExist(button.next, `Botón "${button.title}"`);
      } else {
        mustExist(node.ifFollowing, `Condición ${node.id} (sí sigue)`);
        mustExist(node.ifNotFollowing, `Condición ${node.id} (no sigue)`);
        mustExist(node.ifUnknown, `Condición ${node.id} (no se sabe)`);
      }
    }
  });

export type Button = z.infer<typeof buttonSchema>;
export type MessageNode = z.infer<typeof messageNodeSchema>;
export type FlowNode = z.infer<typeof nodeSchema>;
export type Flow = z.infer<typeof flowSchema>;

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
