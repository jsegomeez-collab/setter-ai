import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { connect, disconnect } from './graph';
import { STEP_META, stepSummary } from './steps-meta';
import { MAX_BUTTONS, type Button, type Flow, type FlowStep } from './types';

/** Piezas comunes de los editores de pasos (Fase 7.3b): campo con etiqueta, "a qué paso va" y lista de botones. */

const MAX_BUTTON_TITLE = 40;

export function Field({ label, hint, warn = false, children }: { label: string; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className={['mb-1.5 block text-xs font-semibold', warn ? 'text-warn' : 'text-mist'].join(' ')}>{label}</span>
      {children}
      {hint && <span className={['mt-1 block text-xs', warn ? 'text-warn' : 'text-smoke'].join(' ')}>{hint}</span>}
    </label>
  );
}

export const commas = (value: string): string[] => value.split(',').map((t) => t.trim()).filter(Boolean);

/**
 * Campo de lista separada por comas. Guarda lo escrito tal cual (si no, el espacio de «Grupo WhatsApp» se borraría
 * al teclearlo) y avisa con la lista ya separada. Si la lista cambia desde fuera, se vuelve a escribir.
 */
export function CommaInput({ value, onChange, ...rest }: { value: readonly string[]; onChange: (items: string[]) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value.join(', '));
  const joined = value.join(', ');
  useEffect(() => {
    setText((current) => (commas(current).join(', ') === joined ? current : joined));
  }, [joined]);
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(commas(e.target.value));
      }}
    />
  );
}

/** Desplegable "a qué paso va": hace lo mismo que arrastrar una flecha en el lienzo (útil en el móvil). */
export function Target({ flow, step, handle, label, value, onChange, optional = false }: { flow: Flow; step: FlowStep; handle: string; label: string; value: string; onChange: (flow: Flow) => void; optional?: boolean }) {
  return (
    <Field label={label} warn={!optional && !value}>
      <select className="field !py-2 text-[13px]" value={value} onChange={(e) => onChange(e.target.value ? connect(flow, step.id, handle, e.target.value) : disconnect(flow, step.id, handle))}>
        <option value="">{optional ? '— Nada (termina aquí) —' : '— Elige un paso —'}</option>
        {flow.nodes
          .filter((s) => s.id !== step.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {STEP_META[s.type].label} · {stepSummary(s).slice(0, 40)}
            </option>
          ))}
      </select>
    </Field>
  );
}

/** "Después" opcional de los pasos que lo tienen. */
export function NextTarget({ flow, step, value, onChange }: { flow: Flow; step: FlowStep; value: string | undefined; onChange: (flow: Flow) => void }) {
  return <Target flow={flow} step={step} handle="next" label="Después (opcional)" value={value ?? ''} onChange={onChange} optional />;
}

type ButtonsProps = {
  flow: Flow;
  step: FlowStep;
  buttons: readonly Button[];
  /** Id de salida de cada botón de acción en el lienzo (btn-N o card-C-N). */
  handleOf: (index: number) => string;
  onButtons: (buttons: Button[]) => void;
  onChange: (flow: Flow) => void;
};

/** Hasta 3 botones: "responder" (va a otro paso) o "abrir un enlace" (con etiquetas al pulsar). */
export function ButtonsEditor({ flow, step, buttons, handleOf, onButtons, onChange }: ButtonsProps) {
  const setButton = (index: number, button: Button) => onButtons(buttons.map((b, i) => (i === index ? button : b)));
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-mist">
        Botones ({buttons.length}/{MAX_BUTTONS})
      </p>
      {buttons.map((button, i) => (
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
            <button type="button" aria-label="Quitar botón" onClick={() => onButtons(buttons.filter((_, j) => j !== i))} className="ml-auto text-smoke hover:text-bad">
              <Trash2 size={14} />
            </button>
          </div>
          <input aria-label="Texto del botón" className="field !py-1.5 text-[13px]" placeholder="Texto del botón" maxLength={MAX_BUTTON_TITLE} value={button.title} onChange={(e) => setButton(i, { ...button, title: e.target.value })} />
          {button.type === 'url' ? (
            <>
              <input aria-label="Enlace" className="field !py-1.5 text-[13px]" placeholder="https://…" value={button.url} onChange={(e) => setButton(i, { ...button, url: e.target.value.trim() })} />
              <CommaInput
                aria-label="Etiquetas al pulsar"
                className="field !py-1.5 text-[13px]"
                placeholder="Etiquetas al pulsar (separadas por comas)"
                value={button.tags}
                onChange={(tags) => setButton(i, { ...button, tags })}
              />
            </>
          ) : (
            <Target flow={flow} step={step} handle={handleOf(i)} label="Al pulsar, ir a" value={button.next} onChange={onChange} />
          )}
        </div>
      ))}
      {buttons.length < MAX_BUTTONS && (
        <button type="button" onClick={() => onButtons([...buttons, { type: 'postback', title: 'Lo quiero', next: '' }])} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300">
          <Plus size={13} /> Añadir botón
        </button>
      )}
    </div>
  );
}
