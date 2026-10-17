import { describe, expect, it } from 'vitest';
import type { Funnel, FunnelCounts } from '../src/funnel.js';
import { metricsPage, parsePeriod, periodStart } from '../src/pages-metrics.js';

const counts = (overrides: Partial<FunnelCounts> = {}): FunnelCounts => ({
  key: 'r1',
  commented: 2,
  reached: 2,
  rejected: 0,
  planB: 0,
  rescued: 0,
  asked: 1,
  follows: 1,
  clicked: 1,
  wrote: 2,
  qualified: 0,
  ...overrides,
});

describe('metricsPage', () => {
  it('"Escribieron" se mide sobre a quién le llegó el DM (se puede escribir sin hacer clic): nunca pasa del 100 %', () => {
    // Caso real 2026-10-17 (reel "5 apps…"): 1 clic y 2 escribieron → salía "200 %".
    const funnel: Funnel = { total: counts({ key: 'TOTAL' }), byReel: [counts()], byDay: [] };
    const html = metricsPage(funnel, [], 'all');
    expect(html).not.toContain('200 %');
    expect(html).toContain('2 <small>(100 %)</small>');
  });

  it('sin datos lo dice', () => {
    const empty = counts({ key: 'TOTAL', commented: 0, reached: 0, asked: 0, follows: 0, clicked: 0, wrote: 0 });
    expect(metricsPage({ total: empty, byReel: [], byDay: [] }, [], 7)).toContain('Todavía no hay comentarios en este periodo');
  });
});

describe('periodo', () => {
  it('?dias=7 o 30; lo demás = todo', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('30')).toBe(30);
    expect(parsePeriod(undefined)).toBe('all');
    expect(parsePeriod('9999')).toBe('all');
  });

  it('inicio del periodo', () => {
    const now = new Date('2026-10-17T00:00:00Z');
    expect(periodStart(7, now).toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(periodStart('all', now).getTime()).toBe(0);
  });
});
