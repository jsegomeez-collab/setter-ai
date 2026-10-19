import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { ROLE_LABEL } from '../lib/api';
import { Brand } from './Brand';
import { navFor } from './nav';

type Props = { onNavigate: () => void };

/** Menú lateral como el de la referencia: marca arriba, secciones con icono y el usuario con su rol abajo. */
export function Sidebar({ onNavigate }: Props) {
  const { user, logout } = useSession();
  if (!user) return null;
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <aside className="flex h-full w-[260px] flex-col bg-g1/95 px-3 py-4 backdrop-blur lg:bg-transparent">
      <div className="px-2 pb-4">
        <Brand />
      </div>
      <div className="mb-3 h-px bg-white/7" />
      <nav aria-label="Secciones" className="flex-1 space-y-1">
        {navFor(user.role).map(({ path, label, icon: Icon, step }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-display text-sm font-semibold tracking-[-0.01em] transition-colors',
                isActive ? 'border border-white/8 bg-white/[0.05] text-fog' : 'border border-transparent text-ash hover:bg-white/[0.03] hover:text-fog',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ember-500" />}
                <Icon size={18} strokeWidth={1.8} className={isActive ? 'text-ember-400' : 'text-smoke group-hover:text-ash'} />
                <span className="flex-1">{label}</span>
                {step && <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-sans text-xs font-semibold text-smoke">{step}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-3 h-px bg-white/7" />
      <div className="flex items-center gap-3 px-2 pt-4">
        <NavLink to="/cuenta" title="Mi cuenta (cambiar la clave)" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors hover:bg-white/[0.03]">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-ember-500/40 bg-ember-500/10 font-display text-sm font-bold text-ember-300">{initial}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-fog">{user.name}</p>
            <p className="text-xs text-smoke">{ROLE_LABEL[user.role]} · Mi cuenta</p>
          </div>
        </NavLink>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="rounded-lg p-2 text-smoke transition-colors hover:bg-white/[0.05] hover:text-fog focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-500"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
