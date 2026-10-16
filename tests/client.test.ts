import { describe, expect, it, vi } from 'vitest';
import { InstagramClient, MetaApiError } from '../src/meta/client.js';

function fetchReturning(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

describe('InstagramClient', () => {
  it('manda un DM al endpoint oficial con Bearer token y JSON', async () => {
    const fetchFn = fetchReturning(200, { recipient_id: '9', message_id: 'mid' });
    const client = new InstagramClient('tok', 'v25.0', fetchFn);

    const result = await client.sendText('9', 'hola');

    expect(result).toEqual({ recipientId: '9', messageId: 'mid' });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.instagram.com/v25.0/me/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: '9' }, message: { text: 'hola' } });
  });

  it('manda la respuesta privada usando comment_id', async () => {
    const fetchFn = fetchReturning(200, { recipient_id: '9', message_id: 'mid' });
    await new InstagramClient('tok', 'v25.0', fetchFn).sendPrivateReply('c-1', 'hola');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { comment_id: 'c-1' }, message: { text: 'hola' } });
  });

  it('responde a un comentario en /{id}/replies', async () => {
    const fetchFn = fetchReturning(200, { id: 'r-1' });
    await new InstagramClient('tok', 'v25.0', fetchFn).replyToComment('c-1', 'gracias');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.instagram.com/v25.0/c-1/replies');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'gracias' });
  });

  it('lee la cuenta, los reels y activa la suscripción', async () => {
    const account = await new InstagramClient('t', 'v25.0', fetchReturning(200, { user_id: 178, username: 'jose' })).getAccount();
    expect(account).toEqual({ userId: '178', username: 'jose' });

    const media = await new InstagramClient(
      't',
      'v25.0',
      fetchReturning(200, { data: [{ id: '1', caption: 'c', media_product_type: 'REELS' }, { caption: 'sin id' }] }),
    ).listMedia();
    expect(media).toEqual([{ id: '1', caption: 'c', permalink: null, timestamp: null, mediaProductType: 'REELS' }]);

    const fetchFn = fetchReturning(200, { success: true });
    await new InstagramClient('t', 'v25.0', fetchFn).subscribe();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=comments,messages');
  });

  it('convierte los errores de Meta en MetaApiError con su mensaje', async () => {
    const client = new InstagramClient('t', 'v25.0', fetchReturning(400, { error: { message: 'Invalid OAuth access token', code: 190 } }));
    await expect(client.getAccount()).rejects.toMatchObject({ name: 'MetaApiError', status: 400, message: 'Invalid OAuth access token' });
  });

  it('aguanta respuestas que no son JSON y /me sin user_id', async () => {
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(502, '<html>Bad Gateway</html>')).subscribe()).rejects.toBeInstanceOf(MetaApiError);
    await expect(new InstagramClient('t', 'v25.0', fetchReturning(200, { id: 'x' })).getAccount()).rejects.toThrow('user_id');
  });
});
