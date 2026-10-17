import { ExternalLink } from 'lucide-react';
import type { NavItem } from '../shell/nav';

/** Sección aún sin construir: dice en qué paso llega y enlaza a la página del panel actual que la hace mientras tanto. */
export function PendingModule({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-10 lg:px-10">
      <div className="card p-7">
        <Icon size={26} strokeWidth={1.6} className="text-ember-400" />
        <h1 className="mt-4 font-display text-[24px] font-extrabold tracking-[-0.03em] text-snow">{item.label}</h1>
        <p className="mt-1 text-sm text-ash">{item.description}</p>
        <p className="mt-5 rounded-lg border border-warn/25 bg-warn/[0.07] px-3 py-2 text-sm text-warn">
          Se construye en el paso {item.step} de la Fase 6.
          {item.legacyPath ? ' Mientras tanto, usa el panel actual.' : ''}
        </p>
        {item.legacyPath && (
          <a href={item.legacyPath} className="btn-gold mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm">
            Abrir en el panel actual <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
