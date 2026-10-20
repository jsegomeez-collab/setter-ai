import { ArrowLeft, MessagesSquare, Plus, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { LeadPanel } from '../conversations/LeadPanel';
import { handle } from '../conversations/types';
import { api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Skeleton } from '../ui/EmptyState';
import { Notice, SecondaryButton, Section, formatDate } from '../ui/kit';
import { Page, PageHeader } from '../ui/PageHeader';
import { Avatar, ReelCover, StageChip } from '../ui/visual';
import { useToast } from '../ui/Toast';
import type { ContactDetail } from './types';

/**
 * Ficha de una persona (Fase 6.3; 7.4: datos propios y cabecera común): etiquetas y datos a mano, ficha de la IA,
 * comentarios y borrar sus datos (admin, escribiendo BORRAR).
 */
export function ContactDetailPage() {
  const { igId = '' } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [erasing, setErasing] = useState(false);
  const path = `/contacts/${encodeURIComponent(igId)}`;

  const load = useCallback(async () => {
    try {
      setDetail(await api<ContactDetail>(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Ejecuta un cambio y recarga la ficha; el error sale arriba. */
  async function change(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      if (done) toast(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const tags = (body: { add?: string; remove?: string }) => change(() => api(`${path}/tags`, { method: 'POST', body })).then((ok) => ok && setNewTag(''));
  const setField = (field: string, value: string) => change(() => api(`${path}/fields`, { method: 'POST', body: { field, value } }), value ? 'Dato guardado.' : 'Dato borrado.');

  async function erase() {
    setBusy(true);
    try {
      await api(`${path}/delete`, { method: 'POST', body: { confirm: 'BORRAR' } });
      navigate('/contactos', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar');
      setErasing(false);
      setBusy(false);
    }
  }

  if (!detail) {
    return <Page>{error ? <Notice tone="bad">{error}</Notice> : <Skeleton className="h-40 w-full" />}</Page>;
  }
  const { contact, comments, leadHistory, hasConversation } = detail;

  return (
    <Page>
      <Link to="/contactos" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ash hover:text-fog">
        <ArrowLeft size={14} /> Contactos
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={contact.username ?? contact.igId} picture={contact.picture} size={52} />
            {handle(contact.username, contact.igId)}
            <StageChip stage={contact.stage} size="lg" />
          </span>
        }
        description={`Desde ${formatDate(contact.firstSeen)} · última vez ${formatDate(contact.lastSeen)}`}
        actions={
          hasConversation && (
            <Link to={`/conversaciones/${encodeURIComponent(contact.igId)}`} className="btn-gold inline-flex items-center gap-2 px-4 py-2 text-sm">
              <MessagesSquare size={15} /> Ver conversación
            </Link>
          )
        }
      />
      <div className="mt-6 space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Section label="Etiquetas" description="Las pone un flujo o la IA; también las puedes poner o quitar a mano.">
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.length === 0 && <span className="text-sm text-smoke">Sin etiquetas.</span>}
                {contact.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] py-1 pl-2 pr-1 text-xs text-mist">
                    {tag}
                    <button type="button" onClick={() => void tags({ remove: tag })} disabled={busy} aria-label={`Quitar la etiqueta ${tag}`} className="rounded p-1 text-smoke hover:text-bad">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={(e: FormEvent) => (e.preventDefault(), void tags({ add: newTag }))} className="mt-3 flex gap-2">
                <input aria-label="Nueva etiqueta" className="field max-w-[260px] text-sm" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" maxLength={40} />
                <SecondaryButton type="submit" disabled={busy || !newTag.trim()}>
                  <Plus size={13} /> Añadir
                </SecondaryButton>
              </form>
            </Section>

            <FieldsSection fields={contact.fields} busy={busy} onSet={setField} />

            <Section label="Reels" description="De qué reel vino (su primer comentario) y el último en el que comentó.">
              <div className="grid gap-3 sm:grid-cols-2">
                <ReelLine title="De dónde vino" label={contact.sourceLabel} cover={contact.sourceCover} />
                <ReelLine title="Último en el que comentó" label={contact.lastLabel} cover={contact.lastCover} />
              </div>
            </Section>

            <Section label={`Comentarios (${comments.length})`}>
              {comments.length === 0 ? (
                <p className="text-sm text-smoke">No hay comentarios guardados.</p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.commentId} className="flex gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                      {c.reelLabel && <ReelCover src={c.reelCover} size={30} />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-fog">{c.text}</span>
                        <span className="mt-0.5 block text-xs text-smoke">
                          {formatDate(c.createdAt)}
                          {c.reelLabel ? ` · ${c.reelLabel}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <section className="card p-5">
              <LeadPanel lead={contact.lead} leadHistory={leadHistory} />
            </section>
            {user?.role === 'admin' && (
              <section className="card border-bad/20 p-5">
                <p className="label">Zona peligrosa</p>
                <p className="mt-1 text-[13px] text-ash">Borra todo lo de esta persona (como cuando escribe BORRAR). No se puede deshacer.</p>
                <button type="button" onClick={() => setErasing(true)} disabled={busy} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-bad/30 px-3 py-1.5 text-[13px] font-semibold text-bad hover:bg-bad/10">
                  <Trash2 size={13} /> Borrar sus datos
                </button>
              </section>
            )}
          </div>
        </div>
      </div>

      {erasing && (
        <ConfirmDialog title={`Borrar los datos de ${handle(contact.username, contact.igId)}`} word="BORRAR" confirmLabel="Borrar" tone="bad" busy={busy} onConfirm={() => void erase()} onCancel={() => setErasing(false)}>
          <p>Se borran el contacto, su ficha, sus mensajes y sus comentarios. No se puede deshacer.</p>
        </ConfirmDialog>
      )}
    </Page>
  );
}

/** Datos propios (los guarda el paso "Guardar un dato" de un flujo): verlos, ponerlos, cambiarlos y borrarlos a mano. */
function FieldsSection({ fields, busy, onSet }: { fields: Readonly<Record<string, string>>; busy: boolean; onSet: (field: string, value: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Section label="Datos propios" description="Los guarda el paso «Guardar un dato» de un flujo; también los puedes poner o cambiar a mano. Sirven para las condiciones y salen en el CSV.">
      {entries.length === 0 ? (
        <p className="text-sm text-smoke">Todavía no tiene datos propios.</p>
      ) : (
        <dl className="divide-y divide-white/[0.06] rounded-lg border border-white/8">
          {entries.map(([field, current]) => (
            <div key={field} className="flex items-center gap-3 px-3 py-2">
              <dt className="w-32 shrink-0 truncate text-xs font-semibold text-ash">{field}</dt>
              <dd className="min-w-0 flex-1 break-words text-sm text-fog">{current}</dd>
              <button
                type="button"
                onClick={() => {
                  setName(field);
                  setValue(current);
                }}
                className="text-xs font-semibold text-ember-400 hover:text-ember-300"
              >
                Cambiar
              </button>
              <button type="button" aria-label={`Borrar el dato ${field}`} disabled={busy} onClick={() => void onSet(field, '')} className="rounded p-1 text-smoke hover:text-bad">
                <X size={13} />
              </button>
            </div>
          ))}
        </dl>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSet(name.trim(), value.trim()).then(() => {
            setName('');
            setValue('');
          });
        }}
      >
        <input aria-label="Nombre del dato" className="field max-w-[180px] text-sm" placeholder="Nombre (p. ej. ciudad)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Valor del dato" className="field min-w-[160px] flex-1 text-sm" placeholder="Valor" maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} />
        <SecondaryButton type="submit" disabled={busy || !name.trim() || !value.trim()}>
          <Save size={13} /> Guardar dato
        </SecondaryButton>
      </form>
    </Section>
  );
}

/** Un reel de la persona con su portada (Fase 8). */
function ReelLine({ title, label, cover }: { title: string; label: string | null; cover: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-2.5">
      <ReelCover src={label ? cover : null} size={40} />
      <span className="min-w-0">
        <span className="block text-xs text-smoke">{title}</span>
        <span className="line-clamp-2 block text-sm text-fog">{label ?? 'Ninguno'}</span>
      </span>
    </div>
  );
}
