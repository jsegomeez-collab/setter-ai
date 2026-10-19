import type { ReactNode } from 'react';
import type { Flow, FlowsResponse } from './types';

/** Ajustes del flujo (cuando no hay ningún paso elegido en el lienzo): cuándo salta y cómo responde en público. */

const lines = (value: string) => value.split('\n').map((t) => t.trimStart());
const commas = (value: string) => value.split(',').map((t) => t.trim()).filter(Boolean);

export function FlowSettings({ flow, reels, onChange }: { flow: Flow; reels: FlowsResponse['reels']; onChange: (flow: Flow) => void }) {
  const set = (patch: Partial<Flow>) => onChange({ ...flow, ...patch });
  const chosen = flow.trigger.mediaIds === 'all' ? null : new Set(flow.trigger.mediaIds);
  const toggleReel = (id: string) => {
    const next = new Set(chosen ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ trigger: { ...flow.trigger, mediaIds: [...next] } });
  };
  // Reels elegidos que ya no salen en la lista de los últimos (se conservan aunque no se vean).
  const hidden = chosen ? [...chosen].filter((id) => !reels.some((r) => r.mediaId === id)) : [];

  return (
    <div className="space-y-5">
      <p className="label">Ajustes del flujo</p>
      <Field label="Nombre">
        <input className="field" maxLength={80} value={flow.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <Field label="¿En qué reels salta?" warn={chosen !== null && chosen.size === 0} hint={chosen !== null && chosen.size === 0 ? 'Elige al menos un reel.' : undefined}>
        <div className="mb-2 flex gap-2 text-[12px]">
          <Choice active={chosen === null} onClick={() => set({ trigger: { ...flow.trigger, mediaIds: 'all' } })}>
            Todos
          </Choice>
          <Choice active={chosen !== null} onClick={() => chosen === null && set({ trigger: { ...flow.trigger, mediaIds: [] } })}>
            Solo los elegidos
          </Choice>
        </div>
        {chosen !== null && (
          <ul className="max-h-[220px] space-y-1 overflow-y-auto rounded-lg border border-white/8 p-2">
            {reels.map((reel) => (
              <li key={reel.mediaId}>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-mist">
                  <input type="checkbox" checked={chosen.has(reel.mediaId)} onChange={() => toggleReel(reel.mediaId)} className="accent-ember-500" />
                  <span className="truncate">{reel.label}</span>
                </label>
              </li>
            ))}
            {hidden.map((id) => (
              <li key={id} className="text-xs text-smoke">
                + reel antiguo {id} (elegido)
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Palabras clave (separadas por comas)" hint="Vacío = cualquier comentario del reel.">
        <input className="field" value={flow.trigger.keywords.join(', ')} onChange={(e) => set({ trigger: { ...flow.trigger, keywords: commas(e.target.value) } })} />
      </Field>

      <Field label="Respuestas públicas al comentario (una por línea, se elige una al azar)">
        <textarea className="field min-h-[90px]" value={flow.publicReplies.join('\n')} onChange={(e) => set({ publicReplies: lines(e.target.value) })} />
      </Field>

      <Field label="Plan B (si Meta rechaza el DM): respuestas públicas" hint="Desactivado temporalmente por el bloqueo de Meta: déjalo vacío hasta que decidamos reactivarlo." warn={flow.dmFailedReplies.some(Boolean)}>
        <textarea className="field min-h-[70px]" value={flow.dmFailedReplies.join('\n')} onChange={(e) => set({ dmFailedReplies: lines(e.target.value) })} />
      </Field>

      <Field label="Modo prueba: solo responde a estos usuarios (separados por comas)" hint="Vacío = responde a todo el mundo.">
        <input className="field" value={flow.testUsernames.join(', ')} onChange={(e) => set({ testUsernames: commas(e.target.value) })} />
      </Field>

      <Field label="¿Cuántas veces a la misma persona?">
        <select
          className="field"
          value={!flow.oncePerUser ? 'always' : flow.onceScope}
          onChange={(e) => set(e.target.value === 'always' ? { oncePerUser: false } : { oncePerUser: true, onceScope: e.target.value as Flow['onceScope'] })}
        >
          <option value="media">Una vez por persona y por reel</option>
          <option value="flow">Una sola vez por persona en todo el flujo</option>
          <option value="always">Cada vez que comente</option>
        </select>
      </Field>
    </div>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={['rounded-lg px-3 py-1.5 font-semibold', active ? 'bg-ember-500/15 text-ember-400' : 'text-ash hover:text-fog'].join(' ')}>
      {children}
    </button>
  );
}

function Field({ label, hint, warn = false, children }: { label: string; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <div>
      <p className={['mb-1.5 text-xs font-semibold', warn ? 'text-warn' : 'text-mist'].join(' ')}>{label}</p>
      {children}
      {hint && <p className={['mt-1 text-xs', warn ? 'text-warn' : 'text-smoke'].join(' ')}>{hint}</p>}
    </div>
  );
}
