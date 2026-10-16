import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SETTINGS, type Store } from '../store.js';
import { refreshAccessToken, type RefreshedToken } from './client.js';

/**
 * Token de Instagram: se guarda cifrado en la base de datos y se renueva solo.
 * Doc oficial: un token de larga duración se renueva con refresh_access_token si tiene ≥ 24 h,
 * y cada renovación dura 60 días. Renovamos cada 7 días para ir sobrados.
 */

const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encrypt(plain: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(encoded: string, secret: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

export interface TokenStatus {
  readonly source: 'base de datos' | 'variable de entorno' | 'ninguno';
  readonly refreshedAt: string | null;
  readonly expiresAt: string | null;
  readonly lastError: string | null;
  readonly encryptionConfigured: boolean;
}

export interface TokenManagerOptions {
  readonly store: Store;
  readonly envToken: string | null;
  readonly encryptionKey: string | null;
  readonly refresh?: (token: string) => Promise<RefreshedToken>;
  readonly now?: () => Date;
}

export class TokenManager {
  private cached: string | null = null;
  private readonly refresh: (token: string) => Promise<RefreshedToken>;
  private readonly now: () => Date;

  constructor(private readonly options: TokenManagerOptions) {
    this.refresh = options.refresh ?? ((token) => refreshAccessToken(token));
    this.now = options.now ?? (() => new Date());
  }

  /** Token vigente: el renovado (BD) si existe; si no, el de la variable de entorno. */
  async get(): Promise<string | null> {
    if (this.cached) return this.cached;
    const { store, encryptionKey, envToken } = this.options;
    if (encryptionKey) {
      const stored = await store.getSetting(SETTINGS.igToken);
      if (stored) {
        try {
          this.cached = decrypt(stored, encryptionKey);
          return this.cached;
        } catch {
          await store.setSetting(SETTINGS.igTokenLastError, 'No se pudo descifrar el token guardado (¿cambió TOKEN_ENCRYPTION_KEY?). Se usa el de la variable de entorno.');
        }
      }
    }
    this.cached = envToken;
    return envToken;
  }

  /** Renueva si toca. Devuelve un texto con lo que hizo (para el registro). */
  async refreshIfDue(force = false): Promise<string> {
    const { store, encryptionKey } = this.options;
    if (!encryptionKey) return 'Sin TOKEN_ENCRYPTION_KEY: no se puede guardar el token renovado.';
    const token = await this.get();
    if (!token) return 'No hay token que renovar.';
    const last = await store.getSetting(SETTINGS.igTokenRefreshedAt);
    if (!force && last && this.now().getTime() - new Date(last).getTime() < REFRESH_EVERY_MS) return 'No toca renovar todavía.';
    try {
      const fresh = await this.refresh(token);
      const now = this.now();
      await store.setSetting(SETTINGS.igToken, encrypt(fresh.accessToken, encryptionKey));
      await store.setSetting(SETTINGS.igTokenRefreshedAt, now.toISOString());
      const expires = fresh.expiresInSeconds ? new Date(now.getTime() + fresh.expiresInSeconds * 1000).toISOString() : null;
      await store.setSetting(SETTINGS.igTokenExpiresAt, expires);
      await store.setSetting(SETTINGS.igTokenLastError, null);
      this.cached = fresh.accessToken;
      return `Token renovado. Caduca: ${expires ?? 'desconocido'}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.setSetting(SETTINGS.igTokenLastError, `${this.now().toISOString()} ${message}`);
      return `No se pudo renovar: ${message}`;
    }
  }

  async status(): Promise<TokenStatus> {
    const { store, encryptionKey, envToken } = this.options;
    const [stored, refreshedAt, expiresAt, lastError] = await Promise.all([
      encryptionKey ? store.getSetting(SETTINGS.igToken) : Promise.resolve(null),
      store.getSetting(SETTINGS.igTokenRefreshedAt),
      store.getSetting(SETTINGS.igTokenExpiresAt),
      store.getSetting(SETTINGS.igTokenLastError),
    ]);
    const source = stored ? 'base de datos' : envToken ? 'variable de entorno' : 'ninguno';
    return { source, refreshedAt, expiresAt, lastError, encryptionConfigured: encryptionKey !== null };
  }
}
