import { describe, expect, it } from 'vitest';
import { readLiveProfile, toMessengerProfile } from '../src/chat-entry.js';

/** Fase 7.3c: lectura de lo publicado en Instagram y formato que se manda a Meta. */

describe('readLiveProfile', () => {
  it('respuesta REAL de producción (2026-10-19): un menú sin opciones no cuenta como opción vacía', () => {
    expect(readLiveProfile({ data: [{ persistent_menu: [{ locale: 'default' }] }] })).toEqual({ iceBreakers: [], menu: [] });
  });

  it('lee rompehielos y menú con sus opciones', () => {
    const response = {
      data: [
        {
          ice_breakers: [{ locale: 'default', call_to_actions: [{ question: '¿Precio?', payload: 'S:f1' }] }],
          persistent_menu: [{ locale: 'default', call_to_actions: [{ type: 'web_url', title: 'Web', url: 'https://e.com' }] }],
        },
      ],
    };
    expect(readLiveProfile(response)).toEqual({ iceBreakers: [{ question: '¿Precio?', payload: 'S:f1' }], menu: [{ title: 'Web', target: 'https://e.com' }] });
    expect(readLiveProfile(null)).toEqual({ iceBreakers: [], menu: [] });
  });
});

describe('toMessengerProfile', () => {
  it('sin nada que publicar: no manda perfil y borra las dos listas', () => {
    expect(toMessengerProfile({ iceBreakers: [], menu: [] })).toEqual({ profile: null, remove: ['ice_breakers', 'persistent_menu'] });
  });
});
