import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { InboxItem, InboxResponse } from '../conversations/types';
import { handle, timeAgo } from '../conversations/types';
import { api } from '../lib/api';
import { Loading } from '../ui/EmptyState';
import { Notice } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { Avatar, STAGES, stageMeta, type StageId, type StageMeta } from '../ui/visual';

/**
 * Tablero de leads (Fase 8.4, pedido por Jose): una columna por etapa (la pone la IA en la ficha) con una tarjeta por
 * persona. De un vistazo: cuántos hay en cada punto y quién espera respuesta. Pulsar una tarjeta abre su conversación.
 * Solo para mirar: la etapa la decide la IA, no se arrastra.
 */

interface Column {
  readonly stage: StageMeta;
  readonly items: readonly InboxItem[];
}

export function BoardPage() {
  const [items, setItems] = useState<readonly InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hideDiscarded, setHideDiscarded] = useState(true);

  useEffect(() => {
    api<InboxResponse>('/conversations')
      .then((data) => setItems(data.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, []);

  const columns = useMemo((): Column[] => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const visible = (items ?? []).filter((item) => !q || (item.username ?? '').toLowerCase().includes(q) || item.igId.includes(q));
    const byStage = new Map<StageId, InboxItem[]>(STAGES.map((stage) => [stage.id, []]));
    for (const item of visible) byStage.get(stageMeta(item.stage).id)?.push(item);
    return STAGES.filter((stage) => !(hideDiscarded && stage.id === 'descartar')).map((stage) => ({ stage, items: byStage.get(stage.id) ?? [] }));
  }, [items, query, hideDiscarded]);

  return (
    <Page width="full">
      <PageHeader title="Tablero de leads" description="Cada persona en su etapa. Pulsa una tarjeta para abrir su conversación." />
      <div className="mt-6 space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 sm:max-w-sm">
            <Search size={14} className="text-smoke" aria-hidden="true" />
            <input aria-label="Buscar por usuario" className="w-full bg-transparent text-sm text-fog outline-none placeholder:text-smoke" placeholder="Buscar @usuario" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="flex min-h-[40px] items-center gap-2 text-sm text-mist">
            <input type="checkbox" className="h-4 w-4 accent-[#d4a53a]" checked={hideDiscarded} onChange={(e) => setHideDiscarded(e.target.checked)} />
            Ocultar descartados
          </label>
        </div>
        {items === null && !error && <Loading rows={4} />}
        {items !== null && <StageBar columns={columns} />}
        {items !== null && (
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3" role="list" aria-label="Columnas por etapa">
            {columns.map(({ stage, items: cards }) => (
              <section key={stage.id} role="listitem" aria-label={`${stage.label}: ${cards.length}`} className="flex min-w-[210px] flex-1 basis-0 snap-start flex-col rounded-xl border border-white/[0.06] bg-g1">
                <header className="border-b border-white/[0.06] px-3 pb-2.5 pt-3">
                  <span aria-hidden="true" className={['mb-2.5 block h-1 rounded-full', stage.solid].join(' ')} />
                  <div className="flex items-center gap-2">
                    <stage.icon size={15} className={stage.text} aria-hidden="true" />
                    <h2 className="flex-1 font-display text-[15px] font-bold text-snow">{stage.label}</h2>
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-bold tabular-nums text-fog">{cards.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-smoke">{stage.hint}</p>
                </header>
                <ul className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto p-2">
                  {cards.length === 0 && <li className="rounded-lg border border-dashed border-white/[0.08] px-3 py-6 text-center text-xs text-smoke">Nadie en esta etapa</li>}
                  {cards.map((item) => (
                    <li key={item.igId}>
                      <LeadCard item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}

function LeadCard({ item }: { item: InboxItem }) {
  return (
    <Link
      to={`/conversaciones/${encodeURIComponent(item.igId)}`}
      className={['block rounded-lg border bg-g2 p-2.5 transition-colors hover:border-white/15 hover:bg-g3', item.unanswered ? 'border-ember-500/35' : 'border-white/[0.06]'].join(' ')}
    >
      <span className="flex items-center gap-2.5">
        <Avatar name={item.username ?? item.igId} picture={item.picture} size={34} />
        <span className="min-w-0 flex-1">
          <span className={['block truncate text-sm', item.unanswered ? 'font-semibold text-snow' : 'text-fog'].join(' ')}>{handle(item.username, item.igId)}</span>
          <span className="block text-xs text-smoke">{timeAgo(item.lastAt)}</span>
        </span>
      </span>
      <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-ash">
        {item.lastDirection === 'out' ? 'Tú: ' : ''}
        {item.lastText}
      </span>
      {(item.unanswered || item.hasDraft || item.aiPaused) && (
        <span className="mt-2 flex flex-wrap gap-1">
          {item.unanswered && <span className="rounded bg-ember-500/12 px-1.5 py-0.5 text-xs font-semibold text-ember-400">Sin responder</span>}
          {item.hasDraft && <span className="rounded bg-info/10 px-1.5 py-0.5 text-xs font-semibold text-info">Borrador</span>}
          {item.aiPaused && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">IA parada</span>}
        </span>
      )}
    </Link>
  );
}

/** Barra apilada: cuántos hay en cada etapa (los mismos colores que las columnas, con nombre y cifra al lado). */
function StageBar({ columns }: { columns: readonly Column[] }) {
  const total = columns.reduce((sum, column) => sum + column.items.length, 0);
  if (total === 0) return null;
  return (
    <div className="card p-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={columns.map((c) => `${c.stage.label} ${c.items.length}`).join(', ')}>
        {columns
          .filter((column) => column.items.length > 0)
          .map((column) => (
            <span key={column.stage.id} className={column.stage.solid} style={{ width: `${(column.items.length / total) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {columns.map(({ stage, items }) => (
          <li key={stage.id} className="flex items-center gap-1.5 text-xs text-ash">
            <span aria-hidden="true" className={['h-2.5 w-2.5 rounded-sm', stage.solid].join(' ')} />
            {stage.label}
            <span className="font-semibold tabular-nums text-fog">{items.length}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
