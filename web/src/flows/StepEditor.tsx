import { Flag, Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { connect, disconnect, removeStep, setStart, updateStep } from './graph';
import { DmPreview } from './Preview';
import { stepSummary } from './StepNode';
import { MAX_BUTTONS, MAX_DELAY_SECONDS, MAX_PLAIN_TEXT, MAX_TEMPLATE_TEXT, STEP_LABEL, type Button, type Flow, type FlowStep } from './types';

/** Panel lateral: edita el paso elegido en el lienzo. Cada cambio devuelve un flujo nuevo (se guarda con "Guardar"). */

type Props = { flow: Flow; step: FlowStep; onChange: (flow: Flow) => void; onClose: () => void };

const MAX_BUTTON_TITLE = 40;

export function StepEditor({ flow, step, onChange, onClose }: Props) {
  const isStart = step.id === flow.startNodeId;
  const update = (next: FlowStep) => onChange(updateStep(flow, next));
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">{STEP_LABEL[step.type]}</p>
          <p className="mt-1 text-xs text-smoke">Paso “{step.id}”{isStart ? ' · primer mensaje (el DM al comentario)' : ''}</p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="text-smoke hover:text-fog">
          <X size={16} />
        </button>
      </div>

      {step.type === 'message' && <MessageFields flow={flow} step={step} isStart={isStart} onChange={onChange} update={update} />}
      {step.type === 'follow_gate' && (
        <>
          <p className="text-[13px] text-ash">Mira si la persona sigue la cuenta y la manda por un camino u otro. “No se sabe” es cuando Meta no deja comprobarlo.</p>
          <Target flow={flow} step={step} handle="yes" label="Si sigue" value={step.ifFollowing} onChange={onChange} />
          <Target flow={flow} step={step} handle="no" label="Si no sigue" value={step.ifNotFollowing} onChange={onChange} />
          <Target flow={flow} step={step} handle="unknown" label="Si no se sabe" value={step.ifUnknown} onChange={onChange} />
        </>
      )}
      {step.type === 'delay' && (
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
      )}
      {step.type === 'setter_opener' && (
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
      )}

      {!isStart && (
        <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
          {step.type === 'message' && (
            <button type="button" onClick={() => onChange(setStart(flow, step.id))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-mist hover:text-fog">
              <Flag size={13} /> Hacer primer mensaje
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onChange(removeStep(flow, step.id));
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-bad/30 px-3 py-1.5 text-[12px] font-semibold text-bad hover:bg-bad/10"
          >
            <Trash2 size={13} /> Quitar este paso
          </button>
        </div>
      )}
    </div>
  );
}

function MessageFields({ flow, step, isStart, onChange, update }: { flow: Flow; step: Extract<FlowStep, { type: 'message' }>; isStart: boolean; onChange: (flow: Flow) => void; update: (step: FlowStep) => void }) {
  const limit = step.buttons.length > 0 ? MAX_TEMPLATE_TEXT : MAX_PLAIN_TEXT;
  const setButton = (index: number, button: Button) => update({ ...step, buttons: step.buttons.map((b, i) => (i === index ? button : b)) });
  return (
    <>
      <Field label="Texto" hint={`${step.text.length} / ${limit} caracteres${step.buttons.length ? ' (con botones el máximo es 640)' : ''}`} warn={step.text.length > limit}>
        <textarea className="field min-h-[120px]" value={step.text} onChange={(e) => update({ ...step, text: e.target.value })} />
      </Field>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-mist">Botones ({step.buttons.length}/{MAX_BUTTONS})</p>
        {step.buttons.map((button, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div className="flex gap-2">
              <select
                aria-label="Tipo de botón"
                className="field !w-auto !py-1.5 text-[12px]"
                value={button.type}
                onChange={(e) => setButton(i, e.target.value === 'url' ? { type: 'url', title: button.title, url: 'https://', tags: [] } : { type: 'postback', title: button.title, next: '' })}
              >
                <option value="postback">Responder (va a otro paso)</option>
                <option value="url">Abrir un enlace</option>
              </select>
              <button type="button" aria-label="Quitar botón" onClick={() => update({ ...step, buttons: step.buttons.filter((_, j) => j !== i) })} className="ml-auto text-smoke hover:text-bad">
                <Trash2 size={14} />
              </button>
            </div>
            <input className="field !py-1.5 text-[13px]" placeholder="Texto del botón" maxLength={MAX_BUTTON_TITLE} value={button.title} onChange={(e) => setButton(i, { ...button, title: e.target.value })} />
            {button.type === 'url' ? (
              <>
                <input className="field !py-1.5 text-[13px]" placeholder="https://…" value={button.url} onChange={(e) => setButton(i, { ...button, url: e.target.value.trim() })} />
                <input
                  className="field !py-1.5 text-[13px]"
                  placeholder="Etiquetas al pulsar (separadas por comas)"
                  value={button.tags.join(', ')}
                  onChange={(e) => setButton(i, { ...button, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                />
              </>
            ) : (
              <Target flow={flow} step={step} handle={`btn-${i}`} label="Al pulsar, ir a" value={button.next} onChange={onChange} />
            )}
          </div>
        ))}
        {step.buttons.length < MAX_BUTTONS && (
          <button type="button" onClick={() => update({ ...step, buttons: [...step.buttons, { type: 'postback', title: 'Lo quiero', next: '' }] })} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300">
            <Plus size={13} /> Añadir botón
          </button>
        )}
      </div>

      {isStart ? (
        <p className="text-xs text-smoke">El primer mensaje no puede tener “después” automático: Meta solo deja seguir escribiendo cuando la persona responde o pulsa un botón.</p>
      ) : (
        <Target flow={flow} step={step} handle="next" label="Después (automático, opcional)" value={step.next ?? ''} onChange={onChange} optional />
      )}
      <DmPreview text={step.text} buttons={step.buttons} />
    </>
  );
}

/** Desplegable "a qué paso va": hace lo mismo que arrastrar una flecha en el lienzo (útil en el móvil). */
function Target({ flow, step, handle, label, value, onChange, optional = false }: { flow: Flow; step: FlowStep; handle: string; label: string; value: string; onChange: (flow: Flow) => void; optional?: boolean }) {
  return (
    <Field label={label} warn={!optional && !value}>
      <select className="field !py-2 text-[13px]" value={value} onChange={(e) => onChange(e.target.value ? connect(flow, step.id, handle, e.target.value) : disconnect(flow, step.id, handle))}>
        <option value="">{optional ? '— Nada (termina aquí) —' : '— Elige un paso —'}</option>
        {flow.nodes
          .filter((s) => s.id !== step.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {STEP_LABEL[s.type]} · {stepSummary(s).slice(0, 40)}
            </option>
          ))}
      </select>
    </Field>
  );
}

function Field({ label, hint, warn = false, children }: { label: string; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className={['mb-1.5 block text-xs font-semibold', warn ? 'text-warn' : 'text-mist'].join(' ')}>{label}</span>
      {children}
      {hint && <span className={['mt-1 block text-xs', warn ? 'text-warn' : 'text-smoke'].join(' ')}>{hint}</span>}
    </label>
  );
}
