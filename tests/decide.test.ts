import { describe, expect, it } from 'vitest';
import { decide, TEXTS, type DecisionContext } from '../src/decide.js';
import type { InstagramEvent } from '../src/meta/parse.js';
import { ACCOUNT_ID, STRANGER_ID, TEST_MEDIA_ID } from './helpers.js';

const ctx = (overrides: Partial<DecisionContext> = {}): DecisionContext => ({
  testMediaId: TEST_MEDIA_ID,
  dmRepliesEnabled: true,
  allowedSenderIds: new Set([STRANGER_ID]),
  ...overrides,
});

const comment = (overrides: Partial<Extract<InstagramEvent, { kind: 'comment' }>> = {}): InstagramEvent => ({
  kind: 'comment',
  accountId: ACCOUNT_ID,
  commentId: 'c-1',
  text: 'info',
  fromId: STRANGER_ID,
  fromUsername: 'cuenta_prueba',
  mediaId: TEST_MEDIA_ID,
  parentId: null,
  ...overrides,
});

const message = (overrides: Partial<Extract<InstagramEvent, { kind: 'message' }>> = {}): InstagramEvent => ({
  kind: 'message',
  accountId: ACCOUNT_ID,
  senderId: STRANGER_ID,
  recipientId: ACCOUNT_ID,
  mid: 'm-1',
  text: 'hola',
  isEcho: false,
  ...overrides,
});

describe('decide — comentarios', () => {
  it('en el reel de prueba: respuesta pública + DM privado', () => {
    const decision = decide(comment(), ctx());
    expect(decision.actions.map((action) => action.type)).toEqual(['reply_comment', 'private_reply']);
    expect(decision.actions[1]).toMatchObject({ commentId: 'c-1', text: TEXTS.privateReply('info') });
  });

  it('SEGURO: no toca reels que no son el de prueba (ManyChat sigue con ellos)', () => {
    expect(decide(comment({ mediaId: '999' }), ctx()).actions).toEqual([]);
  });

  it('SEGURO: no hace nada si no hay reel de prueba elegido', () => {
    expect(decide(comment(), ctx({ testMediaId: null })).actions).toEqual([]);
  });

  it('ignora comentarios de tu propia cuenta (evita bucles con nuestras respuestas)', () => {
    expect(decide(comment({ fromId: ACCOUNT_ID }), ctx()).actions).toEqual([]);
  });

  it('ignora respuestas a otros comentarios', () => {
    expect(decide(comment({ parentId: 'c-0' }), ctx()).actions).toEqual([]);
  });

  it('recorta comentarios muy largos al citarlos', () => {
    const text = TEXTS.privateReply('a'.repeat(500));
    expect(text.length).toBeLessThan(300);
    expect(text).toContain('…');
  });
});

describe('decide — DMs', () => {
  it('remitente autorizado y DMs activados: contesta', () => {
    const decision = decide(message(), ctx());
    expect(decision.actions).toEqual([
      { type: 'send_dm', dedupKey: 'dm:m-1', recipientId: STRANGER_ID, text: TEXTS.dmReply('hola') },
    ]);
  });

  it('SEGURO: no contesta a remitentes no autorizados (clientes reales)', () => {
    expect(decide(message({ senderId: '123' }), ctx()).actions).toEqual([]);
  });

  it('SEGURO: no contesta si los DMs están desactivados', () => {
    expect(decide(message(), ctx({ dmRepliesEnabled: false })).actions).toEqual([]);
  });

  it('no contesta a ecos ni a mensajes sin texto', () => {
    expect(decide(message({ isEcho: true }), ctx()).actions).toEqual([]);
    expect(decide(message({ text: null }), ctx()).actions).toEqual([]);
  });
});

describe('decide — otros', () => {
  it('standby, botones y otros avisos solo se registran', () => {
    const others: InstagramEvent[] = [
      { kind: 'standby', accountId: ACCOUNT_ID, senderId: STRANGER_ID, mid: 'm', text: 'x' },
      { kind: 'postback', accountId: ACCOUNT_ID, senderId: STRANGER_ID, mid: 'm', title: 't', payload: 'p' },
      { kind: 'other', accountId: ACCOUNT_ID, field: 'mentions' },
    ];
    for (const event of others) {
      const decision = decide(event, ctx());
      expect(decision.actions).toEqual([]);
      expect(decision.note.length).toBeGreaterThan(0);
    }
    expect(decide(others[0] as InstagramEvent, ctx()).note).toContain('STANDBY');
  });
});
