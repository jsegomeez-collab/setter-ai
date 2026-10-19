import { ArrowLeft, IdCard, Pause, Play, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Notice, SecondaryButton, formatDate } from '../ui/kit';
import { LeadPanel } from './LeadPanel';
import { DRAFT_NOTE, handle, type ConversationDetail, type ThreadMessage } from './types';
import { Loading } from '../ui/EmptyState';

const REFRESH_MS = 20_000;
const SOURCE_LABEL: Record<ThreadMessage['source'], string> = { user: '', flow: 'Flujo', ai: 'IA', human: 'A mano' };

type Props = { readonly igId: string; readonly onChanged: () => void };

/** Una conversación: hilo tipo Instagram, parar/reanudar la IA, borradores, responder a mano y la ficha. */
export function ConversationView({ igId, onChanged }: Props) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** En pantallas pequeñas la ficha va plegada debajo de la cabecera. */
  const [showLead, setShowLead] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api<ConversationDetail>(`/conversations/${encodeURIComponent(igId)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, [igId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [detail?.messages.length]);

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(`/conversations/${encodeURIComponent(igId)}/${path}`, { method: 'POST', body });
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (await act('reply', { text })) setText('');
  }

  if (!detail) return <div className="p-6">{error ? <p className="text-sm text-bad">{error}</p> : <Loading />}</div>;
  const { contact, messages, canReply } = detail;
  // El servidor lo explica como "Envíos bloqueados hasta…": ese aviso ya está arriba en la página, no se repite.
  const blocked = !canReply.ok && (canReply.reason ?? '').startsWith('Envíos bloqueados');
  const hasDraft = messages.at(-1)?.status === 'held' && messages.at(-1)?.note === DRAFT_NOTE;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Link to="/conversaciones" aria-label="Volver a la bandeja" className="rounded-lg p-1.5 text-ash hover:text-fog lg:hidden">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-bold text-snow">{handle(contact.username, igId)}</p>
            <p className={['text-xs', contact.aiPaused ? 'text-warn' : 'text-ok'].join(' ')}>{contact.aiPaused ? `IA parada${contact.aiPausedReason ? ` · ${contact.aiPausedReason}` : ''}` : 'IA activa'}</p>
          </div>
          <span className="xl:hidden">
            <SecondaryButton onClick={() => setShowLead((v) => !v)}>
              <IdCard size={13} /> Ficha
            </SecondaryButton>
          </span>
          <SecondaryButton onClick={() => void act(contact.aiPaused ? 'resume' : 'pause')} disabled={busy}>
            {contact.aiPaused ? <Play size={13} /> : <Pause size={13} />} {contact.aiPaused ? 'Reanudar IA' : 'Parar IA'}
          </SecondaryButton>
        </header>
        {showLead && (
          <div className="max-h-[45%] overflow-y-auto border-b border-white/[0.06] bg-white/[0.02] p-4 xl:hidden">
            <LeadPanel lead={detail.contact.lead} tags={detail.contact.tags} fields={detail.contact.fields} leadHistory={detail.leadHistory} />
          </div>
        )}

        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          <div ref={bottom} />
        </ol>

        <div className="space-y-2 border-t border-white/[0.06] p-3">
          {error && <Notice tone="bad">{error}</Notice>}
          {hasDraft && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/25 bg-info/[0.06] px-3 py-2">
              <span className="flex-1 text-sm text-info">La IA tiene un borrador sin enviar.</span>
              <SecondaryButton onClick={() => void act('draft/discard')} disabled={busy}>
                Descartar
              </SecondaryButton>
              <button type="button" onClick={() => void act('draft/approve')} disabled={busy || !canReply.ok} className="btn-gold px-3 py-1.5 text-[13px]">
                Enviar tal cual
              </button>
            </div>
          )}
          <form onSubmit={reply} className="flex items-end gap-2">
            <textarea
              className="field min-h-[44px] flex-1 resize-none text-sm"
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canReply.ok || busy}
              placeholder={canReply.ok ? 'Escribe una respuesta…' : blocked ? 'Envíos bloqueados: mira el aviso de arriba' : 'No se puede responder ahora'}
              aria-label="Respuesta a mano"
            />
            <button type="submit" disabled={!canReply.ok || busy || !text.trim()} aria-label="Enviar" className="btn-gold grid h-[44px] w-[44px] place-items-center">
              <Send size={16} />
            </button>
          </form>
          {/* El bloqueo ya lo dice el aviso de arriba de la página: aquí solo otros motivos (p. ej. pasaron las 24 h). */}
          {!canReply.ok && !blocked && canReply.reason && <p className="text-xs text-warn">{canReply.reason}</p>}
        </div>
      </div>
      <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-white/[0.06] p-5 xl:block">
        <LeadPanel lead={detail.contact.lead} tags={detail.contact.tags} fields={detail.contact.fields} leadHistory={detail.leadHistory} />
      </aside>
    </div>
  );
}

function Bubble({ message: m }: { message: ThreadMessage }) {
  const out = m.direction === 'out';
  const status =
    m.status === 'held' ? (m.note === DRAFT_NOTE ? 'Borrador sin enviar' : `Retenido: ${m.note ?? ''}`) : m.status === 'failed' ? 'No se envió' : m.status === 'discarded' ? 'Descartado' : m.status === 'queued' ? 'En cola' : null;
  return (
    <li className={['flex flex-col gap-1', out ? 'items-end' : 'items-start'].join(' ')}>
      <p
        className={[
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
          out ? 'bg-ember-500/15 text-ember-50' : 'bg-white/[0.06] text-fog',
          m.status === 'held' || m.status === 'failed' ? 'border border-dashed border-white/20 opacity-80' : '',
          m.status === 'discarded' ? 'line-through opacity-50' : '',
        ].join(' ')}
      >
        {m.text}
      </p>
      <span className="text-xs text-smoke">
        {[SOURCE_LABEL[m.source], formatDate(m.createdAt), status].filter(Boolean).join(' · ')}
      </span>
    </li>
  );
}
