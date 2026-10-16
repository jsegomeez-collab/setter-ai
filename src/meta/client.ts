/**
 * Cliente mínimo de la API de Instagram (Instagram API with Instagram Login).
 * Formatos sacados de la doc oficial: graph.instagram.com, token como Bearer.
 */

const HOST = 'https://graph.instagram.com';
const REQUEST_TIMEOUT_MS = 15_000;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'MetaApiError';
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

type FetchFn = typeof fetch;
type Json = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

export class InstagramClient {
  constructor(
    private readonly token: string,
    private readonly version: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, body?: Json): Promise<Json> {
    const response = await this.fetchFn(`${HOST}/${this.version}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
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

  async sendPrivateReply(commentId: string, text: string): Promise<SendResult> {
    const data = await this.call('POST', 'me/messages', { recipient: { comment_id: commentId }, message: { text } });
    return { recipientId: asString(data.recipient_id), messageId: asString(data.message_id) };
  }

  async sendText(recipientId: string, text: string): Promise<SendResult> {
    const data = await this.call('POST', 'me/messages', { recipient: { id: recipientId }, message: { text } });
    return { recipientId: asString(data.recipient_id), messageId: asString(data.message_id) };
  }
}
