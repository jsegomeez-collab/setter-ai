import { ArrowLeft, MessagesSquare, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useSession } from '../auth/SessionContext';
import { LeadPanel } from '../conversations/LeadPanel';
import { handle } from '../conversations/types';
import { api } from '../lib/api';
import { Notice, SecondaryButton, Section, formatDate } from '../ui/kit';
import type { ContactDetail } from './types';

/** Ficha de una persona (Fase 6.3): datos, etiquetas a mano, ficha de la IA, comentarios y borrar sus datos (admin). */
export function ContactDetailPage() {
  const { igId = '' } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
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

  async function tags(body: { add?: string; remove?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api(`${path}/tags`, { method: 'POST', body });
      setNewTag('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la etiqueta');
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    const typed = window.prompt('Esto borra el contacto, su ficha, sus mensajes y sus comentarios. No se puede deshacer. Escribe BORRAR para confirmar.');
    if (typed !== 'BORRAR') return;
    setBusy(true);
    try {
      await api(`${path}/delete`, { method: 'POST', body: { confirm: 'BORRAR' } });
      navigate('/contactos', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar');
      setBusy(false);
    }
  }

  if (!detail) return <div className="p-8 text-sm text-smoke">{error ?? 'Cargando…'}</div>;
  const { contact, comments, leadHistory, hasConversation } = detail;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4 px-5 py-8 lg:px-10 lg:py-10">
      <Link to="/contactos" className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-fog">
        <ArrowLeft size={14} /> Contactos
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-snow">{handle(contact.username, contact.igId)}</h1>
          <p className="mt-1 text-sm text-ash">
            Desde {formatDate(contact.firstSeen)} · última vez {formatDate(contact.lastSeen)}
          </p>
        </div>
        {hasConversation && (
          <Link to={`/conversaciones/${encodeURIComponent(contact.igId)}`} className="btn-gold inline-flex items-center gap-2 px-4 py-2 text-sm">
            <MessagesSquare size={15} /> Ver conversación
          </Link>
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Section label="Etiquetas" description="Las pone un flujo al pulsar un enlace o la IA; también las puedes poner o quitar a mano.">
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.length === 0 && <span className="text-sm text-smoke">Sin etiquetas.</span>}
              {contact.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] py-1 pl-2 pr-1 text-xs text-mist">
                  {tag}
                  <button type="button" onClick={() => void tags({ remove: tag })} disabled={busy} aria-label={`Quitar la etiqueta ${tag}`} className="rounded p-0.5 text-smoke hover:text-bad">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <form onSubmit={(e: FormEvent) => (e.preventDefault(), void tags({ add: newTag }))} className="mt-3 flex gap-2">
              <input className="field max-w-[260px] text-sm" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" maxLength={40} />
              <SecondaryButton type="submit" disabled={busy || !newTag.trim()}>
                <Plus size={13} /> Añadir
              </SecondaryButton>
            </form>
          </Section>

          <Section label="Reels" description="De qué reel vino (su primer comentario) y el último en el que comentó.">
            <p className="text-sm text-mist">Origen: {contact.sourceLabel ?? '—'}</p>
            <p className="mt-1 text-sm text-mist">Último: {contact.lastLabel ?? '—'}</p>
          </Section>

          <Section label={`Comentarios (${comments.length})`}>
            {comments.length === 0 ? (
              <p className="text-sm text-smoke">No hay comentarios guardados.</p>
            ) : (
              <ul className="space-y-2">
                {comments.map((c) => (
                  <li key={c.commentId} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <p className="text-sm text-fog">{c.text}</p>
                    <p className="mt-0.5 text-[11px] text-smoke">
                      {formatDate(c.createdAt)}
                      {c.reelLabel ? ` · ${c.reelLabel}` : ''}
                    </p>
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
              <button type="button" onClick={() => void erase()} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-bad/30 px-3 py-1.5 text-[13px] font-semibold text-bad hover:bg-bad/10">
                <Trash2 size={13} /> Borrar sus datos
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
