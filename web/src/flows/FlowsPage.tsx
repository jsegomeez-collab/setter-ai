import { Plus, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { Notice, formatDate } from '../ui/kit';
import type { Flow, FlowSummary, FlowsResponse } from './types';

/** Lista de flujos (Fase 6.5b): estado, cuándo saltan y crear uno nuevo. Solo admin. */

function triggerText(flow: FlowSummary): string {
  const reels = flow.trigger.mediaIds === 'all' ? 'Todos los reels' : `${flow.trigger.mediaIds.length} reel(s)`;
  const words = flow.trigger.keywords.length ? ` · palabras: ${flow.trigger.keywords.join(', ')}` : ' · cualquier comentario';
  return reels + words;
}

export function FlowsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<FlowsResponse>('/flows')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const { flow } = await api<{ flow: Flow }>('/flows', { method: 'POST', body: { name } });
      navigate(`/flujos/${encodeURIComponent(flow.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1150px] px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">Flujos</h1>
          <p className="mt-1 text-sm text-ash">Qué pasa cuando alguien comenta un reel: el DM, los botones, las condiciones y el inicio del setter.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
          className="flex gap-2"
        >
          <input className="field !w-[220px] !py-2 text-[13px]" placeholder="Nombre del flujo nuevo" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim() || creating} className="btn-gold inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px]">
            <Plus size={14} /> Crear
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-3">
        {data?.sendsBlockedUntil && <Notice tone="warn">Envíos bloqueados hasta el {formatDate(data.sendsBlockedUntil)} (bloqueo de Meta): ningún flujo manda mensajes hasta entonces.</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {!data && !error && <p className="text-sm text-smoke">Cargando…</p>}
        {data?.flows.length === 0 && <p className="text-sm text-smoke">Todavía no hay flujos. Crea el primero arriba.</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {data?.flows.map((flow) => (
            <li key={flow.id}>
              <Link to={`/flujos/${encodeURIComponent(flow.id)}`} className="card flex h-full flex-col gap-2 p-5 transition-colors hover:border-white/15">
                <span className="flex items-center gap-2">
                  <Workflow size={16} className="text-ember-400" />
                  <span className="truncate font-semibold text-fog">{flow.name}</span>
                  <span className={['ml-auto rounded-md px-2 py-0.5 text-xs font-bold', flow.enabled ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ash'].join(' ')}>{flow.enabled ? 'ACTIVO' : 'INACTIVO'}</span>
                </span>
                <span className="text-[13px] text-ash">{triggerText(flow)}</span>
                <span className="text-xs text-smoke">
                  {flow.steps} paso(s){flow.testUsernames.length ? ` · modo prueba: ${flow.testUsernames.map((u) => `@${u}`).join(', ')}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
