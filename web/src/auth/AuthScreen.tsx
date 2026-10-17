import type { ReactNode } from 'react';
import { Brand } from '../shell/Brand';

/** Marco común del login y del alta: fondo oscuro con el brillo dorado de la referencia y una tarjeta centrada. */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(212,165,58,0.28), rgba(212,165,58,0) 65%)' }}
      />
      <main className="card relative w-full max-w-[420px] p-7 shadow-2xl shadow-black/40">
        <Brand />
        <h1 className="mt-7 font-display text-[26px] font-extrabold tracking-[-0.03em] text-snow">{title}</h1>
        <p className="mt-1 text-sm text-ash">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-mist">{label}</span>
      {children}
    </label>
  );
}
