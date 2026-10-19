import { useState } from 'react';
import { api } from '../lib/api';
import { modelLabel } from '../lib/labels';
import { Notice, Section, Segmented, type SegmentOption } from '../ui/kit';
import type { SetterData, SetterMode } from './types';

const MODES: readonly SegmentOption<SetterMode>[] = [
  { value: 'off', label: 'Apagado', hint: 'Guarda los mensajes pero no responde.' },
  { value: 'test', label: 'Prueba', hint: 'Solo responde a los usuarios de prueba.' },
  { value: 'live', label: 'Público', hint: 'Responde a todo el que escriba.' },
];

type Props = { data: SetterData; onSaved: (message: string) => void };

export function ModeTab({ data, onSaved }: Props) {
  const [mode, setMode] = useState<SetterMode>(data.mode);
  const [draft, setDraft] = useState(data.draft);
  const [usernames, setUsernames] = useState(data.testUsernames.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const testUsernames = usernames.split(/[,\s]+/).filter(Boolean);
      await api('/setter/settings', { method: 'POST', body: { mode, draft, testUsernames } });
      onSaved('Ajustes guardados.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section label="Modo del setter" description={`Modelo: ${modelLabel(data.model)}. Pasar a Público lo decide Jose.`}>
        <Segmented name="Modo del setter" options={MODES} value={mode} onChange={setMode} />
        {mode === 'live' && data.mode !== 'live' && (
          <div className="mt-3">
            <Notice tone="warn">Con Público la IA contestará a todo el que escriba. Asegúrate de que está bien entrenada antes de guardar.</Notice>
          </div>
        )}
      </Section>

      <Section label="Usuarios de prueba" description="En modo Prueba solo les responde a ellos. Separa los nombres con comas.">
        <input className="field" value={usernames} onChange={(e) => setUsernames(e.target.value)} placeholder="josegomezlife, otra_cuenta" />
      </Section>

      <Section label="Modo borrador" description="La IA escribe la respuesta pero no la envía: la apruebas o la descartas desde la conversación.">
        <label className="flex cursor-pointer items-center gap-3 text-sm text-mist">
          <input type="checkbox" className="h-4 w-4 accent-[#d4a53a]" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Retener las respuestas para aprobarlas antes de enviarlas
        </label>
      </Section>

      {error && <Notice tone="bad">{error}</Notice>}
      <button type="button" onClick={() => void save()} disabled={busy} className="btn-gold px-5 py-2.5 text-sm">
        {busy ? 'Guardando…' : 'Guardar ajustes'}
      </button>
    </div>
  );
}
