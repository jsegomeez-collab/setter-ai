import { Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Notice, Section } from '../ui/kit';
import type { ScenarioInfo, SetterData, SimulationResponse } from './types';

const CUSTOM = 'personalizado';

type Props = { data: SetterData };

/** Simulador: una IA hace de lead (según el perfil) y conversa con el setter con el documento y el marco actuales. */
export function SimulatorTab({ data }: Props) {
  const [selected, setSelected] = useState<string>(data.scenarios[0]?.id ?? CUSTOM);
  const [persona, setPersona] = useState('');
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupBy(data.scenarios), [data.scenarios]);
  const scenario = data.scenarios.find((s) => s.id === selected) ?? null;

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = selected === CUSTOM ? { persona } : { scenarioId: selected };
      setResult(await api<SimulationResponse>('/setter/simulate', { method: 'POST', body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La simulación falló');
    } finally {
      setBusy(false);
    }
  }

  if (!data.simulator.available) return <Notice tone="warn">{data.simulator.reason ?? 'El simulador no está disponible.'}</Notice>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <Section label="Escenario" description="Elige un perfil de lead o escribe el tuyo. Usa el documento y el marco técnico guardados.">
        <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group}>
              <p className="label mb-1.5">{group}</p>
              {items.map((s) => (
                <ScenarioButton key={s.id} title={s.title} active={s.id === selected} onClick={() => setSelected(s.id)} />
              ))}
            </div>
          ))}
          <div>
            <p className="label mb-1.5">Tu perfil</p>
            <ScenarioButton title="Escribir un perfil a mano" active={selected === CUSTOM} onClick={() => setSelected(CUSTOM)} />
          </div>
        </div>
      </Section>

      <div className="space-y-4">
        <Section label={scenario?.title ?? 'Perfil personalizado'} description={scenario ? `Qué debería pasar: ${scenario.check}` : 'Describe quién es el lead y cómo responde.'}>
          {scenario ? (
            <p className="text-sm text-mist">{scenario.persona}</p>
          ) : (
            <textarea className="field min-h-[110px] text-sm" value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Ej.: tengo una clínica dental en Miami y quiero automatizar las citas…" />
          )}
          <button type="button" onClick={() => void run()} disabled={busy || (!scenario && !persona.trim())} className="btn-gold mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Play size={14} /> {busy ? 'Simulando… (puede tardar 1-2 minutos)' : 'Simular conversación'}
          </button>
          {error && (
            <div className="mt-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
        </Section>
        {result && <SimulationView result={result} />}
      </div>
    </div>
  );
}

function ScenarioButton({ title, active, onClick }: { title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={['mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors', active ? 'bg-ember-500/12 font-semibold text-ember-400' : 'text-mist hover:bg-white/[0.04]'].join(' ')}
    >
      {title}
    </button>
  );
}

function SimulationView({ result }: { result: SimulationResponse }) {
  const lead = Object.entries(result.lead ?? {}).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && value.length === 0));
  return (
    <>
      <Section label="Resultado" description={`${result.endReason} · Coste ${result.cost.total.toFixed(4)} $ (setter ${result.cost.setter.toFixed(4)} $ con ${result.model})`}>
        {result.verdict && <Notice tone={result.verdict.ok ? 'ok' : 'bad'}>{result.verdict.detail}</Notice>}
        <ol className="mt-4 space-y-3">
          {result.turns.map((turn, index) => (
            <li key={index} className={['flex', turn.who === 'setter' ? 'justify-end' : 'justify-start'].join(' ')}>
              <div className={['flex max-w-[85%] flex-col gap-1.5', turn.who === 'setter' ? 'items-end' : 'items-start'].join(' ')}>
                <p className="label">{turn.who === 'setter' ? 'Setter IA' : 'Lead (simulado)'}</p>
                {turn.texts.map((text, i) => (
                  <p key={i} className={['w-fit whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm', turn.who === 'setter' ? 'bg-ember-500/15 text-ember-50' : 'bg-white/[0.06] text-fog'].join(' ')}>
                    {text}
                  </p>
                ))}
                {turn.note && <p className="text-xs text-warn">{turn.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Section>
      {lead.length > 0 && (
        <Section label="Ficha final" description="Lo que la IA apuntó del lead.">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)]">
            {lead.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-xs text-smoke">{key}</dt>
                <dd className="text-sm text-fog">{Array.isArray(value) ? value.join(' · ') : String(value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </>
  );
}

function groupBy(scenarios: readonly ScenarioInfo[]): Map<string, ScenarioInfo[]> {
  return scenarios.reduce((map, s) => map.set(s.group, [...(map.get(s.group) ?? []), s]), new Map<string, ScenarioInfo[]>());
}
