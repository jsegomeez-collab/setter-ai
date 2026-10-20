import { describe, expect, it } from 'vitest';
import { contactsCsv, filterContacts, reelLabel, toContactItem } from '../src/contacts.js';
import type { ContactRow } from '../src/store.js';

/** Contactos del frontend (Fase 6.3): filtros y exportación a CSV. */

const row = (over: Partial<ContactRow> = {}): ContactRow => ({
  igId: '111',
  username: 'ana_ventas',
  tags: ['biblioteca'],
  firstSeen: new Date('2026-10-16T10:00:00Z'),
  lastSeen: new Date('2026-10-18T10:00:00Z'),
  sourceMediaId: 'reel-1',
  lastMediaId: 'reel-2',
  aiPaused: false,
  aiPausedReason: null,
  lead: { siguiente_paso: 'agendar_llamada' },
  ...over,
});

describe('contactos (Fase 6.3)', () => {
  it('cada contacto lleva su etapa de la ficha', () => {
    expect(toContactItem(row())).toMatchObject({ igId: '111', stage: 'agendar_llamada', sourceMediaId: 'reel-1' });
    expect(toContactItem(row({ lead: null })).stage).toBeNull();
  });

  it('filtra por búsqueda, etiqueta, reel de origen y etapa (se combinan)', () => {
    const items = [
      toContactItem(row()),
      toContactItem(row({ igId: '222', username: 'Pedro', tags: ['Grupo WhatsApp', 'biblioteca'], sourceMediaId: 'reel-9', lead: { siguiente_paso: 'descartar' } })),
      toContactItem(row({ igId: '333', username: null, tags: [], sourceMediaId: null, lead: null })),
    ];
    const ids = (f: Parameters<typeof filterContacts>[1]) => filterContacts(items, f).map((i) => i.igId);
    expect(ids({})).toEqual(['111', '222', '333']);
    expect(ids({ q: '@ped' })).toEqual(['222']);
    expect(ids({ tag: 'biblioteca' })).toEqual(['111', '222']);
    expect(ids({ tag: 'biblioteca', media: 'reel-9' })).toEqual(['222']);
    expect(ids({ stage: 'agendar_llamada' })).toEqual(['111']);
    expect(ids({ q: '333' })).toEqual(['333']);
  });

  it('el título del reel: fecha y el principio del texto; sin datos, el id', () => {
    expect(reelLabel({ id: 'r1', caption: 'Claude te puede hacer cosas increíbles con IA y más texto', permalink: null, timestamp: '2026-10-16T09:00:00+0000', mediaProductType: 'REELS', cover: null })).toBe(
      '2026-10-16 · Claude te puede hacer cosas increíbles con IA',
    );
    expect(reelLabel(undefined, 'r9')).toBe('r9');
  });

  it('CSV: cabecera, comillas escapadas y sin fórmulas que Excel ejecute (=, +, -, @)', () => {
    const items = [toContactItem(row({ username: '=HYPERLINK("http://malo")', tags: ['a "b"', '@c'], fields: { ciudad: 'Miami', interes: '=1+1' } }))];
    const csv = contactsCsv(items, () => 'Reel "uno"');
    const [header, line] = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(header).toBe('usuario,id,etiquetas,reel_origen,etapa,primera_vez,ultima_vez,datos');
    expect(line).toContain(`"'=HYPERLINK(""http://malo"")"`);
    expect(line).toContain(`"a ""b"" | '@c"`);
    expect(line).toContain('"Reel ""uno"""');
    expect(line).toContain('"ciudad: Miami | interes: =1+1"');
    expect(csv.startsWith('﻿')).toBe(true);
  });
});
