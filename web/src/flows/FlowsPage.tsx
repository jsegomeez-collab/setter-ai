import { ChevronRight, Plus, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { EmptyState, Loading } from '../ui/EmptyState';
import { Notice, Tabs, blockedUntilText, formatDate } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { ChatEntryPanel } from './ChatEntryPanel';
import { TRIGGER_LABEL, triggerSummary, type Flow, type FlowsResponse } from './types';
import { TRIGGER_ICON } from './FlowSettings';
import { STEP_META } from './steps-meta';
import { ReelCover } from '../ui/visual';

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

type TabId = 'flujos' | 'chat';
const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'flujos', label: 'Flujos' },
  { value: 'chat', label: 'Rompehielos y menú' },
];

export function FlowsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'chat' ? 'chat' : 'flujos';

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
          tab === 'flujos' && (
            <button type="button" onClick={() => setCreatorOpen(!creatorOpen)} aria-expanded={creatorOpen} className="btn-gold inline-flex items-center gap-1.5 px-4 py-2 text-[13px]">
              {creatorOpen ? <X size={14} /> : <Plus size={14} />} Crear flujo
            </button>
          )
        }
      />

      <div className="mt-5">
        <Tabs tabs={TABS} value={tab} onChange={(value) => setParams(value === 'flujos' ? {} : { tab: value })} />
      </div>

      {tab === 'chat' ? (
        <div className="mt-5">{data ? <ChatEntryPanel flows={data.flows} /> : <Loading />}</div>
      ) : (
        <div className="mt-5 space-y-4">
          {creatorOpen && <Creator onCreate={create} />}
          {data?.sendsBlockedUntil && <Notice tone="warn">Envíos bloqueados {blockedUntilText(data.sendsBlockedUntil)}: ningún flujo manda mensajes hasta entonces.</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          {!data && !error && <Loading />}
          {data && <FlowList flows={data.flows} reels={data.reels} />}
        </div>
      )}
    </Page>
  );
}

/** Pasos que caben en la cadena de iconos de una tarjeta (el resto se cuenta: "+3"). */
const CHAIN_SHOWN = 7;
/** Portadas de reels que caben en una tarjeta. */
const COVERS_SHOWN = 4;

function FlowList({ flows, reels }: { flows: FlowsResponse['flows']; reels: FlowsResponse['reels'] }) {
  if (flows.length === 0) {
    return (
      <EmptyState icon={Workflow} title="Todavía no hay flujos">
        Crea el primero con una plantilla: luego cambias los textos en el constructor.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {flows.map((flow) => (
        <li key={flow.id}>
          <FlowCard flow={flow} reels={reels} />
        </li>
      ))}
    </ul>
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

/**
 * Tarjeta de un flujo (Fase 8.7): qué lo dispara (icono grande), en qué reels (sus portadas) y qué hace (la cadena de
 * pasos en iconos, en orden). Así se entiende sin abrirlo.
 */
function FlowCard({ flow, reels }: { flow: FlowsResponse['flows'][number]; reels: FlowsResponse['reels'] }) {
  const TriggerIcon = TRIGGER_ICON[flow.trigger.type];
  const reelIds = flow.trigger.type === 'comment' && Array.isArray(flow.trigger.mediaIds) ? flow.trigger.mediaIds : [];
  const covers = reelIds.map((id) => reels.find((reel) => reel.mediaId === id)).filter((reel) => reel !== undefined);
  const chain = flow.stepTypes.slice(0, CHAIN_SHOWN);
  const hidden = flow.stepTypes.length - chain.length;
  return (
    <Link to={`/flujos/${encodeURIComponent(flow.id)}`} className="card group flex h-full flex-col gap-4 p-5 transition-colors hover:border-white/15">
      <span className="flex items-start gap-3">
        <span className={['grid h-11 w-11 shrink-0 place-items-center rounded-xl', flow.enabled ? 'bg-ember-500/15 text-ember-400' : 'bg-white/[0.05] text-smoke'].join(' ')}>
          <TriggerIcon size={20} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[17px] font-bold text-snow">{flow.name}</span>
          <span className="block text-xs font-semibold text-ember-400">{TRIGGER_LABEL[flow.trigger.type]}</span>
        </span>
        <span className={['inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold', flow.enabled ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ash'].join(' ')}>
          <span aria-hidden="true" className={['h-1.5 w-1.5 rounded-full', flow.enabled ? 'bg-ok' : 'bg-smoke'].join(' ')} />
          {flow.enabled ? 'Activo' : 'Inactivo'}
        </span>
      </span>

      <span className="flex items-center gap-2">
        {covers.length > 0 ? (
          <>
            {covers.slice(0, COVERS_SHOWN).map((reel) => (
              <ReelCover key={reel.mediaId} src={reel.cover} size={36} />
            ))}
            {covers.length > COVERS_SHOWN && <span className="text-xs font-semibold text-ash">+{covers.length - COVERS_SHOWN}</span>}
            <span className="min-w-0 flex-1 truncate text-[13px] text-ash">{triggerSummary(flow.trigger)}</span>
          </>
        ) : (
          <span className="text-[13px] text-ash">{triggerSummary(flow.trigger)}</span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1" aria-label={`Pasos: ${flow.stepTypes.map((type) => STEP_META[type]?.label ?? type).join(', ')}`}>
        {chain.map((type, index) => {
          const meta = STEP_META[type];
          const Icon = meta?.icon ?? Workflow;
          return (
            <span key={`${type}-${index}`} className="flex items-center gap-1" aria-hidden="true">
              {index > 0 && <ChevronRight size={12} className="text-white/20" />}
              <span title={meta?.label ?? type} className="grid h-7 w-7 place-items-center rounded-lg border border-white/8 bg-white/[0.03]">
                <Icon size={14} className={meta?.accent ?? 'text-ash'} />
              </span>
            </span>
          );
        })}
        {hidden > 0 && (
          <span aria-hidden="true" className="ml-1 text-xs font-semibold text-ash">
            +{hidden}
          </span>
        )}
      </span>

      <span className="mt-auto text-xs text-smoke">
        {flow.steps} paso(s){flow.testUsernames.length ? ` · modo prueba: ${flow.testUsernames.map((u) => `@${u}`).join(', ')}` : ''}
      </span>
    </Link>
  );
}
