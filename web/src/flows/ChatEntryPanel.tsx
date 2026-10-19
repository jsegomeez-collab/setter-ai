import { Menu, MessageCircleQuestion, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { Notice, formatDate } from '../ui/kit';
import type { FlowSummary } from './types';
import { Loading } from '../ui/EmptyState';

/**
 * Rompehielos y menú fijo del chat (Fase 7.3c). Borrador en la web; "Publicar en Instagram" lo pone en el chat de
 * todo el que te escriba (pide escribir PUBLICAR). Cada opción empieza un flujo o abre una web.
 */

type MenuItem = { type: 'flow'; title: string; flowId: string } | { type: 'url'; title: string; url: string };
interface ChatEntry {
  readonly iceBreakers: readonly { question: string; flowId: string }[];
  readonly menu: readonly MenuItem[];
}
interface ChatEntryResponse {
  readonly draft: ChatEntry;
  readonly published: { at: string; by: string; entry: ChatEntry } | null;
  readonly live: { iceBreakers: { question: string; payload: string }[]; menu: { title: string; target: string }[] } | null;
  readonly liveError: string | null;
}

const MAX_ICE_BREAKERS = 4;
const MAX_MENU_ITEMS = 5;

export function ChatEntryPanel({ flows }: { flows: readonly FlowSummary[] }) {
  const toast = useToast();
  const [data, setData] = useState<ChatEntryResponse | null>(null);
  const [draft, setDraft] = useState<ChatEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = () =>
    api<ChatEntryResponse>('/chat-entry')
      .then((res) => {
        setData(res);
        setDraft(res.draft);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar'));
  useEffect(() => {
    void load();
  }, []);

  if (!data || !draft) return error ? <Notice tone="bad">{error}</Notice> : <Loading />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.draft);
  const set = (patch: Partial<ChatEntry>) => setDraft({ ...draft, ...patch });
  const used = new Set([...draft.iceBreakers.map((i) => i.flowId), ...draft.menu.flatMap((m) => (m.type === 'flow' ? [m.flowId] : []))]);
  const inactive = flows.filter((flow) => used.has(flow.id) && !flow.enabled);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await api('/chat-entry', { method: 'POST', body: draft });
      await load();
      toast('Borrador guardado. Todavía no está en Instagram.');
    });
  const publish = () =>
    run(async () => {
      setConfirming(false);
      await api('/chat-entry/publish', { method: 'POST', body: { confirm: 'PUBLICAR' } });
      await load();
      toast('Publicado en Instagram.');
    });

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ash">
        Lo que ve la gente al abrir tu chat. <strong className="text-mist">Rompehielos</strong>: hasta 4 preguntas que aparecen antes de escribir. <strong className="text-mist">Menú fijo</strong>: un menú
        siempre disponible en el chat. No salen en el ordenador, solo en el móvil.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {inactive.length > 0 && <Notice tone="warn">Para publicar, activa antes: {inactive.map((f) => `«${f.name}»`).join(', ')} (si no, quien pulse esa opción no recibirá nada).</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Section icon={MessageCircleQuestion} title={`Rompehielos (${draft.iceBreakers.length}/${MAX_ICE_BREAKERS})`}>
            {draft.iceBreakers.map((item, i) => (
              <Row key={i} onRemove={() => set({ iceBreakers: draft.iceBreakers.filter((_, j) => j !== i) })} label={`Rompehielos ${i + 1}`}>
                <input aria-label="Pregunta" className="field !py-2 text-[13px]" maxLength={80} placeholder="¿Cuánto cuesta?" value={item.question} onChange={(e) => set({ iceBreakers: draft.iceBreakers.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })} />
                <FlowSelect flows={flows} value={item.flowId} onChange={(flowId) => set({ iceBreakers: draft.iceBreakers.map((x, j) => (j === i ? { ...x, flowId } : x)) })} />
              </Row>
            ))}
            {draft.iceBreakers.length < MAX_ICE_BREAKERS && <AddButton onClick={() => set({ iceBreakers: [...draft.iceBreakers, { question: '', flowId: '' }] })}>Añadir pregunta</AddButton>}
          </Section>

          <Section icon={Menu} title={`Menú fijo (${draft.menu.length}/${MAX_MENU_ITEMS})`}>
            {draft.menu.map((item, i) => {
              const replace = (next: MenuItem) => set({ menu: draft.menu.map((x, j) => (j === i ? next : x)) });
              return (
                <Row key={i} onRemove={() => set({ menu: draft.menu.filter((_, j) => j !== i) })} label={`Opción ${i + 1}`}>
                  <div className="flex gap-2">
                    <select aria-label="Tipo" className="field !w-auto !py-2 text-[13px]" value={item.type} onChange={(e) => replace(e.target.value === 'url' ? { type: 'url', title: item.title, url: 'https://' } : { type: 'flow', title: item.title, flowId: '' })}>
                      <option value="flow">Empieza un flujo</option>
                      <option value="url">Abre una web</option>
                    </select>
                    <input aria-label="Texto de la opción" className="field !py-2 text-[13px]" maxLength={30} placeholder="Texto de la opción" value={item.title} onChange={(e) => replace({ ...item, title: e.target.value })} />
                  </div>
                  {item.type === 'flow' ? (
                    <FlowSelect flows={flows} value={item.flowId} onChange={(flowId) => replace({ ...item, flowId })} />
                  ) : (
                    <input aria-label="Enlace" className="field !py-2 text-[13px]" placeholder="https://…" value={item.url} onChange={(e) => replace({ ...item, url: e.target.value.trim() })} />
                  )}
                </Row>
              );
            })}
            {draft.menu.length < MAX_MENU_ITEMS && <AddButton onClick={() => set({ menu: [...draft.menu, { type: 'flow', title: '', flowId: '' }] })}>Añadir opción</AddButton>}
          </Section>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="btn-gold inline-flex items-center gap-1.5 px-4 py-2 text-[13px]">
              <Save size={14} /> Guardar borrador
            </button>
            <button
              type="button"
              disabled={dirty || busy || inactive.length > 0}
              onClick={() => setConfirming(true)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[10px] border border-white/10 px-4 py-2 text-[13px] font-semibold text-mist hover:text-fog disabled:opacity-40"
            >
              <Send size={14} /> Publicar en Instagram
            </button>
            {dirty && <span className="text-xs text-warn">Guarda el borrador antes de publicar.</span>}
          </div>
          <p className="text-xs text-smoke">
            {data.published ? `Publicado por última vez el ${formatDate(data.published.at)} por ${data.published.by}.` : 'Todavía no se ha publicado nada desde aquí.'}
          </p>
        </div>

        <aside className="space-y-3">
          <PhonePreview entry={draft} />
          <LiveBox data={data} />
        </aside>
      </div>

      {confirming && (
        <ConfirmDialog title="Publicar en Instagram" word="PUBLICAR" confirmLabel="Publicar" busy={busy} onConfirm={() => void publish()} onCancel={() => setConfirming(false)}>
          <p>
            Lo verá <strong className="text-fog">todo el que abra tu chat</strong>: {draft.iceBreakers.length} rompehielos y {draft.menu.length} opción(es) de menú. Lo que quites aquí se quitará también de
            Instagram.
          </p>
          <p>Meta avisa de que el menú puede tardar en verse en los chats que ya estaban abiertos.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function FlowSelect({ flows, value, onChange }: { flows: readonly FlowSummary[]; value: string; onChange: (flowId: string) => void }) {
  return (
    <select aria-label="Flujo que empieza" className="field !py-2 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Elige el flujo que empieza —</option>
      {flows.map((flow) => (
        <option key={flow.id} value={flow.id}>
          {flow.name} {flow.enabled ? '' : '(inactivo)'}
        </option>
      ))}
    </select>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Menu; title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <h2 className="label flex items-center gap-1.5">
        <Icon size={13} className="text-ember-400" aria-hidden /> {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-mist">{label}</p>
        <button type="button" aria-label={`Quitar ${label.toLowerCase()}`} onClick={onRemove} className="text-smoke hover:text-bad">
          <Trash2 size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300">
      <Plus size={13} /> {children}
    </button>
  );
}

/** Cómo se ve al abrir el chat en el móvil (aproximado). */
function PhonePreview({ entry }: { entry: ChatEntry }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black p-4" aria-label="Vista previa del chat">
      <div className="flex flex-col items-center gap-1 border-b border-white/8 pb-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-ember-400 to-ember-700 text-sm font-bold text-black">J</span>
        <span className="text-[13px] font-semibold text-snow">josenews.ai</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {entry.iceBreakers.length === 0 && <p className="text-center text-xs text-white/40">Sin rompehielos</p>}
        {entry.iceBreakers.map((item, i) => (
          <p key={i} className="rounded-full border border-white/20 px-3 py-1.5 text-center text-[13px] text-white">
            {item.question || 'Pregunta sin escribir'}
          </p>
        ))}
      </div>
      {entry.menu.length > 0 && (
        <div className="mt-4 rounded-xl bg-[#262626] p-2">
          <p className="flex items-center gap-1.5 px-2 pb-1 text-xs text-white/60">
            <Menu size={12} /> Menú
          </p>
          {entry.menu.map((item, i) => (
            <p key={i} className="border-t border-white/10 px-2 py-1.5 text-[13px] text-white">
              {item.title || 'Opción sin texto'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveBox({ data }: { data: ChatEntryResponse }) {
  if (data.liveError) return <p className="text-xs text-warn">No se pudo leer lo que hay ahora en Instagram: {data.liveError}</p>;
  if (!data.live) return null;
  const { iceBreakers, menu } = data.live;
  return (
    <div className="rounded-xl border border-white/8 p-3 text-xs text-ash">
      <p className="font-semibold text-mist">Ahora mismo en Instagram</p>
      {iceBreakers.length === 0 && menu.length === 0 ? (
        <p className="mt-1">Nada (sin rompehielos ni menú).</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {iceBreakers.map((item, i) => (
            <li key={`i${i}`}>Rompehielos: «{item.question}»</li>
          ))}
          {menu.map((item, i) => (
            <li key={`m${i}`}>Menú: «{item.title}»</li>
          ))}
        </ul>
      )}
    </div>
  );
}
