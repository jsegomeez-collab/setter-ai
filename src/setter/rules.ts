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
  readonly lead: Pick<Lead, 'puede_invertir' | 'tipo_lead'>;
}

export interface RuleIssue {
  readonly reason: string;
  /** Mensajitos que no tocaban (enlace o mención): si la IA insiste, se quitan. */
  readonly drop?: (message: string) => boolean;
}

const MAX_RULE_MESSAGES = 3;
/** Respuestas "secas": de 3 palabras o menos ("no sé", "nada", "ok"); con 3 seguidas, no más preguntas. */
const DRY_MAX_WORDS = 3;
const DRY_STREAK = 3;

/** La persona habla de precio o de dinero: entonces sí se puede hablar de la membresía (marco técnico: "desde $47 al mes…"). */
const TALKS_ABOUT_MONEY =
  /membres|\b47\b|barat|econ[oó]mic|\bcaro\b|precio|cu[aá]nto (cuesta|sale|vale|cobr)|no tengo (dinero|plata|presupuesto)|sin (dinero|plata|presupuesto)|poco (dinero|presupuesto)|no me alcanza/i;
const MENTIONS_MEMBERSHIP = /membres|\$\s?47\b|\b47\s?(\$|d[oó]lares|usd|al mes)/i;
/** Pide la agenda de verdad ("pásame el enlace", "¿dónde reservo?"); nombrarla ("la agenda la miro", "reservo") no cuenta. */
const ASKS_FOR_AGENDA =
  /(p[aá]s|mand|env[ií]|reenv|dame|d[eé]jame|comparte).{0,25}(enlace|link|agenda|calendario)|d[oó]nde (reservo|agendo|me apunto|est[aá] (el|la))|(no (me )?(abre|funciona|carga|encuentro)).{0,25}(enlace|link|agenda)|(enlace|link) (otra vez|de nuevo)/i;
const INVENTED_SLOTS = /(hay|tiene|quedan)\s+(\p{L}+\s+)?huecos|huecos\s+(entre\s+semana|por\s+la|disponibles|libres|esta\s+semana)/iu;

/** Palabras de pregunta con tilde (sin tilde, "que"/"como" son otra cosa). "qué bien/bueno…" es exclamación, no pregunta. */
const QUESTION_WORDS = /(?<![\p{L}])(qué|dónde|cuánt[oa]s?|cómo|cuál(es)?|quién(es)?|cuándo)(?![\p{L}])/giu;
const EXCLAMATION = /qué\s+(bien|buen[oa]?|interesante|genial|lind[oa]|suerte|pena|ric[oa]|chévere|padre|gusto)/giu;

/** Dos "?" en la respuesta, o dos palabras de pregunta en la misma pregunta ("¿a qué te dedicas, desde dónde trabajas?"). */
function asksTwoThings(messages: readonly string[]): boolean {
  const text = messages.join('\n');
  const parts = text.split('?');
  if (parts.length > 2) return true;
  if (parts.length < 2) return false;
  const before = parts[0] ?? '';
  const start = Math.max(before.lastIndexOf('¿'), before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('\n')) + 1;
  const question = before.slice(start).replace(EXCLAMATION, '');
  return (question.match(QUESTION_WORDS) ?? []).length > 1;
}

function isDry(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= DRY_MAX_WORDS;
}

export function ruleIssues(messages: readonly string[], ctx: RuleContext): RuleIssue[] {
  const text = messages.join('\n');
  const lastUser = ctx.userTurns.at(-1) ?? '';
  const issues: RuleIssue[] = [];
  const isMembership = (m: string): boolean => m.includes(ctx.links.membership) || MENTIONS_MEMBERSHIP.test(m);
  if (messages.some(isMembership)) {
    if (ctx.lead.tipo_lead === 'empresa_dfy') {
      issues.push({ reason: 'Es un negocio que quiere la IA en SU negocio: la membresía es de la formación, no se la menciones', drop: isMembership });
    } else if (ctx.lead.puede_invertir !== 'no' && !TALKS_ABOUT_MONEY.test(lastUser)) {
      issues.push({
        reason: 'Hablas de la membresía a quien no ha dicho que no puede invertir ni ha preguntado el precio: no la menciones, llévalo a la llamada',
        drop: isMembership,
      });
    }
  }
  const agendaSent = ctx.previous.some((p) => p.includes(ctx.links.agenda) || p.includes(`[Botón: ${AGENDA_BUTTON_TITLE}]`));
  if (text.includes(ctx.links.agenda) && agendaSent && !ASKS_FOR_AGENDA.test(lastUser)) {
    issues.push({ reason: 'Ya le pasaste la agenda antes: no la vuelvas a pasar', drop: (m) => m.includes(ctx.links.agenda) });
  }
  const lastUserTurns = ctx.userTurns.slice(-DRY_STREAK);
  if (lastUserTurns.length === DRY_STREAK && lastUserTurns.every(isDry) && text.includes('?')) {
    issues.push({ reason: 'Lleva 3 respuestas secas seguidas: no preguntes más, despídete en un mensajito corto y amable dejándole la puerta abierta' });
  }
  if (INVENTED_SLOTS.test(text)) issues.push({ reason: 'Dices qué huecos tiene la agenda, pero no lo sabes: no lo digas' });
  if (asksTwoThings(messages)) {
    issues.push({ reason: 'Preguntas dos cosas a la vez: haz UNA sola pregunta, sobre un solo tema, que salga de lo último que te contó' });
  }
  if (messages.length > MAX_RULE_MESSAGES) issues.push({ reason: `Demasiados mensajitos (${messages.length}): usa 1 o 2, máximo ${MAX_RULE_MESSAGES}` });
  return issues;
}

/** Última barrera para la agenda repetida y la membresía que no toca: quita esos mensajitos. Nunca deja la respuesta vacía. */
export function enforceLinkRules(messages: readonly string[], ctx: RuleContext): string[] {
  const drops = ruleIssues(messages, ctx).flatMap((i) => (i.drop ? [i.drop] : []));
  if (drops.length === 0) return [...messages];
  const kept = messages.filter((m) => !drops.some((drop) => drop(m)));
  return kept.length > 0 ? kept : [...messages];
}
