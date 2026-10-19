import { Bot, Clock, CornerDownRight, FlaskConical, GitBranch, Heart, RotateCcw, Zap, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Notice } from '../ui/kit';
import { CarouselPreview, DmPreview, MediaPreview } from './Preview';
import { choicesAfter, walk, type SimItem } from './simulate';
import { formatSeconds } from './steps-meta';
import { TRIGGER_LABEL, type Flow, type FlowSummary, type FlowsResponse } from './types';

/**
 * Probar (Fase 6.5c, ampliado en la 7.3b): ¿salta el flujo con este comentario o este DM? y, si salta, recorrer el
 * camino como la persona. Usa el borrador del lienzo (aunque no esté guardado). No envía nada a nadie.
 */

type Line = SimItem | { readonly kind: 'tap'; readonly label: string };
type Result = { matches: boolean; reasons: string[]; enabled: boolean; takenBy: { id: string; name: string } | null };
type Props = { flow: Flow; reels: FlowsResponse['reels']; flows: readonly FlowSummary[]; onFocus: (stepId: string | null) => void; onClose: () => void };

export function TestPanel({ flow, reels, flows, onFocus, onClose }: Props) {
  const { trigger } = flow;
  const firstReel = trigger.type === 'comment' ? (trigger.mediaIds === 'all' ? (reels[0]?.mediaId ?? '') : (trigger.mediaIds[0] ?? '')) : '';
  const firstWord = trigger.type === 'comment' || trigger.type === 'dm_keyword' || trigger.type === 'story_reply' ? (trigger.keywords[0] ?? '') : '';
  const [mediaId, setMediaId] = useState(firstReel);
  const [username, setUsername] = useState(flow.testUsernames[0] ?? '');
  const [text, setText] = useState(firstWord || (trigger.type === 'story_reply' ? '🔥' : 'Info'));
  const [ref, setRef] = useState(trigger.type === 'ref' ? trigger.ref : '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const go = (stepId: string, before: Line[] = []) => {
    const next = [...before, ...walk(flow, stepId)];
    setLines(next);
    const last = [...next].reverse().find((line): line is Extract<SimItem, { stepId: string }> => 'stepId' in line);
    onFocus(last?.stepId ?? null);
  };

  const probeBody = () => {
    const who = username.replace(/^@/, '') || null;
    if (trigger.type === 'comment') return { comment: { text, username: who, mediaId: mediaId || null } };
    return {
      message: {
        text: trigger.type === 'story_mention' || trigger.type === 'ref' ? null : text,
        username: who,
        storyReply: trigger.type === 'story_reply',
        storyMention: trigger.type === 'story_mention',
        ref: trigger.type === 'ref' ? ref : null,
      },
    };
  };

  const run = async () => {
    setError(null);
    if (trigger.type === 'manual') {
      // No salta solo: se recorre desde el primer paso, como si llegara desde otro flujo, un rompehielos o el menú.
      setResult({ matches: true, reasons: [], enabled: flow.enabled, takenBy: null });
      go(flow.startNodeId);
      return;
    }
    try {
      const res = await api<Result>(`/flows/${encodeURIComponent(flow.id)}/test`, { method: 'POST', body: { draft: { trigger, testUsernames: flow.testUsernames }, ...probeBody() } });
      setResult(res);
      if (res.matches) go(flow.startNodeId);
      else setLines([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo probar');
    }
  };

  const last = lines.at(-1);
  const choices = choicesAfter(flow, last && last.kind !== 'tap' ? last : undefined);
  // Los reels elegidos que no están entre los últimos también salen (con su número), para que la lista diga la verdad.
  const chosen = trigger.type === 'comment' && trigger.mediaIds !== 'all' ? trigger.mediaIds : null;
  const reelOptions = chosen ? chosen.map((id) => reels.find((r) => r.mediaId === id) ?? { mediaId: id, label: `Reel ${id}` }) : reels;
  const flowName = (id: string) => flows.find((item) => item.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <p className="label flex items-center gap-1.5">
          <FlaskConical size={13} /> Probar · {TRIGGER_LABEL[trigger.type]}
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
        {trigger.type === 'comment' && (
          <select aria-label="Reel" className="field !py-2 text-[13px]" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            {reelOptions.map((r) => (
              <option key={r.mediaId} value={r.mediaId}>
                {r.label}
              </option>
            ))}
            <option value="otro">Otro reel (no elegido)</option>
          </select>
        )}
        {trigger.type !== 'manual' && <input aria-label="Usuario" className="field !py-2 text-[13px]" placeholder="@usuario" value={username} onChange={(e) => setUsername(e.target.value)} />}
        {(trigger.type === 'comment' || trigger.type === 'dm_keyword' || trigger.type === 'story_reply') && (
          <input
            aria-label={trigger.type === 'comment' ? 'Comentario' : 'Mensaje'}
            className="field !py-2 text-[13px]"
            placeholder={trigger.type === 'comment' ? 'Texto del comentario' : 'Lo que escribe la persona'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {trigger.type === 'ref' && <input aria-label="ref del enlace" className="field !py-2 text-[13px]" placeholder="ref con el que abre el chat" value={ref} onChange={(e) => setRef(e.target.value)} />}
        <button type="submit" className="btn-gold w-full py-2 text-[13px]">
          {trigger.type === 'manual' ? 'Recorrer desde el primer paso' : 'Probar'}
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
          {trigger.type !== 'manual' && (
            <Notice tone={result.takenBy || !result.enabled ? 'warn' : 'ok'}>
              Saltaría este flujo.
              {!result.enabled && ' Ahora mismo está INACTIVO: no pasará nada hasta activarlo.'}
              {result.takenBy && ` Pero el flujo activo “${result.takenBy.name}” es más concreto y se quedaría con esto.`}
            </Notice>
          )}
          {trigger.type === 'comment' && flow.publicReplies[0] && <p className="text-xs text-ash">Respuesta pública en el reel (una al azar): “{flow.publicReplies[0]}”</p>}
          <div className="space-y-3">
            {lines.map((line, i) => (
              <SimLine key={i} line={line} flowName={flowName} />
            ))}
          </div>
          {choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <button
                  key={`${choice.label}-${choice.target}`}
                  type="button"
                  onClick={() => go(choice.target, [...lines, { kind: 'tap', label: choice.label }])}
                  className="min-h-[36px] rounded-full border border-ember-500/40 px-3 py-1 text-[12px] font-semibold text-ember-400 hover:bg-ember-500/10"
                >
                  {last?.kind === 'gate' || last?.kind === 'condition' ? 'Si' : 'Pulsar'} «{choice.label}»
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => go(flow.startNodeId)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ash hover:text-fog">
            <RotateCcw size={13} /> Empezar de nuevo
          </button>
        </>
      )}
    </div>
  );
}

function SimLine({ line, flowName }: { line: Line; flowName: (id: string) => string }) {
  switch (line.kind) {
    case 'message':
      return <DmPreview text={line.text} buttons={line.buttons} quickReplies={line.quickReplies} />;
    case 'carousel':
      return <CarouselPreview cards={line.cards} />;
    case 'media':
      return <MediaPreview kind={line.mediaKind} url={line.url} />;
    case 'react':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-ash">
          <Heart size={12} /> Reacciona a su mensaje con {line.emoji}
        </p>
      );
    case 'action':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-info">
          <Zap size={12} /> {line.text}
        </p>
      );
    case 'tap':
      return <p className="text-right text-[12px] text-info">«{line.label}»</p>;
    case 'wait':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-ash">
          <Clock size={12} /> Espera {formatSeconds(line.seconds)}
        </p>
      );
    case 'gate':
      return <p className="text-[12px] text-ash">¿Sigue la cuenta? Elige qué pasa:</p>;
    case 'condition':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-warn">
          <GitBranch size={12} /> {line.text} Elige qué pasa:
        </p>
      );
    case 'goto':
      return (
        <p className="flex items-center gap-1.5 text-[12px] text-info">
          <CornerDownRight size={12} /> Sigue con el flujo «{line.flowId ? flowName(line.flowId) : '(sin elegir)'}» (pruébalo desde ese flujo).
        </p>
      );
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
