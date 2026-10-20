import { ExternalLink, Table2, TrendingUp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { STAGE_LABEL } from '../conversations/types';
import { api } from '../lib/api';
import { Notice, SecondaryButton, Section, Tabs } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { DayLines, HBars, type BarRow } from './charts';
import { DM_FAILURES, MAIN_PATH, SERIES, STEP, percent, type FunnelCounts, type MetricsResponse, type StepKey } from './types';
import { Loading } from '../ui/EmptyState';
import { ReelCover } from '../ui/visual';

type PeriodTab = 'all' | '7' | '30';
const PERIODS: readonly { value: PeriodTab; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: '30', label: '30 días' },
  { value: '7', label: '7 días' },
];

const pctText = (value: number | null): string | undefined => (value === null ? undefined : `${value} %`);

/** Una fila de barra por paso, con el % sobre el paso del que sale. */
function stepRows(counts: FunnelCounts, steps: readonly StepKey[]): BarRow[] {
  return steps.map((key) => {
    const base = STEP[key].base;
    const pct = base ? percent(counts[key], counts[base]) : null;
    return { key, label: STEP[key].title, value: counts[key], note: pctText(pct), hint: base && pct !== null ? `${pct} % de "${STEP[base].title}"` : undefined };
  });
}

/** Métricas (Fase 6.4): embudo, por día, por reel, setter y agenda. */
export function MetricsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('days');
  const period: PeriodTab = raw === '7' || raw === '30' ? raw : 'all';
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<MetricsResponse>(`/metrics?days=${period}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [period]);

  return (
    <Page>
      <PageHeader
        title="Métricas"
        description="Del comentario en el reel hasta la llamada: cuántas personas pasan cada paso."
        actions={<Tabs tabs={PERIODS} value={period} onChange={(value) => setParams(value === 'all' ? {} : { days: value })} />}
      />
      <div className="mt-6 space-y-5">
        {error && <Notice tone="bad">{error}</Notice>}
        {!data && !error && <Loading />}
        {data && <Dashboard data={data} />}
      </div>
    </Page>
  );
}

function Dashboard({ data }: { data: MetricsResponse }) {
  const { total, byDay, byReel } = data.funnel;
  const agendaPct = percent(data.agenda.clicked, data.agenda.offered);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Comentaron" value={total.commented} />
        <Kpi label="Les llegó el DM" value={total.reached} note={pctText(percent(total.reached, total.commented))} />
        <Kpi label="Escribieron por DM" value={total.wrote} note={pctText(percent(total.wrote, total.reached))} />
        <Kpi label="Cualificados" value={total.qualified} note={pctText(percent(total.qualified, total.wrote))} />
        <Kpi label="Clic en la agenda" value={data.agenda.clicked} note={agendaPct === null ? 'sin ofrecer' : `${agendaPct} % de ${data.agenda.offered}`} />
      </div>

      <Section label="Embudo" description="Personas únicas en el periodo (según la fecha de su comentario). El % es sobre el paso del que sale.">
        <ChartOrTable
          chart={
            <div className="space-y-6">
              <HBars label="Embudo principal" rows={stepRows(total, MAIN_PATH)} />
              <div>
                <p className="label mb-3">Cuando Meta rechaza el DM</p>
                <HBars label="DM rechazados" rows={stepRows(total, DM_FAILURES)} scaleMax={total.commented} />
              </div>
            </div>
          }
          table={<CountsTable first="Paso" rows={[...MAIN_PATH, ...DM_FAILURES].map((key) => ({ key, name: STEP[key].title, cells: [total[key]] }))} headers={['Personas']} />}
        />
      </Section>

      <Section label="Por día" description="Días en UTC. Los días sin comentarios cuentan como 0.">
        {byDay.length === 0 ? (
          <Empty />
        ) : (
          <ChartOrTable
            chart={
              <DayLines
                label="Comentarios y DM entregados por día"
                days={byDay.map((d) => d.key)}
                series={[
                  { label: STEP.commented.title, color: SERIES.first, values: byDay.map((d) => d.commented) },
                  { label: STEP.reached.title, color: SERIES.second, values: byDay.map((d) => d.reached) },
                ]}
              />
            }
            table={
              <CountsTable
                first="Día"
                headers={['Comentaron', 'Les llegó el DM', 'Escribieron', 'Cualificados']}
                rows={[...byDay].reverse().map((d) => ({ key: d.key, name: d.key, cells: [d.commented, d.reached, d.wrote, d.qualified] }))}
              />
            }
          />
        )}
      </Section>

      <Section label="Por reel" description="Quien comenta en 2 reels cuenta en los dos. Pidieron, escribieron y cualificados son de la persona, no del reel.">
        {byReel.length === 0 ? (
          <Empty />
        ) : (
          <CountsTable
            first="Reel"
            headers={['Comentaron', 'DM', 'Pidieron', 'Escribieron', 'Cualificados']}
            rows={byReel.map((r) => ({
              key: r.key,
              name: r.label,
              link: r.permalink,
              cover: r.cover,
              cells: [r.commented, withPct(r.reached, r.commented), withPct(r.asked, r.reached), withPct(r.wrote, r.reached), withPct(r.qualified, r.wrote)],
            }))}
          />
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section label="Setter IA · etapa actual" description="El “siguiente paso” de cada ficha. Todo el histórico (no depende del periodo).">
          {data.setter.stages.length === 0 ? (
            <Empty text="Todavía no hay fichas." />
          ) : (
            <HBars label="Conversaciones por etapa" rows={data.setter.stages.map((s) => ({ key: s.step, label: STAGE_LABEL[s.step] ?? s.step, value: s.n }))} />
          )}
          {data.setter.transitions.length > 0 && (
            <>
              <p className="label mb-2 mt-6">Cambios de etapa</p>
              <ul className="divide-y divide-white/[0.05] text-[13px]">
                {data.setter.transitions.map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex justify-between gap-3 py-1.5 text-mist">
                    <span>
                      {STAGE_LABEL[t.from] ?? t.from} → {STAGE_LABEL[t.to] ?? t.to}
                    </span>
                    <span className="tabular-nums text-fog">{t.n}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
        <Section label="Agenda" description="Ofrecida = le llegó el botón “Agendar llamada”. Clic = lo pulsó. Las reservas no se miden aquí (GoHighLevel).">
          <HBars
            label="Agenda"
            rows={[
              { key: 'offered', label: 'Agenda ofrecida', value: data.agenda.offered },
              { key: 'clicked', label: 'Clic en la agenda', value: data.agenda.clicked, note: pctText(agendaPct), hint: agendaPct === null ? undefined : `${agendaPct} % de la agenda ofrecida` },
            ]}
          />
        </Section>
      </div>

      <details className="card p-5 text-[13px] text-ash">
        <summary className="cursor-pointer font-semibold text-mist">Cómo se cuenta cada paso</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li><strong className="text-mist">Les llegó el DM</strong>: Meta aceptó el DM a su comentario, o se le rescató después por DM.</li>
          <li><strong className="text-mist">DM rechazado</strong>: Meta rechazó el DM a algún comentario suyo. Plan B y rescatados salen de ahí.</li>
          <li><strong className="text-mist">Pidieron el recurso</strong>: pulsaron el botón o escribieron “sí”. <strong className="text-mist">Siguen</strong>: Meta dijo que siguen la cuenta.</li>
          <li><strong className="text-mist">Clic en el recurso</strong>: abrieron un enlace con seguimiento. <strong className="text-mist">Escribieron por DM</strong>: mandaron algún mensaje (su % es sobre “Les llegó el DM”).</li>
          <li><strong className="text-mist">Cualificados</strong>: el setter dejó la ficha en “agendar llamada”. Con el setter en modo prueba sale casi a 0.</li>
        </ul>
      </details>
    </>
  );
}

const withPct = (value: number, base: number): string => {
  const pct = percent(value, base);
  return pct === null ? String(value) : `${value} · ${pct} %`;
};

function Kpi({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-2 font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-snow tabular-nums">{value}</p>
      {note && <p className="mt-1.5 text-xs text-ash">{note}</p>}
    </div>
  );
}

function Empty({ text = 'Todavía no hay comentarios en este periodo.' }: { text?: string }) {
  return <p className="text-sm text-smoke">{text}</p>;
}

/** Cada gráfico tiene su vista de tabla (accesibilidad y para copiar números). */
function ChartOrTable({ chart, table }: { chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <SecondaryButton onClick={() => setAsTable(!asTable)}>
          {asTable ? <TrendingUp size={14} /> : <Table2 size={14} />} {asTable ? 'Ver gráfico' : 'Ver tabla'}
        </SecondaryButton>
      </div>
      {asTable ? table : chart}
    </div>
  );
}

interface TableRow {
  readonly key: string;
  readonly name: string;
  readonly link?: string | null;
  /** Portada del reel (Fase 8); undefined = la tabla no lleva portadas. */
  readonly cover?: string | null;
  readonly cells: readonly (number | string)[];
}

function CountsTable({ first, headers, rows }: { first: string; headers: readonly string[]; rows: readonly TableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-white/[0.07] text-xs text-smoke">
            <th className="py-2 pr-3 font-semibold">{first}</th>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-right font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-white/[0.02]">
              <td className="max-w-[320px] py-2 pr-3 text-mist">
                <span className="flex items-center gap-2">
                  {row.cover !== undefined && <ReelCover src={row.cover} size={28} />}
                  <span className="truncate">{row.name}</span>
                  {row.link && (
                    <a href={row.link} target="_blank" rel="noopener noreferrer" aria-label="Abrir el reel en Instagram" className="shrink-0 text-smoke hover:text-ember-400">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </span>
              </td>
              {row.cells.map((cell, i) => (
                <td key={headers[i]} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fog">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
