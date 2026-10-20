import { Building2, Lock, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState, Loading } from '../ui/EmptyState';
import { Notice, Section, SecondaryButton, formatDate } from '../ui/kit';
import { useToast } from '../ui/Toast';
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
  /** Cerrojo de envíos (true = bloqueados hasta que Jose los active). null = el espacio no está en marcha. */
  readonly sendsLocked: boolean | null;
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
              <WorkspaceRow key={ws.id} ws={ws} onChanged={() => void load()} onError={setError} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Un espacio de la lista: quién lo lleva, su Instagram y sus envíos (nacen bloqueados; solo Jose los activa). */
function WorkspaceRow({ ws, onChanged, onError }: { ws: WorkspaceItem; onChanged: () => void; onError: (message: string) => void }) {
  const toast = useToast();
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/workspaces/${encodeURIComponent(ws.id)}/delete`, { method: 'POST', body: { confirm: ws.name } });
      toast(`Espacio «${ws.name}» borrado.`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo borrar');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const setLock = async (locked: boolean) => {
    setConfirmUnlock(false);
    try {
      await api(`/workspaces/${encodeURIComponent(ws.id)}/sends`, { method: 'POST', body: { locked } });
      toast(locked ? `Envíos de «${ws.name}» bloqueados.` : `Envíos de «${ws.name}» activados.`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo cambiar');
    }
  };

  return (
    <li className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto] md:items-center md:gap-4">
      <span>
        <span className="block text-sm font-semibold text-fog">{ws.name}</span>
        <span className="block text-xs text-smoke">Creado el {formatDate(ws.createdAt)}</span>
      </span>
      <span className="text-xs text-ash">{ws.people.map((p) => `${p.name} (${p.email})`).join(' · ') || 'Sin nadie todavía'}</span>
      <span className={['text-xs font-semibold md:text-right', ws.igUsername ? 'text-ok' : 'text-warn'].join(' ')}>{ws.igUsername ? `@${ws.igUsername}` : 'Instagram sin conectar'}</span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {ws.sendsLocked === null ? (
          <span className="text-xs text-bad">No está en marcha</span>
        ) : ws.sendsLocked ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-warn">
              <Lock size={12} /> Envíos bloqueados
            </span>
            <SecondaryButton onClick={() => setConfirmUnlock(true)}>Activar envíos</SecondaryButton>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-ok">
              <Send size={12} /> Envíos activos
            </span>
            <SecondaryButton onClick={() => void setLock(true)}>Bloquear</SecondaryButton>
          </>
        )}
        <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Borrar el espacio ${ws.name}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs text-smoke transition-colors hover:bg-bad/10 hover:text-bad">
          <Trash2 size={14} /> Borrar
        </button>
      </span>
      {confirmDelete && (
        <ConfirmDialog title={`Borrar el espacio «${ws.name}»`} word={ws.name.toUpperCase()} confirmLabel="Borrar para siempre" tone="bad" busy={deleting} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
          <p>Se borra para siempre su base de datos (contactos, conversaciones, flujos, documentos y ajustes) y se quita el acceso a {ws.people.map((p) => p.name).join(', ') || 'su equipo'}. No se puede deshacer.</p>
          {ws.igUsername && <p>Los mensajes y comentarios que lleguen a @{ws.igUsername} dejarán de guardarse (y nunca irán a tu espacio).</p>}
        </ConfirmDialog>
      )}
      {confirmUnlock && (
        <ConfirmDialog title={`Activar los envíos de «${ws.name}»`} word="ACTIVAR" confirmLabel="Activar envíos" onConfirm={() => void setLock(false)} onCancel={() => setConfirmUnlock(false)}>
          <p>Desde ese momento su setter, sus flujos y las respuestas a mano podrán escribir desde {ws.igUsername ? `@${ws.igUsername}` : 'su Instagram'}. Puedes volver a bloquearlos cuando quieras.</p>
        </ConfirmDialog>
      )}
    </li>
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
