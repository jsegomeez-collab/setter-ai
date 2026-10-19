import { Field, NextTarget, Target } from './fields';
import { DmPreview, MediaPreview } from './Preview';
import { MEDIA_LABEL } from './steps-meta';
import { MAX_DELAY_SECONDS, type Flow, type FlowStep, type FlowSummary, type MediaKind } from './types';

/** Editores de los pasos sencillos (Fase 7.3b). Cada uno: sus campos y, si lo tiene, su "después". */

type Props = { flow: Flow; step: FlowStep; flows: readonly FlowSummary[]; onChange: (flow: Flow) => void; update: (step: FlowStep) => void };

const REACTIONS = ['❤️', '🔥', '😂', '😮', '👏', '🙌', '👍', '🎉'];
const isHttp = (url: string) => /^https?:\/\/\S+\.\S+/.test(url);

export function SimpleEditor({ flow, step, flows, onChange, update }: Props) {
  switch (step.type) {
    case 'media':
      return (
        <>
          <Field label="Tipo">
            <select className="field" value={step.kind} onChange={(e) => update({ ...step, kind: e.target.value as MediaKind })}>
              {Object.entries(MEDIA_LABEL).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Enlace del archivo" warn={!isHttp(step.url)} hint="Tiene que ser un enlace público que se abra directamente (no una página de Drive o Dropbox para ver el archivo).">
            <input className="field" placeholder="https://…" value={step.url} onChange={(e) => update({ ...step, url: e.target.value.trim() })} />
          </Field>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
          <MediaPreview kind={step.kind} url={step.url} />
        </>
      );
    case 'react':
      return (
        <>
          <Field label="Emoji" hint="Reacciona a su último mensaje. Si aún no te ha escrito nada, no se envía.">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Emoji">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={step.emoji === emoji}
                  onClick={() => update({ ...step, emoji })}
                  className={['h-11 w-11 rounded-lg text-xl', step.emoji === emoji ? 'bg-ember-500/20 ring-1 ring-ember-500/60' : 'border border-white/10'].join(' ')}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Field>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
        </>
      );
    case 'tag':
      return (
        <>
          <Field label="¿Qué hace?">
            <select className="field" value={step.op} onChange={(e) => update({ ...step, op: e.target.value as 'add' | 'remove' })}>
              <option value="add">Poner la etiqueta</option>
              <option value="remove">Quitar la etiqueta</option>
            </select>
          </Field>
          <Field label="Etiqueta" warn={!step.tag.trim()} hint="Se ve en Contactos y sirve para filtrar y para las condiciones.">
            <input className="field" maxLength={40} value={step.tag} onChange={(e) => update({ ...step, tag: e.target.value })} />
          </Field>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
        </>
      );
    case 'field':
      return (
        <>
          <Field label="Nombre del dato" warn={!step.field.trim()} hint="P. ej. interes, ciudad, nivel. Se guarda en su ficha.">
            <input className="field" maxLength={40} value={step.field} onChange={(e) => update({ ...step, field: e.target.value })} />
          </Field>
          <Field label="Valor" hint="Vacío = borra ese dato de su ficha.">
            <input className="field" maxLength={200} value={step.value} onChange={(e) => update({ ...step, value: e.target.value })} />
          </Field>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
        </>
      );
    case 'ai':
      return (
        <>
          <Field label="¿Qué hace?">
            <select className="field" value={step.paused ? 'pause' : 'resume'} onChange={(e) => update({ ...step, paused: e.target.value === 'pause' })}>
              <option value="pause">Pausar el setter IA en esta conversación</option>
              <option value="resume">Volver a activar el setter IA</option>
            </select>
          </Field>
          <p className="text-xs text-smoke">Útil cuando quieres llevar tú la conversación. Se ve en Conversaciones como «IA parada».</p>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
        </>
      );
    case 'notify':
      return (
        <>
          <Field label="Texto del aviso" warn={!step.text.trim()} hint="Te sale en el Inicio, con un enlace a su conversación. No escribe a nadie.">
            <input className="field" maxLength={300} value={step.text} onChange={(e) => update({ ...step, text: e.target.value })} />
          </Field>
          <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
        </>
      );
    case 'goto': {
      const others = flows.filter((item) => item.id !== flow.id);
      const target = flows.find((item) => item.id === step.flowId);
      return (
        <>
          <Field label="Flujo" warn={!step.flowId} hint="Sigue con el primer paso de ese flujo. Tiene que estar activo cuando llegue la persona.">
            <select className="field" value={step.flowId} onChange={(e) => update({ ...step, flowId: e.target.value })}>
              <option value="">— Elige un flujo —</option>
              {others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} {item.enabled ? '' : '(inactivo)'}
                </option>
              ))}
            </select>
          </Field>
          {target && !target.enabled && <p className="text-xs text-warn">«{target.name}» está inactivo: si no lo activas, el camino se parará aquí.</p>}
        </>
      );
    }
    case 'delay':
      return (
        <>
          <Field label="Esperar (minutos)" hint="Máximo 23 h: Meta solo deja escribir 24 h después del último mensaje de la persona.">
            <input
              type="number"
              min={1}
              max={MAX_DELAY_SECONDS / 60}
              className="field"
              value={Math.round(step.seconds / 60)}
              onChange={(e) => update({ ...step, seconds: Math.min(MAX_DELAY_SECONDS, Math.max(60, Math.round(Number(e.target.value) || 1) * 60)) })}
            />
          </Field>
          <Target flow={flow} step={step} handle="next" label="Después" value={step.next} onChange={onChange} />
        </>
      );
    case 'setter_opener':
      return (
        <>
          <Field label="Textos de inicio (uno por línea)" hint="La IA manda uno de estos al azar y a partir de ahí conversa sola. Va al final del flujo.">
            <textarea
              className="field min-h-[140px]"
              value={step.texts.join('\n')}
              onChange={(e) => update({ ...step, texts: e.target.value.split('\n').map((t) => t.trimStart()).filter((t, i, all) => t !== '' || i === all.length - 1) })}
            />
          </Field>
          <DmPreview text={step.texts[0] ?? ''} />
        </>
      );
    case 'follow_gate':
      return (
        <>
          <p className="text-[13px] text-ash">Mira si la persona sigue la cuenta y la manda por un camino u otro. «No se sabe» es cuando Meta no deja comprobarlo.</p>
          <Target flow={flow} step={step} handle="yes" label="Si sigue" value={step.ifFollowing} onChange={onChange} />
          <Target flow={flow} step={step} handle="no" label="Si no sigue" value={step.ifNotFollowing} onChange={onChange} />
          <Target flow={flow} step={step} handle="unknown" label="Si no se sabe" value={step.ifUnknown} onChange={onChange} />
        </>
      );
    default:
      return null;
  }
}
