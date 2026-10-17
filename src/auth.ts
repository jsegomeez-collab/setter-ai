import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Acceso al frontend (Fase 6): contraseñas con scrypt (viene con Node, sin librerías) y sesiones con token aleatorio.
 * En la base solo se guarda el hash de la contraseña y la huella (sha256) del token; nunca el token ni la clave.
 */

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK = 8;
const SCRYPT_PARALLEL = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export const SESSION_COOKIE = 'sai_session';
export const SESSION_DAYS = 30;
export const MIN_USER_PASSWORD_LENGTH = 12;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_COST, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Formato guardado: `scrypt$<sal base64>$<clave derivada base64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(saltB64, 'base64'));
  return timingSafeEqual(actual, expected);
}

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compara dos textos en tiempo constante (la clave del alta). */
export function sameSecret(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;

/** Límite de intentos de login por (IP + correo): 5 fallos seguidos bloquean 15 min. En memoria: se reinicia al desplegar. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Además de responder, olvida los fallos de hace más de 15 min. */
  isBlocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (this.now() - entry.firstAt > BLOCK_MS) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  fail(key: string): void {
    this.isBlocked(key);
    const entry = this.failures.get(key);
    this.failures.set(key, entry ? { ...entry, count: entry.count + 1 } : { count: 1, firstAt: this.now() });
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}
