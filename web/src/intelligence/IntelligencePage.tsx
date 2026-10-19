import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Notice, Section, Tabs, formatDate } from '../ui/kit';
import { RunView } from './RunView';
import { VALUE_LABEL, money, type AnalysisRun, type AnalysisRunSummary, type Preview, type ReelTraffic } from './types';

/** Inteligencia (Fase 6.6): análisis de conversaciones con IA (botón manual, cuesta dinero) y tráfico por reel (gratis). */

type PeriodTab = 'all' | '30' | '7';
const PERIODS: readonly { value: PeriodTab; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: '30', label: '30 días' },
  { value: '7', label: '7 días' },
];

export function IntelligencePage() {
  const [period, setPeriod] = useState<PeriodTab>('30');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<readonly AnalysisRunSummary[] | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Algo falló');
  const open = useCallback((id: number) => {
    api<{ run: AnalysisRun }>(`/intelligence/runs/${id}`)
      .then((r) => setRun(r.run))
      .catch(fail);
  }, []);
  const loadRuns = useCallback(() => {
    api<{ runs: AnalysisRunSummary[] }>('/intelligence/runs')
      .then(({ runs: list }) => {
        setRuns(list);
        if (list[0]) open(list[0].id);
      })
      .catch(fail);
  }, [open]);

  useEffect(loadRuns, [loadRuns]);
  useEffect(() => {
    setPreview(null);
    api<Preview>(`/intelligence/preview?days=${period}`).then(setPreview).catch(fail);
  }, [period]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>('/intelligence/run', { method: 'POST', body: { days: period, confirm: 'ANALIZAR' } });
      setConfirming(false);
      loadRuns();
      open(id);
    } catch (err) {
      setConfirming(false);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1150px] px-5 py-8 lg:px-10 lg:py-10">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">Inteligencia</h1>
      <p className="mt-1 text-sm text-ash">Lo que dice la gente en las conversaciones: objeciones, dolores, su lenguaje e ideas de reels. Todo con sus citas reales.</p>

      <div className="mt-6 space-y-5">
        {error && <Notice tone="bad">{error}</Notice>}
        <Section label="Nuevo análisis" description="Con IA (Sonnet 5.5). Solo cuando tú lo pulses: cuesta dinero. Analiza lo que escriben las personas y lo que responde el setter (no el flujo ni los “sí”)." actions={<Tabs tabs={PERIODS} value={period} onChange={setPeriod} />}>
          {!preview && <p className="text-sm text-smoke">Calculando…</p>}
          {preview && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-mist">
                <strong className="text-fog">{preview.conversations}</strong> conversación(es) con algo que analizar
                {preview.skipped ? ` (+${preview.skipped} que no caben: se usan las más recientes)` : ''} · coste como mucho <strong className="text-fog">≈ {money(preview.estimatedCostUsd)}</strong> (se calcula por arriba)
              </p>
              <button type="button" disabled={!preview.available || preview.conversations === 0 || busy || preview.running} onClick={() => setConfirming(true)} className="btn-gold inline-flex items-center gap-1.5 px-4 py-2 text-[13px]">
                <Sparkles size={14} /> Analizar
              </button>
            </div>
          )}
          {preview && !preview.available && <p className="mt-2 text-xs text-warn">Falta la clave de Anthropic en el servidor: no se puede analizar.</p>}
          {preview?.conversations === 0 && <p className="mt-2 text-xs text-smoke">Todavía no hay conversaciones con algo que analizar en este periodo (el setter está en prueba y los envíos, bloqueados).</p>}
          {busy && <p className="mt-2 text-xs text-ash">Analizando… puede tardar uno o dos minutos. No cierres la página.</p>}
        </Section>

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Section label="Análisis guardados">
            {!runs && <p className="text-sm text-smoke">Cargando…</p>}
            {runs?.length === 0 && <p className="text-sm text-smoke">Todavía no hay ninguno.</p>}
            <ul className="space-y-1.5">
              {runs?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => open(r.id)}
                    className={['w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors', run?.id === r.id ? 'bg-ember-500/12 text-ember-400' : 'text-mist hover:bg-white/[0.04]'].join(' ')}
                  >
                    <span className="block font-semibold">{formatDate(r.createdAt)}</span>
                    <span className="block text-xs text-ash">
                      {r.conversations} conv. · {r.findings} hallazgos · {money(r.costUsd)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <Section label="Resultado">{run ? <RunView run={run} /> : <p className="text-sm text-smoke">Elige un análisis o haz uno nuevo.</p>}</Section>
        </div>

        <Traffic />
      </div>

      {confirming && preview && (
        <ConfirmDialog title="Analizar conversaciones" word="ANALIZAR" confirmLabel="Analizar" busy={busy} onConfirm={analyze} onCancel={() => setConfirming(false)}>
          <p>
            Se mandan a Claude Sonnet 5.5 <strong className="text-fog">{preview.conversations}</strong> conversación(es). Coste como mucho: <strong className="text-fog">≈ {money(preview.estimatedCostUsd)}</strong> (se cobra a tu cuenta de Anthropic; el real suele salir por debajo y se guarda con el análisis).
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Counts({ values }: { values: Readonly<Record<string, number>> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return <span className="text-smoke">—</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {entries.map(([key, n]) => (
        <span key={key} className="whitespace-nowrap rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-mist">
          {VALUE_LABEL[key] ?? key}: {n}
        </span>
      ))}
    </span>
  );
}

/** Tráfico por reel: sin IA y gratis, sumando las fichas que rellena el setter. */
function Traffic() {
  const [reels, setReels] = useState<readonly ReelTraffic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ reels: ReelTraffic[] }>('/intelligence/traffic')
      .then((r) => setReels(r.reels))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, []);
  const withLeads = reels?.filter((r) => r.withLead > 0) ?? [];
  return (
    <Section label="Tráfico por reel" description="Qué tipo de persona atrae cada reel, sumando las fichas del setter (sin IA, gratis). Solo salen los reels con alguna ficha.">
      {error && <Notice tone="bad">{error}</Notice>}
      {!reels && !error && <p className="text-sm text-smoke">Cargando…</p>}
      {reels && withLeads.length === 0 && <p className="text-sm text-smoke">Todavía no hay fichas: se rellenan cuando el setter habla con la gente.</p>}
      {withLeads.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.07] text-xs text-smoke">
                <th className="py-2 pr-3 font-semibold">Reel</th>
                <th className="px-3 py-2 text-right font-semibold">Fichas</th>
                <th className="px-3 py-2 text-right font-semibold">Tipo</th>
                <th className="px-3 py-2 text-right font-semibold">Nivel</th>
                <th className="px-3 py-2 text-right font-semibold">¿Puede invertir?</th>
                <th className="px-3 py-2 text-right font-semibold">Etapa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {withLeads.map((r) => (
                <tr key={r.mediaId}>
                  <td className="max-w-[260px] truncate py-2 pr-3 text-mist">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fog">
                    {r.withLead} / {r.people}
                  </td>
                  <td className="px-3 py-2">
                    <Counts values={r.tipo} />
                  </td>
                  <td className="px-3 py-2">
                    <Counts values={r.nivel} />
                  </td>
                  <td className="px-3 py-2">
                    <Counts values={r.invertir} />
                  </td>
                  <td className="px-3 py-2">
                    <Counts values={r.paso} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
