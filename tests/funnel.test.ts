import { describe, expect, it } from 'vitest';
import { buildFunnel, fillDays, percent, type FunnelPersonRow } from '../src/funnel.js';

/** Embudo (Fase 4, paso 1). Decisiones de Jose 2026-10-17: tabla por reel + total + por día; quien comenta en 2 reels cuenta en los dos. */

const NO: Omit<FunnelPersonRow, 'mediaId' | 'igId' | 'firstAt'> = {
  dmOk: false,
  dmFailed: false,
  planB: false,
  rescued: false,
  asked: false,
  follows: false,
  clicked: false,
  wrote: false,
  qualified: false,
};

const row = (mediaId: string, igId: string, day: string, flags: Partial<FunnelPersonRow> = {}): FunnelPersonRow => ({
  ...NO,
  mediaId,
  igId,
  firstAt: new Date(`${day}T12:00:00Z`),
  ...flags,
});

describe('buildFunnel', () => {
  it('sin datos → todo a cero', () => {
    const funnel = buildFunnel([]);
    expect(funnel.total).toMatchObject({ commented: 0, reached: 0, asked: 0 });
    expect(funnel.byReel).toEqual([]);
    expect(funnel.byDay).toEqual([]);
  });

  it('suma cada paso por reel', () => {
    const funnel = buildFunnel([
      row('r1', 'a', '2026-10-16', { dmOk: true, asked: true, follows: true, clicked: true, wrote: true }),
      row('r1', 'b', '2026-10-16', { dmFailed: true, planB: true }),
      row('r1', 'c', '2026-10-16', { dmOk: true }),
    ]);
    expect(funnel.byReel[0]).toMatchObject({ key: 'r1', commented: 3, reached: 2, rejected: 1, planB: 1, rescued: 0, asked: 1, follows: 1, clicked: 1, wrote: 1, qualified: 0 });
  });

  it('a los rescatados por DM también les llegó el DM', () => {
    const funnel = buildFunnel([row('r1', 'a', '2026-10-16', { dmFailed: true, rescued: true })]);
    expect(funnel.byReel[0]).toMatchObject({ reached: 1, rejected: 1, rescued: 1 });
  });

  it('quien comenta en 2 reels cuenta en los dos, pero una sola vez en el total', () => {
    const funnel = buildFunnel([row('r1', 'a', '2026-10-16', { dmOk: true }), row('r2', 'a', '2026-10-16', { dmOk: true }), row('r2', 'b', '2026-10-16')]);
    expect(funnel.byReel.map((r) => [r.key, r.commented])).toEqual([
      ['r2', 2],
      ['r1', 1],
    ]);
    expect(funnel.total).toMatchObject({ commented: 2, reached: 1 });
  });

  it('por día: según el día de su comentario, personas únicas por día, del más reciente al más antiguo', () => {
    const funnel = buildFunnel([row('r1', 'a', '2026-10-16'), row('r2', 'a', '2026-10-16'), row('r1', 'b', '2026-10-17', { dmOk: true })]);
    expect(funnel.byDay.map((d) => [d.key, d.commented, d.reached])).toEqual([
      ['2026-10-17', 1, 1],
      ['2026-10-16', 1, 0],
    ]);
  });
});

describe('fillDays (gráfico por día, Fase 6.4)', () => {
  const day = (key: string, commented: number) => ({ key, commented, reached: commented, rejected: 0, planB: 0, rescued: 0, asked: 0, follows: 0, clicked: 0, wrote: 0, qualified: 0 });

  it('ordena del más antiguo al más reciente y rellena con 0 los días sin actividad', () => {
    const filled = fillDays([day('2026-10-18', 5), day('2026-10-15', 2)]);
    expect(filled.map((d) => [d.key, d.commented])).toEqual([
      ['2026-10-15', 2],
      ['2026-10-16', 0],
      ['2026-10-17', 0],
      ['2026-10-18', 5],
    ]);
  });

  it('sin días → vacío; un solo día → ese día', () => {
    expect(fillDays([])).toEqual([]);
    expect(fillDays([day('2026-10-18', 1)]).map((d) => d.key)).toEqual(['2026-10-18']);
  });
});

describe('percent', () => {
  it('redondea y no divide entre cero', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 5)).toBe(0);
    expect(percent(3, 0)).toBeNull();
  });
});
