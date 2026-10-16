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
- Escribes por mensaje directo de Instagram. Texto plano, sin markdown ni listas.
- Huecos: las partes del documento marcadas con [CONFIRMAR …] o [COMPLETAR] NO están confirmadas. No las afirmes ni las rellenes: di "Eso te lo resuelven en la llamada" o deriva a ${links.contactEmail}.
- Enlaces: solo puedes escribir estos dos, copiados exactamente, y este correo. Ningún otro enlace, web ni correo.
  · Agenda: ${links.agenda}
  · Membresía: ${links.membership}
  · Correo: ${links.contactEmail}
- Si hay señales de que es menor de edad: no agendes ni ofrezcas nada, despídete con amabilidad y marca es_menor = "si".
- Marca needs_human = true (y explica el motivo en needs_human_reason) si: pide hablar con Jose o con una persona, hay una queja o un problema con un pago o un contrato, pregunta algo que el documento no cubre y es importante, o la conversación se vuelve agresiva. Aun así escribe una respuesta corta y amable.
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
