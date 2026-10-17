import type Anthropic from '@anthropic-ai/sdk';
import { addUsage, type BrainUsage, type SetterBrain } from './brain.js';
import { checkMessages, limitEmojis, normalizeMessages, stripLeadingVale, styleIssues, type AllowedContacts, type GuardResult } from './guards.js';
import { enforceLinkRules, ruleIssues, type RuleContext, type RuleLinks } from './rules.js';
import type { SetterOutput } from './schema.js';

/**
 * Pide la respuesta a Claude y la pasa por el filtro. Si no pasa, le explica por qué (mensaje de sistema a mitad
 * de conversación) y le pide otra UNA vez; solo si vuelve a fallar se retiene. Con una muletilla ("vale", "no pasa
 * nada") o saltándose una regla de conversación (rules.ts) también pide otra, pero nunca retiene por eso.
 * Lo usan el setter real y el simulador.
 */

export type CheckedReply =
  | {
      readonly kind: 'ok';
      readonly output: SetterOutput;
      readonly usage: BrainUsage;
      readonly messages: string[];
      readonly guard: GuardResult;
      readonly retried: boolean;
    }
  | { readonly kind: 'refusal' | 'failed'; readonly detail: string };

type Checked = { messages: string[]; guard: GuardResult };

const PASS: GuardResult = { ok: true };

function check(output: SetterOutput, allowed: AllowedContacts, previous: readonly string[]): Checked {
  const messages = stripLeadingVale(limitEmojis(normalizeMessages(output.messages), previous));
  // Sin mensajitos no se filtra: la IA decidió no responder.
  return { messages, guard: messages.length === 0 ? PASS : checkMessages(messages, allowed) };
}

/** `links`: con ellos se aplican las reglas de conversación (membresía, agenda una vez, seco…). */
export async function decideChecked(
  brain: SetterBrain,
  system: string,
  turns: readonly Anthropic.MessageParam[],
  allowed: AllowedContacts,
  links?: RuleLinks,
): Promise<CheckedReply> {
  const first = await brain.decide(system, turns);
  if (first.kind !== 'ok') return first;
  const previous = turns.filter((t) => t.role === 'assistant').map((t) => String(t.content));
  const userTurns = turns.filter((t) => t.role === 'user').map((t) => String(t.content));
  const contextOf = (output: SetterOutput): RuleContext | null => (links ? { previous, userTurns, links, lead: output.lead } : null);
  const issuesOf = (output: SetterOutput, messages: readonly string[]): string[] => {
    const ctx = contextOf(output);
    return [...styleIssues(messages, previous), ...(ctx ? ruleIssues(messages, ctx).map((i) => i.reason) : [])];
  };
  const finish = (output: SetterOutput, usage: BrainUsage, checked: Checked, retried: boolean): CheckedReply => {
    const ctx = contextOf(output);
    const messages = ctx && checked.guard.ok ? enforceLinkRules(checked.messages, ctx) : checked.messages;
    return { kind: 'ok', output, usage, guard: checked.guard, messages, retried };
  };

  const firstCheck = check(first.output, allowed, previous);
  const firstIssues = issuesOf(first.output, firstCheck.messages);
  if (firstCheck.guard.ok && firstIssues.length === 0) return finish(first.output, first.usage, firstCheck, false);
  const reasons = [...(firstCheck.guard.ok ? [] : firstCheck.guard.reasons), ...firstIssues].join('; ');
  const retryTurns: Anthropic.MessageParam[] = [
    ...turns,
    { role: 'system', content: `Tu respuesta anterior no se envió porque: ${reasons}. Escribe otra respuesta para la persona que cumpla todas las reglas.` },
  ];
  const second = await brain.decide(system, retryTurns);
  // Si el segundo intento ni siquiera llega, se queda el primero (se retiene solo si no pasaba el filtro).
  if (second.kind !== 'ok') return finish(first.output, first.usage, firstCheck, true);
  const usage = addUsage(first.usage, second.usage);
  const secondCheck = check(second.output, allowed, previous);
  // Si el primero solo tenía fallos de estilo o de reglas y el segundo no pasa el filtro o tiene más, mejor el primero.
  const secondIsWorse = !secondCheck.guard.ok || issuesOf(second.output, secondCheck.messages).length > firstIssues.length;
  if (firstCheck.guard.ok && secondIsWorse) return finish(first.output, usage, firstCheck, true);
  return finish(second.output, usage, secondCheck, true);
}
