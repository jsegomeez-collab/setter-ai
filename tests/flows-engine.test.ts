import { describe, expect, it } from 'vitest';
import {
  decodePayload,
  encodePayload,
  explainComment,
  findFlowForComment,
  normalize,
  planAfterFollowCheck,
  planComment,
  planNode,
  planPostback,
} from '../src/flows/engine.js';
import type { InstagramEvent } from '../src/meta/parse.js';
import { ACCOUNT_ID, STRANGER_ID, TEST_MEDIA_ID, followFlow } from './helpers.js';

type CommentEvent = Extract<InstagramEvent, { kind: 'comment' }>;
const comment = (overrides: Partial<CommentEvent> = {}): CommentEvent => ({
  kind: 'comment',
  accountId: ACCOUNT_ID,
  commentId: 'c-1',
  text: 'Quiero INFO',
  fromId: STRANGER_ID,
  fromUsername: 'cuenta_prueba',
  mediaId: TEST_MEDIA_ID,
  parentId: null,
  ...overrides,
});
const postback = (payload: string | null, mid: string | null = 'pb-1'): Extract<InstagramEvent, { kind: 'postback' }> => ({
  kind: 'postback',
  accountId: ACCOUNT_ID,
  senderId: STRANGER_ID,
  mid,
  title: 'x',
  payload,
});

describe('normalize y payloads', () => {
  it('quita tildes, mayúsculas y @', () => {
    expect(normalize('  @Información ')).toBe('informacion');
  });
  it('codifica y decodifica el botón; rechaza payloads ajenos', () => {
    expect(decodePayload(encodePayload('flow1', 'gate'))).toEqual({ flowId: 'flow1', nodeId: 'gate' });
    expect(decodePayload('MANYCHAT_123')).toBeNull();
    expect(decodePayload(null)).toBeNull();
  });
});

describe('qué flujo salta', () => {
  it('reel + palabra clave sin tildes ni mayúsculas', () => {
    const flow = followFlow({ trigger: { type: 'comment', mediaIds: [TEST_MEDIA_ID], keywords: ['información', 'info'] } });
    expect(findFlowForComment([flow], comment())?.id).toBe('flow1');
    expect(findFlowForComment([flow], comment({ text: 'qué bueno' }))).toBeNull();
  });

  it('no salta en otros reels, ni si está desactivado', () => {
    expect(findFlowForComment([followFlow()], comment({ mediaId: '999999' }))).toBeNull();
    expect(findFlowForComment([followFlow({ enabled: false })], comment())).toBeNull();
  });

  it('modo prueba: solo responde a los usuarios indicados', () => {
    const flow = followFlow({ testUsernames: ['@JoseGomezLife'] });
    expect(findFlowForComment([flow], comment())).toBeNull();
    expect(findFlowForComment([flow], comment({ fromUsername: 'josegomezlife' }))?.id).toBe('flow1');
  });

  it('gana el más específico: reel concreto con palabra > todos los reels', () => {
    const general = followFlow({ id: 'general', trigger: { type: 'comment', mediaIds: 'all', keywords: [] } });
    const specific = followFlow({ id: 'especifico', trigger: { type: 'comment', mediaIds: [TEST_MEDIA_ID], keywords: ['info'] } });
    expect(findFlowForComment([general, specific], comment())?.id).toBe('especifico');
    expect(findFlowForComment([general, specific], comment({ mediaId: '555555' }))?.id).toBe('general');
  });
});

describe('explainComment (probar un comentario, Fase 6.5c)', () => {
  const flow = followFlow({ trigger: { type: 'comment', mediaIds: [TEST_MEDIA_ID], keywords: ['info', 'link'] }, testUsernames: ['josegomezlife'] });
  const probe = (overrides: Partial<{ text: string; username: string; mediaId: string | null }> = {}) =>
    explainComment(flow, { text: 'Quiero INFO', username: 'JoseGomezLife', mediaId: TEST_MEDIA_ID, ...overrides });

  it('coincide → sin motivos en contra; con la misma regla que el motor (mayúsculas, tildes, @)', () => {
    expect(probe()).toEqual({ matches: true, reasons: [] });
    expect(probe({ text: 'pásame el LÍNK', username: '@josegomezlife' }).matches).toBe(true);
  });

  it('explica cada motivo por el que no salta', () => {
    expect(probe({ mediaId: '999' }).reasons).toEqual(['Ese reel no está entre los elegidos del flujo.']);
    expect(probe({ username: 'otra_persona' }).reasons).toEqual(['El flujo está en modo prueba y @otra_persona no está en la lista.']);
    expect(probe({ text: 'qué bonito' }).reasons).toEqual(['El comentario no tiene ninguna palabra clave (info, link).']);
    expect(probe({ mediaId: '999', text: 'hola' }).reasons).toHaveLength(2);
  });

  it('findFlowForComment sigue igual: un flujo desactivado nunca salta', () => {
    expect(findFlowForComment([{ ...flow, enabled: false }], comment({ fromUsername: 'josegomezlife' }))).toBeNull();
    expect(findFlowForComment([flow], comment({ fromUsername: 'josegomezlife' }))?.id).toBe(flow.id);
  });
});

describe('planComment', () => {
  it('respuesta pública al azar + DM con el primer mensaje + clave "una vez por persona"', () => {
    const flow = followFlow({ publicReplies: ['A', 'B', 'C'] });
    const plan = planComment([flow], comment(), () => 0.5);
    expect(plan.actions[0]).toMatchObject({ type: 'private_reply', commentId: 'c-1', message: { text: 'Hola, pulsa el botón', flowId: 'flow1' } });
    expect(plan.actions[1]).toEqual({ type: 'reply_comment', dedupKey: 'reply:c-1', commentId: 'c-1', text: 'B', requires: 'private:c-1' });
    expect(plan.onceKey).toBe(`once:flow1:${STRANGER_ID}:${TEST_MEDIA_ID}`);
    const perFlow = planComment([followFlow({ onceScope: 'flow' })], comment());
    expect(perFlow.onceKey).toBe(`once:flow1:${STRANGER_ID}`);
  });

  it('sin respuestas públicas solo manda el DM; sin "una vez" no hay clave', () => {
    const plan = planComment([followFlow({ publicReplies: [], oncePerUser: false })], comment());
    expect(plan.actions.map((a) => a.type)).toEqual(['private_reply']);
    expect(plan.onceKey).toBeUndefined();
  });

  it('ignora comentarios propios, respuestas a comentarios y comentarios sin flujo', () => {
    expect(planComment([followFlow()], comment({ fromId: ACCOUNT_ID })).actions).toEqual([]);
    expect(planComment([followFlow()], comment({ parentId: 'c-0' })).actions).toEqual([]);
    expect(planComment([], comment()).note).toContain('ningún flujo');
  });
});

describe('botones y condición de seguir', () => {
  it('botón "Lo quiero" → comprobar si sigue', () => {
    const plan = planPostback([followFlow()], postback(encodePayload('flow1', 'gate')));
    expect(plan.actions).toEqual([
      { type: 'check_follow', dedupKey: 'pb:pb-1:gate', recipientId: STRANGER_ID, flowId: 'flow1', nodeId: 'gate', depth: 0 },
    ]);
  });

  it('sí sigue → recurso; no sigue → "sígueme"; no se sabe → recurso', () => {
    const flow = followFlow();
    const yes = planAfterFollowCheck(flow, 'gate', 'yes', STRANGER_ID, 'pb:1:gate', 0);
    const no = planAfterFollowCheck(flow, 'gate', 'no', STRANGER_ID, 'pb:1:gate', 0);
    const unknown = planAfterFollowCheck(flow, 'gate', 'unknown', STRANGER_ID, 'pb:1:gate', 0);
    expect(yes[0]).toMatchObject({ type: 'send_message', message: { text: 'Aquí lo tienes' } });
    expect(no[0]).toMatchObject({ type: 'send_message', message: { text: 'Sígueme primero' } });
    expect(unknown[0]).toMatchObject({ type: 'send_message', message: { text: 'Aquí lo tienes' } });
    expect(new Set([yes[0]?.dedupKey, no[0]?.dedupKey, unknown[0]?.dedupKey]).size).toBe(3);
  });

  it('botones de flujos borrados, desactivados o ajenos no hacen nada', () => {
    expect(planPostback([followFlow()], postback(encodePayload('otro', 'gate'))).actions).toEqual([]);
    expect(planPostback([followFlow({ enabled: false })], postback(encodePayload('flow1', 'gate'))).actions).toEqual([]);
    expect(planPostback([followFlow()], postback('MANYCHAT')).actions).toEqual([]);
    expect(planPostback([followFlow()], postback(encodePayload('flow1', 'noexiste'))).actions).toEqual([]);
  });

  it('sin mid usa remitente + payload para no duplicar', () => {
    const plan = planPostback([followFlow()], postback(encodePayload('flow1', 'resource'), null));
    expect(plan.actions[0]?.dedupKey).toBe(`pb:${STRANGER_ID}:F:flow1:resource:resource`);
  });

  it('corta cadenas de condiciones demasiado largas (anti-bucle)', () => {
    expect(planNode(followFlow(), 'gate', STRANGER_ID, 'x', 12)).toEqual([]);
    expect(planAfterFollowCheck(followFlow(), 'resource', 'yes', STRANGER_ID, 'x', 0)).toEqual([]);
  });
});
