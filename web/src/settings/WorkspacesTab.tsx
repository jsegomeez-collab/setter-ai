import { Building2, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { EmptyState, Loading } from '../ui/EmptyState';
import { Notice, Section, formatDate } from '../ui/kit';
import { TempPassword } from './UsersTab';

/**
 * Espacios (Fase 7.5b): solo en el espacio de Jose y solo admins (decisión de Jose: altas solo por invitación suya).
 * Cada espacio tiene sus datos aparte (su propia base) y su Instagram. Quien lo lleva entra con una clave temporal.
 */

interface WorkspaceItem {
  readonly id: string;
  readonly name: string;
  readonly igUsername: string | null;
  readonly createdAt: string;
  readonly people: readonly { readonly name: string; readonly email: string; readonly role: 'admin' | 'team' }[];
}

export function WorkspacesTab() {
  const [items, setItems] = useState<readonly WorkspaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ workspaces: WorkspaceItem[] }>('/workspaces')).workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ash">
        Cada espacio es una cuenta aparte: su Instagram, sus flujos, sus documentos, sus contactos y su equipo. Nadie ve lo de otro espacio. Tú lo creas y le pasas la clave temporal a quien lo
        lleva; antes, añade su Instagram como «Evaluador de Instagram» en tu app de Meta.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {temp && <TempPassword name={temp.name} password={temp.password} onClose={() => setTemp(null)} />}
      <NewWorkspaceForm
        onCreated={(name, password) => {
          setTemp({ name, password });
          void load();
        }}
      />
      <Section label="Espacios">
        {!items && <Loading />}
        {items?.length === 0 && (
          <EmptyState icon={Building2} title="Todavía no hay otros espacios">
            Crea el primero arriba, por ejemplo el de tu socio.
          </EmptyState>
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-white/[0.06]">
            {items.map((ws) => (
              <li key={ws.id} className="grid gap-1 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px] md:items-center md:gap-4">
                <span>
                  <span className="block text-sm font-semibold text-fog">{ws.name}</span>
                  <span className="block text-xs text-smoke">Creado el {formatDate(ws.createdAt)}</span>
                </span>
                <span className="text-xs text-ash">{ws.people.map((p) => `${p.name} (${p.email})`).join(' · ') || 'Sin nadie todavía'}</span>
                <span className={['text-xs font-semibold md:text-right', ws.igUsername ? 'text-ok' : 'text-warn'].join(' ')}>{ws.igUsername ? `@${ws.igUsername}` : 'Instagram sin conectar'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function NewWorkspaceForm({ onCreated }: { onCreated: (name: string, password: string) => void }) {
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { tempPassword } = await api<{ tempPassword: string }>('/workspaces', { method: 'POST', body: { name, adminName, adminEmail } });
      onCreated(adminName, tempPassword);
      setName('');
      setAdminName('');
      setAdminEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section label="Crear un espacio" description="Se crea su base de datos y una clave temporal para quien lo lleva (tendrá que cambiarla al entrar). Tarda unos segundos.">
      {error && <Notice tone="bad">{error}</Notice>}
      <form onSubmit={(e) => void submit(e)} className="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Nombre del espacio</span>
          <input className="field" required maxLength={60} placeholder="Ej.: Pedro (socio)" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Quién lo lleva</span>
          <input className="field" required maxLength={60} placeholder="Nombre" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Su correo</span>
          <input className="field" required type="email" placeholder="correo@ejemplo.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !adminName.trim() || !adminEmail.trim()} className="btn-gold inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 text-[13px]">
          <Plus size={14} /> {busy ? 'Creando…' : 'Crear espacio'}
        </button>
      </form>
    </Section>
  );
}
