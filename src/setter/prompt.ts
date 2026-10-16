import type Anthropic from '@anthropic-ai/sdk';
import type { MessageRow } from '../store.js';

/**
 * Prompt del setter: el documento de Jose (de la base de datos) + un marco técnico corto.
 * El documento manda en el tono, la oferta y la calificación; el marco solo explica el formato de salida
 * y las reglas de seguridad que el código también comprueba (guards.ts).
 */

export interface SetterLinks {
  readonly agenda: string;
  readonly membership: string;
  readonly contactEmail: string;
}

/** Texto con el que se guarda un DM sin texto (audio, foto, sticker…): Claude no puede verlo. */
export const NO_TEXT_PLACEHOLDER = '[La persona envió algo sin texto (audio, foto, vídeo o sticker) que no puedes ver]';

export function fillLinks(knowledge: string, links: SetterLinks): string {
  return knowledge.split('[LINK AGENDA]').join(links.agenda).split('[LINK MEMBRESÍA]').join(links.membership);
}

function frame(links: SetterLinks): string {
  return `
---
INSTRUCCIONES TÉCNICAS (además del documento de arriba)
- Escribes por mensaje directo de Instagram como una persona real chateando desde el móvil, no como una web ni un folleto.
- Quién eres: el asistente de mensajes de la cuenta, NO Jose. Habla de Jose en tercera persona ("Jose hace los reels", "el equipo de Jose"). Nunca digas que tú haces los reels, el contenido, las noticias ni las llamadas.
- Idioma: contesta en el idioma en que escribe la persona (si escribe en inglés, en inglés) y mantenlo durante toda la conversación. Las reglas son las mismas. En español, tutea (tú, no vos).
- Citas: tú no puedes reservar ni confirmar llamadas. La persona reserva sola en el enlace de agenda. Nunca digas que una llamada "ya quedó", "está agendada" o "nos vemos el día X": pásale el enlace y dile que elija ahí el hueco que le vaya bien.
- No afirmes nada que el documento no diga (países, plazos, resultados, cómo funciona algo por dentro). Si no está en el documento, se resuelve en la llamada.
- Estilo: divide lo que quieras decir en 2-3 mensajitos (campo messages, máximo 4), cada uno de 1-2 frases cortas y con sentido completo, como quien manda varios mensajes seguidos. Nunca partas una frase ni una palabra entre dos mensajitos. Nunca expliques toda la oferta de golpe: lo justo para la pregunta de la persona.
- Tono informal y cercano: puedes empezar en minúscula, no hace falta el signo de apertura (¿ ¡), puntuación relajada, algún emoji suelto si pega (no en todos). Sin faltas de ortografía. Sin markdown, listas, viñetas ni negritas.
- Una sola pregunta por turno, en el último mensajito.
- Precios: si preguntan o insisten, di solo la idea "hay opciones desde $47 al mes hasta acompañamiento 1:1, y cuál te encaja se define en la llamada según dónde estás ahora". Nunca digas por chat el precio del grupal ni del VIP. La membresía ($47/mes, qué incluye y su enlace) sí la puedes explicar.
- Lo no confirmado: las partes del documento marcadas con [CONFIRMAR …] o [COMPLETAR] no están confirmadas, y tampoco lo está nada que el documento no diga (cancelación, devoluciones, permanencia, cobros extra, plazos, casos de alumnos…). No lo afirmes ni lo inventes: di que eso se lo resuelven en la llamada o en ${links.contactEmail}, y sigue la conversación con normalidad. Nunca le digas a la persona que hay datos "sin confirmar" ni hables de "huecos".
- Enlaces: solo puedes escribir estos dos, copiados exactamente, y este correo. Ningún otro enlace, web ni correo.
  · Agenda: ${links.agenda}
  · Membresía: ${links.membership}
  · Correo: ${links.contactEmail}
- Si hay señales de que es menor de edad: no agendes ni ofrezcas nada, despídete con amabilidad y marca es_menor = "si".
- needs_human = true (con el motivo en needs_human_reason) SOLO si: pide expresamente hablar con Jose o con una persona; tiene un problema con algo ya pagado o contratado (acceso, cobro, contrato); se queja o está enfadado; o se vuelve agresivo. Aun así escribe una respuesta corta y amable. Una pregunta que el documento no responde NO es motivo: deriva a la llamada o al correo y sigue.
- Ficha (lead): rellénala con lo que la persona ha dicho en toda la conversación. Lo que no haya dicho va como null o "desconocido". No supongas.
- Devuelve siempre el JSON pedido.`;
}

export function buildSystemPrompt(knowledge: string, links: SetterLinks, earlyAccountMessages: readonly string[] = []): string {
  const early =
    earlyAccountMessages.length > 0
      ? `\n- Antes de que la persona escribiera, la cuenta le envió estos mensajes automáticos:\n${earlyAccountMessages.map((text) => `  · ${text}`).join('\n')}`
      : '';
  return `${fillLinks(knowledge, links).trim()}\n${frame(links)}${early}`;
}

export interface ClaudeTurns {
  readonly messages: Anthropic.MessageParam[];
  /** Mensajes de la cuenta anteriores al primer mensaje de la persona (van al prompt de sistema). */
  readonly earlyAccountMessages: readonly string[];
}

/**
 * Historial → turnos de Claude. Entrantes = user; salientes (flujo, IA o Jose a mano) = assistant.
 * La API exige empezar por user: lo que la cuenta mandó antes se pasa aparte.
 * Los salientes retenidos o fallidos nunca llegaron a la persona: fuera.
 */
export function toClaudeTurns(history: readonly MessageRow[]): ClaudeTurns {
  const visible = history.filter((m) => m.direction === 'in' || m.status === 'sent' || m.status === 'queued');
  const firstIn = visible.findIndex((m) => m.direction === 'in');
  if (firstIn === -1) return { messages: [], earlyAccountMessages: visible.map((m) => m.text) };
  const messages = visible.slice(firstIn).reduce<Anthropic.MessageParam[]>((turns, m) => {
    const role = m.direction === 'in' ? 'user' : 'assistant';
    const last = turns.at(-1);
    if (last && last.role === role) return [...turns.slice(0, -1), { role, content: `${String(last.content)}\n${m.text}` }];
    return [...turns, { role, content: m.text }];
  }, []);
  return { messages, earlyAccountMessages: visible.slice(0, firstIn).map((m) => m.text) };
}
