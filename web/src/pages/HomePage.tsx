import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { navFor } from '../shell/nav';

function greeting(hour: number): string {
  if (hour < 6 || hour >= 20) return 'Buenas noches';
  if (hour < 13) return 'Buenos días';
  return 'Buenas tardes';
}

/** Inicio: saludo y estado de cada módulo (cuál está hecho, cuál se construye y dónde se hace mientras tanto). */
export function HomePage() {
  const { user } = useSession();
  if (!user) return null;
  const modules = navFor(user.role).filter((item) => item.path !== '/');
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 lg:px-10 lg:py-10">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">
        {greeting(new Date().getHours())}, {firstName}
      </h1>
      <p className="mt-1 text-sm text-ash">Este es el nuevo panel. Cada sección se activa a medida que se construye; mientras, el panel actual sigue funcionando.</p>

      <p className="label mt-9">Secciones</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(({ path, label, icon: Icon, step, description }, index) => (
          <Link
            key={path}
            to={path}
            className={[
              'card group relative flex flex-col gap-3 p-5 transition-colors hover:border-white/12',
              index === 0 ? 'border-ember-500/40 sm:col-span-2 lg:col-span-1' : '',
            ].join(' ')}
          >
            <div className="flex items-center justify-between">
              <span className="label">{label}</span>
              <ArrowUpRight size={16} className="text-smoke transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ember-400" />
            </div>
            <Icon size={22} strokeWidth={1.6} className={index === 0 ? 'text-ember-400' : 'text-ash'} />
            <p className="text-sm text-mist">{description}</p>
            {step && (
              <span className={['w-fit rounded-md px-2 py-0.5 text-[11px] font-semibold', index === 0 ? 'bg-ember-500/12 text-ember-400' : 'bg-white/[0.04] text-smoke'].join(' ')}>
                {index === 0 ? `Siguiente · paso ${step}` : `Paso ${step}`}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
