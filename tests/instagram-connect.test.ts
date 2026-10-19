import { describe, expect, it, vi } from 'vitest';
import { InstagramConnect } from '../src/instagram-connect.js';

/**
 * Prueba de "Conectar Instagram" (antes de la 7.5): ¿puede una cuenta con rol "Evaluador de Instagram" dar permisos con
 * el inicio de sesión oficial, sin revisión de Meta? Pasos de la doc oficial (Business Login for Instagram).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(fetchFn = vi.fn()) {
  const connect = new InstagramConnect({
    appId: '1117985297673013',
    appSecrets: ['secreto-a', 'secreto-b'],
    redirectUri: 'https://setter.test/oauth/instagram/callback',
    apiVersion: 'v25.0',
    fetchFn,
    now: () => 1_000_000,
  });
  return { connect, fetchFn };
}

describe('InstagramConnect', () => {
  it('el enlace es el oficial, con los 3 permisos, la vuelta registrada y un state de un solo uso', () => {
    const { connect } = setup();
    const url = new URL(connect.authorizeUrl());
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('1117985297673013');
    expect(url.searchParams.get('redirect_uri')).toBe('https://setter.test/oauth/instagram/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments');
    const state = url.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThanOrEqual(20);
    expect(connect.consumeState(state)).toBe(true);
    expect(connect.consumeState(state)).toBe(false);
    expect(connect.consumeState('inventado')).toBe(false);
  });

  it('el state caduca a los 10 minutos', () => {
    let now = 0;
    const connect = new InstagramConnect({ appId: 'x', appSecrets: ['s'], redirectUri: 'https://a.b/c', apiVersion: 'v25.0', fetchFn: vi.fn(), now: () => now });
    const state = new URL(connect.authorizeUrl()).searchParams.get('state') ?? '';
    now = 10 * 60 * 1000 + 1;
    expect(connect.consumeState(state)).toBe(false);
  });

  it('código → token corto → token de 60 días → usuario; si la primera clave no vale, prueba la segunda (sin decir cuál es)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error_type: 'OAuthException', code: 101, error_message: 'Error validating client secret.' }))
      .mockResolvedValueOnce(json(200, { access_token: 'corto', user_id: 99, permissions: ['instagram_business_basic', 'instagram_business_manage_messages'] }))
      .mockResolvedValueOnce(json(200, { access_token: 'largo', token_type: 'bearer', expires_in: 5_183_944 }))
      .mockResolvedValueOnce(json(200, { user_id: '1784', username: 'josegomezlife' }));
    const { connect } = setup(fetchFn);
    const result = await connect.exchange('codigo#_');
    expect(result).toEqual({
      ok: true,
      username: 'josegomezlife',
      userId: '1784',
      permissions: ['instagram_business_basic', 'instagram_business_manage_messages'],
      expiresInDays: 59,
      secretIndex: 1,
      accessToken: 'largo',
    });
    const [firstUrl, firstInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe('https://api.instagram.com/oauth/access_token');
    // Sin el "#_" que añade Meta al final del código.
    expect(String(firstInit.body)).toMatch(/&code=codigo$/);
    expect(String(fetchFn.mock.calls[2]?.[0])).toContain('https://graph.instagram.com/access_token?grant_type=ig_exchange_token');
  });

  it('si Meta rechaza (p. ej. cuenta sin rol), devuelve su mensaje tal cual', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(400, { error_type: 'OAuthException', code: 400, error_message: 'Insufficient developer role' }));
    const { connect } = setup(fetchFn);
    expect(await connect.exchange('c')).toEqual({ ok: false, error: 'Insufficient developer role' });
  });
});
