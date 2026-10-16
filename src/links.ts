import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { OutMessage } from './flows/engine.js';

/**
 * Enlaces con seguimiento: Instagram no avisa cuando alguien pulsa un botón de enlace,
 * así que el botón apunta a nuestro servidor (/l/<token>), que registra el clic, añade etiquetas
 * y redirige al destino real. El token va firmado (HMAC) para que nadie pueda fabricar redirecciones.
 */

const SIGNATURE_BYTES = 16;

export interface LinkData {
  /** flujo, nodo, índice del botón, destinatario (IGSID), URL real, etiquetas */
  readonly f: string;
  readonly n: string;
  readonly b: number;
  readonly r: string;
  readonly u: string;
  readonly t: readonly string[];
}

export interface LinkSigner {
  readonly baseUrl: string;
  readonly secret: string;
}

/** Clave propia para firmar enlaces, derivada de la clave de cifrado (no se reutiliza tal cual). */
export function deriveLinkSecret(encryptionKey: string): string {
  return createHash('sha256').update(`links:${encryptionKey}`).digest('hex');
}

function sign(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest().subarray(0, SIGNATURE_BYTES);
}

export function createLinkToken(secret: string, data: LinkData): string {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${sign(secret, body).toString('base64url')}`;
}

export function readLinkToken(secret: string, token: string): LinkData | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(secret, body);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkData;
    if (typeof data.u !== 'string' || !/^https?:\/\//.test(data.u) || !Array.isArray(data.t)) return null;
    return data;
  } catch {
    return null;
  }
}

/** URL que se pone en el botón: la de seguimiento si hay firmante, si no la real. */
export function buttonUrl(signer: LinkSigner | null, message: OutMessage, index: number): string {
  const button = message.buttons[index];
  if (!button || button.type !== 'url') throw new Error(`El botón ${index} no es un enlace`);
  if (!signer) return button.url;
  const token = createLinkToken(signer.secret, {
    f: message.flowId,
    n: message.nodeId,
    b: index,
    r: message.recipientId,
    u: button.url,
    t: button.tags,
  });
  return `${signer.baseUrl.replace(/\/$/, '')}/l/${token}`;
}
