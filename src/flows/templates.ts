import type { Flow } from './types.js';

/**
 * Plantillas para crear flujos rápido (Fase 7.3b). Todas nacen DESACTIVADAS y con textos de ejemplo que Jose cambia
 * antes de activar. Cada una pasa validateFlow (lo comprueban las pruebas de la API).
 */

export const TEMPLATE_IDS = ['blank', 'comment_resource', 'comment_follow', 'dm_keyword', 'story_reply', 'story_mention'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const EXAMPLE_URL = 'https://example.com/tu-recurso';

type Body = Pick<Flow, 'trigger' | 'publicReplies' | 'startNodeId' | 'nodes'>;

const BODIES: Readonly<Record<TemplateId, Body>> = {
  blank: {
    trigger: { type: 'comment', mediaIds: 'all', keywords: [] },
    publicReplies: [],
    startNodeId: 'inicio',
    nodes: [{ id: 'inicio', type: 'message', text: '¡Hola! 👋 Aquí tienes lo que pediste.', buttons: [], quickReplies: [] }],
  },
  comment_resource: {
    trigger: { type: 'comment', mediaIds: 'all', keywords: [] },
    publicReplies: ['¡Te lo mandé por DM! 📩', '¡Revisa tus mensajes! 🚀'],
    startNodeId: 'inicio',
    nodes: [
      { id: 'inicio', type: 'message', text: '¡Hola! Vi tu comentario 🙌 ¿Te mando el recurso?', buttons: [{ type: 'postback', title: '¡Sí, mándamelo!', next: 'recurso' }], quickReplies: [] },
      { id: 'recurso', type: 'message', text: 'Aquí lo tienes 👇', buttons: [{ type: 'url', title: 'Abrir el recurso', url: EXAMPLE_URL, tags: ['recurso'] }], quickReplies: [] },
    ],
  },
  comment_follow: {
    trigger: { type: 'comment', mediaIds: 'all', keywords: [] },
    publicReplies: ['¡Te escribí por DM! 📩'],
    startNodeId: 'inicio',
    nodes: [
      { id: 'inicio', type: 'message', text: '¡Hola! Vi tu comentario 🙌 Pulsa el botón y te paso el recurso.', buttons: [{ type: 'postback', title: '¡Lo quiero!', next: 'sigue' }], quickReplies: [] },
      { id: 'sigue', type: 'follow_gate', ifFollowing: 'recurso', ifNotFollowing: 'no_sigue', ifUnknown: 'recurso' },
      { id: 'recurso', type: 'message', text: 'Aquí lo tienes 👇', buttons: [{ type: 'url', title: 'Abrir el recurso', url: EXAMPLE_URL, tags: ['recurso'] }], quickReplies: [] },
      { id: 'no_sigue', type: 'message', text: 'Para recibirlo tienes que seguirme 🙌 Cuando me sigas, pulsa el botón.', buttons: [{ type: 'postback', title: 'Ya te sigo ✅', next: 'sigue' }], quickReplies: [] },
    ],
  },
  dm_keyword: {
    trigger: { type: 'dm_keyword', keywords: ['GUIA'], exact: false },
    publicReplies: [],
    startNodeId: 'etiqueta',
    nodes: [
      { id: 'etiqueta', type: 'tag', op: 'add', tag: 'pidio-guia', next: 'guia' },
      { id: 'guia', type: 'message', text: '¡Aquí tienes la guía! 👇', buttons: [{ type: 'url', title: 'Abrir la guía', url: EXAMPLE_URL, tags: [] }], quickReplies: [] },
    ],
  },
  story_reply: {
    trigger: { type: 'story_reply', keywords: [] },
    publicReplies: [],
    startNodeId: 'reaccion',
    nodes: [
      { id: 'reaccion', type: 'react', emoji: '❤️', next: 'gracias' },
      {
        id: 'gracias',
        type: 'message',
        text: '¡Gracias por responder a mi historia! 🙌 ¿Qué te interesa más?',
        buttons: [],
        quickReplies: [
          { title: 'Aprender IA', next: 'respuesta' },
          { title: 'Para mi negocio', next: 'respuesta' },
        ],
      },
      { id: 'respuesta', type: 'message', text: '¡Genial! Te cuento por aquí 👇', buttons: [], quickReplies: [] },
    ],
  },
  story_mention: {
    trigger: { type: 'story_mention' },
    publicReplies: [],
    startNodeId: 'reaccion',
    nodes: [
      { id: 'reaccion', type: 'react', emoji: '🙌', next: 'gracias' },
      { id: 'gracias', type: 'message', text: '¡Gracias por mencionarme en tu historia! 🙏', buttons: [], quickReplies: [] },
    ],
  },
};

/** Flujo nuevo desde una plantilla: desactivado y "una vez por persona". */
export function flowFromTemplate(template: TemplateId, id: string, name: string): Flow {
  return {
    id,
    name,
    enabled: false,
    ...BODIES[template],
    dmFailedReplies: [],
    testUsernames: [],
    oncePerUser: true,
    onceScope: 'media',
    template: 'builder',
  };
}
