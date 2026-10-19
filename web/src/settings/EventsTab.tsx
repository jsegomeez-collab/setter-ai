import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Notice, Section, formatDate } from '../ui/kit';

/** Registro de eventos (Fase 6.7b): lo que va pasando (comentarios, envíos, errores de Meta, quién cambió qué). Solo lectura. */

interface EventItem {
  readonly createdAt: string;
  readonly kind: string;
  readonly note: string;
  readonly data: unknown;
}

const MAX_DATA_CHARS = 2000;

export function EventsTab() {
  const [kind, setKind] = useState('');
  const [data, setData] = useState<{ events: readonly EventItem[]; kinds: readonly string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    api<{ events: EventItem[]; kinds: string[] }>(`/settings/events${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [kind]);

  return (
    <Section
      label="Registro de eventos"
      description="Los 200 más recientes. Pulsa uno para ver sus datos técnicos."
      actions={
        <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-white/8 bg-g2 px-2.5 py-1.5 text-[13px] text-mist">
          <option value="">Todos los tipos</option>
          {data?.kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      }
    >
      {error && <Notice tone="bad">{error}</Notice>}
      {!data && !error && <p className="text-sm text-smoke">Cargando…</p>}
      {data?.events.length === 0 && <p className="text-sm text-smoke">Nada todavía.</p>}
      <ul className="divide-y divide-white/[0.05]">
        {data?.events.map((event, i) => (
          <li key={`${event.createdAt}-${i}`}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} className="grid w-full gap-1 py-2 text-left text-[13px] hover:bg-white/[0.02] sm:grid-cols-[120px_120px_minmax(0,1fr)] sm:gap-3">
              <span className="text-xs text-smoke">{formatDate(event.createdAt)}</span>
              <span className="truncate text-xs font-semibold text-ember-400">{event.kind}</span>
              <span className="text-mist">{event.note}</span>
            </button>
            {open === i && event.data !== null && (
              <pre className="mb-2 max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-ash">{JSON.stringify(event.data, null, 2).slice(0, MAX_DATA_CHARS)}</pre>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
