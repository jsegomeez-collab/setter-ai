import { Search } from 'lucide-react';
import { NavLink } from 'react-router';
import { STAGE_LABEL, handle, timeAgo, type InboxItem } from './types';

export const FILTERS: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unanswered', label: 'Sin responder' },
  { value: 'draft', label: 'Borrador' },
  { value: 'paused', label: 'IA parada' },
  ...Object.entries(STAGE_LABEL).map(([stage, label]) => ({ value: `stage:${stage}`, label })),
];

type Props = {
  readonly items: readonly InboxItem[] | null;
  readonly filter: string;
  readonly query: string;
  readonly onFilter: (value: string) => void;
  readonly onQuery: (value: string) => void;
};

/** Bandeja: búsqueda, filtros en pastillas y la lista (lo último arriba). */
export function InboxList({ items, filter, query, onFilter, onQuery }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-white/[0.06] p-3">
        <label className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
          <Search size={14} className="text-smoke" />
          <input className="w-full bg-transparent text-sm text-fog outline-none placeholder:text-smoke" placeholder="Buscar @usuario" value={query} onChange={(e) => onQuery(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilter(f.value)}
              aria-pressed={filter === f.value}
              className={['rounded-md px-2 py-1 text-xs font-semibold transition-colors', filter === f.value ? 'bg-ember-500/12 text-ember-400' : 'text-ash hover:bg-white/[0.04] hover:text-fog'].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items === null && <li className="p-4 text-sm text-smoke">Cargando…</li>}
        {items?.length === 0 && <li className="p-4 text-sm text-smoke">No hay conversaciones con este filtro.</li>}
        {items?.map((item) => (
          <li key={item.igId}>
            <NavLink
              to={`/conversaciones/${encodeURIComponent(item.igId)}`}
              className={({ isActive }) =>
                ['block border-b border-white/[0.04] px-4 py-3 transition-colors', isActive ? 'bg-ember-500/[0.07]' : 'hover:bg-white/[0.03]'].join(' ')
              }
            >
              <div className="flex items-center gap-2">
                <span className={['min-w-0 flex-1 truncate text-sm', item.unanswered ? 'font-semibold text-snow' : 'text-mist'].join(' ')}>{handle(item.username, item.igId)}</span>
                <span className="shrink-0 text-xs text-smoke">{timeAgo(item.lastAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ash">
                {item.lastDirection === 'out' ? 'Tú: ' : ''}
                {item.lastText}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.unanswered && <Chip tone="ember">Sin responder</Chip>}
                {item.hasDraft && <Chip tone="info">Borrador</Chip>}
                {item.aiPaused && <Chip tone="warn">IA parada</Chip>}
                {item.stage && <Chip tone="plain">{STAGE_LABEL[item.stage] ?? item.stage}</Chip>}
              </div>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHIP_TONES = { ember: 'bg-ember-500/12 text-ember-400', info: 'bg-info/10 text-info', warn: 'bg-warn/10 text-warn', plain: 'bg-white/[0.05] text-ash' } as const;

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${CHIP_TONES[tone]}`}>{children}</span>;
}
