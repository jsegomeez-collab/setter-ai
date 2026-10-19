import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Estado vacío (sistema de diseño §4): qué falta y qué hacer. Nunca un "Nada." suelto. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-ember-400">
        <Icon size={20} aria-hidden />
      </span>
      <p className="font-semibold text-fog">{title}</p>
      {children && <p className="max-w-[46ch] text-sm text-ash">{children}</p>}
      {action}
    </div>
  );
}

/** Esqueleto de carga: bloques grises con un brillo suave (sin brillo si se pide "reducir movimiento"). */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-white/[0.06] ${className}`} />;
}

/** Carga de un bloque (sistema de diseño §4): esqueletos en vez de un "Cargando…" suelto; el texto queda para lectores de pantalla. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? 'h-5 w-1/3' : 'h-12 w-full'} />
      ))}
    </div>
  );
}
