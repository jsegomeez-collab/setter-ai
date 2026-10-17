import { useState, type FormEvent } from 'react';
import { AuthScreen, Field, FormError } from './AuthScreen';
import { useSession } from './SessionContext';

export function LoginPage() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Bienvenido" subtitle="Entra con tu correo y tu contraseña.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Correo">
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña">
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="btn-gold w-full px-4 py-2.5 text-sm">
          {busy ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </AuthScreen>
  );
}
