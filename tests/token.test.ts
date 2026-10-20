import { describe, expect, it, vi } from 'vitest';
import { TokenManager, decrypt, encrypt } from '../src/meta/token.js';
import { SETTINGS } from '../src/store.js';
import { createMemoryStore } from './helpers.js';

const KEY = 'clave-de-cifrado-larga-123';
const NOW = new Date('2026-10-16T12:00:00Z');

describe('cifrado del token', () => {
  it('cifra y descifra; con otra clave falla', () => {
    const secret = encrypt('IGAAtoken', KEY);
    expect(secret).not.toContain('IGAAtoken');
    expect(decrypt(secret, KEY)).toBe('IGAAtoken');
    expect(() => decrypt(secret, 'otra-clave-distinta-999')).toThrow();
  });
});

describe('TokenManager', () => {
  it('sin token renovado usa el de la variable de entorno', async () => {
    const tokens = new TokenManager({ store: createMemoryStore(), envToken: 'env-token', encryptionKey: KEY });
    expect(await tokens.get()).toBe('env-token');
    expect((await tokens.status()).source).toBe('variable de entorno');
  });

  it('renueva, guarda cifrado y a partir de ahí usa el nuevo', async () => {
    const store = createMemoryStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'nuevo-token', expiresInSeconds: 5_184_000 });
    const tokens = new TokenManager({ store, envToken: 'env-token', encryptionKey: KEY, refresh, now: () => NOW });
    expect(await tokens.refreshIfDue()).toContain('renovado');
    expect(refresh).toHaveBeenCalledWith('env-token');
    expect(store.settings.get(SETTINGS.igToken)).not.toContain('nuevo-token');
    expect(store.settings.get(SETTINGS.igTokenExpiresAt)).toBe('2026-12-15T12:00:00.000Z');
    const fresh = new TokenManager({ store, envToken: 'env-token', encryptionKey: KEY });
    expect(await fresh.get()).toBe('nuevo-token');
    expect((await fresh.status()).source).toBe('base de datos');
  });

  it('no renueva si se renovó hace menos de 7 días, salvo que se fuerce', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.igTokenRefreshedAt, '2026-10-14T12:00:00.000Z');
    const refresh = vi.fn().mockResolvedValue({ accessToken: 't2', expiresInSeconds: null });
    const tokens = new TokenManager({ store, envToken: 'env', encryptionKey: KEY, refresh, now: () => NOW });
    expect(await tokens.refreshIfDue()).toContain('No toca');
    expect(refresh).not.toHaveBeenCalled();
    expect(await tokens.refreshIfDue(true)).toContain('desconocido');
  });

  it('si Meta falla, guarda el error y sigue con el token anterior', async () => {
    const store = createMemoryStore();
    const refresh = vi.fn().mockRejectedValue(new Error('token demasiado nuevo'));
    const tokens = new TokenManager({ store, envToken: 'env', encryptionKey: KEY, refresh, now: () => NOW });
    expect(await tokens.refreshIfDue()).toContain('No se pudo');
    expect(store.settings.get(SETTINGS.igTokenLastError)).toContain('token demasiado nuevo');
    expect(await tokens.get()).toBe('env');
  });

  it('sin clave de cifrado o sin token no hace nada', async () => {
    expect(await new TokenManager({ store: createMemoryStore(), envToken: 'x', encryptionKey: null }).refreshIfDue()).toContain('TOKEN_ENCRYPTION_KEY');
    expect(await new TokenManager({ store: createMemoryStore(), envToken: null, encryptionKey: KEY }).refreshIfDue()).toContain('No hay token');
  });

  it('si el token guardado no se puede descifrar, avisa y usa el de entorno', async () => {
    const store = createMemoryStore();
    store.settings.set(SETTINGS.igToken, encrypt('viejo', 'otra-clave-distinta-999'));
    const tokens = new TokenManager({ store, envToken: 'env', encryptionKey: KEY });
    expect(await tokens.get()).toBe('env');
    expect(store.settings.get(SETTINGS.igTokenLastError)).toContain('descifrar');
  });
});

describe('TokenManager · token conectado desde la web (Fase 7.5c)', () => {
  it('guarda el token cifrado con su caducidad y desde ese momento lo usa', async () => {
    const store = createMemoryStore();
    const tokens = new TokenManager({ store, envToken: null, encryptionKey: KEY, now: () => NOW });
    await tokens.save('token-del-espacio', 60 * 24 * 60 * 60);
    expect(store.settings.get(SETTINGS.igToken)).not.toContain('token-del-espacio');
    expect(await tokens.get()).toBe('token-del-espacio');
    expect(await new TokenManager({ store, envToken: null, encryptionKey: KEY }).get()).toBe('token-del-espacio');
    expect(store.settings.get(SETTINGS.igTokenExpiresAt)).toBe('2026-12-15T12:00:00.000Z');
  });

  it('sin clave de cifrado no se guarda (nunca en claro)', async () => {
    const tokens = new TokenManager({ store: createMemoryStore(), envToken: null, encryptionKey: null });
    await expect(tokens.save('token', null)).rejects.toThrow('TOKEN_ENCRYPTION_KEY');
  });
});
