import { Plus, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { EmptyState } from '../ui/EmptyState';
import { Notice, formatDate } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { TRIGGER_LABEL, triggerSummary, type Flow, type FlowsResponse } from './types';

/** Lista de flujos (Fase 6.5b; 7.3b: crear desde plantillas y ver cómo empieza cada uno). Solo admin. */

/** Las mismas plantillas que el servidor (src/flows/templates.ts). */
const TEMPLATES = [
  { id: 'comment_resource', label: 'Recurso por comentario', description: 'Comentan un reel → DM con botón → les mandas el enlace.' },
  { id: 'comment_follow', label: 'Recurso solo si me sigue', description: 'Igual, pero antes comprueba si te siguen.' },
  { id: 'dm_keyword', label: 'Palabra clave por DM', description: 'Te escriben «GUIA» → etiqueta y enlace a la guía.' },
  { id: 'story_reply', label: 'Respuesta a historia', description: 'Responden a tu historia → reacción ❤️ y una pregunta con respuestas rápidas.' },
  { id: 'story_mention', label: 'Mención en historia', description: 'Te mencionan en su historia → reacción y un gracias.' },
  { id: 'blank', label: 'En blanco', description: 'Un solo mensaje para montarlo tú desde cero.' },
] as const;
type TemplateId = (typeof TEMPLATES)[number]['id'];

export function FlowsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);

  useEffect(() => {
    api<FlowsResponse>('/flows')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, []);

  const create = async (name: string, template: TemplateId) => {
    try {
      const { flow } = await api<{ flow: Flow }>('/flows', { method: 'POST', body: { name, template } });
      navigate(`/flujos/${encodeURIComponent(flow.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    }
  };

  return (
    <Page>
      <PageHeader
        title="Flujos"
        description="Qué pasa cuando alguien comenta un reel, te escribe una palabra, responde a tu historia o te menciona."
        actions={
          <button type="button" onClick={() => setCreatorOpen(!creatorOpen)} aria-expanded={creatorOpen} className="btn-gold inline-flex items-center gap-1.5 px-4 py-2 text-[13px]">
            {creatorOpen ? <X size={14} /> : <Plus size={14} />} Crear flujo
          </button>
        }
      />

      <div className="mt-6 space-y-4">
        {creatorOpen && <Creator onCreate={create} />}
        {data?.sendsBlockedUntil && <Notice tone="warn">Envíos bloqueados hasta el {formatDate(data.sendsBlockedUntil)} (bloqueo de Meta): ningún flujo manda mensajes hasta entonces.</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {!data && !error && <p className="text-sm text-smoke">Cargando…</p>}
        {data?.flows.length === 0 && (
          <EmptyState icon={Workflow} title="Todavía no hay flujos">
            Crea el primero con una plantilla: luego cambias los textos en el constructor.
          </EmptyState>
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {data?.flows.map((flow) => (
            <li key={flow.id}>
              <Link to={`/flujos/${encodeURIComponent(flow.id)}`} className="card flex h-full flex-col gap-2 p-5 transition-colors hover:border-white/15">
                <span className="flex items-center gap-2">
                  <Workflow size={16} className="text-ember-400" aria-hidden />
                  <span className="truncate font-semibold text-fog">{flow.name}</span>
                  <span className={['ml-auto rounded-md px-2 py-0.5 text-xs font-bold', flow.enabled ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ash'].join(' ')}>{flow.enabled ? 'ACTIVO' : 'INACTIVO'}</span>
                </span>
                <span className="text-xs font-semibold text-ember-400">{TRIGGER_LABEL[flow.trigger.type]}</span>
                <span className="text-[13px] text-ash">{triggerSummary(flow.trigger)}</span>
                <span className="text-xs text-smoke">
                  {flow.steps} paso(s){flow.testUsernames.length ? ` · modo prueba: ${flow.testUsernames.map((u) => `@${u}`).join(', ')}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

function Creator({ onCreate }: { onCreate: (name: string, template: TemplateId) => Promise<void> }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TemplateId>('comment_resource');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        void onCreate(name.trim(), template).finally(() => setBusy(false));
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-mist">Nombre del flujo</span>
        <input className="field" maxLength={80} placeholder="Ej.: Guía n8n por comentario" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-mist">Empezar desde</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((item) => (
            <label
              key={item.id}
              className={['flex cursor-pointer gap-2.5 rounded-xl border p-3', template === item.id ? 'border-ember-500/60 bg-ember-500/10' : 'border-white/8 hover:border-white/20'].join(' ')}
            >
              <input type="radio" name="plantilla" className="mt-0.5 accent-ember-500" checked={template === item.id} onChange={() => setTemplate(item.id)} />
              <span>
                <span className="block text-[13px] font-semibold text-fog">{item.label}</span>
                <span className="block text-xs leading-snug text-ash">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-smoke">Nace desactivado y con textos de ejemplo: cámbialos en el constructor antes de activarlo.</p>
      <button type="submit" disabled={!name.trim() || busy} className="btn-gold inline-flex items-center gap-1.5 px-4 py-2 text-[13px]">
        <Plus size={14} /> Crear y abrir el constructor
      </button>
    </form>
  );
}
