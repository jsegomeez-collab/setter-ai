import { describe, expect, it } from 'vitest';
import { MAX_REPLY_CHARS, checkReply } from '../src/setter/guards.js';
import { TEST_SETTER_LINKS } from './helpers.js';

const allowed = { urls: [TEST_SETTER_LINKS.agenda, TEST_SETTER_LINKS.membership], emails: [TEST_SETTER_LINKS.contactEmail] };

describe('checkReply', () => {
  it('deja pasar un mensaje normal, con cifras y abreviaturas como EE.UU. o p.ej.', () => {
    expect(checkReply('Genial. ¿Ya usas alguna IA como ChatGPT o Claude? Por ej. un dashboard se vende por unos $3.000 en EE.UU.', allowed)).toEqual({ ok: true });
  });

  it('deja pasar los dos enlaces permitidos y el correo permitido', () => {
    const text = `Agenda aquí: ${TEST_SETTER_LINKS.agenda} o la membresía: ${TEST_SETTER_LINKS.membership}. Dudas: ${TEST_SETTER_LINKS.contactEmail}`;
    expect(checkReply(text, allowed)).toEqual({ ok: true });
  });

  it.each([
    ['https://otra-web.com/pago', 'Enlace no permitido'],
    ['mira www.ejemplo.net', 'Enlace no permitido'],
    ['entra en grupal-vip.com ya', 'Enlace no permitido'],
    ['https://agenda.example.com/otra-ruta', 'Enlace no permitido'],
  ])('bloquea un enlace que no es de los permitidos: %s', (text, reason) => {
    const result = checkReply(text, allowed);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.join(' ')).toContain(reason);
  });

  it('bloquea un correo que no es el permitido', () => {
    const result = checkReply('Escríbeme a jose@gmail.com', allowed);
    expect(!result.ok && result.reasons.join(' ')).toContain('Correo no permitido: jose@gmail.com');
  });

  it('bloquea los huecos sin rellenar del documento', () => {
    expect(checkReply('La garantía es [CONFIRMAR CONDICIONES EXACTAS]', allowed).ok).toBe(false);
    expect(checkReply('Agenda en [LINK AGENDA]', allowed).ok).toBe(false);
    expect(checkReply('Facilidades: [COMPLETAR]', allowed).ok).toBe(false);
  });

  it('bloquea respuestas vacías o demasiado largas', () => {
    expect(checkReply('   ', allowed).ok).toBe(false);
    expect(checkReply('a'.repeat(MAX_REPLY_CHARS), allowed).ok).toBe(true);
    expect(checkReply('a'.repeat(MAX_REPLY_CHARS + 1), allowed).ok).toBe(false);
  });
});
