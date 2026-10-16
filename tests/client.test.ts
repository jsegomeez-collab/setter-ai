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
    expect(media).toEqual([{ id: '1', caption: 'c', permalink: null, timestamp: null, mediaProductType: null }]);
    const sub = fetchReturning(200, { success: true });
    await new InstagramClient('t', 'v25.0', sub).subscribe();
    expect(lastCall(sub)[0]).toContain('subscribed_fields=comments,messages');
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
