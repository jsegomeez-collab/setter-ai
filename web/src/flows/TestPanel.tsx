import { Bot, Clock, FlaskConical, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Notice } from '../ui/kit';
import { DmPreview } from './Preview';
import { walk, type SimItem } from './simulate';
import { formatSeconds } from './StepNode';
import type { Flow, FlowsResponse } from './types';

/** Probar un comentario (Fase 6.5c): ¿salta el flujo? y, si salta, recorrer el camino como la persona. No envía nada. */

type Line = SimItem | { readonly kind: 'tap'; readonly label: string };
type Result = { matches: boolean; reasons: string[]; enabled: boolean; takenBy: { id: string; name: string } | null };

const GATE_CHOICES = [
  { label: 'Sí sigue', field: 'ifFollowing' },
  { label: 'No sigue', field: 'ifNotFollowing' },
  { label: 'No se sabe', field: 'ifUnknown' },
] as const;

export function TestPanel({ flow, reels, onFocus, onClose }: { flow: Flow; reels: FlowsResponse['reels']; onFocus: (stepId: string | null) => void; onClose: () => void }) {
  const firstReel = flow.trigger.mediaIds === 'all' ? (reels[0]?.mediaId ?? '') : (flow.trigger.mediaIds[0] ?? '');
  const [mediaId, setMediaId] = useState(firstReel);
  const [username, setUsername] = useState(flow.testUsernames[0] ?? '');
  const [text, setText] = useState(flow.trigger.keywords[0] ?? 'Info');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const go = (stepId: string, before: Line[] = []) => {
    const next = [...before, ...walk(flow, stepId)];
    setLines(next);
    const last = [...next].reverse().find((line): line is Extract<SimItem, { stepId: string }> => 'stepId' in line);
    onFocus(last?.stepId ?? null);
  };

  const run = async () => {
    setError(null);
    try {
      const res = await api<Result>(`/flows/${encodeURIComponent(flow.id)}/test`, {
        method: 'POST',
        body: { draft: { trigger: flow.trigger, testUsernames: flow.testUsernames }, comment: { text, username: username.replace(/^@/, '') || null, mediaId: mediaId || null } },
      });
      setResult(res);
      if (res.matches) go(flow.startNodeId);
      else setLines([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo probar');
    }
  };

  const tap = (label: string, target: string) => go(target, [...lines, { kind: 'tap', label }]);
  const last = lines.at(-1);
  // Los reels elegidos que no están entre los últimos también salen (con su número), para que la lista diga la verdad.
  const chosen = flow.trigger.mediaIds === 'all' ? null : flow.trigger.mediaIds;
  const reelOptions = chosen
    ? chosen.map((id) => reels.find((r) => r.mediaId === id) ?? { mediaId: id, label: `Reel ${id}` })
    : reels;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <p className="label flex items-center gap-1.5">
          <FlaskConical size={13} /> Probar un comentario
        </p>
        <button type="button" aria-label="Cerrar la prueba" onClick={onClose} className="text-smoke hover:text-fog">
          <X size={16} />
        </button>
      </div>
      <p className="text-xs text-smoke">Usa lo que tienes en el lienzo (aunque no esté guardado). No se envía nada a nadie.</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <select aria-label="Reel" className="field !py-2 text-[13px]" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
          {reelOptions.map((r) => (
            <option key={r.mediaId} value={r.mediaId}>
              {r.label}
            </option>
          ))}
          <option value="otro">Otro reel (no elegido)</option>
        </select>
        <input aria-label="Usuario" className="field !py-2 text-[13px]" placeholder="@usuario que comenta" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input aria-label="Comentario" className="field !py-2 text-[13px]" placeholder="Texto del comentario" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()} className="btn-gold w-full py-2 text-[13px]">
          Probar
        </button>
      </form>

      {error && <Notice tone="bad">{error}</Notice>}
      {result && !result.matches && (
        <div role="status" className="rounded-lg border border-bad/30 bg-bad/[0.08] px-3 py-2 text-[13px] text-bad">
          <p className="font-semibold">No saltaría este flujo:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {result?.matches && (
        <>
          <Notice tone={result.takenBy || !result.enabled ? 'warn' : 'ok'}>
            Saltaría este flujo.
            {!result.enabled && ' Ahora mismo está INACTIVO: no pasará nada hasta activarlo.'}
            {result.takenBy && ` Pero el flujo activo “${result.takenBy.name}” es más específico y se quedaría con este comentario.`}
          </Notice>
          {flow.publicReplies[0] && <p className="text-xs text-ash">Respuesta pública en el reel (una al azar): “{flow.publicReplies[0]}”</p>}
          <div className="space-y-3">
            {lines.map((line, i) => (
              <SimLine key={i} line={line} />
            ))}
          </div>
          {last?.kind === 'message' && last.buttons.some((b) => b.type === 'postback') && (
            <Choices options={last.buttons.flatMap((b) => (b.type === 'postback' ? [{ label: b.title, target: b.next }] : []))} onPick={tap} prefix="Pulsar" />
          )}
          {last?.kind === 'gate' && (() => {
            const gate = flow.nodes.find((s) => s.id === last.stepId);
            return gate?.type === 'follow_gate' ? <Choices options={GATE_CHOICES.map((c) => ({ label: c.label, target: gate[c.field] }))} onPick={tap} prefix="Si" /> : null;
          })()}
          <button type="button" onClick={() => go(flow.startNodeId)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ash hover:text-fog">
            <RotateCcw size={13} /> Empezar de nuevo
          </button>
        </>
      )}
    </div>
  );
}

function Choices({ options, onPick, prefix }: { options: readonly { label: string; target: string }[]; onPick: (label: string, target: string) => void; prefix: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.label} type="button" onClick={() => onPick(o.label, o.target)} className="rounded-full border border-ember-500/40 px-3 py-1 text-[12px] font-semibold text-ember-400 hover:bg-ember-500/10">
          {prefix} «{o.label}»
        </button>
      ))}
    </div>
  );
}

function SimLine({ line }: { line: Line }) {
  switch (line.kind) {
    case 'message':
      return <DmPreview text={line.text} buttons={line.buttons} />;
    case 'tap':
      return <p className="text-right text-[12px] text-info">La persona: «{line.label}»</p>;
    case 'wait':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-ash">
          <Clock size={12} /> Espera {formatSeconds(line.seconds)}
        </p>
      );
    case 'gate':
      return <p className="text-[12px] text-ash">¿Sigue la cuenta? Elige qué pasa:</p>;
    case 'setter':
      return (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[12px] text-violet">
            <Bot size={12} /> Empieza el setter IA (a partir de aquí conversa sola):
          </p>
          <DmPreview text={line.text} />
        </div>
      );
    case 'broken':
      return <Notice tone="warn">{line.text}</Notice>;
  }
}
