import { describe, expect, it, vi } from 'vitest';
import { InstagramClient, MetaApiError, refreshAccessToken } from '../src/meta/client.js';

function fetchReturning(status: number, body: unknown) {
  return vi.fn().mockImplementation(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

const lastCall = (fetchFn: ReturnType<typeof vi.fn>) => fetchFn.mock.calls.at(-1) as [string, RequestInit];

describe('InstagramClient', () => {
  it('manda texto o plantilla de botones al endpoint oficial con Bearer token', async () => {
    const fetchFn = fetchReturning(200, { recipient_id: '9', message_id: 'mid' });
    const client = new InstagramClient('tok', 'v25.0', fetchFn);
    expect(await client.sendText('9', 'hola')).toEqual({ recipientId: '9', messageId: 'mid' });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v25.0/me/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: '9' }, message: { text: 'hola' } });

    const template = { attachment: { type: 'template' as const, payload: { template_type: 'button' as const, text: 'x', buttons: [] } } };
    await client.sendPrivateReply('c-1', template);
    expect(JSON.parse(lastCall(fetchFn)[1].body as string)).toEqual({ recipient: { comment_id: 'c-1' }, message: template });
  });

  it('usa el token del proveedor (renovado) en cada llamada', async () => {
    const fetchFn = fetchReturning(200, { user_id: 1, username: 'j' });
    let token = 'viejo';
    const client = new InstagramClient(async () => token, 'v25.0', fetchFn);
    await client.getAccount();
    token = 'nuevo';
    await client.getAccount();
    expect((lastCall(fetchFn)[1].headers as Record<string, string>).Authorization).toBe('Bearer nuevo');
    await expect(new InstagramClient(async () => null, 'v25.0', fetchFn).getAccount()).rejects.toThrow('No hay token');
  });

  it('responde a comentarios, lee reels y activa la suscripción', async () => {
    const fetchFn = fetchReturning(200, { id: 'r-1' });
    await new InstagramClient('tok', 'v25.0', fetchFn).replyToComment('c-1', 'gracias');
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/v25.0/c-1/replies');
    const media = await new InstagramClient('t', 'v25.0', fetchReturning(200, { data: [{ id: '1', caption: 'c' }, { caption: 'sin id' }] })).listMedia();
    expect(media).toEqual([{ id: '1', caption: 'c', permalink: null, timestamp: null, mediaProductType: null, cover: null }]);
    const sub = fetchReturning(200, { success: true });
    await new InstagramClient('t', 'v25.0', sub).subscribe();
    expect(lastCall(sub)[0]).toContain('subscribed_fields=comments,messages');
  });

  it('lee un reel suelto por su id (para los que no están entre los últimos); si Meta dice que no existe → null', async () => {
    const fetchFn = fetchReturning(200, { id: '77', caption: 'Reel viejo', permalink: 'https://instagram.com/reel/x', timestamp: '2026-09-01T10:00:00+0000', media_product_type: 'REELS' });
    expect(await new InstagramClient('t', 'v25.0', fetchFn).getMedia('77')).toEqual({ id: '77', caption: 'Reel viejo', permalink: 'https://instagram.com/reel/x', timestamp: '2026-09-01T10:00:00+0000', mediaProductType: 'REELS', cover: null });
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/v25.0/77?fields=id,caption,permalink,timestamp,media_product_type');
    const missing = fetchReturning(400, { error: { message: 'Unsupported get request. Object with ID does not exist', code: 100 } });
    expect(await new InstagramClient('t', 'v25.0', missing).getMedia('88')).toBeNull();
    // Otros fallos (token, caída de Meta) no se esconden: se lanza el error.
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(500, { error: { message: 'caído' } })).getMedia('99')).rejects.toThrow('caído');
  });

  it('Fase 8.1 · portadas de reels solo si se piden (la lista de siempre no cambia): vídeo → thumbnail_url, foto → media_url', async () => {
    const plain = fetchReturning(200, { data: [] });
    await new InstagramClient('t', 'v25.0', plain).listMedia(5);
    expect(lastCall(plain)[0]).toBe('https://graph.instagram.com/v25.0/me/media?fields=id,caption,permalink,timestamp,media_product_type&limit=5');
    const covers = fetchReturning(200, {
      data: [
        { id: '1', media_type: 'VIDEO', thumbnail_url: 'https://cdn/v.jpg', media_url: 'https://cdn/v.mp4' },
        { id: '2', media_type: 'IMAGE', media_url: 'https://cdn/i.jpg' },
        { id: '3', media_type: 'CAROUSEL_ALBUM' },
      ],
    });
    const media = await new InstagramClient('t', 'v25.0', covers).listMedia(5, { covers: true });
    expect(lastCall(covers)[0]).toContain('fields=id,caption,permalink,timestamp,media_product_type,media_type,media_url,thumbnail_url');
    expect(media.map((m) => m.cover)).toEqual(['https://cdn/v.jpg', 'https://cdn/i.jpg', null]);
    const one = fetchReturning(200, { id: '77', media_type: 'VIDEO', thumbnail_url: 'https://cdn/77.jpg' });
    expect((await new InstagramClient('t', 'v25.0', one).getMedia('77', { covers: true }))?.cover).toBe('https://cdn/77.jpg');
  });

  it('Fase 8.1 · foto de perfil de quien escribió (User Profile API, profile_pic); si Meta no la da → null', async () => {
    const ok = fetchReturning(200, { profile_pic: 'https://cdn/ana.jpg', id: '9' });
    expect(await new InstagramClient('t', 'v25.0', ok).getProfilePicture('9')).toBe('https://cdn/ana.jpg');
    expect(lastCall(ok)[0]).toBe('https://graph.instagram.com/v25.0/9?fields=profile_pic');
    expect(await new InstagramClient('t', 'v25.0', fetchReturning(200, { id: '9' })).getProfilePicture('9')).toBeNull();
    expect(await new InstagramClient('t', 'v25.0', fetchReturning(400, { error: { message: 'sin permiso', code: 100 } })).getProfilePicture('9')).toBeNull();
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(500, { error: { message: 'caído' } })).getProfilePicture('9')).rejects.toThrow('caído');
  });

  it('lee los comentarios principales de un reel con su autor (doc: /<media>/comments, más nuevos primero, máx. 50)', async () => {
    const fetchFn = fetchReturning(200, {
      data: [
        { id: 'c2', text: 'Bolsa', timestamp: '2026-10-17T00:50:00+0000', from: { id: '9', username: 'ana' } },
        { id: 'c1', text: 'hola', timestamp: '2026-10-17T00:40:00+0000', from: { id: '8' }, parent_id: 'c0' },
        { text: 'sin id' },
      ],
    });
    const comments = await new InstagramClient('t', 'v25.0', fetchFn).listComments('m1');
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/v25.0/m1/comments?fields=id,text,timestamp,from,parent_id&limit=50');
    expect(comments).toEqual([
      { id: 'c2', text: 'Bolsa', timestamp: '2026-10-17T00:50:00+0000', fromId: '9', fromUsername: 'ana', parentId: null },
      { id: 'c1', text: 'hola', timestamp: '2026-10-17T00:40:00+0000', fromId: '8', fromUsername: null, parentId: 'c0' },
    ]);
  });

  it('getFollowStatus: sí / no / no se sabe (falta de consentimiento) / error de servidor', async () => {
    const yes = await new InstagramClient('t', 'v25.0', fetchReturning(200, { is_user_follow_business: true })).getFollowStatus('9');
    const no = await new InstagramClient('t', 'v25.0', fetchReturning(200, { is_user_follow_business: false })).getFollowStatus('9');
    const missing = await new InstagramClient('t', 'v25.0', fetchReturning(200, {})).getFollowStatus('9');
    const consent = await new InstagramClient('t', 'v25.0', fetchReturning(400, { error: { message: 'User consent is required to access user profile.' } })).getFollowStatus('9');
    expect([yes.status, no.status, missing.status, consent.status]).toEqual(['yes', 'no', 'unknown', 'unknown']);
    expect(consent.detail).toContain('consent');
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(500, { error: { message: 'boom' } })).getFollowStatus('9')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('sendTypingOn: manda solo recipient y sender_action typing_on', async () => {
    const fetchFn = fetchReturning(200, { recipient_id: '9' });
    await new InstagramClient('t', 'v25.0', fetchFn).sendTypingOn('9');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v25.0/me/messages');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: '9' }, sender_action: 'typing_on' });
  });

  it('getUsername: pide el campo username del IGSID; sin consentimiento devuelve null', async () => {
    const fetchFn = fetchReturning(200, { username: 'josegomezlife', id: '9' });
    expect(await new InstagramClient('t', 'v25.0', fetchFn).getUsername('9')).toBe('josegomezlife');
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/v25.0/9?fields=username');
    const consent = fetchReturning(400, { error: { message: 'User consent is required to access user profile.' } });
    expect(await new InstagramClient('t', 'v25.0', consent).getUsername('9')).toBeNull();
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(500, { error: { message: 'boom' } })).getUsername('9')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('MetaApiError guarda el código (p. ej. 368) y aguanta respuestas que no son JSON', async () => {
    const error = new MetaApiError('x', 400, { error: { code: 368, error_subcode: 1 } });
    expect([error.code, error.subcode]).toEqual([368, 1]);
    expect(new MetaApiError('x', 500, null).code).toBeNull();
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(502, '<html>')).subscribe()).rejects.toBeInstanceOf(MetaApiError);
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(200, { id: 'x' })).getAccount()).rejects.toThrow('user_id');
  });

  it('refreshAccessToken usa el endpoint oficial y devuelve el token nuevo', async () => {
    const fetchFn = fetchReturning(200, { access_token: 'nuevo', token_type: 'bearer', expires_in: 5184000 });
    expect(await refreshAccessToken('viejo', fetchFn)).toEqual({ accessToken: 'nuevo', expiresInSeconds: 5184000 });
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=viejo');
    await expect(refreshAccessToken('x', fetchReturning(200, {}))).rejects.toThrow('access_token');
  });
});

/** Fase 7.3a: reacción y perfil, con el formato de la doc oficial. */
describe('InstagramClient · Fase 7.3a', () => {
  it('reacción: sender_action react con message_id y el emoji', async () => {
    const fetchFn = fetchReturning(200, { recipient_id: '9' });
    await new InstagramClient('tok', 'v25.0', fetchFn).sendReaction('9', 'mid-1', '🔥');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v25.0/me/messages');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: '9' }, sender_action: 'react', payload: { message_id: 'mid-1', reaction: '🔥' } });
  });

  it('perfil: follower_count e is_verified_user; sin consentimiento, null; error de servidor, se lanza', async () => {
    const fetchFn = fetchReturning(200, { follower_count: 1200, is_verified_user: false, id: '9' });
    expect(await new InstagramClient('t', 'v25.0', fetchFn).getProfile('9')).toEqual({ followerCount: 1200, isVerified: false });
    expect(lastCall(fetchFn)[0]).toBe('https://graph.instagram.com/v25.0/9?fields=follower_count,is_verified_user');
    expect(await new InstagramClient('t', 'v25.0', fetchReturning(400, { error: { message: 'User consent is required' } })).getProfile('9')).toBeNull();
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(500, { error: { message: 'boom' } })).getProfile('9')).rejects.toBeInstanceOf(MetaApiError);
  });
});

/** Fase 7.3c: rompehielos y menú fijo (doc oficial: POST/GET/DELETE /me/messenger_profile, platform instagram). */
describe('InstagramClient · messenger_profile', () => {
  it('publicar, leer y borrar', async () => {
    const fetchFn = fetchReturning(200, { result: 'success' });
    const client = new InstagramClient('tok', 'v25.0', fetchFn);
    const body = { platform: 'instagram' as const, ice_breakers: [{ locale: 'default', call_to_actions: [{ question: '¿Precio?', payload: 'S:f1' }] }] };
    await client.setMessengerProfile(body);
    let [url, init] = lastCall(fetchFn);
    expect([url, init.method, JSON.parse(init.body as string)]).toEqual(['https://graph.instagram.com/v25.0/me/messenger_profile', 'POST', body]);

    await client.getMessengerProfile(['ice_breakers', 'persistent_menu']);
    [url, init] = lastCall(fetchFn);
    expect([url, init.method]).toEqual(['https://graph.instagram.com/v25.0/me/messenger_profile?fields=ice_breakers,persistent_menu&platform=instagram', 'GET']);

    await client.deleteMessengerProfile(['persistent_menu']);
    [url, init] = lastCall(fetchFn);
    expect([url, init.method, JSON.parse(init.body as string)]).toEqual(['https://graph.instagram.com/v25.0/me/messenger_profile', 'DELETE', { platform: 'instagram', fields: ['persistent_menu'] }]);
  });
});
