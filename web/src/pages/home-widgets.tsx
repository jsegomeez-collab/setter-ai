import { ArrowRight, Bot, ChevronRight, Power, Workflow } from 'lucide-react';
import { Link } from 'react-router';
import { handle, timeAgo, type InboxItem } from '../conversations/types';
import type { FlowsResponse } from '../flows/types';
import { percent, type FunnelCounts } from '../metrics/types';
import type { SetterData } from '../setter/types';
import { Skeleton } from '../ui/EmptyState';
import { Avatar, STAGES, StageChip, stageMeta } from '../ui/visual';

/**
 * Piezas del Inicio (Fase 8.3, Jose: "Inicio y gráficos grandes"): estado del setter y de los flujos bien visible, el
 * embudo dibujado, los comentarios por día, los leads por etapa y la actividad reciente con fotos. Cada bloque lleva a
 * su pantalla. Gráficos según la skill dataviz: un solo tono para cantidades, cifras escritas al lado de cada barra.
 */

/** Pasos del embudo que se dibujan en el Inicio (el embudo completo está en Métricas). */
const FUNNEL_STEPS: readonly { key: keyof Omit<FunnelCounts, 'key'>; label: string }[] = [
  { key: 'commented', label: 'Comentaron' },
  { key: 'reached', label: 'Les llegó el DM' },
  { key: 'wrote', label: 'Escribieron por DM' },
  { key: 'qualified', label: 'Cualificados' },
];

/** Embudo de 4 pasos: barra proporcional, cifra y cuántos pasan del paso anterior. */
export function FunnelCard({ total }: { total: FunnelCounts | undefined }) {
  const base = Math.max(1, total?.commented ?? 0);
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-snow">Embudo</h3>
        <Link to="/metricas?days=7" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ember-400 hover:text-ember-300">
          Ver métricas <ArrowRight size={14} />
        </Link>
      </div>
      <ol className="mt-4 space-y-3">
        {FUNNEL_STEPS.map((step, index) => {
          const value = total?.[step.key];
          const previousKey = index > 0 ? FUNNEL_STEPS[index - 1]?.key : undefined;
          const previous = previousKey ? total?.[previousKey] : undefined;
          const share = value === undefined ? 0 : Math.max(2, Math.round((value / base) * 100));
          const pass = value !== undefined && previous !== undefined ? percent(value, previous) : null;
          return (
            <li key={step.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-mist">{step.label}</span>
                <span className="flex items-baseline gap-2">
                  {pass !== null && <span className="text-xs text-ash">{pass} % pasan</span>}
                  {value === undefined ? <Skeleton className="h-5 w-10" /> : <span className="font-display text-xl font-extrabold tabular-nums text-snow">{value}</span>}
                </span>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-ember-500 transition-[width] duration-300"
                  style={{ width: `${share}%`, opacity: 1 - index * 0.15 }}
                  title={value === undefined ? undefined : `${step.label}: ${value}`}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const WEEKDAY = new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' });

/** Comentarios por día: barras verticales con la cifra encima y el día debajo (fechas en UTC, como en Métricas). */
export function DailyChart({ days }: { days: readonly FunnelCounts[] | undefined }) {
  const max = Math.max(1, ...(days ?? []).map((d) => d.commented));
  return (
    <div className="card p-5">
      <h3 className="font-display text-lg font-bold text-snow">Comentarios por día</h3>
      {!days ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : (
        <div className="mt-4 flex h-44 items-end gap-2" role="img" aria-label={days.map((d) => `${dayLabel(d.key)}: ${d.commented}`).join(', ')}>
          {days.map((day) => (
            <div key={day.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${dayLabel(day.key)}: ${day.commented} comentarios`}>
              <span className="text-xs font-semibold tabular-nums text-mist">{day.commented}</span>
              <span className="w-full max-w-[44px] rounded-t-[4px] bg-ember-500" style={{ height: `${Math.max(2, (day.commented / max) * 100)}%` }} />
              <span className="text-xs capitalize text-smoke">{dayLabel(day.key)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? key : WEEKDAY.format(date).replace('.', '');
}

/** Leads por etapa (de la bandeja): barras con el color de cada etapa; lleva al tablero. */
export function StagesCard({ items }: { items: readonly InboxItem[] | null }) {
  const counts = new Map(STAGES.map((stage) => [stage.id, 0]));
  for (const item of items ?? []) {
    const id = stageMeta(item.stage).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-snow">Leads por etapa</h3>
        <Link to="/tablero" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ember-400 hover:text-ember-300">
          Ver tablero <ArrowRight size={14} />
        </Link>
      </div>
      {items === null ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {STAGES.map((stage) => {
            const n = counts.get(stage.id) ?? 0;
            return (
              <li key={stage.id} className="grid grid-cols-[120px_minmax(0,1fr)_32px] items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-mist">
                  <stage.icon size={14} className={stage.text} aria-hidden="true" />
                  {stage.label}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <span className={['block h-full rounded-full', stage.solid].join(' ')} style={{ width: `${n === 0 ? 0 : Math.max(3, (n / max) * 100)}%` }} />
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-fog">{n}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const RECENT_SHOWN = 6;

/** Últimas conversaciones con foto, etapa y su último mensaje; cada una abre la conversación. */
export function RecentActivity({ items }: { items: readonly InboxItem[] | null }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
        <h3 className="font-display text-lg font-bold text-snow">Actividad reciente</h3>
        <Link to="/conversaciones" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ember-400 hover:text-ember-300">
          Todas <ArrowRight size={14} />
        </Link>
      </div>
      {items === null ? (
        <div className="p-5">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 pb-5 pt-3 text-sm text-smoke">Todavía no ha escrito nadie.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.05]">
          {items.slice(0, RECENT_SHOWN).map((item) => (
            <li key={item.igId}>
              <Link to={`/conversaciones/${encodeURIComponent(item.igId)}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
                <Avatar name={item.username ?? item.igId} picture={item.picture} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={['truncate text-sm', item.unanswered ? 'font-semibold text-snow' : 'text-fog'].join(' ')}>{handle(item.username, item.igId)}</span>
                    {item.stage && <StageChip stage={item.stage} />}
                  </span>
                  <span className="block truncate text-xs text-ash">
                    {item.lastDirection === 'out' ? 'Tú: ' : ''}
                    {item.lastText}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-smoke">{timeAgo(item.lastAt)}</span>
                <ChevronRight size={16} className="shrink-0 text-smoke" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MODE: Readonly<Record<string, { label: string; tone: string; ring: string; dot: string }>> = {
  off: { label: 'Apagado', tone: 'text-smoke', ring: 'bg-white/[0.06]', dot: 'bg-smoke' },
  test: { label: 'Prueba', tone: 'text-warn', ring: 'bg-warn/15', dot: 'bg-warn' },
  live: { label: 'Público', tone: 'text-ok', ring: 'bg-ok/15', dot: 'bg-ok' },
};
const MODE_OFF = { label: 'Apagado', tone: 'text-smoke', ring: 'bg-white/[0.06]', dot: 'bg-smoke' };

/** Estado del setter y de los flujos, en grande: de un vistazo si está respondiendo y a quién. */
export function StatusHero({
  setter,
  flows,
  setterHint,
}: {
  setter: SetterData | null | undefined;
  flows: FlowsResponse | null | undefined;
  setterHint: (s: SetterData) => string;
}) {
  const mode = setter ? (MODE[setter.mode] ?? MODE_OFF) : MODE_OFF;
  const active = flows ? flows.flows.filter((flow) => flow.enabled).length : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Link to="/setter" className="card group flex min-w-0 items-center gap-4 p-5 transition-colors hover:border-white/15">
        <span className={['grid h-14 w-14 shrink-0 place-items-center rounded-2xl', mode.ring].join(' ')}>
          <Bot size={26} className={mode.tone} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-ash">Setter IA</span>
          {setter === undefined ? (
            <Skeleton className="mt-1 h-6 w-32" />
          ) : (
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={['h-2 w-2 rounded-full', mode.dot].join(' ')} />
              <span className="font-display text-xl font-extrabold text-snow">{setter ? `Modo ${mode.label}` : 'No disponible'}</span>
            </span>
          )}
          {setter && <span className="block truncate text-xs text-ash">{setterHint(setter)}</span>}
        </span>
        <ArrowRight size={16} className="text-smoke transition-transform group-hover:translate-x-0.5 group-hover:text-ember-400" aria-hidden="true" />
      </Link>
      <Link to="/flujos" className="card group flex min-w-0 items-center gap-4 p-5 transition-colors hover:border-white/15">
        <span className={['grid h-14 w-14 shrink-0 place-items-center rounded-2xl', active > 0 ? 'bg-ok/15' : 'bg-white/[0.06]'].join(' ')}>
          <Workflow size={26} className={active > 0 ? 'text-ok' : 'text-smoke'} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-ash">Flujos</span>
          {flows === undefined ? (
            <Skeleton className="mt-1 h-6 w-32" />
          ) : (
            <span className="flex items-center gap-2">
              <Power size={15} className={active > 0 ? 'text-ok' : 'text-smoke'} aria-hidden="true" />
              <span className="font-display text-xl font-extrabold text-snow">{flows ? `${active} de ${flows.flows.length} activos` : 'No disponible'}</span>
            </span>
          )}
          <span className="block truncate text-xs text-ash">Lo que pasa cuando alguien comenta un reel</span>
        </span>
        <ArrowRight size={16} className="text-smoke transition-transform group-hover:translate-x-0.5 group-hover:text-ember-400" aria-hidden="true" />
      </Link>
    </div>
  );
}
