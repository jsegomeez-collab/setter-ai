import type Anthropic from '@anthropic-ai/sdk';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { catchUpComments } from './catch-up.js';
import type { Config } from './config.js';
import { rescuePendingDms } from './flows/dm-rescue.js';
import type { InstagramConnect } from './instagram-connect.js';
import type { WorkspacesAdmin } from './routes-api-workspaces.js';
import type { InstagramConnection } from './workspace-manager.js';
import { ClaudeAnalyzer } from './intelligence/analyzer.js';
import { InstagramClient } from './meta/client.js';
import { TokenManager } from './meta/token.js';
import { processEvent, processInBackground, rescueComments } from './process.js';
import { Scheduler } from './scheduler.js';
import { Sender } from './sender.js';
import { ClaudeBrain } from './setter/brain.js';
import { EchoWatcher } from './setter/echoes.js';
import { readSetterLinks } from './setter/links.js';
import { SetterService } from './setter/service.js';
import { ClaudeLeadPlayer, LEAD_MODEL } from './setter/simulator.js';
import type { Store } from './store.js';
import { scopeUsers } from './users-scope.js';
import type { UserStore } from './users.js';

/**
 * Todo lo que funciona para UN espacio (Fase 7.5a): token, emisor, pausas, setter, ecos, recuperación de
 * comentarios, renovación del token y su app (web, API, avisos). Antes vivía en index.ts solo para Jose; ahora se
 * arranca una vez por espacio. El principal (Jose, `workspaceId` null) funciona exactamente igual que antes.
 */

const TOKEN_CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_TOKEN_CHECK_MS = 60 * 1000;
/** Al arrancar se contestan los DMs sin respuesta de la última hora (más antiguos ya no parecen una conversación viva). */
const PENDING_REPLY_WINDOW_MS = 60 * 60 * 1000;
/** Recuperar comentarios: 2 min tras arrancar (la versión anterior ya se apagó) mirando los 15 min anteriores al arranque. */
const CATCH_UP_DELAY_MS = 2 * 60 * 1000;
const CATCH_UP_WINDOW_MS = 15 * 60 * 1000;
/**
 * Enlaces del setter en los espacios nuevos: vacíos hasta que su dueño ponga los suyos (7.5c). Nunca los de Jose.
 * El setter de un espacio nuevo nace apagado, así que no llega a usarlos.
 */
const NO_LINKS = { agenda: '', membership: '', contactEmail: '' } as const;

export interface RuntimeDeps {
  readonly config: Config;
  /** null = el principal (Jose). */
  readonly workspaceId: string | null;
  readonly store: Store & { close(): Promise<void> };
  /** Usuarios de todos los espacios: aquí se ven solo los de este (scopeUsers). */
  readonly users: UserStore;
  readonly anthropic: Anthropic | null;
  /** Token de Instagram de las variables de entorno: solo el principal. */
  readonly envToken: string | null;
  /** Clave para firmar los enlaces con seguimiento (null = desactivados). */
  readonly linkSecret: string | null;
  readonly instagramConnect?: InstagramConnect | null;
  /** Qué hace /webhook. En el principal: repartir los avisos entre espacios. Si falta, se procesan aquí. */
  readonly webhookPayload?: (payload: unknown) => void;
  /** Nombre del espacio para el menú (los nuevos). */
  readonly workspace?: { readonly id: string; readonly name: string } | null;
  /** Crear espacios e invitar (Fase 7.5b): solo el principal. */
  readonly workspaces?: WorkspacesAdmin;
  /** Conectar de verdad el Instagram de otro espacio (7.5c): solo el principal, donde vuelve Instagram. */
  readonly connectWorkspace?: (workspaceId: string, connection: InstagramConnection) => Promise<void>;
}

export interface WorkspaceRuntime {
  readonly id: string | null;
  readonly store: Store;
  readonly app: Hono;
  /** Procesa un aviso de Meta de este espacio (en segundo plano). */
  process(payload: unknown): void;
  /** Guarda el token de "Conectar Instagram" (cifrado, en su base). Para usarlo, el espacio se reinicia. */
  saveToken(token: string, expiresInSeconds: number | null): Promise<void>;
  /** Id de su cuenta de Instagram (null si no tiene token o Meta no responde). */
  accountId(): Promise<string | null>;
  close(): Promise<void>;
}

export async function startWorkspaceRuntime(deps: RuntimeDeps): Promise<WorkspaceRuntime> {
  const { config, store, workspaceId } = deps;
  const tokens = new TokenManager({ store, envToken: deps.envToken, encryptionKey: config.tokenEncryptionKey });
  const hasToken = (await tokens.get()) !== null;
  const client = hasToken ? new InstagramClient(() => tokens.get(), config.igApiVersion) : null;

  // Enlaces con seguimiento: necesitan URL pública + clave. Si falta algo, los botones llevan la URL real.
  const linkSigner = deps.linkSecret && config.publicBaseUrl ? { baseUrl: config.publicBaseUrl, secret: deps.linkSecret, ...(workspaceId ? { workspace: workspaceId } : {}) } : null;

  // El programador avisa al emisor cuando vence una pausa; el emisor programa pausas en el programador.
  let sender: Sender | null = null;
  let setterRef: SetterService | null = null;
  const scheduler = new Scheduler({ store, onDue: (payload) => (sender ? sender.continueFlow(payload) : Promise.resolve({ skipped: 'sin emisor' })) });
  sender = new Sender(
    {
      store,
      client,
      limits: config.limits,
      delays: config.delays,
      linkSigner,
      schedule: (payload, delaySeconds) => scheduler.add(payload, delaySeconds),
      // El setter se crea después (necesita el emisor): se enlaza en cuanto existe.
      openSetter: (recipientId, texts, dedupKey) =>
        setterRef ? setterRef.openConversation(recipientId, texts, dedupKey) : Promise.resolve({ skipped: 'Setter sin arrancar' }),
    },
    async (flowId) => (await store.listFlows()).find((flow) => flow.id === flowId),
  );
  const activeSender = sender;
  const recovered = await scheduler.start();
  if (recovered > 0) await store.logEvent('pausas', `Recuperadas ${recovered} pausas pendientes tras el arranque.`, null);
  const resumed = await activeSender.recover();
  if (resumed > 0) await store.logEvent('cola', `Retomados ${resumed} envíos pendientes tras el arranque.`, null);

  // Setter IA. Sin clave de Anthropic los DMs se guardan pero no se responde. Arranca apagado (modo en /setter).
  const { anthropic } = deps;
  // Enlaces de reserva: Jose, los de Render (como siempre); un espacio nuevo, ninguno hasta que ponga los suyos.
  const defaultLinks = workspaceId === null ? config.setter.links : NO_LINKS;
  const brain = anthropic ? new ClaudeBrain(anthropic, config.setter.model) : null;
  // Simulador del panel: el lead lo hace siempre Haiku (barato y justo para comparar modelos del setter).
  const simulator = anthropic && brain ? { brain, lead: new ClaudeLeadPlayer(anthropic, LEAD_MODEL) } : null;
  const setter = new SetterService({
    store,
    brain,
    // Los del espacio (puestos en la web) o los de reserva; se leen en cada respuesta (7.5c).
    links: async () => (await readSetterLinks(store, defaultLinks)).links,
    enqueue: (actions) => activeSender.enqueue(actions),
    getUsername: async (igId) => (client ? client.getUsername(igId) : null),
    showTyping: client ? (igId) => client.sendTypingOn(igId) : undefined,
  });
  setterRef = setter;
  const echoes = new EchoWatcher({ store });
  // Si el servidor se reinició durante la espera de 8 s, esos DMs quedaron sin respuesta: se contestan ahora.
  const pendingReplies = await setter.resumePending(new Date(Date.now() - PENDING_REPLY_WINDOW_MS));
  if (pendingReplies > 0) await store.logEvent('setter', `Al arrancar: ${pendingReplies} conversación(es) esperaban respuesta; se revisan ahora.`, null);
  const processDeps = { store, sender: activeSender, setter, echoes };
  const process = (payload: unknown) => processInBackground(payload, processDeps);

  // Comentarios que Meta avisó durante el cambio de versión (502) y no nos llegaron. Se espera a que la versión
  // anterior se haya apagado (Render la para 60 s después del cambio) y se miran los 15 min anteriores al arranque.
  const startedAt = Date.now();
  const catchUp = client
    ? setTimeout(() => {
        catchUpComments({ store, client, processEvent: (event) => processEvent(event, processDeps) }, new Date(startedAt - CATCH_UP_WINDOW_MS))
          .then((result) =>
            store.logEvent('recuperacion', `Tras arrancar: ${result.recovered} comentario(s) recuperado(s); reels revisados ${result.media}, con error ${result.failedMedia}.`, result),
          )
          .catch((error: unknown) =>
            store.logEvent('error', 'Fallo recuperando comentarios tras arrancar.', { message: error instanceof Error ? error.message : String(error) }).catch(() => undefined),
          );
      }, CATCH_UP_DELAY_MS)
    : null;

  const app = createApp({
    config,
    store,
    client,
    tokens,
    linkSecret: linkSigner ? deps.linkSecret : null,
    processPayload: deps.webhookPayload ?? process,
    rescue: (since) => rescueComments(since, { store, sender: activeSender }),
    replyPending: (igId) => setter.replyNow(igId),
    rescueDms: () => rescuePendingDms({ store, sender: activeSender }),
    drafts: { approve: (igId) => setter.approveDraft(igId), discard: (igId) => setter.discardDraft(igId) },
    simulator,
    users: scopeUsers(deps.users, workspaceId),
    conversations: { sendManual: (igId, text, author) => setter.sendManual(igId, text, author) },
    // Inteligencia (Fase 6.6): Sonnet 5.5, solo cuando se pulsa "Analizar".
    analyzer: anthropic ? new ClaudeAnalyzer(anthropic) : null,
    instagramConnect: deps.instagramConnect ?? null,
    workspace: deps.workspace ?? null,
    workspaces: deps.workspaces,
    setterDefaultLinks: defaultLinks,
    connectWorkspace: deps.connectWorkspace,
  });

  const checkToken = () => {
    tokens
      .refreshIfDue()
      .then((result) => store.logEvent('token', result, null))
      .catch((error: unknown) => globalThis.process.stderr.write(`[setter-ai] Error renovando token (${workspaceId ?? 'principal'}): ${String(error)}\n`));
  };
  const firstCheck = setTimeout(checkToken, FIRST_TOKEN_CHECK_MS);
  const periodicCheck = setInterval(checkToken, TOKEN_CHECK_EVERY_MS);

  return {
    id: workspaceId,
    store,
    app,
    process,
    saveToken: (token, expiresInSeconds) => tokens.save(token, expiresInSeconds),
    async accountId() {
      if (!client) return null;
      try {
        return (await client.getAccount()).userId;
      } catch {
        return null;
      }
    },
    async close() {
      clearTimeout(firstCheck);
      if (catchUp) clearTimeout(catchUp);
      clearInterval(periodicCheck);
      scheduler.stop();
      setter.flushPending();
      await Promise.all([setter.idle(), echoes.idle()]);
      await activeSender.idle();
      await store.close();
    },
  };
}
