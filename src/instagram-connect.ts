import { randomBytes } from 'node:crypto';

/**
 * "Conectar Instagram" con el inicio de sesión oficial (Business Login for Instagram), pasos de la doc de Meta:
 * enlace de autorización → código (1 h, un solo uso) → token corto → token de 60 días. Primero se usa como PRUEBA
 * (antes de la 7.5): comprobar que una cuenta con rol "Evaluador de Instagram" puede dar los permisos sin revisión.
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
 */

export const CONNECT_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'] as const;

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const SHORT_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_TOKEN_URL = 'https://graph.instagram.com/access_token';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_BYTES = 24;
const DAY_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

export interface InstagramConnectOptions {
  /** ID de la app de Instagram (no el de la app de Meta): 1117985297673013 para "AI Setter-IG". */
  readonly appId: string;
  /** Claves posibles de la app (META_APP_SECRET y la alternativa): se prueba en orden. */
  readonly appSecrets: readonly string[];
  readonly redirectUri: string;
  readonly apiVersion: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

export type ConnectResult =
  | {
      readonly ok: true;
      readonly username: string;
      readonly userId: string;
      readonly permissions: readonly string[];
      readonly expiresInDays: number | null;
      /** Qué clave funcionó (0 o 1), sin revelarla. */
      readonly secretIndex: number;
      /** El token de 60 días: quien llame decide si lo guarda (en la prueba, NO). */
      readonly accessToken: string;
    }
  | { readonly ok: false; readonly error: string };

type Json = Record<string, unknown>;

async function readJson(response: Response): Promise<Json> {
  try {
    return ((await response.json()) ?? {}) as Json;
  } catch {
    return {};
  }
}

const metaError = (body: Json): string => {
  const nested = (body.error as { message?: unknown } | undefined)?.message;
  return String(body.error_message ?? nested ?? 'Respuesta inesperada de Instagram');
};

/** Error de "clave de la app incorrecta": entonces se prueba la otra clave. */
const isSecretError = (body: Json): boolean => /client[ _]secret/i.test(metaError(body));

export class InstagramConnect {
  private readonly states = new Map<string, number>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: InstagramConnectOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Enlace oficial de autorización, con un `state` de un solo uso (protege de que alguien cuele su propia vuelta). */
  authorizeUrl(): string {
    for (const [state, at] of this.states) if (this.now() - at > STATE_TTL_MS) this.states.delete(state);
    const state = randomBytes(STATE_BYTES).toString('base64url');
    this.states.set(state, this.now());
    const params = new URLSearchParams({
      client_id: this.options.appId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: CONNECT_SCOPES.join(','),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  consumeState(state: string): boolean {
    const at = this.states.get(state);
    this.states.delete(state);
    return at !== undefined && this.now() - at <= STATE_TTL_MS;
  }

  async exchange(rawCode: string): Promise<ConnectResult> {
    // La doc avisa: Meta añade "#_" al final del código en la vuelta.
    const code = rawCode.replace(/#_$/, '');
    for (const [secretIndex, secret] of this.options.appSecrets.entries()) {
      const shortRes = await this.post(SHORT_TOKEN_URL, {
        client_id: this.options.appId,
        client_secret: secret,
        grant_type: 'authorization_code',
        redirect_uri: this.options.redirectUri,
        code,
      });
      const short = await readJson(shortRes);
      if (!shortRes.ok || typeof short.access_token !== 'string') {
        if (isSecretError(short)) continue;
        return { ok: false, error: metaError(short) };
      }
      const longParams = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short.access_token });
      const longRes = await this.get(`${LONG_TOKEN_URL}?${longParams.toString()}`);
      const long = await readJson(longRes);
      if (!longRes.ok || typeof long.access_token !== 'string') return { ok: false, error: `Token de 60 días: ${metaError(long)}` };
      const meParams = new URLSearchParams({ fields: 'user_id,username', access_token: long.access_token });
      const meRes = await this.get(`https://graph.instagram.com/${this.options.apiVersion}/me?${meParams.toString()}`);
      const me = await readJson(meRes);
      if (!meRes.ok) return { ok: false, error: `Datos de la cuenta: ${metaError(me)}` };
      return {
        ok: true,
        username: String(me.username ?? ''),
        userId: String(me.user_id ?? short.user_id ?? ''),
        permissions: Array.isArray(short.permissions) ? short.permissions.map(String) : [],
        expiresInDays: typeof long.expires_in === 'number' ? Math.floor(long.expires_in / DAY_SECONDS) : null,
        secretIndex,
        accessToken: long.access_token,
      };
    }
    return { ok: false, error: 'Ninguna de las claves de la app es válida para Instagram (revisar META_APP_SECRET).' };
  }

  private post(url: string, form: Record<string, string>): Promise<Response> {
    return this.fetchFn(url, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  private get(url: string): Promise<Response> {
    return this.fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
}
