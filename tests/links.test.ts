import { describe, expect, it } from 'vitest';
import type { OutMessage } from '../src/flows/engine.js';
import { buttonUrl, createLinkToken, deriveLinkSecret, readLinkToken } from '../src/links.js';

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
