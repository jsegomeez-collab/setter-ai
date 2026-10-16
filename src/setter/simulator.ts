import type Anthropic from '@anthropic-ai/sdk';
import type { BrainUsage, SetterBrain } from './brain.js';
import { checkMessages } from './guards.js';
import { buildSystemPrompt, type SetterLinks } from './prompt.js';
import type { Scenario } from './scenarios.js';
import type { Lead } from './schema.js';

/**
 * Simulador del setter: otra IA hace de lead con un perfil y el setter responde con el documento real
 * y las mismas reglas que en producción (guardas, parar si pide a Jose o si es menor).
 * No envía nada a Instagram ni guarda conversaciones.
 */

export const MAX_SIM_TURNS = 6;
const END_TOKEN = 'FIN';
const LEAD_START = '(Empiezas tú: escribe tu primer DM a la cuenta.)';

export interface SimTurn {
  readonly who: 'lead' | 'setter';
  readonly texts: readonly string[];
  readonly note?: string;
}

export interface SimulationResult {
  readonly turns: readonly SimTurn[];
  readonly lead: Lead | null;
  readonly endReason: string;
  /** La IA se habría parado en producción (pasar a Jose, menor, retenido o fallo). */
  readonly stopped: boolean;
  readonly usage: BrainUsage;
}

/** Quien hace de lead: devuelve su siguiente mensaje, o null si la conversación terminó para él. */
export interface LeadPlayer {
  next(persona: string, turns: readonly SimTurn[]): Promise<string | null>;
}

export interface SimulatorDeps {
  readonly brain: SetterBrain;
  readonly lead: LeadPlayer;
  readonly knowledge: string;
  readonly links: SetterLinks;
  readonly maxTurns?: number;
}

const ZERO_USAGE: BrainUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
const addUsage = (a: BrainUsage, b: BrainUsage): BrainUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
});

/** Turnos del simulador → mensajes para el setter (lead = user, setter = assistant). */
function setterView(turns: readonly SimTurn[]): Anthropic.MessageParam[] {
  return turns
    .filter((t) => t.texts.length > 0)
    .map((t) => ({ role: t.who === 'lead' ? ('user' as const) : ('assistant' as const), content: t.texts.join('\n') }));
}

/** Si la conversación acaba tras este turno: por qué y si la IA se habría parado en producción (null = sigue). */
function endOfTurn(
  messages: readonly string[],
  guardReasons: readonly string[] | null,
  output: { needs_human: boolean; needs_human_reason: string | null; lead: Lead },
): { reason: string; stopped: boolean } | null {
  if (guardReasons) return { reason: `Respuesta retenida (${guardReasons.join(' · ')}) → la IA se para`, stopped: true };
  if (output.needs_human) return { reason: `Pide que intervenga Jose: ${output.needs_human_reason ?? 'sin motivo'} → la IA se para`, stopped: true };
  if (output.lead.es_menor === 'si') return { reason: 'Posible menor de edad → la IA se para', stopped: true };
  if (messages.length === 0) return { reason: 'La IA decidió no responder', stopped: false };
  return null;
}

export async function runSimulation(deps: SimulatorDeps, scenario: Pick<Scenario, 'persona' | 'firstMessage'>): Promise<SimulationResult> {
  const turns: SimTurn[] = [];
  let usage = ZERO_USAGE;
  let lead: Lead | null = null;
  const system = buildSystemPrompt(deps.knowledge, deps.links);
  let incoming = scenario.firstMessage ?? (await deps.lead.next(scenario.persona, turns));
  for (let turn = 0; turn < (deps.maxTurns ?? MAX_SIM_TURNS); turn += 1) {
    if (incoming === null) return { turns, lead, endReason: 'El lead dio la conversación por terminada', stopped: false, usage };
    turns.push({ who: 'lead', texts: [incoming] });
    const result = await deps.brain.decide(system, setterView(turns));
    if (result.kind !== 'ok') {
      turns.push({ who: 'setter', texts: [], note: result.detail });
      return { turns, lead, endReason: `${result.kind === 'refusal' ? 'Claude rechazó' : 'Fallo de Claude'} → la IA se para`, stopped: true, usage };
    }
    usage = addUsage(usage, result.usage);
    lead = result.output.lead;
    const messages = result.output.messages.map((m) => m.trim()).filter((m) => m.length > 0);
    // Igual que service.ts: sin mensajitos no se pasa el filtro (la IA decidió no responder).
    const guard = messages.length === 0 ? ({ ok: true } as const) : checkMessages(messages, { urls: [deps.links.agenda, deps.links.membership], emails: [deps.links.contactEmail] });
    turns.push({ who: 'setter', texts: messages, note: guard.ok ? undefined : `RETENIDO: ${guard.reasons.join(' · ')}` });
    const end = endOfTurn(messages, guard.ok ? null : guard.reasons, result.output);
    if (end) return { turns, lead, endReason: end.reason, stopped: end.stopped, usage };
    incoming = await deps.lead.next(scenario.persona, turns);
  }
  return { turns, lead, endReason: `Límite de ${deps.maxTurns ?? MAX_SIM_TURNS} turnos`, stopped: false, usage };
}

/**
 * Coste estimado del setter con los precios de Claude Haiku 5.5 (guía oficial claude-api, tabla del 2026-10-06):
 * entrada 0,10 $/M · escritura en caché ×1,25 · lectura de caché ×0,1 · salida 0,50 $/M. No incluye la IA que hace de lead.
 */
export function estimateCostUsd(usage: BrainUsage): number {
  const PER_TOKEN_IN = 0.1 / 1_000_000;
  const PER_TOKEN_OUT = 0.5 / 1_000_000;
  return usage.inputTokens * PER_TOKEN_IN + usage.cacheCreationTokens * PER_TOKEN_IN * 1.25 + usage.cacheReadTokens * PER_TOKEN_IN * 0.1 + usage.outputTokens * PER_TOKEN_OUT;
}

/** ¿Pasó lo esperado? null = no hay nada automático que comprobar. */
export function verdict(scenario: Pick<Scenario, 'expectStep' | 'expectStop'>, result: SimulationResult): { ok: boolean; detail: string } | null {
  const checks: { ok: boolean; detail: string }[] = [];
  if (scenario.expectStep) {
    const step = result.lead?.siguiente_paso ?? 'sin ficha';
    checks.push({ ok: (scenario.expectStep as readonly string[]).includes(step), detail: `siguiente paso "${step}" (esperado: ${scenario.expectStep.join(' o ')})` });
  }
  if (scenario.expectStop !== undefined) {
    checks.push({ ok: result.stopped === scenario.expectStop, detail: `IA ${result.stopped ? 'parada' : 'sigue'} (esperado: ${scenario.expectStop ? 'parada' : 'sigue'})` });
  }
  if (checks.length === 0) return null;
  return { ok: checks.every((c) => c.ok), detail: checks.map((c) => `${c.ok ? '✔' : '✘'} ${c.detail}`).join(' · ') };
}

/** La IA que hace de lead (Haiku, barato). Desde su lado: el setter es "user" y ella es "assistant". */
export class ClaudeLeadPlayer implements LeadPlayer {
  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    private readonly model: string,
  ) {}

  async next(persona: string, turns: readonly SimTurn[]): Promise<string | null> {
    const history: Anthropic.MessageParam[] = [
      { role: 'user', content: LEAD_START },
      ...turns.filter((t) => t.texts.length > 0).map((t) => ({ role: t.who === 'lead' ? ('assistant' as const) : ('user' as const), content: t.texts.join('\n') })),
    ];
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: `Estás haciendo de lead en una simulación para probar un setter de ventas por Instagram. Eres esta persona: ${persona}
Escribes por DM a la cuenta de Jose News AI después de ver un reel. Escribe como una persona real por chat: corto, informal, a veces sin tildes.
Responde SOLO con tu siguiente mensaje (uno), sin comillas ni explicaciones. Si la conversación ya terminó para ti (te despediste, ya tienes lo que querías o no quieres seguir), responde exactamente ${END_TOKEN}.`,
      messages: history,
      output_config: { effort: 'low' },
    });
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text.length === 0 || text === END_TOKEN ? null : text;
  }
}
