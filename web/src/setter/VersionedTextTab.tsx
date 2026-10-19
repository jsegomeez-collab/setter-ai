import { History, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Notice, SecondaryButton, Section, formatDate } from '../ui/kit';
import type { SaveResponse, VersionSummary } from './types';

type Props = {
  /** Ruta de la API: '/setter/knowledge' o '/setter/frame'. */
  readonly endpoint: string;
  readonly label: string;
  readonly description: ReactNode;
  readonly text: string;
  readonly maxChars: number;
  readonly versions: readonly VersionSummary[];
  readonly onSaved: (message: string) => void;
  /** Botón extra (p. ej. "Volver al original" del marco técnico). */
  readonly extraAction?: ReactNode;
};

/** Texto largo con historial de versiones: documento del setter y marco técnico. */
export function VersionedTextTab({ endpoint, label, description, text, maxChars, versions, onSaved, extraAction }: Props) {
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = value.trim() !== text.trim();
  const tooLong = value.length > maxChars;

  async function run(action: () => Promise<SaveResponse>, done: (result: SaveResponse) => string) {
    setBusy(true);
    setError(null);
    try {
      onSaved(done(await action()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () => api<SaveResponse>(endpoint, { method: 'POST', body: { text: value } }),
      (r) => (r.unchanged ? 'Sin cambios: no se crea versión nueva.' : `Guardado (versión #${r.id}).`),
    );
  const restore = (id: number) =>
    run(
      () => api<SaveResponse>(`${endpoint}/${id}/restore`, { method: 'POST', body: {} }),
      (r) => (r.unchanged ? 'Esa versión ya es la actual.' : `Versión #${id} restaurada (ahora es la #${r.id}).`),
    );

  return (
    <div className="space-y-4">
      <Section label={label} description={description} actions={extraAction}>
        <textarea
          className="field min-h-[420px] resize-y font-mono text-[13px] leading-relaxed"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          aria-label={label}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className={['text-xs', tooLong ? 'text-bad' : 'text-smoke'].join(' ')}>
            {value.length.toLocaleString('es')} / {maxChars.toLocaleString('es')} caracteres{dirty ? ' · cambios sin guardar' : ''}
          </span>
          <div className="flex gap-2">
            {dirty && (
              <SecondaryButton onClick={() => setValue(text)} disabled={busy}>
                Deshacer cambios
              </SecondaryButton>
            )}
            <button type="button" onClick={() => void save()} disabled={busy || !dirty || tooLong} className="btn-gold px-4 py-2 text-sm">
              {busy ? 'Guardando…' : 'Guardar versión'}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </Section>

      <Section label="Historial" description="Cada vez que guardas se crea una versión. Restaurar copia esa versión como la actual.">
        {versions.length === 0 ? (
          <p className="text-sm text-smoke">Todavía no hay versiones guardadas.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {versions.map((v, index) => (
              <li key={v.id} className="flex items-center gap-3 py-2.5">
                <History size={15} className="shrink-0 text-smoke" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fog">
                    #{v.id} · {formatDate(v.createdAt)} {index === 0 && <span className="ml-1 rounded bg-ember-500/12 px-1.5 py-0.5 text-xs font-semibold text-ember-400">Actual</span>}
                  </p>
                  <p className="truncate text-xs text-smoke">{v.isDefault ? 'Original (el del código)' : `${v.chars.toLocaleString('es')} car. · ${v.preview}`}</p>
                </div>
                {index > 0 && (
                  <SecondaryButton onClick={() => void restore(v.id)} disabled={busy}>
                    <RotateCcw size={13} /> Restaurar
                  </SecondaryButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
