import type { Store } from './store.js';

/**
 * Pausas programadas ("espera 2 minutos y luego…").
 * Cada pausa se guarda en la base de datos y se programa con un temporizador en memoria.
 * Al arrancar se recuperan las pendientes (si el servidor se reinició, las atrasadas se ejecutan ya).
 * No se consulta la base de datos periódicamente: así Neon puede dormir (ahorro de horas gratis).
 */

export interface JobPayload {
  readonly flowId: string;
  readonly nodeId: string;
  readonly recipientId: string;
  readonly dedupKey: string;
  readonly depth: number;
}

export interface SchedulerOptions {
  readonly store: Store;
  /** Qué hacer cuando vence la pausa (normalmente: planificar el nodo y encolarlo). */
  readonly onDue: (payload: JobPayload) => Promise<unknown>;
  readonly now?: () => Date;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

function isPayload(value: unknown): value is JobPayload {
  const v = value as Partial<JobPayload> | null;
  return !!v && typeof v.flowId === 'string' && typeof v.nodeId === 'string' && typeof v.recipientId === 'string' && typeof v.dedupKey === 'string';
}

export class Scheduler {
  private readonly timers = new Set<unknown>();
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** Recupera las pausas pendientes de la base de datos (al arrancar). */
  async start(): Promise<number> {
    const jobs = await this.options.store.pendingJobs();
    for (const job of jobs) this.arm(job.id, job.runAt, job.payload);
    return jobs.length;
  }

  /** Programa una pausa. Devuelve false si ya estaba programada (misma clave). */
  async add(payload: JobPayload, delaySeconds: number): Promise<boolean> {
    const runAt = new Date(this.now().getTime() + delaySeconds * 1000);
    const id = await this.options.store.scheduleJob(`job:${payload.dedupKey}`, runAt, payload);
    if (id === null) return false;
    this.arm(id, runAt, payload);
    return true;
  }

  stop(): void {
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers.clear();
  }

  private arm(id: number, runAt: Date, payload: unknown): void {
    const wait = Math.max(0, runAt.getTime() - this.now().getTime());
    const handle = this.setTimer(() => {
      this.timers.delete(handle);
      void this.run(id, payload);
    }, wait);
    this.timers.add(handle);
  }

  private async run(id: number, payload: unknown): Promise<void> {
    const { store, onDue } = this.options;
    try {
      if (!(await store.claimJob(id))) return;
      if (!isPayload(payload)) {
        await store.finishJob(id, 'failed', { error: 'Datos de la pausa no válidos' });
        return;
      }
      const result = await onDue(payload);
      await store.finishJob(id, 'done', result ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.finishJob(id, 'failed', { error: message }).catch(() => undefined);
      await store.logEvent('error', `Fallo al ejecutar una pausa programada (${id}).`, { message }).catch(() => undefined);
    }
  }
}
