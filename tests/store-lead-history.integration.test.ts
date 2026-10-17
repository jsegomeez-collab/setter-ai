import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresStore, type Store } from '../src/store.js';

/**
 * Historial de la ficha (Fase 4, paso 2) contra un Postgres real (PGlite).
 * Base de datos propia: antes de arrancar se deja una ficha "antigua" sin historial, como está producción hoy.
 */

const PORT = 54330;
let db: PGlite;
let server: PGLiteSocketServer;
let store: Store & { close(): Promise<void> };

beforeAll(async () => {
  db = await PGlite.create();
  // Como producción antes de este cambio: contacto con ficha y sin tabla de historial.
  await db.exec(`
    CREATE TABLE contacts (ig_id TEXT PRIMARY KEY, username TEXT, tags TEXT[] NOT NULL DEFAULT '{}',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now());
    ALTER TABLE contacts ADD COLUMN lead JSONB;
    ALTER TABLE contacts ADD COLUMN lead_updated_at TIMESTAMPTZ;
    INSERT INTO contacts (ig_id, lead, lead_updated_at) VALUES ('antiguo', '{"siguiente_paso":"seguir_calificando","nivel":"nivel_1"}', '2026-10-16T18:29:00Z');
  `);
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  store = await createPostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { ssl: false, maxConnections: 1 });
}, 60_000);

afterAll(async () => {
  await store?.close();
  await server?.stop();
  await db?.close();
});

const lead = (siguiente_paso: string, extra: Record<string, unknown> = {}) => ({ siguiente_paso, nivel: 'nivel_1', resumen: 'r', ...extra });

describe('historial de la ficha (Postgres real)', () => {
  it('al arrancar, la ficha que ya existía pasa a ser el primer punto del historial (con su fecha)', async () => {
    const history = await store.listLeadHistory('antiguo', 50);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ lead: { siguiente_paso: 'seguir_calificando' } });
    expect(history[0]?.createdAt.toISOString()).toBe('2026-10-16T18:29:00.000Z');
  });

  it('reiniciar no la vuelve a copiar (idempotente)', async () => {
    await store.close();
    store = await createPostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { ssl: false, maxConnections: 1 });
    expect(await store.listLeadHistory('antiguo', 50)).toHaveLength(1);
  });

  it('guarda una fila solo cuando la ficha cambia, de la más antigua a la más nueva', async () => {
    await store.saveLead('p1', lead('seguir_calificando'));
    await store.saveLead('p1', lead('seguir_calificando')); // igual → no se repite
    await store.saveLead('p1', lead('agendar_llamada'));
    const history = await store.listLeadHistory('p1', 50);
    expect(history.map((h) => (h.lead as { siguiente_paso: string }).siguiente_paso)).toEqual(['seguir_calificando', 'agendar_llamada']);
    expect((await store.getContact('p1'))?.lead).toMatchObject({ siguiente_paso: 'agendar_llamada' });
  });

  it('el límite devuelve las más recientes', async () => {
    await store.saveLead('p2', lead('seguir_calificando', { resumen: '1' }));
    await store.saveLead('p2', lead('seguir_calificando', { resumen: '2' }));
    await store.saveLead('p2', lead('seguir_calificando', { resumen: '3' }));
    const last2 = await store.listLeadHistory('p2', 2);
    expect(last2.map((h) => (h.lead as { resumen: string }).resumen)).toEqual(['2', '3']);
  });

  it('etapas del setter: conversaciones en cada etapa y cambios de etapa (de → a)', async () => {
    await store.saveLead('p3', lead('seguir_calificando'));
    await store.saveLead('p3', lead('ofrecer_membresia'));
    const stats = await store.setterStageStats();
    // Etapa actual: antiguo y p2 → seguir_calificando; p1 → agendar_llamada; p3 → ofrecer_membresia.
    expect(Object.fromEntries(stats.stages.map((s) => [s.step, s.n]))).toEqual({ seguir_calificando: 2, agendar_llamada: 1, ofrecer_membresia: 1 });
    // Cambios: p1 seguir → agendar; p3 seguir → membresía. Los cambios de resumen (p2) no son cambio de etapa.
    expect(stats.transitions).toEqual(
      expect.arrayContaining([
        { from: 'seguir_calificando', to: 'agendar_llamada', n: 1 },
        { from: 'seguir_calificando', to: 'ofrecer_membresia', n: 1 },
      ]),
    );
    expect(stats.transitions).toHaveLength(2);
  });
});
