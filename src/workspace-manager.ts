import type { WorkspaceRuntime } from './workspace-runtime.js';
import { newWorkspaceId, type Workspace, type WorkspaceRegistry } from './workspaces.js';

/**
 * Gestor de espacios (Fase 7.5a): arranca el de cada espacio guardado, crea espacios nuevos (su base, su registro
 * y su arranque) y reparte los avisos de Meta según la cuenta de Instagram que los manda. El principal (Jose) no
 * está en la lista: es el de siempre y se queda con todo lo que no sea de otro espacio.
 */

export interface ManagerDeps {
  readonly registry: WorkspaceRegistry;
  readonly principal: WorkspaceRuntime;
  /** Abre la base del espacio y lo arranca (workspace-runtime). */
  readonly start: (workspace: Workspace) => Promise<WorkspaceRuntime>;
  /** Crea la base de datos vacía del espacio. */
  readonly provision: (workspaceId: string) => Promise<void>;
  readonly log: (message: string) => void;
  /** Suscribe los avisos de Meta de una cuenta con su token (POST me/subscribed_apps). */
  readonly subscribe: (accessToken: string) => Promise<void>;
  /** Cuenta de Instagram del espacio principal (la de Jose), para no dejar conectarla en otro espacio. */
  readonly principalAccountId: () => Promise<string | null>;
}

/** Lo que devuelve "Conectar Instagram" (instagram-connect.ts) y hace falta para conectar un espacio. */
export interface InstagramConnection {
  readonly accessToken: string;
  readonly expiresInDays: number | null;
  readonly userId: string;
  readonly username: string;
}

const DAY_SECONDS = 24 * 60 * 60;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export class WorkspaceManager {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  /** Cuenta de Instagram → espacio (para repartir los avisos sin preguntar a la base en cada aviso). */
  private readonly byIgUser = new Map<string, string>();

  constructor(private readonly deps: ManagerDeps) {}

  get principal(): WorkspaceRuntime {
    return this.deps.principal;
  }

  /** Arranca todos los espacios guardados. Si uno falla, se apunta y los demás siguen (el de Jose nunca se para). */
  async boot(): Promise<void> {
    for (const workspace of await this.deps.registry.list()) {
      try {
        await this.launch(workspace);
      } catch (error) {
        this.deps.log(`No arrancó el espacio ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  list(): Promise<Workspace[]> {
    return this.deps.registry.list();
  }

  /** El arranque de un espacio (null = principal). undefined si ese espacio no existe o no arrancó. */
  get(id: string | null): WorkspaceRuntime | undefined {
    return id === null ? this.deps.principal : this.runtimes.get(id);
  }

  /** Espacio nuevo: crea su base vacía, lo guarda en la lista y lo arranca. */
  async create(name: string): Promise<Workspace> {
    const id = newWorkspaceId(name);
    await this.deps.provision(id);
    const workspace = await this.deps.registry.create({ id, name });
    await this.launch(workspace);
    return workspace;
  }

  /** Apunta la cuenta de Instagram del espacio: desde ese momento sus avisos de Meta le llegan a él. */
  async setInstagram(workspaceId: string, igUserId: string, igUsername: string | null): Promise<void> {
    await this.deps.registry.setInstagram(workspaceId, igUserId, igUsername);
    for (const [account, owner] of this.byIgUser) if (owner === workspaceId) this.byIgUser.delete(account);
    this.byIgUser.set(igUserId, workspaceId);
  }

  /**
   * Conecta de verdad el Instagram de un espacio (Fase 7.5c): guarda su token (cifrado, en su base), suscribe sus
   * avisos de Meta, apunta la cuenta (sus avisos le llegarán a él) y reinicia el espacio para que use el token.
   * Nunca la cuenta de Jose: se llevaría todos sus avisos.
   */
  async connectInstagram(workspaceId: string, connection: InstagramConnection): Promise<void> {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) throw new Error(`El espacio ${workspaceId} no está en marcha`);
    if (connection.userId === (await this.deps.principalAccountId())) {
      throw new Error('Esa es la cuenta principal (la de Jose): no se puede conectar a otro espacio.');
    }
    await runtime.saveToken(connection.accessToken, connection.expiresInDays === null ? null : connection.expiresInDays * DAY_SECONDS);
    await this.deps.subscribe(connection.accessToken);
    await this.setInstagram(workspaceId, connection.userId, connection.username);
    await this.restart(workspaceId);
    await this.runtimes.get(workspaceId)?.store.logEvent('instagram-conectar', `Instagram conectado: @${connection.username} (avisos suscritos).`, {
      userId: connection.userId,
      username: connection.username,
      expiresInDays: connection.expiresInDays,
    });
  }

  /** Para y vuelve a arrancar un espacio (p. ej. tras conectar su Instagram: así crea su cliente con el token). */
  private async restart(workspaceId: string): Promise<void> {
    const workspace = (await this.deps.registry.list()).find((ws) => ws.id === workspaceId);
    if (!workspace) throw new Error(`El espacio ${workspaceId} no existe`);
    await this.runtimes.get(workspaceId)?.close();
    this.runtimes.delete(workspaceId);
    await this.launch(workspace);
  }

  /**
   * Reparte un aviso de Meta: cada `entry` lleva el id de la cuenta de Instagram. Las de cuentas de otros espacios
   * van a ese espacio; el resto (la cuenta de Jose o lo que no se reconozca) al principal, como siempre.
   */
  dispatchWebhook(payload: unknown): void {
    if (!isObject(payload) || !Array.isArray(payload.entry)) {
      this.deps.principal.process(payload);
      return;
    }
    const groups = new Map<WorkspaceRuntime, unknown[]>();
    for (const entry of payload.entry) {
      const account = isObject(entry) && (typeof entry.id === 'string' || typeof entry.id === 'number') ? String(entry.id) : null;
      const owner = account ? this.byIgUser.get(account) : undefined;
      const runtime = (owner && this.runtimes.get(owner)) || this.deps.principal;
      groups.set(runtime, [...(groups.get(runtime) ?? []), entry]);
    }
    for (const [runtime, entry] of groups) runtime.process({ ...payload, entry });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close()));
  }

  private async launch(workspace: Workspace): Promise<void> {
    const runtime = await this.deps.start(workspace);
    this.runtimes.set(workspace.id, runtime);
    if (workspace.igUserId) this.byIgUser.set(workspace.igUserId, workspace.id);
  }
}
