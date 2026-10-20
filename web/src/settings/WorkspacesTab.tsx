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
  /** Avance de sus primeros pasos (7.5f). null = no está en marcha. */
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly people: readonly { readonly name: string; readonly email: string; readonly role: 'admin' | 'team' }[];
}

export function WorkspacesTab() {
  const [items, setItems] = useState<readonly WorkspaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; email: string; password: string } | null>(null);

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
        Cada cliente es una cuenta aparte: su Instagram, sus flujos, sus documentos, sus contactos y su equipo. Nadie ve lo de otro cliente. Tú lo creas y le pasas la clave temporal a su dueño; antes, añade su Instagram como «Evaluador de Instagram» en tu app de Meta.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {temp && <TempPassword name={temp.name} password={temp.password} message={welcomeMessage(temp.name, temp.email, temp.password)} onClose={() => setTemp(null)} />}
      <NewWorkspaceForm
        onCreated={(name, email, password) => {
          setTemp({ name, email, password });
          void load();
        }}
      />
      <Section label="Clientes">
        {!items && <Loading />}
        {items?.length === 0 && (
          <EmptyState icon={Building2} title="Todavía no hay clientes">
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

/** Mensaje para mandar al dueño de un cliente nuevo por WhatsApp (7.5f): todo lo que necesita para empezar. */
function welcomeMessage(name: string, email: string, password: string): string {
  return [
    `Hola ${name}, ya tienes tu cuenta en Setter IA.`,
    '',
    '1. Acepta en Instagram la invitación de evaluador que te he mandado: Perfil → Configuración → Aplicaciones y sitios web → Invitaciones de evaluador.',
    `2. Entra en ${window.location.origin}/app con tu correo ${email} y esta clave temporal: ${password} (al entrar te pedirá una nueva).`,
    '3. En Inicio verás tus primeros pasos: conectar tu Instagram, poner tus enlaces, subir tu documento del setter y encenderlo.',
    '',
    'Cuando lo tengas, avísame y activo tus envíos.',
  ].join('\n');
}

/** Un cliente de la lista: su dueño, su avance, su Instagram y sus envíos (nacen bloqueados; solo Jose los activa). */
function WorkspaceRow({ ws, onChanged, onError }: { ws: WorkspaceItem; onChanged: () => void; onError: (message: string) => void }) {
  const toast = useToast();
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/workspaces/${encodeURIComponent(ws.id)}/delete`, { method: 'POST', body: { confirm: ws.name } });
      toast(`Cliente «${ws.name}» borrado.`);
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
        {ws.progress && (
          <span className={['mt-0.5 block text-xs font-semibold', ws.progress.done === ws.progress.total ? 'text-ok' : 'text-ash'].join(' ')}>
            {ws.progress.done === ws.progress.total ? 'Primeros pasos completos' : `${ws.progress.done} de ${ws.progress.total} primeros pasos`}
          </span>
        )}
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
        <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Borrar el cliente ${ws.name}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs text-smoke transition-colors hover:bg-bad/10 hover:text-bad">
          <Trash2 size={14} /> Borrar
        </button>
      </span>
      {confirmDelete && (
        <ConfirmDialog title={`Borrar el cliente «${ws.name}»`} word={ws.name.toUpperCase()} confirmLabel="Borrar para siempre" tone="bad" busy={deleting} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
          <p>Se borra para siempre su base de datos (contactos, conversaciones, flujos, documentos y ajustes) y se quita el acceso a {ws.people.map((p) => p.name).join(', ') || 'su equipo'}. No se puede deshacer.</p>
          {ws.igUsername && <p>Los mensajes y comentarios que lleguen a @{ws.igUsername} dejarán de guardarse (y nunca irán a tu cuenta).</p>}
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

function NewWorkspaceForm({ onCreated }: { onCreated: (name: string, email: string, password: string) => void }) {
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
      onCreated(adminName, adminEmail, tempPassword);
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
    <Section label="Crear un cliente" description="Se crea su cuenta aparte y una clave temporal para su dueño (tendrá que cambiarla al entrar). Tarda unos segundos.">
      {error && <Notice tone="bad">{error}</Notice>}
      <form onSubmit={(e) => void submit(e)} className="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Nombre del cliente</span>
          <input className="field" required maxLength={60} placeholder="Ej.: Pedro (socio)" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Nombre del dueño</span>
          <input className="field" required maxLength={60} placeholder="Nombre" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-mist">Correo del dueño</span>
          <input className="field" required type="email" placeholder="correo@ejemplo.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !adminName.trim() || !adminEmail.trim()} className="btn-gold inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 text-[13px]">
          <Plus size={14} /> {busy ? 'Creando…' : 'Crear cliente'}
        </button>
      </form>
    </Section>
  );
}
