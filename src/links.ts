import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/**
 * Enlaces cortos (Fase 5): la agenda va en mensajes de texto de la IA, donde el enlace firmado (>200 caracteres)
 * quedaría mal. Se guarda en la BD un código de 7 caracteres → destino, persona y etiquetas.
 */
const SHORT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHORT_LENGTH = 7;
/** Si un código ya existía (casualidad), se prueba con otro hasta 3 veces. */
const MAX_CODE_TRIES = 3;

export function newShortCode(): string {
  return [...randomBytes(SHORT_LENGTH)].map((byte) => SHORT_ALPHABET[byte % SHORT_ALPHABET.length]).join('');
}

export interface AgendaLinkDeps {
  readonly store: { saveShortLink(code: string, data: LinkData): Promise<boolean> };
  /** Base pública (PUBLIC_BASE_URL): hoy setter-ai-vfle.onrender.com, más adelante el dominio de Jose. */
  readonly baseUrl: string;
  readonly agendaUrl: string;
}

/** Cambia el enlace de agenda del texto por uno corto con seguimiento; el destino lleva utm_content=<código> (para GHL). */
export async function trackAgendaLinks(text: string, recipientId: string, deps: AgendaLinkDeps): Promise<string> {
  if (!text.includes(deps.agendaUrl)) return text;
  for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt += 1) {
    const code = newShortCode();
    const target = new URL(deps.agendaUrl);
    target.searchParams.set('utm_content', code);
    const data: LinkData = { f: 'setter', n: 'agenda', b: 0, r: recipientId, u: target.toString(), t: ['agenda'] };
    if (await deps.store.saveShortLink(code, data)) return text.split(deps.agendaUrl).join(`${deps.baseUrl.replace(/\/$/, '')}/l/${code}`);
  }
  throw new Error('No se pudo crear un código de enlace corto');
}

export function isShortCode(value: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${SHORT_LENGTH}}$`).test(value);
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
