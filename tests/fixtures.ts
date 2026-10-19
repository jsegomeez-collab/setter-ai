import type { FlowInput } from '../src/flows/types.js';

/** Réplica del flujo real de ManyChat de Jose (captura del 2026-10-16). */
export const JOSE_FLOW: FlowInput = {
  id: 'manychat1',
  name: 'Réplica ManyChat',
  enabled: true,
  trigger: { type: 'comment', mediaIds: 'all', keywords: [] },
  publicReplies: ['¡Te escribí por DM! 📩'],
  startNodeId: 'inicio',
  nodes: [
    { id: 'inicio', type: 'message', text: 'buenas! acabo de ver tu comentario, quieres que te mande el recurso?', buttons: [{ type: 'postback', title: 'si, mándamelo', next: 'sigue' }] },
    { id: 'sigue', type: 'follow_gate', ifFollowing: 'biblioteca', ifNotFollowing: 'nosigue', ifUnknown: 'biblioteca' },
    { id: 'nosigue', type: 'message', text: 'vi que no me sigues, ve a mi perfil y sígueme para que pueda enviartelo', buttons: [{ type: 'postback', title: 'Ya te seguí', next: 'sigue' }] },
    {
      id: 'biblioteca',
      type: 'message',
      text: 'Hello! Todos mis recursos y herramientas las tengo en mi biblioteca de recursos.',
      buttons: [{ type: 'url', title: 'IR A LA BIBLIOTECA', url: 'https://biblioteca.example.com', tags: ['biblioteca'] }],
      next: 'espera',
    },
    { id: 'espera', type: 'delay', seconds: 120, next: 'grupo' },
    {
      id: 'grupo',
      type: 'message',
      text: 'Por cierto, en mi grupo de WhatsApp comparto mucho valor a diario, para unirte, haz click en el botón',
      buttons: [{ type: 'url', title: 'UNIRME AL GRUPO', url: 'https://chat.whatsapp.com/ejemplo', tags: ['Grupo WhatsApp'] }],
    },
  ],
  testUsernames: [],
  oncePerUser: true,
};
