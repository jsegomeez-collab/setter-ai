/** Lo que devuelve la API de Métricas (src/routes-api-metrics.ts). */

export interface FunnelCounts {
  readonly key: string;
  readonly commented: number;
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

export type Period = 7 | 30 | 'all';
export type StepKey = Exclude<keyof FunnelCounts, 'key'>;

export interface MetricsResponse {
  readonly period: Period;
  readonly funnel: {
    readonly total: FunnelCounts;
    readonly byReel: readonly (FunnelCounts & { readonly label: string; readonly permalink: string | null; readonly cover: string | null })[];
    /** Del más antiguo al más reciente, con 0 en los días sin comentarios. */
    readonly byDay: readonly FunnelCounts[];
  };
  readonly setter: {
    readonly stages: readonly { readonly step: string; readonly n: number }[];
    readonly transitions: readonly { readonly from: string; readonly to: string; readonly n: number }[];
  };
  readonly agenda: { readonly offered: number; readonly clicked: number };
}

/** Pasos y sobre qué paso se calcula su % (los mismos que la tabla del panel antiguo, src/pages-metrics.ts). */
export const STEP: Readonly<Record<StepKey, { readonly title: string; readonly base?: StepKey }>> = {
  commented: { title: 'Comentaron' },
  reached: { title: 'Les llegó el DM', base: 'commented' },
  rejected: { title: 'DM rechazado', base: 'commented' },
  planB: { title: 'Plan B', base: 'rejected' },
  rescued: { title: 'Rescatados por DM', base: 'rejected' },
  asked: { title: 'Pidieron el recurso', base: 'reached' },
  follows: { title: 'Siguen', base: 'asked' },
  clicked: { title: 'Clic en el recurso', base: 'follows' },
  // Se puede escribir sin hacer clic: se mide sobre a quién le llegó el DM (si no, pasaba del 100 %).
  wrote: { title: 'Escribieron por DM', base: 'reached' },
  qualified: { title: 'Cualificados', base: 'wrote' },
};

/** El camino principal del embudo, en orden. Rechazados, plan B y rescatados van aparte. */
export const MAIN_PATH: readonly StepKey[] = ['commented', 'reached', 'asked', 'follows', 'clicked', 'wrote', 'qualified'];
export const DM_FAILURES: readonly StepKey[] = ['rejected', 'planB', 'rescued'];

/** Colores de las series, validados con el script de la skill dataviz sobre #121214 (tema oscuro): todo pasa. */
export const SERIES = { first: '#b98c2c', second: '#3987e5' } as const;

export const percent = (part: number, base: number): number | null => (base > 0 ? Math.round((part / base) * 100) : null);
