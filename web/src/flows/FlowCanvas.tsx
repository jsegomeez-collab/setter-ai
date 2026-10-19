import '@xyflow/react/dist/style.css';
import { Background, Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Connection, type DefaultEdgeOptions, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { Bot, Clock, MessageSquare, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addStep, connect, disconnect, moveStep, toCanvas } from './graph';
import { StepNode, type StepNodeType } from './StepNode';
import { MAX_STEPS, type Flow, type StepType } from './types';

/** Lienzo tipo ManyChat (React Flow): cajas que se arrastran y flechas entre la salida de una y la entrada de otra. */

type Props = { flow: Flow; selected: string | null; onSelect: (id: string | null) => void; onChange: (flow: Flow) => void };

const NODE_TYPES = { step: StepNode };
const EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#97979e' },
  style: { stroke: '#97979e', strokeWidth: 1.5 },
  labelStyle: { fill: '#c6c6cc', fontSize: 11 },
  labelBgStyle: { fill: '#161618' },
  labelBgPadding: [6, 3],
  labelBgBorderRadius: 6,
};
const ADD: readonly { type: StepType; label: string; icon: typeof MessageSquare }[] = [
  { type: 'message', label: 'Mensaje', icon: MessageSquare },
  { type: 'follow_gate', label: '¿Me sigue?', icon: UserCheck },
  { type: 'delay', label: 'Pausa', icon: Clock },
  { type: 'setter_opener', label: 'Setter IA', icon: Bot },
];
const NODE_HALF = { x: 125, y: 70 };
const START_VIEWPORT = { x: 30, y: 80, zoom: 0.8 };

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ flow, selected, onSelect, onChange }: Props) {
  const canvas = useMemo(() => toCanvas(flow), [flow]);
  const [nodes, setNodes] = useState<StepNodeType[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Las cajas se copian a un estado local para que arrastrar sea fluido; al soltar se guarda la posición en el flujo.
  useEffect(() => {
    setNodes(canvas.nodes.map((n) => ({ id: n.id, type: 'step', position: n.position, data: { step: n.step, isStart: n.isStart }, selected: n.id === selected })));
  }, [canvas, selected]);

  const edges: Edge[] = useMemo(() => canvas.edges.map((e) => ({ ...e, selectable: true })), [canvas]);

  const add = (type: StepType) => {
    const box = wrapper.current?.getBoundingClientRect();
    const center = box ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
    const result = addStep(flow, type, { x: Math.round(center.x - NODE_HALF.x), y: Math.round(center.y - NODE_HALF.y) });
    onChange(result.flow);
    onSelect(result.id);
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.filter((change) => change.type === 'remove');
    if (removed.length === 0) return;
    onChange(
      removed.reduce((current, change) => {
        const [source = '', handle = ''] = change.id.split(':');
        return disconnect(current, source, handle);
      }, flow),
    );
  };

  const onConnect = ({ source, sourceHandle, target }: Connection) => {
    if (sourceHandle && target && source !== target) onChange(connect(flow, source, sourceHandle, target));
  };

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        colorMode="dark"
        // Al abrir: arriba a la izquierda (el primer mensaje siempre a la vista) y legible; el resto, arrastrando
        // el lienzo o con el botón de "ver todo" de abajo.
        defaultViewport={START_VIEWPORT}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        style={{ background: '#0d0d0f' }}
        onNodesChange={(changes: NodeChange<StepNodeType>[]) => setNodes((current) => applyNodeChanges(changes, current))}
        onNodeDragStop={(_, node) => onChange(moveStep(flow, node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) }))}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onConnect={onConnect}
        onEdgesChange={onEdgesChange}
        // Supr / Retroceso borran solo flechas; los pasos se quitan desde el panel (para no borrar nada sin querer).
        onBeforeDelete={async ({ edges: toDelete }) => ({ nodes: [], edges: toDelete })}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2d2d32" gap={22} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          {/* Una sola línea (en el móvil se desplaza de lado) para no tapar el primer mensaje. */}
          <div className="flex max-w-[calc(100vw-90px)] gap-1.5 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-g2/95 p-1.5 shadow-lg">
            {ADD.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                disabled={flow.nodes.length >= MAX_STEPS}
                onClick={() => add(type)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-mist hover:bg-white/[0.06] hover:text-fog disabled:opacity-40"
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
