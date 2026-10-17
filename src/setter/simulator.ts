import type Anthropic from '@anthropic-ai/sdk';
import { ZERO_USAGE, addUsage, type BrainUsage, type SetterBrain } from './brain.js';
import { decideChecked } from './reply.js';
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
  /** Lo que gastó la IA que hace de lead (para dar el coste real completo). null si no se sabe. */
  readonly leadUsage?: BrainUsage | null;
  /** Modelo del setter en esta simulación (para el coste). Sin él se calcula como Haiku. */
  readonly setterModel?: string;
}

/** Quien hace de lead: devuelve su siguiente mensaje, o null si la conversación terminó para él. */
export interface LeadPlayer {
  next(persona: string, turns: readonly SimTurn[]): Promise<string | null>;
  /** Lo que ha gastado desde la última vez que se leyó (y se pone a cero). */
  takeUsage?(): BrainUsage;
}

export interface SimulatorDeps {
  readonly brain: SetterBrain;
  readonly lead: LeadPlayer;
  readonly knowledge: string;
  readonly links: SetterLinks;
  readonly maxTurns?: number;
}


/**
 * Turnos del simulador → mensajes para el setter (lead = user, setter = assistant). Lo que la cuenta escribió antes
 * del primer mensaje del lead (el texto de inicio) no va aquí: va en el system, igual que en producción (toClaudeTurns).
 */
function setterView(turns: readonly SimTurn[]): Anthropic.MessageParam[] {
  const firstLead = turns.findIndex((t) => t.who === 'lead');
  return turns
    .slice(Math.max(0, firstLead))
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

export async function runSimulation(deps: SimulatorDeps, scenario: Pick<Scenario, 'persona' | 'firstMessage' | 'opener'>): Promise<SimulationResult> {
  const result = await simulate(deps, scenario);
  return { ...result, leadUsage: deps.lead.takeUsage?.() ?? null };
}

async function simulate(deps: SimulatorDeps, scenario: Pick<Scenario, 'persona' | 'firstMessage' | 'opener'>): Promise<SimulationResult> {
  const turns: SimTurn[] = [];
  let usage = ZERO_USAGE;
  let lead: Lead | null = null;
  // Texto de inicio (Fase 5.4): la cuenta escribe primero; el setter lo recibe como en producción.
  const { opener } = scenario;
  const system = buildSystemPrompt(deps.knowledge, deps.links, opener ? [opener] : []);
  if (opener) turns.push({ who: 'setter', texts: [opener], note: 'Texto de inicio (fijo, sin IA)' });
  let incoming = opener ? await deps.lead.next(scenario.persona, turns) : (scenario.firstMessage ?? (await deps.lead.next(scenario.persona, turns)));
  for (let turn = 0; turn < (deps.maxTurns ?? MAX_SIM_TURNS); turn += 1) {
    if (incoming === null) return { turns, lead, endReason: 'El lead dio la conversación por terminada', stopped: false, usage };
    turns.push({ who: 'lead', texts: [incoming] });
    const result = await decideChecked(deps.brain, system, setterView(turns), { urls: [deps.links.agenda, deps.links.membership], emails: [deps.links.contactEmail] });
    if (result.kind !== 'ok') {
      turns.push({ who: 'setter', texts: [], note: result.detail });
      return { turns, lead, endReason: `${result.kind === 'refusal' ? 'Claude rechazó' : 'Fallo de Claude'} → la IA se para`, stopped: true, usage };
    }
    usage = addUsage(usage, result.usage);
    lead = result.output.lead;
    const { messages, guard } = result;
    const notes = [result.retried ? 'Segundo intento (el primero no pasó el filtro)' : '', guard.ok ? '' : `RETENIDO: ${guard.reasons.join(' · ')}`].filter(Boolean);
    turns.push({ who: 'setter', texts: messages, note: notes.length ? notes.join(' · ') : undefined });
    const end = endOfTurn(messages, guard.ok ? null : guard.reasons, result.output);
    if (end) return { turns, lead, endReason: end.reason, stopped: end.stopped, usage };
    incoming = await deps.lead.next(scenario.persona, turns);
  }
  return { turns, lead, endReason: `Límite de ${deps.maxTurns ?? MAX_SIM_TURNS} turnos`, stopped: false, usage };
}

/** La IA que hace de lead es siempre Haiku: barata, y así comparar modelos del setter es justo. */
export const LEAD_MODEL = 'claude-haiku-5-5';

/**
 * Precios en $ por millón de tokens; escritura en caché = entrada ×1,25.
 * Haiku 5.5: guía oficial claude-api (tabla del 2026-10-06). Sonnet 5.5: platform.claude.com/docs/en/about-claude/pricing
 * (2026-10-17); la lectura de caché sale a 0,10 o 0,20 según la página: se usa 0,20 para no quedarse corto.
 */
const PRICES = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
} as const;

/** Coste estimado de un consumo con el modelo dado (por defecto, el del lead). */
export function estimateCostUsd(usage: BrainUsage, model: string = LEAD_MODEL): number {
  const price = model.includes('sonnet') ? PRICES.sonnet : PRICES.haiku;
  const perMillion = (tokens: number, dollars: number): number => (tokens * dollars) / 1_000_000;
  return (
    perMillion(usage.inputTokens, price.input) +
    perMillion(usage.cacheCreationTokens, price.input * 1.25) +
    perMillion(usage.cacheReadTokens, price.cacheRead) +
    perMillion(usage.outputTokens, price.output)
  );
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
  private spent: BrainUsage = ZERO_USAGE;

  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    private readonly model: string,
  ) {}

  takeUsage(): BrainUsage {
    const spent = this.spent;
    this.spent = ZERO_USAGE;
    return spent;
  }

  async next(persona: string, turns: readonly SimTurn[]): Promise<string | null> {
    const said = turns.filter((t) => t.texts.length > 0).map((t) => ({ role: t.who === 'lead' ? ('assistant' as const) : ('user' as const), content: t.texts.join('\n') }));
    // Si la cuenta escribió primero (texto de inicio), la conversación del lead empieza por ese mensaje.
    const history: Anthropic.MessageParam[] = said[0]?.role === 'user' ? said : [{ role: 'user', content: LEAD_START }, ...said];
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: `Estás haciendo de lead en una simulación para probar un setter de ventas por Instagram. Eres esta persona: ${persona}
Escribes por DM a la cuenta de Jose News AI después de ver un reel. Escribe como una persona real por chat: corto, informal, a veces sin tildes.
Responde SOLO con tu siguiente mensaje (uno), sin comillas ni explicaciones. Si la conversación ya terminó para ti (te despediste, ya tienes lo que querías o no quieres seguir), responde exactamente ${END_TOKEN}.`,
      messages: history,
      output_config: { effort: 'low' },
    });
    const u = response.usage;
    this.spent = addUsage(this.spent, {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cacheReadTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
    });
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text.length === 0 || text === END_TOKEN ? null : text;
  }
}
