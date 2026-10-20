import { ArrowRight, BellRing, Bot, FilePen, MessageCircleWarning, PauseCircle, Workflow, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { FirstSteps } from './FirstSteps';
import type { InboxResponse } from '../conversations/types';
import { api } from '../lib/api';
import type { FlowsResponse } from '../flows/types';
import type { MetricsResponse } from '../metrics/types';
import { percent } from '../metrics/types';
import type { SetterData } from '../setter/types';
import { navFor } from '../shell/nav';
import { Skeleton } from '../ui/EmptyState';
import { Notice, blockedUntilText, formatDate } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';

/**
 * Inicio (Fase 7.1): lo que hay que hacer hoy (conversaciones sin responder, borradores, IA parada), cómo va el embudo
 * de los últimos 7 días y, para el admin, el estado del setter y de los flujos. Cada cifra lleva a su pantalla.
 */

function greeting(hour: number): string {
  if (hour < 6 || hour >= 20) return 'Buenas noches';
  if (hour < 13) return 'Buenos días';
  return 'Buenas tardes';
}

/** Modos del setter tal y como se guardan (SETTINGS.setterMode: off · test · live). */
const MODE_LABEL: Readonly<Record<string, string>> = { off: 'Apagado', test: 'Prueba', live: 'Público' };
/** Avisos de flujos que caben en el Inicio (el resto, en el registro de Configuración). */
const NOTICES_SHOWN = 5;

/** Aviso que deja un flujo con el paso "Avisar a Jose" (Fase 7.3a, GET /api/flows/notices). */
interface Notice {
  readonly createdAt: string;
  readonly text: string;
  readonly igId: string | null;
  readonly username: string | null;
  readonly flowName: string | null;
}

interface AdminInfo {
  readonly setter: SetterData | null;
  readonly flows: FlowsResponse | null;
  readonly notices: readonly Notice[];
}

export function HomePage() {
  const { user, workspace } = useSession();
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar');
    api<InboxResponse>('/conversations').then(setInbox).catch(fail);
    api<MetricsResponse>('/metrics?days=7').then(setMetrics).catch(fail);
    if (isAdmin) {
      Promise.all([
        api<SetterData>('/setter').catch(() => null),
        api<FlowsResponse>('/flows').catch(() => null),
        api<{ notices: Notice[] }>('/flows/notices').catch(() => ({ notices: [] })),
      ]).then(([setter, flows, { notices }]) => setAdmin({ setter, flows, notices }));
    }
  }, [isAdmin]);

  if (!user) return null;
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const items = inbox?.items ?? [];
  const count = (test: (item: (typeof items)[number]) => boolean) => (inbox ? items.filter(test).length : null);
  const total = metrics?.funnel.total;

  return (
    <Page>
      <PageHeader
        title={`${greeting(new Date().getHours())}, ${firstName}`}
        description={new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
      />

      <div className="mt-6 space-y-8">
        {error && <Notice tone="bad">{error}</Notice>}
        {/* Cliente nuevo (7.5f): lo que le falta, con un botón a cada sitio. Solo su dueño (el equipo no toca el setter). */}
        {isAdmin && workspace && <FirstSteps />}
        {inbox?.sendsBlocked && (
          <Notice tone="warn">
            Envíos bloqueados {blockedUntilText(inbox.sendsBlocked.until)}
            {inbox.sendsBlocked.reason ? ` · ${inbox.sendsBlocked.reason.replace(/\.+$/, '')}` : ''}. No sale nada a Instagram hasta entonces.
          </Notice>
        )}

        <section aria-labelledby="hoy">
          <h2 id="hoy" className="label">
            Para hoy
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <ActionTile icon={MessageCircleWarning} label="Sin responder" value={count((i) => i.unanswered)} to="/conversaciones?filtro=unanswered" hint="Personas esperando respuesta" />
            <ActionTile icon={FilePen} label="Borradores" value={count((i) => i.hasDraft)} to="/conversaciones?filtro=draft" hint="Respuestas de la IA por aprobar" />
            <ActionTile icon={PauseCircle} label="IA parada" value={count((i) => i.aiPaused)} to="/conversaciones?filtro=paused" hint="Conversaciones en manos de una persona" />
          </div>
        </section>

        {admin && admin.notices.length > 0 && <NoticesList notices={admin.notices} />}

        <section aria-labelledby="embudo">
          <div className="flex items-end justify-between gap-3">
            <h2 id="embudo" className="label">
              Últimos 7 días
            </h2>
            <Link to="/metricas?days=7" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ember-400 hover:text-ember-300">
              Ver métricas <ArrowRight size={14} />
            </Link>
          </div>
          <div className="card mt-3 overflow-hidden">
            <div className="grid grid-cols-2 divide-white/[0.06] sm:grid-cols-4 sm:divide-x">
              <Kpi label="Comentaron" value={total?.commented} />
              <Kpi label="Les llegó el DM" value={total?.reached} note={total ? pct(total.reached, total.commented) : undefined} />
              <Kpi label="Escribieron por DM" value={total?.wrote} note={total ? pct(total.wrote, total.reached) : undefined} />
              <Kpi label="Cualificados" value={total?.qualified} note={total ? pct(total.qualified, total.wrote) : undefined} />
            </div>
            {metrics && metrics.funnel.byDay.length > 1 && (
              <div className="border-t border-white/[0.06] px-4 pb-3 pt-3">
                <p className="text-xs font-semibold text-ash">Comentarios por día</p>
                <Sparkline values={metrics.funnel.byDay.map((d) => d.commented)} />
              </div>
            )}
          </div>
        </section>

        {isAdmin && (
          <section aria-labelledby="estado">
            <h2 id="estado" className="label">
              Estado
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatusTile
                icon={Bot}
                to="/setter"
                title="Setter IA"
                value={admin ? (admin.setter ? (MODE_LABEL[admin.setter.mode] ?? admin.setter.mode) : 'No disponible') : null}
                hint={admin?.setter ? setterHint(admin.setter) : undefined}
              />
              <StatusTile
                icon={Workflow}
                to="/flujos"
                title="Flujos"
                value={admin ? (admin.flows ? `${admin.flows.flows.filter((f) => f.enabled).length} de ${admin.flows.flows.length} activos` : 'No disponible') : null}
                hint="Lo que pasa cuando alguien comenta un reel"
              />
            </div>
          </section>
        )}

        <section aria-labelledby="ir">
          <h2 id="ir" className="label">
            Ir a
          </h2>
          <nav className="mt-3 flex flex-wrap gap-2">
            {navFor(user.role)
              .filter((item) => item.path !== '/')
              .map(({ path, label, icon: Icon }) => (
                <Link key={path} to={path} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.03] px-3.5 text-sm font-semibold text-mist transition-colors hover:border-white/20 hover:text-fog">
                  <Icon size={16} className="text-ember-400" aria-hidden /> {label}
                </Link>
              ))}
          </nav>
        </section>
      </div>
    </Page>
  );
}

/** Una línea de qué hace ahora el setter (antes, apagado decía "Responde solo"). */
function setterHint(setter: SetterData): string {
  if (setter.mode === 'off') return 'Guarda los mensajes pero no responde a nadie';
  if (setter.mode === 'test') return `Solo responde a ${setter.testUsernames.map((u) => `@${u}`).join(', ') || 'nadie'}`;
  return setter.draft ? 'Modo borrador: tú apruebas cada respuesta' : 'Responde solo';
}

const pct = (part: number, base: number): string | undefined => {
  const value = percent(part, base);
  return value === null ? undefined : `${value} %`;
};

function ActionTile({ icon: Icon, label, value, to, hint }: { icon: LucideIcon; label: string; value: number | null; to: string; hint: string }) {
  const pending = (value ?? 0) > 0;
  return (
    <Link to={to} className={['card group flex items-center gap-4 p-4 transition-colors hover:border-white/15', pending ? 'border-ember-500/35' : ''].join(' ')}>
      <span className={['grid h-11 w-11 shrink-0 place-items-center rounded-xl', pending ? 'bg-ember-500/15 text-ember-400' : 'bg-white/[0.04] text-smoke'].join(' ')}>
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fog">{label}</span>
        <span className="block truncate text-xs text-ash">{hint}</span>
      </span>
      {value === null ? <Skeleton className="h-7 w-8" /> : <span className={['font-display text-[28px] font-extrabold tabular-nums', pending ? 'text-snow' : 'text-smoke'].join(' ')}>{value}</span>}
    </Link>
  );
}

/** Los últimos avisos de los flujos; cada uno lleva a la conversación de esa persona. */
function NoticesList({ notices }: { notices: readonly Notice[] }) {
  return (
    <section aria-labelledby="avisos">
      <h2 id="avisos" className="label">
        Avisos de tus flujos
      </h2>
      <ul className="card mt-3 divide-y divide-white/[0.06]">
        {notices.slice(0, NOTICES_SHOWN).map((notice) => (
          <li key={`${notice.createdAt}-${notice.igId ?? ''}`}>
            <Link
              to={notice.igId ? `/conversaciones/${encodeURIComponent(notice.igId)}` : '/conversaciones'}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
            >
              <BellRing size={16} className="mt-0.5 shrink-0 text-ember-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-fog">{notice.text}</span>
                <span className="block truncate text-xs text-ash">
                  {notice.username ? `@${notice.username}` : 'Persona sin usuario conocido'}
                  {notice.flowName ? ` · ${notice.flowName}` : ''} · {formatDate(notice.createdAt)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Kpi({ label, value, note }: { label: string; value: number | undefined; note?: string }) {
  return (
    <div className="p-4">
      <p className="text-xs font-semibold text-ash">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 font-display text-[28px] font-extrabold tabular-nums text-snow">{value}</p>}
      {note && <p className="text-xs text-ash">{note}</p>}
    </div>
  );
}

function StatusTile({ icon: Icon, to, title, value, hint }: { icon: LucideIcon; to: string; title: string; value: string | null; hint?: string }) {
  return (
    <Link to={to} className="card group flex items-center gap-4 p-4 transition-colors hover:border-white/15">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-ember-400">
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-ash">{title}</span>
        {value === null ? <Skeleton className="mt-1 h-5 w-32" /> : <span className="block text-base font-semibold text-fog">{value}</span>}
        {hint && <span className="block truncate text-xs text-ash">{hint}</span>}
      </span>
      <ArrowRight size={16} className="text-smoke transition-transform group-hover:translate-x-0.5 group-hover:text-ember-400" aria-hidden />
    </Link>
  );
}

/** Comentarios por día (7 días): una línea dorada fina; el detalle está en Métricas. */
function Sparkline({ values }: { values: readonly number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="mt-2 h-10 w-full" role="img" aria-label={`Comentarios por día: ${values.join(', ')}`}>
      <polyline points={points} fill="none" stroke="#b98c2c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
