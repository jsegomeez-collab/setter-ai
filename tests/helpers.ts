import type { Flow } from '../src/flows/types.js';
import { SEND_ACTION_TYPES, type ActionRow, type CommentRecord, type ContactRow, type EventRow, type JobRow, type Store } from '../src/store.js';

/** Base de datos falsa en memoria con el mismo comportamiento que la de Postgres. */
export function createMemoryStore(): Store & {
  requests: { signatureOk: boolean; payload: unknown }[];
  events: EventRow[];
  actions: Map<string, ActionRow & { request: unknown }>;
  settings: Map<string, string | null>;
  allowed: string[];
  flows: Map<string, Flow>;
  contacts: Map<string, ContactRow>;
  jobs: Map<number, JobRow & { dedupKey: string; status: string; result: unknown }>;
} {
  const contacts = new Map<string, ContactRow>();
  const comments: CommentRecord[] = [];
  const jobs = new Map<number, JobRow & { dedupKey: string; status: string; result: unknown }>();
  let nextJobId = 1;
  const requests: { signatureOk: boolean; payload: unknown }[] = [];
  const events: EventRow[] = [];
  const actions = new Map<string, ActionRow & { request: unknown }>();
  const settings = new Map<string, string | null>();
  const allowed: string[] = [];
  const flows = new Map<string, Flow>();
  const sendTypes = new Set<string>(SEND_ACTION_TYPES);

  return {
    requests,
    events,
    actions,
    settings,
    allowed,
    flows,
    contacts,
    jobs,
    async touchContact(igId, username, mediaId = null) {
      const now = new Date();
      const current = contacts.get(igId);
      contacts.set(
        igId,
        current
          ? {
              ...current,
              username: username ?? current.username,
              sourceMediaId: current.sourceMediaId ?? mediaId,
              lastMediaId: mediaId ?? current.lastMediaId,
              lastSeen: now,
            }
          : { igId, username, tags: [], firstSeen: now, lastSeen: now, sourceMediaId: mediaId, lastMediaId: mediaId },
      );
    },
    async recordComment(comment) {
      if (!comments.some((c) => c.commentId === comment.commentId)) comments.push(comment);
    },
    async reelStats() {
      const byMedia = new Map<string, CommentRecord[]>();
      for (const c of comments) if (c.mediaId) byMedia.set(c.mediaId, [...(byMedia.get(c.mediaId) ?? []), c]);
      return [...byMedia.entries()].map(([mediaId, list]) => {
        const tagged: Record<string, number> = {};
        for (const contact of contacts.values()) {
          if (contact.sourceMediaId !== mediaId) continue;
          for (const tag of contact.tags) tagged[tag] = (tagged[tag] ?? 0) + 1;
        }
        return { mediaId, comments: list.length, people: new Set(list.map((c) => c.igId)).size, tagged };
      });
    },
    async addContactTags(igId, tags) {
      if (tags.length === 0) return;
      const now = new Date();
      const current = contacts.get(igId) ?? { igId, username: null, tags: [], firstSeen: now, lastSeen: now, sourceMediaId: null, lastMediaId: null };
      contacts.set(igId, { ...current, tags: [...new Set([...current.tags, ...tags])].sort(), lastSeen: now });
    },
    async listContacts(limit) {
      return [...contacts.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime()).slice(0, limit);
    },
    async scheduleJob(dedupKey, runAt, payload) {
      if ([...jobs.values()].some((job) => job.dedupKey === dedupKey)) return null;
      const id = nextJobId++;
      jobs.set(id, { id, runAt, payload, dedupKey, status: 'pending', result: null });
      return id;
    },
    async pendingJobs() {
      return [...jobs.values()].filter((job) => job.status === 'pending').map(({ id, runAt, payload }) => ({ id, runAt, payload }));
    },
    async claimJob(id) {
      const job = jobs.get(id);
      if (!job || job.status !== 'pending') return false;
      jobs.set(id, { ...job, status: 'running' });
      return true;
    },
    async finishJob(id, status, result) {
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, status, result });
    },
    async listFlows() {
      return [...flows.values()];
    },
    async saveFlow(flow) {
      flows.set(flow.id, flow);
    },
    async deleteFlow(id) {
      flows.delete(id);
    },
    async countSendsSince(since) {
      return [...actions.values()].filter((a) => a.createdAt >= since && sendTypes.has(a.type) && a.ok !== false).length;
    },
    async recordRequest(signatureOk, payload) {
      requests.push({ signatureOk, payload });
    },
    async logEvent(kind, note, data) {
      events.push({ createdAt: new Date(), kind, note, data });
    },
    async claimAction(dedupKey, type, request) {
      if (actions.has(dedupKey)) return false;
      actions.set(dedupKey, { createdAt: new Date(), type, dedupKey, ok: null, response: null, request });
      return true;
    },
    async finishAction(dedupKey, ok, response) {
      const current = actions.get(dedupKey);
      if (current) actions.set(dedupKey, { ...current, ok, response });
    },
    async getSetting(key) {
      return settings.get(key) ?? null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },
    async allowSender(igId) {
      if (!allowed.includes(igId)) allowed.push(igId);
    },
    async listAllowedSenders() {
      return [...allowed];
    },
    async recentEvents(limit) {
      return [...events].reverse().slice(0, limit);
    },
    async recentActions(limit) {
      return [...actions.values()].reverse().slice(0, limit);
    },
  };
}

export const ACCOUNT_ID = '17841400000000001';
export const TEST_MEDIA_ID = '18000000000000001';
export const STRANGER_ID = '9000000000000001';

export function commentPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: ACCOUNT_ID,
        time: 1760000000,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'c-1',
              text: 'info',
              from: { id: STRANGER_ID, username: 'cuenta_prueba' },
              media: { id: TEST_MEDIA_ID, media_product_type: 'REELS' },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

/** Flujo de ejemplo con condición de seguir, igual que el que genera el formulario. */
export function followFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: 'flow1',
    name: 'Reel n8n',
    enabled: true,
    trigger: { mediaIds: [TEST_MEDIA_ID], keywords: [] },
    publicReplies: ['¡Te escribí por DM! 📩'],
    startNodeId: 'start',
    nodes: [
      { id: 'start', type: 'message', text: 'Hola, pulsa el botón', buttons: [{ type: 'postback', title: 'Lo quiero', next: 'gate' }] },
      { id: 'gate', type: 'follow_gate', ifFollowing: 'resource', ifNotFollowing: 'notfollow', ifUnknown: 'resource' },
      { id: 'resource', type: 'message', text: 'Aquí lo tienes', buttons: [{ type: 'url', title: 'Abrir', url: 'https://example.com/recurso', tags: ['biblioteca'] }] },
      { id: 'notfollow', type: 'message', text: 'Sígueme primero', buttons: [{ type: 'postback', title: 'Ya te sigo', next: 'gate' }] },
    ],
    testUsernames: [],
    oncePerUser: true,
    template: 'basic',
    ...overrides,
  };
}

export function postbackPayload(payload: string, options: { mid?: string; sender?: string } = {}): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: ACCOUNT_ID,
        time: 1760000000,
        messaging: [
          {
            sender: { id: options.sender ?? STRANGER_ID },
            recipient: { id: ACCOUNT_ID },
            timestamp: 1760000000000,
            postback: { mid: options.mid ?? 'pb-1', title: 'Lo quiero', payload },
          },
        ],
      },
    ],
  };
}

export function messagePayload(text: string, options: { mid?: string; sender?: string; isEcho?: boolean } = {}): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: ACCOUNT_ID,
        time: 1760000000,
        messaging: [
          {
            sender: { id: options.sender ?? STRANGER_ID },
            recipient: { id: ACCOUNT_ID },
            timestamp: 1760000000000,
            message: { mid: options.mid ?? 'm-1', text, ...(options.isEcho ? { is_echo: true } : {}) },
          },
        ],
      },
    ],
  };
}
