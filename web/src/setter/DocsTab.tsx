import { ArrowDown, ArrowUp, FileText, History, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Skeleton } from '../ui/EmptyState';
import { Notice, Section, formatDate } from '../ui/kit';
import { useToast } from '../ui/Toast';
import type { SetterData } from './types';
import { VersionedTextTab } from './VersionedTextTab';

/**
 * Documentos del setter (Fase 7.2). Petición de Jose: un documento por tema en vez de un texto fusionado.
 * La IA sigue con el documento único hasta que Jose pulse "Usar documentos separados" (y puede volver atrás).
 */

interface DocItem {
  readonly slug: string;
  readonly title: string;
  readonly hint: string;
  readonly builtin: boolean;
  readonly active: boolean;
  readonly position: number;
  readonly text: string;
  readonly updatedAt: string | null;
  readonly versions: readonly { readonly id: number; readonly createdAt: string; readonly chars: number }[];
}

interface DocsResponse {
  readonly mode: 'docs' | 'single';
  readonly single: { readonly chars: number; readonly updatedAt: string } | null;
  readonly docs: readonly DocItem[];
}

const MAX_DOC_CHARS = 30_000;
const MAX_SINGLE_CHARS = 60_000;
const SINGLE = '__single__';

export function DocsTab({ setter, onSingleSaved }: { setter: SetterData; onSingleSaved: (message: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<DocsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(SINGLE);
  const [confirmMode, setConfirmMode] = useState<'docs' | 'single' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<DocsResponse>('/setter/docs'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<{ message?: string } | unknown>, done?: string) => {
    try {
      const result = (await action()) as { message?: string } | null;
      toast(result?.message ?? done ?? 'Hecho.');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo hacer', 'bad');
    }
  };

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const doc = data.docs.find((d) => d.slug === selected) ?? null;
  const activeWithText = data.docs.filter((d) => d.active && d.text.trim()).length;

  return (
    <div className="space-y-4">
      <div className={['flex flex-wrap items-center gap-3 rounded-[14px] border px-4 py-3', data.mode === 'docs' ? 'border-ok/30 bg-ok/[0.06]' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
        <p className="flex-1 text-sm text-fog">
          La IA usa ahora: <strong>{data.mode === 'docs' ? `los documentos separados (${activeWithText} activos con texto)` : 'el documento único de siempre'}</strong>
        </p>
        {data.mode === 'docs' ? (
          <Button size="sm" onClick={() => setConfirmMode('single')}>
            Volver al documento único
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={activeWithText === 0} title={activeWithText === 0 ? 'Antes escribe y guarda algún documento' : undefined} onClick={() => setConfirmMode('docs')}>
            Usar documentos separados
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Documentos" className="card h-fit p-2">
          <DocRow title="Documento único (el de siempre)" note={data.single ? `${data.single.chars.toLocaleString('es')} caracteres` : 'Vacío'} selected={selected === SINGLE} inUse={data.mode === 'single'} onSelect={() => setSelected(SINGLE)} />
          <p className="label px-3 pb-1 pt-4">Por tema</p>
          {data.docs.map((d, i) => (
            <DocRow
              key={d.slug}
              title={d.title}
              note={!d.active ? 'Desactivado' : d.text.trim() ? `${d.text.length.toLocaleString('es')} caracteres` : 'Vacío'}
              selected={selected === d.slug}
              inUse={data.mode === 'docs' && d.active && Boolean(d.text.trim())}
              onSelect={() => setSelected(d.slug)}
              onUp={i > 0 ? () => void act(() => api(`/setter/docs/${d.slug}/move`, { method: 'POST', body: { dir: 'up' } }), 'Orden cambiado.') : undefined}
              onDown={i < data.docs.length - 1 ? () => void act(() => api(`/setter/docs/${d.slug}/move`, { method: 'POST', body: { dir: 'down' } }), 'Orden cambiado.') : undefined}
            />
          ))}
          <NewDocForm
            onCreate={(title) =>
              void act(async () => {
                const { slug } = await api<{ slug: string }>('/setter/docs', { method: 'POST', body: { title } });
                setSelected(slug);
                return { message: `Documento "${title}" creado.` };
              })
            }
          />
        </nav>

        <div className="min-w-0">
          {selected === SINGLE || !doc ? (
            <VersionedTextTab
              endpoint="/setter/knowledge"
              label="Documento único (el de siempre)"
              description={data.mode === 'single' ? 'Es lo que lee la IA ahora mismo.' : 'Guardado por si quieres volver a él. Ahora la IA usa los documentos separados.'}
              text={setter.knowledge?.text ?? ''}
              maxChars={MAX_SINGLE_CHARS}
              versions={setter.knowledgeVersions}
              onSaved={onSingleSaved}
            />
          ) : (
            <DocEditor key={`${doc.slug}-${doc.versions[0]?.id ?? 0}`} doc={doc} onAction={act} />
          )}
        </div>
      </div>

      {confirmMode && (
        <ConfirmDialog
          title={confirmMode === 'docs' ? 'Usar los documentos separados' : 'Volver al documento único'}
          word="CAMBIAR"
          confirmLabel="Cambiar"
          onConfirm={() => {
            setConfirmMode(null);
            void act(() => api('/setter/docs/mode', { method: 'POST', body: { mode: confirmMode } }));
          }}
          onCancel={() => setConfirmMode(null)}
        >
          <p>
            {confirmMode === 'docs'
              ? `Desde ya, la IA leerá los ${activeWithText} documentos activos con texto, cada uno con su título, en vez del documento único. Pruébalo en el Simulador.`
              : 'La IA vuelve a leer el documento único de siempre. Los documentos por tema se quedan guardados.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function DocRow({ title, note, selected, inUse, onSelect, onUp, onDown }: { title: string; note: string; selected: boolean; inUse: boolean; onSelect: () => void; onUp?: () => void; onDown?: () => void }) {
  return (
    <div className={['group flex items-center gap-1 rounded-lg', selected ? 'bg-ember-500/12' : 'hover:bg-white/[0.04]'].join(' ')}>
      <button type="button" onClick={onSelect} aria-current={selected || undefined} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left">
        <FileText size={16} className={inUse ? 'shrink-0 text-ok' : 'shrink-0 text-smoke'} aria-hidden />
        <span className="min-w-0">
          <span className={['block text-sm font-semibold leading-snug', selected ? 'text-ember-300' : 'text-fog'].join(' ')}>{title}</span>
          <span className="block text-xs text-smoke">
            {note}
            {inUse ? ' · en uso' : ''}
          </span>
        </span>
      </button>
      {onUp && (
        <button type="button" aria-label={`Subir "${title}"`} onClick={onUp} className="grid h-8 w-8 place-items-center rounded-md text-smoke hover:bg-white/[0.06] hover:text-fog">
          <ArrowUp size={14} />
        </button>
      )}
      {onDown && (
        <button type="button" aria-label={`Bajar "${title}"`} onClick={onDown} className="grid h-8 w-8 place-items-center rounded-md text-smoke hover:bg-white/[0.06] hover:text-fog">
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}

function NewDocForm({ onCreate }: { onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim()) onCreate(title.trim());
    setTitle('');
  };
  return (
    <form onSubmit={submit} className="mt-3 flex gap-1.5 border-t border-white/[0.06] px-1 pt-3">
      <input className="field !py-1.5 text-[13px]" placeholder="Nuevo documento (título)" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título del documento nuevo" />
      <Button size="sm" type="submit" disabled={!title.trim()} aria-label="Crear documento" icon={<Plus size={14} />} />
    </form>
  );
}

function DocEditor({ doc, onAction }: { doc: DocItem; onAction: (action: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [text, setText] = useState(doc.text);
  const [title, setTitle] = useState(doc.title);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = text.trim() !== doc.text.trim();
  const tooLong = text.length > MAX_DOC_CHARS;
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    await onAction(action, done);
    setBusy(false);
  };

  return (
    <Section
      label={doc.builtin ? doc.title : 'Documento propio'}
      description={doc.hint}
      actions={
        <label className="flex items-center gap-2 text-[13px] text-mist">
          <input type="checkbox" checked={doc.active} onChange={(e) => void run(() => api(`/setter/docs/${doc.slug}/meta`, { method: 'POST', body: { active: e.target.checked } }), e.target.checked ? 'Activado.' : 'Desactivado.')} className="h-4 w-4 accent-ember-500" />
          Activo
        </label>
      }
    >
      <div className="space-y-3">
        {!doc.builtin && (
          <div className="flex gap-2">
            <input className="field" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" />
            <Button disabled={!title.trim() || title === doc.title || busy} onClick={() => void run(() => api(`/setter/docs/${doc.slug}/meta`, { method: 'POST', body: { title } }), 'Título cambiado.')}>
              Renombrar
            </Button>
          </div>
        )}
        <textarea className="field min-h-[360px] font-mono text-[13px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Texto de "${doc.title}"`} />
        <div className="flex flex-wrap items-center gap-2">
          <span className={['text-xs', tooLong ? 'text-bad' : 'text-smoke'].join(' ')}>
            {text.length.toLocaleString('es')} / {MAX_DOC_CHARS.toLocaleString('es')} caracteres{doc.updatedAt ? ` · guardado ${formatDate(doc.updatedAt)}` : ''}
          </span>
          <span className="flex-1" />
          {!doc.builtin && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setDeleting(true)}>
              Borrar
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!dirty || tooLong} onClick={() => void run(() => api(`/setter/docs/${doc.slug}`, { method: 'POST', body: { text } }))}>
            Guardar
          </Button>
        </div>
        {doc.versions.length > 1 && (
          <details className="rounded-lg border border-white/[0.06] px-3 py-2">
            <summary className="flex items-center gap-2 text-[13px] font-semibold text-mist">
              <History size={14} /> Versiones anteriores ({doc.versions.length - 1})
            </summary>
            <ul className="mt-2 space-y-1">
              {doc.versions.slice(1).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 text-xs text-ash">
                  <span>
                    {formatDate(v.createdAt)} · {v.chars.toLocaleString('es')} caracteres
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/setter/docs/${doc.slug}/restore`, { method: 'POST', body: { versionId: v.id } }))}>
                    Volver a esta
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {deleting && (
        <ConfirmDialog title={`Borrar "${doc.title}"`} word="BORRAR" confirmLabel="Borrar" tone="bad" onConfirm={() => void run(() => api(`/setter/docs/${doc.slug}/delete`, { method: 'POST', body: { confirm: 'BORRAR' } }), 'Documento borrado.').then(() => setDeleting(false))} onCancel={() => setDeleting(false)}>
          <p>Se borra el documento y todas sus versiones.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
