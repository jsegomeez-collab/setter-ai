import type { Media } from './meta/client.js';
import type { ContactRow } from './store.js';

/** Contactos del frontend (Fase 6.3): cada fila con su etapa, filtros y exportación a CSV. */

export interface ContactItem {
  readonly igId: string;
  readonly username: string | null;
  readonly tags: readonly string[];
  readonly sourceMediaId: string | null;
  readonly lastMediaId: string | null;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  readonly stage: string | null;
  readonly aiPaused: boolean;
  /** Campos propios (Fase 7.3a/7.4): los guarda el paso "Guardar un dato" o se ponen a mano. */
  readonly fields: Readonly<Record<string, string>>;
  /** Foto de perfil (Fase 8.1); null = sin foto. */
  readonly picture: string | null;
}

export interface ContactFilters {
  readonly q?: string;
  readonly tag?: string;
  readonly media?: string;
  readonly stage?: string;
}

const REEL_LABEL_CHARS = 45;

export function toContactItem(row: ContactRow): ContactItem {
  const step = row.lead && typeof row.lead === 'object' ? (row.lead as Record<string, unknown>).siguiente_paso : null;
  return {
    igId: row.igId,
    username: row.username,
    tags: row.tags,
    sourceMediaId: row.sourceMediaId,
    lastMediaId: row.lastMediaId,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    stage: typeof step === 'string' ? step : null,
    aiPaused: row.aiPaused ?? false,
    fields: row.fields ?? {},
    picture: row.picture ?? null,
  };
}

export function filterContacts(items: readonly ContactItem[], filters: ContactFilters): ContactItem[] {
  const q = (filters.q ?? '').trim().toLowerCase().replace(/^@/, '');
  return items.filter(
    (item) =>
      (!q || (item.username ?? '').toLowerCase().includes(q) || item.igId.includes(q)) &&
      (!filters.tag || item.tags.includes(filters.tag)) &&
      (!filters.media || item.sourceMediaId === filters.media) &&
      (!filters.stage || item.stage === filters.stage),
  );
}

/** "2026-10-16 · principio del texto del reel" (como en el panel antiguo); sin datos del reel, su id. */
export function reelLabel(media: Media | undefined, fallbackId = ''): string {
  if (!media) return fallbackId;
  return `${media.timestamp?.slice(0, 10) ?? ''} · ${(media.caption ?? '').slice(0, REEL_LABEL_CHARS).trim()}`;
}

/** Una celda: entre comillas, comillas duplicadas y, si empieza por = + - @, un apóstrofo (Excel no la ejecuta como fórmula). */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV para Excel / Google Sheets (con BOM para que respete las tildes). */
export function contactsCsv(items: readonly ContactItem[], reelTitle: (mediaId: string) => string): string {
  const header = 'usuario,id,etiquetas,reel_origen,etapa,primera_vez,ultima_vez,datos';
  const lines = items.map((item) =>
    [
      cell(item.username ?? ''),
      cell(item.igId),
      `"${item.tags.map((tag) => cell(tag).slice(1, -1)).join(' | ')}"`,
      cell(item.sourceMediaId ? reelTitle(item.sourceMediaId) : ''),
      cell(item.stage ?? ''),
      cell(item.firstSeen.toISOString()),
      cell(item.lastSeen.toISOString()),
      cell(Object.entries(item.fields).map(([field, value]) => `${field}: ${value}`).join(' | ')),
    ].join(','),
  );
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
