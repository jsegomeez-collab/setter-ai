import { describe, expect, it, vi } from 'vitest';
import type { OutMessage } from '../src/flows/engine.js';
import { buttonUrl, createLinkToken, deriveLinkSecret, newShortCode, readLinkToken, trackAgendaLinks } from '../src/links.js';

const SECRET = deriveLinkSecret('clave-de-cifrado-larga-123');
const message: OutMessage = {
  text: 'Biblioteca',
  buttons: [
    { type: 'postback', title: 'Otra cosa', next: 'x' },
    { type: 'url', title: 'IR A LA BIBLIOTECA', url: 'https://biblioteca.example.com/?a=1', tags: ['biblioteca'] },
  ],
  flowId: 'flow1',
  nodeId: 'biblio',
  recipientId: '1716456302996044',
};

const AGENDA = 'https://codigomaestria.com/agenda?utm_source=instagram';

describe('enlaces cortos (la agenda va en mensajes de texto: el firmado mide >200 caracteres)', () => {
  it('código de 7 letras y números, distinto cada vez', () => {
    const code = newShortCode();
    expect(code).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(newShortCode()).not.toBe(code);
  });

  it('cambia el enlace de agenda por uno corto nuestro, con utm_content=<código>, y lo guarda', async () => {
    const saved = new Map<string, unknown>();
    const store = { saveShortLink: vi.fn(async (code: string, data: unknown) => (saved.set(code, data), true)) };
    const out = await trackAgendaLinks(`Reserva aquí: ${AGENDA} 🙌`, '9', { store, baseUrl: 'https://setter.example.com/', agendaUrl: AGENDA });
    const code = out.match(/^Reserva aquí: https:\/\/setter\.example\.com\/l\/([A-Za-z0-9]{7}) 🙌$/)?.[1];
    expect(code).toBeDefined();
    expect(saved.get(code as string)).toEqual({ f: 'setter', n: 'agenda', b: 0, r: '9', u: `${AGENDA}&utm_content=${code}`, t: ['agenda'] });
  });

  it('sin enlace de agenda no cambia nada ni guarda', async () => {
    const store = { saveShortLink: vi.fn() };
    expect(await trackAgendaLinks('hola, ¿a qué te dedicas?', '9', { store, baseUrl: 'https://s.com', agendaUrl: AGENDA })).toBe('hola, ¿a qué te dedicas?');
    expect(store.saveShortLink).not.toHaveBeenCalled();
  });

  it('si el código ya existía (casualidad), prueba con otro', async () => {
    const store = { saveShortLink: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
    await trackAgendaLinks(AGENDA, '9', { store, baseUrl: 'https://s.com', agendaUrl: AGENDA });
    expect(store.saveShortLink).toHaveBeenCalledTimes(2);
  });
});

describe('enlaces con seguimiento', () => {
  it('la clave derivada no es la de cifrado', () => {
    expect(SECRET).not.toContain('clave-de-cifrado');
    expect(SECRET).toHaveLength(64);
  });

  it('crea la URL de seguimiento y al leerla devuelve destino, etiquetas y persona', () => {
    const url = buttonUrl({ baseUrl: 'https://setter.example.com/', secret: SECRET }, message, 1);
    expect(url.startsWith('https://setter.example.com/l/')).toBe(true);
    const data = readLinkToken(SECRET, url.split('/l/')[1] as string);
    expect(data).toEqual({ f: 'flow1', n: 'biblio', b: 1, r: '1716456302996044', u: 'https://biblioteca.example.com/?a=1', t: ['biblioteca'] });
  });

  it('sin firmante el botón lleva la URL real; los postback no son enlaces', () => {
    expect(buttonUrl(null, message, 1)).toBe('https://biblioteca.example.com/?a=1');
    expect(() => buttonUrl(null, message, 0)).toThrow('no es un enlace');
  });

  it('rechaza enlaces manipulados, con otra clave o rotos', () => {
    const token = createLinkToken(SECRET, { f: 'f', n: 'n', b: 0, r: '1', u: 'https://ok.com', t: [] });
    const [body, sig] = token.split('.');
    const evil = Buffer.from(JSON.stringify({ f: 'f', n: 'n', b: 0, r: '1', u: 'https://malicioso.com', t: [] })).toString('base64url');
    expect(readLinkToken(SECRET, `${evil}.${sig}`)).toBeNull();
    expect(readLinkToken(deriveLinkSecret('otra-clave-distinta-999'), token)).toBeNull();
    expect(readLinkToken(SECRET, 'basura')).toBeNull();
    expect(readLinkToken(SECRET, `${body}.`)).toBeNull();
    const notHttp = createLinkToken(SECRET, { f: 'f', n: 'n', b: 0, r: '1', u: 'javascript:alert(1)', t: [] });
    expect(readLinkToken(SECRET, notHttp)).toBeNull();
  });
});
