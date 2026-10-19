import { Search } from 'lucide-react';
import { NavLink } from 'react-router';
import { STAGE_LABEL, handle, timeAgo, type InboxItem } from './types';
import { Loading } from '../ui/EmptyState';

/** Estados (una fila de botones) y etapas de la ficha (un desplegable): antes eran 3 filas de botones diminutos. */
const STATES: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unanswered', label: 'Sin responder' },
  { value: 'draft', label: 'Borrador' },
  { value: 'paused', label: 'IA parada' },
];
const STAGES = Object.entries(STAGE_LABEL).map(([stage, label]) => ({ value: `stage:${stage}`, label }));
export const FILTERS: readonly { value: string; label: string }[] = [...STATES, ...STAGES];

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
          <Search size={14} className="text-smoke" aria-hidden />
          <input aria-label="Buscar por usuario" className="w-full bg-transparent text-sm text-fog outline-none placeholder:text-smoke" placeholder="Buscar @usuario" value={query} onChange={(e) => onQuery(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado">
          {STATES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilter(f.value)}
              aria-pressed={filter === f.value}
              className={['min-h-9 rounded-lg px-2.5 text-[12px] font-semibold transition-colors', filter === f.value ? 'bg-ember-500/12 text-ember-400' : 'text-ash hover:bg-white/[0.04] hover:text-fog'].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Filtrar por etapa"
          className="field !py-2 text-[13px]"
          value={filter.startsWith('stage:') ? filter : ''}
          onChange={(e) => onFilter(e.target.value || 'all')}
        >
          <option value="">Etapa: todas</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              Etapa: {s.label}
            </option>
          ))}
        </select>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items === null && <li className="p-4"><Loading rows={4} /></li>}
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
