import { useState, type FormEvent } from 'react';
import { AuthScreen, Field, FormError } from './AuthScreen';
import { useSession } from './SessionContext';

const MIN_PASSWORD = 12;

/** Alta del primer admin. Solo aparece mientras no hay ningún usuario y pide la clave actual del panel (ADMIN_PASSWORD). */
export function SetupPage() {
  const { setup } = useSession();
  const [form, setForm] = useState({ setupKey: '', name: '', email: '', password: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD) return setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
    if (form.password !== form.repeat) return setError('Las dos contraseñas no coinciden.');
    setBusy(true);
    setError(null);
    try {
      await setup({ setupKey: form.setupKey, name: form.name, email: form.email, password: form.password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Crea tu cuenta de admin" subtitle="Solo se hace una vez. Para comprobar que eres tú, pon la contraseña del panel actual.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Contraseña del panel actual">
          <input className="field" type="password" autoComplete="off" required value={form.setupKey} onChange={(e) => update('setupKey')(e.target.value)} />
        </Field>
        <Field label="Tu nombre">
          <input className="field" autoComplete="name" required maxLength={60} value={form.name} onChange={(e) => update('name')(e.target.value)} />
        </Field>
        <Field label="Correo">
          <input className="field" type="email" autoComplete="email" required value={form.email} onChange={(e) => update('email')(e.target.value)} />
        </Field>
        <Field label={`Contraseña nueva (mínimo ${MIN_PASSWORD} caracteres)`}>
          <input className="field" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => update('password')(e.target.value)} />
        </Field>
        <Field label="Repite la contraseña">
          <input className="field" type="password" autoComplete="new-password" required value={form.repeat} onChange={(e) => update('repeat')(e.target.value)} />
        </Field>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="btn-gold w-full px-4 py-2.5 text-sm">
          {busy ? 'Creando…' : 'Crear cuenta y entrar'}
        </button>
      </form>
    </AuthScreen>
  );
}
