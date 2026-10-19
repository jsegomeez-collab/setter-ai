import {
  Bell,
  Bot,
  Clock,
  CornerDownRight,
  FileImage,
  GalleryHorizontal,
  GitBranch,
  Heart,
  MessageSquare,
  NotebookPen,
  PauseCircle,
  Tag,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type { ConditionRule, FlowStep, MediaKind, StepType } from './types';

/**
 * Ficha de cada tipo de paso (Fase 7.3b): en qué grupo va, cómo se llama, su icono y color, qué hace (una frase),
 * con qué valores nace y su resumen en la caja del lienzo. Un solo sitio para todo el constructor.
 */

export type StepGroup = 'send' | 'do' | 'condition';

export const GROUP_LABEL: Readonly<Record<StepGroup, string>> = { send: 'Enviar', do: 'Hacer', condition: 'Condición' };

interface StepMeta {
  readonly group: StepGroup;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Clase de color del icono. */
  readonly accent: string;
  readonly description: string;
  readonly create: (id: string) => FlowStep;
}

export const STEP_META: Readonly<Record<StepType, StepMeta>> = {
  message: {
    group: 'send',
    label: 'Mensaje',
    icon: MessageSquare,
    accent: 'text-ember-400',
    description: 'Texto con botones o respuestas rápidas.',
    create: (id) => ({ id, type: 'message', text: 'Escribe aquí el mensaje', buttons: [], quickReplies: [] }),
  },
  carousel: {
    group: 'send',
    label: 'Carrusel',
    icon: GalleryHorizontal,
    accent: 'text-ember-400',
    description: 'Hasta 10 tarjetas con foto, texto y botones.',
    create: (id) => ({ id, type: 'carousel', cards: [{ title: 'Título de la tarjeta', subtitle: 'Texto corto', buttons: [] }] }),
  },
  media: {
    group: 'send',
    label: 'Imagen, vídeo o archivo',
    icon: FileImage,
    accent: 'text-ember-400',
    description: 'Manda una imagen, un vídeo, un audio o un PDF desde un enlace.',
    create: (id) => ({ id, type: 'media', kind: 'image', url: 'https://' }),
  },
  react: {
    group: 'send',
    label: 'Reacción',
    icon: Heart,
    accent: 'text-ember-400',
    description: 'Reacciona con un emoji a su último mensaje.',
    create: (id) => ({ id, type: 'react', emoji: '❤️' }),
  },
  setter_opener: {
    group: 'send',
    label: 'Setter IA',
    icon: Bot,
    accent: 'text-violet',
    description: 'La IA escribe primero y a partir de ahí conversa sola.',
    create: (id) => ({ id, type: 'setter_opener', texts: ['¡Hola! ¿a qué te dedicas?'] }),
  },
  tag: {
    group: 'do',
    label: 'Etiqueta',
    icon: Tag,
    accent: 'text-info',
    description: 'Pone o quita una etiqueta en su ficha.',
    create: (id) => ({ id, type: 'tag', op: 'add', tag: '' }),
  },
  field: {
    group: 'do',
    label: 'Guardar un dato',
    icon: NotebookPen,
    accent: 'text-info',
    description: 'Guarda un dato propio en su ficha (p. ej. interés = guía).',
    create: (id) => ({ id, type: 'field', field: '', value: '' }),
  },
  ai: {
    group: 'do',
    label: 'Pausar o activar la IA',
    icon: PauseCircle,
    accent: 'text-info',
    description: 'Para el setter IA en esta conversación (o lo vuelve a activar).',
    create: (id) => ({ id, type: 'ai', paused: true }),
  },
  notify: {
    group: 'do',
    label: 'Avisarme',
    icon: Bell,
    accent: 'text-info',
    description: 'Te deja un aviso en el Inicio. No escribe a nadie.',
    create: (id) => ({ id, type: 'notify', text: 'Esta persona quiere hablar contigo' }),
  },
  goto: {
    group: 'do',
    label: 'Ir a otro flujo',
    icon: CornerDownRight,
    accent: 'text-info',
    description: 'Sigue con el principio de otro flujo (tiene que estar activo).',
    create: (id) => ({ id, type: 'goto', flowId: '' }),
  },
  delay: {
    group: 'do',
    label: 'Esperar',
    icon: Clock,
    accent: 'text-ash',
    description: 'Espera unos minutos u horas (máximo 23 h) antes de seguir.',
    create: (id) => ({ id, type: 'delay', seconds: 15 * 60, next: '' }),
  },
  follow_gate: {
    group: 'condition',
    label: '¿Me sigue?',
    icon: UserCheck,
    accent: 'text-warn',
    description: 'Mira si sigue la cuenta: sí / no / no se sabe.',
    create: (id) => ({ id, type: 'follow_gate', ifFollowing: '', ifNotFollowing: '', ifUnknown: '' }),
  },
  condition: {
    group: 'condition',
    label: 'Condición',
    icon: GitBranch,
    accent: 'text-warn',
    description: 'Etiqueta, dato, palabra, verificado, seguidores, horario o A/B.',
    create: (id) => ({ id, type: 'condition', rule: { kind: 'has_tag', tag: '' }, ifTrue: '', ifFalse: '' }),
  },
};

export const STEP_TYPES_BY_GROUP: Readonly<Record<StepGroup, readonly StepType[]>> = {
  send: ['message', 'carousel', 'media', 'react', 'setter_opener'],
  do: ['tag', 'field', 'ai', 'notify', 'goto', 'delay'],
  condition: ['follow_gate', 'condition'],
};

export const MEDIA_LABEL: Readonly<Record<MediaKind, string>> = { image: 'Imagen (PNG o JPG, máx. 8 MB)', video: 'Vídeo (máx. 25 MB)', audio: 'Audio (máx. 25 MB)', file: 'PDF (máx. 25 MB)' };

export const RULE_LABEL: Readonly<Record<ConditionRule['kind'], string>> = {
  has_tag: 'Tiene una etiqueta',
  field: 'Un dato de su ficha',
  keyword: 'Su último mensaje tiene una palabra',
  verified: 'Su cuenta está verificada',
  followers: 'Tiene al menos X seguidores',
  hours: 'Es dentro de un horario',
  random: 'Al azar (prueba A/B)',
};

const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function formatSeconds(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

export function ruleSummary(rule: ConditionRule): string {
  switch (rule.kind) {
    case 'has_tag':
      return `¿Tiene la etiqueta «${rule.tag || '…'}»?`;
    case 'field':
      return rule.op === 'set' ? `¿Tiene el dato «${rule.field || '…'}»?` : `¿«${rule.field || '…'}» ${rule.op === 'equals' ? 'es' : 'contiene'} «${rule.value}»?`;
    case 'keyword':
      return `¿Su mensaje dice ${rule.keywords.map((k) => `«${k}»`).join(' o ') || '…'}?`;
    case 'verified':
      return '¿Cuenta verificada?';
    case 'followers':
      return `¿${rule.min.toLocaleString('es')} seguidores o más?`;
    case 'hours':
      return `¿${rule.days.map((d) => DAY_SHORT[d]).join(', ')} de ${rule.from} a ${rule.to}?`;
    case 'random':
      return `${rule.percent} % por «sí», el resto por «no»`;
  }
}

/** Resumen corto del paso (caja del lienzo y desplegables). */
export function stepSummary(step: FlowStep, flowName?: (id: string) => string | undefined): string {
  switch (step.type) {
    case 'message':
      return step.text;
    case 'carousel':
      return `${step.cards.length} tarjeta(s): ${step.cards.map((card) => card.title).join(' · ')}`;
    case 'media':
      return `${MEDIA_LABEL[step.kind].split(' (')[0]}: ${step.url}`;
    case 'react':
      return `Reacciona con ${step.emoji}`;
    case 'follow_gate':
      return 'Comprueba si la persona sigue la cuenta.';
    case 'delay':
      return `Espera ${formatSeconds(step.seconds)}.`;
    case 'setter_opener':
      return `La IA empieza con uno de ${step.texts.length} texto(s): “${step.texts[0] ?? ''}”`;
    case 'tag':
      return `${step.op === 'add' ? 'Pone' : 'Quita'} la etiqueta «${step.tag || '…'}»`;
    case 'field':
      return step.value ? `Guarda ${step.field || '…'} = «${step.value}»` : `Borra el dato «${step.field || '…'}»`;
    case 'ai':
      return step.paused ? 'Pausa el setter IA en esta conversación' : 'Vuelve a activar el setter IA';
    case 'notify':
      return `Te avisa: «${step.text}»`;
    case 'goto':
      return step.flowId ? `Sigue con el flujo «${flowName?.(step.flowId) ?? step.flowId}»` : 'Elige a qué flujo va';
    case 'condition':
      return ruleSummary(step.rule);
  }
}
