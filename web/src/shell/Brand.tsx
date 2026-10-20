import { useSession } from '../auth/SessionContext';

/**
 * Marca del menú: "Jose News AI · Setter IA" (decisión de Jose). El logo real se pondrá cuando lo pase.
 * En otro espacio (Fase 7.5) sale el nombre de ese espacio con su inicial.
 */
export function Brand() {
  const { workspace } = useSession();
  const name = workspace?.name ?? 'Jose News AI';
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-full border border-ember-500/40 bg-gradient-to-b from-ember-500/25 to-ember-700/10 font-display text-sm font-extrabold text-ember-300">
        {name.trim().charAt(0).toUpperCase() || 'S'}
      </div>
      <div className="leading-tight">
        <p className="max-w-[170px] truncate font-display text-[15px] font-bold tracking-[-0.01em] text-snow">{name}</p>
        <p className="label !text-xs !tracking-[1.6px]">Setter IA</p>
      </div>
    </div>
  );
}
