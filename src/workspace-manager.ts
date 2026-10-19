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
}

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
