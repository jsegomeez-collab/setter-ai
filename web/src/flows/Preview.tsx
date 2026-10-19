import { ExternalLink } from 'lucide-react';
import type { Button } from './types';

/**
 * Vista previa de cómo le llega el mensaje a la persona en Instagram (aproximada: burbuja gris con el texto y,
 * debajo, los botones como filas, igual que la plantilla de botones de Meta).
 */
export function DmPreview({ text, buttons = [] }: { text: string; buttons?: readonly Button[] }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black p-3" aria-label="Vista previa en Instagram">
      <div className="mb-3 flex items-center gap-2 border-b border-white/8 pb-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-ember-400 to-ember-700 text-[11px] font-bold text-black">J</span>
        <span className="text-[13px] font-semibold text-snow">josenews.ai</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-ember-400 to-ember-700" />
        <div className="max-w-[260px] overflow-hidden rounded-[18px] bg-[#262626] text-[14px] leading-snug text-white">
          <p className="whitespace-pre-wrap break-words px-3.5 py-2">{text || ' '}</p>
          {buttons.map((button, i) => (
            <p key={`${button.title}-${i}`} className="flex items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-center text-[13px] font-semibold">
              {button.title || 'Botón sin texto'}
              {button.type === 'url' && <ExternalLink size={12} className="text-white/60" />}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
