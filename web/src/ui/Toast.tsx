import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Notificaciones (sistema de diseño §4): el resultado de una acción (guardado, error) arriba a la derecha, 4 s,
 * anunciado a los lectores de pantalla. Los avisos fijos de la página (p. ej. el bloqueo de Meta) NO van aquí.
 */

type Tone = 'ok' | 'bad' | 'info';
interface ToastItem {
  readonly id: number;
  readonly tone: Tone;
  readonly text: string;
}
type ToastFn = (text: string, tone?: Tone) => void;

const ToastContext = createContext<ToastFn | null>(null);
const DURATION_MS = 4000;
const ICON = { ok: CheckCircle2, bad: AlertTriangle, info: Info } as const;
const TONE = { ok: 'text-ok', bad: 'text-bad', info: 'text-info' } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);
  const close = useCallback((id: number) => setItems((current) => current.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastFn>(
    (text, tone = 'ok') => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { id, tone, text }]);
      window.setTimeout(() => close(id), DURATION_MS);
    },
    [close],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((item) => {
          const Icon = ICON[item.tone];
          return (
            <div key={item.id} role={item.tone === 'bad' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-3 rounded-[14px] border border-white/10 bg-g3 px-4 py-3 text-sm text-fog shadow-2xl shadow-black/50">
              <Icon size={18} className={`mt-0.5 shrink-0 ${TONE[item.tone]}`} aria-hidden />
              <p className="flex-1">{item.text}</p>
              <button type="button" aria-label="Cerrar aviso" onClick={() => close(item.id)} className="-m-1 rounded-md p-1 text-smoke hover:text-fog">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast fuera de ToastProvider');
  return value;
}
