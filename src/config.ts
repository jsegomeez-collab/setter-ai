const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_PORT = 3000;
const DEFAULT_API_VERSION = 'v25.0';

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly adminPassword: string;
  readonly webhookVerifyToken: string;
  /** Secretos con los que Meta puede firmar los avisos (app de Instagram y, opcional, app de Facebook). */
  readonly appSecrets: readonly string[];
  readonly igAccessToken: string | null;
  readonly igApiVersion: string;
  /** IDs de Instagram a los que se permite contestar por DM además de los que se añaden desde el panel. */
  readonly allowedSenderIds: readonly string[];
}

type Env = Record<string, string | undefined>;

const REQUIRED = ['DATABASE_URL', 'ADMIN_PASSWORD', 'WEBHOOK_VERIFY_TOKEN'] as const;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
    allowedSenderIds: splitList(env.ALLOWED_SENDER_IDS),
  };
}
