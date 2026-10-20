import { Check, Copy, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../auth/SessionContext';
import { api, ROLE_LABEL, type Role } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Notice, Section, SecondaryButton, formatDate } from '../ui/kit';
import { Loading } from '../ui/EmptyState';

/** Usuarios (Fase 6.7). Decisión de Jose: el admin crea a la persona y le pasa una clave temporal (se ve una sola vez). */

interface UserItem {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
  readonly createdAt: string;
}

export function UsersTab() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<readonly UserItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [removing, setRemoving] = useState<UserItem | null>(null);

  const load = () =>
    api<{ users: UserItem[] }>('/users')
      .then((r) => setUsers(r.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  useEffect(() => {
    void load();
  }, []);

  const act = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo falló');
    }
  };

  const changeRole = (u: UserItem, role: Role) => act(async () => void (await api(`/users/${u.id}/role`, { method: 'POST', body: { role } })));
  const reset = (u: UserItem) =>
    act(async () => {
      const { tempPassword } = await api<{ tempPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
      setTemp({ name: u.name, password: tempPassword });
    });
  const remove = (u: UserItem) =>
    act(async () => {
      await api(`/users/${u.id}/delete`, { method: 'POST', body: { confirm: 'BORRAR' } });
      setRemoving(null);
    });

  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {temp && <TempPassword name={temp.name} password={temp.password} onClose={() => setTemp(null)} />}
      <NewUserForm
        onCreated={(name, password) => {
          setTemp({ name, password });
          void load();
        }}
      />
      <Section label="Quién tiene acceso" description="Admin: todo. Equipo: conversaciones, contactos y métricas (no toca el setter, los flujos ni la configuración).">
        {!users && <Loading />}
        <ul className="divide-y divide-white/[0.05]">
          {users?.map((u) => {
            const isMe = u.id === me?.id;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-semibold text-fog">
                    {u.name} {isMe && <span className="text-xs font-normal text-smoke">(tú)</span>}
                  </p>
                  <p className="text-xs text-ash">
                    {u.email} · desde {formatDate(u.createdAt)}
                    {u.mustChangePassword && <span className="ml-1 text-warn">· aún no ha cambiado la clave temporal</span>}
                  </p>
                </div>
                <select
                  aria-label={`Rol de ${u.name}`}
                  disabled={isMe}
                  value={u.role}
                  onChange={(e) => void changeRole(u, e.target.value as Role)}
                  className="rounded-lg border border-white/8 bg-g2 px-2.5 py-1.5 text-[13px] text-mist disabled:opacity-50"
                >
                  <option value="admin">{ROLE_LABEL.admin}</option>
                  <option value="team">{ROLE_LABEL.team}</option>
                </select>
                {!isMe && (
                  <>
                    <SecondaryButton onClick={() => void reset(u)}>
                      <KeyRound size={14} /> Nueva clave temporal
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setRemoving(u)}>
                      <Trash2 size={14} /> Quitar acceso
                    </SecondaryButton>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      {removing && (
        <ConfirmDialog title={`Quitar el acceso a ${removing.name}`} word="BORRAR" confirmLabel="Quitar acceso" tone="bad" onConfirm={() => void remove(removing)} onCancel={() => setRemoving(null)}>
          <p>No podrá volver a entrar y se cierran sus sesiones abiertas. Lo que hizo (mensajes a mano, etiquetas…) se queda.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function NewUserForm({ onCreated }: { onCreated: (name: string, password: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('team');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { tempPassword } = await api<{ tempPassword: string }>('/users', { method: 'POST', body: { email, name, role } });
      onCreated(name, tempPassword);
      setEmail('');
      setName('');
      setRole('team');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section label="Dar acceso a alguien" description="Se crea con una clave temporal que le pasas tú. Al entrar la primera vez tendrá que poner una suya.">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <input aria-label="Correo de la persona" className="field !w-[220px] !py-2 text-[13px]" type="email" required placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input aria-label="Nombre de la persona" className="field !w-[180px] !py-2 text-[13px]" required maxLength={60} placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Rol" value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-white/8 bg-g2 px-2.5 py-2 text-[13px] text-mist">
          <option value="team">{ROLE_LABEL.team}</option>
          <option value="admin">{ROLE_LABEL.admin}</option>
        </select>
        <button type="submit" disabled={busy} className="btn-gold inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px]">
          <UserPlus size={14} /> Crear
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Section>
  );
}

/** La clave temporal: se enseña UNA vez (no se guarda en claro en ningún sitio). */
export function TempPassword({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div role="status" className="rounded-xl border border-ember-500/40 bg-ember-500/[0.07] p-4">
      <p className="text-sm text-fog">
        Clave temporal de <strong>{name}</strong>. <strong>Solo se ve ahora:</strong> cópiala y pásasela por un canal privado.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-black/40 px-3 py-2 font-mono text-[15px] tracking-wide text-snow">{password}</code>
        <SecondaryButton onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiada' : 'Copiar'}
        </SecondaryButton>
        <SecondaryButton onClick={onClose}>Ya la tengo</SecondaryButton>
      </div>
    </div>
  );
}
