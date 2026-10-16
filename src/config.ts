const MIN_PASSWORD_LENGTH = 12;
const MIN_ENCRYPTION_KEY_LENGTH = 16;
const DEFAULT_PORT = 3000;
const DEFAULT_API_VERSION = 'v25.0';

/**
 * Límites por hora, pegados a los oficiales de Meta con margen
 * (doc Instagram Platform › Overview › Rate limits, consultada 2026-10-16):
 *  - respuestas privadas a comentarios de posts/reels: 750/h por cuenta → usamos 700;
 *  - Send API (texto): 100/s por cuenta → 3000/h es muy conservador;
 *  - respuestas públicas: cuentan en el límite general (4800 × impresiones / 24 h) → 700/h.
 */
const DEFAULT_LIMITS = { privateReplies: 700, publicReplies: 700, followUps: 3000 } as const;
/** Esperas aleatorias (ms): comentarios más pausados; seguimientos casi inmediatos (la persona acaba de pulsar). */
const DEFAULT_DELAYS = { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 } as const;

export interface SendLimits {
  readonly privateReplies: number;
  readonly publicReplies: number;
  readonly followUps: number;
}

export interface SendDelays {
  readonly commentMin: number;
  readonly commentMax: number;
  readonly followUpMin: number;
  readonly followUpMax: number;
}

/** Enlaces y correo que el setter puede compartir (los únicos: guards.ts bloquea cualquier otro). Dados por Jose el 2026-10-16. */
const DEFAULT_SETTER_LINKS = {
  agenda: 'https://codigomaestria.com/agenda?utm_source=instagram',
  membership: 'https://buy.stripe.com/8x29AS3ZI0Uk1jg0Fpbwk1Z',
  contactEmail: 'info@codigomaestria.com',
} as const;
const DEFAULT_SETTER_MODEL = 'claude-haiku-5-5';

export interface SetterConfig {
  /** Sin clave no hay setter IA (el resto del servidor funciona igual). */
  readonly anthropicApiKey: string | null;
  readonly model: string;
  readonly links: { readonly agenda: string; readonly membership: string; readonly contactEmail: string };
}

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
  readonly limits: SendLimits;
  readonly delays: SendDelays;
  /** URL pública del servidor (para los enlaces con seguimiento). Render la da en RENDER_EXTERNAL_URL. */
  readonly publicBaseUrl: string | null;
  readonly setter: SetterConfig;
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

function loadDelays(env: Env): SendDelays {
  const delays = {
    commentMin: positiveInt(env, 'SEND_DELAY_COMMENT_MIN_MS', DEFAULT_DELAYS.commentMin),
    commentMax: positiveInt(env, 'SEND_DELAY_COMMENT_MAX_MS', DEFAULT_DELAYS.commentMax),
    followUpMin: positiveInt(env, 'SEND_DELAY_FOLLOWUP_MIN_MS', DEFAULT_DELAYS.followUpMin),
    followUpMax: positiveInt(env, 'SEND_DELAY_FOLLOWUP_MAX_MS', DEFAULT_DELAYS.followUpMax),
  };
  if (delays.commentMax < delays.commentMin) throw new Error('SEND_DELAY_COMMENT_MAX_MS no puede ser menor que el mínimo');
  if (delays.followUpMax < delays.followUpMin) throw new Error('SEND_DELAY_FOLLOWUP_MAX_MS no puede ser menor que el mínimo');
  return delays;
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
    limits: {
      privateReplies: positiveInt(env, 'SEND_LIMIT_PRIVATE_PER_HOUR', DEFAULT_LIMITS.privateReplies),
      publicReplies: positiveInt(env, 'SEND_LIMIT_PUBLIC_PER_HOUR', DEFAULT_LIMITS.publicReplies),
      followUps: positiveInt(env, 'SEND_LIMIT_FOLLOWUP_PER_HOUR', DEFAULT_LIMITS.followUps),
    },
    delays: loadDelays(env),
    publicBaseUrl: clean(env.PUBLIC_BASE_URL) ?? clean(env.RENDER_EXTERNAL_URL),
    setter: {
      anthropicApiKey: clean(env.ANTHROPIC_API_KEY),
      model: clean(env.SETTER_MODEL) ?? DEFAULT_SETTER_MODEL,
      links: {
        agenda: clean(env.SETTER_LINK_AGENDA) ?? DEFAULT_SETTER_LINKS.agenda,
        membership: clean(env.SETTER_LINK_MEMBERSHIP) ?? DEFAULT_SETTER_LINKS.membership,
        contactEmail: clean(env.SETTER_CONTACT_EMAIL) ?? DEFAULT_SETTER_LINKS.contactEmail,
      },
    },
  };
}
