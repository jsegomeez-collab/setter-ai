import { Plus, Trash2 } from 'lucide-react';
import { ButtonsEditor, Field, NextTarget, Target } from './fields';
import { CarouselPreview, DmPreview } from './Preview';
import { MAX_CARD_TEXT, MAX_CARDS, MAX_PLAIN_TEXT, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_TITLE, MAX_TEMPLATE_TEXT, type Card, type Flow, type FlowStep } from './types';

/** Editores de los pasos que envían texto (Fase 7.3b): mensaje (botones o respuestas rápidas) y carrusel. */

type Props<T extends FlowStep['type']> = {
  flow: Flow;
  step: Extract<FlowStep, { type: T }>;
  isStart: boolean;
  onChange: (flow: Flow) => void;
  update: (step: FlowStep) => void;
};

export function MessageEditor({ flow, step, isStart, onChange, update }: Props<'message'>) {
  const quickReplies = step.quickReplies ?? [];
  const mode = quickReplies.length > 0 ? 'quick' : 'buttons';
  const limit = step.buttons.length > 0 ? MAX_TEMPLATE_TEXT : MAX_PLAIN_TEXT;
  const commentStart = isStart && flow.trigger.type === 'comment';
  const setReply = (index: number, title: string) => update({ ...step, quickReplies: quickReplies.map((r, i) => (i === index ? { ...r, title } : r)) });
  return (
    <>
      <Field label="Texto" hint={`${step.text.length} / ${limit} caracteres${step.buttons.length ? ' (con botones el máximo es 640)' : ''}`} warn={step.text.length > limit}>
        <textarea className="field min-h-[120px]" value={step.text} onChange={(e) => update({ ...step, text: e.target.value })} />
      </Field>

      {!commentStart && (
        <div className="flex gap-1.5 text-[12px]" role="group" aria-label="Tipo de respuesta">
          <ModeButton active={mode === 'buttons'} onClick={() => update({ ...step, quickReplies: [] })}>
            Botones (hasta 3)
          </ModeButton>
          <ModeButton active={mode === 'quick'} onClick={() => mode !== 'quick' && update({ ...step, buttons: [], quickReplies: [{ title: 'Sí', next: '' }] })}>
            Respuestas rápidas (hasta 13)
          </ModeButton>
        </div>
      )}

      {mode === 'buttons' ? (
        <ButtonsEditor flow={flow} step={step} buttons={step.buttons} handleOf={(i) => `btn-${i}`} onButtons={(buttons) => update({ ...step, buttons })} onChange={onChange} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-smoke">Salen como burbujas debajo del mensaje y desaparecen al pulsar una. No se ven en el ordenador (solo en el móvil).</p>
          {quickReplies.map((reply, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <div className="flex gap-2">
                <input
                  aria-label="Texto de la respuesta rápida"
                  className="field !py-1.5 text-[13px]"
                  maxLength={MAX_QUICK_REPLY_TITLE}
                  value={reply.title}
                  onChange={(e) => setReply(i, e.target.value)}
                />
                <button type="button" aria-label="Quitar respuesta rápida" onClick={() => update({ ...step, quickReplies: quickReplies.filter((_, j) => j !== i) })} className="text-smoke hover:text-bad">
                  <Trash2 size={14} />
                </button>
              </div>
              <Target flow={flow} step={step} handle={`qr-${i}`} label="Al pulsar, ir a" value={reply.next} onChange={onChange} />
            </div>
          ))}
          {quickReplies.length < MAX_QUICK_REPLIES && (
            <button type="button" onClick={() => update({ ...step, quickReplies: [...quickReplies, { title: 'Otra opción', next: '' }] })} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300">
              <Plus size={13} /> Añadir respuesta rápida
            </button>
          )}
        </div>
      )}

      {commentStart && <p className="text-xs text-smoke">Es el DM al comentario: Meta no deja mandar nada más hasta que la persona responda o pulse un botón. Detrás solo puedes poner pasos de «Hacer» (etiqueta, dato, aviso…).</p>}
      <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
      <DmPreview text={step.text} buttons={step.buttons} quickReplies={quickReplies} />
    </>
  );
}

const EMPTY_CARD: Card = { title: 'Otra tarjeta', subtitle: 'Texto corto', buttons: [] };

export function CarouselEditor({ flow, step, onChange, update }: Props<'carousel'>) {
  const setCard = (index: number, card: Card) => update({ ...step, cards: step.cards.map((c, i) => (i === index ? card : c)) });
  // Sin recortar mientras se escribe (si no, el espacio entre dos palabras desaparecería); el servidor recorta al guardar.
  const optional = (value: string) => (value.trim() === '' ? undefined : value);
  return (
    <>
      <p className="text-xs text-smoke">Tarjetas que se pasan de lado. Cada una necesita algo más que el título (texto, foto, enlace o botón). No se ven en el ordenador.</p>
      {step.cards.map((card, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-mist">Tarjeta {i + 1}</p>
            {step.cards.length > 1 && (
              <button type="button" aria-label={`Quitar la tarjeta ${i + 1}`} onClick={() => update({ ...step, cards: step.cards.filter((_, j) => j !== i) })} className="text-smoke hover:text-bad">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <input aria-label="Título" className="field !py-1.5 text-[13px]" maxLength={MAX_CARD_TEXT} placeholder="Título" value={card.title} onChange={(e) => setCard(i, { ...card, title: e.target.value })} />
          <input aria-label="Texto" className="field !py-1.5 text-[13px]" maxLength={MAX_CARD_TEXT} placeholder="Texto corto (opcional)" value={card.subtitle ?? ''} onChange={(e) => setCard(i, { ...card, subtitle: optional(e.target.value) })} />
          <input aria-label="Foto" className="field !py-1.5 text-[13px]" placeholder="Enlace de la foto https://… (opcional)" value={card.imageUrl ?? ''} onChange={(e) => setCard(i, { ...card, imageUrl: optional(e.target.value) })} />
          <input aria-label="Enlace al tocar" className="field !py-1.5 text-[13px]" placeholder="Enlace al tocar la tarjeta https://… (opcional)" value={card.url ?? ''} onChange={(e) => setCard(i, { ...card, url: optional(e.target.value) })} />
          <ButtonsEditor flow={flow} step={step} buttons={card.buttons} handleOf={(b) => `card-${i}-${b}`} onButtons={(buttons) => setCard(i, { ...card, buttons })} onChange={onChange} />
        </div>
      ))}
      {step.cards.length < MAX_CARDS && (
        <button type="button" onClick={() => update({ ...step, cards: [...step.cards, EMPTY_CARD] })} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember-400 hover:text-ember-300">
          <Plus size={13} /> Añadir tarjeta ({step.cards.length}/{MAX_CARDS})
        </button>
      )}
      <NextTarget flow={flow} step={step} value={step.next} onChange={onChange} />
      <CarouselPreview cards={step.cards} />
    </>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={['rounded-lg px-3 py-1.5 font-semibold', active ? 'bg-ember-500/15 text-ember-400' : 'text-ash hover:text-fog'].join(' ')}>
      {children}
    </button>
  );
}
