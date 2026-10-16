import { randomBytes } from 'node:crypto';
import { findNode, validateFlow, type Flow, type ValidationResult } from './types.js';

/**
 * Formulario "plantilla tipo ManyChat" del panel (Fase 2) ↔ flujo de nodos.
 * El constructor visual (Fase 6) editará los nodos directamente; este formulario cubre el caso típico:
 *  - modo "link":   DM con un botón que abre el recurso.
 *  - modo "follow": DM con botón → ¿me sigue? → sí: recurso · no: "sígueme" + botón para reintentar.
 */

export const TEMPLATE = 'basic';
const NODE = { start: 'start', gate: 'gate', resource: 'resource', notFollowing: 'notfollow' } as const;

export interface FlowForm {
  id: string;
  name: string;
  enabled: boolean;
  allMedia: boolean;
  mediaIds: string[];
  keywords: string;
  publicReplies: string;
  testUsernames: string;
  oncePerUser: boolean;
  mode: 'link' | 'follow';
  startText: string;
  linkTitle: string;
  linkUrl: string;
  startButtonTitle: string;
  resourceText: string;
  resourceButtonTitle: string;
  resourceUrl: string;
  notFollowingText: string;
  retryButtonTitle: string;
}

export const EMPTY_FORM: FlowForm = {
  id: '',
  name: '',
  enabled: false,
  allMedia: false,
  mediaIds: [],
  keywords: '',
  publicReplies: '¡Te escribí por DM! 📩\n¡Revisa tus mensajes! 🚀\n¡Enviado! Mira tu DM 👀',
  testUsernames: '',
  oncePerUser: true,
  mode: 'follow',
  startText: '¡Hola! 👋 Gracias por comentar. Pulsa el botón y te paso el recurso.',
  linkTitle: 'Ver recurso',
  linkUrl: '',
  startButtonTitle: '¡Lo quiero! 🎁',
  resourceText: 'Aquí lo tienes 👇',
  resourceButtonTitle: 'Abrir recurso',
  resourceUrl: '',
  notFollowingText: 'Para recibirlo tienes que seguirme 🙌 Cuando me sigas, pulsa el botón.',
  retryButtonTitle: 'Ya te sigo ✅',
};

export function newFlowId(): string {
  return randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
}

const splitComma = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const splitLines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

type FormBody = Record<string, string | File | (string | File)[]>;

function text(body: FormBody, key: keyof FlowForm): string {
  const value = body[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

function list(body: FormBody, key: keyof FlowForm): string[] {
  const value = body[key];
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return items.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

/** Lee el formulario HTML (parseBody con all: true). */
export function readForm(body: FormBody): FlowForm {
  return {
    id: text(body, 'id').trim(),
    name: text(body, 'name').trim(),
    enabled: text(body, 'enabled') === 'on',
    allMedia: text(body, 'allMedia') === 'on',
    mediaIds: list(body, 'mediaIds'),
    keywords: text(body, 'keywords'),
    publicReplies: text(body, 'publicReplies'),
    testUsernames: text(body, 'testUsernames'),
    oncePerUser: text(body, 'oncePerUser') === 'on',
    mode: text(body, 'mode') === 'link' ? 'link' : 'follow',
    startText: text(body, 'startText').trim(),
    linkTitle: text(body, 'linkTitle').trim(),
    linkUrl: text(body, 'linkUrl').trim(),
    startButtonTitle: text(body, 'startButtonTitle').trim(),
    resourceText: text(body, 'resourceText').trim(),
    resourceButtonTitle: text(body, 'resourceButtonTitle').trim(),
    resourceUrl: text(body, 'resourceUrl').trim(),
    notFollowingText: text(body, 'notFollowingText').trim(),
    retryButtonTitle: text(body, 'retryButtonTitle').trim(),
  };
}

function buildNodes(form: FlowForm): Flow['nodes'] {
  if (form.mode === 'link') {
    return [
      {
        id: NODE.start,
        type: 'message',
        text: form.startText,
        buttons: form.linkUrl ? [{ type: 'url', title: form.linkTitle, url: form.linkUrl }] : [],
      },
    ];
  }
  return [
    { id: NODE.start, type: 'message', text: form.startText, buttons: [{ type: 'postback', title: form.startButtonTitle, next: NODE.gate }] },
    { id: NODE.gate, type: 'follow_gate', ifFollowing: NODE.resource, ifNotFollowing: NODE.notFollowing, ifUnknown: NODE.resource },
    {
      id: NODE.resource,
      type: 'message',
      text: form.resourceText,
      buttons: form.resourceUrl ? [{ type: 'url', title: form.resourceButtonTitle, url: form.resourceUrl }] : [],
    },
    { id: NODE.notFollowing, type: 'message', text: form.notFollowingText, buttons: [{ type: 'postback', title: form.retryButtonTitle, next: NODE.gate }] },
  ];
}

/** Convierte el formulario en flujo y lo valida. */
export function formToFlow(form: FlowForm, makeId: () => string = newFlowId): ValidationResult {
  const candidate = {
    id: form.id || makeId(),
    name: form.name,
    enabled: form.enabled,
    trigger: { mediaIds: form.allMedia ? 'all' : form.mediaIds, keywords: splitComma(form.keywords) },
    publicReplies: splitLines(form.publicReplies),
    startNodeId: NODE.start,
    nodes: buildNodes(form),
    testUsernames: splitComma(form.testUsernames).map((name) => name.replace(/^@/, '')),
    oncePerUser: form.oncePerUser,
    template: TEMPLATE,
  };
  if (!form.allMedia && form.mediaIds.length === 0) {
    return { ok: false, errors: ['Elige al menos un reel o marca "Todos los reels".'] };
  }
  return validateFlow(candidate);
}

function urlButton(flow: Flow, nodeId: string): { title: string; url: string } {
  const node = findNode(flow, nodeId);
  const button = node?.type === 'message' ? node.buttons.find((item) => item.type === 'url') : undefined;
  return button?.type === 'url' ? { title: button.title, url: button.url } : { title: '', url: '' };
}

function messageText(flow: Flow, nodeId: string): string {
  const node = findNode(flow, nodeId);
  return node?.type === 'message' ? node.text : '';
}

function postbackTitle(flow: Flow, nodeId: string): string {
  const node = findNode(flow, nodeId);
  const button = node?.type === 'message' ? node.buttons.find((item) => item.type === 'postback') : undefined;
  return button?.title ?? '';
}

/** Para editar: solo los flujos creados con este formulario se pueden volver a abrir en él. */
export function flowToForm(flow: Flow): FlowForm | null {
  if (flow.template !== TEMPLATE) return null;
  const mode = findNode(flow, NODE.gate) ? 'follow' : 'link';
  const link = urlButton(flow, NODE.start);
  const resource = urlButton(flow, NODE.resource);
  return {
    id: flow.id,
    name: flow.name,
    enabled: flow.enabled,
    allMedia: flow.trigger.mediaIds === 'all',
    mediaIds: flow.trigger.mediaIds === 'all' ? [] : [...flow.trigger.mediaIds],
    keywords: flow.trigger.keywords.join(', '),
    publicReplies: flow.publicReplies.join('\n'),
    testUsernames: flow.testUsernames.join(', '),
    oncePerUser: flow.oncePerUser,
    mode,
    startText: messageText(flow, NODE.start),
    linkTitle: link.title || EMPTY_FORM.linkTitle,
    linkUrl: link.url,
    startButtonTitle: postbackTitle(flow, NODE.start) || EMPTY_FORM.startButtonTitle,
    resourceText: messageText(flow, NODE.resource) || EMPTY_FORM.resourceText,
    resourceButtonTitle: resource.title || EMPTY_FORM.resourceButtonTitle,
    resourceUrl: resource.url,
    notFollowingText: messageText(flow, NODE.notFollowing) || EMPTY_FORM.notFollowingText,
    retryButtonTitle: postbackTitle(flow, NODE.notFollowing) || EMPTY_FORM.retryButtonTitle,
  };
}
