import { ArrowLeft, Copy, FlaskConical, Power, Save, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { Notice, SecondaryButton, blockedUntilText, formatDate } from '../ui/kit';
import { FlowCanvas } from './FlowCanvas';
import { liveWarnings } from './graph';
import { FlowSettings } from './FlowSettings';
import { StepEditor } from './StepEditor';
import { TestPanel } from './TestPanel';
import { triggerSummary, type Flow, type FlowsResponse } from './types';
import { Loading } from '../ui/EmptyState';

/** Constructor visual de un flujo (Fase 6.5b): lienzo + panel lateral. Solo admin. */

const nonEmpty = (items: readonly string[]) => items.map((t) => t.trim()).filter(Boolean);

/** Quita líneas vacías antes de guardar (el servidor no las acepta). */
function clean(flow: Flow): Flow {
  return {
    ...flow,
    publicReplies: nonEmpty(flow.publicReplies),
    dmFailedReplies: nonEmpty(flow.dmFailedReplies),
    nodes: flow.nodes.map((step) => (step.type === 'setter_opener' ? { ...step, texts: nonEmpty(step.texts) } : step)),
  };
}

const errorsOf = (err: unknown): string[] => {
  const list = err instanceof ApiError ? (err.data as { errors?: unknown } | null)?.errors : null;
  if (Array.isArray(list)) return list.map(String);
  return [err instanceof Error ? err.message : 'No se pudo guardar'];
};

export function FlowEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Flow | null>(null);
  const [draft, setDraft] = useState<Flow | null>(null);
  const [meta, setMeta] = useState<FlowsResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const toast = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'enable' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}`), api<FlowsResponse>('/flows')])
      .then(([{ flow }, list]) => {
        setSaved(flow);
        setDraft(flow);
        setMeta(list);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [id]);

  const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loadError) return <Page><Notice tone="bad">{loadError}</Notice></Page>;
  if (!draft || !saved || !meta) return <Page><Loading /></Page>;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const missing = liveWarnings(draft);
      if (missing.length > 0) {
        setErrors(missing);
        return;
      }
      try {
        const { flow } = await api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}`, { method: 'POST', body: clean(draft) });
        setSaved(flow);
        setDraft(flow);
        setErrors([]);
        toast('Guardado.');
      } catch (err) {
        setErrors(errorsOf(err));
      }
    });

  const setEnabled = (enabled: boolean) =>
    run(async () => {
      try {
        const { flow } = await api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}/enable`, { method: 'POST', body: { enabled, confirm: enabled ? 'ACTIVAR' : undefined } });
        setSaved(flow);
        setDraft(flow);
        setDialog(null);
        toast(enabled ? 'Flujo activado.' : 'Flujo desactivado.');
      } catch (err) {
        setDialog(null);
        setErrors(errorsOf(err));
      }
    });

  const duplicate = () =>
    run(async () => {
      const { flow } = await api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
      navigate(`/flujos/${encodeURIComponent(flow.id)}`);
    });

  const remove = () =>
    run(async () => {
      await api(`/flows/${encodeURIComponent(id)}/delete`, { method: 'POST', body: { confirm: 'BORRAR' } });
      navigate('/flujos');
    });

  const step = draft.nodes.find((s) => s.id === selected) ?? null;
  const warnings = liveWarnings(draft);
  const flowName = (flowId: string) => meta.flows.find((item) => item.id === flowId)?.name;

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/flujos" className="inline-flex items-center gap-1 text-[13px] text-ash hover:text-fog">
          <ArrowLeft size={14} /> Flujos
        </Link>
        <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-snow">{draft.name || 'Sin nombre'}</h1>
        <span className={['rounded-md px-2 py-0.5 text-xs font-bold', saved.enabled ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ash'].join(' ')}>{saved.enabled ? 'ACTIVO' : 'INACTIVO'}</span>
        {dirty && <span className="text-xs text-warn">Cambios sin guardar</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setTesting(!testing)}>
            <FlaskConical size={14} /> {testing ? 'Cerrar prueba' : 'Probar'}
          </SecondaryButton>
          <button type="button" disabled={!dirty || busy} onClick={save} className="btn-gold inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px]">
            <Save size={14} /> Guardar
          </button>
          <SecondaryButton disabled={busy || dirty} onClick={() => (saved.enabled ? setEnabled(false) : setDialog('enable'))}>
            <Power size={14} /> {saved.enabled ? 'Desactivar' : 'Activar'}
          </SecondaryButton>
          <SecondaryButton disabled={busy || dirty} onClick={duplicate}>
            <Copy size={14} /> Duplicar
          </SecondaryButton>
          <SecondaryButton disabled={busy} onClick={() => setDialog('delete')}>
            <Trash2 size={14} /> Borrar
          </SecondaryButton>
        </div>
      </div>
      {dirty && <p className="mt-1 text-right text-xs text-smoke">Guarda antes de activar o duplicar.</p>}

      <div className="mt-4 space-y-3">
        {meta.sendsBlockedUntil && <Notice tone="warn">Envíos bloqueados {blockedUntilText(meta.sendsBlockedUntil)}: aunque actives un flujo, no saldrá ningún mensaje hasta entonces.</Notice>}
        {errors.length === 0 && warnings.length > 0 && (
          <div role="status" className="rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[13px] text-warn">
            <p className="font-semibold">Falta para poder guardar ({warnings.length}):</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-bad/30 bg-bad/[0.08] px-3 py-2 text-sm text-bad">
            <p className="font-semibold">No se ha guardado. Hay que arreglar:</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card h-[68vh] min-h-[460px] overflow-hidden">
          <FlowCanvas flow={draft} selected={selected} onSelect={setSelected} onChange={setDraft} flowName={flowName} />
        </div>
        <aside className="card max-h-[68vh] min-h-[300px] overflow-y-auto p-5">
          {testing ? (
            <TestPanel flow={draft} reels={meta.reels} flows={meta.flows} onFocus={setSelected} onClose={() => setTesting(false)} />
          ) : step ? (
            <StepEditor flow={draft} step={step} flows={meta.flows} onChange={setDraft} onClose={() => setSelected(null)} />
          ) : (
            <FlowSettings flow={draft} reels={meta.reels} account={meta.account ?? null} onChange={setDraft} />
          )}
        </aside>
      </div>

      {dialog === 'enable' && (
        <ConfirmDialog title={`Activar "${saved.name}"`} word="ACTIVAR" confirmLabel="Activar" busy={busy} onConfirm={() => setEnabled(true)} onCancel={() => setDialog(null)}>
          <p>
            Al activarlo, responderá por DM a personas reales. Empieza con: <strong className="text-fog">{triggerSummary(saved.trigger)}</strong>.
          </p>
          {saved.testUsernames.length > 0 && <p>Modo prueba: solo a {saved.testUsernames.map((u) => `@${u}`).join(', ')}.</p>}
          {meta.sendsBlockedUntil && <p className="text-warn">Ahora mismo los envíos están bloqueados: no saldrá nada {blockedUntilText(meta.sendsBlockedUntil)}.</p>}
        </ConfirmDialog>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog title={`Borrar "${saved.name}"`} word="BORRAR" confirmLabel="Borrar" tone="bad" busy={busy} onConfirm={remove} onCancel={() => setDialog(null)}>
          <p>Se borra el flujo entero. Queda una copia en el registro de eventos por si hiciera falta recuperarlo.</p>
        </ConfirmDialog>
      )}
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1500px] px-5 py-6 lg:px-8">{children}</div>;
}
