import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, fillLinks, toClaudeTurns } from '../src/setter/prompt.js';
import type { MessageRow, NewMessage } from '../src/store.js';
import { STRANGER_ID, TEST_SETTER_LINKS } from './helpers.js';

function row(id: number, message: Partial<NewMessage> & Pick<NewMessage, 'direction' | 'text'>): MessageRow {
  return { igId: STRANGER_ID, source: message.direction === 'in' ? 'user' : 'flow', mid: `m${id}`, status: 'sent', dedupKey: null, ...message, id, createdAt: new Date(id * 1000) };
}

describe('prompt del setter', () => {
  it('sustituye los enlaces del documento por los reales', () => {
    const text = fillLinks('Agenda: [LINK AGENDA]. Membresía: [LINK MEMBRESÍA]. Otra vez [LINK AGENDA].', TEST_SETTER_LINKS);
    expect(text).toBe(`Agenda: ${TEST_SETTER_LINKS.agenda}. Membresía: ${TEST_SETTER_LINKS.membership}. Otra vez ${TEST_SETTER_LINKS.agenda}.`);
  });

  it('el prompt lleva el documento, las reglas de huecos y los únicos enlaces y correo permitidos', () => {
    const prompt = buildSystemPrompt('ROL: setter de Jose. Garantía [CONFIRMAR CONDICIONES EXACTAS]', TEST_SETTER_LINKS);
    expect(prompt.startsWith('ROL: setter de Jose.')).toBe(true);
    expect(prompt).toContain('[CONFIRMAR …] o [COMPLETAR] NO están confirmadas');
    expect(prompt).toContain(TEST_SETTER_LINKS.agenda);
    expect(prompt).toContain(TEST_SETTER_LINKS.membership);
    expect(prompt).toContain(TEST_SETTER_LINKS.contactEmail);
  });

  it('el historial empieza por la persona; lo que la cuenta mandó antes va aparte al prompt', () => {
    const turns = toClaudeTurns([
      row(1, { direction: 'out', text: 'Hola, pulsa el botón' }),
      row(2, { direction: 'in', text: 'hola' }),
      row(3, { direction: 'in', text: 'quiero info' }),
      row(4, { direction: 'out', text: '¿Ya usas alguna IA?', source: 'ai' }),
      row(5, { direction: 'in', text: 'sí, ChatGPT' }),
    ]);
    expect(turns.earlyAccountMessages).toEqual(['Hola, pulsa el botón']);
    expect(turns.messages).toEqual([
      { role: 'user', content: 'hola\nquiero info' },
      { role: 'assistant', content: '¿Ya usas alguna IA?' },
      { role: 'user', content: 'sí, ChatGPT' },
    ]);
    expect(buildSystemPrompt('DOC', TEST_SETTER_LINKS, turns.earlyAccountMessages)).toContain('· Hola, pulsa el botón');
  });

  it('los mensajes retenidos o fallidos no cuentan como dichos', () => {
    const turns = toClaudeTurns([
      row(1, { direction: 'in', text: 'hola' }),
      row(2, { direction: 'out', text: 'retenido', source: 'ai', status: 'held' }),
      row(3, { direction: 'out', text: 'fallido', source: 'ai', status: 'failed' }),
      row(4, { direction: 'in', text: '¿sigues ahí?' }),
    ]);
    expect(turns.messages).toEqual([{ role: 'user', content: 'hola\n¿sigues ahí?' }]);
  });
});
