import { describe, expect, it } from 'vitest';
import { LoginLimiter, hashPassword, hashToken, newSessionToken, verifyPassword } from '../src/auth.js';

describe('contraseñas (scrypt, sin librerías)', () => {
  it('la contraseña correcta pasa y la incorrecta no', async () => {
    const stored = await hashPassword('una-clave-larga-123');
    expect(await verifyPassword('una-clave-larga-123', stored)).toBe(true);
    expect(await verifyPassword('otra-clave-larga-123', stored)).toBe(false);
  });

  it('cada hash lleva su propia sal (dos hashes de la misma clave son distintos) y nunca guarda la clave', async () => {
    const a = await hashPassword('una-clave-larga-123');
    const b = await hashPassword('una-clave-larga-123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('una-clave-larga-123');
  });

  it('un hash roto o vacío nunca da por buena la contraseña', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$roto')).toBe(false);
  });
});

describe('sesiones', () => {
  it('el token es largo y aleatorio; en la base solo se guarda su huella (sha256)', () => {
    const a = newSessionToken();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(newSessionToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });
});

describe('límite de intentos de login', () => {
  it('5 fallos seguidos bloquean 15 minutos; un acierto o el paso del tiempo lo desbloquean', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.isBlocked('ip|jose@x.com')).toBe(false);
      limiter.fail('ip|jose@x.com');
    }
    expect(limiter.isBlocked('ip|jose@x.com')).toBe(true);
    expect(limiter.isBlocked('ip|otra@x.com')).toBe(false);
    now = 15 * 60 * 1000 + 1;
    expect(limiter.isBlocked('ip|jose@x.com')).toBe(false);
    limiter.fail('ip|jose@x.com');
    limiter.succeed('ip|jose@x.com');
    expect(limiter.isBlocked('ip|jose@x.com')).toBe(false);
  });
});
