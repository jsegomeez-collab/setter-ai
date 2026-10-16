import type Anthropic from '@anthropic-ai/sdk';
import { addUsage, type BrainUsage, type SetterBrain } from './brain.js';
import { checkMessages, normalizeMessages, type AllowedContacts, type GuardResult } from './guards.js';
import type { SetterOutput } from './schema.js';

/**
 * Pide la respuesta a Claude y la pasa por el filtro. Si no pasa, le explica por qué (mensaje de sistema a mitad
 * de conversación) y le pide otra UNA vez; solo si vuelve a fallar se retiene. Lo usan el setter real y el simulador.
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

const PASS: GuardResult = { ok: true };

function check(output: SetterOutput, allowed: AllowedContacts): { messages: string[]; guard: GuardResult } {
  const messages = normalizeMessages(output.messages);
  // Sin mensajitos no se filtra: la IA decidió no responder.
  return { messages, guard: messages.length === 0 ? PASS : checkMessages(messages, allowed) };
}

export async function decideChecked(
  brain: SetterBrain,
  system: string,
  turns: readonly Anthropic.MessageParam[],
  allowed: AllowedContacts,
): Promise<CheckedReply> {
  const first = await brain.decide(system, turns);
  if (first.kind !== 'ok') return first;
  const firstCheck = check(first.output, allowed);
  if (firstCheck.guard.ok) return { kind: 'ok', output: first.output, usage: first.usage, ...firstCheck, retried: false };
  const reasons = firstCheck.guard.reasons.join('; ');
  const retryTurns: Anthropic.MessageParam[] = [
    ...turns,
    { role: 'system', content: `Tu respuesta anterior no se envió porque: ${reasons}. Escribe otra respuesta para la persona que cumpla todas las reglas.` },
  ];
  const second = await brain.decide(system, retryTurns);
  // Si el segundo intento ni siquiera llega, se queda el primero (que se retendrá).
  if (second.kind !== 'ok') return { kind: 'ok', output: first.output, usage: first.usage, ...firstCheck, retried: true };
  return { kind: 'ok', output: second.output, usage: addUsage(first.usage, second.usage), ...check(second.output, allowed), retried: true };
}
