import { Download, ExternalLink, Film, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { STAGE_LABEL, handle } from '../conversations/types';
import { api } from '../lib/api';
import { EmptyState, Skeleton } from '../ui/EmptyState';
import { Notice, Tabs, formatDate } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import type { ContactsResponse, ReelRow } from './types';

type TabId = 'personas' | 'reels';
/** Columnas de cada lista en escritorio (en el móvil cada fila es una tarjeta apilada). */
const PEOPLE_COLUMNS = 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_120px] md:gap-4';
const REEL_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_100px_90px_minmax(0,1fr)] md:gap-4';
const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'personas', label: 'Personas' },
  { value: 'reels', label: 'Por reel' },
];

/** Contactos (Fase 6.3): personas con filtros y exportación, y el resumen por reel. */
export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'reels' ? 'reels' : 'personas';
  return (
    <Page>
      <PageHeader
        title="Contactos"
        description="Quién ha comentado o escrito, de qué reel vino, qué etiquetas y qué datos tiene."
        actions={<Tabs tabs={TABS} value={tab} onChange={(value) => setParams({ tab: value })} />}
      />
      <div className="mt-6">{tab === 'personas' ? <People /> : <Reels />}</div>
    </Page>
  );
}

function People() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filters = { q: params.get('q') ?? '', tag: params.get('tag') ?? '', media: params.get('media') ?? '', stage: params.get('stage') ?? '' };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  useEffect(() => {
    api<ContactsResponse>(`/contacts?${qs}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [qs]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <form onSubmit={(e) => (e.preventDefault(), set('q', query))} className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
          <Search size={14} className="text-smoke" />
          <input aria-label="Buscar por usuario" className="w-full bg-transparent text-sm text-fog outline-none placeholder:text-smoke" placeholder="Buscar @usuario (Intro)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <Select label="Etiqueta" value={filters.tag} onChange={(v) => set('tag', v)} options={(data?.tags ?? []).map((t) => ({ value: t.tag, label: `${t.tag} (${t.n})` }))} />
        <Select label="Reel de origen" value={filters.media} onChange={(v) => set('media', v)} options={(data?.reels ?? []).map((r) => ({ value: r.mediaId, label: r.label }))} />
        <Select label="Etapa" value={filters.stage} onChange={(v) => set('stage', v)} options={Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label }))} />
        {user?.role === 'admin' && (
          <a href={`/api/contacts/export.csv?${qs}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[13px] font-semibold text-mist hover:text-fog">
            <Download size={14} /> Exportar CSV
          </a>
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {data && (
        <p className="text-xs text-smoke">
          {data.total} contacto(s){data.total > data.items.length ? ` · se muestran los ${data.items.length} más recientes` : ''}
        </p>
      )}
      {!data && !error && <Skeleton className="h-48 w-full" />}
      {data?.items.length === 0 && (
        <EmptyState icon={Users} title="Nadie con estos filtros">
          Prueba a quitar algún filtro o a buscar otro usuario.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
      <ul className="card divide-y divide-white/[0.05]">
        <li aria-hidden className={`hidden px-4 py-2 text-xs font-semibold text-smoke md:grid ${PEOPLE_COLUMNS}`}>
          <span>Persona</span>
          <span>Reel de origen</span>
          <span>Etapa y etiquetas</span>
          <span className="text-right">Última vez</span>
        </li>
        {data?.items.map((c) => (
          <li key={c.igId}>
            <Link to={`/contactos/${encodeURIComponent(c.igId)}`} className={`grid gap-1 px-4 py-3 transition-colors hover:bg-white/[0.03] md:items-center ${PEOPLE_COLUMNS}`}>
              <span className="truncate text-sm font-semibold text-fog">{handle(c.username, c.igId)}</span>
              <span className="truncate text-xs text-ash">{c.sourceLabel ?? 'Sin reel de origen'}</span>
              <span className="flex flex-wrap gap-1">
                {c.stage && <span className="rounded bg-ember-500/12 px-1.5 py-0.5 text-xs font-semibold text-ember-400">{STAGE_LABEL[c.stage] ?? c.stage}</span>}
                {c.tags.map((tag) => (
                  <span key={tag} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-ash">
                    {tag}
                  </span>
                ))}
              </span>
              <span className="text-xs text-smoke md:text-right">{formatDate(c.lastSeen)}</span>
            </Link>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[220px] rounded-lg border border-white/8 bg-g2 px-2.5 py-2 text-[13px] text-mist outline-none">
      <option value="">{label}: todas</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Reels() {
  const [reels, setReels] = useState<readonly ReelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ reels: ReelRow[] }>('/contacts/reels')
      .then((r) => setReels(r.reels))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!reels) return <Skeleton className="h-48 w-full" />;
  if (reels.length === 0) {
    return (
      <EmptyState icon={Film} title="Todavía no hay comentarios en reels">
        Cuando alguien comente un reel, aparecerá aquí con cuántas personas vinieron de él.
      </EmptyState>
    );
  }
  return (
    <ul className="card divide-y divide-white/[0.05]">
      <li aria-hidden className={`hidden px-4 py-2 text-xs font-semibold text-smoke md:grid ${REEL_COLUMNS}`}>
        <span>Reel</span>
        <span>Comentarios</span>
        <span>Personas</span>
        <span>Etiquetas de quien vino de él</span>
      </li>
      {reels.map((r) => (
        <li key={r.mediaId} className={`grid gap-2 px-4 py-3 md:items-center ${REEL_COLUMNS}`}>
          <span className="flex min-w-0 items-center gap-2 text-sm text-fog">
            <span className="truncate">{r.label}</span>
            {r.permalink && (
              <a href={r.permalink} target="_blank" rel="noopener noreferrer" aria-label="Abrir el reel en Instagram" className="shrink-0 text-smoke hover:text-ember-400">
                <ExternalLink size={13} />
              </a>
            )}
          </span>
          <span className="text-xs text-ash">
            {r.comments}
            <span className="md:hidden"> comentarios</span>
          </span>
          <span className="text-xs text-ash">
            {r.people}
            <span className="md:hidden"> personas</span>
          </span>
          <span className="flex flex-wrap gap-1">
            {Object.entries(r.tagged).map(([tag, n]) => (
              <Link key={tag} to={`/contactos?tag=${encodeURIComponent(tag)}&media=${encodeURIComponent(r.mediaId)}`} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-ash hover:text-fog">
                {tag}: {n}
              </Link>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
