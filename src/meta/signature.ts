import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/**
 * Comprueba la cabecera X-Hub-Signature-256 que Meta añade a cada aviso.
 * La firma es un HMAC-SHA256 del cuerpo EXACTO (bytes sin tocar) con el App Secret.
 * Se aceptan varios secretos porque Meta puede firmar con el de la app de Instagram o el de Facebook.
 */
export function isValidSignature(
  rawBody: Buffer,
  header: string | undefined,
  secrets: readonly string[],
): boolean {
  if (!header || !header.startsWith(PREFIX) || secrets.length === 0) {
    return false;
  }
  const received = Buffer.from(header.slice(PREFIX.length), 'hex');
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
