import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Notice, SecondaryButton, Section } from '../ui/kit';
import type { OpenerStep } from './types';

const MAX_TEXTS = 20;
const MAX_DELAY_MINUTES = 23 * 60;

type Props = { openers: readonly OpenerStep[]; onSaved: (message: string) => void };

/** Textos de inicio (la IA escribe primero uno al azar) y la espera desde que recibe el recurso. */
export function OpenerTab({ openers, onSaved }: Props) {
  if (openers.length === 0) {
    return (
      <Section label="Inicio del setter" description="Ningún flujo tiene ahora el paso de inicio del setter.">
        <Notice tone="info">Se añade desde Flujos (paso 6.5) o desde el panel actual. Cuando exista, aquí podrás cambiar sus textos y la espera.</Notice>
      </Section>
    );
  }
  return (
    <div className="space-y-4">
      {openers.map((step) => (
        <OpenerEditor key={`${step.flowId}:${step.nodeId}`} step={step} onSaved={onSaved} />
      ))}
    </div>
  );
}

function OpenerEditor({ step, onSaved }: { step: OpenerStep; onSaved: (message: string) => void }) {
  const [texts, setTexts] = useState<string[]>([...step.texts]);
  const [minutes, setMinutes] = useState(step.delaySeconds === null ? '' : String(Math.round(step.delaySeconds / 60) || 1));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setText = (index: number, value: string) => setTexts((current) => current.map((t, i) => (i === index ? value : t)));

  async function save() {
    const delay = Number(minutes);
    if (step.delayNodeId && (!Number.isInteger(delay) || delay < 1 || delay > MAX_DELAY_MINUTES)) {
      return setError(`La espera tiene que ser un número entero de 1 a ${MAX_DELAY_MINUTES} minutos.`);
    }
    setBusy(true);
    setError(null);
    try {
      const body = { flowId: step.flowId, nodeId: step.nodeId, texts, delaySeconds: step.delayNodeId ? delay * 60 : undefined };
      await api('/setter/opener', { method: 'POST', body });
      onSaved('Inicio del setter guardado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section label={`Inicio del setter · ${step.flowName}`} description="Tras recibir el recurso, la IA escribe primero uno de estos textos al azar. Si la persona contesta, sigue la conversación.">
      {step.delayNodeId && (
        <label className="mb-5 flex flex-wrap items-center gap-3 text-sm text-mist">
          Escribe a los
          <input className="field !w-24 text-center" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutos de espera" />
          minutos de recibir el recurso
          {minutes === '1' && <span className="rounded-md bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">1 min = modo de prueba (al publicar: 15)</span>}
        </label>
      )}
      <ol className="space-y-2">
        {texts.map((text, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className="mt-2.5 w-5 shrink-0 text-right text-xs text-smoke">{index + 1}.</span>
            <textarea className="field min-h-[48px] resize-y text-sm" value={text} onChange={(e) => setText(index, e.target.value)} aria-label={`Texto de inicio ${index + 1}`} />
            <button
              type="button"
              onClick={() => setTexts((current) => current.filter((_, i) => i !== index))}
              disabled={texts.length <= 1}
              aria-label={`Quitar el texto ${index + 1}`}
              className="mt-1.5 rounded-lg p-2 text-smoke transition-colors hover:bg-bad/10 hover:text-bad disabled:opacity-30"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SecondaryButton onClick={() => setTexts((current) => [...current, ''])} disabled={texts.length >= MAX_TEXTS}>
          <Plus size={13} /> Añadir texto
        </SecondaryButton>
        <button type="button" onClick={() => void save()} disabled={busy} className="btn-gold px-4 py-2 text-sm">
          {busy ? 'Guardando…' : 'Guardar inicio'}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Section>
  );
}
