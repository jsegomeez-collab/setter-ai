import type { Lead } from './schema.js';

/**
 * Reglas de conversación que el documento y el marco técnico ya dicen, pero que Haiku se saltaba en las simulaciones
 * del 2026-10-17 (Jose eligió seguir con Haiku y pasarlas al código). Piden otro intento; si la IA insiste con un
 * enlace que no toca, `enforceLinkRules` quita ese mensajito. No retienen nunca: no son un riesgo, son de conversación.
 */

/** Título del botón de la agenda. En el historial queda como "[Botón: Agendar llamada]" (service.ts). */
export const AGENDA_BUTTON_TITLE = 'Agendar llamada';

export interface RuleLinks {
  readonly agenda: string;
  readonly membership: string;
}

export interface RuleContext {
  /** Mensajes anteriores de la cuenta en la conversación, del más antiguo al más reciente. */
  readonly previous: readonly string[];
  /** Mensajes de la persona, del más antiguo al más reciente. */
  readonly userTurns: readonly string[];
  readonly links: RuleLinks;
  /** La ficha que acaba de devolver la IA en esta misma respuesta. */
  readonly lead: Pick<Lead, 'puede_invertir'>;
}

export interface RuleIssue {
  readonly reason: string;
  /** Enlace que no tocaba: si la IA insiste, se quita el mensajito que lo lleva. */
  readonly link?: string;
}

const MAX_RULE_MESSAGES = 3;
/** Respuestas "secas": de 3 palabras o menos ("no sé", "nada", "ok"); con 3 seguidas, no más preguntas. */
const DRY_MAX_WORDS = 3;
const DRY_STREAK = 3;

const TALKS_ABOUT_MONEY = /membres|\b47\b|barat|econ[oó]mic|\bcaro\b|no tengo (dinero|plata|presupuesto)|sin (dinero|plata|presupuesto)|poco (dinero|presupuesto)|no me alcanza/i;
const ASKS_FOR_AGENDA = /agenda|enlace|link|reserv|hueco|d[oó]nde|calendario/i;
const INVENTED_SLOTS = /(hay|tiene|quedan)\s+(\p{L}+\s+)?huecos|huecos\s+(entre\s+semana|por\s+la|disponibles|libres|esta\s+semana)/iu;

function isDry(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= DRY_MAX_WORDS;
}

export function ruleIssues(messages: readonly string[], ctx: RuleContext): RuleIssue[] {
  const text = messages.join('\n');
  const lastUser = ctx.userTurns.at(-1) ?? '';
  const issues: RuleIssue[] = [];
  if (text.includes(ctx.links.membership) && ctx.lead.puede_invertir !== 'no' && !TALKS_ABOUT_MONEY.test(lastUser)) {
    issues.push({
      reason: 'Ofreces la membresía a quien no ha dicho que no puede invertir ni la ha pedido: no la ofrezcas, llévalo a la llamada',
      link: ctx.links.membership,
    });
  }
  const agendaSent = ctx.previous.some((p) => p.includes(ctx.links.agenda) || p.includes(`[Botón: ${AGENDA_BUTTON_TITLE}]`));
  if (text.includes(ctx.links.agenda) && agendaSent && !ASKS_FOR_AGENDA.test(lastUser)) {
    issues.push({ reason: 'Ya le pasaste la agenda antes: no la vuelvas a pasar', link: ctx.links.agenda });
  }
  const lastUserTurns = ctx.userTurns.slice(-DRY_STREAK);
  if (lastUserTurns.length === DRY_STREAK && lastUserTurns.every(isDry) && text.includes('?')) {
    issues.push({ reason: 'Lleva 3 respuestas secas seguidas: no preguntes más, despídete en un mensajito corto y amable dejándole la puerta abierta' });
  }
  if (INVENTED_SLOTS.test(text)) issues.push({ reason: 'Dices qué huecos tiene la agenda, pero no lo sabes: no lo digas' });
  if (messages.length > MAX_RULE_MESSAGES) issues.push({ reason: `Demasiados mensajitos (${messages.length}): usa 1 o 2, máximo ${MAX_RULE_MESSAGES}` });
  return issues;
}

/** Última barrera para los enlaces que no tocaban: quita esos mensajitos. Nunca deja la respuesta vacía. */
export function enforceLinkRules(messages: readonly string[], ctx: RuleContext): string[] {
  const banned = ruleIssues(messages, ctx).flatMap((i) => (i.link ? [i.link] : []));
  if (banned.length === 0) return [...messages];
  const kept = messages.filter((m) => !banned.some((link) => m.includes(link)));
  return kept.length > 0 ? kept : [...messages];
}
