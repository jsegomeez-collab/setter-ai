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
  /** Portada (Fase 8.1): solo si se pidió con `covers`; enlace de Instagram que caduca. */
  readonly cover: string | null;
}

/** Comentario leído de /<media>/comments (doc: más nuevos primero, máx. 50, sin respuestas salvo que se pidan). */
export interface MediaComment {
  readonly id: string;
  readonly text: string;
  readonly timestamp: string | null;
  readonly fromId: string | null;
  readonly fromUsername: string | null;
  readonly parentId: string | null;
}

export interface SendResult {
  readonly recipientId: string | null;
  readonly messageId: string | null;
}

type ApiButton = { readonly type: 'web_url'; readonly url: string; readonly title: string } | { readonly type: 'postback'; readonly payload: string; readonly title: string };

/**
 * Mensaje en el formato de la API: texto, respuestas rápidas, plantilla de botones, carrusel (generic) o archivo.
 * Formatos de la doc oficial (Messaging API, quick replies y generic template; ver PLAN.md, Fase 7.3).
 */
export type ApiMessage =
  | { readonly text: string }
  | { readonly text: string; readonly quick_replies: readonly { readonly content_type: 'text'; readonly title: string; readonly payload: string }[] }
  | {
      readonly attachment: {
        readonly type: 'template';
        readonly payload: {
          readonly template_type: 'generic';
          readonly elements: readonly {
            readonly title: string;
            readonly subtitle?: string;
            readonly image_url?: string;
            readonly default_action?: { readonly type: 'web_url'; readonly url: string };
            readonly buttons?: readonly ApiButton[];
          }[];
        };
      };
    }
  /** Imagen: la doc usa la lista "attachments" (hasta 10). */
  | { readonly attachments: readonly { readonly type: 'image'; readonly payload: { readonly url: string } }[] }
  | { readonly attachment: { readonly type: 'video' | 'audio' | 'file'; readonly payload: { readonly url: string } } }
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

export type MessengerProfileField = 'ice_breakers' | 'persistent_menu';

/** Cuerpo de /me/messenger_profile (rompehielos y menú fijo), tal cual lo pide Meta. */
export interface MessengerProfile {
  readonly platform: 'instagram';
  readonly ice_breakers?: readonly { readonly locale: string; readonly call_to_actions: readonly { readonly question: string; readonly payload: string }[] }[];
  readonly persistent_menu?: readonly {
    readonly locale: string;
    readonly call_to_actions: readonly (
      | { readonly type: 'postback'; readonly title: string; readonly payload: string }
      | { readonly type: 'web_url'; readonly title: string; readonly url: string }
    )[];
  }[];
}

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

const MEDIA_FIELDS = 'id,caption,permalink,timestamp,media_product_type';
/** Portada (doc IG Media: thumbnail_url solo en vídeos; en fotos y carruseles, media_url si viene). */
const COVER_FIELDS = 'media_type,media_url,thumbnail_url';

export interface MediaOptions {
  readonly covers?: boolean;
}

const mediaFields = (options: MediaOptions): string => (options.covers ? `${MEDIA_FIELDS},${COVER_FIELDS}` : MEDIA_FIELDS);

function coverOf(item: Json): string | null {
  // Vídeo: su portada; foto o carrusel: su media_url (en un vídeo, media_url es el .mp4 y no sirve de imagen).
  return asString(item.thumbnail_url) ?? (asString(item.media_type) === 'VIDEO' ? null : asString(item.media_url));
}
/** Graph API: "Object with ID does not exist, cannot be loaded due to missing permissions…". */
const OBJECT_NOT_FOUND_CODE = 100;

function toMedia(item: Json): Media {
  return {
    id: asString(item.id) ?? '',
    caption: asString(item.caption),
    permalink: asString(item.permalink),
    timestamp: asString(item.timestamp),
    mediaProductType: asString(item.media_product_type),
    cover: coverOf(item),
  };
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

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Json): Promise<Json> {
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

  /** `covers` (Fase 8.1): pide además la portada; solo para la web, la recuperación de comentarios no la usa. */
  async listMedia(limit = 12, options: MediaOptions = {}): Promise<Media[]> {
    const data = await this.call('GET', `me/media?fields=${mediaFields(options)}&limit=${limit}`);
    const items = Array.isArray(data.data) ? (data.data as Json[]) : [];
    return items.map(toMedia).filter((item) => item.id !== '');
  }

  /** Un reel por su id (los que ya no están entre los últimos). null si Meta dice que no existe o no se puede ver (código 100). */
  async getMedia(mediaId: string, options: MediaOptions = {}): Promise<Media | null> {
    try {
      const media = toMedia(await this.call('GET', `${encodeURIComponent(mediaId)}?fields=${mediaFields(options)}`));
      return media.id === '' ? null : media;
    } catch (error) {
      if (error instanceof MetaApiError && error.code === OBJECT_NOT_FOUND_CODE) return null;
      throw error;
    }
  }

  /** Los 50 comentarios principales más recientes de un reel, con su autor (para recuperar los que no nos llegaron). */
  async listComments(mediaId: string): Promise<MediaComment[]> {
    const data = await this.call('GET', `${encodeURIComponent(mediaId)}/comments?fields=id,text,timestamp,from,parent_id&limit=50`);
    const items = Array.isArray(data.data) ? (data.data as Json[]) : [];
    return items
      .map((item) => {
        const from = item.from && typeof item.from === 'object' && !Array.isArray(item.from) ? (item.from as Json) : null;
        return {
          id: asString(item.id) ?? '',
          text: asString(item.text) ?? '',
          timestamp: asString(item.timestamp),
          fromId: from ? asString(from.id) : null,
          fromUsername: from ? asString(from.username) : null,
          parentId: asString(item.parent_id),
        };
      })
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

  /** Reacción con un emoji a un mensaje de la persona (doc: Messaging API, sender_action "react"). */
  async sendReaction(recipientId: string, messageId: string, emoji: string): Promise<Json> {
    return this.call('POST', 'me/messages', { recipient: { id: recipientId }, sender_action: 'react', payload: { message_id: messageId, reaction: emoji } });
  }

  /**
   * Seguidores y verificación de quien escribió (doc: User Profile API, follower_count e is_verified_user).
   * Exige consentimiento (que haya escrito); si Meta no lo deja ver, null.
   */
  async getProfile(igsid: string): Promise<{ followerCount: number | null; isVerified: boolean | null } | null> {
    try {
      const data = await this.call('GET', `${encodeURIComponent(igsid)}?fields=follower_count,is_verified_user`);
      return {
        followerCount: typeof data.follower_count === 'number' ? data.follower_count : null,
        isVerified: typeof data.is_verified_user === 'boolean' ? data.is_verified_user : null,
      };
    } catch (error) {
      if (error instanceof MetaApiError && error.status >= 400 && error.status < 500) return null;
      throw error;
    }
  }

  /**
   * Rompehielos y menú fijo del chat (Fase 7.3c; doc: Messaging API › Ice Breakers / Persistent Menu).
   * Se publican en /me/messenger_profile con platform "instagram"; al pulsarlos llega un aviso de botón (postback).
   */
  async setMessengerProfile(profile: MessengerProfile): Promise<Json> {
    return this.call('POST', 'me/messenger_profile', profile as unknown as Json);
  }

  async getMessengerProfile(fields: readonly MessengerProfileField[]): Promise<Json> {
    return this.call('GET', `me/messenger_profile?fields=${fields.join(',')}&platform=instagram`);
  }

  async deleteMessengerProfile(fields: readonly MessengerProfileField[]): Promise<Json> {
    return this.call('DELETE', 'me/messenger_profile', { platform: 'instagram', fields: [...fields] });
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
   * Foto de perfil de quien ya escribió por DM (Fase 8.1; doc: User Profile API, campo profile_pic). Va aparte del
   * nombre: si Meta no la da, no se pierde el nombre. null si Meta no la da o no lo permite (4xx).
   */
  async getProfilePicture(igsid: string): Promise<string | null> {
    try {
      const data = await this.call('GET', `${encodeURIComponent(igsid)}?fields=profile_pic`);
      return asString(data.profile_pic);
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
