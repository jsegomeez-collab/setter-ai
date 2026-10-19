import '@xyflow/react/dist/style.css';
import { Background, Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Connection, type DefaultEdgeOptions, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addStep, connect, disconnect, freeSpot, moveStep, toCanvas } from './graph';
import { GROUP_LABEL, STEP_META, STEP_TYPES_BY_GROUP, type StepGroup } from './steps-meta';
import { StepNode, type StepNodeType } from './StepNode';
import { MAX_STEPS, type Flow, type StepType } from './types';

/** Lienzo tipo ManyChat (React Flow): cajas que se arrastran y flechas entre la salida de una y la entrada de otra. */

type Props = {
  flow: Flow;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (flow: Flow) => void;
  /** Nombre de otro flujo por su id (para "ir a otro flujo"). */
  flowName?: (id: string) => string | undefined;
};

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
const GROUPS: readonly StepGroup[] = ['send', 'do', 'condition'];
const NODE_HALF = { x: 125, y: 70 };
const START_VIEWPORT = { x: 30, y: 80, zoom: 0.8 };

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ flow, selected, onSelect, onChange, flowName }: Props) {
  const canvas = useMemo(() => toCanvas(flow), [flow]);
  const [nodes, setNodes] = useState<StepNodeType[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Las cajas se copian a un estado local para que arrastrar sea fluido; al soltar se guarda la posición en el flujo.
  useEffect(() => {
    setNodes(canvas.nodes.map((n) => ({ id: n.id, type: 'step', position: n.position, data: { step: n.step, isStart: n.isStart, flowName }, selected: n.id === selected })));
  }, [canvas, selected, flowName]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  const edges: Edge[] = useMemo(() => canvas.edges.map((e) => ({ ...e, selectable: true })), [canvas]);

  const add = (type: StepType) => {
    const box = wrapper.current?.getBoundingClientRect();
    const center = box ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
    const result = addStep(flow, type, freeSpot(flow, { x: Math.round(center.x - NODE_HALF.x), y: Math.round(center.y - NODE_HALF.y) }));
    onChange(result.flow);
    onSelect(result.id);
    setMenuOpen(false);
  };
  const full = flow.nodes.length >= MAX_STEPS;

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
    <div ref={wrapper} className="@container h-full w-full">
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
          <button
            type="button"
            disabled={full}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className="btn-gold inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] shadow-lg"
            title={full ? `Máximo ${MAX_STEPS} pasos por flujo` : undefined}
          >
            {menuOpen ? <X size={14} /> : <Plus size={14} />} Añadir paso
          </button>
          {menuOpen && <AddMenu onPick={add} />}
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** Menú de "Añadir paso": los tres grupos de ManyChat, cada opción con lo que hace en una línea. */
function AddMenu({ onPick }: { onPick: (type: StepType) => void }) {
  return (
    <div role="menu" aria-label="Añadir paso" className="mt-2 grid max-h-[60vh] w-[min(720px,calc(100cqw-32px))] grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-g2 p-3 shadow-2xl">
      {GROUPS.map((group) => (
        <div key={group}>
          <p className="label mb-1.5 px-2">{GROUP_LABEL[group]}</p>
          <ul className="space-y-0.5">
            {STEP_TYPES_BY_GROUP[group].map((type) => {
              const meta = STEP_META[type];
              const Icon = meta.icon;
              return (
                <li key={type}>
                  <button type="button" role="menuitem" onClick={() => onPick(type)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05] focus-visible:bg-white/[0.05]">
                    <Icon size={15} className={`mt-0.5 shrink-0 ${meta.accent}`} aria-hidden />
                    <span>
                      <span className="block text-[13px] font-semibold text-fog">{meta.label}</span>
                      <span className="block text-xs leading-snug text-ash">{meta.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
