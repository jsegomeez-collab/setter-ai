import { percent, type Funnel, type FunnelCounts } from './funnel.js';
import type { Media } from './meta/client.js';
import { escapeHtml, layout, reelName } from './pages.js';

/** Página /metricas (Fase 4, paso 1): el embudo por reel, total y por día. Provisional hasta el frontend de la Fase 6. */

export type MetricsPeriod = 7 | 30 | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

/** ?dias=7 o ?dias=30; cualquier otra cosa = todo. */
export function parsePeriod(raw: string | undefined): MetricsPeriod {
  return raw === '7' ? 7 : raw === '30' ? 30 : 'all';
}

export function periodStart(period: MetricsPeriod, now: Date = new Date()): Date {
  return period === 'all' ? new Date(0) : new Date(now.getTime() - period * DAY_MS);
}

/** Columnas en orden. `base` = paso sobre el que se calcula el %. */
const COLUMNS: readonly { key: Exclude<keyof FunnelCounts, 'key'>; title: string; base?: Exclude<keyof FunnelCounts, 'key'> }[] = [
  { key: 'commented', title: 'Comentaron' },
  { key: 'reached', title: 'Les llegó el DM', base: 'commented' },
  { key: 'rejected', title: 'DM rechazado', base: 'commented' },
  { key: 'planB', title: 'Plan B', base: 'rejected' },
  { key: 'rescued', title: 'Rescatados por DM', base: 'rejected' },
  { key: 'asked', title: 'Pidieron el recurso', base: 'reached' },
  { key: 'follows', title: 'Siguen', base: 'asked' },
  { key: 'clicked', title: 'Clic en el recurso', base: 'follows' },
  { key: 'wrote', title: 'Escribieron por DM', base: 'clicked' },
  { key: 'qualified', title: 'Cualificados', base: 'wrote' },
];

function cell(row: FunnelCounts, column: (typeof COLUMNS)[number]): string {
  const value = row[column.key];
  const pct = column.base ? percent(value, row[column.base]) : null;
  return `<td>${value}${pct === null ? '' : ` <small>(${pct} %)</small>`}</td>`;
}

function table(firstHeader: string, rows: readonly FunnelCounts[], total: FunnelCounts, label: (key: string) => string): string {
  const head = `<tr><th>${firstHeader}</th>${COLUMNS.map((column) => `<th>${column.title}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr><td>${label(row.key)}</td>${COLUMNS.map((column) => cell(row, column)).join('')}</tr>`).join('');
  const totalRow = `<tr><td><strong>TOTAL</strong></td>${COLUMNS.map((column) => cell(total, column)).join('')}</tr>`;
  const empty = `<tr><td colspan="${COLUMNS.length + 1}">Todavía no hay comentarios en este periodo.</td></tr>`;
  return `<table>${head}${rows.length ? body + totalRow : empty}</table>`;
}

function periodLinks(period: MetricsPeriod): string {
  const link = (value: MetricsPeriod, text: string) =>
    value === period ? `<strong>${text}</strong>` : `<a href="/metricas${value === 'all' ? '' : `?dias=${value}`}">${text}</a>`;
  return `<p>Periodo: ${link('all', 'Todo')} · ${link(7, '7 días')} · ${link(30, '30 días')}</p>`;
}

export function metricsPage(funnel: Funnel, media: readonly Media[], period: MetricsPeriod): string {
  const periodText = period === 'all' ? 'todo' : `últimos ${period} días`;
  return layout(
    'Métricas',
    `<h1>Métricas</h1>
<h2>Embudo por reel</h2>${periodLinks(period)}
<p><small>Periodo: ${escapeHtml(periodText)} (según la fecha del comentario). Número de personas y, entre paréntesis, % sobre el paso del que sale.
Quien comenta en 2 reels cuenta en los dos; el TOTAL cuenta personas únicas.</small></p>
${table('Reel', funnel.byReel, funnel.total, (key) => reelName(media, key))}
<h2>Por día</h2>
${table('Día (UTC)', funnel.byDay, funnel.total, escapeHtml)}
<h3>Cómo se cuenta</h3>
<ul>
<li><strong>Les llegó el DM</strong>: Meta aceptó el DM a su comentario (con botón o, de respaldo, como texto) o se le rescató después por DM.</li>
<li><strong>DM rechazado</strong>: Meta rechazó el DM a algún comentario suyo. <strong>Plan B</strong> y <strong>Rescatados</strong> salen de ahí.</li>
<li><strong>Pidieron el recurso</strong>: pulsaron el botón o escribieron "sí". <strong>Siguen</strong>: Meta dijo que siguen la cuenta.</li>
<li><strong>Clic en el recurso</strong>: abrieron un enlace con seguimiento. <strong>Escribieron por DM</strong>: mandaron algún mensaje.</li>
<li><strong>Cualificados</strong>: el setter IA dejó la ficha en "agendar llamada". Con el setter en modo prueba saldrá casi a 0.</li>
<li>Pidieron, siguen, clic, escribieron y cualificados son de la persona (no de un reel concreto).</li>
<li><strong>Llamadas</strong>: todavía no se miden (Fase 5).</li>
</ul>`,
  );
}
