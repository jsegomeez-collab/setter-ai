import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Ventana de confirmación que pide escribir una palabra (ACTIVAR, BORRAR) para acciones con consecuencias reales. */
export function ConfirmDialog({
  title,
  children,
  word,
  confirmLabel,
  tone = 'gold',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  word: string;
  confirmLabel: string;
  tone?: 'gold' | 'bad';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const ready = typed.trim().toUpperCase() === word && !busy;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4" role="presentation" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card w-full max-w-md bg-g2 p-6"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onConfirm();
        }}
      >
        <h2 className="font-display text-xl font-extrabold text-snow">{title}</h2>
        <div className="mt-3 space-y-2 text-sm text-mist">{children}</div>
        <label className="mt-5 block text-xs text-ash">
          Escribe <strong className="text-fog">{word}</strong> para confirmar
          <input ref={input} className="field mt-1.5" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-[13px] font-semibold text-ash hover:text-fog">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!ready}
            className={tone === 'bad' ? 'rounded-[10px] bg-bad px-4 py-2 text-[13px] font-bold text-[#1a0608] disabled:opacity-40' : 'btn-gold px-4 py-2 text-[13px]'}
          >
            {busy ? 'Un momento…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
