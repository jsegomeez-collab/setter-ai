import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SetterOutputSchema, type SetterOutput } from './schema.js';

/**
 * Una llamada a Claude por turno: responde y rellena la ficha a la vez (decisión de Jose).
 * Se usa messages.create + validación propia (y no messages.parse) para mirar stop_reason ANTES de leer
 * el JSON: si Claude rechaza, el texto no cumple el esquema y parse lanzaría un error sin decir por qué.
 * Haiku 5.5 no tiene modelo de respaldo en el servidor: si rechaza o falla, la conversación se para para Jose.
 */

/** Cabe el pensamiento (cuenta dentro de max_tokens) + respuesta corta + ficha. */
const MAX_TOKENS = 4000;

export interface BrainUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

export type BrainResult =
  | { readonly kind: 'ok'; readonly output: SetterOutput; readonly usage: BrainUsage }
  | { readonly kind: 'refusal'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };

export interface SetterBrain {
  decide(system: string, messages: readonly Anthropic.MessageParam[]): Promise<BrainResult>;
}

type Effort = 'low' | 'medium' | 'high';

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `Error de la API de Anthropic (${error.status ?? 'sin estado'}): ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export function readOutput(response: Anthropic.Message): BrainResult {
  if (response.stop_reason === 'refusal') {
    const details = response.stop_details;
    return { kind: 'refusal', detail: `Claude rechazó responder${details?.category ? ` (${details.category})` : ''}` };
  }
  if (response.stop_reason === 'max_tokens') return { kind: 'failed', detail: 'La respuesta se cortó (max_tokens)' };
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'failed', detail: 'Claude no devolvió JSON válido' };
  }
  const parsed = SetterOutputSchema.safeParse(json);
  if (!parsed.success) return { kind: 'failed', detail: `El JSON no cumple el formato: ${parsed.error.message}` };
  const { usage } = response;
  return {
    kind: 'ok',
    output: parsed.data,
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0 },
  };
}

export class ClaudeBrain implements SetterBrain {
  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    /** config.setter.model (por defecto claude-haiku-5-5). */
    private readonly model: string,
    private readonly effort: Effort = 'low',
  ) {}

  async decide(system: string, messages: readonly Anthropic.MessageParam[]): Promise<BrainResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // El documento es igual en todas las conversaciones: se cachea.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [...messages],
        output_config: { effort: this.effort, format: zodOutputFormat(SetterOutputSchema) },
      });
      return readOutput(response);
    } catch (error) {
      return { kind: 'failed', detail: describeError(error) };
    }
  }
}
