import { Ban, CalendarCheck, Crown, Film, Hand, MessagesSquare, Sparkles, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Piezas visuales comunes (Fase 8, pedida por Jose: "mucho más visual"): foto de cada persona (o sus iniciales),
 * portada de cada reel y la etapa del lead con su color e icono. Regla del sistema de diseño: nada decorativo que no
 * ayude a decidir; el color nunca va solo (siempre icono + texto).
 */

export type StageId = 'nuevo' | 'seguir_calificando' | 'agendar_llamada' | 'ofrecer_membresia' | 'derivar_a_jose' | 'descartar';

export interface StageMeta {
  readonly id: StageId;
  readonly label: string;
  /** Qué significa, en una frase. */
  readonly hint: string;
  readonly icon: LucideIcon;
  /** Clases de Tailwind (literales para que las detecte): texto/icono, fondo suave, relleno sólido y borde. */
  readonly text: string;
  readonly soft: string;
  readonly solid: string;
  readonly ring: string;
}

/** En el orden del tablero. Colores validados en styles.css (tokens stage-*). */
export const STAGES: readonly StageMeta[] = [
  { id: 'nuevo', label: 'Nuevo', hint: 'Aún sin ficha de la IA', icon: Sparkles, text: 'text-mist', soft: 'bg-white/[0.06]', solid: 'bg-mist', ring: 'border-white/15' },
  {
    id: 'seguir_calificando',
    label: 'Calificando',
    hint: 'La IA le está haciendo preguntas',
    icon: MessagesSquare,
    text: 'text-stage-qualify',
    soft: 'bg-stage-qualify/15',
    solid: 'bg-stage-qualify',
    ring: 'border-stage-qualify/40',
  },
  {
    id: 'agendar_llamada',
    label: 'Agendar',
    hint: 'Listo para la llamada',
    icon: CalendarCheck,
    text: 'text-stage-book',
    soft: 'bg-stage-book/15',
    solid: 'bg-stage-book',
    ring: 'border-stage-book/40',
  },
  {
    id: 'ofrecer_membresia',
    label: 'Membresía',
    hint: 'Se le ofrece la membresía',
    icon: Crown,
    text: 'text-stage-member',
    soft: 'bg-stage-member/15',
    solid: 'bg-stage-member',
    ring: 'border-stage-member/40',
  },
  {
    id: 'derivar_a_jose',
    label: 'Pasar a Jose',
    hint: 'Necesita que escribas tú',
    icon: Hand,
    text: 'text-stage-human',
    soft: 'bg-stage-human/15',
    solid: 'bg-stage-human',
    ring: 'border-stage-human/40',
  },
  { id: 'descartar', label: 'Descartado', hint: 'No encaja ahora', icon: Ban, text: 'text-smoke', soft: 'bg-white/[0.04]', solid: 'bg-smoke', ring: 'border-white/10' },
];

const BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));
const NEW_STAGE = STAGES[0] as StageMeta;

/** Etapa de un lead a partir de su `siguiente_paso` (null o desconocido = Nuevo). */
export function stageMeta(stage: string | null | undefined): StageMeta {
  return (stage && BY_ID.get(stage as StageId)) || NEW_STAGE;
}

/** Etapa con su color, icono y nombre. `size="lg"` para cabeceras. */
export function StageChip({ stage, size = 'sm' }: { stage: string | null | undefined; size?: 'sm' | 'lg' }) {
  const meta = stageMeta(stage);
  const Icon = meta.icon;
  return (
    <span
      title={meta.hint}
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border font-sans font-semibold tracking-normal text-fog',
        meta.soft,
        meta.ring,
        size === 'lg' ? 'px-2.5 py-1 text-[13px]' : 'px-1.5 py-0.5 text-xs',
      ].join(' ')}
    >
      <Icon size={size === 'lg' ? 15 : 12} className={meta.text} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** Tonos suaves para las iniciales (el mismo nombre siempre sale del mismo color). */
const AVATAR_TINTS = ['bg-stage-qualify/25', 'bg-stage-book/25', 'bg-stage-member/25', 'bg-stage-human/25', 'bg-ember-500/25', 'bg-white/10'] as const;

function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/^@/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : clean.slice(0, 2);
  return letters.toUpperCase();
}

function tintOf(name: string | null | undefined): string {
  let hash = 0;
  for (const char of name ?? '') hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length] as string;
}

/**
 * Foto de perfil de Instagram; si no hay (o el enlace caducó), sus iniciales en un color fijo. Decorativa: el nombre
 * siempre va al lado, así que el lector de pantalla no la lee.
 */
export function Avatar({ name, picture, size = 36 }: { name: string | null | undefined; picture?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (picture && !failed) {
    return (
      <img
        src={picture}
        alt=""
        aria-hidden="true"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-g4 object-cover ring-1 ring-white/10"
        style={style}
      />
    );
  }
  return (
    <span aria-hidden="true" className={['grid shrink-0 place-items-center rounded-full font-bold text-fog ring-1 ring-white/10', tintOf(name)].join(' ')} style={style}>
      {initialsOf(name)}
    </span>
  );
}

/** Portada de un reel (o un icono si Meta no la dio o caducó). Decorativa: el título del reel va al lado. */
export function ReelCover({ src, size = 44, className = '' }: { src: string | null | undefined; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: Math.round(size * 1.25) };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={['shrink-0 rounded-lg bg-g4 object-cover ring-1 ring-white/10', className].join(' ')}
        style={style}
      />
    );
  }
  return (
    <span aria-hidden="true" className={['grid shrink-0 place-items-center rounded-lg bg-g4 text-smoke ring-1 ring-white/10', className].join(' ')} style={style}>
      <Film size={Math.round(size * 0.4)} />
    </span>
  );
}
