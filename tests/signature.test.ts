import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidSignature } from '../src/meta/signature.js';

const body = Buffer.from('{"object":"instagram","entry":[]}');
const sign = (secret: string, payload = body) =>
  `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

describe('isValidSignature', () => {
  it('acepta la firma hecha con el App Secret correcto', () => {
    expect(isValidSignature(body, sign('secreto-ig'), ['secreto-ig'])).toBe(true);
  });

  it('acepta la firma hecha con el segundo secreto (app de Facebook)', () => {
    expect(isValidSignature(body, sign('secreto-fb'), ['secreto-ig', 'secreto-fb'])).toBe(true);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    expect(isValidSignature(body, sign('otro'), ['secreto-ig'])).toBe(false);
  });

  it('rechaza si el cuerpo fue modificado', () => {
    expect(isValidSignature(Buffer.from('{"object":"x"}'), sign('secreto-ig'), ['secreto-ig'])).toBe(false);
  });

  it('rechaza si falta la cabecera, el prefijo o no hay secretos', () => {
    expect(isValidSignature(body, undefined, ['secreto-ig'])).toBe(false);
    expect(isValidSignature(body, sign('secreto-ig').replace('sha256=', ''), ['secreto-ig'])).toBe(false);
    expect(isValidSignature(body, sign('secreto-ig'), [])).toBe(false);
  });

  it('rechaza una firma con longitud incorrecta sin lanzar error', () => {
    expect(isValidSignature(body, 'sha256=abcd', ['secreto-ig'])).toBe(false);
  });
});
