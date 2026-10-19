import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AnalysisOutputSchema, type AnalysisOutput } from './schema.js';

/**
 * Análisis masivo (Fase 6.6) con Sonnet 5.5 (decisión de Jose: Sonnet para el análisis, nunca Opus). Una sola llamada
 * por análisis, con botón manual (Jose controla el gasto). Igual que el setter: messages.create + validación propia.
 */

export const ANALYSIS_MODEL = 'claude-sonnet-5-5';
/** Cabe el pensamiento + todos los hallazgos con sus citas. */
const MAX_TOKENS = 16_000;

export const ANALYSIS_SYSTEM = `Analizas conversaciones de Instagram de la cuenta @josenews.ai (Jose News AI: contenido sobre IA; vende formación para aprender a vender servicios de IA y servicios "hechos para ti" a dueños de negocio).
Cada conversación empieza con "### C<número> (@usuario)". "Persona" es quien escribe; "Setter" es la cuenta.

Objetivo: sacar inteligencia comercial y de contenido de lo que dicen las PERSONAS: objeciones, dolores, lenguaje literal, ideas de reels y datos del mercado.

Reglas (obligatorias):
1. Solo lo que está en las conversaciones. Nada inventado ni supuesto. Si una sección no tiene nada, déjala vacía.
2. Cada hallazgo lleva citas COPIADAS TAL CUAL de lo que escribió la Persona (nunca del Setter), con el código de su conversación. Se comprueban automáticamente: la que no aparezca literalmente se descarta.
3. Agrupa: un hallazgo por idea, con una cita por cada conversación donde aparece. Ordena de más a menos conversaciones.
4. No pongas nombres ni usuarios en títulos, detalles ni resumen.
5. Todo en español.`;

export interface AnalyzerUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type AnalyzerResult = { readonly kind: 'ok'; readonly output: AnalysisOutput; readonly usage: AnalyzerUsage } | { readonly kind: 'failed'; readonly detail: string };

export interface Analyzer {
  readonly model: string;
  analyze(conversationsText: string): Promise<AnalyzerResult>;
}

function readAnalysis(response: Anthropic.Message): AnalyzerResult {
  if (response.stop_reason === 'refusal') return { kind: 'failed', detail: 'Claude rechazó hacer el análisis' };
  if (response.stop_reason === 'max_tokens') return { kind: 'failed', detail: 'La respuesta se cortó (max_tokens): analiza un periodo más corto' };
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'failed', detail: 'Claude no devolvió JSON válido' };
  }
  const parsed = AnalysisOutputSchema.safeParse(json);
  if (!parsed.success) return { kind: 'failed', detail: `El JSON no cumple el formato: ${parsed.error.message}` };
  return { kind: 'ok', output: parsed.data, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
}

export class ClaudeAnalyzer implements Analyzer {
  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    readonly model: string = ANALYSIS_MODEL,
  ) {}

  async analyze(conversationsText: string): Promise<AnalyzerResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: ANALYSIS_SYSTEM,
        messages: [{ role: 'user', content: `Conversaciones:\n\n${conversationsText}` }],
        output_config: { effort: 'medium', format: zodOutputFormat(AnalysisOutputSchema) },
      });
      return readAnalysis(response);
    } catch (error) {
      const detail = error instanceof Anthropic.APIError ? `Error de la API de Anthropic (${error.status ?? 'sin estado'}): ${error.message}` : error instanceof Error ? error.message : String(error);
      return { kind: 'failed', detail };
    }
  }
}
