import { ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';

/**
 * Primeros pasos de un cliente nuevo (Fase 7.5f): lo que le falta para que su setter funcione, en orden y con un
 * botón a cada sitio. Cada paso se marca solo (lo mira el servidor). Cuando está todo hecho, desaparece.
 */

type StepId = 'instagram' | 'links' | 'document' | 'setter' | 'sends';

interface Onboarding {
  readonly steps: readonly { readonly id: StepId; readonly done: boolean }[];
  readonly progress: { readonly done: number; readonly total: number };
}

const STEPS: Record<StepId, { title: string; hint: string; to?: string; cta?: string }> = {
  instagram: {
    title: 'Conecta tu Instagram',
    hint: 'Antes, acepta en Instagram la invitación de evaluador que te mandó Jose.',
    to: '/configuracion?tab=instagram',
    cta: 'Conectar',
  },
  links: { title: 'Pon tus enlaces', hint: 'Tu agenda, tu membresía y tu correo de contacto.', to: '/setter?tab=modo', cta: 'Poner enlaces' },
  document: { title: 'Sube tu documento del setter', hint: 'Lo que la IA sabe de ti y de lo que ofreces. Sin él, no responde.', to: '/setter?tab=documento', cta: 'Subir documento' },
  setter: { title: 'Enciende el setter', hint: 'Empieza en modo Prueba: solo responde a las cuentas que tú pongas.', to: '/setter?tab=modo', cta: 'Encender' },
  sends: { title: 'Jose activa tus envíos', hint: 'Cuando tengas lo demás, avísale: él activa los envíos de tu cuenta.' },
};

export function FirstSteps() {
  const [data, setData] = useState<Onboarding | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Onboarding>('/onboarding')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudieron cargar tus primeros pasos'));
  }, []);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data || data.progress.done === data.progress.total) return null;
  const next = data.steps.find((step) => !step.done)?.id;
  const percent = Math.round((data.progress.done / data.progress.total) * 100);

  return (
    <section aria-labelledby="primeros-pasos" className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="primeros-pasos" className="font-display text-lg font-bold text-snow">
          Primeros pasos
        </h2>
        <span className="text-xs font-semibold text-ash">
          {data.progress.done} de {data.progress.total} hechos
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de los primeros pasos">
        <div className="h-full rounded-full bg-ember-400 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <ol className="mt-4 space-y-2">
        {data.steps.map((step, index) => {
          const info = STEPS[step.id];
          const isNext = step.id === next;
          return (
            <li key={step.id} className={['flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5', isNext ? 'border-ember-500/40 bg-ember-500/[0.06]' : 'border-white/[0.06]'].join(' ')}>
              <span
                aria-hidden="true"
                className={['grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold', step.done ? 'bg-ok/15 text-ok' : isNext ? 'bg-ember-400 text-base' : 'bg-white/[0.06] text-ash'].join(' ')}
              >
                {step.done ? <Check size={13} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={['block text-sm font-semibold', step.done ? 'text-ash line-through decoration-white/20' : 'text-fog'].join(' ')}>
                  {info.title}
                  <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                </span>
                {!step.done && <span className="block text-xs text-smoke">{info.hint}</span>}
              </span>
              {!step.done && info.to && (
                <Link
                  to={info.to}
                  className={['inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 text-[13px] font-semibold', isNext ? 'btn-gold' : 'text-ember-400 hover:text-ember-300'].join(' ')}
                >
                  {info.cta} <ArrowRight size={14} />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
