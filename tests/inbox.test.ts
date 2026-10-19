import { describe, expect, it } from 'vitest';
import { filterInbox, toInboxItem } from '../src/inbox.js';
import { DRAFT_NOTE } from '../src/setter/service.js';
import type { ConversationRow } from '../src/store.js';

/** Bandeja de conversaciones del frontend (Fase 6.2): cada fila con su etapa y sus marcas, y los filtros. */

const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  igId: '111',
  username: 'ana_ventas',
  lastText: 'hola, quiero info',
  lastAt: new Date('2026-10-19T10:00:00Z'),
  lastDirection: 'in',
  lastStatus: 'sent',
  lastNote: null,
  aiPaused: false,
  lead: { siguiente_paso: 'agendar_llamada', nivel: 'nivel_2' },
  ...over,
});

describe('bandeja (Fase 6.2)', () => {
  it('cada fila lleva su etapa y nivel de la ficha, y si está sin responder', () => {
    expect(toInboxItem(row())).toMatchObject({ igId: '111', username: 'ana_ventas', stage: 'agendar_llamada', level: 'nivel_2', unanswered: true, hasDraft: false });
    expect(toInboxItem(row({ lastDirection: 'out', lead: null }))).toMatchObject({ stage: null, level: null, unanswered: false });
    expect(toInboxItem(row({ lead: { siguiente_paso: 42 } }))).toMatchObject({ stage: null });
  });

  it('marca el borrador pendiente (último mensaje retenido en modo borrador)', () => {
    expect(toInboxItem(row({ lastDirection: 'out', lastStatus: 'held', lastNote: DRAFT_NOTE })).hasDraft).toBe(true);
    expect(toInboxItem(row({ lastDirection: 'out', lastStatus: 'held', lastNote: 'Respuesta retenida: otra cosa' })).hasDraft).toBe(false);
  });

  it('filtra: sin responder, con borrador, IA parada y por etapa; y busca por usuario o id', () => {
    const items = [
      toInboxItem(row()),
      toInboxItem(row({ igId: '222', username: 'Pedro', lastDirection: 'out', aiPaused: true, lead: { siguiente_paso: 'seguir_calificando' } })),
      toInboxItem(row({ igId: '333', username: null, lastDirection: 'out', lastStatus: 'held', lastNote: DRAFT_NOTE, lead: null })),
    ];
    const ids = (filter: string, q = '') => filterInbox(items, filter, q).map((i) => i.igId);
    expect(ids('all')).toEqual(['111', '222', '333']);
    expect(ids('unanswered')).toEqual(['111']);
    expect(ids('draft')).toEqual(['333']);
    expect(ids('paused')).toEqual(['222']);
    expect(ids('stage:seguir_calificando')).toEqual(['222']);
    expect(ids('all', 'PED')).toEqual(['222']);
    expect(ids('all', '333')).toEqual(['333']);
    expect(ids('inventado')).toEqual(['111', '222', '333']);
  });
});
