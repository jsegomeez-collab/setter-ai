/**
 * Cliente mínimo de la API de Instagram (Instagram API with Instagram Login).
 * Formatos sacados de la doc oficial: graph.instagram.com, token como Bearer.
 */

const HOST = 'https://graph.instagram.com';
const REQUEST_TIMEOUT_MS = 15_000;

export class MetaApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;

  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'MetaApiError';
    const error = (body as { error?: { code?: unknown; error_subcode?: unknown } } | null)?.error;
    this.code = typeof error?.code === 'number' ? error.code : null;
    this.subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : null;
  }
}

export interface Account {
  readonly userId: string;
  readonly username: string;
}

export interface Media {
  readonly id: string;
  readonly caption: string | null;
  readonly permalink: string | null;
  readonly timestamp: string | null;
  readonly mediaProductType: string | null;
}

export interface SendResult {
  readonly recipientId: string | null;
  readonly messageId: string | null;
}

/** Mensaje en el formato de la API: texto simple o plantilla de botones. */
export type ApiMessage =
  | { readonly text: string }
  | {
      readonly attachment: {
        readonly type: 'template';
        readonly payload: {
          readonly template_type: 'button';
          readonly text: string;
          readonly buttons: readonly (
            | { readonly type: 'web_url'; readonly url: string; readonly title: string }
            | { readonly type: 'postback'; readonly payload: string; readonly title: string }
          )[];
        };
      };
    };

export type FollowStatus = 'yes' | 'no' | 'unknown';

export interface RefreshedToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number | null;
}

type FetchFn = typeof fetch;
type Json = Record<string, unknown>;
export type TokenSource = string | (() => Promise<string | null>);

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

async function parseResponse(response: Response): Promise<Json> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const error = (parsed as { error?: { message?: string } } | null)?.error;
    throw new MetaApiError(error?.message ?? `HTTP ${response.status}`, response.status, parsed);
  }
  return (parsed ?? {}) as Json;
}

/** Renueva un token de larga duración (doc: GET /refresh_access_token, grant_type=ig_refresh_token). */
export async function refreshAccessToken(token: string, fetchFn: FetchFn = fetch): Promise<RefreshedToken> {
  const url = `${HOST}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const data = await parseResponse(await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  const accessToken = asString(data.access_token);
  if (!accessToken) throw new MetaApiError('La renovación no devolvió access_token', 200, data);
  return { accessToken, expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : null };
}

export class InstagramClient {
  constructor(
    private readonly token: TokenSource,
    private readonly version: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async currentToken(): Promise<string> {
    const token = typeof this.token === 'string' ? this.token : await this.token();
    if (!token) throw new MetaApiError('No hay token de Instagram configurado', 0, null);
    return token;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: Json): Promise<Json> {
    const response = await this.fetchFn(`${HOST}/${this.version}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.currentToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return parseResponse(response);
  }

  async getAccount(): Promise<Account> {
    const data = await this.call('GET', 'me?fields=user_id,username');
    const userId = asString(data.user_id);
    if (!userId) throw new MetaApiError('La respuesta de /me no trae user_id', 200, data);
    return { userId, username: asString(data.username) ?? '' };
  }

  async listMedia(limit = 12): Promise<Media[]> {
    const data = await this.call('GET', `me/media?fields=id,caption,permalink,timestamp,media_product_type&limit=${limit}`);
    const items = Array.isArray(data.data) ? (data.data as Json[]) : [];
    return items
      .map((item) => ({
        id: asString(item.id) ?? '',
        caption: asString(item.caption),
        permalink: asString(item.permalink),
        timestamp: asString(item.timestamp),
        mediaProductType: asString(item.media_product_type),
      }))
      .filter((item) => item.id !== '');
  }

  /** Activa que Meta mande avisos de comentarios y DMs de esta cuenta a nuestra app. */
  async subscribe(): Promise<Json> {
    return this.call('POST', 'me/subscribed_apps?subscribed_fields=comments,messages');
  }

  async replyToComment(commentId: string, text: string): Promise<Json> {
    return this.call('POST', `${encodeURIComponent(commentId)}/replies`, { message: text });
  }

  async sendPrivateReply(commentId: string, message: ApiMessage | string): Promise<SendResult> {
    return this.send({ comment_id: commentId }, message);
  }

  async sendMessage(recipientId: string, message: ApiMessage | string): Promise<SendResult> {
    return this.send({ id: recipientId }, message);
  }

  /**
   * Muestra "escribiendo…" a la persona (doc: Messaging API › Sender Actions, typing_on).
   * La petición solo lleva recipient y sender_action; el mensaje va aparte.
   */
  async sendTypingOn(recipientId: string): Promise<void> {
    await this.call('POST', 'me/messages', { recipient: { id: recipientId }, sender_action: 'typing_on' });
  }

  /** Compatibilidad con la Fase 1. */
  async sendText(recipientId: string, text: string): Promise<SendResult> {
    return this.sendMessage(recipientId, text);
  }

  private async send(recipient: Json, message: ApiMessage | string): Promise<SendResult> {
    const body = { recipient, message: typeof message === 'string' ? { text: message } : message };
    const data = await this.call('POST', 'me/messages', body as unknown as Json);
    return { recipientId: asString(data.recipient_id), messageId: asString(data.message_id) };
  }

  /**
   * Username de quien escribió (doc: User Profile API, campo username). Meta lo da cuando la persona
   * ya nos ha escrito un DM (consentimiento); si no lo permite, null.
   */
  async getUsername(igsid: string): Promise<string | null> {
    try {
      const data = await this.call('GET', `${encodeURIComponent(igsid)}?fields=username`);
      return asString(data.username);
    } catch (error) {
      if (error instanceof MetaApiError && error.status >= 400 && error.status < 500) return null;
      throw error;
    }
  }

  /**
   * ¿La persona sigue la cuenta? (doc: User Profile API, campo is_user_follow_business).
   * Meta exige "consentimiento" (que haya escrito); si no lo hay, devolvemos "unknown".
   */
  async getFollowStatus(igsid: string): Promise<{ status: FollowStatus; detail: string }> {
    try {
      const data = await this.call('GET', `${encodeURIComponent(igsid)}?fields=is_user_follow_business`);
      if (data.is_user_follow_business === true) return { status: 'yes', detail: 'is_user_follow_business=true' };
      if (data.is_user_follow_business === false) return { status: 'no', detail: 'is_user_follow_business=false' };
      return { status: 'unknown', detail: 'Meta no devolvió el campo' };
    } catch (error) {
      if (error instanceof MetaApiError && error.status >= 400 && error.status < 500) {
        return { status: 'unknown', detail: `Meta no lo permite: ${error.message}` };
      }
      throw error;
    }
  }
}
