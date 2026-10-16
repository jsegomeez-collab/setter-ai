const MIN_PASSWORD_LENGTH = 12;
const MIN_ENCRYPTION_KEY_LENGTH = 16;
const DEFAULT_PORT = 3000;
const DEFAULT_API_VERSION = 'v25.0';
/** Muy por debajo de los ~750/h que citan terceros para respuestas privadas (no verificado en doc oficial). */
const DEFAULT_SEND_LIMIT_PER_HOUR = 120;
const DEFAULT_DELAY_MIN_MS = 2000;
const DEFAULT_DELAY_MAX_MS = 5000;

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly adminPassword: string;
  readonly webhookVerifyToken: string;
  /** Secretos con los que Meta puede firmar los avisos (app de Instagram y, opcional, app de Facebook). */
  readonly appSecrets: readonly string[];
  readonly igAccessToken: string | null;
  readonly igApiVersion: string;
  /** Clave para guardar cifrado el token renovado. Sin ella no hay renovación automática. */
  readonly tokenEncryptionKey: string | null;
  readonly sendLimitPerHour: number;
  readonly sendDelayMinMs: number;
  readonly sendDelayMaxMs: number;
  /** URL pública del servidor (para los enlaces con seguimiento). Render la da en RENDER_EXTERNAL_URL. */
  readonly publicBaseUrl: string | null;
}

type Env = Record<string, string | undefined>;

const REQUIRED = ['DATABASE_URL', 'ADMIN_PASSWORD', 'WEBHOOK_VERIFY_TOKEN'] as const;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = clean(env[key]);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} no es un número entero válido: ${raw}`);
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const missing = REQUIRED.filter((key) => clean(env[key]) === null);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  }

  const adminPassword = clean(env.ADMIN_PASSWORD) as string;
  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }

  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT no es válido: ${env.PORT}`);
  }

  const tokenEncryptionKey = clean(env.TOKEN_ENCRYPTION_KEY);
  if (tokenEncryptionKey !== null && tokenEncryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(`TOKEN_ENCRYPTION_KEY debe tener al menos ${MIN_ENCRYPTION_KEY_LENGTH} caracteres`);
  }

  const sendDelayMinMs = positiveInt(env, 'SEND_DELAY_MIN_MS', DEFAULT_DELAY_MIN_MS);
  const sendDelayMaxMs = positiveInt(env, 'SEND_DELAY_MAX_MS', DEFAULT_DELAY_MAX_MS);
  if (sendDelayMaxMs < sendDelayMinMs) throw new Error('SEND_DELAY_MAX_MS no puede ser menor que SEND_DELAY_MIN_MS');

  const appSecrets = [clean(env.META_APP_SECRET), clean(env.META_APP_SECRET_ALT)].filter(
    (secret): secret is string => secret !== null,
  );

  return {
    port,
    databaseUrl: clean(env.DATABASE_URL) as string,
    adminPassword,
    webhookVerifyToken: clean(env.WEBHOOK_VERIFY_TOKEN) as string,
    appSecrets,
    igAccessToken: clean(env.IG_ACCESS_TOKEN),
    igApiVersion: clean(env.IG_API_VERSION) ?? DEFAULT_API_VERSION,
    tokenEncryptionKey,
    sendLimitPerHour: positiveInt(env, 'SEND_LIMIT_PER_HOUR', DEFAULT_SEND_LIMIT_PER_HOUR),
    sendDelayMinMs,
    sendDelayMaxMs,
    publicBaseUrl: clean(env.PUBLIC_BASE_URL) ?? clean(env.RENDER_EXTERNAL_URL),
  };
}
