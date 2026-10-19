import { Flag, Trash2, X } from 'lucide-react';
import { ConditionEditor } from './ConditionEditor';
import { removeStep, setStart, updateStep } from './graph';
import { CarouselEditor, MessageEditor } from './MessageEditors';
import { SimpleEditor } from './SimpleEditors';
import { GROUP_LABEL, STEP_META } from './steps-meta';
import type { Flow, FlowStep, FlowSummary } from './types';

/** Panel lateral: edita el paso elegido en el lienzo. Cada cambio devuelve un flujo nuevo (se guarda con "Guardar"). */

type Props = { flow: Flow; step: FlowStep; flows: readonly FlowSummary[]; onChange: (flow: Flow) => void; onClose: () => void };

export function StepEditor({ flow, step, flows, onChange, onClose }: Props) {
  const isStart = step.id === flow.startNodeId;
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const update = (next: FlowStep) => onChange(updateStep(flow, next));
  // En los flujos por comentario el primer paso tiene que ser un mensaje (el DM al comentario).
  const canStart = !isStart && (flow.trigger.type !== 'comment' || step.type === 'message');
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label flex items-center gap-1.5">
            <Icon size={13} className={meta.accent} aria-hidden /> {GROUP_LABEL[meta.group] === meta.label ? meta.label : `${GROUP_LABEL[meta.group]} · ${meta.label}`}
          </p>
          <p className="mt-1 text-xs text-smoke">
            {meta.description} Paso «{step.id}»{isStart ? ' · primer paso' : ''}.
          </p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="text-smoke hover:text-fog">
          <X size={16} />
        </button>
      </div>

      {step.type === 'message' && <MessageEditor flow={flow} step={step} isStart={isStart} onChange={onChange} update={update} />}
      {step.type === 'carousel' && <CarouselEditor flow={flow} step={step} isStart={isStart} onChange={onChange} update={update} />}
      {step.type === 'condition' && <ConditionEditor flow={flow} step={step} onChange={onChange} update={update} />}
      {step.type !== 'message' && step.type !== 'carousel' && step.type !== 'condition' && <SimpleEditor flow={flow} step={step} flows={flows} onChange={onChange} update={update} />}

      {!isStart && (
        <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
          {canStart && (
            <button type="button" onClick={() => onChange(setStart(flow, step.id))} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-mist hover:text-fog">
              <Flag size={13} /> Hacer primer paso
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onChange(removeStep(flow, step.id));
              onClose();
            }}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-bad/30 px-3 py-1.5 text-[12px] font-semibold text-bad hover:bg-bad/10"
          >
            <Trash2 size={13} /> Quitar este paso
          </button>
        </div>
      )}
    </div>
  );
}
