import { describe, expect, it, vi } from 'vitest';
import { Scheduler, type JobPayload } from '../src/scheduler.js';
import { createMemoryStore } from './helpers.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const payload: JobPayload = { flowId: 'flow1', nodeId: 'grupo', recipientId: '9', dedupKey: 'pb:1:espera', depth: 2 };

function setup(onDue = vi.fn().mockResolvedValue({ ok: true })) {
  const store = createMemoryStore();
  const timers: { fn: () => void; ms: number }[] = [];
  const scheduler = new Scheduler({
    store,
    onDue,
    now: () => NOW,
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: vi.fn(),
  });
  const fire = async () => {
    for (const timer of timers.splice(0)) timer.fn();
    await vi.waitFor(() => expect([...store.jobs.values()].every((job) => job.status !== 'running')).toBe(true));
  };
  return { store, scheduler, timers, onDue, fire };
}

describe('Scheduler (pausas)', () => {
  it('guarda la pausa, programa el temporizador y al vencer ejecuta el siguiente paso', async () => {
    const { scheduler, store, timers, onDue, fire } = setup();
    expect(await scheduler.add(payload, 120)).toBe(true);
    expect(timers[0]?.ms).toBe(120_000);
    const job = [...store.jobs.values()][0];
    expect(job?.runAt.toISOString()).toBe('2026-10-16T12:02:00.000Z');
    await fire();
    expect(onDue).toHaveBeenCalledWith(payload);
    expect([...store.jobs.values()][0]).toMatchObject({ status: 'done', result: { ok: true } });
  });

  it('no programa dos veces la misma pausa', async () => {
    const { scheduler, timers } = setup();
    await scheduler.add(payload, 120);
    expect(await scheduler.add(payload, 120)).toBe(false);
    expect(timers).toHaveLength(1);
  });

  it('tras un reinicio recupera las pausas pendientes (las atrasadas se ejecutan ya)', async () => {
    const { store, scheduler, timers } = setup();
    await store.scheduleJob('job:a', new Date('2026-10-16T11:00:00Z'), payload);
    await store.scheduleJob('job:b', new Date('2026-10-16T12:05:00Z'), payload);
    expect(await scheduler.start()).toBe(2);
    expect(timers.map((t) => t.ms)).toEqual([0, 300_000]);
  });

  it('si falla, marca la pausa como fallida y lo registra; si los datos son malos, también', async () => {
    const { scheduler, store, fire } = setup(vi.fn().mockRejectedValue(new Error('flujo roto')));
    await scheduler.add(payload, 1);
    await fire();
    expect([...store.jobs.values()][0]).toMatchObject({ status: 'failed', result: { error: 'flujo roto' } });
    expect(store.events.some((e) => e.kind === 'error')).toBe(true);

    const second = setup();
    await second.store.scheduleJob('job:malo', NOW, { nada: 1 });
    await second.scheduler.start();
    await second.fire();
    expect([...second.store.jobs.values()][0]).toMatchObject({ status: 'failed' });
    expect(second.onDue).not.toHaveBeenCalled();
  });

  it('una pausa ya cogida por otro no se ejecuta dos veces; stop limpia los temporizadores', async () => {
    const { scheduler, store, onDue, timers } = setup();
    await scheduler.add(payload, 1);
    await store.claimJob(1); // otro proceso ya la cogió
    for (const timer of timers.splice(0)) timer.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDue).not.toHaveBeenCalled();
    expect(store.jobs.get(1)?.status).toBe('running');
    scheduler.stop();
  });
});
