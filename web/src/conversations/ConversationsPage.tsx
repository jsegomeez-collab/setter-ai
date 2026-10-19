import { MessagesSquare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { formatDate } from '../ui/kit';
import { ConversationView } from './ConversationView';
import { InboxList } from './InboxList';
import type { InboxResponse } from './types';

const REFRESH_MS = 30_000;

/** Conversaciones (Fase 6.2): bandeja a la izquierda y la conversación a la derecha; en el móvil, una u otra. */
export function ConversationsPage() {
  const { igId } = useParams();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filtro') ?? 'all';
  const [query, setQuery] = useState('');
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInbox(await api<InboxResponse>(`/conversations?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(query)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la bandeja');
    }
  }, [filter, query]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const blocked = inbox?.sendsBlocked;
  return (
    <div className="flex h-full flex-col">
      {blocked && (
        <p className="border-b border-warn/20 bg-warn/[0.07] px-4 py-2 text-[13px] text-warn">
          Envíos bloqueados hasta {formatDate(blocked.until)}
          {blocked.reason ? ` · ${blocked.reason}` : ''}. Nada sale a Instagram hasta entonces (tampoco la IA ni los flujos).
        </p>
      )}
      {error && <p className="px-4 py-2 text-sm text-bad">{error}</p>}
      <div className="flex min-h-0 flex-1">
        <div className={['w-full shrink-0 border-r border-white/[0.06] lg:block lg:w-[340px]', igId ? 'hidden' : 'block'].join(' ')}>
          <InboxList items={inbox?.items ?? null} filter={filter} query={query} onFilter={(value) => setParams({ filtro: value })} onQuery={setQuery} />
        </div>
        <div className={['min-w-0 flex-1', igId ? 'block' : 'hidden lg:block'].join(' ')}>
          {igId ? (
            <ConversationView key={igId} igId={igId} onChanged={() => void load()} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <MessagesSquare size={28} className="mx-auto text-smoke" strokeWidth={1.5} />
                <p className="mt-3 text-sm text-ash">Elige una conversación de la bandeja.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
