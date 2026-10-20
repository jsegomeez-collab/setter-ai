import { BellRing, FilePen, MessageCircleWarning, PauseCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { FirstSteps } from './FirstSteps';
import { DailyChart, FunnelCard, RecentActivity, StagesCard, StatusHero } from './home-widgets';
import type { InboxResponse } from '../conversations/types';
import { api } from '../lib/api';
import type { FlowsResponse } from '../flows/types';
import type { MetricsResponse } from '../metrics/types';
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

        {/* Fase 8.3: estado del setter y de los flujos en grande, arriba del todo. */}
        {isAdmin && <StatusHero setter={admin ? admin.setter : undefined} flows={admin ? admin.flows : undefined} setterHint={setterHint} />}

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
          <h2 id="embudo" className="label">
            Últimos 7 días
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <FunnelCard total={metrics?.funnel.total} />
            <DailyChart days={metrics?.funnel.byDay} />
          </div>
        </section>

        <section aria-labelledby="leads">
          <h2 id="leads" className="label">
            Tus leads
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <StagesCard items={inbox ? inbox.items : null} />
            <RecentActivity items={inbox ? inbox.items : null} />
          </div>
        </section>

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
