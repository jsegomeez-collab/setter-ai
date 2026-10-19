import { formatDate } from '../ui/kit';
import { STAGE_LABEL, type ConversationDetail } from './types';

/** Campos de la ficha en el orden en que más importan (los demás van detrás). */
const FIRST_FIELDS = ['siguiente_paso', 'nivel', 'tipo_lead', 'puede_invertir', 'resumen', 'objeciones'];

const show = (value: unknown): string => (Array.isArray(value) ? value.join(' · ') : String(value));

/** Ficha del lead (lo que la IA ha ido apuntando) y cómo ha cambiado su etapa. */
export function LeadPanel({ detail }: { detail: ConversationDetail }) {
  const lead = detail.contact.lead ?? {};
  const fields = Object.entries(lead)
    .filter(([, value]) => value !== null && value !== '' && value !== 'desconocido' && !(Array.isArray(value) && value.length === 0))
    .sort(([a], [b]) => rank(a) - rank(b));

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Ficha</p>
        {fields.length === 0 ? (
          <p className="mt-2 text-sm text-smoke">Aún no hay ficha: la IA la rellena al conversar.</p>
        ) : (
          <dl className="mt-2 space-y-2">
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt className="text-[11px] text-smoke">{key.replace(/_/g, ' ')}</dt>
                <dd className="text-sm text-fog">{key === 'siguiente_paso' ? (STAGE_LABEL[String(value)] ?? show(value)) : show(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {detail.contact.tags.length > 0 && (
        <div>
          <p className="label">Etiquetas</p>
          <p className="mt-2 flex flex-wrap gap-1">
            {detail.contact.tags.map((tag) => (
              <span key={tag} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-ash">
                {tag}
              </span>
            ))}
          </p>
        </div>
      )}
      {detail.leadHistory.length > 0 && (
        <div>
          <p className="label">Historial de la ficha</p>
          <ol className="mt-2 space-y-1.5">
            {detail.leadHistory.map((h, i) => {
              const step = typeof h.lead?.siguiente_paso === 'string' ? h.lead.siguiente_paso : null;
              return (
                <li key={i} className="flex justify-between gap-3 text-xs">
                  <span className="text-smoke">{formatDate(h.createdAt)}</span>
                  <span className="text-mist">{step ? (STAGE_LABEL[step] ?? step) : '—'}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function rank(key: string): number {
  const index = FIRST_FIELDS.indexOf(key);
  return index === -1 ? FIRST_FIELDS.length : index;
}
