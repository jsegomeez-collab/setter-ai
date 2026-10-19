import { Link } from 'react-router';
import { useState } from 'react';
import { Tabs, formatDate } from '../ui/kit';
import { SECTIONS, money, type AnalysisRun, type SectionKey } from './types';

/** Un análisis guardado: resumen y hallazgos por sección, cada uno con sus citas enlazadas a la conversación. */
export function RunView({ run }: { run: AnalysisRun }) {
  const [tab, setTab] = useState<SectionKey>('objeciones');
  const { sections, summary, dropped } = run.result;
  const current = SECTIONS.find((s) => s.key === tab);
  const items = sections[tab] ?? [];
  return (
    <div className="space-y-4">
      <p className="text-xs text-smoke">
        {formatDate(run.createdAt)} · {run.createdBy} · {run.conversations} conversación(es){run.skipped ? ` (+${run.skipped} no cupieron)` : ''} · {money(run.costUsd)} · {run.model}
      </p>
      {summary && <p className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-sm leading-relaxed text-mist">{summary}</p>}
      {(dropped.findings > 0 || dropped.quotes > 0) && (
        <p className="text-xs text-ash">
          Comprobación automática: se descartaron {dropped.quotes} cita(s) que no aparecían tal cual en las conversaciones
          {dropped.findings ? ` y ${dropped.findings} hallazgo(s) que se quedaron sin citas` : ''}.
        </p>
      )}
      <Tabs tabs={SECTIONS.map((s) => ({ value: s.key, label: `${s.label} (${sections[s.key]?.length ?? 0})` }))} value={tab} onChange={setTab} />
      <p className="text-xs text-smoke">{current?.hint}</p>
      {items.length === 0 && <p className="text-sm text-smoke">Nada en esta sección.</p>}
      <ul className="space-y-3">
        {items.map((finding) => (
          <li key={finding.title} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-fog">{finding.title}</p>
              <span className="text-xs text-ash">en {finding.count} conversación(es)</span>
            </div>
            {finding.hook && <p className="mt-1 text-sm text-ember-400">Gancho: “{finding.hook}”</p>}
            {finding.detail && <p className="mt-1 text-[13px] text-ash">{finding.detail}</p>}
            <ul className="mt-3 space-y-1.5 border-l border-white/10 pl-3">
              {finding.evidence.map((e, i) => (
                <li key={`${e.igId}-${i}`} className="text-[13px] text-mist">
                  “{e.quote}”{' '}
                  <Link to={`/conversaciones/${encodeURIComponent(e.igId)}`} className="text-xs text-smoke hover:text-ember-400">
                    — @{e.username ?? e.igId}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
