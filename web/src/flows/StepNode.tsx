import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Bot, Clock, MessageSquare, UserCheck, type LucideIcon } from 'lucide-react';
import { outputsOf } from './graph';
import { STEP_LABEL, type FlowStep, type StepType } from './types';

/** Una caja del lienzo: tipo, resumen y una salida (punto a la derecha) por cada camino posible. */

export type StepNodeData = { step: FlowStep; isStart: boolean };
export type StepNodeType = Node<StepNodeData, 'step'>;

const ICON: Readonly<Record<StepType, LucideIcon>> = { message: MessageSquare, follow_gate: UserCheck, delay: Clock, setter_opener: Bot };
const ACCENT: Readonly<Record<StepType, string>> = {
  message: 'text-ember-400',
  follow_gate: 'text-info',
  delay: 'text-ash',
  setter_opener: 'text-violet',
};

export function formatSeconds(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

export function stepSummary(step: FlowStep): string {
  switch (step.type) {
    case 'message':
      return step.text;
    case 'follow_gate':
      return 'Comprueba si la persona sigue la cuenta.';
    case 'delay':
      return `Espera ${formatSeconds(step.seconds)}.`;
    case 'setter_opener':
      return `La IA empieza con uno de ${step.texts.length} texto(s): “${step.texts[0] ?? ''}”`;
  }
}

export function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const { step, isStart } = data;
  const Icon = ICON[step.type];
  // El primer mensaje no puede tener "después" automático (Meta solo deja seguir si la persona responde).
  const outputs = outputsOf(step).filter((output) => !(isStart && output.handle === 'next'));
  const urlButtons = step.type === 'message' ? step.buttons.filter((b) => b.type === 'url') : [];
  return (
    <div
      className={[
        'w-[250px] rounded-2xl border bg-g2 text-left shadow-lg transition-colors',
        selected ? 'border-ember-500 shadow-ember-500/10' : 'border-white/10',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-g2 !bg-ash" />
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Icon size={14} className={ACCENT[step.type]} />
        <span className="text-[12px] font-bold text-fog">{STEP_LABEL[step.type]}</span>
        {isStart && <span className="ml-auto rounded bg-ember-500/15 px-1.5 py-0.5 text-xs font-bold text-ember-400">INICIO · DM</span>}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap px-3 py-2 text-[12px] leading-snug text-mist">{stepSummary(step)}</p>
      {urlButtons.map((button, i) => (
        <p key={`url-${i}`} className="mx-3 mb-1.5 truncate rounded-md bg-white/[0.04] px-2 py-1 text-xs text-ash">
          🔗 {button.title}
        </p>
      ))}
      {outputs.length > 0 && (
        <div className="space-y-1 border-t border-white/[0.06] py-2">
          {outputs.map((output) => (
            <div key={output.handle} className="relative pl-3 pr-5 text-right text-xs text-ash">
              <span className={output.target || (step.type === 'message' && output.handle === 'next') ? 'text-mist' : 'text-warn'}>{output.label}</span>
              {/* El "después" de un mensaje es opcional; el resto de salidas tienen que ir a algún paso. */}
              {!output.target && !(step.type === 'message' && output.handle === 'next') && <span className="ml-1 text-warn">· sin conectar</span>}
              <Handle id={output.handle} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-g2 !bg-ember-500" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
