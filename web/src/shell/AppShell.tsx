import { PanelLeft } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { NAV } from './nav';
import { Sidebar } from './Sidebar';

/** Marco de la app: menú lateral fijo (desplegable en el móvil) + panel principal redondeado con cabecera. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const section = NAV.find((item) => (item.path === '/' ? pathname === '/' : pathname.startsWith(item.path)))?.label ?? 'Inicio';

  return (
    <div className="relative flex h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-48 -top-48 h-[560px] w-[560px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(212,165,58,0.22), rgba(212,165,58,0) 65%)' }}
      />
      <div className="hidden lg:block">
        <Sidebar onNavigate={() => undefined} />
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <Sidebar onNavigate={() => setMenuOpen(false)} />
          <button type="button" aria-label="Cerrar menú" className="flex-1 bg-black/60" onClick={() => setMenuOpen(false)} />
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 p-0 lg:py-3 lg:pr-3">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-white/7 bg-g1/70 lg:rounded-[20px] lg:border">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
            <button
              type="button"
              aria-label="Abrir menú"
              onClick={() => setMenuOpen(true)}
              className="rounded-lg border border-white/8 p-1.5 text-ash transition-colors hover:text-fog lg:hidden"
            >
              <PanelLeft size={16} />
            </button>
            <p className="font-display text-sm font-semibold text-snow">{section}</p>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
