/**
 * Embudo (Fase 4, paso 1). Decisiones de Jose (2026-10-17):
 * - una fila por reel + TOTAL + la misma tabla por día; número y % sobre el paso anterior;
 * - quien comenta en 2 reels cuenta en los dos; el TOTAL y cada día cuentan personas únicas.
 * Función pura: la base de datos da, por persona y reel, qué pasos cumplió; aquí solo se suma.
 */

/** Qué pasos cumplió una persona que comentó en un reel. */
export interface FunnelPersonRow {
  readonly mediaId: string;
  readonly igId: string;
  /** Su primer comentario en ese reel (para agrupar por día). */
  readonly firstAt: Date;
  /** Le llegó el DM a algún comentario suyo en este reel. */
  readonly dmOk: boolean;
  /** Meta rechazó el DM a algún comentario suyo en este reel. */
  readonly dmFailed: boolean;
  /** Se publicó el plan B en algún comentario suyo de este reel. */
  readonly planB: boolean;
  // Lo siguiente es de la persona (no depende del reel).
  readonly rescued: boolean;
  readonly asked: boolean;
  readonly follows: boolean;
  readonly clicked: boolean;
  readonly wrote: boolean;
  readonly qualified: boolean;
}

export interface FunnelCounts {
  readonly key: string;
  readonly commented: number;
  /** Les llegó el DM (directo o rescatados por DM). */
  readonly reached: number;
  readonly rejected: number;
  readonly planB: number;
  readonly rescued: number;
  readonly asked: number;
  readonly follows: number;
  readonly clicked: number;
  readonly wrote: number;
  readonly qualified: number;
}

export interface Funnel {
  readonly total: FunnelCounts;
  readonly byReel: readonly FunnelCounts[];
  readonly byDay: readonly FunnelCounts[];
}

type Step = Exclude<keyof FunnelCounts, 'key' | 'commented'>;

/** Qué cuenta como cumplir cada paso. */
const STEPS: Readonly<Record<Step, (row: FunnelPersonRow) => boolean>> = {
  reached: (row) => row.dmOk || row.rescued,
  rejected: (row) => row.dmFailed,
  planB: (row) => row.planB,
  rescued: (row) => row.rescued,
  asked: (row) => row.asked,
  follows: (row) => row.follows,
  clicked: (row) => row.clicked,
  wrote: (row) => row.wrote,
  qualified: (row) => row.qualified,
};

/** Cuenta personas únicas: una persona cumple un paso si lo cumple en alguna de sus filas del grupo. */
function count(key: string, rows: readonly FunnelPersonRow[]): FunnelCounts {
  const people = new Set(rows.map((row) => row.igId));
  const steps = Object.fromEntries(
    (Object.keys(STEPS) as Step[]).map((step) => [step, new Set(rows.filter(STEPS[step]).map((row) => row.igId)).size]),
  ) as Record<Step, number>;
  return { key, commented: people.size, ...steps };
}

function groupBy(rows: readonly FunnelPersonRow[], keyOf: (row: FunnelPersonRow) => string): FunnelCounts[] {
  const groups = new Map<string, FunnelPersonRow[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return [...groups.entries()].map(([key, group]) => count(key, group));
}

export function buildFunnel(rows: readonly FunnelPersonRow[]): Funnel {
  return {
    total: count('TOTAL', rows),
    byReel: groupBy(rows, (row) => row.mediaId).sort((a, b) => b.commented - a.commented || a.key.localeCompare(b.key)),
    byDay: groupBy(rows, (row) => row.firstAt.toISOString().slice(0, 10)).sort((a, b) => b.key.localeCompare(a.key)),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_STEPS = Object.fromEntries(Object.keys(STEPS).map((step) => [step, 0])) as Record<Step, number>;

/** Para el gráfico por día (Fase 6.4): del más antiguo al más reciente, con 0 en los días sin comentarios. */
export function fillDays(days: readonly FunnelCounts[]): FunnelCounts[] {
  if (days.length === 0) return [];
  const byKey = new Map(days.map((day) => [day.key, day]));
  const keys = [...byKey.keys()].sort();
  const first = Date.parse(`${keys[0]}T00:00:00Z`);
  const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);
  const filled: FunnelCounts[] = [];
  for (let time = first; time <= last; time += DAY_MS) {
    const key = new Date(time).toISOString().slice(0, 10);
    filled.push(byKey.get(key) ?? { key, commented: 0, ...EMPTY_STEPS });
  }
  return filled;
}

/** Porcentaje redondeado; null si no hay base (no se divide entre cero). */
export function percent(part: number, base: number): number | null {
  return base > 0 ? Math.round((part / base) * 100) : null;
}
