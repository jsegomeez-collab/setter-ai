import { ExternalLink, FileText, Music, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Button, Card, MediaKind, QuickReply } from './types';

/**
 * Vista previa de cómo le llega a la persona en Instagram (aproximada): burbuja gris con el texto y los botones como
 * filas (plantilla de botones de Meta), respuestas rápidas como burbujas debajo, carrusel de tarjetas y archivos.
 */

function Chat({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black p-3" aria-label="Vista previa en Instagram">
      <div className="mb-3 flex items-center gap-2 border-b border-white/8 pb-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-ember-400 to-ember-700 text-xs font-bold text-black">J</span>
        <span className="text-[13px] font-semibold text-snow">josenews.ai</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-ember-400 to-ember-700" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function ButtonRows({ buttons }: { buttons: readonly Button[] }) {
  return (
    <>
      {buttons.map((button, i) => (
        <p key={`${button.title}-${i}`} className="flex items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-center text-[13px] font-semibold">
          {button.title || 'Botón sin texto'}
          {button.type === 'url' && <ExternalLink size={12} className="text-white/60" />}
        </p>
      ))}
    </>
  );
}

export function DmPreview({ text, buttons = [], quickReplies = [] }: { text: string; buttons?: readonly Button[]; quickReplies?: readonly QuickReply[] }) {
  return (
    <Chat>
      <div className="max-w-[260px] overflow-hidden rounded-[18px] bg-[#262626] text-[14px] leading-snug text-white">
        <p className="whitespace-pre-wrap break-words px-3.5 py-2">{text || ' '}</p>
        <ButtonRows buttons={buttons} />
      </div>
      {quickReplies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickReplies.map((reply, i) => (
            <span key={`${reply.title}-${i}`} className="rounded-full border border-white/25 px-3 py-1 text-[13px] font-semibold text-white">
              {reply.title || 'Sin texto'}
            </span>
          ))}
        </div>
      )}
    </Chat>
  );
}

export function CarouselPreview({ cards }: { cards: readonly Card[] }) {
  return (
    <Chat>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.map((card, i) => (
          <div key={i} className="w-[200px] shrink-0 overflow-hidden rounded-[14px] bg-[#262626] text-white">
            {card.imageUrl ? (
              <img src={card.imageUrl} alt="" className="h-[105px] w-full object-cover" loading="lazy" />
            ) : (
              <div className="grid h-[105px] place-items-center bg-white/5 text-xs text-white/40">Sin foto</div>
            )}
            <div className="px-3 py-2">
              <p className="line-clamp-2 text-[13px] font-semibold">{card.title || 'Sin título'}</p>
              {card.subtitle && <p className="line-clamp-2 text-xs text-white/60">{card.subtitle}</p>}
            </div>
            <ButtonRows buttons={card.buttons} />
          </div>
        ))}
      </div>
    </Chat>
  );
}

const MEDIA_ICON = { video: Video, audio: Music, file: FileText } as const;

export function MediaPreview({ kind, url }: { kind: MediaKind; url: string }) {
  if (kind === 'image') {
    return (
      <Chat>
        {/^https?:\/\/\S+\.\S+/.test(url) ? (
          <img src={url} alt="Vista previa de la imagen" className="max-h-[220px] max-w-[220px] rounded-[14px] object-cover" loading="lazy" />
        ) : (
          <div className="grid h-[120px] w-[180px] place-items-center rounded-[14px] bg-white/5 text-xs text-white/40">Imagen</div>
        )}
      </Chat>
    );
  }
  const Icon = MEDIA_ICON[kind];
  const name = url.split('/').pop() || 'archivo';
  return (
    <Chat>
      <div className="flex max-w-[260px] items-center gap-2 rounded-[18px] bg-[#262626] px-3.5 py-2.5 text-[13px] text-white">
        <Icon size={18} className="shrink-0 text-white/70" aria-hidden />
        <span className="truncate">{name}</span>
      </div>
    </Chat>
  );
}
