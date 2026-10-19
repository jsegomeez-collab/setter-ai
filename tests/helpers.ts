import type { SetterConfig } from '../src/config.js';
import type { Flow } from '../src/flows/types.js';
import type { SetterOutput } from '../src/setter/schema.js';
import { scrubPerson } from '../src/intelligence/verify.js';
import type { NewAnalysisRun } from '../src/store-analysis.js';
import {
  deletionHash,
  SEND_ACTION_TYPES,
  type ActionRow,
  type CommentRecord,
  type ContactRow,
  type ConversationRow,
  type EventRow,
  type JobRow,
  type KnowledgeKind,
  type KnowledgeRow,
  type MessageRow,
  type Store,
} from '../src/store.js';
import type { KnowledgeDocRow } from '../src/store-docs.js';

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
  messages: MessageRow[];
  knowledge: KnowledgeRow[];
} {
  const contacts = new Map<string, ContactRow>();
  const messages: MessageRow[] = [];
  /** Análisis guardados (Fase 6.6). */
  const analysisRuns: (NewAnalysisRun & { id: number; createdAt: Date; findings: number })[] = [];
  const knowledge: KnowledgeRow[] = [];
  /** Versiones del marco técnico (Fase 6.1), aparte del documento. */
  const frames: KnowledgeRow[] = [];
  /** Documentos por tema (Fase 7.2): metadatos y versiones de cada `doc:<slug>`. */
  const docs = new Map<string, KnowledgeDocRow>();
  const docVersions = new Map<string, KnowledgeRow[]>();
  let knowledgeIds = 0;
  const versionsOf = (kind: KnowledgeKind): KnowledgeRow[] => {
    if (kind === 'document') return knowledge;
    if (kind === 'frame') return frames;
    const list = docVersions.get(kind) ?? [];
    docVersions.set(kind, list);
    return list;
  };
  /** Contacto nuevo con los mismos valores por defecto que la tabla contacts. */
  const blankContact = (igId: string): ContactRow => {
    const now = new Date();
    return { igId, username: null, tags: [], firstSeen: now, lastSeen: now, sourceMediaId: null, lastMediaId: null, aiPaused: false, aiPausedReason: null, lead: null };
  };
  const messageIdOf = (response: unknown): unknown => {
    const r = response as { messageId?: unknown; result?: { messageId?: unknown } } | null;
    return r?.messageId ?? r?.result?.messageId;
  };
  const comments: CommentRecord[] = [];
  const commentDates = new Map<string, Date>();
  const leadHistory: { igId: string; lead: unknown; createdAt: Date }[] = [];
  const deleted = new Map<string, Date>();
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
    messages,
    knowledge,
    async addMessage(m) {
      if (m.mid !== null && messages.some((existing) => existing.mid === m.mid)) return;
      messages.push({ ...m, note: m.note ?? null, id: messages.length + 1, createdAt: new Date() });
    },
    async setMessageStatus(dedupKey, status, mid = null) {
      messages.forEach((m, i) => {
        if (m.dedupKey === dedupKey) messages[i] = { ...m, status, mid: mid ?? m.mid };
      });
    },
    async agendaStats() {
      const isAgenda = (data: unknown) => Array.isArray((data as { t?: unknown } | null)?.t) && ((data as { t: unknown[] }).t).includes('agenda');
      const hasAgendaButton = (request: unknown) => {
        const buttons = (request as { message?: { buttons?: unknown } } | null)?.message?.buttons;
        return Array.isArray(buttons) && buttons.some((b) => Array.isArray((b as { tags?: unknown }).tags) && (b as { tags: unknown[] }).tags.includes('agenda'));
      };
      const offered = new Set(
        [...actions.values()].filter((a) => a.type === 'send_message' && a.ok === true && hasAgendaButton(a.request)).map((a) => (a.request as { recipientId: string }).recipientId),
      );
      const clicked = new Set(events.filter((e) => e.kind === 'click' && isAgenda(e.data)).map((e) => (e.data as { r: string }).r));
      return { offered: offered.size, clicked: clicked.size };
    },
    async existingCommentIds(commentIds) {
      return new Set(comments.map((c) => c.commentId).filter((id) => commentIds.includes(id)));
    },
    async deletePersonData(igId) {
      // Misma lógica que el SQL de store.ts (Postgres), en memoria.
      const commentIds = comments.filter((c) => c.igId === igId).map((c) => c.commentId);
      const quoted = `"${igId}"`;
      const req = (a: { request: unknown }) => (a.request ?? {}) as { recipientId?: string; commentId?: string; message?: { recipientId?: string } };
      const counts: Record<string, number> = {};
      const drop = <T>(list: T[], test: (item: T) => boolean) => {
        const before = list.length;
        const kept = list.filter((item) => !test(item));
        list.splice(0, list.length, ...kept);
        return before - kept.length;
      };
      const doomed = [...actions.values()].filter((a) => {
        const r = req(a);
        return r.recipientId === igId || r.message?.recipientId === igId || commentIds.includes(r.commentId ?? '') || a.dedupKey.startsWith('once:') && (a.dedupKey.endsWith(`:${igId}`) || a.dedupKey.includes(`:${igId}:`));
      });
      doomed.forEach((a) => actions.delete(a.dedupKey));
      counts.actions = doomed.length;
      const doomedJobs = [...jobs.entries()].filter(([, job]) => (job.payload as { recipientId?: unknown } | null)?.recipientId === igId);
      doomedJobs.forEach(([id]) => jobs.delete(id));
      counts.scheduled_jobs = doomedJobs.length;
      counts.event_log = drop(events, (e) => JSON.stringify(e.data ?? null).includes(quoted));
      counts.webhook_requests = drop(requests, (r) => JSON.stringify(r.payload ?? null).includes(quoted));
      counts.comments = drop(comments, (c) => c.igId === igId);
      counts.messages = drop(messages, (m) => m.igId === igId);
      counts.lead_history = drop(leadHistory, (h) => h.igId === igId);
      counts.allowed_senders = drop(allowed, (id) => id === igId);
      counts.contacts = contacts.delete(igId) ? 1 : 0;
      const touched = analysisRuns.filter((run) => JSON.stringify(run.result).includes(quoted));
      touched.forEach((run) => Object.assign(run, { result: scrubPerson(run.result, igId) }));
      counts.analysis_runs = touched.length;
      return counts;
    },
    async analysisMessages(since) {
      const usernames = new Map([...contacts.values()].map((c) => [c.igId, c.username]));
      return messages
        .filter((m) => m.status === 'sent' && m.createdAt >= since)
        .sort((a, b) => a.igId.localeCompare(b.igId) || a.id - b.id)
        .map((m) => ({ igId: m.igId, username: usernames.get(m.igId) ?? null, direction: m.direction, source: m.source, text: m.text, createdAt: m.createdAt }));
    },
    async saveAnalysisRun(run) {
      const id = analysisRuns.length + 1;
      analysisRuns.push({ ...run, id, createdAt: new Date(), findings: Object.values(run.result.sections).reduce((n, items) => n + items.length, 0) });
      return id;
    },
    async listAnalysisRuns(limit) {
      return [...analysisRuns].reverse().slice(0, limit).map(({ id, createdAt, createdBy, period, conversations, costUsd, findings }) => ({ id, createdAt, createdBy, period, conversations, costUsd, findings }));
    },
    async getAnalysisRun(id) {
      const run = analysisRuns.find((r) => r.id === id);
      if (!run) return null;
      const { createdBy: _by, ...rest } = run;
      return { ...rest, createdBy: run.createdBy };
    },
    async deleteDeletionTraces(igId, dedupKey, messageId) {
      actions.delete(dedupKey);
      const isTrace = (m: MessageRow) => m.igId === igId && (m.dedupKey === dedupKey || (messageId !== null && m.mid === messageId));
      messages.splice(0, messages.length, ...messages.filter((m) => !isTrace(m)));
      const quoted = `"${igId}"`;
      const isTraceEvent = (e: EventRow) => (e.kind === 'receipt' && JSON.stringify(e.data ?? null).includes(quoted)) || (messageId !== null && JSON.stringify(e.data ?? null).includes(messageId));
      events.splice(0, events.length, ...events.filter((e) => !isTraceEvent(e)));
      if (messageId) requests.splice(0, requests.length, ...requests.filter((r) => !JSON.stringify(r.payload ?? null).includes(messageId)));
    },
    async markDeleted(igId) {
      deleted.set(deletionHash(igId), new Date());
    },
    async deletedAt(igId) {
      const at = deleted.get(deletionHash(igId));
      return at && at.getTime() >= Date.now() - 24 * 60 * 60 * 1000 ? at : null;
    },
    async pendingConversations(since) {
      const last = new Map<string, MessageRow>();
      for (const m of messages) last.set(m.igId, m);
      return [...last.values()].filter((m) => m.direction === 'in' && m.createdAt >= since).map((m) => m.igId);
    },
    async listMessages(igId, limit) {
      return limit > 0 ? messages.filter((m) => m.igId === igId).slice(-limit) : [];
    },
    async listConversations(limit) {
      const last = new Map<string, MessageRow>();
      for (const m of messages) last.set(m.igId, m);
      return [...last.values()]
        .map((m): ConversationRow => {
          const contact = contacts.get(m.igId);
          return {
            igId: m.igId,
            username: contact?.username ?? null,
            lastText: m.text,
            lastAt: m.createdAt,
            lastDirection: m.direction,
            lastStatus: m.status,
            lastNote: m.note ?? null,
            aiPaused: contact?.aiPaused ?? false,
            lead: contact?.lead ?? null,
          };
        })
        .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
        .slice(0, limit);
    },
    async getContact(igId) {
      const contact = contacts.get(igId);
      return contact ? { ...blankContact(igId), ...contact } : null;
    },
    async setAiPaused(igId, paused, reason) {
      contacts.set(igId, { ...(contacts.get(igId) ?? blankContact(igId)), aiPaused: paused, aiPausedReason: reason });
    },
    async saveLead(igId, lead) {
      contacts.set(igId, { ...(contacts.get(igId) ?? blankContact(igId)), lead });
      const last = leadHistory.filter((h) => h.igId === igId).at(-1);
      if (JSON.stringify(last?.lead) !== JSON.stringify(lead)) leadHistory.push({ igId, lead, createdAt: new Date() });
    },
    async listLeadHistory(igId, limit) {
      return limit > 0 ? leadHistory.filter((h) => h.igId === igId).slice(-limit).map(({ lead, createdAt }) => ({ lead, createdAt })) : [];
    },
    async setterStageStats() {
      const stepOf = (lead: unknown) => (lead as { siguiente_paso?: unknown } | null)?.siguiente_paso;
      const stages = new Map<string, number>();
      for (const contact of contacts.values()) {
        const step = stepOf(contact.lead);
        if (typeof step === 'string') stages.set(step, (stages.get(step) ?? 0) + 1);
      }
      const transitions = new Map<string, number>();
      const prevByPerson = new Map<string, unknown>();
      for (const h of leadHistory) {
        const prev = prevByPerson.get(h.igId);
        const step = stepOf(h.lead);
        if (typeof prev === 'string' && typeof step === 'string' && prev !== step) transitions.set(`${prev}|${step}`, (transitions.get(`${prev}|${step}`) ?? 0) + 1);
        prevByPerson.set(h.igId, step);
      }
      return {
        stages: [...stages.entries()].map(([step, n]) => ({ step, n })),
        transitions: [...transitions.entries()].map(([key, n]) => ({ from: key.split('|')[0] as string, to: key.split('|')[1] as string, n })),
      };
    },
    async findActionByMessageId(mid) {
      const action = [...actions.values()].find((a) => messageIdOf(a.response) === mid);
      return action ? { dedupKey: action.dedupKey, request: action.request } : null;
    },
    async saveKnowledge(text, kind = 'document') {
      const id = ++knowledgeIds;
      versionsOf(kind).push({ id, text, createdAt: new Date() });
      return id;
    },
    async getKnowledge(kind = 'document') {
      return versionsOf(kind).at(-1) ?? null;
    },
    async listKnowledgeVersions(limit, kind = 'document') {
      return [...versionsOf(kind)].reverse().slice(0, limit);
    },
    async listKnowledgeDocs() {
      return [...docs.values()].sort((a, b) => a.position - b.position);
    },
    async saveKnowledgeDoc(doc) {
      const current = docs.get(doc.slug);
      docs.set(doc.slug, current ? { ...doc, builtin: current.builtin } : doc);
    },
    async deleteKnowledgeDoc(slug) {
      docs.delete(slug);
      docVersions.delete(`doc:${slug}`);
    },
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
    async unansweredCommentEvents(since) {
      return events
        .filter((e) => e.kind === 'comment' && e.createdAt >= since)
        .map((e) => e.data as { commentId?: string })
        .filter((data) => !actions.has(`private:${data.commentId}`));
    },
    async recordComment(comment) {
      if (comments.some((c) => c.commentId === comment.commentId)) return;
      comments.push(comment);
      commentDates.set(comment.commentId, new Date());
    },
    async funnelRows(since) {
      // Misma lógica que el SQL de store.ts (Postgres), en memoria.
      const all = [...actions.values()];
      const req = (a: { request: unknown }) => (a.request ?? {}) as { commentId?: string; recipientId?: string };
      const byPerson = (igId: string, test: (a: (typeof all)[number]) => boolean) => all.some((a) => req(a).recipientId === igId && test(a));
      const groups = new Map<string, CommentRecord[]>();
      for (const c of comments) {
        const at = commentDates.get(c.commentId) ?? new Date(0);
        if (!c.mediaId || at < since) continue;
        const key = `${c.mediaId}|${c.igId}`;
        groups.set(key, [...(groups.get(key) ?? []), c]);
      }
      return [...groups.values()].map((list) => {
        const first = list[0] as CommentRecord;
        const ids = list.map((c) => c.commentId);
        const dms = all.filter((a) => a.type === 'private_reply' && ids.includes(req(a).commentId ?? ''));
        const lead = contacts.get(first.igId)?.lead as { siguiente_paso?: unknown } | undefined;
        return {
          mediaId: first.mediaId as string,
          igId: first.igId,
          firstAt: new Date(Math.min(...ids.map((id) => commentDates.get(id)?.getTime() ?? 0))),
          dmOk: dms.some((a) => a.ok === true),
          dmFailed: dms.some((a) => a.ok === false),
          planB: all.some((a) => a.type === 'reply_comment' && a.ok === true && ids.some((id) => a.dedupKey === `reply-fail:${id}`)),
          rescued: byPerson(first.igId, (a) => a.type === 'send_message' && a.ok === true && a.dedupKey.startsWith('rescate-dm:')),
          asked: byPerson(first.igId, (a) => a.type === 'check_follow'),
          follows: byPerson(first.igId, (a) => a.type === 'check_follow' && (a.response as { follow?: unknown } | null)?.follow === 'yes'),
          clicked: events.some((e) => e.kind === 'click' && (e.data as { r?: unknown } | null)?.r === first.igId),
          wrote: messages.some((m) => m.igId === first.igId && m.direction === 'in'),
          qualified: lead?.siguiente_paso === 'agendar_llamada',
        };
      });
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
    async removeContactTag(igId, tag) {
      const current = contacts.get(igId);
      if (current) contacts.set(igId, { ...current, tags: current.tags.filter((t) => t !== tag) });
    },
    async listContacts(limit) {
      return [...contacts.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime()).slice(0, limit);
    },
    async listPersonComments(igId, limit) {
      return comments
        .filter((c) => c.igId === igId)
        .map((c) => ({ commentId: c.commentId, mediaId: c.mediaId, text: c.text, createdAt: commentDates.get(c.commentId) ?? new Date() }))
        .reverse()
        .slice(0, limit);
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
    async countSendsSince(since, types) {
      const allowed = types ? new Set<string>(types) : sendTypes;
      return [...actions.values()].filter((a) => a.createdAt >= since && allowed.has(a.type) && a.ok !== false).length;
    },
    async failedPrivateReply(igId, since) {
      const found = [...actions.values()]
        .filter((a) => a.type === 'private_reply' && a.ok === false && a.createdAt >= since)
        .filter((a) => (a.request as { message?: { recipientId?: unknown } } | null)?.message?.recipientId === igId)
        .at(-1);
      return found ? { dedupKey: found.dedupKey, request: found.request, createdAt: found.createdAt } : null;
    },
    async getAction(dedupKey) {
      const action = actions.get(dedupKey);
      return action ? { ok: action.ok, request: action.request, response: action.response } : null;
    },
    async pendingActions() {
      return [...actions.values()].filter((a) => a.ok === null && a.type !== 'once').map((a) => a.request);
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

/** Enlaces y correo de prueba del setter (no son los reales). */
export const TEST_SETTER_LINKS = {
  agenda: 'https://agenda.example.com/llamada?utm_source=instagram',
  membership: 'https://pago.example.com/membresia',
  contactEmail: 'info@example.com',
} as const;

export const TEST_SETTER_CONFIG: SetterConfig = { anthropicApiKey: null, model: 'claude-haiku-5-5', links: TEST_SETTER_LINKS };

/** Salida de Claude de ejemplo (respuesta + ficha), con lo que cada prueba quiera cambiar. */
export function sampleOutput(overrides: Partial<SetterOutput> = {}, lead: Partial<SetterOutput['lead']> = {}): SetterOutput {
  return {
    messages: ['genial! 🙌', 'ya usas alguna IA como ChatGPT o Claude?'],
    needs_human: false,
    needs_human_reason: null,
    lead: {
      usa_ia: null,
      gano_dinero: null,
      dedicacion_ubicacion: null,
      objetivo_6_meses: null,
      puede_invertir: 'desconocido',
      nivel: 'desconocido',
      vive_en_eeuu: 'desconocido',
      es_menor: 'no',
      siguiente_paso: 'seguir_calificando',
      tipo_lead: 'desconocido',
      objeciones: [],
      resumen: 'Acaba de escribir, sin datos todavía.',
      ...lead,
    },
    ...overrides,
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
    dmFailedReplies: [],
    startNodeId: 'start',
    nodes: [
      { id: 'start', type: 'message', text: 'Hola, pulsa el botón', buttons: [{ type: 'postback', title: 'Lo quiero', next: 'gate' }] },
      { id: 'gate', type: 'follow_gate', ifFollowing: 'resource', ifNotFollowing: 'notfollow', ifUnknown: 'resource' },
      { id: 'resource', type: 'message', text: 'Aquí lo tienes', buttons: [{ type: 'url', title: 'Abrir', url: 'https://example.com/recurso', tags: ['biblioteca'] }] },
      { id: 'notfollow', type: 'message', text: 'Sígueme primero', buttons: [{ type: 'postback', title: 'Ya te sigo', next: 'gate' }] },
    ],
    testUsernames: [],
    oncePerUser: true,
    onceScope: 'media',
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

export function messagePayload(text: string, options: { mid?: string; sender?: string; recipient?: string; isEcho?: boolean } = {}): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: ACCOUNT_ID,
        time: 1760000000,
        messaging: [
          {
            sender: { id: options.sender ?? STRANGER_ID },
            recipient: { id: options.recipient ?? ACCOUNT_ID },
            timestamp: 1760000000000,
            message: { mid: options.mid ?? 'm-1', text, ...(options.isEcho ? { is_echo: true } : {}) },
          },
        ],
      },
    ],
  };
}
