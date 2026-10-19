import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Field, FormError } from './AuthScreen';
import { useSession } from './SessionContext';

const MIN_LENGTH = 12;

/** Cambiar la propia clave (Fase 6.7): la temporal al entrar la primera vez, o cuando uno quiera desde "Mi cuenta". */
export function ChangePasswordForm({ currentLabel = 'Clave actual', onDone }: { currentLabel?: string; onDone?: () => void }) {
  const { passwordChanged } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) return setError(`La clave nueva tiene que tener ${MIN_LENGTH} caracteres o más.`);
    if (next !== repeat) return setError('Las dos claves nuevas no coinciden.');
    setBusy(true);
    try {
      await api('/me/password', { method: 'POST', body: { current, next } });
      passwordChanged();
      setCurrent('');
      setNext('');
      setRepeat('');
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la clave');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={currentLabel}>
        <input className="field" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label={`Clave nueva (${MIN_LENGTH}+ caracteres)`}>
        <input className="field" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Repite la clave nueva">
        <input className="field" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <FormError message={error} />
      <button type="submit" disabled={busy} className="btn-gold w-full px-4 py-2.5 text-sm">
        {busy ? 'Guardando…' : 'Cambiar la clave'}
      </button>
    </form>
  );
}
