import { CircleCheck, CircleHelp, CircleX, GraduationCap, Building2, Gauge, type LucideIcon } from 'lucide-react';
import { fieldLabel, valueLabel } from '../lib/labels';
import { formatDate } from '../ui/kit';
import { StageChip, stageMeta } from '../ui/visual';

type Props = {
  readonly lead: Record<string, unknown> | null;
  readonly tags?: readonly string[];
  /** Datos propios (Fase 7.4), solo para leer aquí; se cambian en la ficha de Contactos. */
  readonly fields?: Readonly<Record<string, string>>;
  readonly leadHistory: readonly { readonly lead: Record<string, unknown> | null; readonly createdAt: string }[];
};

/** Lo que se pinta aparte (camino, fichas, resumen, objeciones); el resto de campos va en la lista de abajo. */
const SHOWN_APART = new Set(['siguiente_paso', 'nivel', 'tipo_lead', 'puede_invertir', 'resumen', 'objeciones']);
const EMPTY = new Set(['', 'desconocido']);

/** El camino normal de un lead (Fase 8): de Nuevo a una oferta. "Pasar a Jose" y "Descartado" salen del camino. */
const PATH = ['nuevo', 'seguir_calificando', 'oferta'] as const;
const PATH_LABEL: Record<(typeof PATH)[number], string> = { nuevo: 'Nuevo', seguir_calificando: 'Calificando', oferta: 'Oferta' };

const INVEST: Record<string, { icon: LucideIcon; text: string; tone: string }> = {
  si: { icon: CircleCheck, text: 'Puede invertir', tone: 'text-ok' },
  no: { icon: CircleX, text: 'No puede invertir', tone: 'text-bad' },
  duda: { icon: CircleHelp, text: 'Duda si invertir', tone: 'text-warn' },
};

const known = (value: unknown): value is string => typeof value === 'string' && !EMPTY.has(value);

/**
 * Ficha del lead (Fase 8: visual): en qué punto del camino está, sus datos clave como fichas con icono, el resumen,
 * las objeciones y cómo ha cambiado su etapa. Lo usan Conversaciones y Contactos.
 */
export function LeadPanel({ lead: rawLead, tags = [], fields: customFields = {}, leadHistory }: Props) {
  const lead = rawLead ?? {};
  const stage = known(lead.siguiente_paso) ? lead.siguiente_paso : null;
  const rest = Object.entries(lead)
    .filter(([key, value]) => !SHOWN_APART.has(key) && value !== null && !EMPTY.has(String(value)) && !(Array.isArray(value) && value.length === 0))
    .sort(([a], [b]) => a.localeCompare(b));
  const objections = Array.isArray(lead.objeciones) ? lead.objeciones.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
  const invest = known(lead.puede_invertir) ? INVEST[lead.puede_invertir] : undefined;

  return (
    <div className="space-y-5">
      <section aria-label="Etapa">
        <p className="label">Etapa</p>
        <div className="mt-2">
          <StageChip stage={stage} size="lg" />
        </div>
        <StagePath stage={stage} />
      </section>

      {rawLead === null ? (
        <p className="text-sm text-smoke">Aún no hay ficha: la IA la rellena al conversar.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {known(lead.nivel) && <Fact icon={Gauge} text={valueLabel(lead.nivel)} />}
            {known(lead.tipo_lead) && <Fact icon={lead.tipo_lead === 'empresa_dfy' ? Building2 : GraduationCap} text={valueLabel(lead.tipo_lead)} />}
            {invest && <Fact icon={invest.icon} text={invest.text} tone={invest.tone} />}
          </div>
          {known(lead.resumen) && (
            <blockquote className="rounded-lg border-l-2 border-ember-500/60 bg-white/[0.03] px-3 py-2 text-sm leading-relaxed text-fog">{lead.resumen}</blockquote>
          )}
          {objections.length > 0 && (
            <div>
              <p className="label">Objeciones</p>
              <p className="mt-2 flex flex-wrap gap-1">
                {objections.map((objection) => (
                  <span key={objection} className="rounded-md border border-bad/25 bg-bad/[0.07] px-2 py-0.5 text-xs text-fog">
                    {objection}
                  </span>
                ))}
              </p>
            </div>
          )}
          {rest.length > 0 && (
            <dl className="space-y-2">
              {rest.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-smoke">{fieldLabel(key)}</dt>
                  <dd className="text-sm text-fog">{valueLabel(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {Object.keys(customFields).length > 0 && (
        <div>
          <p className="label">Datos propios</p>
          <dl className="mt-2 space-y-1.5">
            {Object.entries(customFields).map(([field, value]) => (
              <div key={field} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-xs leading-5 text-smoke">{field}</dt>
                <dd className="min-w-0 break-words text-fog">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {tags.length > 0 && (
        <div>
          <p className="label">Etiquetas</p>
          <p className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-xs text-ash">
                {tag}
              </span>
            ))}
          </p>
        </div>
      )}
      {leadHistory.length > 0 && (
        <div>
          <p className="label">Historial de la etapa</p>
          <ol className="mt-3 space-y-0">
            {leadHistory.map((h, i) => {
              const step = typeof h.lead?.siguiente_paso === 'string' ? h.lead.siguiente_paso : null;
              const meta = stageMeta(step);
              return (
                <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < leadHistory.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-white/10" />}
                  <span aria-hidden="true" className={['relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-g1', meta.solid].join(' ')} />
                  <span className="flex min-w-0 flex-1 justify-between gap-3 text-xs">
                    <span className="font-semibold text-mist">{meta.label}</span>
                    <span className="text-smoke">{formatDate(h.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Dato clave como ficha con icono (el icono lleva el color; el texto, el de siempre). */
function Fact({ icon: Icon, text, tone = 'text-ember-400' }: { icon: LucideIcon; text: string; tone?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-xs font-semibold text-fog">
      <Icon size={13} className={tone} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Camino del lead en 3 pasos; si está fuera del camino (Pasar a Jose, Descartado), lo dice debajo. */
function StagePath({ stage }: { stage: string | null }) {
  const meta = stageMeta(stage);
  const offPath = meta.id === 'derivar_a_jose' || meta.id === 'descartar';
  const reached = meta.id === 'nuevo' ? 0 : meta.id === 'seguir_calificando' ? 1 : offPath ? -1 : 2;
  return (
    <div className="mt-3">
      <ol className="flex items-center gap-1" aria-label="Camino del lead">
        {PATH.map((step, index) => {
          const done = reached >= index;
          return (
            <li key={step} className="flex min-w-0 flex-1 flex-col gap-1">
              <span aria-hidden="true" className={['h-1.5 rounded-full', done ? (index === reached ? meta.solid : 'bg-white/30') : 'bg-white/[0.08]'].join(' ')} />
              <span className={['truncate text-xs', index === reached ? 'font-semibold text-fog' : 'text-smoke'].join(' ')}>
                {PATH_LABEL[step]}
                {index === reached && <span className="sr-only"> (aquí)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {offPath && <p className="mt-1.5 text-xs text-ash">{meta.hint}.</p>}
    </div>
  );
}
