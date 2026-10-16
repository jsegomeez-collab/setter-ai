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
      limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
      delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
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
      SEND_LIMIT_PRIVATE_PER_HOUR: '50',
      SEND_DELAY_FOLLOWUP_MIN_MS: '100',
      SEND_DELAY_FOLLOWUP_MAX_MS: '150',
    });
    expect(config).toMatchObject({ port: 10000, appSecrets: ['a', 'b'], igAccessToken: 'tok', limits: { privateReplies: 50, publicReplies: 700, followUps: 3000 }, delays: { followUpMin: 100, followUpMax: 150 } });
  });

  it('falla claro con valores incorrectos', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL');
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'corta' })).toThrow('ADMIN_PASSWORD');
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: 'corta' })).toThrow('TOKEN_ENCRYPTION_KEY');
    expect(() => loadConfig({ ...base, SEND_LIMIT_PUBLIC_PER_HOUR: '-1' })).toThrow('SEND_LIMIT_PUBLIC_PER_HOUR');
    expect(() => loadConfig({ ...base, SEND_DELAY_COMMENT_MIN_MS: '5000', SEND_DELAY_COMMENT_MAX_MS: '1000' })).toThrow('SEND_DELAY_COMMENT_MAX_MS');
    expect(() => loadConfig({ ...base, SEND_DELAY_FOLLOWUP_MIN_MS: '5000', SEND_DELAY_FOLLOWUP_MAX_MS: '1000' })).toThrow('SEND_DELAY_FOLLOWUP_MAX_MS');
  });
});
