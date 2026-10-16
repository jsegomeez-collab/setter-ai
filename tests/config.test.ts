import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@host/db',
  ADMIN_PASSWORD: 'contraseña-larga-123',
  WEBHOOK_VERIFY_TOKEN: 'token',
};

describe('loadConfig', () => {
  it('carga valores por defecto razonables', () => {
    expect(loadConfig(base)).toMatchObject({
      port: 3000,
      igApiVersion: 'v25.0',
      igAccessToken: null,
      appSecrets: [],
      tokenEncryptionKey: null,
      sendLimitPerHour: 120,
      sendDelayMinMs: 2000,
      sendDelayMaxMs: 5000,
    });
  });

  it('lee secretos, token, clave de cifrado y límites', () => {
    const config = loadConfig({
      ...base,
      PORT: '10000',
      META_APP_SECRET: ' a ',
      META_APP_SECRET_ALT: 'b',
      IG_ACCESS_TOKEN: 'tok',
      TOKEN_ENCRYPTION_KEY: 'clave-larga-de-16+',
      SEND_LIMIT_PER_HOUR: '50',
      SEND_DELAY_MIN_MS: '1000',
      SEND_DELAY_MAX_MS: '1500',
    });
    expect(config).toMatchObject({ port: 10000, appSecrets: ['a', 'b'], igAccessToken: 'tok', sendLimitPerHour: 50, sendDelayMaxMs: 1500 });
  });

  it('falla claro con valores incorrectos', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL');
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'corta' })).toThrow('ADMIN_PASSWORD');
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: 'corta' })).toThrow('TOKEN_ENCRYPTION_KEY');
    expect(() => loadConfig({ ...base, SEND_LIMIT_PER_HOUR: '-1' })).toThrow('SEND_LIMIT_PER_HOUR');
    expect(() => loadConfig({ ...base, SEND_DELAY_MIN_MS: '5000', SEND_DELAY_MAX_MS: '1000' })).toThrow('SEND_DELAY_MAX_MS');
  });
});
