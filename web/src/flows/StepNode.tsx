import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { outputsOf } from './graph';
import { GROUP_LABEL, STEP_META, stepSummary } from './steps-meta';
import type { FlowStep } from './types';

/** Una caja del lienzo: grupo y tipo, resumen y una salida (punto a la derecha) por cada camino posible. */

export type StepNodeData = { step: FlowStep; isStart: boolean; flowName?: (id: string) => string | undefined };
export type StepNodeType = Node<StepNodeData, 'step'>;

const GROUP_BORDER = { send: 'border-l-ember-500', do: 'border-l-info', condition: 'border-l-warn' } as const;

export function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const { step, isStart } = data;
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const outputs = outputsOf(step);
  const links =
    step.type === 'message' ? step.buttons.filter((b) => b.type === 'url') : step.type === 'carousel' ? step.cards.flatMap((card) => card.buttons.filter((b) => b.type === 'url')) : [];
  return (
    <div
      className={[
        'w-[250px] rounded-2xl border border-l-4 bg-g2 text-left shadow-lg transition-colors',
        GROUP_BORDER[meta.group],
        selected ? 'border-ember-500 shadow-ember-500/10' : 'border-white/10',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-g2 !bg-ash" />
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Icon size={14} className={meta.accent} aria-hidden />
        <span className="text-[12px] font-bold text-fog">{meta.label}</span>
        {isStart ? (
          <span className="ml-auto rounded bg-ember-500/15 px-1.5 py-0.5 text-xs font-bold text-ember-400">INICIO</span>
        ) : (
          <span className="ml-auto text-xs text-smoke">{GROUP_LABEL[meta.group]}</span>
        )}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words px-3 py-2 text-[12px] leading-snug text-mist">{stepSummary(step, data.flowName)}</p>
      {links.map((button, i) => (
        <p key={`url-${i}`} className="mx-3 mb-1.5 truncate rounded-md bg-white/[0.04] px-2 py-1 text-xs text-ash">
          🔗 {button.title}
        </p>
      ))}
      {outputs.length > 0 && (
        <div className="space-y-1 border-t border-white/[0.06] py-2">
          {outputs.map((output) => (
            <div key={output.handle} className="relative pl-3 pr-5 text-right text-xs text-ash">
              <span className={output.target || output.optional ? 'text-mist' : 'text-warn'}>{output.label}</span>
              {!output.target && !output.optional && <span className="ml-1 text-warn">· sin conectar</span>}
              <Handle id={output.handle} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-g2 !bg-ember-500" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
