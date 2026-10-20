import { Bot, FlaskConical, Globe, PowerOff } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { modelLabel } from '../lib/labels';
import { Notice, Section, Segmented, type SegmentOption } from '../ui/kit';
import { LinksSection } from './LinksSection';
import type { SetterData, SetterMode } from './types';

const MODES: readonly SegmentOption<SetterMode>[] = [
  { value: 'off', label: 'Apagado', hint: 'Guarda los mensajes pero no responde.', icon: PowerOff },
  { value: 'test', label: 'Prueba', hint: 'Solo responde a los usuarios de prueba.', icon: FlaskConical },
  { value: 'live', label: 'Público', hint: 'Responde a todo el que escriba.', icon: Globe },
];

/** Cómo se ve cada modo guardado en el aviso de arriba (Fase 8: el estado, de un vistazo). */
const NOW: Readonly<Record<SetterMode, { title: string; tone: string; ring: string }>> = {
  off: { title: 'Apagado: no responde a nadie', tone: 'text-smoke', ring: 'bg-white/[0.06]' },
  test: { title: 'En prueba', tone: 'text-warn', ring: 'bg-warn/15' },
  live: { title: 'Respondiendo a todo el que escribe', tone: 'text-ok', ring: 'bg-ok/15' },
};

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
      <NowBanner data={data} />
      <Section label="Modo del setter" description={`Modelo: ${modelLabel(data.model)}. Pasar a Público lo decide Jose.`}>
        <Segmented name="Modo del setter" options={MODES} value={mode} onChange={setMode} />
        {mode === 'live' && data.mode !== 'live' && (
          <div className="mt-3">
            <Notice tone="warn">Con Público la IA contestará a todo el que escriba. Asegúrate de que está bien entrenada antes de guardar.</Notice>
          </div>
        )}
      </Section>

      <LinksSection links={data.links} onSaved={() => onSaved('Enlaces guardados.')} />

      <Section label="Usuarios de prueba" description="En modo Prueba solo les responde a ellos. Separa los nombres con comas.">
        <input aria-label="Usuarios de prueba" className="field" value={usernames} onChange={(e) => setUsernames(e.target.value)} placeholder="josegomezlife, otra_cuenta" />
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

/** Qué hace el setter AHORA (lo guardado, no lo que se está eligiendo abajo): icono grande, color y a quién responde. */
function NowBanner({ data }: { data: SetterData }) {
  const now = NOW[data.mode];
  const who =
    data.mode === 'test'
      ? `Solo responde a ${data.testUsernames.map((u) => `@${u}`).join(', ') || 'nadie (no hay usuarios de prueba)'}`
      : data.mode === 'live'
        ? data.draft
          ? 'Modo borrador: tú apruebas cada respuesta antes de que salga'
          : 'Responde solo, sin esperar a que lo apruebes'
        : 'Los mensajes se guardan en Conversaciones';
  return (
    <div className="card flex items-center gap-4 p-5" role="status">
      <span className={['grid h-14 w-14 shrink-0 place-items-center rounded-2xl', now.ring].join(' ')}>
        <Bot size={26} className={now.tone} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-ash">Ahora mismo</span>
        <span className="block font-display text-xl font-extrabold text-snow">{now.title}</span>
        <span className="block text-sm text-ash">{who}</span>
      </span>
    </div>
  );
}
