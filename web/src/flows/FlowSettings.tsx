import { AtSign, Copy, Link2, MessageCircle, MessageSquareText, Repeat, Workflow, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useToast } from '../ui/Toast';
import { CommaInput } from './fields';
import { TRIGGER_LABEL, type Flow, type FlowsResponse, type Trigger, type TriggerType } from './types';

/** Ajustes del flujo (cuando no hay ningún paso elegido en el lienzo): cómo empieza, a quién y cuántas veces. */

const lines = (value: string) => value.split('\n').map((t) => t.trimStart());

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'enlace';

const TRIGGER_ICON: Readonly<Record<TriggerType, LucideIcon>> = {
  comment: MessageCircle,
  dm_keyword: MessageSquareText,
  story_reply: Repeat,
  story_mention: AtSign,
  ref: Link2,
  manual: Workflow,
};
const TRIGGER_ORDER: readonly TriggerType[] = ['comment', 'dm_keyword', 'story_reply', 'story_mention', 'ref', 'manual'];

/** Disparador nuevo con sus valores iniciales al cambiar de forma de empezar. */
function freshTrigger(type: TriggerType, flow: Flow): Trigger {
  switch (type) {
    case 'comment':
      return { type, mediaIds: 'all', keywords: [] };
    case 'dm_keyword':
      return { type, keywords: [], exact: false };
    case 'story_reply':
      return { type, keywords: [] };
    case 'ref':
      return { type, ref: slug(flow.name) };
    default:
      return { type };
  }
}

type Props = { flow: Flow; reels: FlowsResponse['reels']; account: string | null; onChange: (flow: Flow) => void };

export function FlowSettings({ flow, reels, account, onChange }: Props) {
  const set = (patch: Partial<Flow>) => onChange({ ...flow, ...patch });
  const setTrigger = (trigger: Trigger) => set({ trigger });
  const { trigger } = flow;
  return (
    <div className="space-y-5">
      <p className="label">Ajustes del flujo</p>
      <Field label="Nombre">
        <input className="field" maxLength={80} value={flow.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <Field label="¿Cómo empieza?">
        <div className="grid grid-cols-2 gap-1.5">
          {TRIGGER_ORDER.map((type) => {
            const Icon = TRIGGER_ICON[type];
            const active = trigger.type === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => !active && setTrigger(freshTrigger(type, flow))}
                className={[
                  'flex min-h-[44px] items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] font-semibold leading-tight',
                  active ? 'border-ember-500/60 bg-ember-500/10 text-ember-300' : 'border-white/8 text-mist hover:border-white/20 hover:text-fog',
                ].join(' ')}
              >
                <Icon size={14} className="shrink-0" aria-hidden /> {TRIGGER_LABEL[type]}
              </button>
            );
          })}
        </div>
      </Field>

      {trigger.type === 'comment' && <CommentFields flow={flow} trigger={trigger} reels={reels} set={set} />}
      {trigger.type === 'dm_keyword' && (
        <>
          <Field label="Palabras clave (separadas por comas)" warn={trigger.keywords.length === 0} hint={trigger.keywords.length === 0 ? 'Pon al menos una palabra.' : 'Sin distinguir mayúsculas ni tildes.'}>
            <CommaInput className="field" value={trigger.keywords} onChange={(keywords) => setTrigger({ ...trigger, keywords })} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-mist">
            <input type="checkbox" className="mt-0.5 accent-ember-500" checked={trigger.exact} onChange={(e) => setTrigger({ ...trigger, exact: e.target.checked })} />
            <span>
              Solo si el mensaje es exactamente la palabra
              <span className="block text-xs text-smoke">Si no, basta con que la contenga («quiero la guía» vale para «guía»).</span>
            </span>
          </label>
        </>
      )}
      {trigger.type === 'story_reply' && (
        <Field label="Palabras clave (separadas por comas)" hint="Vacío = cualquier respuesta a tus historias.">
          <CommaInput className="field" value={trigger.keywords} onChange={(keywords) => setTrigger({ ...trigger, keywords })} />
        </Field>
      )}
      {trigger.type === 'story_mention' && <Explain>Salta cuando alguien te menciona en su historia. Es un DM suyo, así que puedes contestar con cualquier paso.</Explain>}
      {trigger.type === 'ref' && <RefFields trigger={trigger} account={account} onChange={setTrigger} />}
      {trigger.type === 'manual' && (
        <Explain>No salta solo: lo empieza otro flujo (paso «Ir a otro flujo»), un rompehielos o el menú fijo del chat. Úsalo para partes que repites en varios flujos.</Explain>
      )}

      <Field label="Modo prueba: solo responde a estos usuarios (separados por comas)" hint="Vacío = responde a todo el mundo.">
        <CommaInput className="field" value={flow.testUsernames} onChange={(testUsernames) => set({ testUsernames })} />
      </Field>

      <Field label="¿Cuántas veces a la misma persona?">
        <select
          className="field"
          value={!flow.oncePerUser ? 'always' : trigger.type === 'comment' ? flow.onceScope : 'flow'}
          onChange={(e) => set(e.target.value === 'always' ? { oncePerUser: false } : { oncePerUser: true, onceScope: e.target.value as Flow['onceScope'] })}
        >
          {trigger.type === 'comment' && <option value="media">Una vez por persona y por reel</option>}
          <option value="flow">Una sola vez por persona</option>
          <option value="always">{trigger.type === 'comment' ? 'Cada vez que comente' : 'Cada vez'}</option>
        </select>
      </Field>
    </div>
  );
}

function CommentFields({ flow, trigger, reels, set }: { flow: Flow; trigger: Extract<Trigger, { type: 'comment' }>; reels: FlowsResponse['reels']; set: (patch: Partial<Flow>) => void }) {
  const chosen = trigger.mediaIds === 'all' ? null : new Set(trigger.mediaIds);
  const setTrigger = (patch: Partial<Extract<Trigger, { type: 'comment' }>>) => set({ trigger: { ...trigger, ...patch } });
  const toggleReel = (id: string) => {
    const next = new Set(chosen ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTrigger({ mediaIds: [...next] });
  };
  // Reels elegidos que ya no salen en la lista de los últimos (se conservan aunque no se vean).
  const hidden = chosen ? [...chosen].filter((id) => !reels.some((r) => r.mediaId === id)) : [];
  return (
    <>
      <Field label="¿En qué reels salta?" warn={chosen !== null && chosen.size === 0} hint={chosen !== null && chosen.size === 0 ? 'Elige al menos un reel.' : undefined}>
        <div className="mb-2 flex gap-2 text-[12px]">
          <Choice active={chosen === null} onClick={() => setTrigger({ mediaIds: 'all' })}>
            Todos
          </Choice>
          <Choice active={chosen !== null} onClick={() => chosen === null && setTrigger({ mediaIds: [] })}>
            Solo los elegidos
          </Choice>
        </div>
        {chosen !== null && (
          <ul className="max-h-[220px] space-y-1 overflow-y-auto rounded-lg border border-white/8 p-2">
            {reels.map((reel) => (
              <li key={reel.mediaId}>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-mist">
                  <input type="checkbox" checked={chosen.has(reel.mediaId)} onChange={() => toggleReel(reel.mediaId)} className="accent-ember-500" />
                  <span className="truncate">{reel.label}</span>
                </label>
              </li>
            ))}
            {hidden.map((id) => (
              <li key={id} className="text-xs text-smoke">
                + reel antiguo {id} (elegido)
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Palabras clave (separadas por comas)" hint="Vacío = cualquier comentario del reel.">
        <CommaInput className="field" value={trigger.keywords} onChange={(keywords) => setTrigger({ keywords })} />
      </Field>

      <Field label="Respuestas públicas al comentario (una por línea, se elige una al azar)">
        <textarea className="field min-h-[90px]" value={flow.publicReplies.join('\n')} onChange={(e) => set({ publicReplies: lines(e.target.value) })} />
      </Field>

      <Field label="Plan B (si Meta rechaza el DM): respuestas públicas" hint="Desactivado temporalmente por el bloqueo de Meta: déjalo vacío hasta que decidamos reactivarlo." warn={flow.dmFailedReplies.some(Boolean)}>
        <textarea className="field min-h-[70px]" value={flow.dmFailedReplies.join('\n')} onChange={(e) => set({ dmFailedReplies: lines(e.target.value) })} />
      </Field>
    </>
  );
}

function RefFields({ trigger, account, onChange }: { trigger: Extract<Trigger, { type: 'ref' }>; account: string | null; onChange: (trigger: Trigger) => void }) {
  const toast = useToast();
  const link = `https://ig.me/m/${account ?? 'tu_cuenta'}?ref=${trigger.ref}`;
  const valid = /^[A-Za-z0-9_-]{1,40}$/.test(trigger.ref);
  return (
    <>
      <Field label="Nombre del enlace (ref)" warn={!valid} hint={valid ? 'Solo letras, números, - y _.' : 'Solo letras, números, - y _ (máx. 40), sin espacios.'}>
        <input className="field" maxLength={40} value={trigger.ref} onChange={(e) => onChange({ ...trigger, ref: e.target.value.trim() })} />
      </Field>
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <p className="text-xs font-semibold text-mist">Tu enlace</p>
        <p className="mt-1 break-all font-mono text-[12px] text-fog">{link}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(link)
              .then(() => toast('Enlace copiado.'))
              .catch(() => toast('No se pudo copiar: selecciónalo y cópialo a mano.', 'bad'))
          }
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300"
        >
          <Copy size={13} /> Copiar enlace
        </button>
        <p className="mt-2 text-xs text-smoke">Ponlo en tu bio, una historia o un anuncio: quien lo abra empieza este flujo. (Sin comprobar todavía en real: es la parte 7.3d.)</p>
      </div>
    </>
  );
}

function Explain({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-[13px] text-ash">{children}</p>;
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={['rounded-lg px-3 py-1.5 font-semibold', active ? 'bg-ember-500/15 text-ember-400' : 'text-ash hover:text-fog'].join(' ')}>
      {children}
    </button>
  );
}

function Field({ label, hint, warn = false, children }: { label: string; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <div>
      <p className={['mb-1.5 text-xs font-semibold', warn ? 'text-warn' : 'text-mist'].join(' ')}>{label}</p>
      {children}
      {hint && <p className={['mt-1 text-xs', warn ? 'text-warn' : 'text-smoke'].join(' ')}>{hint}</p>}
    </div>
  );
}
