import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@host/db',
  ADMIN_PASSWORD: 'contraseña-larga-123',
  WEBHOOK_VERIFY_TOKEN: 'token',
};

describe('loadConfig', () => {
  it('carga valores por defecto razonables', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ port: 3000, igApiVersion: 'v25.0', igAccessToken: null, appSecrets: [], allowedSenderIds: [] });
  });

  it('lee secretos opcionales y la lista de remitentes', () => {
    const config = loadConfig({
      ...base,
      PORT: '10000',
      META_APP_SECRET: ' a ',
      META_APP_SECRET_ALT: 'b',
      IG_ACCESS_TOKEN: 'tok',
      ALLOWED_SENDER_IDS: '1, 2,,3',
    });
    expect(config).toMatchObject({ port: 10000, appSecrets: ['a', 'b'], igAccessToken: 'tok', allowedSenderIds: ['1', '2', '3'] });
  });

  it('falla claro si falta algo obligatorio', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL');
  });

  it('exige una contraseña de panel larga', () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'corta' })).toThrow('ADMIN_PASSWORD');
  });

  it('rechaza un puerto inválido', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
  });
});
