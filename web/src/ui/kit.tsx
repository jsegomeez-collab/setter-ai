import type { ReactNode } from 'react';

/** Piezas comunes con el estilo de la referencia (tarjetas finas, etiquetas en mayúsculas, dorado para lo activo). */

type Tone = 'ok' | 'bad' | 'warn' | 'info';

const TONES: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok/[0.08] text-ok',
  bad: 'border-bad/30 bg-bad/[0.08] text-bad',
  warn: 'border-warn/30 bg-warn/[0.08] text-warn',
  info: 'border-info/30 bg-info/[0.08] text-info',
};

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}>
      {children}
    </p>
  );
}

/** Tarjeta de sección: etiqueta en mayúsculas + descripción + contenido (como "NUEVOS SEGUIDORES" en la referencia). */
export function Section({ label, description, actions, children }: { label: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="label">{label}</h2>
          {description && <p className="mt-1 text-[13px] text-ash">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

/** Opciones segmentadas: la elegida en dorado lleno (como "Balance (neto)" en la referencia). */
export function Segmented<T extends string>({ options, value, onChange, name }: { options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={[
              'rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-500',
              active ? 'border-ember-500 bg-ember-500 text-[#1a1406]' : 'border-white/8 bg-white/[0.03] text-fog hover:border-white/15',
            ].join(' ')}
          >
            <span className="block text-sm font-semibold">{option.label}</span>
            {option.hint && <span className={['mt-0.5 block text-xs', active ? 'text-[#3d2f0d]' : 'text-smoke'].join(' ')}>{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Pestañas en "pastillas" (como Día / Semana / Mes en la referencia). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={['rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors', active ? 'bg-ember-500/12 text-ember-400' : 'text-ash hover:text-fog'].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function SecondaryButton({ children, onClick, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[13px] font-semibold text-mist transition-colors hover:border-white/20 hover:text-fog disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
