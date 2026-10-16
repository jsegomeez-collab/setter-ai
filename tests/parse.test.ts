import { describe, expect, it } from 'vitest';
import { parseWebhook } from '../src/meta/parse.js';
import { ACCOUNT_ID, STRANGER_ID, TEST_MEDIA_ID, commentPayload, messagePayload } from './helpers.js';

describe('parseWebhook', () => {
  it('lee un comentario en formato changes[]', () => {
    const [event] = parseWebhook(commentPayload());
    expect(event).toEqual({
      kind: 'comment',
      accountId: ACCOUNT_ID,
      commentId: 'c-1',
      text: 'info',
      fromId: STRANGER_ID,
      fromUsername: 'cuenta_prueba',
      mediaId: TEST_MEDIA_ID,
      parentId: null,
    });
  });

  it('lee un comentario en formato field/value directo en entry (doc de Business Login)', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: ACCOUNT_ID,
          field: 'comments',
          value: { id: 'c-2', text: 'hola', from: { id: STRANGER_ID }, media: { id: TEST_MEDIA_ID } },
        },
      ],
    };
    const [event] = parseWebhook(payload);
    expect(event).toMatchObject({ kind: 'comment', commentId: 'c-2', fromUsername: null });
  });

  it('lee un DM de texto y un eco', () => {
    expect(parseWebhook(messagePayload('hola'))[0]).toMatchObject({ kind: 'message', text: 'hola', isEcho: false });
    expect(parseWebhook(messagePayload('yo', { isEcho: true }))[0]).toMatchObject({ kind: 'message', isEcho: true });
  });

  it('lee un DM enviado como change "messages" (botón Test de Meta)', () => {
    const payload = {
      entry: [
        {
          id: ACCOUNT_ID,
          changes: [
            {
              field: 'messages',
              value: { sender: { id: STRANGER_ID }, recipient: { id: ACCOUNT_ID }, message: { mid: 'm-9', text: 'test' } },
            },
          ],
        },
      ],
    };
    expect(parseWebhook(payload)[0]).toMatchObject({ kind: 'message', mid: 'm-9', text: 'test' });
  });

  it('lee standby (conversación de otra app) y botones', () => {
    const payload = {
      entry: [
        {
          id: ACCOUNT_ID,
          standby: [{ sender: { id: STRANGER_ID }, message: { mid: 'm-s', text: 'para manychat' } }],
          messaging: [{ sender: { id: STRANGER_ID }, postback: { mid: 'm-p', title: 'Quiero', payload: 'GO' } }],
        },
      ],
    };
    const events = parseWebhook(payload);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'standby', senderId: STRANGER_ID, text: 'para manychat' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ kind: 'postback', payload: 'GO' }));
  });

  it('reconoce avisos de "leído" (aunque vengan sin remitente) y reacciones', () => {
    const payload = {
      entry: [
        {
          id: ACCOUNT_ID,
          messaging: [
            { read: { mid: 'x' }, timestamp: 1 },
            { sender: { id: STRANGER_ID }, reaction: { mid: 'y', reaction: 'love' } },
          ],
        },
      ],
    };
    expect(parseWebhook(payload)).toEqual([
      { kind: 'receipt', accountId: ACCOUNT_ID, senderId: '', receipt: 'read' },
      { kind: 'receipt', accountId: ACCOUNT_ID, senderId: STRANGER_ID, receipt: 'reaction' },
    ]);
  });

  it('marca como "other" los campos que no son comentarios ni DMs', () => {
    const payload = { entry: [{ id: ACCOUNT_ID, changes: [{ field: 'mentions', value: { media_id: '1' } }] }] };
    expect(parseWebhook(payload)).toEqual([{ kind: 'other', accountId: ACCOUNT_ID, field: 'mentions' }]);
  });

  it('ignora basura sin lanzar error', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook('texto')).toEqual([]);
    expect(parseWebhook({ entry: 'no-es-lista' })).toEqual([]);
    expect(parseWebhook({ entry: [{ id: ACCOUNT_ID, messaging: [{ message: { text: 'sin remitente' } }] }] })).toEqual([]);
    expect(parseWebhook({ entry: [{ id: ACCOUNT_ID, changes: [{ field: 'comments', value: { text: 'sin id' } }] }] })).toEqual([]);
  });
});
