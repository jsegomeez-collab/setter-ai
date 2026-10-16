import type { ActionRow, EventRow, Store } from '../src/store.js';

/** Base de datos falsa en memoria con el mismo comportamiento que la de Postgres. */
export function createMemoryStore(): Store & {
  requests: { signatureOk: boolean; payload: unknown }[];
  events: EventRow[];
  actions: Map<string, ActionRow & { request: unknown }>;
  settings: Map<string, string | null>;
  allowed: string[];
} {
  const requests: { signatureOk: boolean; payload: unknown }[] = [];
  const events: EventRow[] = [];
  const actions = new Map<string, ActionRow & { request: unknown }>();
  const settings = new Map<string, string | null>();
  const allowed: string[] = [];

  return {
    requests,
    events,
    actions,
    settings,
    allowed,
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
