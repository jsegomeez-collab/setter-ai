import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeBrain, readOutput } from '../src/setter/brain.js';
import { sampleOutput } from './helpers.js';

function message(text: string, stopReason: Anthropic.Message['stop_reason'] = 'end_turn', extra: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 1000, cache_creation_input_tokens: 2500 },
    ...extra,
  } as unknown as Anthropic.Message;
}

describe('readOutput', () => {
  it('lee la respuesta y la ficha aunque el primer bloque sea de pensamiento', () => {
    const result = readOutput(message(JSON.stringify(sampleOutput())));
    expect(result).toEqual({ kind: 'ok', output: sampleOutput(), usage: { inputTokens: 1200, outputTokens: 150, cacheReadTokens: 1000, cacheCreationTokens: 2500 } });
  });

  it('mira el rechazo ANTES de leer el JSON', () => {
    const result = readOutput(message('No puedo ayudar con eso.', 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }));
    expect(result).toEqual({ kind: 'refusal', detail: 'Claude rechazó responder (cyber)' });
  });

  it('una respuesta cortada, sin JSON o con otro formato es un fallo', () => {
    expect(readOutput(message('{"reply":', 'max_tokens')).kind).toBe('failed');
    expect(readOutput(message('hola')).kind).toBe('failed');
    expect(readOutput(message(JSON.stringify({ messages: ['hola'] }))).kind).toBe('failed');
  });
});

describe('ClaudeBrain', () => {
  it('llama al modelo configurado con esfuerzo bajo, formato JSON y el documento cacheado', async () => {
    const create = vi.fn().mockResolvedValue(message(JSON.stringify(sampleOutput())));
    const brain = new ClaudeBrain({ messages: { create } } as unknown as Anthropic, 'claude-haiku-5-5');
    const result = await brain.decide('DOCUMENTO', [{ role: 'user', content: 'hola' }]);
    expect(result.kind).toBe('ok');
    const params = create.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      system: [{ type: 'text', text: 'DOCUMENTO', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'hola' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(params).not.toHaveProperty('temperature');
  });

  it('si la API falla, devuelve un fallo en vez de lanzar', async () => {
    const create = vi.fn().mockRejectedValue(new Error('sin conexión'));
    const brain = new ClaudeBrain({ messages: { create } } as unknown as Anthropic, 'claude-haiku-5-5');
    expect(await brain.decide('DOC', [{ role: 'user', content: 'hola' }])).toEqual({ kind: 'failed', detail: 'sin conexión' });
  });
});
