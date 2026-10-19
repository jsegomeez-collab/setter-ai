import type { ReactNode } from 'react';

/**
 * Cabecera única de cada página (sistema de diseño §3): título + qué es + acciones. Sustituye a la barra de arriba
 * que repetía el título. `width`: 'read' (gestión, máx. 1200 px) o 'full' (espacios de trabajo).
 */
export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-snow">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-sm text-ash">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Contenedor de las páginas de gestión: ancho máximo 1200 px y márgenes 16 / 24 / 32 px. */
export function Page({ children, width = 'read' }: { children: ReactNode; width?: 'read' | 'full' }) {
  return <div className={['mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', width === 'read' ? 'max-w-[1200px]' : ''].join(' ')}>{children}</div>;
}
