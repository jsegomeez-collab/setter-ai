/**
 * Qué tipo de tráfico atrae cada reel (Fase 6.6), SIN IA y gratis (decisión 2026-10-17): se suman las fichas que el
 * setter ya rellena, agrupadas por el reel del que vino cada persona. "desconocido" no se cuenta.
 */

export interface TrafficInput {
  readonly sourceMediaId: string | null;
  readonly lead: Record<string, unknown> | null;
}

export interface ReelTraffic {
  readonly mediaId: string;
  readonly people: number;
  readonly withLead: number;
  readonly tipo: Readonly<Record<string, number>>;
  readonly nivel: Readonly<Record<string, number>>;
  readonly invertir: Readonly<Record<string, number>>;
  readonly paso: Readonly<Record<string, number>>;
}

const UNKNOWN = 'desconocido';
const FIELDS = { tipo: 'tipo_lead', nivel: 'nivel', invertir: 'puede_invertir', paso: 'siguiente_paso' } as const;

function tally(leads: readonly Record<string, unknown>[], field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const value = lead[field];
    if (typeof value === 'string' && value !== UNKNOWN) counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function reelTraffic(contacts: readonly TrafficInput[]): ReelTraffic[] {
  const byReel = new Map<string, TrafficInput[]>();
  for (const contact of contacts) {
    if (contact.sourceMediaId) byReel.set(contact.sourceMediaId, [...(byReel.get(contact.sourceMediaId) ?? []), contact]);
  }
  return [...byReel.entries()]
    .map(([mediaId, people]) => {
      const leads = people.flatMap((p) => (p.lead ? [p.lead] : []));
      return {
        mediaId,
        people: people.length,
        withLead: leads.length,
        tipo: tally(leads, FIELDS.tipo),
        nivel: tally(leads, FIELDS.nivel),
        invertir: tally(leads, FIELDS.invertir),
        paso: tally(leads, FIELDS.paso),
      };
    })
    .sort((a, b) => b.withLead - a.withLead || b.people - a.people);
}
